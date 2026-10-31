-- One character reaction per task event. The reaction engine checks for an
-- existing row first, but two truly concurrent requests for the same event
-- could both pass that check and insert; the second now fails with 23505.
-- Reactions without a task event (e.g. session nudges) stay unconstrained.

-- Fail fast instead of queueing behind a long transaction. Only effective
-- inside a transaction (as under `supabase db push`); a local reset just warns.
set local lock_timeout = '5s';

create unique index if not exists character_reactions_task_event_key
  on public.character_reactions(task_event_id) where task_event_id is not null;

-- Same column and predicate as the unique index above, so it is redundant.
drop index if exists public.character_reactions_task_event_idx;
