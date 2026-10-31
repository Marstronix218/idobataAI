-- Pivot A Phase 4: the user's all-time consistency days, for the positive-only
-- progress badge (src/lib/coach/consistency.ts).
--
-- A consistency day is a local day with at least one finished task. The total
-- must never go down (SPEC: no lost streaks, no punishment), but task_events
-- cascade-delete with their task, so counting them would drop when a user
-- deletes an old recurring task. The days are therefore kept in a ledger that
-- task deletion cannot touch: one row per (user, local date), written by the
-- finish trigger and removed only with the account.
--
-- Everything stays inert while `pivot_a.enabled` is off: the trigger returns
-- before writing anything, as before.

-- Fail fast instead of queueing behind a long transaction. Only effective
-- inside a transaction (as under `supabase db push`); a local reset just warns.
set local lock_timeout = '5s';

create table if not exists public.coach_consistency_dates (
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  -- The user's local date of a finish, as task_events.local_date records it.
  local_date date not null,
  primary key (user_id, local_date)
);

alter table public.coach_consistency_dates enable row level security;

drop policy if exists coach_consistency_dates_read_own on public.coach_consistency_dates;
create policy coach_consistency_dates_read_own on public.coach_consistency_dates for select to authenticated
  using (user_id = (select auth.uid()));

-- Clients read their own rows; only the finish trigger (definer) and the
-- service role write.
revoke all on public.coach_consistency_dates from public, anon, authenticated;
grant select on public.coach_consistency_dates to authenticated;
grant all on public.coach_consistency_dates to service_role;

comment on table public.coach_consistency_dates is
  'One row per user and local date with a finished task. Never shrinks when tasks are deleted; removed with the account. Written by record_task_finished_event.';

-- Same as 20261031120100_pivot_a_core_schema.sql, plus the ledger row on a
-- new finished event. Replacing the function leaves the trigger itself (and
-- its lock on public.tasks) untouched.
create or replace function public.record_task_finished_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  finished_at timestamptz;
  finished_date date;
  finished_event uuid;
  selected_character uuid;
begin
  if new.status <> 'completed' or (tg_op = 'UPDATE' and old.status = 'completed') then
    return null;
  end if;
  if not public.pivot_flag_enabled('pivot_a.enabled') then return null; end if;

  begin
    finished_at := coalesce(new.completed_at, now());
    finished_date := public.coach_local_date(new.owner_id, finished_at);

    insert into public.task_events(user_id, task_id, type, occurred_at, local_date, occurrence_key)
    values (new.owner_id, new.id, 'finished', finished_at, finished_date,
      coalesce(new.recurrence_instance_id, 'single'))
    on conflict (task_id, occurrence_key) where type = 'finished' do nothing
    returning id into finished_event;

    -- This occurrence was already finished once: nothing new to record.
    if finished_event is null then return null; end if;

    -- The all-time consistency days, whatever character is selected.
    insert into public.coach_consistency_dates(user_id, local_date)
    values (new.owner_id, finished_date)
    on conflict (user_id, local_date) do nothing;

    select profile.selected_character_id into selected_character
    from public.user_coach_profiles profile where profile.user_id = new.owner_id;

    -- The first finish of a local day counts once toward the selected
    -- character's story. Chapter unlocking (unlocked_through) is done by the
    -- server (src/lib/reactions/engine.ts, src/lib/coach/story.ts).
    if selected_character is not null then
      insert into public.story_progress(user_id, character_id, consistency_days, last_consistency_date)
      values (new.owner_id, selected_character, 1, finished_date)
      on conflict (user_id, character_id) do update set
        consistency_days = public.story_progress.consistency_days + 1,
        last_consistency_date = excluded.last_consistency_date
      where public.story_progress.last_consistency_date is null
         or public.story_progress.last_consistency_date < excluded.last_consistency_date;
    end if;
  exception when others then
    raise warning 'record_task_finished_event skipped for task %: % (SQLSTATE %)', new.id, sqlerrm, sqlstate;
  end;
  return null;
end $$;

revoke all on function public.record_task_finished_event() from public, anon, authenticated, service_role;

-- Backfill from the finished events that exist now. It runs last so its
-- snapshot is as late as possible; a finish committed by another session
-- before this migration commits (still on the old trigger) could be missed,
-- but Pivot A, and with it the trigger, stays off until Phase 8.
insert into public.coach_consistency_dates(user_id, local_date)
select distinct event.user_id, event.local_date
from public.task_events event
where event.type = 'finished'
on conflict (user_id, local_date) do nothing;

create or replace function public.coach_consistency_total_days(p_user_id uuid)
returns integer language sql stable security invoker set search_path = '' as $$
  select count(*)::integer
  from public.coach_consistency_dates ledger
  where ledger.user_id = p_user_id;
$$;

revoke all on function public.coach_consistency_total_days(uuid) from public, anon, authenticated, service_role;
grant execute on function public.coach_consistency_total_days(uuid) to service_role;

comment on function public.coach_consistency_total_days(uuid) is
  'Local dates with a finished task for the user (all characters, all time), from coach_consistency_dates. Never decreases. Service role only.';

notify pgrst, 'reload schema';
