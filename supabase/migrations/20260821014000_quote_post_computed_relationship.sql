-- PostgREST requires a computed relationship to disambiguate a recursive
-- social_posts -> social_posts embed. Keep it SECURITY INVOKER so the quoted
-- source remains subject to the caller's normal social_posts RLS policy.
create or replace function public.quoted_post(post public.social_posts)
returns setof public.social_posts
rows 1
language sql
stable
security invoker
set search_path = '' as $$
  select source.*
  from public.social_posts source
  where source.id = ($1).quoted_post_id
$$;

revoke all on function public.quoted_post(public.social_posts)
  from public, anon, authenticated;
grant execute on function public.quoted_post(public.social_posts)
  to authenticated, service_role;

comment on function public.quoted_post(public.social_posts) is
  'RLS-aware computed relationship used to embed the visible source of a quote repost.';

notify pgrst, 'reload schema';
