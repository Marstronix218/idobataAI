begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(1);

-- Fixtures: two users. A has a coach profile in Los Angeles (UTC-8 in January)
-- with a selected character; B starts without one.
insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa','authenticated','authenticated','pivot-a@example.test',crypt('test-password',gen_salt('bf')),now(),'{}','{"username":"pivot_a"}',now(),now()),
  ('bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb','authenticated','authenticated','pivot-b@example.test',crypt('test-password',gen_salt('bf')),now(),'{}','{"username":"pivot_b"}',now(),now());

insert into public.characters(id, slug, name, role, is_launch, sheet, active)
values
  ('c0000000-0000-4000-8000-000000000001','test-coach','Test Coach','coach',true,'{"voice":"warm"}',true),
  ('c0000000-0000-4000-8000-000000000002','retired-rival','Retired Rival','rival',false,'{}',false);

insert into public.character_lines(id, character_id, event, text, min_streak, max_streak, task_age_bucket)
values
  ('test-coach.task_started.001','c0000000-0000-4000-8000-000000000001','task_started','Off you go.',null,null,null),
  ('test-coach.task_finished.001','c0000000-0000-4000-8000-000000000001','task_finished','Done. Next one, or rest.',0,3,'fresh');

insert into public.story_chapters(character_id, number, title, body)
values ('c0000000-0000-4000-8000-000000000001',1,'Chapter one','Placeholder chapter body.');

-- A's age is verified, which start_task requires (20261031190000).
insert into public.user_coach_profiles(user_id, selected_character_id, timezone, age_verified_at, age_verification_method)
values ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa','c0000000-0000-4000-8000-000000000001','America/Los_Angeles',now(),'self_attested');

insert into public.tasks(id, owner_id, title, visibility, status)
values
  ('aaaaaaaa-2222-4000-8000-000000000001','aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa','A: start me','private','pending'),
  ('aaaaaaaa-2222-4000-8000-000000000002','aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa','A: finish with flag off','private','pending'),
  ('aaaaaaaa-2222-4000-8000-000000000003','aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa','A: finish late evening','private','pending'),
  ('aaaaaaaa-2222-4000-8000-000000000004','aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa','A: finish same local day','private','pending'),
  ('aaaaaaaa-2222-4000-8000-000000000006','aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa','A: finish through the API','private','pending'),
  ('bbbbbbbb-2222-4000-8000-000000000001','bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb','B: not yours','private','pending'),
  ('bbbbbbbb-2222-4000-8000-000000000002','bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb','B: finish without a profile','private','pending'),
  ('bbbbbbbb-2222-4000-8000-000000000003','bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb','B: finish while the trigger fails','private','pending');

-- ---------------------------------------------------------------------------
-- Structure: RLS on every new table, no anonymous access, read-only clients.
-- ---------------------------------------------------------------------------

do $$
declare
  all_tables text[] := array[
    'characters','character_lines','story_chapters','user_coach_profiles','task_events',
    'character_reactions','ai_usage_daily','story_progress','entitlements','safety_counters'
  ];
  readable text[] := array[
    'characters','user_coach_profiles','task_events','character_reactions',
    'ai_usage_daily','story_progress','entitlements'
  ];
  offenders text;
begin
  select string_agg(expected, ', ') into offenders
  from unnest(all_tables) expected where to_regclass('public.' || expected) is null;
  if offenders is not null then raise exception 'missing Pivot A tables: %', offenders; end if;

  select string_agg(c.relname, ', ') into offenders
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname = any(all_tables) and not c.relrowsecurity;
  if offenders is not null then raise exception 'RLS disabled on: %', offenders; end if;

  select string_agg(t || ':' || p, ', ') into offenders
  from unnest(all_tables) t cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
  where has_table_privilege('anon', 'public.' || t, p)
     or (p in ('SELECT','INSERT','UPDATE','REFERENCES') and has_any_column_privilege('anon', 'public.' || t, p));
  if offenders is not null then raise exception 'anon has privileges on: %', offenders; end if;

  select string_agg(t || ':' || p, ', ') into offenders
  from unnest(all_tables) t cross join unnest(array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
  where has_table_privilege('authenticated', 'public.' || t, p)
     or (p in ('INSERT','UPDATE','REFERENCES') and has_any_column_privilege('authenticated', 'public.' || t, p));
  if offenders is not null then raise exception 'authenticated can write: %', offenders; end if;

  select string_agg(t, ', ') into offenders
  from unnest(all_tables) t
  where has_any_column_privilege('authenticated', 'public.' || t, 'SELECT') <> (t = any(readable));
  if offenders is not null then raise exception 'authenticated SELECT grant is wrong on: %', offenders; end if;

  select string_agg(t, ', ') into offenders
  from unnest(all_tables) t
  where not has_table_privilege('service_role', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE');
  if offenders is not null then raise exception 'service role cannot manage: %', offenders; end if;

  if exists(
    select 1 from pg_policies
    where schemaname='public' and tablename = any(all_tables) and cmd <> 'SELECT'
  ) then raise exception 'a Pivot A table has a client write policy'; end if;
  if exists(
    select 1 from pg_policies
    where schemaname='public' and tablename in ('character_lines','story_chapters','safety_counters')
  ) then raise exception 'lines, chapters or safety counters have a client policy'; end if;

  if not has_function_privilege('authenticated','public.start_task(uuid)','EXECUTE') then raise exception 'authenticated cannot start tasks'; end if;
  if has_function_privilege('anon','public.start_task(uuid)','EXECUTE') then raise exception 'anon can start tasks'; end if;
  select string_agg(f, ', ') into offenders
  from unnest(array[
    'public.pivot_flag_enabled(text)',
    'public.feature_flag_enabled(text)',
    'public.coach_local_date(uuid,timestamp with time zone)',
    'public.record_ai_usage(uuid,date,integer,integer,integer,integer,bigint,bigint,bigint,bigint,numeric)',
    'public.increment_safety_counter(text,date)'
  ]) f
  where has_function_privilege('anon', f, 'EXECUTE')
     or has_function_privilege('authenticated', f, 'EXECUTE')
     or not has_function_privilege('service_role', f, 'EXECUTE');
  if offenders is not null then raise exception 'function grants are not service-role only: %', offenders; end if;
  if has_function_privilege('authenticated','public.record_task_finished_event()','EXECUTE')
    or has_function_privilege('anon','public.record_task_finished_event()','EXECUTE')
  then raise exception 'clients can execute the finish trigger function'; end if;
  if exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
      lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    where n.nspname='public'
      and p.proname in ('pivot_flag_enabled','coach_local_date','start_task','record_task_finished_event','record_ai_usage','increment_safety_counter')
      and acl.grantee=0 and acl.privilege_type='EXECUTE'
  ) then raise exception 'PUBLIC can execute a Pivot A function'; end if;

  if not exists(
    select 1 from pg_trigger
    where tgrelid='public.tasks'::regclass and tgname='tasks_record_finished_event' and not tgisinternal
  ) then raise exception 'the task finish trigger is missing'; end if;

  -- The character sheet is prompt material: clients get every other column.
  if has_table_privilege('authenticated','public.characters','SELECT') then
    raise exception 'authenticated has a table-wide SELECT on characters, which includes sheet';
  end if;
  if has_column_privilege('authenticated','public.characters','sheet','SELECT') then
    raise exception 'authenticated can read characters.sheet';
  end if;
  select string_agg(col, ', ') into offenders
  from unnest(array['id','slug','name','role','art_url','is_launch','pack_sku','companion_id','active','created_at','updated_at']) col
  where not has_column_privilege('authenticated','public.characters',col,'SELECT');
  if offenders is not null then raise exception 'authenticated cannot read public character columns: %', offenders; end if;
end $$;

-- Time zones must be named zones: timezone() alone accepts POSIX strings such
-- as 'FOO-167', which would shift local dates by about a week.
do $$
declare bad text; state text; msg text;
begin
  insert into public.user_coach_profiles(user_id, timezone) values ('bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb', 'America/New_York');
  delete from public.user_coach_profiles where user_id='bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb';

  foreach bad in array array['FOO-167','Not/AZone'] loop
    state := null; msg := null;
    begin
      insert into public.user_coach_profiles(user_id, timezone) values ('bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb', bad);
    exception when others then get stacked diagnostics state = returned_sqlstate, msg = message_text;
    end;
    if state is distinct from '22023' or msg is distinct from 'invalid time zone' then
      raise exception 'time zone % was not rejected on insert (got % %)', bad, state, msg;
    end if;

    state := null; msg := null;
    begin
      update public.user_coach_profiles set timezone = bad where user_id='aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
    exception when others then get stacked diagnostics state = returned_sqlstate, msg = message_text;
    end;
    if state is distinct from '22023' or msg is distinct from 'invalid time zone' then
      raise exception 'time zone % was not rejected on update (got % %)', bad, state, msg;
    end if;
  end loop;

  if exists(select 1 from public.user_coach_profiles where user_id='bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb')
    or (select timezone from public.user_coach_profiles where user_id='aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa') <> 'America/Los_Angeles'
  then raise exception 'time zone fixtures were not left as they started'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Flags: pivot_flag_enabled() resolution matrix and feature_flag_enabled().
-- Expected values are in key order: pivot_a, social_feed, persona_chat,
-- persona_autopost, share_win.
-- ---------------------------------------------------------------------------

do $$
declare
  flag_keys text[] := array['pivot_a.enabled','social_feed.enabled','persona_chat.enabled','persona_autopost.enabled','share_win.enabled'];
  scenario record;
  i integer;
  actual boolean;
  state text;
begin
  if (select enabled from public.app_feature_flags where key='pivot_a.enabled') is distinct from false then
    raise exception 'pivot_a.enabled must be seeded explicitly off';
  end if;
  if exists(select 1 from public.app_feature_flags where key in ('social_feed.enabled','persona_chat.enabled','persona_autopost.enabled','share_win.enabled')) then
    raise exception 'derived Pivot A flags must not be seeded';
  end if;

  for scenario in
    select * from (values
      ('absent','absent', array[false,true, true, true, true ]),
      ('absent','true',   array[false,true, true, true, true ]),
      ('absent','false',  array[false,false,false,false,false]),
      ('false', 'absent', array[false,true, true, true, true ]),
      ('false', 'true',   array[false,true, true, true, true ]),
      ('false', 'false',  array[false,false,false,false,false]),
      ('true',  'absent', array[true, false,false,false,true ]),
      ('true',  'true',   array[true, true, false,false,true ]),
      ('true',  'false',  array[true, false,false,false,false])
    ) as s(pivot_row, other_rows, expected)
  loop
    delete from public.app_feature_flags where key = any(flag_keys);
    if scenario.pivot_row <> 'absent' then
      insert into public.app_feature_flags(key, enabled) values ('pivot_a.enabled', scenario.pivot_row::boolean);
    end if;
    if scenario.other_rows <> 'absent' then
      insert into public.app_feature_flags(key, enabled)
      select k, scenario.other_rows::boolean from unnest(flag_keys[2:5]) k;
    end if;
    for i in 1..5 loop
      actual := public.pivot_flag_enabled(flag_keys[i]);
      if actual is distinct from scenario.expected[i] then
        raise exception 'pivot_flag_enabled(%) with pivot row % and other rows % returned %, expected %',
          flag_keys[i], scenario.pivot_row, scenario.other_rows, actual, scenario.expected[i];
      end if;
    end loop;
  end loop;

  begin
    perform public.pivot_flag_enabled('pivot_b.enabled');
  exception when others then get stacked diagnostics state = returned_sqlstate;
  end;
  if state is distinct from '22023' then raise exception 'an unknown pivot flag did not raise 22023 (got %)', state; end if;
  state := null;
  begin
    perform public.pivot_flag_enabled(null);
  exception when others then get stacked diagnostics state = returned_sqlstate;
  end;
  if state is distinct from '22023' then raise exception 'a null pivot flag did not raise 22023 (got %)', state; end if;

  -- Restore the seeded state: pivot off, derived rows absent.
  delete from public.app_feature_flags where key = any(flag_keys);
  insert into public.app_feature_flags(key, enabled) values ('pivot_a.enabled', false);

  if not public.feature_flag_enabled('AI_PERSONA_REPLIES') then raise exception 'persona replies are off while Pivot A is off'; end if;
  delete from public.app_feature_flags where key='pivot_a.enabled';
  if not public.feature_flag_enabled('AI_PERSONA_REPLIES') then raise exception 'persona replies are off while the pivot_a.enabled row is absent'; end if;
  insert into public.app_feature_flags(key, enabled) values ('pivot_a.enabled', false);
  if not public.feature_flag_enabled('AI_PERSONA_UNSEEDED_KEY') then raise exception 'a missing legacy flag row no longer means on'; end if;
  update public.app_feature_flags set enabled=true where key='pivot_a.enabled';
  if public.feature_flag_enabled('AI_PERSONA_REPLIES') then raise exception 'persona replies stay on under Pivot A'; end if;
  if public.feature_flag_enabled('AI_PERSONA_LIKES') then raise exception 'persona likes stay on under Pivot A'; end if;
  if public.feature_flag_enabled('AI_PERSONA_UNSEEDED_KEY') then raise exception 'an unseeded persona key stays on under Pivot A'; end if;
  if not public.feature_flag_enabled('PIVOT_UNRELATED_KEY') then raise exception 'Pivot A changed a non-persona legacy flag'; end if;
  update public.app_feature_flags set enabled=false where key='pivot_a.enabled';
end $$;

-- ---------------------------------------------------------------------------
-- Flag OFF: completing a task succeeds and writes nothing; start_task refuses.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claim.sub" = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

update public.tasks set status='completed' where id='aaaaaaaa-2222-4000-8000-000000000002';

do $$
declare state text; msg text;
begin
  begin
    perform public.start_task('aaaaaaaa-2222-4000-8000-000000000001');
  exception when others then get stacked diagnostics state = returned_sqlstate, msg = message_text;
  end;
  if state is distinct from 'P0001' or msg is distinct from 'feature disabled' then
    raise exception 'start_task with the flag off: expected P0001 feature disabled, got % %', state, msg;
  end if;
end $$;

reset role;
do $$ begin
  if (select status from public.tasks where id='aaaaaaaa-2222-4000-8000-000000000002') <> 'completed' then
    raise exception 'task completion failed with the flag off';
  end if;
  if exists(select 1 from public.task_events) then raise exception 'task events were written with the flag off'; end if;
  if exists(select 1 from public.story_progress) then raise exception 'story progress was written with the flag off'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Flag ON: start_task, the finish trigger, local days and consistency days.
-- ---------------------------------------------------------------------------

update public.app_feature_flags set enabled=true where key='pivot_a.enabled';

set local role authenticated;
set local "request.jwt.claim.sub" = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

do $$
declare started public.task_events; again public.task_events; state text;
begin
  started := public.start_task('aaaaaaaa-2222-4000-8000-000000000001');
  again := public.start_task('aaaaaaaa-2222-4000-8000-000000000001');
  if again.id is distinct from started.id then
    raise exception 'a second start on the same local day did not return the first started event';
  end if;
  if (select count(*) from public.task_events where task_id='aaaaaaaa-2222-4000-8000-000000000001' and type='started') <> 1 then
    raise exception 'two starts on one local day wrote more than one started event';
  end if;
  if started.type <> 'started' or started.user_id <> 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
    or started.task_id <> 'aaaaaaaa-2222-4000-8000-000000000001'
    or started.local_date <> (now() at time zone 'America/Los_Angeles')::date
    or started.occurrence_key is not null
  then raise exception 'start_task returned an unexpected event: %', row_to_json(started); end if;

  begin
    perform public.start_task('bbbbbbbb-2222-4000-8000-000000000001');
  exception when others then get stacked diagnostics state = returned_sqlstate;
  end;
  if state is distinct from 'P0002' then raise exception 'starting another user''s task did not raise P0002 (got %)', state; end if;

  state := null;
  begin
    perform public.start_task('aaaaaaaa-2222-4000-8000-0000000000ff');
  exception when others then get stacked diagnostics state = returned_sqlstate;
  end;
  if state is distinct from 'P0002' then raise exception 'starting a missing task did not raise P0002 (got %)', state; end if;

  state := null;
  begin
    perform public.start_task('aaaaaaaa-2222-4000-8000-000000000002');
  exception when others then get stacked diagnostics state = returned_sqlstate;
  end;
  if state is distinct from '22023' then raise exception 'starting a completed task did not raise 22023 (got %)', state; end if;

  if (select count(*) from public.task_events) <> 1 then raise exception 'start_task did not write exactly one visible event'; end if;
end $$;

reset role;
set local role anon;
do $$
declare state text;
begin
  begin
    perform public.start_task('aaaaaaaa-2222-4000-8000-000000000001');
  exception when others then get stacked diagnostics state = returned_sqlstate;
  end;
  if state is distinct from '42501' then raise exception 'anon could call start_task (got %)', state; end if;
end $$;

reset role;

-- 03:00 UTC on 15 January is 19:00 on 14 January in Los Angeles.
update public.tasks set status='completed', completed_at='2026-01-15 03:00:00+00'
where id='aaaaaaaa-2222-4000-8000-000000000003';

do $$ begin
  if (select count(*) from public.task_events where task_id='aaaaaaaa-2222-4000-8000-000000000003' and type='finished') <> 1 then
    raise exception 'completing a task did not write exactly one finished event';
  end if;
  if (select local_date from public.task_events where task_id='aaaaaaaa-2222-4000-8000-000000000003') <> '2026-01-14'::date then
    raise exception 'the finished event is not dated in the user''s time zone';
  end if;
  if (select occurred_at from public.task_events where task_id='aaaaaaaa-2222-4000-8000-000000000003') <> '2026-01-15 03:00:00+00'::timestamptz then
    raise exception 'the finished event does not use completed_at';
  end if;
  if (select consistency_days from public.story_progress
      where user_id='aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa' and character_id='c0000000-0000-4000-8000-000000000001') <> 1
    or (select last_consistency_date from public.story_progress
      where user_id='aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa' and character_id='c0000000-0000-4000-8000-000000000001') <> '2026-01-14'::date
  then raise exception 'the first finish of a local day did not count one consistency day'; end if;
  if public.coach_local_date('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', '2026-01-15 03:00:00+00') <> '2026-01-14'::date then
    raise exception 'coach_local_date ignores the user''s time zone';
  end if;
  if public.coach_local_date('bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb', '2026-01-15 03:00:00+00') <> '2026-01-15'::date then
    raise exception 'coach_local_date does not default to UTC';
  end if;
end $$;

-- Re-saving a completed status and finishing again on the same local day.
update public.tasks set status='completed' where id='aaaaaaaa-2222-4000-8000-000000000003';
-- 20:00 UTC on 14 January: a different UTC day, the same Los Angeles day.
update public.tasks set status='completed', completed_at='2026-01-14 20:00:00+00'
where id='aaaaaaaa-2222-4000-8000-000000000004';

do $$ begin
  if (select count(*) from public.task_events where task_id='aaaaaaaa-2222-4000-8000-000000000003') <> 1 then
    raise exception 're-saving a completed task wrote another finished event';
  end if;
  if (select local_date from public.task_events where task_id='aaaaaaaa-2222-4000-8000-000000000004') <> '2026-01-14'::date then
    raise exception 'the second finish is not dated in the user''s time zone';
  end if;
  if (select consistency_days from public.story_progress where user_id='aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa') <> 1 then
    raise exception 'two finishes on one local day counted more than one consistency day';
  end if;
end $$;

-- An inserted completed task takes the INSERT path. 02:00 UTC on 16 January is
-- 15 January in Los Angeles: the next local day.
insert into public.tasks(id, owner_id, title, visibility, status, completed_at)
values ('aaaaaaaa-2222-4000-8000-000000000005','aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa','A: inserted as completed','private','completed','2026-01-16 02:00:00+00');

do $$ begin
  if (select local_date from public.task_events where task_id='aaaaaaaa-2222-4000-8000-000000000005' and type='finished') <> '2026-01-15'::date then
    raise exception 'inserting a completed task did not write a local-day finished event';
  end if;
  if (select consistency_days from public.story_progress where user_id='aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa') <> 2
    or (select last_consistency_date from public.story_progress where user_id='aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa') <> '2026-01-15'::date
  then raise exception 'a finish on the next local day did not count another consistency day'; end if;
end $$;

-- The normal client path: the owner updates the status through RLS.
set local role authenticated;
set local "request.jwt.claim.sub" = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
update public.tasks set status='completed' where id='aaaaaaaa-2222-4000-8000-000000000006';
do $$ begin
  if not exists(
    select 1 from public.task_events
    where task_id='aaaaaaaa-2222-4000-8000-000000000006' and type='finished'
      and local_date=(now() at time zone 'America/Los_Angeles')::date
  ) then raise exception 'a client completion did not write a visible local-day finished event'; end if;
  if (select consistency_days from public.story_progress) <> 3 then
    raise exception 'a client completion did not count a consistency day';
  end if;
end $$;

-- One finished event per occurrence. The dates are later than every finish
-- above, so a duplicate event would also count an extra consistency day.
reset role;
insert into public.tasks(id, owner_id, title, visibility, status)
values ('aaaaaaaa-2222-4000-8000-000000000007','aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa','A: one-off toggled','private','pending');
-- Daily recurring with an exact deadline, so apply_task_completion keys each
-- occurrence on the Los Angeles date of completed_at.
insert into public.tasks(id, owner_id, title, visibility, status, recurrence_rule, due_at, due_has_time, due_timezone)
values ('aaaaaaaa-2222-4000-8000-000000000008','aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa','A: daily recurring','private','pending',
  'daily','2099-03-03 20:00:00+00',true,'America/Los_Angeles');

update public.tasks set status='completed', completed_at='2099-03-01 18:00:00+00' where id='aaaaaaaa-2222-4000-8000-000000000007';
update public.tasks set status='pending' where id='aaaaaaaa-2222-4000-8000-000000000007';
update public.tasks set status='completed', completed_at='2099-03-02 18:00:00+00' where id='aaaaaaaa-2222-4000-8000-000000000007';

do $$ begin
  if (select count(*) from public.task_events where task_id='aaaaaaaa-2222-4000-8000-000000000007' and type='finished') <> 1 then
    raise exception 'completed, pending, completed wrote more than one finished event for a one-off task';
  end if;
  if (select occurrence_key from public.task_events where task_id='aaaaaaaa-2222-4000-8000-000000000007') <> 'single'
    or (select local_date from public.task_events where task_id='aaaaaaaa-2222-4000-8000-000000000007') <> '2099-03-01'::date
  then raise exception 'the one-off finished event is not the first completion keyed single'; end if;
  if (select consistency_days from public.story_progress where user_id='aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa') <> 4
    or (select last_consistency_date from public.story_progress where user_id='aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa') <> '2099-03-01'::date
  then raise exception 'reopening and completing a one-off task again counted another consistency day'; end if;
end $$;

update public.tasks set status='completed', completed_at='2099-03-03 18:00:00+00' where id='aaaaaaaa-2222-4000-8000-000000000008';
update public.tasks set status='pending' where id='aaaaaaaa-2222-4000-8000-000000000008';
update public.tasks set status='completed', completed_at='2099-03-04 18:00:00+00' where id='aaaaaaaa-2222-4000-8000-000000000008';
update public.tasks set status='pending' where id='aaaaaaaa-2222-4000-8000-000000000008';
update public.tasks set status='completed', completed_at='2099-03-04 19:00:00+00' where id='aaaaaaaa-2222-4000-8000-000000000008';

do $$ begin
  if (select array_agg(occurrence_key order by occurrence_key) from public.task_events
      where task_id='aaaaaaaa-2222-4000-8000-000000000008' and type='finished')
    is distinct from array['2099-03-03','2099-03-04']
  then raise exception 'a daily task finished on two local days did not write one event per day'; end if;
  if (select consistency_days from public.story_progress where user_id='aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa') <> 6
    or (select last_consistency_date from public.story_progress where user_id='aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa') <> '2099-03-04'::date
  then raise exception 'a daily task did not count exactly one consistency day per occurrence'; end if;
end $$;

-- B has no coach profile row: completion still works and the day is UTC.
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb';
update public.tasks set status='completed' where id='bbbbbbbb-2222-4000-8000-000000000002';

reset role;
do $$ begin
  if (select status from public.tasks where id='bbbbbbbb-2222-4000-8000-000000000002') <> 'completed' then
    raise exception 'completion failed for a user without a coach profile';
  end if;
  if not exists(
    select 1 from public.task_events
    where task_id='bbbbbbbb-2222-4000-8000-000000000002' and type='finished'
      and local_date=(now() at time zone 'UTC')::date
  ) then raise exception 'a user without a coach profile did not get a UTC finished event'; end if;
  if exists(select 1 from public.story_progress where user_id='bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb') then
    raise exception 'story progress was written without a selected character';
  end if;
end $$;

-- A failure inside the trigger must never fail the completion itself.
alter table public.task_events add constraint pivot_a_test_reject_all check (false) not valid;
update public.tasks set status='completed' where id='bbbbbbbb-2222-4000-8000-000000000003';
do $$ begin
  if (select status from public.tasks where id='bbbbbbbb-2222-4000-8000-000000000003') <> 'completed' then
    raise exception 'a failing finish trigger blocked task completion';
  end if;
  if exists(select 1 from public.task_events where task_id='bbbbbbbb-2222-4000-8000-000000000003') then
    raise exception 'a failing finish trigger left a partial event';
  end if;
end $$;
alter table public.task_events drop constraint pivot_a_test_reject_all;

-- ---------------------------------------------------------------------------
-- Server-side writers and per-user visibility.
-- ---------------------------------------------------------------------------

insert into public.user_coach_profiles(user_id, timezone, ai_arm)
values ('bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb','Asia/Tokyo','prewritten');
update public.user_coach_profiles set ai_arm='ai' where user_id='aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

insert into public.character_reactions(user_id, task_event_id, character_id, event, source, line_id, text, disclosure_shown)
select e.user_id, e.id, 'c0000000-0000-4000-8000-000000000001', 'task_finished', 'prewritten',
  'test-coach.task_finished.001', 'Done. Next one, or rest.', true
from public.task_events e where e.type='finished';

-- One reaction per task event; reactions without an event are unconstrained.
do $$
declare state text; event_id uuid;
begin
  select id into event_id from public.task_events
  where task_id='aaaaaaaa-2222-4000-8000-000000000003' and type='finished';
  begin
    insert into public.character_reactions(user_id, task_event_id, character_id, event, source, text)
    values ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', event_id, 'c0000000-0000-4000-8000-000000000001',
      'task_finished', 'ai', 'A second reaction for the same event.');
  exception when others then get stacked diagnostics state = returned_sqlstate;
  end;
  if state is distinct from '23505' then raise exception 'a second reaction for one task event did not raise 23505 (got %)', state; end if;

  insert into public.character_reactions(user_id, task_event_id, character_id, event, source, text)
  values
    ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', null, 'c0000000-0000-4000-8000-000000000001', 'session_nudge', 'prewritten', 'Time to close the app.'),
    ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', null, 'c0000000-0000-4000-8000-000000000001', 'session_nudge', 'prewritten', 'Time to close the app.');
  if (select count(*) from public.character_reactions
      where user_id='aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa' and task_event_id is null) <> 2
  then raise exception 'reactions without a task event were constrained'; end if;

  if exists(select 1 from pg_indexes where schemaname='public' and indexname='character_reactions_task_event_idx') then
    raise exception 'the redundant non-unique task event index is still present';
  end if;
end $$;

insert into public.story_progress(user_id, character_id, consistency_days)
values ('bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb','c0000000-0000-4000-8000-000000000001',1);

insert into public.entitlements(user_id, product, status, source, trial_ends_at)
values
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa','plus','trialing','stripe',now() + interval '14 days'),
  ('bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb','pack:test-coach','active','app_store',null);

set local role service_role;
select public.record_ai_usage('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa','2026-01-15',1,0,1,0,900,40,0,800,0.000250);
select public.record_ai_usage('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa','2026-01-15',1,1,0,1,100,60,800,0,0.000125);
select public.record_ai_usage('bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb','2026-01-15',1,0,0,0,10,10,0,0,0.000010);
select public.increment_safety_counter('crisis_card_shown','2026-01-15');
select public.increment_safety_counter('crisis_card_shown','2026-01-15');
select public.increment_safety_counter('distress_check_unavailable');
reset role;

do $$
declare state text;
begin
  if not exists(
    select 1 from public.ai_usage_daily
    where user_id='aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa' and date='2026-01-15'
      and reactions=2 and splits=1 and safety_checks=1 and aborted_calls=1
      and input_tokens=1000 and output_tokens=100
      and cache_read_input_tokens=800 and cache_creation_input_tokens=800
      and est_cost_usd=0.000375
  ) then raise exception 'record_ai_usage did not increment the daily row'; end if;
  begin
    perform public.record_ai_usage('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa','2026-01-15',-1,0,0,0,0,0,0,0,0);
  exception when others then get stacked diagnostics state = returned_sqlstate;
  end;
  if state is distinct from '22023' then raise exception 'a negative usage increment was accepted (got %)', state; end if;

  if (select count from public.safety_counters where date='2026-01-15' and kind='crisis_card_shown') <> 2 then
    raise exception 'increment_safety_counter did not count twice';
  end if;
  if (select count from public.safety_counters where date=(now() at time zone 'utc')::date and kind='distress_check_unavailable') <> 1 then
    raise exception 'increment_safety_counter does not default to the UTC date';
  end if;
  state := null;
  begin
    perform public.increment_safety_counter('task_title_logged');
  exception when others then get stacked diagnostics state = returned_sqlstate;
  end;
  if state is distinct from '23514' then raise exception 'an unknown safety counter kind was accepted (got %)', state; end if;
end $$;

set local role authenticated;
set local "request.jwt.claim.sub" = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

do $$
declare
  owned text[] := array['user_coach_profiles','task_events','character_reactions','ai_usage_daily','story_progress','entitlements'];
  t text;
  total bigint;
  own bigint;
  state text;
begin
  foreach t in array owned loop
    execute format('select count(*), count(*) filter (where user_id = %L) from public.%I',
      'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', t) into total, own;
    if own = 0 then raise exception 'user A cannot read their own % rows', t; end if;
    if total <> own then raise exception 'user A can read another user''s % rows', t; end if;
  end loop;

  foreach t in array array['safety_counters','character_lines','story_chapters'] loop
    state := null;
    begin
      execute format('select count(*) from public.%I', t);
    exception when others then get stacked diagnostics state = returned_sqlstate;
    end;
    if state is distinct from '42501' then raise exception 'user A can read % (got %)', t, state; end if;
  end loop;

  if not exists(select 1 from public.characters where slug='test-coach') then raise exception 'an active character is not readable'; end if;
  if exists(select 1 from public.characters where slug='retired-rival') then raise exception 'an inactive character is readable'; end if;
  if not exists(
    select id, slug, name, role, art_url, is_launch, pack_sku, companion_id, active, created_at, updated_at
    from public.characters where slug='test-coach'
  ) then raise exception 'the public character columns are not selectable'; end if;

  state := null;
  begin
    perform sheet from public.characters;
  exception when others then get stacked diagnostics state = returned_sqlstate;
  end;
  if state is distinct from '42501' then raise exception 'user A can read characters.sheet (got %)', state; end if;

  state := null;
  begin
    perform * from public.characters;
  exception when others then get stacked diagnostics state = returned_sqlstate;
  end;
  if state is distinct from '42501' then raise exception 'select * on characters exposes sheet (got %)', state; end if;

  state := null;
  begin
    insert into public.task_events(user_id, task_id, type, local_date)
    values ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa','aaaaaaaa-2222-4000-8000-000000000001','finished',current_date);
  exception when others then get stacked diagnostics state = returned_sqlstate;
  end;
  if state is distinct from '42501' then raise exception 'user A can forge a task event (got %)', state; end if;

  state := null;
  begin
    update public.user_coach_profiles set ai_arm='prewritten', selected_character_id='c0000000-0000-4000-8000-000000000002';
  exception when others then get stacked diagnostics state = returned_sqlstate;
  end;
  if state is distinct from '42501' then raise exception 'user A can rewrite their coach profile directly (got %)', state; end if;

  state := null;
  begin
    insert into public.entitlements(user_id, product, status, source)
    values ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa','pack:retired-rival','active','stripe');
  exception when others then get stacked diagnostics state = returned_sqlstate;
  end;
  if state is distinct from '42501' then raise exception 'user A can grant themselves an entitlement (got %)', state; end if;

  state := null;
  begin
    delete from public.character_reactions;
  exception when others then get stacked diagnostics state = returned_sqlstate;
  end;
  if state is distinct from '42501' then raise exception 'user A can delete reactions directly (got %)', state; end if;
end $$;

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb';

do $$
declare
  owned text[] := array['user_coach_profiles','task_events','character_reactions','ai_usage_daily','story_progress','entitlements'];
  t text;
  total bigint;
  own bigint;
  state text;
begin
  foreach t in array owned loop
    execute format('select count(*), count(*) filter (where user_id = %L) from public.%I',
      'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb', t) into total, own;
    if own = 0 then raise exception 'user B cannot read their own % rows', t; end if;
    if total <> own then raise exception 'user B can read another user''s % rows', t; end if;
  end loop;

  foreach t in array array['safety_counters','character_lines','story_chapters'] loop
    state := null;
    begin
      execute format('select count(*) from public.%I', t);
    exception when others then get stacked diagnostics state = returned_sqlstate;
    end;
    if state is distinct from '42501' then raise exception 'user B can read % (got %)', t, state; end if;
  end loop;

  if not exists(select 1 from public.characters where slug='test-coach') then raise exception 'an active character is not readable'; end if;
  if exists(select 1 from public.characters where slug='retired-rival') then raise exception 'an inactive character is readable'; end if;
end $$;

reset role;
set local role anon;
do $$
declare t text; state text;
begin
  foreach t in array array[
    'characters','character_lines','story_chapters','user_coach_profiles','task_events',
    'character_reactions','ai_usage_daily','story_progress','entitlements','safety_counters'
  ] loop
    state := null;
    begin
      execute format('select count(*) from public.%I', t);
    exception when others then get stacked diagnostics state = returned_sqlstate;
    end;
    if state is distinct from '42501' then raise exception 'anon can read % (got %)', t, state; end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Account deletion cascades to every new user-owned table.
-- ---------------------------------------------------------------------------

reset role;
delete from auth.users where id='aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

do $$
declare
  owned text[] := array['user_coach_profiles','task_events','character_reactions','ai_usage_daily','story_progress','entitlements'];
  t text;
  remaining bigint;
begin
  foreach t in array owned loop
    execute format('select count(*) from public.%I where user_id = %L', t, 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa') into remaining;
    if remaining <> 0 then raise exception 'deleting a user left % rows in %', remaining, t; end if;
    execute format('select count(*) from public.%I where user_id = %L', t, 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb') into remaining;
    if remaining = 0 then raise exception 'deleting one user removed another user''s % rows', t; end if;
  end loop;
  if not exists(select 1 from public.safety_counters where date='2026-01-15' and kind='crisis_card_shown' and count=2) then
    raise exception 'aggregate safety counters must survive account deletion';
  end if;
  if not exists(select 1 from public.characters where slug='test-coach') then
    raise exception 'account deletion removed first-party content';
  end if;
end $$;

select extensions.pass('Pivot A schema, RLS, flags, finish trigger and deletion contracts hold');
select * from extensions.finish();

rollback;
