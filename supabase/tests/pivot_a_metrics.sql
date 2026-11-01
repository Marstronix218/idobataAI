begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(1);

-- Pivot A Phase 7 (20261031210000_pivot_a_metrics.sql): content-free product
-- events with their own source ids, the ai_arm on every coach profile, the
-- report functions' math, the spend ledger, and service-role-only grants.
--
-- R1-R4 are report fixtures with fixed past dates (reports run as of
-- 2026-02/03). A exercises the event triggers on far-future dates, so nothing
-- it writes falls inside a report period. Arms by hash (the same values as
-- tests/domain/plan-and-arm.test.ts): R1, R2 ai; R3, R4, A prewritten.

-- Users are created while Pivot A is off, so the sign-up age backstop allows them.
update public.app_feature_flags set enabled=false where key='pivot_a.enabled';

insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1a1a1a1-7777-4777-8777-a1a1a1a1a1a1','authenticated','authenticated','metrics-r1@example.test',crypt('test-password',gen_salt('bf')),now(),'{}','{"username":"metrics_r1"}',now(),now()),
  ('b2b2b2b2-7777-4777-8777-b2b2b2b2b2b2','authenticated','authenticated','metrics-r2@example.test',crypt('test-password',gen_salt('bf')),now(),'{}','{"username":"metrics_r2"}',now(),now()),
  ('d4d4d4d4-7777-4777-8777-d4d4d4d4d4d4','authenticated','authenticated','metrics-r3@example.test',crypt('test-password',gen_salt('bf')),now(),'{}','{"username":"metrics_r3"}',now(),now()),
  ('a7a7a7a7-7777-4777-8777-a7a7a7a7a7a7','authenticated','authenticated','metrics-r4@example.test',crypt('test-password',gen_salt('bf')),now(),'{}','{"username":"metrics_r4"}',now(),now()),
  ('c9c9c9c9-7777-4777-8777-c9c9c9c9c9c9','authenticated','authenticated','metrics-a@example.test',crypt('test-password',gen_salt('bf')),now(),'{}','{"username":"metrics_a"}',now(),now());

insert into public.characters(id, slug, name, role, is_launch, sheet, active)
values ('c7700000-0000-4000-8000-000000000001','metrics-coach','Metrics Coach','coach',true,'{}',true);

-- ---------------------------------------------------------------------------
-- Structure and grants.
-- ---------------------------------------------------------------------------

do $$
declare
  service_only text[] := array[
    'public.record_coach_product_event(uuid,text,text,integer)',
    'public.coach_ai_arm(uuid)',
    'public.report_ai_arm(timestamp with time zone)',
    'public.report_ai_cost(date,date,integer,integer,integer)'
  ];
  internal text[] := array[
    'public.capture_coach_product_event(text,uuid,uuid,timestamp with time zone,text,integer)',
    'public.capture_coach_task_event()',
    'public.capture_coach_reaction_event()',
    'public.capture_coach_chapter_event()',
    'public.capture_coach_entitlement_event()',
    'public.assign_coach_ai_arm()',
    'public.track_ai_spend_daily()'
  ];
  offenders text;
begin
  select string_agg(f, ', ') into offenders from unnest(service_only) f
  where has_function_privilege('anon', f, 'EXECUTE')
     or has_function_privilege('authenticated', f, 'EXECUTE')
     or not has_function_privilege('service_role', f, 'EXECUTE');
  if offenders is not null then raise exception 'not service-role only: %', offenders; end if;

  select string_agg(f, ', ') into offenders from unnest(internal) f
  where has_function_privilege('anon', f, 'EXECUTE')
     or has_function_privilege('authenticated', f, 'EXECUTE')
     or has_function_privilege('service_role', f, 'EXECUTE');
  if offenders is not null then raise exception 'internal functions are executable by a client role: %', offenders; end if;

  if exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
      lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    where n.nspname='public' and acl.grantee=0 and acl.privilege_type='EXECUTE'
      and p.proname in ('record_coach_product_event','coach_ai_arm','report_ai_arm','report_ai_cost',
        'capture_coach_product_event','capture_coach_task_event','capture_coach_reaction_event',
        'capture_coach_chapter_event','capture_coach_entitlement_event','assign_coach_ai_arm','track_ai_spend_daily')
  ) then raise exception 'PUBLIC can execute a Phase 7 function'; end if;

  select string_agg(p.proname, ', ') into offenders
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('record_coach_product_event','report_ai_arm','report_ai_cost')
    and (not p.prosecdef or not p.proconfig @> array['search_path=""']);
  if offenders is not null then raise exception 'must be security definer with an empty search_path: %', offenders; end if;

  -- The spend ledger: RLS on, no client access, service role reads.
  if not (select relrowsecurity from pg_class where oid='public.ai_spend_daily'::regclass) then
    raise exception 'RLS is off on ai_spend_daily';
  end if;
  if has_table_privilege('anon','public.ai_spend_daily','SELECT') or has_table_privilege('authenticated','public.ai_spend_daily','SELECT')
    or has_table_privilege('authenticated','public.ai_spend_daily','INSERT') or has_table_privilege('authenticated','public.ai_spend_daily','UPDATE')
  then raise exception 'clients can reach ai_spend_daily'; end if;
  if not has_table_privilege('service_role','public.ai_spend_daily','SELECT') then
    raise exception 'the service role cannot read ai_spend_daily';
  end if;

  -- Events stay server-only.
  if has_table_privilege('authenticated','public.beta_product_events','SELECT') or has_table_privilege('anon','public.beta_product_events','SELECT') then
    raise exception 'clients can read beta_product_events';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- beta_full_access.enabled: its row alone, off when absent, whatever Pivot A says.
-- ---------------------------------------------------------------------------

do $$
declare scenario record;
begin
  if exists(select 1 from public.app_feature_flags where key='beta_full_access.enabled') then
    raise exception 'beta_full_access.enabled must not be seeded';
  end if;
  for scenario in
    select * from (values
      ('false','absent',false), ('false','true',true), ('false','false',false),
      ('true','absent',false),  ('true','true',true),  ('true','false',false)
    ) as s(pivot_row, beta_row, expected)
  loop
    update public.app_feature_flags set enabled = scenario.pivot_row::boolean where key='pivot_a.enabled';
    delete from public.app_feature_flags where key='beta_full_access.enabled';
    if scenario.beta_row <> 'absent' then
      insert into public.app_feature_flags(key, enabled) values ('beta_full_access.enabled', scenario.beta_row::boolean);
    end if;
    if public.pivot_flag_enabled('beta_full_access.enabled') is distinct from scenario.expected then
      raise exception 'beta_full_access.enabled with pivot % and row % should be %', scenario.pivot_row, scenario.beta_row, scenario.expected;
    end if;
    -- It changes no other flag.
    if public.pivot_flag_enabled('persona_chat.enabled') is distinct from not scenario.pivot_row::boolean then
      raise exception 'beta_full_access.enabled changed persona_chat.enabled';
    end if;
  end loop;
  delete from public.app_feature_flags where key='beta_full_access.enabled';
  update public.app_feature_flags set enabled=false where key='pivot_a.enabled';
end $$;

-- ---------------------------------------------------------------------------
-- The arm: the SQL hash equals assignAiArm(), and every new profile gets one.
-- ---------------------------------------------------------------------------

do $$
declare
  expected constant jsonb := '{
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa": "ai",
    "00000000-0000-4000-8000-000000000001": "prewritten",
    "a1a1a1a1-7777-4777-8777-a1a1a1a1a1a1": "ai",
    "d4d4d4d4-7777-4777-8777-d4d4d4d4d4d4": "prewritten",
    "a7a7a7a7-7777-4777-8777-a7a7a7a7a7a7": "prewritten",
    "b8b8b8b8-7777-4777-8777-b8b8b8b8b8b8": "ai"
  }';
  item record;
begin
  for item in select key, value #>> '{}' as arm from jsonb_each(expected) loop
    if public.coach_ai_arm(item.key::uuid) <> item.arm then
      raise exception 'coach_ai_arm(%) is %, assignAiArm says %', item.key, public.coach_ai_arm(item.key::uuid), item.arm;
    end if;
  end loop;
end $$;

-- Report fixtures. Day 0 is each profile's local creation date:
-- R1 UTC 2026-01-01, R2 Los Angeles 2026-02-19 (created 06:00 UTC on the 20th),
-- R3 New York 2026-01-09 (03:00 UTC on the 10th), R4 Tokyo 2026-01-05.
insert into public.user_coach_profiles(user_id, timezone, created_at)
values
  ('a1a1a1a1-7777-4777-8777-a1a1a1a1a1a1','UTC','2026-01-01 10:00:00+00'),
  ('b2b2b2b2-7777-4777-8777-b2b2b2b2b2b2','America/Los_Angeles','2026-02-20 06:00:00+00'),
  ('d4d4d4d4-7777-4777-8777-d4d4d4d4d4d4','America/New_York','2026-01-10 03:00:00+00'),
  ('a7a7a7a7-7777-4777-8777-a7a7a7a7a7a7','Asia/Tokyo','2026-01-05 00:00:00+00');
-- A stored arm is kept even when the hash disagrees (A hashes to prewritten).
insert into public.user_coach_profiles(user_id, selected_character_id, timezone, ai_arm, age_verified_at, age_verification_method)
values ('c9c9c9c9-7777-4777-8777-c9c9c9c9c9c9','c7700000-0000-4000-8000-000000000001','America/Los_Angeles','ai',now(),'self_attested');

do $$ begin
  if (select string_agg(ai_arm, ',' order by created_at) from public.user_coach_profiles
      where user_id in ('a1a1a1a1-7777-4777-8777-a1a1a1a1a1a1','b2b2b2b2-7777-4777-8777-b2b2b2b2b2b2',
        'd4d4d4d4-7777-4777-8777-d4d4d4d4d4d4','a7a7a7a7-7777-4777-8777-a7a7a7a7a7a7'))
    is distinct from 'ai,prewritten,prewritten,ai'
  then raise exception 'new profiles did not get their hashed arm'; end if;
  if (select ai_arm from public.user_coach_profiles where user_id='c9c9c9c9-7777-4777-8777-c9c9c9c9c9c9') <> 'ai' then
    raise exception 'an explicitly stored arm was overwritten';
  end if;
end $$;
-- Clearing an arm assigns the hashed one again.
update public.user_coach_profiles set ai_arm = null where user_id='c9c9c9c9-7777-4777-8777-c9c9c9c9c9c9';
do $$ begin
  if (select ai_arm from public.user_coach_profiles where user_id='c9c9c9c9-7777-4777-8777-c9c9c9c9c9c9') <> 'prewritten' then
    raise exception 'a cleared arm was not reassigned from the hash';
  end if;
end $$;

-- Tasks and finished events (local dates). R1: 6 finishes, one on day 15.
-- R2: 2 finishes. R3: none. R4: day 21 and day 33.
insert into public.tasks(id, owner_id, title, visibility, status)
values
  ('a1a1a1a1-2222-4000-8000-000000000001','a1a1a1a1-7777-4777-8777-a1a1a1a1a1a1','R1 daily','private','pending'),
  ('b2b2b2b2-2222-4000-8000-000000000001','b2b2b2b2-7777-4777-8777-b2b2b2b2b2b2','R2 daily','private','pending'),
  ('a7a7a7a7-2222-4000-8000-000000000001','a7a7a7a7-7777-4777-8777-a7a7a7a7a7a7','R4 daily','private','pending');

insert into public.task_events(user_id, task_id, type, occurred_at, local_date, occurrence_key)
select 'a1a1a1a1-7777-4777-8777-a1a1a1a1a1a1','a1a1a1a1-2222-4000-8000-000000000001','finished', (d || ' 12:00:00+00')::timestamptz, d::date, d
from unnest(array['2026-01-02','2026-01-03','2026-01-16','2026-01-20','2026-02-01','2026-02-12']) d;
insert into public.task_events(user_id, task_id, type, occurred_at, local_date, occurrence_key)
values
  ('b2b2b2b2-7777-4777-8777-b2b2b2b2b2b2','b2b2b2b2-2222-4000-8000-000000000001','finished','2026-02-20 20:00:00+00','2026-02-20','2026-02-20'),
  ('b2b2b2b2-7777-4777-8777-b2b2b2b2b2b2','b2b2b2b2-2222-4000-8000-000000000001','finished','2026-02-25 20:00:00+00','2026-02-25','2026-02-25'),
  ('a7a7a7a7-7777-4777-8777-a7a7a7a7a7a7','a7a7a7a7-2222-4000-8000-000000000001','finished','2026-01-26 03:00:00+00','2026-01-26','2026-01-26'),
  ('a7a7a7a7-7777-4777-8777-a7a7a7a7a7a7','a7a7a7a7-2222-4000-8000-000000000001','finished','2026-02-07 03:00:00+00','2026-02-07','2026-02-07');

-- App sessions. R3's is 03:00 UTC on 01-30 (local day 21 in UTC) but 22:00 on
-- 01-29 in New York, its day 20: retained. R4's is 16:00 UTC on 01-25 (day 20
-- in UTC) but 01:00 on 01-26 in Tokyo, its day 21: not retained.
insert into public.beta_product_events(event_name, user_id, event_date, activity_bucket, occurred_at)
values
  ('session_active','d4d4d4d4-7777-4777-8777-d4d4d4d4d4d4','2026-01-30','2026-01-30 03:00:00+00','2026-01-30 03:00:00+00'),
  ('session_active','a7a7a7a7-7777-4777-8777-a7a7a7a7a7a7','2026-01-25','2026-01-25 16:00:00+00','2026-01-25 16:00:00+00');

-- AI usage (local dates). R1: 2 reactions on 01-30 and 1 on 02-02, so its
-- rolling 7 days reach the free cap of 3 inside February. R2: 12 reactions and
-- 10 splits on 02-05. R3: 1 reaction on 02-10, and a costly day after the
-- report's as-of date.
insert into public.ai_usage_daily(user_id, date, reactions, splits, est_cost_usd)
values
  ('a1a1a1a1-7777-4777-8777-a1a1a1a1a1a1','2026-01-30',2,0,0.500000),
  ('a1a1a1a1-7777-4777-8777-a1a1a1a1a1a1','2026-02-02',1,0,0.010000),
  ('b2b2b2b2-7777-4777-8777-b2b2b2b2b2b2','2026-02-05',12,10,0.200000),
  ('d4d4d4d4-7777-4777-8777-d4d4d4d4d4d4','2026-02-10',1,0,0.002000),
  ('d4d4d4d4-7777-4777-8777-d4d4d4d4d4d4','2026-02-20',3,0,1.000000);

-- ---------------------------------------------------------------------------
-- report_ai_cost with no paying users: the per-paying figures are null.
-- In February up to the 14th: cost 0.01 + 0.2 + 0.002 = 0.212; active users
-- R1, R2, R3 (usage) and R4 (a finish on 02-07). With nobody paying, R2 is on
-- the free cap and reaches it too.
-- ---------------------------------------------------------------------------

set local role service_role;
do $$
declare r record;
begin
  select * into strict r from public.report_ai_cost('2026-02-20', '2026-02-14');
  if r.month <> '2026-02-01' or r.as_of <> '2026-02-14' or r.days_elapsed <> 14 or r.days_in_month <> 28 then
    raise exception 'period: % % % %', r.month, r.as_of, r.days_elapsed, r.days_in_month;
  end if;
  if r.total_cost_usd <> 0.212 or r.active_users <> 4 or r.paying_users <> 0 then
    raise exception 'totals: cost % active % paying %', r.total_cost_usd, r.active_users, r.paying_users;
  end if;
  if r.cost_per_paying_user_usd is not null or r.projected_cost_per_paying_user_usd is not null then
    raise exception 'per paying user should be null with no paying users: % %', r.cost_per_paying_user_usd, r.projected_cost_per_paying_user_usd;
  end if;
  if r.cost_per_active_user_usd <> 0.053 then raise exception 'cost per active user %', r.cost_per_active_user_usd; end if;
  -- The free-beta basis: the 30 local days to 02-14 (from 01-16) also hold
  -- R1's 01-30 cost: 0.712 over R1-R4.
  if r.active_users_30d <> 4 or r.cost_per_active_user_30d_usd <> 0.178 then
    raise exception 'active user 30-day basis: % %', r.active_users_30d, r.cost_per_active_user_30d_usd;
  end if;
  if r.users_at_reaction_cap <> 2 or r.users_at_split_cap <> 1 or r.share_at_reaction_cap <> 0.5 or r.share_at_split_cap <> 0.25 then
    raise exception 'caps: % % % %', r.users_at_reaction_cap, r.users_at_split_cap, r.share_at_reaction_cap, r.share_at_split_cap;
  end if;
end $$;
reset role;

-- R2 subscribes to Plus; R3 buys a pack (paying, still on the free tier).
insert into public.entitlements(user_id, product, status, source)
values
  ('b2b2b2b2-7777-4777-8777-b2b2b2b2b2b2','plus','active','stripe'),
  ('d4d4d4d4-7777-4777-8777-d4d4d4d4d4d4','pack:metrics-coach','active','app_store');

set local role service_role;
do $$
declare r record;
begin
  -- 0.212 / 2 paying users, projected over 28 days from 14. R2 is now on the
  -- plus daily cap of 30, which 12 does not reach.
  select * into strict r from public.report_ai_cost('2026-02-01', '2026-02-14');
  if r.paying_users <> 2 or r.cost_per_paying_user_usd <> 0.106 or r.projected_cost_per_paying_user_usd <> 0.212 then
    raise exception 'paying: % % %', r.paying_users, r.cost_per_paying_user_usd, r.projected_cost_per_paying_user_usd;
  end if;
  if r.users_at_reaction_cap <> 1 or r.share_at_reaction_cap <> 0.25 or r.users_at_split_cap <> 1 then
    raise exception 'caps with plus: % % %', r.users_at_reaction_cap, r.share_at_reaction_cap, r.users_at_split_cap;
  end if;

  -- The caps are parameters: a plus daily cap of 12 puts R2 at it.
  select * into strict r from public.report_ai_cost('2026-02-01', '2026-02-14', 12, 10, 3);
  if r.users_at_reaction_cap <> 2 then raise exception 'configured cap ignored: %', r.users_at_reaction_cap; end if;

  -- An as-of past the month's end is the whole month: nothing to project.
  select * into strict r from public.report_ai_cost('2026-02-10', '2026-03-05');
  if r.as_of <> '2026-02-28' or r.days_elapsed <> 28 or r.total_cost_usd <> 1.212
    or r.cost_per_paying_user_usd <> 0.606 or r.projected_cost_per_paying_user_usd <> 0.606
  then raise exception 'full month: % % % % %', r.as_of, r.days_elapsed, r.total_cost_usd, r.cost_per_paying_user_usd, r.projected_cost_per_paying_user_usd; end if;
  -- 30 days to 02-28 start on 01-30: 0.5 + 0.01 + 0.2 + 0.002 + 1.0 over 4 users.
  if r.cost_per_active_user_30d_usd <> 0.428 then raise exception 'full month 30-day basis: %', r.cost_per_active_user_30d_usd; end if;

  -- A month with no data at all.
  select * into strict r from public.report_ai_cost('2025-06-01', '2025-06-30');
  if r.total_cost_usd <> 0 or r.active_users <> 0 or r.cost_per_active_user_usd is not null or r.share_at_reaction_cap is not null
    or r.active_users_30d <> 0 or r.cost_per_active_user_30d_usd is not null
  then
    raise exception 'empty month: % % % %', r.total_cost_usd, r.active_users, r.cost_per_active_user_usd, r.share_at_reaction_cap;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- report_ai_arm as of 2026-03-01 12:00 UTC (A's profile is newer: excluded).
-- R1: 6 finishes x 7 / 60 days = 0.70 a week; day 15 finish: retained.
-- R2 (plus): 2 x 7 / 11 days = 1.27; days 14-20 not over yet: not eligible.
-- R3: 0; retained by its New York day-20 session.
-- R4: 2 x 7 / 56 days = 0.25; day 21 finish and Tokyo day-21 session: not retained.
-- ---------------------------------------------------------------------------

do $$
declare got text;
begin
  select string_agg(format('%s/%s:%s,%s,%s,%s,%s,%s', r.arm, r.plan_tier, r.users, r.tasks_finished,
      r.tasks_finished_per_user_week, r.day14_eligible_users, r.day14_retained_users,
      coalesce(r.day14_retention::text, 'null')), ' | ' order by r.ord)
    into got
  from public.report_ai_arm('2026-03-01 12:00:00+00') with ordinality
    as r(arm, plan_tier, users, tasks_finished, tasks_finished_per_user_week, day14_eligible_users, day14_retained_users, day14_retention, ord);
  if got is distinct from
    'ai/all:2,8,0.99,1,1,1.0000 | ai/free:1,6,0.70,1,1,1.0000 | ai/plus:1,2,1.27,0,0,null'
    || ' | prewritten/all:2,2,0.13,2,1,0.5000 | prewritten/free:2,2,0.13,2,1,0.5000'
  then raise exception 'report_ai_arm: %', got; end if;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Trials do not pay but have the Plus caps; the free beta gives everyone the
-- Plus caps. R4 starts a trial and uses 5 AI reactions on 02-03: at the free
-- weekly cap of 3 it would count, at the Plus daily cap of 30 it does not.
-- ---------------------------------------------------------------------------

insert into public.entitlements(user_id, product, status, source, trial_ends_at)
values ('a7a7a7a7-7777-4777-8777-a7a7a7a7a7a7','plus','trialing','app_store',now() + interval '7 days');
insert into public.ai_usage_daily(user_id, date, reactions, splits, est_cost_usd)
values ('a7a7a7a7-7777-4777-8777-a7a7a7a7a7a7','2026-02-03',5,0,0);

set local role service_role;
do $$
declare r record;
begin
  select * into strict r from public.report_ai_cost('2026-02-01', '2026-02-14');
  -- Paying: R2 (plus) and R3 (pack); R4's trial is not paying.
  if r.paying_users <> 2 or r.cost_per_paying_user_usd <> 0.106 then
    raise exception 'a trial counted as paying: % %', r.paying_users, r.cost_per_paying_user_usd;
  end if;
  -- At the reaction cap: R1 only (free, 3 in 7 days); R2 (plus) and R4 (trial) are on the daily cap of 30.
  if r.users_at_reaction_cap <> 1 or r.users_at_split_cap <> 1 or r.beta_full_access then
    raise exception 'caps with a trial: % % %', r.users_at_reaction_cap, r.users_at_split_cap, r.beta_full_access;
  end if;
end $$;
reset role;

-- Beta full access on (with Pivot A): everyone is judged against the Plus caps.
update public.app_feature_flags set enabled=true where key='pivot_a.enabled';
insert into public.app_feature_flags(key, enabled) values ('beta_full_access.enabled', true);
set local role service_role;
do $$
declare r record;
begin
  select * into strict r from public.report_ai_cost('2026-02-01', '2026-02-14');
  if not r.beta_full_access or r.users_at_reaction_cap <> 0 or r.share_at_reaction_cap <> 0
    or r.users_at_split_cap <> 1 or r.share_at_split_cap <> 0.25
  then raise exception 'beta caps: % % % % %', r.beta_full_access, r.users_at_reaction_cap, r.share_at_reaction_cap, r.users_at_split_cap, r.share_at_split_cap; end if;
  -- Beta access is not payment.
  if r.paying_users <> 2 then raise exception 'beta changed paying users: %', r.paying_users; end if;
end $$;
reset role;
-- Beta full access without Pivot A has no effect: R1 is on the free cap again.
update public.app_feature_flags set enabled=false where key='pivot_a.enabled';
set local role service_role;
do $$
declare r record;
begin
  select * into strict r from public.report_ai_cost('2026-02-01', '2026-02-14');
  if r.beta_full_access or r.users_at_reaction_cap <> 1 then
    raise exception 'beta without Pivot A: % %', r.beta_full_access, r.users_at_reaction_cap;
  end if;
end $$;
reset role;
delete from public.app_feature_flags where key='beta_full_access.enabled';

-- ---------------------------------------------------------------------------
-- Event triggers (Pivot A on), on A's far-future dates.
-- ---------------------------------------------------------------------------

update public.app_feature_flags set enabled=true where key='pivot_a.enabled';

insert into public.tasks(id, owner_id, title, visibility, status, recurrence_rule, due_at, due_has_time, due_timezone)
values ('c9c9c9c9-2222-4000-8000-000000000001','c9c9c9c9-7777-4777-8777-c9c9c9c9c9c9','Water the plants','private','pending',
  'daily','2099-03-03 20:00:00+00',true,'America/Los_Angeles');
insert into public.tasks(id, owner_id, title, visibility, status)
values
  ('c9c9c9c9-2222-4000-8000-000000000002','c9c9c9c9-7777-4777-8777-c9c9c9c9c9c9','Call the dentist','private','pending'),
  ('c9c9c9c9-2222-4000-8000-000000000003','c9c9c9c9-7777-4777-8777-c9c9c9c9c9c9','Sort the mail','private','pending');

-- A daily task finished on two local days: two finished events, so two
-- task_finished events. The legacy task_completed keeps one per task.
update public.tasks set status='completed', completed_at='2099-03-03 18:00:00+00' where id='c9c9c9c9-2222-4000-8000-000000000001';
update public.tasks set status='pending' where id='c9c9c9c9-2222-4000-8000-000000000001';
update public.tasks set status='completed', completed_at='2099-03-04 18:00:00+00' where id='c9c9c9c9-2222-4000-8000-000000000001';

insert into public.task_events(id, user_id, task_id, type, occurred_at, local_date)
values ('c9c9c9c9-3333-4000-8000-000000000001','c9c9c9c9-7777-4777-8777-c9c9c9c9c9c9','c9c9c9c9-2222-4000-8000-000000000002','started','2099-03-05 18:00:00+00','2099-03-05');

do $$ begin
  if (select array_agg(source_id order by source_id) from public.beta_product_events
      where event_name='task_finished' and user_id='c9c9c9c9-7777-4777-8777-c9c9c9c9c9c9')
    is distinct from (select array_agg(id order by id) from public.task_events
      where task_id='c9c9c9c9-2222-4000-8000-000000000001' and type='finished')
    or (select count(*) from public.task_events where task_id='c9c9c9c9-2222-4000-8000-000000000001' and type='finished') <> 2
  then raise exception 'a recurring task finished twice did not record one task_finished per finished event'; end if;
  if (select count(*) from public.beta_product_events where event_name='task_completed' and source_id='c9c9c9c9-2222-4000-8000-000000000001') <> 1 then
    raise exception 'the legacy task_completed event changed';
  end if;
  if not exists(select 1 from public.beta_product_events where event_name='task_started'
      and source_id='c9c9c9c9-3333-4000-8000-000000000001' and occurred_at='2099-03-05 18:00:00+00' and detail is null) then
    raise exception 'task_started missing for the started event';
  end if;
end $$;

-- reaction_shown for a task reaction, with its source; nothing for a nudge.
insert into public.character_reactions(id, user_id, task_event_id, character_id, event, source, text)
values
  ('c9c9c9c9-4444-4000-8000-000000000001','c9c9c9c9-7777-4777-8777-c9c9c9c9c9c9','c9c9c9c9-3333-4000-8000-000000000001',
    'c7700000-0000-4000-8000-000000000001','task_started','ai','Call the dentist now, then stretch.'),
  ('c9c9c9c9-4444-4000-8000-000000000002','c9c9c9c9-7777-4777-8777-c9c9c9c9c9c9',null,
    'c7700000-0000-4000-8000-000000000001','session_nudge','prewritten','Time to close the app.');

do $$ begin
  if (select count(*) from public.beta_product_events where event_name='reaction_shown' and user_id='c9c9c9c9-7777-4777-8777-c9c9c9c9c9c9') <> 1
    or not exists(select 1 from public.beta_product_events where event_name='reaction_shown'
      and source_id='c9c9c9c9-4444-4000-8000-000000000001' and detail='ai')
  then raise exception 'reaction_shown should be one event for the task reaction, with source ai, and none for the nudge'; end if;
end $$;

-- chapter_unlocked: one per newly covered chapter, never twice.
update public.story_progress set unlocked_through = 2
where user_id='c9c9c9c9-7777-4777-8777-c9c9c9c9c9c9' and character_id='c7700000-0000-4000-8000-000000000001';
update public.story_progress set unlocked_through = 2
where user_id='c9c9c9c9-7777-4777-8777-c9c9c9c9c9c9' and character_id='c7700000-0000-4000-8000-000000000001';
update public.story_progress set unlocked_through = 3
where user_id='c9c9c9c9-7777-4777-8777-c9c9c9c9c9c9' and character_id='c7700000-0000-4000-8000-000000000001';

do $$ begin
  if (select count(distinct source_id) from public.beta_product_events
      where event_name='chapter_unlocked' and user_id='c9c9c9c9-7777-4777-8777-c9c9c9c9c9c9') <> 3
    or (select count(*) from public.beta_product_events
      where event_name='chapter_unlocked' and user_id='c9c9c9c9-7777-4777-8777-c9c9c9c9c9c9') <> 3
  then raise exception 'expected three chapter_unlocked events for chapters 1-3'; end if;
end $$;

-- trial_started and purchase from entitlement rows, whatever the source: the
-- trial converting is the purchase; a renewal (no status change) and a
-- past_due recovery add nothing.
insert into public.entitlements(id, user_id, product, status, source, trial_ends_at)
values ('c9c9c9c9-5555-4000-8000-000000000001','c9c9c9c9-7777-4777-8777-c9c9c9c9c9c9','plus','trialing','stripe','2099-03-15 00:00:00+00');
update public.entitlements set status='active', current_period_end='2099-04-15 00:00:00+00' where id='c9c9c9c9-5555-4000-8000-000000000001';
update public.entitlements set current_period_end='2099-05-15 00:00:00+00' where id='c9c9c9c9-5555-4000-8000-000000000001';
update public.entitlements set status='past_due' where id='c9c9c9c9-5555-4000-8000-000000000001';
update public.entitlements set status='active' where id='c9c9c9c9-5555-4000-8000-000000000001';
insert into public.entitlements(user_id, product, status, source)
values ('c9c9c9c9-7777-4777-8777-c9c9c9c9c9c9','pack:metrics-coach','active','app_store');

do $$ begin
  if (select count(*) from public.beta_product_events where event_name='trial_started' and user_id='c9c9c9c9-7777-4777-8777-c9c9c9c9c9c9') <> 1
    or not exists(select 1 from public.beta_product_events where event_name='trial_started'
      and source_id='c9c9c9c9-5555-4000-8000-000000000001' and detail='plus')
  then raise exception 'trial_started should be one event for the trialing row'; end if;
  if (select string_agg(detail, ',' order by detail) from public.beta_product_events
      where event_name='purchase' and user_id='c9c9c9c9-7777-4777-8777-c9c9c9c9c9c9')
    is distinct from 'pack,plus'
    or not exists(select 1 from public.beta_product_events where event_name='purchase'
      and source_id='c9c9c9c9-5555-4000-8000-000000000001' and detail='plus')
  then raise exception 'purchase should be one event for the converted trial and one for the pack'; end if;
end $$;

-- A failing event write never breaks the write it describes.
alter table public.beta_product_events add constraint metrics_test_reject_task_started check (event_name <> 'task_started') not valid;
insert into public.task_events(id, user_id, task_id, type, occurred_at, local_date)
values ('c9c9c9c9-3333-4000-8000-000000000002','c9c9c9c9-7777-4777-8777-c9c9c9c9c9c9','c9c9c9c9-2222-4000-8000-000000000003','started','2099-03-06 18:00:00+00','2099-03-06');
alter table public.beta_product_events drop constraint metrics_test_reject_task_started;
do $$ begin
  if not exists(select 1 from public.task_events where id='c9c9c9c9-3333-4000-8000-000000000002') then
    raise exception 'a failing event write broke the task event insert';
  end if;
  if exists(select 1 from public.beta_product_events where source_id='c9c9c9c9-3333-4000-8000-000000000002') then
    raise exception 'the rejected event was written anyway';
  end if;
end $$;

-- Content-free: free text cannot go into detail, and no row carries a task
-- title or reaction text.
do $$
declare state text;
begin
  begin
    insert into public.beta_product_events(event_name, user_id, source_id, event_date, detail)
    values ('reaction_shown','c9c9c9c9-7777-4777-8777-c9c9c9c9c9c9',gen_random_uuid(),'2099-03-07','Water the plants');
  exception when others then get stacked diagnostics state = returned_sqlstate;
  end;
  if state is distinct from '23514' then raise exception 'free text in detail was not rejected (%)', state; end if;

  if exists(
    select 1 from public.beta_product_events event
    where event.user_id='c9c9c9c9-7777-4777-8777-c9c9c9c9c9c9'
      and to_jsonb(event)::text ~* '(water|plants|dentist|stretch|close the app|mail)'
  ) then raise exception 'an event row carries task or reaction text'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- record_coach_product_event (service role): split_used, paywall_viewed,
-- session_length; nothing else.
-- ---------------------------------------------------------------------------

set local role service_role;
do $$
declare state text; got int[];
begin
  perform public.record_coach_product_event('c9c9c9c9-7777-4777-8777-c9c9c9c9c9c9', 'split_used');
  perform public.record_coach_product_event('c9c9c9c9-7777-4777-8777-c9c9c9c9c9c9', 'split_used');
  if (select count(distinct source_id) from public.beta_product_events
      where event_name='split_used' and user_id='c9c9c9c9-7777-4777-8777-c9c9c9c9c9c9') <> 2
  then raise exception 'each split should be its own split_used event'; end if;

  perform public.record_coach_product_event('c9c9c9c9-7777-4777-8777-c9c9c9c9c9c9', 'paywall_viewed', 'split');
  perform public.record_coach_product_event('c9c9c9c9-7777-4777-8777-c9c9c9c9c9c9', 'paywall_viewed', 'split');
  perform public.record_coach_product_event('c9c9c9c9-7777-4777-8777-c9c9c9c9c9c9', 'paywall_viewed', 'story');
  if (select string_agg(detail, ',' order by detail) from public.beta_product_events
      where event_name='paywall_viewed' and user_id='c9c9c9c9-7777-4777-8777-c9c9c9c9c9c9') is distinct from 'split,story'
  then raise exception 'paywall_viewed should be once per local day and surface'; end if;

  begin
    perform public.record_coach_product_event('c9c9c9c9-7777-4777-8777-c9c9c9c9c9c9', 'paywall_viewed', 'banner');
  exception when others then get stacked diagnostics state = returned_sqlstate;
  end;
  if state is distinct from '22023' then raise exception 'an unknown paywall surface was accepted (%)', state; end if;
  state := null;
  begin
    perform public.record_coach_product_event('c9c9c9c9-7777-4777-8777-c9c9c9c9c9c9', 'task_finished');
  exception when others then get stacked diagnostics state = returned_sqlstate;
  end;
  if state is distinct from '22023' then raise exception 'the writer accepted a trigger-owned event name (%)', state; end if;

  -- One session: 120 s, then 60 s right after; 0 and negatives record nothing.
  perform public.record_coach_product_event('c9c9c9c9-7777-4777-8777-c9c9c9c9c9c9', 'session_length', null, 120);
  perform public.record_coach_product_event('c9c9c9c9-7777-4777-8777-c9c9c9c9c9c9', 'session_length', null, 60);
  perform public.record_coach_product_event('c9c9c9c9-7777-4777-8777-c9c9c9c9c9c9', 'session_length', null, 0);
  perform public.record_coach_product_event('c9c9c9c9-7777-4777-8777-c9c9c9c9c9c9', 'session_length', null, -5);
  select array_agg(duration_seconds order by occurred_at) into got from public.beta_product_events
  where event_name='session_length' and user_id='c9c9c9c9-7777-4777-8777-c9c9c9c9c9c9';
  if got is distinct from array[180] then raise exception 'one session of 120 + 60 s, got %', got; end if;
end $$;
reset role;

-- A session that began on an earlier UTC date and is extended now is dated
-- with its occurred_at, today.
update public.beta_product_events set event_date = '2026-01-01'
where event_name='session_length' and user_id='c9c9c9c9-7777-4777-8777-c9c9c9c9c9c9';
set local role service_role;
do $$
declare got record;
begin
  perform public.record_coach_product_event('c9c9c9c9-7777-4777-8777-c9c9c9c9c9c9', 'session_length', null, 10);
  select count(*) as sessions, max(duration_seconds) as duration, bool_and(event_date = (occurred_at at time zone 'UTC')::date) as dated
    into got
  from public.beta_product_events
  where event_name='session_length' and user_id='c9c9c9c9-7777-4777-8777-c9c9c9c9c9c9';
  if got.sessions <> 1 or got.duration <> 190 or not got.dated then
    raise exception 'merged session: % rows, % s, event_date follows occurred_at: %', got.sessions, got.duration, got.dated;
  end if;
end $$;
reset role;

-- 2 hours later (the last stretch ended long ago): a new session; a huge value is clamped.
update public.beta_product_events set occurred_at = occurred_at - interval '2 hours'
where event_name='session_length' and user_id='c9c9c9c9-7777-4777-8777-c9c9c9c9c9c9';
set local role service_role;
do $$
declare got int[];
begin
  perform public.record_coach_product_event('c9c9c9c9-7777-4777-8777-c9c9c9c9c9c9', 'session_length', null, 30);
  perform public.record_coach_product_event('c9c9c9c9-7777-4777-8777-c9c9c9c9c9c9', 'session_length', null, 100000);
  select array_agg(duration_seconds order by occurred_at) into got from public.beta_product_events
  where event_name='session_length' and user_id='c9c9c9c9-7777-4777-8777-c9c9c9c9c9c9';
  if got is distinct from array[190, 86400] then raise exception 'expected a new session clamped to 86400, got %', got; end if;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- ai_spend_daily books every metered cost on today's UTC date; reserving a
-- slot (no cost) books nothing.
-- ---------------------------------------------------------------------------

do $$
declare before numeric; after numeric;
begin
  before := coalesce((select est_cost_usd from public.ai_spend_daily where date = (now() at time zone 'UTC')::date), 0);
  perform public.record_ai_usage('c9c9c9c9-7777-4777-8777-c9c9c9c9c9c9', '2099-03-04', 0, 0, 1, 0, 100, 10, 0, 0, 0.5);
  perform public.record_ai_usage('c9c9c9c9-7777-4777-8777-c9c9c9c9c9c9', '2099-03-04', 0, 0, 0, 0, 50, 5, 0, 0, 0.25);
  perform public.reserve_ai_usage('c9c9c9c9-7777-4777-8777-c9c9c9c9c9c9', 'reaction', '2099-03-04', 1, 30, 60);
  after := (select est_cost_usd from public.ai_spend_daily where date = (now() at time zone 'UTC')::date);
  if after is distinct from before + 0.75 then raise exception 'ai_spend_daily went from % to %, expected +0.75', before, after; end if;
end $$;

select extensions.pass('Phase 7 events are content-free with unique source ids, every profile has an arm, the reports add up, and only the service role can run them');
select * from extensions.finish();

rollback;
