begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(1);

-- Fixtures: A owns one active pack and one cancelled pack; B owns nothing.
-- A trialing pack row is added below, once the constraint refusing it is checked.
insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa','authenticated','authenticated','coach-a@example.test',crypt('test-password',gen_salt('bf')),now(),'{}','{"username":"coach_a"}',now(),now()),
  ('bbbbbbbb-3333-4333-8333-bbbbbbbbbbbb','authenticated','authenticated','coach-b@example.test',crypt('test-password',gen_salt('bf')),now(),'{}','{"username":"coach_b"}',now(),now());

insert into public.characters(id, slug, name, role, is_launch, pack_sku, active)
values
  ('c1000000-0000-4000-8000-000000000001','cp-launch','Launch Coach','coach',true,null,true),
  ('c1000000-0000-4000-8000-000000000002','cp-retired','Retired Launch','rival',true,null,false),
  ('c1000000-0000-4000-8000-000000000003','cp-pack','Owned Pack','cheerleader',false,'pack_cp',true),
  ('c1000000-0000-4000-8000-000000000004','cp-lapsed','Lapsed Pack','deadpan',false,'pack_lapsed',true),
  ('c1000000-0000-4000-8000-000000000005','cp-trial','Trial Pack','coach',false,'pack_trial',true),
  ('c1000000-0000-4000-8000-000000000006','cp-retired-pack','Retired Pack','coach',false,'pack_gone',false);

insert into public.entitlements(user_id, product, status, source)
values
  ('aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa','pack:cp-pack','active','stripe'),
  ('aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa','pack:cp-lapsed','canceled','stripe'),
  ('aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa','pack:cp-retired-pack','active','stripe');

-- Packs are one-time purchases: only Plus can be trialing.
do $$
declare state text;
begin
  begin
    insert into public.entitlements(user_id, product, status, source)
    values ('aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa','pack:cp-trial','trialing','app_store');
  exception when others then get stacked diagnostics state = returned_sqlstate;
  end;
  if state is distinct from '23514' then raise exception 'a trialing pack entitlement was accepted (got %)', state; end if;

  insert into public.entitlements(user_id, product, status, source)
  values ('bbbbbbbb-3333-4333-8333-bbbbbbbbbbbb','plus','trialing','stripe');
  delete from public.entitlements where user_id='bbbbbbbb-3333-4333-8333-bbbbbbbbbbbb';
end $$;

-- set_coach_profile also refuses a trialing pack on its own, so the rule does
-- not rest on the constraint alone. Dropped only inside this test transaction.
alter table public.entitlements drop constraint entitlements_trialing_plus_only;
insert into public.entitlements(user_id, product, status, source)
values ('aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa','pack:cp-trial','trialing','app_store');

-- ---------------------------------------------------------------------------
-- Structure: a definer function with an empty search_path that only signed-in
-- users can execute.
-- ---------------------------------------------------------------------------

do $$ begin
  if not exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='set_coach_profile' and p.prosecdef
      and p.proconfig @> array['search_path=""']
  ) then raise exception 'set_coach_profile must be security definer with an empty search_path'; end if;
  if not has_function_privilege('authenticated','public.set_coach_profile(uuid,text)','EXECUTE') then
    raise exception 'authenticated cannot set a coach profile';
  end if;
  if has_function_privilege('anon','public.set_coach_profile(uuid,text)','EXECUTE') then
    raise exception 'anon can set a coach profile';
  end if;
  if has_function_privilege('service_role','public.set_coach_profile(uuid,text)','EXECUTE') then
    raise exception 'set_coach_profile is granted beyond authenticated';
  end if;
  if exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
      lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    where n.nspname='public' and p.proname='set_coach_profile'
      and acl.grantee=0 and acl.privilege_type='EXECUTE'
  ) then raise exception 'PUBLIC can execute set_coach_profile'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Flag OFF: refuses and writes nothing.
-- ---------------------------------------------------------------------------

do $$ begin
  if (select enabled from public.app_feature_flags where key='pivot_a.enabled') is distinct from false then
    raise exception 'pivot_a.enabled must start off';
  end if;
end $$;

set local role authenticated;
set local "request.jwt.claim.sub" = 'aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa';

do $$
declare state text; msg text;
begin
  begin
    perform public.set_coach_profile('c1000000-0000-4000-8000-000000000001', 'America/New_York');
  exception when others then get stacked diagnostics state = returned_sqlstate, msg = message_text;
  end;
  if state is distinct from 'P0001' or msg is distinct from 'feature disabled' then
    raise exception 'set_coach_profile with the flag off: expected P0001 feature disabled, got % %', state, msg;
  end if;
end $$;

reset role;
do $$ begin
  if exists(select 1 from public.user_coach_profiles where user_id in ('aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa','bbbbbbbb-3333-4333-8333-bbbbbbbbbbbb')) then
    raise exception 'set_coach_profile wrote a row with the flag off';
  end if;
end $$;

-- Both have verified their age (at sign-up, or in the D6 step). The refusal
-- for an unverified caller is covered by pivot_a_age_enforcement.sql.
insert into public.user_coach_profiles(user_id, age_verified_at, age_verification_method)
values
  ('aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa', now(), 'self_attested'),
  ('bbbbbbbb-3333-4333-8333-bbbbbbbbbbbb', now(), 'self_attested');

update public.app_feature_flags set enabled=true where key='pivot_a.enabled';

-- ---------------------------------------------------------------------------
-- Flag ON: who may call it.
-- ---------------------------------------------------------------------------

set local role anon;
do $$
declare state text;
begin
  begin
    perform public.set_coach_profile('c1000000-0000-4000-8000-000000000001', null);
  exception when others then get stacked diagnostics state = returned_sqlstate;
  end;
  if state is distinct from '42501' then raise exception 'anon could call set_coach_profile (got %)', state; end if;
end $$;

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '';
do $$
declare state text; msg text;
begin
  begin
    perform public.set_coach_profile(null, 'America/New_York');
  exception when others then get stacked diagnostics state = returned_sqlstate, msg = message_text;
  end;
  if state is distinct from '42501' or msg is distinct from 'authentication required' then
    raise exception 'a call without a user was not refused (got % %)', state, msg;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Flag ON: the caller's own row only.
-- ---------------------------------------------------------------------------

set local "request.jwt.claim.sub" = 'aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa';

do $$
declare saved public.user_coach_profiles;
begin
  saved := public.set_coach_profile('c1000000-0000-4000-8000-000000000001', 'America/New_York');
  if saved.user_id <> 'aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa'
    or saved.selected_character_id <> 'c1000000-0000-4000-8000-000000000001'
    or saved.timezone <> 'America/New_York'
  then raise exception 'set_coach_profile returned an unexpected row: %', row_to_json(saved); end if;
end $$;

set local "request.jwt.claim.sub" = 'bbbbbbbb-3333-4333-8333-bbbbbbbbbbbb';

do $$
declare saved public.user_coach_profiles;
begin
  saved := public.set_coach_profile(null, 'Europe/London');
  if saved.user_id <> 'bbbbbbbb-3333-4333-8333-bbbbbbbbbbbb'
    or saved.selected_character_id is not null
    or saved.timezone <> 'Europe/London'
  then raise exception 'B''s profile is wrong: %', row_to_json(saved); end if;
  -- RLS: B sees only B's row, even though A's exists.
  if (select count(*) from public.user_coach_profiles) <> 1 then
    raise exception 'B can see another user''s coach profile';
  end if;
end $$;

reset role;
do $$ begin
  if (select row(selected_character_id, timezone)::text from public.user_coach_profiles where user_id='aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa')
    is distinct from row('c1000000-0000-4000-8000-000000000001'::uuid, 'America/New_York'::text)::text
  then raise exception 'B''s call changed A''s coach profile'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Flag ON: which characters may be selected.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claim.sub" = 'aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa';

do $$
declare
  refused uuid;
  state text;
  msg text;
begin
  -- Inactive launch, cancelled pack, trialing pack, inactive owned pack, missing id.
  foreach refused in array array[
    'c1000000-0000-4000-8000-000000000002',
    'c1000000-0000-4000-8000-000000000004',
    'c1000000-0000-4000-8000-000000000005',
    'c1000000-0000-4000-8000-000000000006',
    'c1000000-0000-4000-8000-0000000000ff'
  ]::uuid[] loop
    state := null; msg := null;
    begin
      perform public.set_coach_profile(refused, 'Asia/Tokyo');
    exception when others then get stacked diagnostics state = returned_sqlstate, msg = message_text;
    end;
    if state is distinct from 'P0002' or msg is distinct from 'character not found' then
      raise exception 'character % was not refused with P0002 (got % %)', refused, state, msg;
    end if;
  end loop;

  if (select row(selected_character_id, timezone)::text from public.user_coach_profiles)
    is distinct from row('c1000000-0000-4000-8000-000000000001'::uuid, 'America/New_York'::text)::text
  then raise exception 'a refused character changed the profile'; end if;

  -- An active owned pack.
  if (public.set_coach_profile('c1000000-0000-4000-8000-000000000003', null)).selected_character_id
    <> 'c1000000-0000-4000-8000-000000000003'
  then raise exception 'an owned active pack could not be selected'; end if;
end $$;

-- B does not own A's pack.
set local "request.jwt.claim.sub" = 'bbbbbbbb-3333-4333-8333-bbbbbbbbbbbb';
do $$
declare state text;
begin
  begin
    perform public.set_coach_profile('c1000000-0000-4000-8000-000000000003', null);
  exception when others then get stacked diagnostics state = returned_sqlstate;
  end;
  if state is distinct from 'P0002' then raise exception 'B selected a pack only A owns (got %)', state; end if;
  if (select selected_character_id from public.user_coach_profiles) is not null then
    raise exception 'a refused pack changed B''s profile';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Flag ON: time zones are checked, and null arguments keep stored values.
-- ---------------------------------------------------------------------------

set local "request.jwt.claim.sub" = 'aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa';

do $$
declare
  bad text;
  state text;
  msg text;
  saved public.user_coach_profiles;
begin
  -- The timezone trigger runs before the check constraint, so it refuses all three.
  foreach bad in array array['Not/AZone','FOO-167',''] loop
    state := null; msg := null;
    begin
      perform public.set_coach_profile(null, bad);
    exception when others then get stacked diagnostics state = returned_sqlstate, msg = message_text;
    end;
    if state is distinct from '22023' or msg is distinct from 'invalid time zone' then
      raise exception 'time zone "%" was not refused with 22023 (got % %)', bad, state, msg;
    end if;
  end loop;

  saved := public.set_coach_profile(null, null);
  if saved.selected_character_id <> 'c1000000-0000-4000-8000-000000000003' or saved.timezone <> 'America/New_York' then
    raise exception 'null arguments or a refused time zone changed the profile: %', row_to_json(saved);
  end if;

  saved := public.set_coach_profile(p_timezone => 'Asia/Tokyo');
  if saved.selected_character_id <> 'c1000000-0000-4000-8000-000000000003' or saved.timezone <> 'Asia/Tokyo' then
    raise exception 'saving only the time zone changed the character: %', row_to_json(saved);
  end if;

  saved := public.set_coach_profile(p_character_id => 'c1000000-0000-4000-8000-000000000001');
  if saved.selected_character_id <> 'c1000000-0000-4000-8000-000000000001' or saved.timezone <> 'Asia/Tokyo' then
    raise exception 'saving only the character changed the time zone: %', row_to_json(saved);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Flag ON: rate limited per user.
-- ---------------------------------------------------------------------------

set local "request.jwt.claim.sub" = 'bbbbbbbb-3333-4333-8333-bbbbbbbbbbbb';

do $$
declare
  i integer;
  limited_at integer;
  msg text;
begin
  for i in 1..40 loop
    begin
      perform public.set_coach_profile(null, 'Europe/London');
    exception when others then
      get stacked diagnostics msg = message_text;
      if msg is distinct from 'rate limit exceeded' then raise; end if;
      limited_at := i;
      exit;
    end;
  end loop;
  -- B already made 2 calls above (one saved, one refused), so the limit of 30
  -- a minute is reached within this loop.
  if limited_at is null then raise exception 'set_coach_profile is not rate limited'; end if;
end $$;

reset role;

select extensions.pass('set_coach_profile is flag-gated, own-row only, refuses unselectable characters and bad zones, and keeps null fields');
select * from extensions.finish();

rollback;
