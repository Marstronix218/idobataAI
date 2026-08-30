-- The other half of the AI graph, plus the favorites the profile card shows.
--
-- 20260830030000 gave the profile three lists: followers, following, and AI
-- followers. That left the graph lopsided -- `companion_followed_at` (a persona
-- follows you) had a count and a list, while `user_followed_at` (you follow a
-- persona) had neither, even though it is the direction the reader actually
-- chose. The profile page now reads as two directions, each filtered by
-- audience, so this adds the missing quadrant.
--
-- Favorites are the third function here rather than a fourth list because they
-- are capped at three by
-- `user_companion_relationships_favorite_requires_follow` (20260830040000).
-- A set that can never grow belongs on the card itself, not behind a tap.

-- `user_companion_relationships_favorites_idx` (20260830040000) covers the
-- favorites read. The follow direction is ordered by a different column, and
-- the partial predicate keeps the index to rows that can actually appear.
create index if not exists user_companion_relationships_user_followed_idx
  on public.user_companion_relationships(user_id, user_followed_at desc)
  where user_followed_at is not null;

-- Counts describe the account, so this matches `get_profile_ai_follower_count`
-- (20260828050000) exactly: visibility does not withhold it, but a block in
-- either direction reads as "no such profile" rather than as zero.
create or replace function public.get_profile_ai_following_count(p_user_id uuid)
returns bigint language plpgsql stable security definer set search_path = '' as $$
declare viewer_id uuid := auth.uid(); result bigint;
begin
  if viewer_id is null then
    raise exception 'authentication required' using errcode='42501';
  end if;
  if not exists(select 1 from public.user_profiles profile where profile.id=p_user_id)
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
    and relationship.user_followed_at is not null;
  return result;
end $$;

-- Dropped rather than replaced: `create or replace` cannot widen a function's
-- OUT-parameter row type, and 20260830030000 already created this one with
-- seven columns. The drop takes the comment and the grants with it, so both are
-- restored at the bottom of this file alongside the new functions'.
--
-- Recreated only to add `is_favorite`, so both AI lists return one row shape
-- and the client does not branch on which quadrant it is rendering. The flag is
-- the *profile owner's*, not the reader's: it says "this is one of the three
-- personas they keep closest", which is what the star on the row means. The
-- reader's own relationship stays in `viewer_follows`, as before.
drop function if exists public.list_profile_ai_followers(uuid, integer, integer);

create function public.list_profile_ai_followers(
  p_user_id uuid,
  p_limit integer default 30,
  p_offset integer default 0
)
returns table (
  id uuid,
  slug text,
  name text,
  avatar_url text,
  personality text,
  followed_at timestamptz,
  viewer_follows boolean,
  is_favorite boolean
)
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  perform public.assert_profile_follow_list_access(p_user_id, uid);
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'invalid follow list limit' using errcode='22023';
  end if;
  if p_offset is null or p_offset < 0 or p_offset > 10000 then
    raise exception 'invalid follow list offset' using errcode='22023';
  end if;

  return query
  select
    c.id,
    c.slug,
    c.name,
    c.avatar_url,
    c.personality,
    r.companion_followed_at,
    exists(
      select 1 from public.user_companion_relationships v
      where v.user_id = uid and v.companion_id = c.id and v.user_followed_at is not null
    ),
    r.is_favorite
  from public.user_companion_relationships r
  join public.social_companions c on c.id = r.companion_id and c.active
  where r.user_id = p_user_id
    and r.companion_follow_state = 'following'
  order by r.companion_followed_at desc nulls last, c.name asc
  limit p_limit offset p_offset;
end $$;

-- The personas this profile follows, gated like every other list here. Ordered
-- favorites first so the three that also appear on the card are the three at
-- the top of the list they open, rather than scattered through it.
create or replace function public.list_profile_ai_following(
  p_user_id uuid,
  p_limit integer default 30,
  p_offset integer default 0
)
returns table (
  id uuid,
  slug text,
  name text,
  avatar_url text,
  personality text,
  followed_at timestamptz,
  viewer_follows boolean,
  is_favorite boolean
)
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  perform public.assert_profile_follow_list_access(p_user_id, uid);
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'invalid follow list limit' using errcode='22023';
  end if;
  if p_offset is null or p_offset < 0 or p_offset > 10000 then
    raise exception 'invalid follow list offset' using errcode='22023';
  end if;

  return query
  select
    c.id,
    c.slug,
    c.name,
    c.avatar_url,
    c.personality,
    r.user_followed_at,
    exists(
      select 1 from public.user_companion_relationships v
      where v.user_id = uid and v.companion_id = c.id and v.user_followed_at is not null
    ),
    r.is_favorite
  from public.user_companion_relationships r
  join public.social_companions c on c.id = r.companion_id and c.active
  where r.user_id = p_user_id
    and r.user_followed_at is not null
  order by r.is_favorite desc, r.user_followed_at desc nulls last, c.name asc
  limit p_limit offset p_offset;
end $$;

-- The card strip. No limit argument: the constraint already caps this at three,
-- so a caller cannot ask for a longer list than the product allows.
--
-- Gated as a list rather than as a count, because that is what it is -- a slice
-- of the social graph. A private profile therefore shows its favorites to the
-- people who can already see its timeline, and to nobody else. The card's own
-- counts stay visible to everyone, as before.
create or replace function public.list_profile_favorite_personas(p_user_id uuid)
returns table (
  id uuid,
  slug text,
  name text,
  avatar_url text,
  personality text,
  followed_at timestamptz,
  viewer_follows boolean,
  is_favorite boolean
)
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  perform public.assert_profile_follow_list_access(p_user_id, uid);

  return query
  select
    c.id,
    c.slug,
    c.name,
    c.avatar_url,
    c.personality,
    r.favorited_at,
    exists(
      select 1 from public.user_companion_relationships v
      where v.user_id = uid and v.companion_id = c.id and v.user_followed_at is not null
    ),
    true
  from public.user_companion_relationships r
  join public.social_companions c on c.id = r.companion_id and c.active
  where r.user_id = p_user_id
    and r.is_favorite
  order by r.favorited_at desc nulls last, c.name asc
  limit 3;
end $$;

comment on function public.list_profile_ai_followers(uuid, integer, integer) is
  'Active AI personas following a profile, matching get_profile_ai_follower_count exactly.';
comment on function public.get_profile_ai_following_count(uuid) is
  'Counts the active AI personas a profile follows, matching get_profile_ai_follower_count''s gate.';
comment on function public.list_profile_ai_following(uuid, integer, integer) is
  'Active AI personas a profile follows, favorites first. Gated like the timeline.';
comment on function public.list_profile_favorite_personas(uuid) is
  'The at most three AI personas a profile has favorited, for the profile card. Gated like the timeline.';

revoke all on function
  public.list_profile_ai_followers(uuid, integer, integer),
  public.get_profile_ai_following_count(uuid),
  public.list_profile_ai_following(uuid, integer, integer),
  public.list_profile_favorite_personas(uuid)
  from public, anon, authenticated;
grant execute on function
  public.list_profile_ai_followers(uuid, integer, integer),
  public.get_profile_ai_following_count(uuid),
  public.list_profile_ai_following(uuid, integer, integer),
  public.list_profile_favorite_personas(uuid)
  to authenticated;

notify pgrst, 'reload schema';
