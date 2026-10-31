begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(1);

-- The Pivot A age gate (migration 20261031180000): the before_user_created
-- hook, the token table, handle_new_user's copy, and set_coach_age_verified.
--
-- `supabase test db` runs as postgres, which cannot assume
-- supabase_auth_admin, so the hook's logic is exercised as postgres and the
-- grants and policies that let Auth run it are checked from the catalog.

-- The digest must match src/lib/age/tokens.ts: lowercase hex sha256 of the UTF-8 token.
create temporary table age_gate_fixture(name text primary key, token text not null, digest text not null);
insert into age_gate_fixture(name, token, digest)
select name, token, encode(sha256(convert_to(token, 'UTF8')), 'hex') from (values
  ('valid',   'valid-age-token-0001-abcdefghijklmnopqrstuvw'),
  ('expired', 'expired-age-token-0002-abcdefghijklmnopqrstu'),
  ('signup',  'signup-age-token-0003-abcdefghijklmnopqrstuv'),
  ('nohook',  'nohook-age-token-0004-abcdefghijklmnopqrstuv'),
  ('stale',   'stale-age-token-0005-abcdefghijklmnopqrstuvw')
) fixture(name, token);

insert into public.age_verification_tokens(token_hash, method, verified_at, expires_at, consumed_at)
select digest, 'self_attested', now() - interval '1 minute', now() + interval '15 minutes', null::timestamptz from age_gate_fixture where name in ('valid', 'signup', 'nohook')
union all
select digest, 'self_attested', now() - interval '20 minutes', now() - interval '5 minutes', null from age_gate_fixture where name = 'expired'
union all
select digest, 'self_attested', now() - interval '1 hour', now() - interval '45 minutes', now() - interval '50 minutes' from age_gate_fixture where name = 'stale';

create or replace function pg_temp.age_event(p_token text) returns jsonb language sql as $$
  select jsonb_build_object(
    'metadata', jsonb_build_object('uuid', gen_random_uuid(), 'time', now(), 'name', 'before-user-created', 'ip_address', '127.0.0.1'),
    'user', jsonb_build_object(
      'id', gen_random_uuid(), 'aud', 'authenticated', 'role', '', 'email', 'new@example.test', 'phone', '',
      'app_metadata', jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      'user_metadata', case when p_token is null then '{}'::jsonb else jsonb_build_object('age_token', p_token) end,
      'identities', '[]'::jsonb, 'created_at', '0001-01-01T00:00:00Z', 'updated_at', '0001-01-01T00:00:00Z', 'is_anonymous', false
    )
  );
$$;

create or replace function pg_temp.token(p_name text) returns text language sql as $$ select token from age_gate_fixture where name = p_name $$;
create or replace function pg_temp.digest(p_name text) returns text language sql as $$ select digest from age_gate_fixture where name = p_name $$;

-- ---------------------------------------------------------------------------
-- Structure and grants.
-- ---------------------------------------------------------------------------

do $$
declare role_name text;
begin
  -- Supabase advises against security definer for hooks: it runs as supabase_auth_admin.
  if not exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='hook_before_user_created' and not p.prosecdef
      and p.proconfig @> array['search_path=""']
  ) then raise exception 'hook_before_user_created must be security invoker with an empty search_path'; end if;
  if not has_function_privilege('supabase_auth_admin','public.hook_before_user_created(jsonb)','EXECUTE') then
    raise exception 'supabase_auth_admin cannot run the hook';
  end if;
  if not has_function_privilege('supabase_auth_admin','public.pivot_flag_enabled(text)','EXECUTE') then
    raise exception 'supabase_auth_admin cannot read the Pivot A flag inside the hook';
  end if;
  if not has_schema_privilege('supabase_auth_admin','public','USAGE') then
    raise exception 'supabase_auth_admin has no usage on public';
  end if;
  foreach role_name in array array['anon','authenticated','service_role'] loop
    if has_function_privilege(role_name,'public.hook_before_user_created(jsonb)','EXECUTE') then
      raise exception '% can run the auth hook', role_name;
    end if;
  end loop;
  if exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
      lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    where n.nspname='public' and p.proname in ('hook_before_user_created','set_coach_age_verified','apply_signup_age_verification')
      and acl.grantee=0 and acl.privilege_type='EXECUTE'
  ) then raise exception 'PUBLIC can execute an age gate function'; end if;

  -- The hook reads and consumes tokens; it never inserts or deletes them.
  if not has_table_privilege('supabase_auth_admin','public.age_verification_tokens','SELECT')
    or not has_column_privilege('supabase_auth_admin','public.age_verification_tokens','consumed_at','UPDATE')
  then raise exception 'supabase_auth_admin cannot consume tokens'; end if;
  if has_table_privilege('supabase_auth_admin','public.age_verification_tokens','INSERT')
    or has_table_privilege('supabase_auth_admin','public.age_verification_tokens','DELETE')
    or has_column_privilege('supabase_auth_admin','public.age_verification_tokens','expires_at','UPDATE')
  then raise exception 'supabase_auth_admin has more than select and update(consumed_at) on tokens'; end if;
  -- It does not bypass RLS, so it needs its own policies.
  if (select count(*) from pg_policies where schemaname='public' and tablename='age_verification_tokens'
      and roles = array['supabase_auth_admin']::name[] and cmd in ('SELECT','UPDATE')) <> 2
  then raise exception 'age_verification_tokens needs exactly a select and an update policy for supabase_auth_admin'; end if;
  if exists(select 1 from pg_policies where schemaname='public' and tablename='age_verification_tokens'
      and roles && array['public','anon','authenticated']::name[])
  then raise exception 'age_verification_tokens has a client policy'; end if;

  if not (select relrowsecurity from pg_class where oid='public.age_verification_tokens'::regclass) then
    raise exception 'RLS is off on age_verification_tokens';
  end if;
  if not has_table_privilege('service_role','public.age_verification_tokens','INSERT')
    or not has_table_privilege('service_role','public.age_verification_tokens','SELECT')
  then raise exception 'service_role cannot issue tokens'; end if;
  foreach role_name in array array['anon','authenticated'] loop
    if has_table_privilege(role_name,'public.age_verification_tokens','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
      raise exception '% has a privilege on age_verification_tokens', role_name;
    end if;
  end loop;

  -- No user id and no date of birth.
  if exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='age_verification_tokens'
      and column_name not in ('token_hash','method','verified_at','expires_at','consumed_at')
  ) then raise exception 'age_verification_tokens has a column beyond hash, method and times'; end if;

  if not exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='set_coach_age_verified' and p.prosecdef
      and p.proconfig @> array['search_path=""']
  ) then raise exception 'set_coach_age_verified must be security definer with an empty search_path'; end if;
  if not has_function_privilege('service_role','public.set_coach_age_verified(uuid,text)','EXECUTE') then
    raise exception 'service_role cannot record an age verification';
  end if;
  foreach role_name in array array['anon','authenticated','supabase_auth_admin'] loop
    if has_function_privilege(role_name,'public.set_coach_age_verified(uuid,text)','EXECUTE') then
      raise exception '% can record its own age verification', role_name;
    end if;
    if has_function_privilege(role_name,'public.apply_signup_age_verification(uuid,jsonb)','EXECUTE') then
      raise exception '% can run apply_signup_age_verification', role_name;
    end if;
  end loop;
end $$;

-- Clients can neither read nor write tokens.
set local role authenticated;
set local "request.jwt.claim.sub" = 'aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa';
do $$
declare state text;
begin
  begin
    perform 1 from public.age_verification_tokens;
  exception when others then get stacked diagnostics state = returned_sqlstate;
  end;
  if state is distinct from '42501' then raise exception 'authenticated read age_verification_tokens (got %)', state; end if;
  state := null;
  begin
    insert into public.age_verification_tokens(token_hash, method, expires_at) values (repeat('a', 64), 'self_attested', now() + interval '1 hour');
  exception when others then get stacked diagnostics state = returned_sqlstate;
  end;
  if state is distinct from '42501' then raise exception 'authenticated inserted a token (got %)', state; end if;
  state := null;
  begin
    perform public.set_coach_age_verified('aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa', 'self_attested');
  exception when others then get stacked diagnostics state = returned_sqlstate;
  end;
  if state is distinct from '42501' then raise exception 'authenticated called set_coach_age_verified (got %)', state; end if;
end $$;
reset role;

set local role anon;
do $$
declare state text;
begin
  begin
    perform 1 from public.age_verification_tokens;
  exception when others then get stacked diagnostics state = returned_sqlstate;
  end;
  if state is distinct from '42501' then raise exception 'anon read age_verification_tokens (got %)', state; end if;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Pivot A off: the hook allows every sign-up and consumes nothing.
-- ---------------------------------------------------------------------------

do $$ begin
  if (select enabled from public.app_feature_flags where key='pivot_a.enabled') is distinct from false then
    raise exception 'pivot_a.enabled must start off';
  end if;
  if public.hook_before_user_created(pg_temp.age_event(null)) is distinct from '{}'::jsonb then
    raise exception 'flag off: a sign-up without a token was rejected';
  end if;
  if public.hook_before_user_created(pg_temp.age_event('not-a-real-token-but-long-enough')) is distinct from '{}'::jsonb then
    raise exception 'flag off: a sign-up with an unknown token was rejected';
  end if;
  if public.hook_before_user_created(pg_temp.age_event(pg_temp.token('valid'))) is distinct from '{}'::jsonb then
    raise exception 'flag off: a sign-up with a valid token was rejected';
  end if;
  if (select consumed_at from public.age_verification_tokens where token_hash = pg_temp.digest('valid')) is not null then
    raise exception 'flag off: the hook consumed a token';
  end if;
end $$;

-- set_coach_age_verified refuses while Pivot A is off.
insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa','authenticated','authenticated','age-a@example.test',crypt('test-password',gen_salt('bf')),now(),'{}','{"username":"age_a"}',now(),now()),
  ('bbbbbbbb-5555-4555-8555-bbbbbbbbbbbb','authenticated','authenticated','age-b@example.test',crypt('test-password',gen_salt('bf')),now(),'{}','{"username":"age_b"}',now(),now());

do $$
declare state text; msg text;
begin
  begin
    perform public.set_coach_age_verified('aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa', 'self_attested');
  exception when others then get stacked diagnostics state = returned_sqlstate, msg = message_text;
  end;
  if state is distinct from 'P0001' or msg is distinct from 'feature disabled' then
    raise exception 'set_coach_age_verified with the flag off: expected P0001 feature disabled, got % %', state, msg;
  end if;
  if exists(select 1 from public.user_coach_profiles where user_id = 'aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa') then
    raise exception 'set_coach_age_verified wrote a row with the flag off';
  end if;
end $$;

update public.app_feature_flags set enabled=true where key='pivot_a.enabled';

-- ---------------------------------------------------------------------------
-- Pivot A on: the hook.
-- ---------------------------------------------------------------------------

do $$
declare
  rejected constant jsonb := '{"error": {"http_code": 403, "message": "age verification required"}}';
  result jsonb;
begin
  if public.hook_before_user_created(pg_temp.age_event(null)) is distinct from rejected then
    raise exception 'flag on: a sign-up without a token was not rejected with 403';
  end if;
  if public.hook_before_user_created(pg_temp.age_event('unknown-token-that-was-never-issued')) is distinct from rejected then
    raise exception 'flag on: an unknown token was not rejected';
  end if;
  if public.hook_before_user_created(pg_temp.age_event('short')) is distinct from rejected then
    raise exception 'flag on: a malformed token was not rejected';
  end if;
  -- A token's hash is not the token.
  if public.hook_before_user_created(pg_temp.age_event(pg_temp.digest('valid'))) is distinct from rejected then
    raise exception 'flag on: the stored hash was accepted as a token';
  end if;
  if public.hook_before_user_created(pg_temp.age_event(pg_temp.token('expired'))) is distinct from rejected then
    raise exception 'flag on: an expired token was not rejected';
  end if;
  if (select consumed_at from public.age_verification_tokens where token_hash = pg_temp.digest('expired')) is not null then
    raise exception 'flag on: an expired token was consumed';
  end if;

  result := public.hook_before_user_created(pg_temp.age_event(pg_temp.token('valid')));
  if result is distinct from '{}'::jsonb then raise exception 'flag on: a valid token was rejected: %', result; end if;
  if (select consumed_at from public.age_verification_tokens where token_hash = pg_temp.digest('valid')) is null then
    raise exception 'flag on: a valid token was not consumed';
  end if;

  if public.hook_before_user_created(pg_temp.age_event(pg_temp.token('valid'))) is distinct from rejected then
    raise exception 'flag on: a reused token was not rejected';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- handle_new_user copies the verification and strips the token.
-- ---------------------------------------------------------------------------

-- The normal path: the hook consumed the token just before the insert.
do $$ begin
  if public.hook_before_user_created(pg_temp.age_event(pg_temp.token('signup'))) is distinct from '{}'::jsonb then
    raise exception 'the sign-up token was rejected';
  end if;
end $$;

-- With Pivot A on, the sign-up backstop (20261031190000) admits only these two.
insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('cccccccc-5555-4555-8555-cccccccccccc','authenticated','authenticated','age-c@example.test',crypt('test-password',gen_salt('bf')),now(),'{}',
    jsonb_build_object('username', 'age_c', 'age_token', pg_temp.token('signup')),now(),now()),
  -- The hook is not enabled in this environment: the token is still unconsumed.
  ('eeeeeeee-5555-4555-8555-eeeeeeeeeeee','authenticated','authenticated','age-e@example.test',crypt('test-password',gen_salt('bf')),now(),'{}',
    jsonb_build_object('username', 'age_e', 'age_token', pg_temp.token('nohook')),now(),now());

-- handle_new_user does not depend on the flag; with Pivot A off, the backstop
-- lets these through, as in an environment before the switch.
update public.app_feature_flags set enabled=false where key='pivot_a.enabled';
insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  -- A legacy sign-up: no token.
  ('dddddddd-5555-4555-8555-dddddddddddd','authenticated','authenticated','age-d@example.test',crypt('test-password',gen_salt('bf')),now(),'{}','{"username":"age_d"}',now(),now()),
  -- A token consumed long ago (and expired) verifies nothing.
  ('ffffffff-5555-4555-8555-ffffffffffff','authenticated','authenticated','age-f@example.test',crypt('test-password',gen_salt('bf')),now(),'{}',
    jsonb_build_object('username', 'age_f', 'age_token', pg_temp.token('stale')),now(),now()),
  -- A token that was never issued verifies nothing and does not break sign-up.
  ('abababab-5555-4555-8555-abababababab','authenticated','authenticated','age-g@example.test',crypt('test-password',gen_salt('bf')),now(),'{}',
    '{"username":"age_g","age_token":"never-issued-token-0000000000000000"}',now(),now());

do $$
declare profile public.user_coach_profiles;
  -- The fixture's verified_at for the signup token (now() is fixed in a transaction).
  verified constant timestamptz := now() - interval '1 minute';
begin
  select * into profile from public.user_coach_profiles where user_id = 'cccccccc-5555-4555-8555-cccccccccccc';
  if profile.user_id is null or profile.age_verified_at is distinct from verified or profile.age_verification_method is distinct from 'self_attested' then
    raise exception 'handle_new_user did not copy the verification: %', row_to_json(profile);
  end if;
  if profile.selected_character_id is not null or profile.timezone is not null then
    raise exception 'handle_new_user set more than the age fields';
  end if;
  if (select raw_user_meta_data from auth.users where id = 'cccccccc-5555-4555-8555-cccccccccccc') is distinct from '{"username":"age_c"}'::jsonb then
    raise exception 'handle_new_user did not strip age_token, or touched other metadata';
  end if;
  if not exists(select 1 from public.user_profiles where id = 'cccccccc-5555-4555-8555-cccccccccccc' and username = 'age_c')
    or not exists(select 1 from public.notification_preferences where user_id = 'cccccccc-5555-4555-8555-cccccccccccc')
  then raise exception 'handle_new_user no longer creates the profile and preferences'; end if;

  -- Legacy: unchanged.
  if exists(select 1 from public.user_coach_profiles where user_id = 'dddddddd-5555-4555-8555-dddddddddddd') then
    raise exception 'a sign-up without a token got a coach profile';
  end if;
  if not exists(select 1 from public.user_profiles where id = 'dddddddd-5555-4555-8555-dddddddddddd' and username = 'age_d')
    or (select raw_user_meta_data from auth.users where id = 'dddddddd-5555-4555-8555-dddddddddddd') is distinct from '{"username":"age_d"}'::jsonb
  then raise exception 'a legacy sign-up changed'; end if;

  -- Used rows are deleted, so a token verifies one account at most.
  if exists(select 1 from public.age_verification_tokens where token_hash = pg_temp.digest('signup')) then
    raise exception 'handle_new_user kept the used token row';
  end if;

  -- No hook: handle_new_user verifies from the unconsumed token and deletes it.
  if (select age_verification_method from public.user_coach_profiles where user_id = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee') is distinct from 'self_attested' then
    raise exception 'handle_new_user did not verify from an unconsumed token';
  end if;
  if exists(select 1 from public.age_verification_tokens where token_hash = pg_temp.digest('nohook')) then
    raise exception 'handle_new_user did not use up an unconsumed token';
  end if;
  -- The stale row is not touched.
  if not exists(select 1 from public.age_verification_tokens where token_hash = pg_temp.digest('stale')) then
    raise exception 'handle_new_user deleted a stale token row';
  end if;

  -- Stale or unknown tokens: no verification, but the token is still stripped
  -- and the account is still created.
  if exists(select 1 from public.user_coach_profiles where user_id in ('ffffffff-5555-4555-8555-ffffffffffff','abababab-5555-4555-8555-abababababab')) then
    raise exception 'a stale or unknown token verified an account';
  end if;
  if exists(select 1 from auth.users where id in ('ffffffff-5555-4555-8555-ffffffffffff','abababab-5555-4555-8555-abababababab') and raw_user_meta_data ? 'age_token') then
    raise exception 'a stale or unknown token was left in the metadata';
  end if;
  if (select count(*) from public.user_profiles where id in ('ffffffff-5555-4555-8555-ffffffffffff','abababab-5555-4555-8555-abababababab')) <> 2 then
    raise exception 'a stale or unknown token blocked the profile insert';
  end if;

  -- Auth rewrites the row from its in-memory copy right after the insert; the
  -- token must not come back that way.
  update auth.users set raw_user_meta_data = raw_user_meta_data || jsonb_build_object('age_token', pg_temp.token('signup'), 'email_verified', true)
  where id = 'cccccccc-5555-4555-8555-cccccccccccc';
  if (select raw_user_meta_data from auth.users where id = 'cccccccc-5555-4555-8555-cccccccccccc') is distinct from '{"username":"age_c","email_verified":true}'::jsonb then
    raise exception 'a later write put age_token back into the metadata';
  end if;

  -- Auth copies the sign-up metadata into the email identity.
  insert into auth.identities(provider_id, user_id, identity_data, provider, created_at, updated_at)
  values ('cccccccc-5555-4555-8555-cccccccccccc', 'cccccccc-5555-4555-8555-cccccccccccc',
    jsonb_build_object('sub', 'cccccccc-5555-4555-8555-cccccccccccc', 'email', 'age-c@example.test', 'age_token', pg_temp.token('signup')),
    'email', now(), now());
  if exists(select 1 from auth.identities where user_id = 'cccccccc-5555-4555-8555-cccccccccccc' and identity_data ? 'age_token') then
    raise exception 'age_token was stored in identity_data';
  end if;
  if not exists(select 1 from auth.identities where user_id = 'cccccccc-5555-4555-8555-cccccccccccc' and identity_data ->> 'email' = 'age-c@example.test') then
    raise exception 'the identity lost its other data';
  end if;
end $$;

-- A spent token verifies no second account, even where the hook is not
-- enabled (this insert bypasses the hook, like a project without it).
insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('acacacac-5555-4555-8555-acacacacacac','authenticated','authenticated','age-h@example.test',crypt('test-password',gen_salt('bf')),now(),'{}',
    jsonb_build_object('username', 'age_h', 'age_token', pg_temp.token('signup')),now(),now()),
  ('adadadad-5555-4555-8555-adadadadadad','authenticated','authenticated','age-i@example.test',crypt('test-password',gen_salt('bf')),now(),'{}',
    jsonb_build_object('username', 'age_i', 'age_token', pg_temp.token('nohook')),now(),now());

do $$ begin
  if exists(select 1 from public.user_coach_profiles where user_id in ('acacacac-5555-4555-8555-acacacacacac','adadadad-5555-4555-8555-adadadadadad')) then
    raise exception 'a spent token verified a second account';
  end if;
end $$;

update public.app_feature_flags set enabled=true where key='pivot_a.enabled';

-- ---------------------------------------------------------------------------
-- set_coach_age_verified (existing accounts, D6).
-- ---------------------------------------------------------------------------

-- B has a coach profile already, without an age verification.
insert into public.user_coach_profiles(user_id, timezone) values ('bbbbbbbb-5555-4555-8555-bbbbbbbbbbbb', 'America/Chicago');

do $$
declare first public.user_coach_profiles; second public.user_coach_profiles; state text;
begin
  -- A has no row yet: one is created.
  first := public.set_coach_age_verified('aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa', 'self_attested');
  if first.user_id is distinct from 'aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa' or first.age_verified_at is null or first.age_verification_method is distinct from 'self_attested' then
    raise exception 'set_coach_age_verified did not create the row: %', row_to_json(first);
  end if;

  -- Only set while null: a second call changes nothing.
  second := public.set_coach_age_verified('aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa', 'other_provider');
  if second.age_verified_at is distinct from first.age_verified_at or second.age_verification_method is distinct from 'self_attested' then
    raise exception 'set_coach_age_verified overwrote an earlier verification';
  end if;

  -- B's existing row keeps its other fields.
  second := public.set_coach_age_verified('bbbbbbbb-5555-4555-8555-bbbbbbbbbbbb', 'self_attested');
  if second.age_verified_at is null or second.timezone is distinct from 'America/Chicago' then
    raise exception 'set_coach_age_verified did not update an existing row cleanly: %', row_to_json(second);
  end if;

  -- The sign-up copy also only fills a null.
  if (select age_verification_method from public.user_coach_profiles where user_id = 'cccccccc-5555-4555-8555-cccccccccccc') is distinct from 'self_attested' then
    raise exception 'unexpected method for C';
  end if;

  begin
    perform public.set_coach_age_verified('aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa', repeat('x', 41));
  exception when others then get stacked diagnostics state = returned_sqlstate;
  end;
  if state is distinct from '22023' then raise exception 'an over-long method was accepted (got %)', state; end if;
  state := null;
  begin
    perform public.set_coach_age_verified(null, 'self_attested');
  exception when others then get stacked diagnostics state = returned_sqlstate;
  end;
  if state is distinct from '22023' then raise exception 'a null user was accepted (got %)', state; end if;
end $$;

select extensions.pass('the age gate hook allows everything with Pivot A off, requires a fresh single-use token with it on, handle_new_user copies and strips the token, and set_coach_age_verified only fills a null');
select * from extensions.finish();

rollback;
