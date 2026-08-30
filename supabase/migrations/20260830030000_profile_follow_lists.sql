-- Follower and following lists, human and AI.
--
-- The profile header has carried three counts since 20260828050000 but no way
-- to open any of them: `Followers` and `Following` were plain text, and
-- `AI followers` linked to `/ai-personas` -- the *global* persona directory,
-- which on someone else's profile answers a different question than the number
-- next to it. The counts already exist as definer functions; the lists behind
-- them did not.
--
-- Three functions rather than one, because the two relationships are not the
-- same shape: a human follow is an edge in `user_follows` that a private
-- account gates with a request, while an AI follow is a state on
-- `user_companion_relationships` with no request of its own and no reverse
-- direction the profile reports. A single merged list would have to branch on
-- every column it returned.

-- Both directions are read newest-first. `user_follows_followed_idx`
-- (20260820050000) and the primary key cover the lookups but not the sort, so
-- an unindexed ordering would be the one part of this that does not scale.
create index if not exists user_follows_followed_created_idx
  on public.user_follows(followed_id, created_at desc);
create index if not exists user_follows_follower_created_idx
  on public.user_follows(follower_id, created_at desc);

-- The counts describe the account, so a protected profile reports them to
-- anyone. The *lists* are the account's social graph, which is exactly what
-- protecting a profile withholds -- so these follow the timeline's gate
-- (`isOwner || public || approved follower`) rather than the card's.
--
-- Two distinct refusals, because the page renders them differently: a missing
-- or mutually blocked profile is P0002, which the app already maps to a 404 and
-- which keeps a block unconfirmable by URL; a protected one is 42501, a 403
-- that admits the account exists. Not granted to `authenticated`: it is called
-- only from the definer functions below, which run as this function's owner.
create or replace function public.assert_profile_follow_list_access(p_user_id uuid, p_viewer uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
declare target_visibility text;
begin
  if p_viewer is null then raise exception 'authentication required' using errcode='42501'; end if;

  select p.profile_visibility::text into target_visibility
  from public.user_profiles p
  where p.id = p_user_id
    and not exists(
      select 1 from public.blocked_users b
      where (b.blocker_id = p_viewer and b.blocked_id = p.id)
         or (b.blocked_id = p_viewer and b.blocker_id = p.id)
    );
  if target_visibility is null then
    raise exception 'profile not found' using errcode='P0002';
  end if;

  if p_user_id <> p_viewer
    and target_visibility <> 'public'
    and not exists(
      select 1 from public.user_follows f
      where f.follower_id = p_viewer and f.followed_id = p_user_id
    )
  then
    raise exception 'profile follows are protected' using errcode='42501';
  end if;
end $$;

-- The people following this profile. `viewer_follows` and `viewer_requested`
-- are the same pair `get_profile_follow_summary` returns, for the same reason:
-- one row's button reads Follow, Requested or Following depending on where the
-- reader already stands with it. `is_viewer` marks the reader's own row, which
-- gets no button at all.
--
-- A person the reader has blocked in either direction is omitted rather than
-- shown greyed out, matching `get_follow_requests` and the directory.
create or replace function public.list_profile_followers(
  p_user_id uuid,
  p_limit integer default 30,
  p_offset integer default 0
)
returns table (
  id uuid,
  username text,
  display_name text,
  avatar_url text,
  bio text,
  profile_visibility text,
  followed_at timestamptz,
  viewer_follows boolean,
  viewer_requested boolean,
  is_viewer boolean
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
    p.id,
    p.username,
    p.display_name,
    p.avatar_url,
    p.bio,
    p.profile_visibility::text,
    f.created_at,
    exists(select 1 from public.user_follows v where v.follower_id = uid and v.followed_id = p.id),
    exists(select 1 from public.follow_requests r where r.requester_id = uid and r.target_id = p.id),
    p.id = uid
  from public.user_follows f
  join public.user_profiles p on p.id = f.follower_id
  where f.followed_id = p_user_id
    and not exists(
      select 1 from public.blocked_users b
      where (b.blocker_id = uid and b.blocked_id = p.id)
         or (b.blocked_id = uid and b.blocker_id = p.id)
    )
  order by f.created_at desc, p.username asc
  limit p_limit offset p_offset;
end $$;

-- The other direction of the same edge, gated identically.
create or replace function public.list_profile_following(
  p_user_id uuid,
  p_limit integer default 30,
  p_offset integer default 0
)
returns table (
  id uuid,
  username text,
  display_name text,
  avatar_url text,
  bio text,
  profile_visibility text,
  followed_at timestamptz,
  viewer_follows boolean,
  viewer_requested boolean,
  is_viewer boolean
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
    p.id,
    p.username,
    p.display_name,
    p.avatar_url,
    p.bio,
    p.profile_visibility::text,
    f.created_at,
    exists(select 1 from public.user_follows v where v.follower_id = uid and v.followed_id = p.id),
    exists(select 1 from public.follow_requests r where r.requester_id = uid and r.target_id = p.id),
    p.id = uid
  from public.user_follows f
  join public.user_profiles p on p.id = f.followed_id
  where f.follower_id = p_user_id
    and not exists(
      select 1 from public.blocked_users b
      where (b.blocker_id = uid and b.blocked_id = p.id)
         or (b.blocked_id = uid and b.blocker_id = p.id)
    )
  order by f.created_at desc, p.username asc
  limit p_limit offset p_offset;
end $$;

-- The personas behind the `AI followers` count. The predicate is deliberately
-- identical to `get_profile_ai_follower_count` (20260828050000) -- active
-- persona, `companion_follow_state = 'following'` -- so the number and the list
-- can never disagree. Personas carry no visibility or blocking rules of their
-- own, so the only gate is the profile's.
--
-- `viewer_follows` is the reader's own relationship with the persona, not the
-- profile owner's: on someone else's page the useful action is "follow them
-- too", the same thing the directory offers.
create or replace function public.list_profile_ai_followers(
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
  viewer_follows boolean
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
    )
  from public.user_companion_relationships r
  join public.social_companions c on c.id = r.companion_id and c.active
  where r.user_id = p_user_id
    and r.companion_follow_state = 'following'
  order by r.companion_followed_at desc nulls last, c.name asc
  limit p_limit offset p_offset;
end $$;

comment on function public.list_profile_followers(uuid, integer, integer) is
  'People following a profile. Gated like the timeline: owner, public profile, or approved follower.';
comment on function public.list_profile_following(uuid, integer, integer) is
  'People a profile follows. Gated like the timeline: owner, public profile, or approved follower.';
comment on function public.list_profile_ai_followers(uuid, integer, integer) is
  'Active AI personas following a profile, matching get_profile_ai_follower_count exactly.';

revoke all on function
  public.assert_profile_follow_list_access(uuid, uuid),
  public.list_profile_followers(uuid, integer, integer),
  public.list_profile_following(uuid, integer, integer),
  public.list_profile_ai_followers(uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function
  public.list_profile_followers(uuid, integer, integer),
  public.list_profile_following(uuid, integer, integer),
  public.list_profile_ai_followers(uuid, integer, integer)
  to authenticated;

notify pgrst, 'reload schema';
