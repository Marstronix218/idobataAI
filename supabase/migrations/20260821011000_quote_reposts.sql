alter table public.social_posts
  add column quoted_post_id uuid;

alter table public.social_posts
  add constraint social_posts_quoted_post_id_fkey
  foreign key (quoted_post_id) references public.social_posts(id) on delete set null;

alter table public.social_posts
  add constraint social_posts_quote_shape check (
    (
      kind = 'human_quote'
      and author_id is not null
      and companion_id is null
      and task_id is null
    )
    or (
      kind <> 'human_quote'
      and quoted_post_id is null
    )
  ),
  add constraint social_posts_no_self_quote check (quoted_post_id is distinct from id);

create index social_posts_quoted_post_idx
  on public.social_posts(quoted_post_id)
  where quoted_post_id is not null;

create index social_reposts_actor_created_idx
  on public.social_reposts(actor_id, created_at desc, id desc)
  where actor_id is not null;

create index social_reposts_companion_created_idx
  on public.social_reposts(companion_id, created_at desc, id desc)
  where companion_id is not null;

-- Undo must remain possible if the source later becomes private, hidden,
-- blocked, or muted. Visibility checks therefore apply only when creating an
-- edge; deletion is always scoped to the authenticated actor.
create or replace function public.set_human_repost(p_post_id uuid, p_reposted boolean)
returns public.social_reposts language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); result public.social_reposts;
begin
  if uid is null then raise exception 'authentication required' using errcode='42501'; end if;
  if p_reposted then
    if not exists(
      select 1 from public.social_posts post
      where post.id=p_post_id and post.content_status='active' and post.visibility='public'
        and not exists(
          select 1 from public.blocked_users block
          where (block.blocker_id=uid and block.blocked_id=post.author_id)
             or (block.blocked_id=uid and block.blocker_id=post.author_id)
        )
        and not exists(
          select 1 from public.muted_companions mute
          where mute.user_id=uid and mute.companion_id=post.companion_id
        )
    ) then raise exception 'post not found' using errcode='P0002'; end if;
    insert into public.social_reposts(post_id,actor_id) values(p_post_id,uid)
    on conflict(post_id,actor_id) where actor_id is not null do update set post_id=excluded.post_id
    returning * into result;
  else
    delete from public.social_reposts
    where post_id=p_post_id and actor_id=uid
    returning * into result;
  end if;
  return result;
end $$;

create or replace function public.publish_quote_repost(
  p_post_id uuid,
  p_content text,
  p_visibility public.post_visibility,
  p_idempotency_key text
)
returns public.social_posts language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  target public.social_posts;
  result public.social_posts;
  idem text;
begin
  if uid is null then raise exception 'authentication required' using errcode='42501'; end if;
  if not public.check_rate_limit('post:publish',10,60,null) then
    raise exception 'rate limit exceeded' using errcode='P0001';
  end if;
  if p_content is null or char_length(trim(p_content)) not between 1 and 500 then
    raise exception 'quote content must be between 1 and 500 characters' using errcode='22023';
  end if;
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 160 then
    raise exception 'invalid idempotency key' using errcode='22023';
  end if;

  select post.* into target
  from public.social_posts post
  where post.id=p_post_id
    and post.content_status='active'
    and post.visibility='public'
    and not exists(
      select 1 from public.blocked_users block
      where (block.blocker_id=uid and block.blocked_id=post.author_id)
         or (block.blocked_id=uid and block.blocker_id=post.author_id)
    )
    and not exists(
      select 1 from public.muted_companions mute
      where mute.user_id=uid and mute.companion_id=post.companion_id
    )
  for share;
  if not found then raise exception 'post not found' using errcode='P0002'; end if;

  idem := 'quote:' || uid::text || ':' || p_post_id::text || ':' || trim(p_idempotency_key);
  select post.* into result
  from public.social_posts post
  where post.author_id=uid and post.idempotency_key=idem;
  if found then return result; end if;

  begin
    insert into public.social_posts(
      author_id,kind,visibility,content,quoted_post_id,idempotency_key
    ) values (
      uid,'human_quote',p_visibility,trim(p_content),target.id,idem
    ) returning * into result;
  exception when unique_violation then
    select post.* into result
    from public.social_posts post
    where post.author_id=uid and post.idempotency_key=idem;
  end;
  return result;
end $$;

revoke all on function public.publish_quote_repost(uuid,text,public.post_visibility,text)
  from public, anon, authenticated;
grant execute on function public.publish_quote_repost(uuid,text,public.post_visibility,text)
  to authenticated;

comment on column public.social_posts.quoted_post_id is
  'Original public post referenced by an authored quote repost. It becomes null if the original is deleted.';
comment on function public.publish_quote_repost(uuid,text,public.post_visibility,text) is
  'Publishes idempotent human quote commentary that references an active public post.';
-- Ensure PostgREST observes the new quote reference immediately after this
-- migration. The recursive computed relationship is added in the follow-up.
notify pgrst, 'reload schema';
