-- Owners may change only a post's audience. Existing RLS continues to scope
-- both audience changes and deletion to the authenticated human author.
grant update(visibility) on public.social_posts to authenticated;
