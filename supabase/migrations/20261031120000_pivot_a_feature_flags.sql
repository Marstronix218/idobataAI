-- Pivot A ("Character Coach") feature flags. They live in app_feature_flags, so
-- one Supabase project is one environment. Only `pivot_a.enabled` is seeded:
-- the other four keys derive their value from it while their row is absent,
-- which keeps today's product unchanged until the flag is turned on.
--
-- The resolution rules below must match `resolveFlags()` in
-- src/lib/domain/feature-flags.ts exactly; pivot_a_contract.sql covers both.

-- Fail fast instead of queueing behind a long transaction. Only effective
-- inside a transaction (as under `supabase db push`); a local reset just warns.
set local lock_timeout = '5s';

insert into public.app_feature_flags(key, enabled, description) values
  ('pivot_a.enabled', false, 'Pivot A "Character Coach". Off keeps the social beta unchanged; on switches persona chat, persona autoposting and persona reactions off.')
on conflict (key) do nothing;

create or replace function public.pivot_flag_enabled(p_key text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  pivot boolean;
  stored boolean;
begin
  if p_key is null or p_key not in (
    'pivot_a.enabled', 'social_feed.enabled', 'persona_chat.enabled',
    'persona_autopost.enabled', 'share_win.enabled'
  ) then
    raise exception 'unknown pivot flag: %', coalesce(p_key, '<null>') using errcode = '22023';
  end if;

  select flag.enabled into pivot from public.app_feature_flags flag where flag.key = 'pivot_a.enabled';
  pivot := coalesce(pivot, false);
  select flag.enabled into stored from public.app_feature_flags flag where flag.key = p_key;

  return case p_key
    when 'pivot_a.enabled' then pivot
    when 'social_feed.enabled' then coalesce(stored, not pivot)
    -- Persona chat and autoposting are guardrails, so Pivot A forces them off
    -- whatever their row says.
    when 'persona_chat.enabled' then case when pivot then false else coalesce(stored, true) end
    when 'persona_autopost.enabled' then case when pivot then false else coalesce(stored, true) end
    when 'share_win.enabled' then coalesce(stored, true)
  end;
end $$;

-- Sharing is people-only under Pivot A, so persona likes, replies, quotes and
-- thread replies (every AI_PERSONA_* key) stop while it is on. Other keys keep
-- the original rule, where a missing row means on.
create or replace function public.feature_flag_enabled(p_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when starts_with(p_key, 'AI_PERSONA_') and public.pivot_flag_enabled('pivot_a.enabled') then false
    else coalesce((select flag.enabled from public.app_feature_flags flag where flag.key = p_key), true)
  end;
$$;

revoke all on function public.pivot_flag_enabled(text), public.feature_flag_enabled(text)
  from public, anon, authenticated;
grant execute on function public.pivot_flag_enabled(text), public.feature_flag_enabled(text)
  to service_role;

comment on function public.pivot_flag_enabled(text) is
  'Resolves a Pivot A flag. A missing row derives its default from pivot_a.enabled; unknown keys raise 22023.';

notify pgrst, 'reload schema';
