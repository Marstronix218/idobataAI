create index if not exists social_reactions_actor_created_idx
  on public.social_reactions(actor_id, created_at desc)
  where actor_id is not null;

create index if not exists social_replies_author_created_idx
  on public.social_replies(author_id, created_at desc)
  where author_id is not null and content_status = 'active';
