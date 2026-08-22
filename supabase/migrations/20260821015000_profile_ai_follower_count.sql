-- Expose only the aggregate needed by public profile pages. The definer
-- function enforces profile visibility and block boundaries before counting
-- private companion relationship rows.
create or replace function public.get_profile_ai_follower_count(p_user_id uuid)
returns bigint language plpgsql stable security definer set search_path = '' as $$
declare viewer_id uuid := auth.uid(); visibility text; result bigint;
begin
  if viewer_id is null then
    raise exception 'authentication required' using errcode='42501';
  end if;
  select profile.profile_visibility::text into visibility
  from public.user_profiles profile
  where profile.id=p_user_id;
  if not found
    or (visibility='private' and viewer_id is distinct from p_user_id)
    or exists(
      select 1 from public.blocked_users blocked
      where (blocked.blocker_id=viewer_id and blocked.blocked_id=p_user_id)
         or (blocked.blocked_id=viewer_id and blocked.blocker_id=p_user_id)
    )
  then
    raise exception 'profile not found' using errcode='P0002';
  end if;

  select count(*) into result
  from public.user_companion_relationships relationship
  join public.social_companions companion
    on companion.id=relationship.companion_id and companion.active
  where relationship.user_id=p_user_id
    and relationship.companion_follow_state='following';
  return result;
end $$;

revoke all on function public.get_profile_ai_follower_count(uuid)
  from public, anon, authenticated;
grant execute on function public.get_profile_ai_follower_count(uuid)
  to authenticated;

comment on function public.get_profile_ai_follower_count(uuid) is
  'Counts accepted active AI followers for a profile without exposing private relationship rows.';

notify pgrst, 'reload schema';
