-- Atomic AI cap enforcement. The reaction engine used to read usage, decide,
-- call the model and only then record usage, so concurrent requests could all
-- pass the same cap check. reserve_ai_usage() checks and claims one unit in a
-- single per-user serialized step; release_ai_usage() hands a delivered unit
-- back when the reserved AI result is not shown (fallback, crisis, lost insert
-- race). Attempts are never released, so a ceiling on attempts also bounds
-- how many model calls a user can trigger.
--
-- set_coach_profile() also limits time zone changes, because hopping between
-- UTC-12 and UTC+14 would otherwise open a fresh local-day cap.

-- Fail fast instead of queueing behind a long transaction. Only effective
-- inside a transaction (as under `supabase db push`); a local reset just warns.
set local lock_timeout = '5s';

alter table public.ai_usage_daily
  add column if not exists reaction_attempts integer not null default 0 check (reaction_attempts >= 0),
  add column if not exists split_attempts integer not null default 0 check (split_attempts >= 0);

-- True and one delivered unit plus one attempt claimed for p_date, or false and
-- nothing written. The window is the p_window_days local dates ending p_date.
create or replace function public.reserve_ai_usage(
  p_user_id uuid,
  p_kind text,
  p_date date,
  p_window_days integer,
  p_cap integer,
  p_attempt_ceiling integer
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  is_reaction boolean;
  delivered bigint;
  attempts bigint;
begin
  if p_kind is null or p_kind not in ('reaction','split') then
    raise exception 'unknown AI usage kind: %', coalesce(p_kind, '<null>') using errcode = '22023';
  end if;
  -- A null cap would compare as unknown and let every request through.
  if p_user_id is null or p_date is null or p_window_days is null or p_window_days < 1
    or p_cap is null or p_attempt_ceiling is null then
    raise exception 'invalid AI usage reservation' using errcode = '22023';
  end if;
  is_reaction := p_kind = 'reaction';

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ai-usage:' || p_user_id::text, 0));

  select
    coalesce(sum(case when is_reaction then usage.reactions else usage.splits end), 0),
    coalesce(sum(case when is_reaction then usage.reaction_attempts else usage.split_attempts end), 0)
  into delivered, attempts
  from public.ai_usage_daily usage
  where usage.user_id = p_user_id
    and usage.date between p_date - (p_window_days - 1) and p_date;

  if delivered >= p_cap or attempts >= p_attempt_ceiling then return false; end if;

  insert into public.ai_usage_daily as usage (user_id, date, reactions, splits, reaction_attempts, split_attempts)
  values (
    p_user_id, p_date,
    case when is_reaction then 1 else 0 end, case when is_reaction then 0 else 1 end,
    case when is_reaction then 1 else 0 end, case when is_reaction then 0 else 1 end
  )
  on conflict (user_id, date) do update set
    reactions = usage.reactions + excluded.reactions,
    splits = usage.splits + excluded.splits,
    reaction_attempts = usage.reaction_attempts + excluded.reaction_attempts,
    split_attempts = usage.split_attempts + excluded.split_attempts;
  return true;
end $$;

-- Gives back one delivered unit for p_date, never below zero. Attempts stay.
create or replace function public.release_ai_usage(
  p_user_id uuid,
  p_kind text,
  p_date date
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_kind is null or p_kind not in ('reaction','split') then
    raise exception 'unknown AI usage kind: %', coalesce(p_kind, '<null>') using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ai-usage:' || p_user_id::text, 0));

  update public.ai_usage_daily usage set
    reactions = case when p_kind = 'reaction' then greatest(usage.reactions - 1, 0) else usage.reactions end,
    splits = case when p_kind = 'split' then greatest(usage.splits - 1, 0) else usage.splits end
  where usage.user_id = p_user_id and usage.date = p_date;
end $$;

revoke all on function
  public.reserve_ai_usage(uuid, text, date, integer, integer, integer),
  public.release_ai_usage(uuid, text, date)
  from public, anon, authenticated;
grant execute on function
  public.reserve_ai_usage(uuid, text, date, integer, integer, integer),
  public.release_ai_usage(uuid, text, date)
  to service_role;

comment on function public.reserve_ai_usage(uuid, text, date, integer, integer, integer) is
  'Atomically claims one AI reaction or split for the user''s local date if the window''s delivered count is under p_cap and its attempts are under p_attempt_ceiling. Service role only.';
comment on function public.release_ai_usage(uuid, text, date) is
  'Returns one delivered AI reaction or split for a date (floored at 0) when the reserved result was not shown. Attempts are kept. Service role only.';

-- Same as 20261031130000_pivot_a_coach_profile.sql, plus a limit of three time
-- zone changes per day. Saving the zone already stored does not count; the
-- first zone a profile gets does.
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
            and entitlement.status in ('active','trialing')
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
  'Upserts the caller''s coach profile. A null argument leaves that field unchanged. The character must be active and either a launch character or an owned pack (P0002 otherwise); the time zone must be a named zone (22023) and may change at most three times a day (rate limit exceeded). Refuses while pivot_a.enabled is off.';

notify pgrst, 'reload schema';
