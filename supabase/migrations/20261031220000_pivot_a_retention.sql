-- Pivot A Phase 8: retention (SPEC "Minimal memory" and Phase 8 "Purge job").
--
-- purge_pivot_a_expired() deletes, in bounded batches:
-- - character_reactions older than 30 days (the generated reaction text the
--   spec allows to be kept for at most 30 days);
-- - age_verification_tokens that expired more than a day ago. A token lives 15
--   minutes and handle_new_user deletes the row it consumes, so these are
--   tokens nobody signed up with (or rows a failed sign-up left behind).
--
-- The daily cron (/api/cron/pivot-a-daily) calls it as its first step, on its
-- own, and repeats the call while it reports `more`. Each call is its own
-- short statement and transaction, so a large first run is spread over many
-- small deletes instead of one statement that could hit a timeout and roll
-- back everything. The route is always on (not behind pivot_a), so the purge
-- keeps running if Pivot A is switched off again.
--
-- Index support: character_reactions_created_idx (created_at) and
-- age_verification_tokens_expires_at_idx (expires_at) already exist.

-- Fail fast instead of queueing behind a long transaction while holding locks
-- that block the app. Only effective inside a transaction (as under
-- `supabase db push`); a non-transactional local reset just warns.
set local lock_timeout = '5s';

create or replace function public.purge_pivot_a_expired(p_batch_size integer default 5000)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  batch_size integer := least(greatest(coalesce(p_batch_size, 5000), 1), 50000);
  reactions_deleted integer := 0;
  tokens_deleted integer := 0;
begin
  -- Oldest first, at most one batch per table per call. Rows another
  -- transaction holds are skipped; the next call or the next day gets them.
  with expired as (
    select reaction.id
    from public.character_reactions reaction
    where reaction.created_at < pg_catalog.now() - interval '30 days'
    order by reaction.created_at
    limit batch_size
    for update skip locked
  )
  delete from public.character_reactions reaction
  using expired
  where reaction.id = expired.id;
  get diagnostics reactions_deleted = row_count;

  with expired as (
    select token.token_hash
    from public.age_verification_tokens token
    where token.expires_at < pg_catalog.now() - interval '1 day'
    order by token.expires_at
    limit batch_size
    for update skip locked
  )
  delete from public.age_verification_tokens token
  using expired
  where token.token_hash = expired.token_hash;
  get diagnostics tokens_deleted = row_count;

  return pg_catalog.jsonb_build_object(
    'character_reactions', reactions_deleted,
    'age_verification_tokens', tokens_deleted,
    -- A full batch may have left more behind: call again.
    'more', reactions_deleted = batch_size or tokens_deleted = batch_size
  );
end $$;

revoke all on function public.purge_pivot_a_expired(integer) from public, anon, authenticated, service_role;
grant execute on function public.purge_pivot_a_expired(integer) to service_role;

comment on function public.purge_pivot_a_expired(integer) is
  'Pivot A retention: deletes up to p_batch_size (1..50000, default 5000) character_reactions older than 30 days and age_verification_tokens expired more than a day ago. Returns {character_reactions, age_verification_tokens, more}; call again while more is true. Service role only; the daily cron runs it.';

-- ---------------------------------------------------------------------------
-- Service-role read of public.tasks.
--
-- The reaction engine (src/lib/reactions/engine.ts) and the splitter
-- (src/lib/reactions/splitter.ts) read the task's id, title, description and
-- created_at with the service role, filtered by owner. Projects created before
-- Supabase changed its default privileges gave service_role every privilege
-- on new public tables; a fresh project (CLI 2.115 / Postgres 17.6.1.155)
-- gives it none on tables created without explicit grants, so those reads fail
-- with 42501 and users get no reactions and no splits. Every other table the
-- Pivot A server code reads or writes with the service role is a Pivot A table
-- with explicit grants, or is reached through a security definer function.
-- Granting a privilege that is already held is a no-op.
-- ---------------------------------------------------------------------------

grant select on public.tasks to service_role;

-- Account deletion (src/app/api/account/route.ts) records, anonymises and
-- finalises its audit row with the service role; without these grants a
-- fresh project could not delete accounts at all.
grant select, insert, update on public.account_deletion_requests to service_role;

notify pgrst, 'reload schema';
