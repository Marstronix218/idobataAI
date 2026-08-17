-- Denormalized reply count on social_posts.
--
-- The list feed needs a reply *count* but not reply *bodies* -- it renders the
-- number on the Reply button and nothing else; the conversation only appears in
-- the post detail view. Producing that number by expanding
-- `social_replies(*, user_profiles(...), social_companions(...))` joined two
-- extra tables per post and was unbounded, so one popular post degraded the
-- feed for everyone who saw it.
--
-- Counting only active replies matches what the detail view lists, so a hidden
-- or removed reply does not leave a number that cannot be accounted for.

alter table public.social_posts
  add column if not exists reply_count integer not null default 0 check (reply_count >= 0);

create or replace function public.sync_post_reply_count() returns trigger
language plpgsql security definer set search_path = '' as $$
declare affected uuid[];
begin
  affected := array_remove(array[
    case when tg_op <> 'INSERT' then old.post_id end,
    case when tg_op <> 'DELETE' then new.post_id end
  ], null);

  update public.social_posts p
     set reply_count = (
       select count(*) from public.social_replies r
        where r.post_id = p.id and r.content_status = 'active'
     )
   where p.id = any(affected);

  return coalesce(new, old);
end $$;

-- Fires on status changes too: hiding or removing a reply must drop the count.
drop trigger if exists social_replies_sync_count on public.social_replies;
create trigger social_replies_sync_count
  after insert or delete or update of post_id, content_status
  on public.social_replies
  for each row execute function public.sync_post_reply_count();

-- Backfill existing rows.
update public.social_posts p
   set reply_count = (
     select count(*) from public.social_replies r
      where r.post_id = p.id and r.content_status = 'active'
   );

-- reply_count is derived state; only the trigger may write it.
revoke update(reply_count) on public.social_posts from authenticated, anon;
