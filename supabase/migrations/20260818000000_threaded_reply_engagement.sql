-- Replies become first-class conversation nodes: likeable, repliable, threaded.
--
-- The schema already carried `social_replies.parent_reply_id`, but nothing read
-- it and reactions could only target a post, so a reply was a dead end -- no
-- like, no reply-to-a-reply, and no per-reply counts to render. This migration
-- makes a reply an engagement target on the same terms as a post.

-- ---------------------------------------------------------------------------
-- Reactions can target one reply on the post they belong to.
-- ---------------------------------------------------------------------------

alter table public.social_reactions
  add column if not exists reply_id uuid references public.social_replies(id) on delete cascade;

-- `post_id` stays non-null on reply reactions: every read policy on this table
-- authorizes through the parent post, and keeping the column populated means
-- those policies, and the post-scoped indexes, keep working unchanged.
create or replace function public.enforce_reaction_reply_post() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.reply_id is not null and not exists(
    select 1 from public.social_replies r where r.id = new.reply_id and r.post_id = new.post_id
  ) then
    raise exception 'reaction reply does not belong to post' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists social_reactions_reply_post_check on public.social_reactions;
create trigger social_reactions_reply_post_check
  before insert or update of reply_id, post_id on public.social_reactions
  for each row execute function public.enforce_reaction_reply_post();

-- One reaction per actor per target. The old indexes keyed on (post_id, actor)
-- alone, which would have collapsed "liked the post" and "liked a reply on that
-- post" into a single conflicting row.
drop index if exists public.social_reactions_human_unique;
drop index if exists public.social_reactions_companion_unique;

create unique index if not exists social_reactions_human_post_unique
  on public.social_reactions(post_id, actor_id) where actor_id is not null and reply_id is null;
create unique index if not exists social_reactions_companion_post_unique
  on public.social_reactions(post_id, companion_id) where companion_id is not null and reply_id is null;
create unique index if not exists social_reactions_human_reply_unique
  on public.social_reactions(reply_id, actor_id) where actor_id is not null and reply_id is not null;
create unique index if not exists social_reactions_companion_reply_unique
  on public.social_reactions(reply_id, companion_id) where companion_id is not null and reply_id is not null;
create index if not exists social_reactions_reply_idx
  on public.social_reactions(reply_id) where reply_id is not null;

-- ---------------------------------------------------------------------------
-- Denormalized per-reply counters, mirroring social_posts.reply_count.
-- ---------------------------------------------------------------------------

alter table public.social_replies
  add column if not exists like_count integer not null default 0 check (like_count >= 0),
  add column if not exists reply_count integer not null default 0 check (reply_count >= 0);

create or replace function public.sync_reply_like_count() returns trigger
language plpgsql security definer set search_path = '' as $$
declare affected uuid[];
begin
  affected := array_remove(array[
    case when tg_op <> 'INSERT' then old.reply_id end,
    case when tg_op <> 'DELETE' then new.reply_id end
  ], null);

  update public.social_replies r
     set like_count = (select count(*) from public.social_reactions x where x.reply_id = r.id)
   where r.id = any(affected);

  return coalesce(new, old);
end $$;

drop trigger if exists social_reactions_sync_reply_likes on public.social_reactions;
create trigger social_reactions_sync_reply_likes
  after insert or delete or update of reply_id on public.social_reactions
  for each row execute function public.sync_reply_like_count();

-- Direct-child count, so a collapsed thread can say how much it is hiding.
create or replace function public.sync_reply_thread_count() returns trigger
language plpgsql security definer set search_path = '' as $$
declare affected uuid[];
begin
  affected := array_remove(array[
    case when tg_op <> 'INSERT' then old.parent_reply_id end,
    case when tg_op <> 'DELETE' then new.parent_reply_id end
  ], null);

  update public.social_replies parent
     set reply_count = (
       select count(*) from public.social_replies child
        where child.parent_reply_id = parent.id and child.content_status = 'active'
     )
   where parent.id = any(affected);

  return coalesce(new, old);
end $$;

-- Fires on status changes too: hiding or removing a reply must drop the count.
drop trigger if exists social_replies_sync_thread_count on public.social_replies;
create trigger social_replies_sync_thread_count
  after insert or delete or update of parent_reply_id, content_status
  on public.social_replies
  for each row execute function public.sync_reply_thread_count();

update public.social_replies r
   set like_count = (select count(*) from public.social_reactions x where x.reply_id = r.id),
       reply_count = (
         select count(*) from public.social_replies child
          where child.parent_reply_id = r.id and child.content_status = 'active'
       );

-- Both counters are derived state; only the triggers may write them.
revoke update(like_count) on public.social_replies from authenticated, anon;
revoke update(reply_count) on public.social_replies from authenticated, anon;

-- ---------------------------------------------------------------------------
-- Post reactions must stop matching reply reactions.
-- ---------------------------------------------------------------------------

-- The previous body selected `where post_id=... and actor_id=uid`, which now
-- also matches this actor's like on a *reply* of that post -- liking the post
-- would have silently rewritten one of their reply likes instead.
create or replace function public.set_human_reaction(p_post_id uuid, p_reaction public.reaction_kind)
returns public.social_reactions language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); result public.social_reactions;
begin
  if uid is null then raise exception 'authentication required' using errcode='42501'; end if;
  if not public.check_rate_limit('reaction:mutate',60,60,null) then raise exception 'rate limit exceeded' using errcode='P0001'; end if;
  if not exists(select 1 from public.social_posts p where p.id=p_post_id and p.content_status='active' and (p.visibility='public' or p.author_id=uid)
    and not exists(select 1 from public.blocked_users b where (b.blocker_id=uid and b.blocked_id=p.author_id) or (b.blocked_id=uid and b.blocker_id=p.author_id))
    and not exists(select 1 from public.muted_companions m where m.user_id=uid and m.companion_id=p.companion_id)) then
    raise exception 'post not found' using errcode='P0002';
  end if;
  select * into result from public.social_reactions where post_id=p_post_id and actor_id=uid and reply_id is null for update;
  if found then
    update public.social_reactions set reaction=p_reaction where id=result.id returning * into result;
  else
    insert into public.social_reactions(post_id,actor_id,reaction) values(p_post_id,uid,p_reaction) returning * into result;
  end if;
  return result;
exception when unique_violation then
  update public.social_reactions set reaction=p_reaction
   where post_id=p_post_id and actor_id=uid and reply_id is null returning * into result;
  return result;
end $$;

-- ---------------------------------------------------------------------------
-- Liking a reply.
-- ---------------------------------------------------------------------------

create or replace function public.set_human_reply_reaction(p_reply_id uuid, p_reaction public.reaction_kind)
returns public.social_reactions language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); target_post uuid; result public.social_reactions;
begin
  if uid is null then raise exception 'authentication required' using errcode='42501'; end if;
  if not public.check_rate_limit('reaction:mutate',60,60,null) then raise exception 'rate limit exceeded' using errcode='P0001'; end if;

  -- Authorize through the reply *and* its post: a viewer who cannot see the
  -- conversation must not be able to like something inside it.
  select r.post_id into target_post
    from public.social_replies r
    join public.social_posts p on p.id = r.post_id
   where r.id = p_reply_id
     and r.content_status = 'active'
     and p.content_status = 'active'
     and (p.visibility = 'public' or p.author_id = uid)
     and not exists(select 1 from public.blocked_users b where (b.blocker_id=uid and b.blocked_id=r.author_id) or (b.blocked_id=uid and b.blocker_id=r.author_id))
     and not exists(select 1 from public.blocked_users b where (b.blocker_id=uid and b.blocked_id=p.author_id) or (b.blocked_id=uid and b.blocker_id=p.author_id))
     and not exists(select 1 from public.muted_companions m where m.user_id=uid and m.companion_id=r.companion_id)
     and not exists(select 1 from public.muted_companions m where m.user_id=uid and m.companion_id=p.companion_id);
  if target_post is null then raise exception 'reply not found' using errcode='P0002'; end if;

  select * into result from public.social_reactions where reply_id=p_reply_id and actor_id=uid for update;
  if found then
    update public.social_reactions set reaction=p_reaction where id=result.id returning * into result;
  else
    insert into public.social_reactions(post_id,reply_id,actor_id,reaction)
    values(target_post,p_reply_id,uid,p_reaction) returning * into result;
  end if;
  return result;
exception when unique_violation then
  update public.social_reactions set reaction=p_reaction
   where reply_id=p_reply_id and actor_id=uid returning * into result;
  return result;
end $$;

revoke all on function public.set_human_reply_reaction(uuid, public.reaction_kind) from public;
grant execute on function public.set_human_reply_reaction(uuid, public.reaction_kind) to authenticated;

-- ---------------------------------------------------------------------------
-- Notifications follow the conversation, not just the post.
-- ---------------------------------------------------------------------------

-- Previously every reply and every like notified the *post* author. In a thread
-- that is the wrong person: someone answering your reply, or liking it, should
-- reach you, and the post author should not be pinged for a sub-thread they are
-- not part of.
create or replace function public.create_social_notification() returns trigger language plpgsql security definer set search_path = '' as $$
declare target_user uuid; target_reply uuid;
begin
  if tg_table_name='social_replies' then
    if new.parent_reply_id is not null then
      select parent.author_id into target_user from public.social_replies parent where parent.id=new.parent_reply_id;
    else
      select author_id into target_user from public.social_posts where id=new.post_id;
    end if;
    if target_user is null then return new; end if;
    if new.author_id is distinct from target_user
      and coalesce((select case when new.companion_id is not null then preferences.companion_activity else preferences.replies end from public.notification_preferences preferences where preferences.user_id=target_user),true) then
      insert into public.notifications(user_id,actor_id,companion_id,post_id,reply_id,kind)
      values(target_user,new.author_id,new.companion_id,new.post_id,new.id,'reply');
    end if;
  elsif tg_table_name='social_reactions' then
    if new.reply_id is not null then
      select r.author_id into target_user from public.social_replies r where r.id=new.reply_id;
      target_reply := new.reply_id;
    else
      select author_id into target_user from public.social_posts where id=new.post_id;
      target_reply := null;
    end if;
    if target_user is null then return new; end if;
    if new.actor_id is distinct from target_user
      and coalesce((select case when new.companion_id is not null then preferences.companion_activity else preferences.reactions end from public.notification_preferences preferences where preferences.user_id=target_user),true) then
      insert into public.notifications(user_id,actor_id,companion_id,post_id,reply_id,kind)
      values(target_user,new.actor_id,new.companion_id,new.post_id,target_reply,'reaction');
    end if;
  end if;
  return new;
end $$;
