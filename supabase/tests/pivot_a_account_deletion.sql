begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(1);

-- Pivot A Phase 8: account deletion covers every Pivot A table.
--
-- DELETE /api/account (src/app/api/account/route.ts) purges storage, records a
-- pseudonymous deletion request, and calls auth.admin.deleteUser(id, false):
-- a hard delete from auth.users by the auth server. Everything else goes by
-- foreign-key cascade. This test
-- gives user D a row in every Pivot A user-linked table (and a Pivot A event
-- of every name), deletes D the same way, and checks that:
-- - every foreign key in public to user_profiles(id) or auth.users(id),
--   whatever its column is called, cascades or sets null (a catalog check, so
--   a table added later cannot block or outlive a deletion unnoticed);
-- - nothing references D anywhere: every such foreign key is scanned for D's
--   rows (this only finds rows the fixture wrote, so a new table also needs
--   rows here to be checked row by row);
-- - bystander K, with the same rows, keeps all of them;
-- - the aggregates without user ids (safety_counters, ai_spend_daily) and the
--   first-party content are untouched.

-- Users are created while Pivot A is off, so the sign-up age backstop allows them.
update public.app_feature_flags set enabled=false where key='pivot_a.enabled';

insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('d0d0d0d0-8888-4888-8888-d0d0d0d0d0d0','authenticated','authenticated','deleted@example.test',crypt('test-password',gen_salt('bf')),now(),'{}','{"username":"deletion_d"}',now(),now()),
  ('b0b0b0b0-8888-4888-8888-b0b0b0b0b0b0','authenticated','authenticated','bystander@example.test',crypt('test-password',gen_salt('bf')),now(),'{}','{"username":"deletion_k"}',now(),now());

insert into public.characters(id, slug, name, role, is_launch, sheet, active)
values ('c8810000-0000-4000-8000-000000000001','deletion-coach','Deletion Coach','coach',true,'{}',true);
insert into public.character_lines(id, character_id, event, text)
values ('deletion-coach.task_finished.001','c8810000-0000-4000-8000-000000000001','task_finished','Done.');
insert into public.story_chapters(character_id, number, title, body)
values ('c8810000-0000-4000-8000-000000000001',1,'Chapter one','Placeholder chapter body.');

-- The same Pivot A footprint for both users, written the way the app writes it
-- (functions and triggers) wherever one exists.
do $$
declare
  person uuid;
  task uuid;
  finished uuid;
begin
  foreach person in array array['d0d0d0d0-8888-4888-8888-d0d0d0d0d0d0','b0b0b0b0-8888-4888-8888-b0b0b0b0b0b0']::uuid[] loop
    insert into public.user_coach_profiles(user_id, selected_character_id, timezone, age_verified_at, age_verification_method)
    values (person, 'c8810000-0000-4000-8000-000000000001', 'America/New_York', now(), 'self_attested');

    insert into public.tasks(owner_id, title, visibility, status)
    values (person, 'Deletion fixture', 'private', 'pending') returning id into task;
    -- task_started / task_finished events come from the task_events trigger.
    insert into public.task_events(user_id, task_id, type, occurred_at, local_date)
    values (person, task, 'started', now(), current_date);
    insert into public.task_events(user_id, task_id, type, occurred_at, local_date, occurrence_key)
    values (person, task, 'finished', now(), current_date, 'single') returning id into finished;
    -- reaction_shown comes from the character_reactions trigger.
    insert into public.character_reactions(user_id, task_event_id, character_id, event, source, line_id, text)
    values (person, finished, 'c8810000-0000-4000-8000-000000000001', 'task_finished', 'prewritten', 'deletion-coach.task_finished.001', 'Done.');
    insert into public.coach_consistency_dates(user_id, local_date) values (person, current_date);
    -- chapter_unlocked comes from the story_progress trigger.
    insert into public.story_progress(user_id, character_id, consistency_days, unlocked_through, last_consistency_date)
    values (person, 'c8810000-0000-4000-8000-000000000001', 2, 0, current_date);
    update public.story_progress set unlocked_through = 2 where user_id = person;
    -- trial_started and purchase come from the entitlements trigger.
    insert into public.entitlements(user_id, product, status, source, external_id)
    values
      (person, 'plus', 'trialing', 'stripe', 'deletion-fixture-plus'),
      (person, 'pack:deletion-coach', 'active', 'app_store', 'deletion-fixture-pack');
    -- ai_usage_daily, and the UTC spend ledger through its trigger.
    perform public.record_ai_usage(person, current_date, 1, 1, 1, 0, 100, 20, 0, 0, 0.0125);
    -- The server-recorded events.
    perform public.record_coach_product_event(person, 'split_used');
    perform public.record_coach_product_event(person, 'paywall_viewed', 'story');
    perform public.record_coach_product_event(person, 'session_length', null, 600);
  end loop;
  perform public.increment_safety_counter('crisis_card_shown', '2099-01-01');
  perform public.increment_safety_counter('distress_check_unavailable', '2099-01-01');
end $$;

-- The aggregates as they stand before the deletion.
create temp table deletion_aggregates_before as
  select 'safety_counters:' || date || ':' || kind as key, count::numeric as value from public.safety_counters
  union all
  select 'ai_spend_daily:' || date, est_cost_usd from public.ai_spend_daily;

-- Every Pivot A user-linked table, and every Pivot A event name.
create temp table pivot_a_owned(table_name text primary key);
insert into pivot_a_owned values
  ('user_coach_profiles'), ('task_events'), ('character_reactions'), ('ai_usage_daily'),
  ('story_progress'), ('entitlements'), ('coach_consistency_dates'), ('beta_product_events');
create temp table pivot_a_event_names(event_name text primary key);
insert into pivot_a_event_names values
  ('task_started'), ('task_finished'), ('reaction_shown'), ('split_used'), ('chapter_unlocked'),
  ('paywall_viewed'), ('trial_started'), ('purchase'), ('session_length');

do $$
declare
  owned text;
  missing text;
  person uuid;
  found bigint;
begin
  -- The fixture is not vacuous: both users have rows in every table and an
  -- event of every Pivot A name.
  foreach person in array array['d0d0d0d0-8888-4888-8888-d0d0d0d0d0d0','b0b0b0b0-8888-4888-8888-b0b0b0b0b0b0']::uuid[] loop
    for owned in select table_name from pivot_a_owned loop
      execute format('select count(*) from public.%I where user_id = %L', owned, person) into found;
      if found = 0 then raise exception 'fixture: % has no % rows', person, owned; end if;
    end loop;
    select string_agg(name.event_name, ', ') into missing from pivot_a_event_names name
    where not exists(select 1 from public.beta_product_events event where event.user_id = person and event.event_name = name.event_name);
    if missing is not null then raise exception 'fixture: % has no events named %', person, missing; end if;
  end loop;

  -- Every foreign key in public that references a user, under any column
  -- name, cascades or sets null; anything else would block the auth delete or
  -- keep the user's id.
  select string_agg(format('%s.%s (%s)', fk.conrelid::regclass, fk.conname,
      case fk.confdeltype when 'a' then 'no action' when 'r' then 'restrict' when 'd' then 'set default' else fk.confdeltype::text end),
    ', ' order by fk.conrelid::regclass::text, fk.conname) into missing
  from pg_constraint fk
  where fk.contype = 'f' and fk.connamespace = 'public'::regnamespace
    and (
      (fk.confrelid = 'public.user_profiles'::regclass and fk.confkey = array[(
        select attnum from pg_attribute where attrelid = 'public.user_profiles'::regclass and attname = 'id')])
      or (fk.confrelid = 'auth.users'::regclass and fk.confkey = array[(
        select attnum from pg_attribute where attrelid = 'auth.users'::regclass and attname = 'id')])
    )
    and fk.confdeltype not in ('c', 'n');
  if missing is not null then raise exception 'user foreign keys that neither cascade nor set null: %', missing; end if;

  -- Each Pivot A table reaches the user through an ON DELETE CASCADE key.
  select string_agg(owned_table.table_name, ', ') into missing
  from pivot_a_owned owned_table
  where not exists(
    select 1 from pg_constraint fk
    join pg_attribute col on col.attrelid = fk.conrelid and col.attnum = any(fk.conkey)
    where fk.contype = 'f' and fk.conrelid = ('public.' || owned_table.table_name)::regclass
      and col.attname = 'user_id'
      and fk.confrelid in ('public.user_profiles'::regclass, 'auth.users'::regclass)
      and fk.confdeltype = 'c'
  );
  if missing is not null then raise exception 'no cascading user foreign key on: %', missing; end if;

  -- Apart from the deletion audit (nulled by the route), every user-id column
  -- in public has a foreign key to the user, so the cascade can reach it.
  select string_agg(format('%s.%s', col.attrelid::regclass, col.attname), ', ') into missing
  from pg_attribute col join pg_class rel on rel.oid = col.attrelid
  where rel.relnamespace = 'public'::regnamespace and rel.relkind = 'r'
    and col.attnum > 0 and not col.attisdropped and col.atttypid = 'uuid'::regtype
    and col.attname like '%user_id'
    and rel.relname <> 'account_deletion_requests'
    and not exists(select 1 from pg_constraint fk where fk.conrelid = col.attrelid and fk.contype = 'f' and col.attnum = any(fk.conkey));
  if missing is not null then raise exception 'user id columns without a foreign key: %', missing; end if;
end $$;

-- The deletion, as DELETE /api/account runs it, with Pivot A on.
update public.app_feature_flags set enabled=true where key='pivot_a.enabled';

insert into public.account_deletion_requests(id, user_id, status)
values ('d1d1d1d1-8888-4888-8888-d1d1d1d1d1d1', 'd0d0d0d0-8888-4888-8888-d0d0d0d0d0d0', 'processing');
update public.account_deletion_requests
set user_id = null, user_fingerprint = md5('deletion-fixture'), status = 'auth_delete_pending'
where id = 'd1d1d1d1-8888-4888-8888-d1d1d1d1d1d1';

-- The auth server deletes as supabase_auth_admin, which the test role cannot
-- become; the cascade's referential actions run as each referencing table's
-- owner either way.
delete from auth.users where id = 'd0d0d0d0-8888-4888-8888-d0d0d0d0d0d0';

update public.account_deletion_requests
set status = 'completed', completed_at = now()
where id = 'd1d1d1d1-8888-4888-8888-d1d1d1d1d1d1';

do $$
declare
  ref record;
  owned text;
  remaining bigint;
  changed text;
begin
  -- Nothing anywhere in public still references the deleted user.
  for ref in
    select fk.conrelid::regclass as table_name, col.attname as column_name
    from pg_constraint fk
    join pg_attribute col on col.attrelid = fk.conrelid and col.attnum = any(fk.conkey)
    where fk.contype = 'f' and fk.connamespace = 'public'::regnamespace
      and fk.confrelid in ('public.user_profiles'::regclass, 'auth.users'::regclass)
  loop
    execute format('select count(*) from %s where %I = %L', ref.table_name, ref.column_name, 'd0d0d0d0-8888-4888-8888-d0d0d0d0d0d0') into remaining;
    if remaining <> 0 then raise exception 'deleting the user left % rows in %.%', remaining, ref.table_name, ref.column_name; end if;
  end loop;
  if exists(select 1 from auth.users where id = 'd0d0d0d0-8888-4888-8888-d0d0d0d0d0d0')
    or exists(select 1 from public.user_profiles where id = 'd0d0d0d0-8888-4888-8888-d0d0d0d0d0d0')
  then raise exception 'the user itself survived'; end if;

  -- Every Pivot A table by name, too; the bystander keeps every row.
  for owned in select table_name from pivot_a_owned loop
    execute format('select count(*) from public.%I where user_id = %L', owned, 'd0d0d0d0-8888-4888-8888-d0d0d0d0d0d0') into remaining;
    if remaining <> 0 then raise exception 'deleting the user left % rows in %', remaining, owned; end if;
    execute format('select count(*) from public.%I where user_id = %L', owned, 'b0b0b0b0-8888-4888-8888-b0b0b0b0b0b0') into remaining;
    if remaining = 0 then raise exception 'deleting one user removed another user''s % rows', owned; end if;
  end loop;
  if (select count(distinct event_name) from public.beta_product_events
      where user_id = 'b0b0b0b0-8888-4888-8888-b0b0b0b0b0b0'
        and event_name in (select event_name from pivot_a_event_names)) <> 9
  then raise exception 'deleting one user removed another user''s Pivot A events'; end if;

  -- Aggregates without user ids are untouched, row for row.
  select string_agg(coalesce(before.key, after.key), ', ') into changed
  from deletion_aggregates_before before
  full join (
    select 'safety_counters:' || date || ':' || kind as key, count::numeric as value from public.safety_counters
    union all
    select 'ai_spend_daily:' || date, est_cost_usd from public.ai_spend_daily
  ) after on after.key = before.key
  where before.value is distinct from after.value;
  if changed is not null then raise exception 'account deletion changed aggregates: %', changed; end if;
  if not exists(select 1 from public.safety_counters where date = '2099-01-01' and kind = 'crisis_card_shown' and count >= 1) then
    raise exception 'the fixture safety counter is gone';
  end if;
  if not exists(select 1 from public.ai_spend_daily where est_cost_usd >= 0.025) then
    raise exception 'the spend ledger lost the deleted user''s share of today''s spend';
  end if;

  -- First-party content stays; the audit row is pseudonymous.
  if not exists(select 1 from public.characters where slug = 'deletion-coach')
    or not exists(select 1 from public.character_lines where id = 'deletion-coach.task_finished.001')
    or not exists(select 1 from public.story_chapters where character_id = 'c8810000-0000-4000-8000-000000000001')
  then raise exception 'account deletion removed first-party content'; end if;
  if not exists(
    select 1 from public.account_deletion_requests
    where id = 'd1d1d1d1-8888-4888-8888-d1d1d1d1d1d1' and user_id is null and status = 'completed' and user_fingerprint is not null
  ) then raise exception 'the deletion audit row is not pseudonymous and completed'; end if;
end $$;

select extensions.pass('Account deletion removes every Pivot A row of the user and nothing else');
select * from extensions.finish();

rollback;
