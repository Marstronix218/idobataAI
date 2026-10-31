begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(1);

-- Migration 20261031190000: the sign-up backstop on auth.users, and the age
-- requirement in set_coach_profile and start_task.

create temporary table enforcement_token(name text primary key, token text not null, digest text not null);
insert into enforcement_token(name, token, digest)
select name, token, encode(sha256(convert_to(token, 'UTF8')), 'hex') from (values
  ('fresh',    'fresh-backstop-token-0001-abcdefghijklmnopq'),
  ('hooked',   'hooked-backstop-token-0002-abcdefghijklmnop'),
  ('expired',  'expired-backstop-token-0003-abcdefghijklmno'),
  ('old_used', 'old-used-backstop-token-0004-abcdefghijklmn'),
  ('spent',    'spent-backstop-token-0005-abcdefghijklmnopq'),
  ('probe_fresh',  'probe-fresh-backstop-token-0006-abcdefghij'),
  ('probe_hooked', 'probe-hooked-backstop-token-0007-abcdefghi')
) fixture(name, token);

insert into public.age_verification_tokens(token_hash, method, verified_at, expires_at, consumed_at)
select digest, 'self_attested', now() - interval '1 minute', now() + interval '14 minutes', null::timestamptz from enforcement_token where name = 'fresh'
union all
-- The auth hook consumed it a moment ago.
select digest, 'self_attested', now() - interval '2 minutes', now() + interval '13 minutes', now() - interval '1 minute' from enforcement_token where name = 'hooked'
union all
select digest, 'self_attested', now() - interval '20 minutes', now() - interval '5 minutes', null from enforcement_token where name = 'expired'
union all
select digest, 'self_attested', now() - interval '1 hour', now() - interval '45 minutes', now() - interval '50 minutes' from enforcement_token where name = 'old_used'
union all
-- As the backstop leaves a row it spent when the later delete fails: consumed and expired.
select digest, 'self_attested', now() - interval '2 minutes', now() - interval '1 second', now() - interval '1 minute' from enforcement_token where name = 'spent'
union all
select digest, 'self_attested', now() - interval '1 minute', now() + interval '14 minutes', null from enforcement_token where name = 'probe_fresh'
union all
select digest, 'self_attested', now() - interval '2 minutes', now() + interval '13 minutes', now() - interval '1 minute' from enforcement_token where name = 'probe_hooked';

create or replace function pg_temp.token(p_name text) returns text language sql as $$ select token from enforcement_token where name = p_name $$;
create or replace function pg_temp.digest(p_name text) returns text language sql as $$ select digest from enforcement_token where name = p_name $$;

-- Inserts one auth user; returns the SQLSTATE it raised, or null.
create or replace function pg_temp.try_sign_up(p_id uuid, p_metadata jsonb) returns text language plpgsql as $$
declare state text;
begin
  insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (p_id, 'authenticated', 'authenticated', 'enforce-' || p_id || '@example.test', crypt('test-password', gen_salt('bf')), now(), '{}', p_metadata, now(), now());
  return null;
exception when others then
  get stacked diagnostics state = returned_sqlstate;
  return state;
end $$;

-- ---------------------------------------------------------------------------
-- Structure.
-- ---------------------------------------------------------------------------

do $$ begin
  if not exists(
    select 1 from pg_trigger
    where tgrelid = 'auth.users'::regclass and tgname = 'require_signup_age_token' and not tgisinternal
      and tgenabled <> 'D' and (tgtype & 2) = 2 and (tgtype & 4) = 4 -- BEFORE, INSERT
  ) then raise exception 'the sign-up backstop trigger is missing'; end if;
  if not exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='require_signup_age_token' and p.prosecdef
      and p.proconfig @> array['search_path=""']
  ) then raise exception 'require_signup_age_token must be security definer with an empty search_path'; end if;
  if has_function_privilege('authenticated','public.require_signup_age_token()','EXECUTE')
    or has_function_privilege('anon','public.require_signup_age_token()','EXECUTE')
  then raise exception 'clients can execute the backstop function'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Pivot A off: nothing changes.
-- ---------------------------------------------------------------------------

do $$
declare state text;
begin
  if (select enabled from public.app_feature_flags where key='pivot_a.enabled') is distinct from false then
    raise exception 'pivot_a.enabled must start off';
  end if;
  state := pg_temp.try_sign_up('aaaaaaaa-6666-4666-8666-aaaaaaaaaaaa', '{"username":"enforce_a"}');
  if state is not null then raise exception 'flag off: a sign-up without a token failed (%)', state; end if;
  state := pg_temp.try_sign_up('bbbbbbbb-6666-4666-8666-bbbbbbbbbbbb', '{"username":"enforce_b","age_token":"never-issued-token-000000000000"}');
  if state is not null then raise exception 'flag off: a sign-up with an unknown token failed (%)', state; end if;
  if (select count(*) from public.user_profiles where id in ('aaaaaaaa-6666-4666-8666-aaaaaaaaaaaa','bbbbbbbb-6666-4666-8666-bbbbbbbbbbbb')) <> 2 then
    raise exception 'flag off: handle_new_user did not run';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Pivot A on: the backstop.
-- ---------------------------------------------------------------------------

update public.app_feature_flags set enabled=true where key='pivot_a.enabled';

do $$
declare state text;
begin
  state := pg_temp.try_sign_up('c0000000-6666-4666-8666-000000000001', '{"username":"enforce_none"}');
  if state is distinct from '42501' then raise exception 'flag on: a sign-up without a token was not refused (%)', state; end if;
  state := pg_temp.try_sign_up('c0000000-6666-4666-8666-000000000002', '{"age_token":"never-issued-token-000000000000"}');
  if state is distinct from '42501' then raise exception 'flag on: an unknown token was not refused (%)', state; end if;
  state := pg_temp.try_sign_up('c0000000-6666-4666-8666-000000000003', jsonb_build_object('age_token', pg_temp.token('expired')));
  if state is distinct from '42501' then raise exception 'flag on: an expired token was not refused (%)', state; end if;
  state := pg_temp.try_sign_up('c0000000-6666-4666-8666-000000000004', jsonb_build_object('age_token', pg_temp.token('old_used')));
  if state is distinct from '42501' then raise exception 'flag on: a token used long ago was not refused (%)', state; end if;
  -- The stored hash is not the token.
  state := pg_temp.try_sign_up('c0000000-6666-4666-8666-000000000005', jsonb_build_object('age_token', pg_temp.digest('fresh')));
  if state is distinct from '42501' then raise exception 'flag on: the stored hash was accepted (%)', state; end if;
  if exists(select 1 from auth.users where id::text like 'c0000000-6666-4666-8666-%') then
    raise exception 'a refused sign-up left a user behind';
  end if;

  -- Without the hook: an unconsumed, unexpired token.
  state := pg_temp.try_sign_up('d0000000-6666-4666-8666-000000000001', jsonb_build_object('username', 'enforce_fresh', 'age_token', pg_temp.token('fresh')));
  if state is not null then raise exception 'flag on: a live token was refused (%)', state; end if;
  -- With the hook: consumed a moment ago.
  state := pg_temp.try_sign_up('d0000000-6666-4666-8666-000000000002', jsonb_build_object('username', 'enforce_hooked', 'age_token', pg_temp.token('hooked')));
  if state is not null then raise exception 'flag on: a token the hook just consumed was refused (%)', state; end if;

  -- Both verified, both tokens spent: neither works a second time.
  if (select count(*) from public.user_coach_profiles
      where user_id in ('d0000000-6666-4666-8666-000000000001','d0000000-6666-4666-8666-000000000002') and age_verified_at is not null) <> 2
  then raise exception 'flag on: the admitted sign-ups were not verified'; end if;
  state := pg_temp.try_sign_up('d0000000-6666-4666-8666-000000000003', jsonb_build_object('age_token', pg_temp.token('fresh')));
  if state is distinct from '42501' then raise exception 'flag on: a spent token was accepted again (%)', state; end if;
  state := pg_temp.try_sign_up('d0000000-6666-4666-8666-000000000004', jsonb_build_object('age_token', pg_temp.token('hooked')));
  if state is distinct from '42501' then raise exception 'flag on: a spent hook token was accepted again (%)', state; end if;
end $$;

-- A token the backstop spent stays unusable even if the later delete failed.
do $$
declare state text;
begin
  state := pg_temp.try_sign_up('d0000000-6666-4666-8666-000000000005', jsonb_build_object('age_token', pg_temp.token('spent')));
  if state is distinct from '42501' then raise exception 'flag on: a token the backstop already spent was accepted (%)', state; end if;
end $$;

-- The backstop spends the row while it holds the lock, before handle_new_user
-- deletes it. A later BEFORE INSERT trigger (triggers of one kind fire in name
-- order) records what the row looked like at that point.
create table public.zz_age_backstop_probe(token_name text, consumed boolean, expired boolean);
create function public.zz_age_backstop_probe() returns trigger language plpgsql as $$
begin
  insert into public.zz_age_backstop_probe
  select fixture.name, age_token.consumed_at is not null, age_token.expires_at <= now()
  from public.age_verification_tokens age_token
  join enforcement_token fixture on fixture.digest = age_token.token_hash
  where fixture.token = new.raw_user_meta_data ->> 'age_token';
  return new;
end $$;
create trigger zz_age_backstop_probe before insert on auth.users for each row execute function public.zz_age_backstop_probe();

do $$
declare state text;
begin
  state := pg_temp.try_sign_up('d0000000-6666-4666-8666-000000000006', jsonb_build_object('username', 'probe_fresh', 'age_token', pg_temp.token('probe_fresh')));
  if state is not null then raise exception 'probe: a live token was refused (%)', state; end if;
  state := pg_temp.try_sign_up('d0000000-6666-4666-8666-000000000007', jsonb_build_object('username', 'probe_hooked', 'age_token', pg_temp.token('probe_hooked')));
  if state is not null then raise exception 'probe: a hook-consumed token was refused (%)', state; end if;

  if (select count(*) from public.zz_age_backstop_probe where consumed and expired) <> 2 then
    raise exception 'the backstop did not spend the token before handle_new_user: %', (select json_agg(probe) from public.zz_age_backstop_probe probe);
  end if;
  -- handle_new_user's 5-minute consumed window still matches: both rows are
  -- gone and both accounts are verified.
  if exists(select 1 from public.age_verification_tokens where token_hash in (pg_temp.digest('probe_fresh'), pg_temp.digest('probe_hooked'))) then
    raise exception 'handle_new_user did not delete a token the backstop spent';
  end if;
  if (select count(*) from public.user_coach_profiles
      where user_id in ('d0000000-6666-4666-8666-000000000006','d0000000-6666-4666-8666-000000000007') and age_verified_at is not null) <> 2
  then raise exception 'the probed sign-ups were not verified'; end if;
end $$;

drop trigger zz_age_backstop_probe on auth.users;

-- ---------------------------------------------------------------------------
-- set_coach_profile and start_task need a verified age while Pivot A is on.
-- ---------------------------------------------------------------------------

insert into public.characters(id, slug, name, role, is_launch, active)
values ('c2000000-0000-4000-8000-000000000001', 'enforce-coach', 'Enforce Coach', 'coach', true, true);
insert into public.tasks(id, owner_id, title, visibility, status)
values
  ('e0000000-6666-4666-8666-000000000001', 'aaaaaaaa-6666-4666-8666-aaaaaaaaaaaa', 'Unverified task', 'private', 'pending'),
  ('e0000000-6666-4666-8666-000000000002', 'd0000000-6666-4666-8666-000000000001', 'Verified task', 'private', 'pending');

-- A signed up before the gate (no verification); "fresh" (d...01) was verified at sign-up.
set local role authenticated;
set local "request.jwt.claim.sub" = 'aaaaaaaa-6666-4666-8666-aaaaaaaaaaaa';
do $$
declare state text; msg text;
begin
  begin
    perform public.set_coach_profile('c2000000-0000-4000-8000-000000000001', 'America/New_York');
  exception when others then get stacked diagnostics state = returned_sqlstate, msg = message_text;
  end;
  if state is distinct from 'P0001' or msg is distinct from 'age verification required' then
    raise exception 'set_coach_profile for an unverified user: expected P0001 age verification required, got % %', state, msg;
  end if;
  state := null; msg := null;
  begin
    perform public.start_task('e0000000-6666-4666-8666-000000000001');
  exception when others then get stacked diagnostics state = returned_sqlstate, msg = message_text;
  end;
  if state is distinct from 'P0001' or msg is distinct from 'age verification required' then
    raise exception 'start_task for an unverified user: expected P0001 age verification required, got % %', state, msg;
  end if;
end $$;
reset role;

do $$ begin
  if exists(select 1 from public.user_coach_profiles where user_id = 'aaaaaaaa-6666-4666-8666-aaaaaaaaaaaa') then
    raise exception 'set_coach_profile wrote a row for an unverified user';
  end if;
  if exists(select 1 from public.task_events where task_id = 'e0000000-6666-4666-8666-000000000001') then
    raise exception 'start_task recorded an event for an unverified user';
  end if;
  if (select status from public.tasks where id = 'e0000000-6666-4666-8666-000000000001') is distinct from 'pending' then
    raise exception 'a refused start changed the task';
  end if;
end $$;

set local role authenticated;
set local "request.jwt.claim.sub" = 'd0000000-6666-4666-8666-000000000001';
do $$
declare profile public.user_coach_profiles; event public.task_events;
begin
  profile := public.set_coach_profile('c2000000-0000-4000-8000-000000000001', 'America/New_York');
  if profile.selected_character_id is distinct from 'c2000000-0000-4000-8000-000000000001' or profile.age_verified_at is null then
    raise exception 'set_coach_profile failed for a verified user: %', row_to_json(profile);
  end if;
  event := public.start_task('e0000000-6666-4666-8666-000000000002');
  if event.id is null or event.type is distinct from 'started' then
    raise exception 'start_task failed for a verified user';
  end if;
end $$;
reset role;

-- With Pivot A off both still answer "feature disabled", as before.
update public.app_feature_flags set enabled=false where key='pivot_a.enabled';
set local role authenticated;
set local "request.jwt.claim.sub" = 'aaaaaaaa-6666-4666-8666-aaaaaaaaaaaa';
do $$
declare msg text;
begin
  begin
    perform public.set_coach_profile(null, 'America/New_York');
  exception when others then get stacked diagnostics msg = message_text;
  end;
  if msg is distinct from 'feature disabled' then raise exception 'flag off: set_coach_profile said %', msg; end if;
end $$;
reset role;

select extensions.pass('the sign-up backstop refuses users without a live age token only while Pivot A is on, and set_coach_profile and start_task require a verified age');
select * from extensions.finish();

rollback;
