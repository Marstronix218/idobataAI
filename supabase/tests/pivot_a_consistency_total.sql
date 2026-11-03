begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(1);

-- The consistency-day ledger (coach_consistency_dates) and
-- coach_consistency_total_days: written by the finish trigger, never lowered
-- by deleting a task, removed with the account, readable only by its owner.

insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a7a7a7a7-1111-4111-8111-a7a7a7a7a7a7','authenticated','authenticated','total-a@example.test',crypt('test-password',gen_salt('bf')),now(),'{}','{"username":"total_a"}',now(),now()),
  ('b8b8b8b8-1111-4111-8111-b8b8b8b8b8b8','authenticated','authenticated','total-b@example.test',crypt('test-password',gen_salt('bf')),now(),'{}','{"username":"total_b"}',now(),now()),
  ('c9c9c9c9-1111-4111-8111-c9c9c9c9c9c9','authenticated','authenticated','total-c@example.test',crypt('test-password',gen_salt('bf')),now(),'{}','{"username":"total_c"}',now(),now());

insert into public.characters(id, slug, name, role, is_launch, sheet, active)
values ('c7000000-0000-4000-8000-000000000001','total-coach','Total Coach','coach',true,'{}',true);

-- A has a character and a zone (UTC); B has no coach profile at all.
insert into public.user_coach_profiles(user_id, selected_character_id, timezone)
values ('a7a7a7a7-1111-4111-8111-a7a7a7a7a7a7','c7000000-0000-4000-8000-000000000001','UTC');

insert into public.tasks(id, owner_id, title, visibility, status)
values
  ('a7a7a7a7-2222-4000-8000-000000000001','a7a7a7a7-1111-4111-8111-a7a7a7a7a7a7','A: flag off','private','pending'),
  ('a7a7a7a7-2222-4000-8000-000000000002','a7a7a7a7-1111-4111-8111-a7a7a7a7a7a7','A: day one','private','pending'),
  ('a7a7a7a7-2222-4000-8000-000000000003','a7a7a7a7-1111-4111-8111-a7a7a7a7a7a7','A: day one again','private','pending'),
  ('a7a7a7a7-2222-4000-8000-000000000004','a7a7a7a7-1111-4111-8111-a7a7a7a7a7a7','A: after a gap','private','pending'),
  ('a7a7a7a7-2222-4000-8000-000000000005','a7a7a7a7-1111-4111-8111-a7a7a7a7a7a7','A: started only','private','pending'),
  ('b8b8b8b8-2222-4000-8000-000000000001','b8b8b8b8-1111-4111-8111-b8b8b8b8b8b8','B: no profile','private','pending');

-- ---------------------------------------------------------------------------
-- Structure: RLS, read-own, no client writes; the count is service role only.
-- ---------------------------------------------------------------------------

do $$
declare f constant text := 'public.coach_consistency_total_days(uuid)';
begin
  if not (select relrowsecurity from pg_class where oid = 'public.coach_consistency_dates'::regclass) then
    raise exception 'RLS is off on coach_consistency_dates';
  end if;
  if has_table_privilege('anon', 'public.coach_consistency_dates', 'SELECT') then
    raise exception 'anon can read coach_consistency_dates';
  end if;
  if not has_table_privilege('authenticated', 'public.coach_consistency_dates', 'SELECT') then
    raise exception 'authenticated cannot read its own coach_consistency_dates';
  end if;
  if has_table_privilege('authenticated', 'public.coach_consistency_dates', 'INSERT')
    or has_table_privilege('authenticated', 'public.coach_consistency_dates', 'UPDATE')
    or has_table_privilege('authenticated', 'public.coach_consistency_dates', 'DELETE')
    or has_table_privilege('anon', 'public.coach_consistency_dates', 'INSERT')
  then raise exception 'clients can write coach_consistency_dates'; end if;

  if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE') then
    raise exception 'clients can execute coach_consistency_total_days';
  end if;
  if not has_function_privilege('service_role', f, 'EXECUTE') then
    raise exception 'the service role cannot execute coach_consistency_total_days';
  end if;
  if exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
      lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    where n.nspname='public' and p.proname='coach_consistency_total_days'
      and acl.grantee=0 and acl.privilege_type='EXECUTE'
  ) then raise exception 'PUBLIC can execute coach_consistency_total_days'; end if;
  if exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='coach_consistency_total_days'
      and (p.prosecdef or not p.proconfig @> array['search_path=""'] or p.provolatile <> 's')
  ) then raise exception 'coach_consistency_total_days must be a stable invoker function with an empty search_path'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Flag off: a finish writes no ledger row.
-- ---------------------------------------------------------------------------

update public.app_feature_flags set enabled=false where key='pivot_a.enabled';
update public.tasks set status='completed', completed_at='2099-01-01 10:00:00+00' where id='a7a7a7a7-2222-4000-8000-000000000001';
do $$ begin
  if exists(
    select 1 from public.coach_consistency_dates
    where user_id=(select owner_id from public.tasks where id='a7a7a7a7-2222-4000-8000-000000000001')
  ) then raise exception 'a finish with the flag off wrote a ledger row'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Flag on: one row per local day with a finish, for any user.
-- ---------------------------------------------------------------------------

update public.app_feature_flags set enabled=true where key='pivot_a.enabled';

update public.tasks set status='completed', completed_at='2099-01-02 10:00:00+00' where id='a7a7a7a7-2222-4000-8000-000000000002';
update public.tasks set status='completed', completed_at='2099-01-02 18:00:00+00' where id='a7a7a7a7-2222-4000-8000-000000000003';
update public.tasks set status='completed', completed_at='2099-01-06 10:00:00+00' where id='a7a7a7a7-2222-4000-8000-000000000004';
update public.tasks set status='completed', completed_at='2099-01-03 10:00:00+00' where id='b8b8b8b8-2222-4000-8000-000000000001';
-- A start is not a finish.
insert into public.task_events(user_id, task_id, type, occurred_at, local_date)
values ('a7a7a7a7-1111-4111-8111-a7a7a7a7a7a7','a7a7a7a7-2222-4000-8000-000000000005','started','2099-01-08 10:00:00+00','2099-01-08');
-- Re-saving a completed status adds nothing.
update public.tasks set status='completed' where id='a7a7a7a7-2222-4000-8000-000000000002';

set local role service_role;
do $$
begin
  if public.coach_consistency_total_days('a7a7a7a7-1111-4111-8111-a7a7a7a7a7a7') <> 2 then
    raise exception 'expected 2 consistency days for A, got %', public.coach_consistency_total_days('a7a7a7a7-1111-4111-8111-a7a7a7a7a7a7');
  end if;
  if public.coach_consistency_total_days('b8b8b8b8-1111-4111-8111-b8b8b8b8b8b8') <> 1 then
    raise exception 'a finish without a coach profile or character was not counted, or another user''s leaked in';
  end if;
  if public.coach_consistency_total_days('c9c9c9c9-1111-4111-8111-c9c9c9c9c9c9') <> 0 then
    raise exception 'a user with no finishes did not count 0';
  end if;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Deleting finished tasks never lowers the total.
-- ---------------------------------------------------------------------------

delete from public.tasks where id in ('a7a7a7a7-2222-4000-8000-000000000002','a7a7a7a7-2222-4000-8000-000000000003','a7a7a7a7-2222-4000-8000-000000000004');

set local role service_role;
do $$
begin
  if exists(select 1 from public.task_events where user_id='a7a7a7a7-1111-4111-8111-a7a7a7a7a7a7' and type='finished') then
    raise exception 'fixture: the deleted tasks'' finished events did not cascade';
  end if;
  if public.coach_consistency_total_days('a7a7a7a7-1111-4111-8111-a7a7a7a7a7a7') <> 2 then
    raise exception 'deleting finished tasks lowered the consistency total to %', public.coach_consistency_total_days('a7a7a7a7-1111-4111-8111-a7a7a7a7a7a7');
  end if;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Owners read only their own rows and cannot write any.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claim.sub" = 'a7a7a7a7-1111-4111-8111-a7a7a7a7a7a7';
do $$
declare state text;
begin
  if (select count(*) from public.coach_consistency_dates) <> 2
    or exists(select 1 from public.coach_consistency_dates where user_id <> 'a7a7a7a7-1111-4111-8111-a7a7a7a7a7a7')
  then raise exception 'A does not see exactly its own ledger rows'; end if;
  begin
    insert into public.coach_consistency_dates(user_id, local_date) values ('a7a7a7a7-1111-4111-8111-a7a7a7a7a7a7','2099-02-01');
  exception when others then get stacked diagnostics state = returned_sqlstate;
  end;
  if state is distinct from '42501' then raise exception 'a client could add a consistency day (got %)', state; end if;
  state := null;
  begin
    delete from public.coach_consistency_dates where user_id='a7a7a7a7-1111-4111-8111-a7a7a7a7a7a7';
  exception when others then get stacked diagnostics state = returned_sqlstate;
  end;
  if state is distinct from '42501' then raise exception 'a client could delete its consistency days (got %)', state; end if;
  state := null;
  begin
    perform public.coach_consistency_total_days('a7a7a7a7-1111-4111-8111-a7a7a7a7a7a7');
  exception when others then get stacked diagnostics state = returned_sqlstate;
  end;
  if state is distinct from '42501' then raise exception 'authenticated could call coach_consistency_total_days (got %)', state; end if;
end $$;
reset role;

set local role authenticated;
set local "request.jwt.claim.sub" = 'c9c9c9c9-1111-4111-8111-c9c9c9c9c9c9';
do $$ begin
  if exists(select 1 from public.coach_consistency_dates) then raise exception 'another user can read A''s or B''s consistency days'; end if;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Account deletion removes the ledger with the user.
-- ---------------------------------------------------------------------------

delete from auth.users where id='a7a7a7a7-1111-4111-8111-a7a7a7a7a7a7';
do $$ begin
  if exists(select 1 from public.coach_consistency_dates where user_id='a7a7a7a7-1111-4111-8111-a7a7a7a7a7a7') then
    raise exception 'account deletion left consistency days behind';
  end if;
  if not exists(select 1 from public.coach_consistency_dates where user_id='b8b8b8b8-1111-4111-8111-b8b8b8b8b8b8') then
    raise exception 'deleting one account removed another user''s consistency days';
  end if;
end $$;

select extensions.pass('coach_consistency_dates keeps consistency days through task deletion, per user, removed with the account');
select * from extensions.finish();

rollback;
