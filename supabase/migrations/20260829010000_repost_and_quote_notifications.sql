-- Reposts and quote reposts produced no notification at all, so the only way to
-- learn that someone had amplified your post was to stumble on it in a feed.
-- Both now notify the original author, the way replies and likes already do.

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('reply','reaction','repost','quote','follow','follow_request','follow_accepted','system'));

-- A repost is a toggle and a quote is idempotent by key, so either trigger can
-- fire more than once for the same actor and post. One notification per
-- (recipient, post, kind, actor) keeps a toggled repost from stacking up.
create unique index if not exists notifications_amplification_unique
  on public.notifications(user_id, post_id, kind, coalesce(actor_id, companion_id))
  where kind in ('repost','quote');

create or replace function public.create_repost_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
declare target_user uuid;
begin
  select author_id into target_user from public.social_posts where id=new.post_id;
  if target_user is null or new.actor_id is not distinct from target_user then return new; end if;
  if not coalesce((select case when new.companion_id is not null then preferences.companion_activity else preferences.reactions end
    from public.notification_preferences preferences where preferences.user_id=target_user), true) then return new; end if;
  insert into public.notifications(user_id,actor_id,companion_id,post_id,kind)
  values(target_user,new.actor_id,new.companion_id,new.post_id,'repost')
  on conflict do nothing;
  return new;
end $$;

drop trigger if exists social_reposts_notify on public.social_reposts;
create trigger social_reposts_notify after insert on public.social_reposts
  for each row execute function public.create_repost_notification();

-- `post_id` deliberately points at the quoting post rather than the original, so
-- the notification can render the new commentary with the original embedded,
-- exactly as the quote post itself appears in a feed. A private quote is
-- invisible to the quoted author, so it stays silent.
create or replace function public.create_quote_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
declare target_user uuid;
begin
  if new.quoted_post_id is null or new.visibility <> 'public' or new.content_status <> 'active' then return new; end if;
  select author_id into target_user from public.social_posts where id=new.quoted_post_id;
  if target_user is null or new.author_id is not distinct from target_user then return new; end if;
  if not coalesce((select case when new.companion_id is not null then preferences.companion_activity else preferences.replies end
    from public.notification_preferences preferences where preferences.user_id=target_user), true) then return new; end if;
  insert into public.notifications(user_id,actor_id,companion_id,post_id,kind)
  values(target_user,new.author_id,new.companion_id,new.id,'quote')
  on conflict do nothing;
  return new;
end $$;

drop trigger if exists social_posts_notify_quote on public.social_posts;
create trigger social_posts_notify_quote after insert on public.social_posts
  for each row when (new.quoted_post_id is not null)
  execute function public.create_quote_notification();

revoke all on function public.create_repost_notification(), public.create_quote_notification()
  from public, anon, authenticated;

notify pgrst, 'reload schema';
