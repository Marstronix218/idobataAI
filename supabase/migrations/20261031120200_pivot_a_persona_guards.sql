-- Pivot A persona guardrails enforced by the database itself, so they hold even
-- if a TypeScript flag read fails or a client calls an RPC through PostgREST
-- directly. One BEFORE INSERT trigger per table is the single choke point for
-- every writer (cron, worker finalizers, chat RPCs), instead of re-gating each
-- function body.
--
-- With the flags at their defaults (pivot_a.enabled off, derived rows absent)
-- every guard lets the row through unchanged.
--
-- Posts, replies and reposts are skipped silently (the trigger returns null), so the
-- scheduler, reconciler and worker finalizers keep running without errors.
-- Persona chat raises 'feature disabled', because a user is waiting on it.

-- Fail fast instead of queueing behind a long transaction. Only effective
-- inside a transaction (as under `supabase db push`); a local reset just warns.
set local lock_timeout = '5s';

-- AI-authored posts: social_posts enforces exactly one author and
-- is_ai_generated = (companion_id is not null), so companion_id identifies them.
create or replace function public.guard_persona_post_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.companion_id is not null and not public.pivot_flag_enabled('persona_autopost.enabled') then
    return null;
  end if;
  return new;
end $$;

-- AI-authored replies stop entirely under Pivot A: sharing is people-only.
create or replace function public.guard_persona_reply_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.companion_id is not null and public.pivot_flag_enabled('pivot_a.enabled') then
    return null;
  end if;
  return new;
end $$;

-- Persona reposts stop under Pivot A too. finalize_social_action has no flag
-- check for reposts, so this guard is what stops them; a skipped row raises no
-- repost notification because that trigger runs after insert.
create or replace function public.guard_persona_repost_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.companion_id is not null and public.pivot_flag_enabled('pivot_a.enabled') then
    return null;
  end if;
  return new;
end $$;

create or replace function public.guard_persona_chat_thread_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.companion_id is not null and not public.pivot_flag_enabled('persona_chat.enabled') then
    raise exception 'feature disabled' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- Covers both the user's messages and the persona's replies in a companion thread.
create or replace function public.guard_persona_chat_message_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not public.pivot_flag_enabled('persona_chat.enabled') and exists(
    select 1 from public.chat_threads thread
    where thread.id = new.thread_id and thread.companion_id is not null
  ) then
    raise exception 'feature disabled' using errcode = 'P0001';
  end if;
  return new;
end $$;

revoke all on function
  public.guard_persona_post_insert(),
  public.guard_persona_reply_insert(),
  public.guard_persona_repost_insert(),
  public.guard_persona_chat_thread_insert(),
  public.guard_persona_chat_message_insert()
  from public, anon, authenticated, service_role;

-- CREATE OR REPLACE TRIGGER takes SHARE ROW EXCLUSIVE on each table; a
-- DROP TRIGGER IF EXISTS would take ACCESS EXCLUSIVE, blocking reads too.
-- Human rows never reach the guard functions.
create or replace trigger social_posts_guard_persona_insert
  before insert on public.social_posts
  for each row when (new.companion_id is not null)
  execute function public.guard_persona_post_insert();
create or replace trigger social_replies_guard_persona_insert
  before insert on public.social_replies
  for each row when (new.companion_id is not null)
  execute function public.guard_persona_reply_insert();
create or replace trigger social_reposts_guard_persona_insert
  before insert on public.social_reposts
  for each row when (new.companion_id is not null)
  execute function public.guard_persona_repost_insert();
create or replace trigger chat_threads_guard_persona_insert
  before insert on public.chat_threads
  for each row when (new.companion_id is not null)
  execute function public.guard_persona_chat_thread_insert();
create or replace trigger chat_messages_guard_persona_insert
  before insert on public.chat_messages
  for each row execute function public.guard_persona_chat_message_insert();
