-- Pack ownership means an `active` pack entitlement, everywhere. Packs are
-- one-time purchases, so only Plus has a trial: set_coach_profile stops
-- accepting `trialing` packs (it used to, while the story and resolvePlan did
-- not), and the table now refuses a trialing pack row outright.
--
-- set_coach_profile is the definition from
-- 20261031150000_pivot_a_ai_usage_reservation.sql with only the pack status
-- rule changed.

-- Fail fast instead of queueing behind a long transaction. Only effective
-- inside a transaction (as under `supabase db push`); a local reset just warns.
set local lock_timeout = '5s';

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
  'Upserts the caller''s coach profile. A null argument leaves that field unchanged. The character must be active and either a launch character or an owned pack (P0002 otherwise); the time zone must be a named zone (22023) and may change at most three times a day (rate limit exceeded). Refuses while pivot_a.enabled is off.';


-- Nothing writes pack entitlements yet (Stripe arrives in Phase 6), so no
-- existing row can fail this check.
alter table public.entitlements drop constraint if exists entitlements_trialing_plus_only;
alter table public.entitlements
  add constraint entitlements_trialing_plus_only check (product = 'plus' or status <> 'trialing');

notify pgrst, 'reload schema';
