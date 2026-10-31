-- Pivot A Phase 2: the one write path for a user's coach profile.
--
-- user_coach_profiles has no client write grant, so choosing a character or a
-- time zone goes through set_coach_profile(). It refuses while
-- `pivot_a.enabled` is off, only ever touches the caller's own row, and only
-- accepts a character the caller may select: active, and either a launch
-- character or one whose pack the caller owns. The time zone is checked by the
-- existing validate_user_coach_timezone trigger.

-- Fail fast instead of queueing behind a long transaction while holding locks
-- that block the app. Only effective inside a transaction (as under
-- `supabase db push`); a non-transactional local reset just warns.
set local lock_timeout = '5s';

-- A null argument leaves that field as it is, so the character and the time
-- zone can be saved in separate steps.
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
  'Upserts the caller''s coach profile. A null argument leaves that field unchanged. The character must be active and either a launch character or an owned pack (P0002 otherwise); the time zone must be a named zone (22023). Refuses while pivot_a.enabled is off.';

notify pgrst, 'reload schema';
