-- Enforce profile_visibility in the database.
--
-- `profile_visibility` was added in 20260814031000 and the profile page honours
-- it, but `profiles_read` was never revised from `using (true)`. Enforcement
-- therefore lived only in React. Because the anon key is published to the
-- browser by design, any signed-in user could read every row of
-- `user_profiles` straight from PostgREST -- bio, interests, xp, streak, and
-- `last_completion_date`, which is a per-user activity timeline -- for accounts
-- whose profile page renders "This profile is private".
--
-- The product's central promise is that private means private, so this is
-- closed at the only layer that actually enforces it.

-- A minimal projection for the social join paths. Feed cards, replies, chat
-- contacts, and notifications need an identity to render; none of them need the
-- private columns. Being a view owned by the definer, it is not subject to the
-- base table's RLS, so the predicate below is the whole access rule.
create or replace view public.public_user_profiles
with (security_invoker = false) as
  select id, username, display_name, avatar_url, profile_visibility
    from public.user_profiles;

revoke all on public.public_user_profiles from anon;
grant select on public.public_user_profiles to authenticated;

-- The base table now exposes full rows only to their owner, to profiles that
-- opted into being public, and to authors of currently-visible public posts
-- (otherwise a public post could not render its own author).
drop policy if exists profiles_read on public.user_profiles;
create policy profiles_read on public.user_profiles for select to authenticated
using (
  id = (select auth.uid())
  or profile_visibility = 'public'
  or exists (
    select 1 from public.social_posts p
     where p.author_id = user_profiles.id
       and p.visibility = 'public'
       and p.content_status = 'active'
  )
);

-- Directory search must not enumerate private accounts. Kept as a definer
-- function so the projection is fixed server-side rather than trusted from the
-- caller's select list, and so the underscore LIKE wildcard is escaped.
create or replace function public.search_chat_contacts(p_query text default '', p_limit integer default 12)
returns table (id uuid, username text, display_name text, avatar_url text, bio text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.username, p.display_name, p.avatar_url, p.bio
    from public.user_profiles p
   where p.id <> (select auth.uid())
     and p.profile_visibility = 'public'
     and not exists (
       select 1 from public.blocked_users b
        where (b.blocker_id = (select auth.uid()) and b.blocked_id = p.id)
           or (b.blocked_id = (select auth.uid()) and b.blocker_id = p.id)
     )
     and (
       coalesce(nullif(btrim(p_query), ''), '') = ''
       or p.username ilike '%' || replace(replace(btrim(p_query), '\', '\\'), '_', '\_') || '%' escape '\'
       or coalesce(p.display_name, '') ilike '%' || replace(replace(btrim(p_query), '\', '\\'), '_', '\_') || '%' escape '\'
     )
   order by p.username
   limit least(greatest(coalesce(p_limit, 12), 1), 25);
$$;

revoke all on function public.search_chat_contacts(text, integer) from public, anon;
grant execute on function public.search_chat_contacts(text, integer) to authenticated;

-- Public progress is a projection of a public task, but it also carries the
-- owner's username and avatar. A private profile that flips a single task to
-- public should not be surfaced in the global progress list.
drop policy if exists progress_read on public.public_task_progress;
create policy progress_read on public.public_task_progress for select to authenticated
using (
  owner_id = (select auth.uid())
  or (
    exists (
      select 1 from public.user_profiles p
       where p.id = public_task_progress.owner_id
         and p.profile_visibility = 'public'
    )
    and not exists (
      select 1 from public.blocked_users b
       where (b.blocker_id = (select auth.uid()) and b.blocked_id = public_task_progress.owner_id)
          or (b.blocked_id = (select auth.uid()) and b.blocker_id = public_task_progress.owner_id)
    )
  )
);

-- Belt and braces: every policy in the schema is `to authenticated`, so anon is
-- already denied, but Supabase's default privileges grant anon table access on
-- new public-schema tables. Revoking here means a future `to public` policy
-- cannot silently become an unauthenticated read.
revoke all on all tables in schema public from anon;
