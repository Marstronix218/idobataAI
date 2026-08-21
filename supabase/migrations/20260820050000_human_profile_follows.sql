create table public.user_follows (
  follower_id uuid not null references public.user_profiles(id) on delete cascade,
  followed_id uuid not null references public.user_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(follower_id, followed_id),
  check (follower_id <> followed_id)
);

create index user_follows_followed_idx
  on public.user_follows(followed_id, follower_id);

alter table public.user_follows enable row level security;

create policy follows_outbound_read on public.user_follows
  for select to authenticated using(
    follower_id=(select auth.uid())
  );

create or replace function public.set_user_follow(p_followed_id uuid, p_following boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'authentication required' using errcode='42501'; end if;
  if not public.check_rate_limit('relationships:human-follow',120,3600,null) then
    raise exception 'rate limit exceeded' using errcode='P0001';
  end if;
  if p_followed_id is null or p_followed_id=uid then
    raise exception 'invalid follow target' using errcode='P0001';
  end if;
  if p_following is null then raise exception 'invalid follow state' using errcode='P0001'; end if;

  -- Serialize follow, block, and profile-visibility changes for this pair so a
  -- concurrent follow cannot land immediately after a block cleaned the edge.
  perform 1 from public.user_profiles
  where id in (uid, p_followed_id)
  order by id
  for update;

  if p_following then
    if not exists(
      select 1 from public.user_profiles p
      where p.id=p_followed_id and p.profile_visibility='public'
    ) then raise exception 'profile not found' using errcode='P0001'; end if;
    if exists(
      select 1 from public.blocked_users b
      where (b.blocker_id=uid and b.blocked_id=p_followed_id)
         or (b.blocked_id=uid and b.blocker_id=p_followed_id)
    ) then raise exception 'follow unavailable' using errcode='P0001'; end if;

    insert into public.user_follows(follower_id, followed_id)
    values(uid, p_followed_id)
    on conflict do nothing;
  else
    delete from public.user_follows
    where follower_id=uid and followed_id=p_followed_id;
  end if;
  return p_following;
end $$;

create or replace function public.get_following_post_ids(
  p_category text default null,
  p_before timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 21
) returns table(post_id uuid, created_at timestamptz)
language plpgsql stable security invoker set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'authentication required' using errcode='42501'; end if;
  if p_limit is null or p_limit not between 1 and 51 then
    raise exception 'invalid following feed limit' using errcode='22023';
  end if;

  return query
  select post.id, post.created_at
  from public.social_posts post
  where post.content_status='active'
    and post.visibility='public'
    and post.created_at <= now()
    and (p_category is null or post.category=p_category)
    and (
      p_before is null
      or post.created_at < p_before
      or (post.created_at=p_before and post.id < p_before_id)
    )
    and (
      exists(
        select 1 from public.user_follows follow
        where follow.follower_id=uid and follow.followed_id=post.author_id
      )
      or exists(
        select 1 from public.user_companion_relationships relationship
        where relationship.user_id=uid
          and relationship.companion_id=post.companion_id
          and relationship.user_followed_at is not null
      )
    )
  order by post.created_at desc, post.id desc
  limit p_limit;
end $$;

create or replace function public.get_profile_follow_summary(p_user_id uuid)
returns table(follower_count bigint, viewer_follows boolean)
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'authentication required' using errcode='42501'; end if;

  return query
  select
    (select count(*) from public.user_follows f where f.followed_id=p_user_id),
    exists(
      select 1 from public.user_follows f
      where f.follower_id=uid and f.followed_id=p_user_id
    )
  from public.user_profiles p
  where p.id=p_user_id
    and (
      p.id=uid
      or (
        p.profile_visibility='public'
        and not exists(
          select 1 from public.blocked_users b
          where (b.blocker_id=uid and b.blocked_id=p.id)
             or (b.blocked_id=uid and b.blocker_id=p.id)
        )
      )
    );
end $$;

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
  end if;
  return changed > 0;
end $$;

revoke all on public.user_follows from public, anon, authenticated;
grant select on public.user_follows to authenticated;
grant all on public.user_follows to service_role;

revoke all on function public.set_user_follow(uuid,boolean),
  public.get_profile_follow_summary(uuid),
  public.get_following_post_ids(text,timestamptz,uuid,integer) from public, anon, authenticated;
grant execute on function public.set_user_follow(uuid,boolean),
  public.get_profile_follow_summary(uuid),
  public.get_following_post_ids(text,timestamptz,uuid,integer) to authenticated;
