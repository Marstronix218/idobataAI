-- Recurring-task rollover and query-shape indexes.
--
-- Two independent concerns land together because both are pure additions:
--   1. Completed recurring tasks never returned to the pending state, so a
--      "Daily routine" fired exactly once and the habit loop could not repeat.
--   2. Four hot query shapes had no supporting index.

-- ---------------------------------------------------------------------------
-- 1. Recurring-task rollover
-- ---------------------------------------------------------------------------

-- Occurrence key for a rule on a given date, matching apply_task_completion().
create or replace function public.task_occurrence_key(p_rule text, p_date date)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_rule is null then null
    when p_rule = 'weekly' then to_char(p_date, 'IYYY-"W"IW')
    else p_date::text
  end;
$$;

-- The next date a rule is actionable on or after p_date. 'weekdays' skips the
-- weekend because apply_task_completion() rejects a weekend completion.
create or replace function public.next_recurrence_date(p_rule text, p_date date)
returns date language sql immutable set search_path = '' as $$
  select case
    when p_rule = 'weekdays' then
      case extract(isodow from p_date)
        when 6 then p_date + 2
        when 7 then p_date + 1
        else p_date
      end
    else p_date
  end;
$$;

-- Return completed recurring tasks to pending once their occurrence has passed.
--
-- Idempotent: a task is only touched when its stored occurrence key differs
-- from the current one, and the reset clears that key, so repeated runs within
-- the same occurrence are no-ops. Safe to schedule hourly.
create or replace function public.rollover_recurring_tasks(p_date date default current_date)
returns integer language plpgsql security definer set search_path = '' as $$
declare rolled integer;
begin
  with due as (
    select
      t.id,
      public.next_recurrence_date(t.recurrence_rule, p_date) as next_date,
      coalesce(t.due_at::time, time '12:00') as due_time
    from public.tasks t
    where t.status = 'completed'
      and t.recurrence_rule is not null
      and t.recurrence_instance_id is distinct from public.task_occurrence_key(t.recurrence_rule, p_date)
  )
  update public.tasks t
     set status = 'pending',
         completed_at = null,
         recurrence_instance_id = null,
         due_at = (due.next_date + due.due_time) at time zone 'UTC',
         updated_at = now()
    from due
   where t.id = due.id;
  get diagnostics rolled = row_count;
  return rolled;
end $$;

revoke all on function public.rollover_recurring_tasks(date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Indexes for existing query shapes
-- ---------------------------------------------------------------------------
--
-- Every table below is empty or near-empty pre-beta, so a plain build is fine.
-- Once these carry production rows, further index changes should use
-- `create index concurrently` in a standalone migration to avoid a write lock.

-- blocked_users is checked in both directions by posts_read, replies_read,
-- reactions_read, progress_read, set_human_reaction, create_human_reply and
-- report_content. The primary key covers (blocker_id, blocked_id) only, so the
-- reverse-direction predicate had no index and scanned per candidate row.
create index if not exists blocked_users_blocked_idx
  on public.blocked_users(blocked_id, blocker_id);

-- The notifications "All" tab is the default view, but the only index was
-- partial on `read_at is null` and so could not serve it. The id tiebreaker
-- matches the keyset cursor.
create index if not exists notifications_user_created_idx
  on public.notifications(user_id, created_at desc, id desc);

-- "People only" is a first-class feed. Companion posts accrue on a fixed daily
-- schedule regardless of user count, so without this the human feed scans an
-- ever-growing majority of companion rows to find a page of human posts.
create index if not exists social_posts_human_feed_idx
  on public.social_posts(created_at desc, id desc)
  where content_status = 'active' and companion_id is null;

-- Category-filtered feeds ("following" scope and explicit category filters).
create index if not exists social_posts_category_feed_idx
  on public.social_posts(category, created_at desc, id desc)
  where content_status = 'active' and category is not null;
