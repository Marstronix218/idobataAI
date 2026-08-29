-- Private profiles become visible-but-restricted, and gain follow requests.
--
-- Until now `private` meant *unreachable*: `profiles_read` (20260817010000)
-- hides the row outright, so `/u/<handle>` for a private account with no public
-- posts rendered a 404, and an account that happened to have one public post
-- rendered a bare "This profile is private" card with no bio, no join date, no
-- counts and no way to ask for access. Neither is what a protected account
-- means to a reader: the person exists, their identity is public, and the
-- *posts* are what is withheld.
--
-- Two pieces are needed for that:
--   1. a fixed, definer-owned projection of any profile's public card, so the
--      page can render an identity it is not allowed to select; and
--   2. a follow request, so "restricted" has a door in it.
--
-- The private columns stay private. The card below is a deliberate subset --
-- no `xp`, no `daily_goal`, no `last_completion_date` (a per-user activity
-- timeline), no default-visibility settings -- and the base-table policy is
-- widened only for people the owner has actually approved.

-- ---------------------------------------------------------------------------
-- Follow requests
-- ---------------------------------------------------------------------------

-- Deliberately not a `status` column on `user_follows`: a pending request is
-- not a follow edge, and keeping it in its own table means every existing
-- reader of `user_follows` (the following feed, both follow counts, the
-- directory) keeps its current meaning without being taught to filter.
create table if not exists public.follow_requests (
  requester_id uuid not null references public.user_profiles(id) on delete cascade,
  target_id uuid not null references public.user_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (requester_id, target_id),
  check (requester_id <> target_id)
);

-- The inbox reads by target, newest first.
create index if not exists follow_requests_target_idx
  on public.follow_requests(target_id, created_at desc);

alter table public.follow_requests enable row level security;

-- Both sides of a request may see it; neither may write it directly. Every
-- mutation goes through the definer functions below so the rate limit, the
-- block check and the notification cannot be skipped.
drop policy if exists follow_requests_read on public.follow_requests;
create policy follow_requests_read on public.follow_requests for select to authenticated
using (
  requester_id = (select auth.uid())
  or target_id = (select auth.uid())
);

revoke all on public.follow_requests from public, anon, authenticated;
grant select on public.follow_requests to authenticated;
grant all on public.follow_requests to service_role;

-- A human follow request and its acceptance are distinct events from the AI
-- persona's `follow`, which is keyed on `companion_id` and answered on the
-- persona page. Reusing that kind would have made the notification row
-- ambiguous about where it leads.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('reply','reaction','follow','follow_request','follow_accepted','system'));

-- Request, cancel, request again is a cheap way to ring someone's bell
-- repeatedly. One live request notification per pair, refreshed in place.
create unique index if not exists notifications_follow_request_idx
  on public.notifications(user_id, actor_id, kind) where kind = 'follow_request';

-- ---------------------------------------------------------------------------
-- Reading a restricted profile
-- ---------------------------------------------------------------------------

-- An approved follower is, by definition, someone the owner let in, so they
-- read the profile the way a public one reads. The other three arms are
-- unchanged from 20260817010000.
drop policy if exists profiles_read on public.user_profiles;
create policy profiles_read on public.user_profiles for select to authenticated
using (
  id = (select auth.uid())
  or profile_visibility = 'public'
  or exists (
    select 1 from public.user_follows f
     where f.follower_id = (select auth.uid())
       and f.followed_id = user_profiles.id
  )
  or exists (
    select 1 from public.social_posts p
     where p.author_id = user_profiles.id
       and p.visibility = 'public'
       and p.content_status = 'active'
  )
);

-- Same reasoning for the Progress tab: a task the owner marked Public, on a
-- private profile, is now reachable by the followers that owner approved.
drop policy if exists progress_read on public.public_task_progress;
create policy progress_read on public.public_task_progress for select to authenticated
using (
  owner_id = (select auth.uid())
  or (
    (
      exists (
        select 1 from public.user_profiles p
         where p.id = public_task_progress.owner_id
           and p.profile_visibility = 'public'
      )
      or exists (
        select 1 from public.user_follows f
         where f.follower_id = (select auth.uid())
           and f.followed_id = public_task_progress.owner_id
      )
    )
    and not exists (
      select 1 from public.blocked_users b
       where (b.blocker_id = (select auth.uid()) and b.blocked_id = public_task_progress.owner_id)
          or (b.blocked_id = (select auth.uid()) and b.blocker_id = public_task_progress.owner_id)
    )
  )
);

-- The card a stranger may see for any profile, private ones included. Kept as a
-- definer function for the same reason as `search_user_directory`: the
-- projection is fixed here rather than trusted from the caller's select list.
-- A block in either direction still returns nothing, which the page renders as
-- a 404 -- a blocked account should not be confirmable by URL.
create or replace function public.get_profile_card(p_username text)
returns table (
  id uuid,
  username text,
  display_name text,
  avatar_url text,
  bio text,
  interests text[],
  current_streak integer,
  profile_visibility text,
  created_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select
    p.id,
    p.username,
    p.display_name,
    p.avatar_url,
    p.bio,
    p.interests,
    p.current_streak,
    p.profile_visibility::text,
    p.created_at
  from public.user_profiles p
  where lower(p.username) = lower(btrim(coalesce(p_username, '')))
    and (select auth.uid()) is not null
    and not exists (
      select 1 from public.blocked_users b
       where (b.blocker_id = (select auth.uid()) and b.blocked_id = p.id)
          or (b.blocked_id = (select auth.uid()) and b.blocker_id = p.id)
    );
$$;

comment on function public.get_profile_card(text) is
  'Public identity card for any profile, private included. Never exposes xp, streak history, goals or default visibility settings.';

-- Follower and following counts are part of that card -- Twitter shows them on
-- a protected account and they describe the account, not its posts -- so the
-- `profile_visibility = 'public'` gate this function carried since
-- 20260820050000 is dropped. The block gate stays. Two columns are new:
-- `viewer_requested`, so the Follow button can render "Requested", and
-- `pending_request_count`, which is populated only for the owner's own profile
-- and drives the inbox link there.
drop function if exists public.get_profile_follow_summary(uuid);
create function public.get_profile_follow_summary(p_user_id uuid)
returns table(
  follower_count bigint,
  following_count bigint,
  viewer_follows boolean,
  viewer_requested boolean,
  pending_request_count bigint
)
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'authentication required' using errcode='42501'; end if;

  return query
  select
    (select count(*) from public.user_follows f where f.followed_id = p_user_id),
    (select count(*) from public.user_follows f where f.follower_id = p_user_id),
    exists(
      select 1 from public.user_follows f
      where f.follower_id = uid and f.followed_id = p_user_id
    ),
    exists(
      select 1 from public.follow_requests r
      where r.requester_id = uid and r.target_id = p_user_id
    ),
    case when p.id = uid
      then (select count(*) from public.follow_requests r where r.target_id = uid)
      else 0::bigint
    end
  from public.user_profiles p
  where p.id = p_user_id
    and not exists(
      select 1 from public.blocked_users b
      where (b.blocker_id = uid and b.blocked_id = p.id)
         or (b.blocked_id = uid and b.blocker_id = p.id)
    );
end $$;

-- Same relaxation, same reason: the AI follower count describes the account.
create or replace function public.get_profile_ai_follower_count(p_user_id uuid)
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
    and relationship.companion_follow_state='following';
  return result;
end $$;

comment on function public.get_profile_ai_follower_count(uuid) is
  'Counts accepted active AI followers for a profile without exposing private relationship rows.';

-- ---------------------------------------------------------------------------
-- Asking for, and answering, access
-- ---------------------------------------------------------------------------

-- Following a private account now files a request instead of failing with
-- "profile not found". The return type changes from boolean to the resulting
-- state, because "did it work" no longer answers the caller's question --
-- 'following' and 'requested' are both successes with different button labels.
drop function if exists public.set_user_follow(uuid, boolean);
create function public.set_user_follow(p_followed_id uuid, p_following boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); target_visibility text;
begin
  if uid is null then raise exception 'authentication required' using errcode='42501'; end if;
  if not public.check_rate_limit('relationships:human-follow',120,3600,null) then
    raise exception 'rate limit exceeded' using errcode='P0001';
  end if;
  if p_followed_id is null or p_followed_id=uid then
    raise exception 'invalid follow target' using errcode='P0001';
  end if;
  if p_following is null then raise exception 'invalid follow state' using errcode='P0001'; end if;

  -- Serialize follow, request, block, and profile-visibility changes for this
  -- pair so a concurrent follow cannot land immediately after a block cleaned
  -- the edge, and so a request cannot be filed against a visibility that is
  -- being flipped underneath it.
  perform 1 from public.user_profiles
  where id in (uid, p_followed_id)
  order by id
  for update;

  if not p_following then
    delete from public.user_follows
    where follower_id=uid and followed_id=p_followed_id;
    -- One control cancels a pending request and unfollows, because to the
    -- person tapping it both are "stop".
    delete from public.follow_requests
    where requester_id=uid and target_id=p_followed_id;
    delete from public.notifications
    where user_id=p_followed_id and actor_id=uid and kind='follow_request';
    return 'none';
  end if;

  select profile.profile_visibility::text into target_visibility
  from public.user_profiles profile
  where profile.id=p_followed_id;
  if target_visibility is null then
    raise exception 'profile not found' using errcode='P0001';
  end if;
  if exists(
    select 1 from public.blocked_users b
    where (b.blocker_id=uid and b.blocked_id=p_followed_id)
       or (b.blocked_id=uid and b.blocker_id=p_followed_id)
  ) then raise exception 'follow unavailable' using errcode='P0001'; end if;

  -- An approved follower who taps Follow again is already through the door;
  -- do not demote them to a pending request.
  if target_visibility='public' or exists(
    select 1 from public.user_follows f
    where f.follower_id=uid and f.followed_id=p_followed_id
  ) then
    insert into public.user_follows(follower_id, followed_id)
    values(uid, p_followed_id)
    on conflict do nothing;
    return 'following';
  end if;

  insert into public.follow_requests(requester_id, target_id)
  values(uid, p_followed_id)
  on conflict do nothing;

  insert into public.notifications(user_id, actor_id, kind)
  values(p_followed_id, uid, 'follow_request')
  on conflict(user_id, actor_id, kind) where kind='follow_request'
  do update set created_at=excluded.created_at, read_at=null;

  return 'requested';
end $$;

-- The owner's side of the door. Accepting converts the request into a real
-- follow edge in one transaction; declining just drops it, and deliberately
-- sends no notification -- a silent decline is the kinder default and is what
-- the protected-account convention expects.
create or replace function public.respond_follow_request(p_requester_id uuid, p_accept boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'authentication required' using errcode='42501'; end if;
  if p_requester_id is null or p_accept is null then
    raise exception 'invalid follow request response' using errcode='P0001';
  end if;

  perform 1 from public.follow_requests
  where requester_id=p_requester_id and target_id=uid
  for update;
  if not found then raise exception 'no pending follow request' using errcode='P0001'; end if;

  delete from public.follow_requests
  where requester_id=p_requester_id and target_id=uid;
  delete from public.notifications
  where user_id=uid and actor_id=p_requester_id and kind='follow_request';

  if not p_accept then return 'none'; end if;

  -- A block placed after the request was filed still wins.
  if exists(
    select 1 from public.blocked_users b
    where (b.blocker_id=uid and b.blocked_id=p_requester_id)
       or (b.blocked_id=uid and b.blocker_id=p_requester_id)
  ) then raise exception 'follow unavailable' using errcode='P0001'; end if;

  insert into public.user_follows(follower_id, followed_id)
  values(p_requester_id, uid)
  on conflict do nothing;

  insert into public.notifications(user_id, actor_id, kind)
  values(p_requester_id, uid, 'follow_accepted');

  return 'following';
end $$;

-- The inbox. A definer function rather than a PostgREST embed on
-- `follow_requests`, so the requester projection is the same fixed card the
-- rest of this migration hands out.
create or replace function public.get_follow_requests(p_limit integer default 50)
returns table (
  requester_id uuid,
  username text,
  display_name text,
  avatar_url text,
  bio text,
  created_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'authentication required' using errcode='42501'; end if;
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'invalid follow request limit' using errcode='22023';
  end if;

  return query
  select r.requester_id, p.username, p.display_name, p.avatar_url, p.bio, r.created_at
  from public.follow_requests r
  join public.user_profiles p on p.id = r.requester_id
  where r.target_id = uid
    and not exists(
      select 1 from public.blocked_users b
      where (b.blocker_id = uid and b.blocked_id = r.requester_id)
         or (b.blocked_id = uid and b.blocker_id = r.requester_id)
    )
  order by r.created_at desc
  limit p_limit;
end $$;

-- A block should not leave a stale request sitting in either inbox.
create or replace function public.set_user_block(p_blocked_id uuid, p_blocked boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); changed integer;
begin
  if uid is null then raise exception 'authentication required' using errcode='42501'; end if;
  if not public.check_rate_limit('moderation:block',60,3600,null) then raise exception 'rate limit exceeded' using errcode='P0001'; end if;
  perform 1 from public.user_profiles
  where id in (uid, p_blocked_id)
  order by id
  for update;
  if p_blocked_id=uid or not exists(select 1 from public.user_profiles where id=p_blocked_id) then raise exception 'invalid user'; end if;
  if p_blocked then
    insert into public.blocked_users(blocker_id,blocked_id) values(uid,p_blocked_id) on conflict do nothing;
  else
    delete from public.blocked_users where blocker_id=uid and blocked_id=p_blocked_id;
  end if;
  get diagnostics changed = row_count;
  if p_blocked then
    delete from public.user_follows
    where (follower_id=uid and followed_id=p_blocked_id)
       or (follower_id=p_blocked_id and followed_id=uid);
    delete from public.follow_requests
    where (requester_id=uid and target_id=p_blocked_id)
       or (requester_id=p_blocked_id and target_id=uid);
    delete from public.notifications
    where kind='follow_request'
      and ((user_id=uid and actor_id=p_blocked_id) or (user_id=p_blocked_id and actor_id=uid));
  end if;
  return changed > 0;
end $$;

revoke all on function
  public.get_profile_card(text),
  public.get_profile_follow_summary(uuid),
  public.set_user_follow(uuid, boolean),
  public.respond_follow_request(uuid, boolean),
  public.get_follow_requests(integer)
  from public, anon, authenticated;
grant execute on function
  public.get_profile_card(text),
  public.get_profile_follow_summary(uuid),
  public.set_user_follow(uuid, boolean),
  public.respond_follow_request(uuid, boolean),
  public.get_follow_requests(integer)
  to authenticated;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Going public answers every pending request
-- ---------------------------------------------------------------------------

-- Without this, flipping a profile back to public strands its outstanding
-- requesters: their button still reads "Requested" against an account that no
-- longer restricts anything. Opening the account is the broadest possible
-- consent, so it grants every request already waiting on it.
create or replace function public.convert_follow_requests_on_open()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.user_follows(follower_id, followed_id)
  select r.requester_id, r.target_id
  from public.follow_requests r
  where r.target_id = new.id
  on conflict do nothing;

  insert into public.notifications(user_id, actor_id, kind)
  select r.requester_id, r.target_id, 'follow_accepted'
  from public.follow_requests r
  where r.target_id = new.id;

  delete from public.notifications
  where user_id = new.id and kind = 'follow_request'
    and actor_id in (select r.requester_id from public.follow_requests r where r.target_id = new.id);

  delete from public.follow_requests where target_id = new.id;
  return new;
end $$;

drop trigger if exists user_profiles_open_follow_requests on public.user_profiles;
create trigger user_profiles_open_follow_requests
  after update of profile_visibility on public.user_profiles
  for each row
  when (old.profile_visibility is distinct from new.profile_visibility and new.profile_visibility = 'public')
  execute function public.convert_follow_requests_on_open();

notify pgrst, 'reload schema';
