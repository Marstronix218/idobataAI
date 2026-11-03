begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(1);

-- Pivot A Phase 8 (20261031220000_pivot_a_retention.sql): reactions older than
-- 30 days and age tokens expired more than a day ago are purged, in batches,
-- by a service-role-only function. now() is fixed for the whole transaction,
-- so the ages below are exact.

-- Users are created while Pivot A is off, so the sign-up age backstop allows them.
update public.app_feature_flags set enabled=false where key='pivot_a.enabled';

insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('e8e8e8e8-8888-4888-8888-e8e8e8e8e8e8','authenticated','authenticated','retention@example.test',crypt('test-password',gen_salt('bf')),now(),'{}','{"username":"retention_a"}',now(),now());

insert into public.characters(id, slug, name, role, is_launch, sheet, active)
values ('c8800000-0000-4000-8000-000000000001','retention-coach','Retention Coach','coach',true,'{}',true);

insert into public.character_reactions(id, user_id, character_id, event, source, text, created_at)
values
  ('e8000000-0000-4000-8000-000000000031','e8e8e8e8-8888-4888-8888-e8e8e8e8e8e8','c8800000-0000-4000-8000-000000000001','session_nudge','prewritten','31 days old', now() - interval '31 days'),
  ('e8000000-0000-4000-8000-000000000400','e8e8e8e8-8888-4888-8888-e8e8e8e8e8e8','c8800000-0000-4000-8000-000000000001','session_nudge','prewritten','400 days old', now() - interval '400 days'),
  ('e8000000-0000-4000-8000-000000000030','e8e8e8e8-8888-4888-8888-e8e8e8e8e8e8','c8800000-0000-4000-8000-000000000001','session_nudge','prewritten','exactly 30 days old', now() - interval '30 days'),
  ('e8000000-0000-4000-8000-000000000029','e8e8e8e8-8888-4888-8888-e8e8e8e8e8e8','c8800000-0000-4000-8000-000000000001','session_nudge','ai','29 days old', now() - interval '29 days'),
  ('e8000000-0000-4000-8000-000000000000','e8e8e8e8-8888-4888-8888-e8e8e8e8e8e8','c8800000-0000-4000-8000-000000000001','session_nudge','ai','fresh', now());

insert into public.age_verification_tokens(token_hash, method, verified_at, expires_at, consumed_at)
values
  (repeat('a', 64), 'self_attested', now() - interval '2 days', now() - interval '2 days' + interval '15 minutes', null),
  (repeat('b', 64), 'self_attested', now() - interval '3 days', now() - interval '3 days' + interval '15 minutes', now() - interval '3 days'),
  (repeat('c', 64), 'self_attested', now() - interval '2 hours', now() - interval '2 hours' + interval '15 minutes', null),
  (repeat('d', 64), 'self_attested', now(), now() + interval '15 minutes', null);

do $$
declare
  offenders text;
begin
  -- Grants: the service role only, never PUBLIC; definer with an empty search_path.
  if has_function_privilege('anon', 'public.purge_pivot_a_expired(integer)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.purge_pivot_a_expired(integer)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.purge_pivot_a_expired(integer)', 'EXECUTE')
  then raise exception 'purge_pivot_a_expired must be service-role only'; end if;
  if exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
      lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    where n.nspname='public' and p.proname='purge_pivot_a_expired' and acl.grantee=0 and acl.privilege_type='EXECUTE'
  ) then raise exception 'PUBLIC can execute purge_pivot_a_expired'; end if;
  select string_agg(p.proname, ', ') into offenders
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='purge_pivot_a_expired'
    and (not p.prosecdef or not p.proconfig @> array['search_path=""']);
  if offenders is not null then raise exception 'must be security definer with an empty search_path: %', offenders; end if;

  -- The service role reads tasks for reactions and splits (granted in the same
  -- migration, for fresh projects), and the legacy flag table for getFlags().
  if not has_table_privilege('service_role', 'public.tasks', 'SELECT') then
    raise exception 'service_role cannot read public.tasks: reactions and splits would fail';
  end if;
  if not has_table_privilege('service_role', 'public.app_feature_flags', 'SELECT') then
    raise exception 'service_role cannot read public.app_feature_flags';
  end if;
  -- The character seed links launch characters to persona art by slug.
  if not (has_column_privilege('service_role', 'public.social_companions', 'id', 'SELECT')
      and has_column_privilege('service_role', 'public.social_companions', 'slug', 'SELECT')) then
    raise exception 'service_role cannot look up persona slugs: npm run content:seed would fail';
  end if;
  -- Account deletion writes its audit row with the service role.
  if not (has_table_privilege('service_role', 'public.account_deletion_requests', 'INSERT')
      and has_table_privilege('service_role', 'public.account_deletion_requests', 'UPDATE')
      and has_table_privilege('service_role', 'public.account_deletion_requests', 'SELECT')) then
    raise exception 'service_role cannot record account deletion requests: account deletion would fail';
  end if;

  -- Index support for both range deletes.
  if not exists(select 1 from pg_indexes where schemaname='public' and tablename='character_reactions' and indexdef like '%(created_at)%') then
    raise exception 'character_reactions has no created_at index for the purge';
  end if;
  if not exists(select 1 from pg_indexes where schemaname='public' and tablename='age_verification_tokens' and indexdef like '%(expires_at)%') then
    raise exception 'age_verification_tokens has no expires_at index for the purge';
  end if;
end $$;

-- Clients cannot call it.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e8e8e8e8-8888-4888-8888-e8e8e8e8e8e8","role":"authenticated"}', true);
do $$
begin
  perform public.purge_pivot_a_expired();
  raise exception 'authenticated could purge';
exception when insufficient_privilege then null;
end $$;
reset role;
set local role anon;
do $$
begin
  perform public.purge_pivot_a_expired();
  raise exception 'anon could purge';
exception when insufficient_privilege then null;
end $$;
reset role;

-- The service role purges in batches: one row per table per call with
-- p_batch_size 1, `more` while a batch came back full.
set local role service_role;
do $$
declare
  result jsonb;
begin
  result := public.purge_pivot_a_expired(1);
  if result <> '{"character_reactions": 1, "age_verification_tokens": 1, "more": true}'::jsonb then
    raise exception 'first batch: %', result;
  end if;
  result := public.purge_pivot_a_expired(1);
  if result <> '{"character_reactions": 1, "age_verification_tokens": 1, "more": true}'::jsonb then
    raise exception 'second batch: %', result;
  end if;
  result := public.purge_pivot_a_expired(1);
  if result <> '{"character_reactions": 0, "age_verification_tokens": 0, "more": false}'::jsonb then
    raise exception 'third call should find nothing left: %', result;
  end if;
  -- Defaults and clamping: nothing left, so zero counts and no `more`.
  result := public.purge_pivot_a_expired();
  if result <> '{"character_reactions": 0, "age_verification_tokens": 0, "more": false}'::jsonb then
    raise exception 'default batch: %', result;
  end if;
  result := public.purge_pivot_a_expired(0);
  if result <> '{"character_reactions": 0, "age_verification_tokens": 0, "more": false}'::jsonb then
    raise exception 'a batch size below 1 is clamped, not an error: %', result;
  end if;
end $$;
reset role;

do $$
declare
  remaining text;
begin
  select string_agg(text, ', ' order by created_at) into remaining from public.character_reactions
  where user_id='e8e8e8e8-8888-4888-8888-e8e8e8e8e8e8';
  if remaining is distinct from 'exactly 30 days old, 29 days old, fresh' then
    raise exception 'reactions older than 30 days must go and the rest stay; left: %', remaining;
  end if;

  select string_agg(left(token_hash, 1), ', ' order by token_hash) into remaining from public.age_verification_tokens
  where token_hash in (repeat('a', 64), repeat('b', 64), repeat('c', 64), repeat('d', 64));
  if remaining is distinct from 'c, d' then
    raise exception 'tokens expired over a day ago (consumed or not) must go, recent and live ones stay; left: %', remaining;
  end if;
end $$;

-- A large first run: 12 old reactions with batches of 5 take three calls.
insert into public.character_reactions(user_id, character_id, event, source, text, created_at)
select 'e8e8e8e8-8888-4888-8888-e8e8e8e8e8e8', 'c8800000-0000-4000-8000-000000000001', 'session_nudge', 'prewritten',
  'backlog ' || n, now() - interval '45 days' - n * interval '1 hour'
from generate_series(1, 12) n;

set local role service_role;
do $$
declare
  result jsonb;
  total integer := 0;
  calls integer := 0;
begin
  loop
    result := public.purge_pivot_a_expired(5);
    calls := calls + 1;
    total := total + (result ->> 'character_reactions')::integer;
    exit when not (result ->> 'more')::boolean or calls > 10;
  end loop;
  if total <> 12 or calls <> 3 then
    raise exception 'backlog: % deleted in % calls, expected 12 in 3', total, calls;
  end if;
end $$;
reset role;

do $$
begin
  if exists(select 1 from public.character_reactions where text like 'backlog %') then
    raise exception 'the backlog was not fully purged';
  end if;
  if (select count(*) from public.character_reactions where user_id='e8e8e8e8-8888-4888-8888-e8e8e8e8e8e8') <> 3 then
    raise exception 'the backlog purge touched reactions under 30 days old';
  end if;
end $$;

select extensions.pass('Pivot A retention purge: 30-day reactions, expired age tokens, batches, service-role only');
select * from extensions.finish();

rollback;
