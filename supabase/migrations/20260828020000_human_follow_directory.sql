-- Human-to-human follow discovery.
--
-- `user_follows` and `set_user_follow` (20260820050000) already model the edge,
-- but the only way to reach the Follow button was to know a profile URL by
-- heart: nothing in the product let one person look another up. This adds the
-- directory search behind the same definer-function discipline the chat
-- directory uses, and teaches the profile summary to report who a person
-- follows as well as who follows them.

-- Search by handle or display name. Kept as a definer function for the same
-- reasons as `search_chat_contacts`: the projection is fixed server-side rather
-- than trusted from the caller's select list, private accounts are never
-- enumerated, and LIKE metacharacters in the query are escaped instead of
-- pattern-matched. Unlike that function this one also escapes `%`, which is
-- left live there -- harmless in the chat directory, where the empty query
-- returns the same capped list anyway, but not a habit to copy forward.
create or replace function public.search_user_directory(p_query text default '', p_limit integer default 20)
returns table (
  id uuid,
  username text,
  display_name text,
  avatar_url text,
  bio text,
  follower_count bigint,
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

  -- A leading `@` is how people write a handle, and pasting one should find the
  -- account rather than nothing.
  needle := btrim(ltrim(needle, '@'));
  pattern := replace(replace(replace(needle, '\', '\\'), '%', '\%'), '_', '\_');

  return query
  select
    p.id,
    p.username,
    p.display_name,
    p.avatar_url,
    p.bio,
    (select count(*) from public.user_follows f where f.followed_id = p.id),
    exists (
      select 1 from public.user_follows f
      where f.follower_id = uid and f.followed_id = p.id
    )
  from public.user_profiles p
  where p.id <> uid
    and p.profile_visibility = 'public'
    and not exists (
      select 1 from public.blocked_users b
      where (b.blocker_id = uid and b.blocked_id = p.id)
         or (b.blocked_id = uid and b.blocker_id = p.id)
    )
    and (
      needle = ''
      or p.username ilike '%' || pattern || '%' escape '\'
      or coalesce(p.display_name, '') ilike '%' || pattern || '%' escape '\'
    )
  -- An exact handle is an unambiguous request for one account, so it outranks
  -- every substring hit; a prefix match outranks a match buried mid-string.
  order by
    (needle <> '' and lower(p.username) = lower(needle)) desc,
    (needle <> '' and p.username ilike pattern || '%' escape '\') desc,
    p.username asc
  limit p_limit;
end $$;

-- Followers alone described half the relationship. The profile header needs the
-- outbound count too, and the viewer's own profile is the natural place to find
-- the people they already follow.
-- Adding an OUT column changes the function's return type, which `create or
-- replace` refuses, so the old two-column signature is dropped first.
drop function if exists public.get_profile_follow_summary(uuid);
create function public.get_profile_follow_summary(p_user_id uuid)
returns table(follower_count bigint, following_count bigint, viewer_follows boolean)
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'authentication required' using errcode='42501'; end if;

  return query
  select
    (select count(*) from public.user_follows f where f.followed_id = p_user_id),
    (select count(*) from public.user_follows f where f.follower_id = p_user_id),
    exists(
      select 1 from public.user_follows f
      where f.follower_id = uid and f.followed_id = p_user_id
    )
  from public.user_profiles p
  where p.id = p_user_id
    and (
      p.id = uid
      or (
        p.profile_visibility = 'public'
        and not exists(
          select 1 from public.blocked_users b
          where (b.blocker_id = uid and b.blocked_id = p.id)
             or (b.blocked_id = uid and b.blocker_id = p.id)
        )
      )
    );
end $$;

-- `user_follows` is keyed (follower_id, followed_id) and 20260820050000 added
-- the reverse index, so both directions of the counts above are index-only.

revoke all on function public.search_user_directory(text, integer) from public, anon, authenticated;
grant execute on function public.search_user_directory(text, integer) to authenticated;

revoke all on function public.get_profile_follow_summary(uuid) from public, anon, authenticated;
grant execute on function public.get_profile_follow_summary(uuid) to authenticated;

notify pgrst, 'reload schema';
