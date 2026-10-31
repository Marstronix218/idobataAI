-- Pivot A Phase 5: the age gate (PLAN D5 and D6).
--
-- Under-18s are blocked before an account exists:
-- 1. POST /api/auth/age-check runs the AgeVerifier. On a pass it stores only
--    the sha256 of a random single-use token, with the method and a 15-minute
--    expiry. No user id and no date of birth are ever stored.
-- 2. The client signs up with `options.data.age_token`.
-- 3. The `before_user_created` auth hook below rejects the sign-up unless the
--    token's hash matches an unexpired, unconsumed row, which it consumes.
-- 4. handle_new_user copies the verification time and method into
--    user_coach_profiles, deletes the used token row, and strips the token
--    from the user's metadata.
--
-- With `pivot_a.enabled` off the hook allows every sign-up, so enabling it in
-- an environment before Pivot A is harmless.
-- TODO(founder): enable the before_user_created hook (Authentication > Hooks,
-- Postgres function public.hook_before_user_created) in every hosted Supabase
-- environment. supabase/config.toml only enables it on the local stack.
--
-- Existing accounts (D6) verify through POST /api/coach/age, which calls
-- set_coach_age_verified() with the service role.

-- Fail fast instead of queueing behind a long transaction while holding locks
-- that block the app. Only effective inside a transaction (as under
-- `supabase db push`); a non-transactional local reset just warns.
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- Tokens: no user id, no date of birth.
-- ---------------------------------------------------------------------------

create table if not exists public.age_verification_tokens (
  -- Lowercase hex sha256 of the token; the token itself is never stored.
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  method text not null check (char_length(method) between 1 and 40),
  verified_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create index if not exists age_verification_tokens_expires_at_idx on public.age_verification_tokens (expires_at);

-- RLS on with no client policy. The service role (which bypasses RLS) writes
-- rows; the auth hook, running as supabase_auth_admin (which does not), gets
-- the two narrow policies below and nothing else.
alter table public.age_verification_tokens enable row level security;

revoke all on table public.age_verification_tokens from public, anon, authenticated, service_role;
grant select, insert on table public.age_verification_tokens to service_role;
grant select, update (consumed_at) on table public.age_verification_tokens to supabase_auth_admin;

drop policy if exists age_verification_tokens_auth_admin_select on public.age_verification_tokens;
create policy age_verification_tokens_auth_admin_select on public.age_verification_tokens
  for select to supabase_auth_admin using (true);
drop policy if exists age_verification_tokens_auth_admin_consume on public.age_verification_tokens;
create policy age_verification_tokens_auth_admin_consume on public.age_verification_tokens
  for update to supabase_auth_admin using (consumed_at is null) with check (consumed_at is not null);

comment on table public.age_verification_tokens is
  'Pivot A age gate: sha256 of single-use sign-up tokens issued by POST /api/auth/age-check after the AgeVerifier passed. No user id and no date of birth.';

-- ---------------------------------------------------------------------------
-- The before_user_created hook.
-- Contract (supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook):
-- the event is {metadata, user}, with the sign-up's `options.data` in
-- user.user_metadata. Return {} to allow, or
-- {"error": {"http_code": 403, "message": "..."}} to reject. Auth calls it as
-- supabase_auth_admin; Supabase advises against security definer, so it runs
-- as the invoker with explicit grants.
-- ---------------------------------------------------------------------------

create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  token text := event #>> '{user,user_metadata,age_token}';
  consumed text;
begin
  if not public.pivot_flag_enabled('pivot_a.enabled') then
    return '{}'::jsonb;
  end if;

  if token is not null and char_length(token) between 16 and 200 then
    update public.age_verification_tokens age_token
    set consumed_at = now()
    where age_token.token_hash = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(token, 'UTF8')), 'hex')
      and age_token.consumed_at is null
      and age_token.expires_at > now()
    returning age_token.token_hash into consumed;
    if consumed is not null then
      return '{}'::jsonb;
    end if;
  end if;

  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'age verification required'
  ));
end $$;

revoke all on function public.hook_before_user_created(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
-- Already granted on hosted projects; the role cannot see public objects otherwise.
grant usage on schema public to supabase_auth_admin;
-- pivot_flag_enabled is security definer and reads app_feature_flags as its owner.
grant execute on function public.pivot_flag_enabled(text) to supabase_auth_admin;

comment on function public.hook_before_user_created(jsonb) is
  'Supabase before_user_created auth hook. Allows every sign-up while pivot_a.enabled is off; otherwise requires user_metadata.age_token to match an unexpired, unconsumed age_verification_tokens row, which it consumes, and rejects with 403 "age verification required".';

-- ---------------------------------------------------------------------------
-- Copying the verification into the new user's coach profile.
-- ---------------------------------------------------------------------------

-- Called by handle_new_user. Never raises: an age-copy failure must not block a
-- sign-up the hook already allowed (the user then sees the D6 age step).
create or replace function public.apply_signup_age_verification(p_user_id uuid, p_metadata jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  token text := p_metadata ->> 'age_token';
  token_digest text;
  verified timestamptz;
  verified_method text;
begin
  if token is null then return; end if;
  begin
    token_digest := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(token, 'UTF8')), 'hex');

    -- Normally the hook consumed the token moments ago (in its own
    -- transaction). Where the hook is not enabled yet, the token is still
    -- unconsumed and unexpired. Either way the row is deleted as it is used,
    -- in one statement, so a token verifies at most one account even without
    -- the hook. The window keeps a token the hook consumed for a sign-up that
    -- then failed from verifying a later account.
    delete from public.age_verification_tokens age_token
    where age_token.token_hash = token_digest
      and ((age_token.consumed_at is null and age_token.expires_at > now())
        or age_token.consumed_at > now() - interval '5 minutes')
    returning age_token.verified_at, age_token.method into verified, verified_method;

    if verified is not null then
      insert into public.user_coach_profiles as profile (user_id, age_verified_at, age_verification_method)
      values (p_user_id, verified, verified_method)
      on conflict (user_id) do update set
        age_verified_at = coalesce(profile.age_verified_at, excluded.age_verified_at),
        age_verification_method = case when profile.age_verified_at is null then excluded.age_verification_method else profile.age_verification_method end;
    end if;
  exception when others then
    raise warning 'apply_signup_age_verification: copy failed: %', sqlstate;
  end;

  -- The token has done its job; it does not belong in the user's metadata.
  -- A separate block, so a failure here never undoes the copy above.
  begin
    update auth.users set raw_user_meta_data = raw_user_meta_data - 'age_token' where id = p_user_id;
  exception when others then
    raise warning 'apply_signup_age_verification: strip failed: %', sqlstate;
  end;
end $$;

revoke all on function public.apply_signup_age_verification(uuid, jsonb) from public, anon, authenticated, service_role;

comment on function public.apply_signup_age_verification(uuid, jsonb) is
  'Internal to handle_new_user: copies a sign-up age token''s verification into user_coach_profiles, deletes the used token row, and strips age_token from the metadata. Never raises.';

-- The definition from 20260812000000_initial_schema.sql, unchanged except for
-- the apply_signup_age_verification call after each profile insert.
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
declare candidate text;
begin
  candidate := coalesce(nullif(new.raw_user_meta_data->>'username', ''), 'user_' || substr(replace(new.id::text, '-', ''), 1, 8));
  if candidate !~ '^[A-Za-z0-9_]{3,24}$' then candidate := 'user_' || substr(replace(new.id::text, '-', ''), 1, 8); end if;
  insert into public.user_profiles(id, username) values(new.id, candidate)
  on conflict (id) do nothing;
  insert into public.notification_preferences(user_id) values(new.id) on conflict do nothing;
  perform public.apply_signup_age_verification(new.id, new.raw_user_meta_data);
  return new;
exception when unique_violation then
  insert into public.user_profiles(id, username) values(new.id, 'user_' || substr(replace(new.id::text, '-', ''), 1, 12)) on conflict (id) do nothing;
  insert into public.notification_preferences(user_id) values(new.id) on conflict do nothing;
  perform public.apply_signup_age_verification(new.id, new.raw_user_meta_data);
  return new;
end $$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Auth writes the user row again right after the insert (adding `sub`,
-- `email_verified` and so on to the metadata) from its in-memory copy, which
-- still holds the token, so the strip above alone does not stick. Auth also
-- copies the sign-up metadata into the email identity's identity_data. These
-- triggers keep age_token out of both on every later write.
create or replace function public.strip_age_token_from_user_metadata()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.raw_user_meta_data := new.raw_user_meta_data - 'age_token';
  return new;
end $$;

create or replace function public.strip_age_token_from_identity_data()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.identity_data := new.identity_data - 'age_token';
  return new;
end $$;

revoke all on function public.strip_age_token_from_user_metadata(), public.strip_age_token_from_identity_data()
  from public, anon, authenticated, service_role;

drop trigger if exists strip_age_token_from_user_metadata on auth.users;
create trigger strip_age_token_from_user_metadata
  before update on auth.users
  for each row when (new.raw_user_meta_data ? 'age_token')
  execute function public.strip_age_token_from_user_metadata();

-- Hygiene only (the token is single-use and already spent), so a project
-- where postgres may not add triggers to auth.identities skips it rather than
-- failing the migration.
do $$
begin
  drop trigger if exists strip_age_token_from_identity_data on auth.identities;
  create trigger strip_age_token_from_identity_data
    before insert or update on auth.identities
    for each row when (new.identity_data ? 'age_token')
    execute function public.strip_age_token_from_identity_data();
exception when insufficient_privilege then
  raise warning 'strip_age_token_from_identity_data not installed: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
-- Existing accounts (D6).
-- ---------------------------------------------------------------------------

-- Service role only: POST /api/coach/age runs the AgeVerifier, then calls this
-- for the signed-in user. Not granted to `authenticated`, so nobody can mark
-- themselves verified with the public key and skip the verifier.
create or replace function public.set_coach_age_verified(p_user_id uuid, p_method text)
returns public.user_coach_profiles
language plpgsql security definer set search_path = '' as $$
declare
  result public.user_coach_profiles;
begin
  if p_user_id is null then raise exception 'user required' using errcode = '22023'; end if;
  if p_method is null or char_length(p_method) not between 1 and 40 then
    raise exception 'invalid verification method' using errcode = '22023';
  end if;
  if not public.pivot_flag_enabled('pivot_a.enabled') then
    raise exception 'feature disabled' using errcode = 'P0001';
  end if;

  -- An earlier verification is never overwritten.
  insert into public.user_coach_profiles as profile (user_id, age_verified_at, age_verification_method)
  values (p_user_id, now(), p_method)
  on conflict (user_id) do update set
    age_verified_at = coalesce(profile.age_verified_at, excluded.age_verified_at),
    age_verification_method = case when profile.age_verified_at is null then excluded.age_verification_method else profile.age_verification_method end
  returning * into result;
  return result;
end $$;

revoke all on function public.set_coach_age_verified(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.set_coach_age_verified(uuid, text) to service_role;

comment on function public.set_coach_age_verified(uuid, text) is
  'Records that the user passed the AgeVerifier, unless already recorded. Service role only (POST /api/coach/age verifies first). Refuses while pivot_a.enabled is off.';

notify pgrst, 'reload schema';
