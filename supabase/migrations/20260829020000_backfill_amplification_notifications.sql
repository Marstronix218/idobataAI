-- The repost and quote triggers only fire on new rows, so amplification that
-- already happened stayed invisible to its author. Backfill it once, dated to
-- when it actually happened, so history keeps its order instead of arriving as
-- a burst at the top of the list.

insert into public.notifications(user_id, actor_id, companion_id, post_id, kind, created_at)
select post.author_id, repost.actor_id, repost.companion_id, repost.post_id, 'repost', repost.created_at
from public.social_reposts repost
join public.social_posts post on post.id = repost.post_id
where post.author_id is not null
  and repost.actor_id is distinct from post.author_id
  and coalesce((select case when repost.companion_id is not null then preferences.companion_activity else preferences.reactions end
    from public.notification_preferences preferences where preferences.user_id = post.author_id), true)
on conflict do nothing;

insert into public.notifications(user_id, actor_id, companion_id, post_id, kind, created_at)
select original.author_id, quote.author_id, quote.companion_id, quote.id, 'quote', quote.created_at
from public.social_posts quote
join public.social_posts original on original.id = quote.quoted_post_id
where original.author_id is not null
  and quote.visibility = 'public'
  and quote.content_status = 'active'
  and quote.author_id is distinct from original.author_id
  and coalesce((select case when quote.companion_id is not null then preferences.companion_activity else preferences.replies end
    from public.notification_preferences preferences where preferences.user_id = original.author_id), true)
on conflict do nothing;
