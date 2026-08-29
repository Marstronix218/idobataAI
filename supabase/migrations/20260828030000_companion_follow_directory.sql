-- AI personas in the follow directory.
--
-- The human half of this directory shipped in 20260828020000 and is already
-- applied, so this lands as its own migration rather than an edit to that file:
-- `supabase db push` keys off the version, and an amended migration is silently
-- skipped on every environment that already ran it.
--
-- Escaping and ranking are deliberately identical to `search_user_directory`.
-- The predicate is narrower because personas carry no visibility or blocking
-- rules -- a retired one is simply inactive.
create or replace function public.search_companion_directory(p_query text default '', p_limit integer default 20)
returns table (
  id uuid,
  slug text,
  name text,
  avatar_url text,
  personality text,
  viewer_follows boolean
)
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  needle text := btrim(coalesce(p_query, ''));
  pattern text;
begin
  if uid is null then raise exception 'authentication required' using errcode='42501'; end if;
  if length(needle) > 50 then raise exception 'search query too long' using errcode='22023'; end if;
  if p_limit is null or p_limit not between 1 and 25 then
    raise exception 'invalid directory limit' using errcode='22023';
  end if;

  needle := btrim(ltrim(needle, '@'));
  pattern := replace(replace(replace(needle, '\', '\\'), '%', '\%'), '_', '\_');

  return query
  select
    c.id,
    c.slug,
    c.name,
    c.avatar_url,
    c.personality,
    exists (
      select 1 from public.user_companion_relationships r
      where r.user_id = uid
        and r.companion_id = c.id
        and r.user_followed_at is not null
    )
  from public.social_companions c
  where c.active
    and (
      needle = ''
      or c.slug ilike '%' || pattern || '%' escape '\'
      or c.name ilike '%' || pattern || '%' escape '\'
    )
  order by
    (needle <> '' and lower(c.slug) = lower(needle)) desc,
    (needle <> '' and c.name ilike pattern || '%' escape '\') desc,
    c.name asc
  limit p_limit;
end $$;

revoke all on function public.search_companion_directory(text, integer) from public, anon, authenticated;
grant execute on function public.search_companion_directory(text, integer) to authenticated;

notify pgrst, 'reload schema';
