-- Pivot A Phase 5: age enforcement in the database (PLAN D5 and D6).
--
-- 1. A backstop that does not depend on the dashboard hook toggle: while
--    pivot_a.enabled is on, no auth.users row can be inserted without a live
--    age token. The before_user_created hook (20261031180000) gives the
--    friendly 403; this trigger holds even where the hook was never enabled.
-- 2. set_coach_profile and start_task refuse callers whose age is not verified
--    while Pivot A is on, so the public key cannot reach coach features that
--    the API routes guard. The definitions are copied from
--    20261031170000_pivot_a_pack_status.sql and 20261031120100_pivot_a_core_schema.sql,
--    unchanged except for the age check.

-- Fail fast instead of queueing behind a long transaction while holding locks
-- that block the app. Only effective inside a transaction (as under
-- `supabase db push`); a non-transactional local reset just warns.
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- The sign-up backstop.
-- ---------------------------------------------------------------------------

-- Accepts an unexpired token that is unconsumed (the hook is not enabled
-- here) or that the hook consumed in the last 5 minutes (the hook path), and
-- spends it on the spot: consumed (if not already) and expired. The UPDATE
-- holds the row lock, so a concurrent second sign-up with the same token waits
-- and then finds it spent. handle_new_user, which runs after the insert in the
-- same transaction, then deletes the row as it copies the verification (its
-- 5-minute consumed window matches the consumed_at set here). Should that
-- delete fail, the row stays expired and cannot admit anyone else. Order on
-- auth.users: this BEFORE INSERT trigger, then on_auth_user_created (AFTER
-- INSERT, handle_new_user); the strip trigger only fires on UPDATE.
create or replace function public.require_signup_age_token()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  token text;
  spent text;
begin
  if not public.pivot_flag_enabled('pivot_a.enabled') then
    return new;
  end if;

  token := new.raw_user_meta_data ->> 'age_token';
  if token is not null and char_length(token) between 16 and 200 then
    update public.age_verification_tokens age_token
    set consumed_at = coalesce(age_token.consumed_at, now()),
        expires_at = least(age_token.expires_at, now())
    where age_token.token_hash = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(token, 'UTF8')), 'hex')
      and age_token.expires_at > now()
      and (age_token.consumed_at is null or age_token.consumed_at > now() - interval '5 minutes')
    returning age_token.token_hash into spent;
    if spent is not null then
      return new;
    end if;
  end if;

  raise exception 'age verification required' using errcode = '42501';
end $$;

revoke all on function public.require_signup_age_token() from public, anon, authenticated, service_role;

drop trigger if exists require_signup_age_token on auth.users;
create trigger require_signup_age_token
  before insert on auth.users
  for each row execute function public.require_signup_age_token();

comment on function public.require_signup_age_token() is
  'BEFORE INSERT on auth.users: while pivot_a.enabled is on, refuses a user whose raw_user_meta_data.age_token does not match a live age_verification_tokens row (unexpired, and unconsumed or consumed by the auth hook within 5 minutes), and spends the row it accepts (consumed and expired). Does nothing while Pivot A is off.';

-- ---------------------------------------------------------------------------
-- Coach writes need a verified age.
-- ---------------------------------------------------------------------------

create or replace function public.set_coach_profile(
  p_character_id uuid default null,
  p_timezone text default null
) returns public.user_coach_profiles
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  result public.user_coach_profiles;
begin
  if uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if not public.pivot_flag_enabled('pivot_a.enabled') then
    raise exception 'feature disabled' using errcode = 'P0001';
  end if;
  if not exists(
    select 1 from public.user_coach_profiles profile
    where profile.user_id = uid and profile.age_verified_at is not null
  ) then
    raise exception 'age verification required' using errcode = 'P0001';
  end if;
  if not public.check_rate_limit('coach:set_profile', 30, 60, null) then
    raise exception 'rate limit exceeded' using errcode = 'P0001';
  end if;
  if p_timezone is not null
    and p_timezone is distinct from (select profile.timezone from public.user_coach_profiles profile where profile.user_id = uid)
    and not public.check_rate_limit('coach:timezone', 3, 86400, null)
  then
    raise exception 'rate limit exceeded' using errcode = 'P0001';
  end if;

  -- Selectable: active, and a launch character or an owned pack. Mirrored by
  -- src/lib/coach/characters.ts, which lists what the picker shows.
  if p_character_id is not null and not exists(
    select 1 from public.characters character_row
    where character_row.id = p_character_id
      and character_row.active
      and (
        character_row.is_launch
        or exists(
          select 1 from public.entitlements entitlement
          where entitlement.user_id = uid
            and entitlement.product = 'pack:' || character_row.slug
            and entitlement.status = 'active'
        )
      )
  ) then
    raise exception 'character not found' using errcode = 'P0002';
  end if;

  insert into public.user_coach_profiles as profile (user_id, selected_character_id, timezone)
  values (uid, p_character_id, p_timezone)
  on conflict (user_id) do update set
    selected_character_id = coalesce(excluded.selected_character_id, profile.selected_character_id),
    timezone = coalesce(excluded.timezone, profile.timezone)
  returning * into result;
  return result;
end $$;

revoke all on function public.set_coach_profile(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.set_coach_profile(uuid, text) to authenticated;

comment on function public.set_coach_profile(uuid, text) is
  'Upserts the caller''s coach profile. A null argument leaves that field unchanged. The character must be active and either a launch character or an owned pack (P0002 otherwise); the time zone must be a named zone (22023) and may change at most three times a day (rate limit exceeded). Refuses while pivot_a.enabled is off, and (age verification required) until the caller''s age is verified.';

-- Starts are events, not a task status, so the mobile app and the existing
-- task APIs keep working unchanged. Refusing an unverified start never touches
-- the task itself.
create or replace function public.start_task(p_task_id uuid)
returns public.task_events language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  started_at timestamptz := now();
  started_date date;
  t public.tasks;
  result public.task_events;
begin
  if uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if not public.pivot_flag_enabled('pivot_a.enabled') then
    raise exception 'feature disabled' using errcode = 'P0001';
  end if;
  if not exists(
    select 1 from public.user_coach_profiles profile
    where profile.user_id = uid and profile.age_verified_at is not null
  ) then
    raise exception 'age verification required' using errcode = 'P0001';
  end if;
  if not public.check_rate_limit('task:start', 60, 60, null) then
    raise exception 'rate limit exceeded' using errcode = 'P0001';
  end if;
  select * into t from public.tasks where id = p_task_id and owner_id = uid;
  if not found then raise exception 'task not found' using errcode = 'P0002'; end if;
  if t.status <> 'pending' then raise exception 'task is not pending' using errcode = '22023'; end if;

  started_date := public.coach_local_date(uid, started_at);
  insert into public.task_events(user_id, task_id, type, occurred_at, local_date)
  values (uid, t.id, 'started', started_at, started_date)
  on conflict (task_id, local_date) where type = 'started' do nothing
  returning * into result;
  -- Already started today: hand back that event instead of adding another.
  if not found then
    select * into result from public.task_events event
    where event.task_id = t.id and event.local_date = started_date and event.type = 'started';
  end if;
  return result;
end $$;

revoke all on function public.start_task(uuid) from public, anon, authenticated, service_role;
grant execute on function public.start_task(uuid) to authenticated;

comment on function public.start_task(uuid) is
  'Records one started event per task per local day for the caller''s pending task, returning the existing one on repeat calls. Refuses while pivot_a.enabled is off, and (age verification required) until the caller''s age is verified.';

notify pgrst, 'reload schema';
