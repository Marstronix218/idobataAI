alter table public.tasks
  drop constraint if exists tasks_focus_minutes_range,
  drop constraint if exists tasks_due_time_requires_date,
  drop constraint if exists tasks_deadline_metadata_consistent,
  drop column if exists focus_minutes,
  add column if not exists due_has_time boolean,
  add column if not exists due_timezone text;

update public.tasks set due_has_time = false where due_has_time is null;
update public.tasks set due_timezone = 'UTC' where due_has_time and due_timezone is null;
update public.tasks set due_timezone = null where not due_has_time;

alter table public.tasks
  alter column due_has_time set default false,
  alter column due_has_time set not null;

alter table public.tasks
  add constraint tasks_deadline_metadata_consistent check (
    (not due_has_time and due_timezone is null)
    or (
      due_has_time
      and due_at is not null
      and due_timezone is not null
      and due_timezone <> ''
      and char_length(due_timezone) <= 100
      and timezone(due_timezone, due_at) is not null
    )
  );

comment on column public.tasks.due_has_time is
  'Whether due_at includes an exact deadline time instead of representing a date-only due day.';
comment on column public.tasks.due_timezone is
  'IANA time zone used to preserve the local wall clock for an exact recurring deadline.';

grant insert(due_has_time) on public.tasks to authenticated;
grant update(due_has_time) on public.tasks to authenticated;
grant insert(due_timezone) on public.tasks to authenticated;
grant update(due_timezone) on public.tasks to authenticated;

-- Completion identity and streak dates follow the exact deadline's local day.
-- Date-only tasks deliberately retain the original database-current-date
-- behavior because their UTC-noon sentinel has no associated time zone.
create or replace function public.apply_task_completion()
returns trigger language plpgsql security definer set search_path = '' as $$
declare today date; prior date; next_streak integer; occurrence text; award_id uuid;
begin
  if new.status = 'completed' and old.status <> 'completed' then
    new.completed_at := coalesce(new.completed_at, now());
    today := case
      when new.due_has_time then (new.completed_at at time zone new.due_timezone)::date
      else current_date
    end;
    new.xp_earned := 10;
    if new.recurrence_rule = 'weekdays' and extract(isodow from today) > 5 then
      raise exception 'weekday task cannot be completed on a weekend';
    end if;
    occurrence := case
      when new.recurrence_rule is null then 'single'
      when new.recurrence_rule = 'weekly' then to_char(today, 'IYYY-"W"IW')
      else today::text
    end;
    new.recurrence_instance_id := case when new.recurrence_rule is null then null else occurrence end;
    insert into public.task_completion_awards(task_id,owner_id,occurrence_key,xp_awarded,completed_at)
    values(new.id,new.owner_id,occurrence,10,new.completed_at)
    on conflict(task_id,occurrence_key) do nothing returning id into award_id;
    if award_id is not null then
      select last_completion_date into prior from public.user_profiles where id = new.owner_id for update;
      next_streak := case when prior = today then (select current_streak from public.user_profiles where id=new.owner_id)
        when prior = today - 1 then (select current_streak + 1 from public.user_profiles where id=new.owner_id) else 1 end;
      update public.user_profiles set xp = xp + 10, current_streak = next_streak, last_completion_date = today where id = new.owner_id;
    end if;
  elsif new.status = 'pending' and old.status = 'completed' then
    new.completed_at := null;
  end if;
  return new;
end $$;

revoke all on function public.apply_task_completion() from public, anon, authenticated;

-- Exact recurring deadlines retain their local wall-clock time across UTC
-- offset changes. Date-only tasks keep the original UTC-noon sentinel logic.
create or replace function public.rollover_recurring_tasks(p_date date default current_date)
returns integer language plpgsql security definer set search_path = '' as $$
declare rolled integer;
begin
  with due as (
    -- Exact deadlines advance from the completed local occurrence on the first
    -- cron after completion. Completed/pending status is the idempotence gate;
    -- p_date must not delay users west of UTC until their target is overdue.
    select
      t.id,
      t.due_has_time,
      t.due_timezone,
      schedule.next_date,
      (t.due_at at time zone t.due_timezone)::time as due_time
    from public.tasks t
    cross join lateral (
      select case
        when t.recurrence_rule = 'weekly' then
          date_trunc('week', (t.completed_at at time zone t.due_timezone)::date)::date
            + 7
            + extract(isodow from (t.due_at at time zone t.due_timezone)::date)::integer - 1
        when t.recurrence_rule = 'weekdays' then
          public.next_recurrence_date('weekdays', (t.completed_at at time zone t.due_timezone)::date + 1)
        else (t.completed_at at time zone t.due_timezone)::date + 1
      end as next_date
    ) schedule
    where t.status = 'completed'
      and t.due_has_time
      and t.recurrence_rule is not null
      and t.completed_at is not null
      and t.recurrence_instance_id is not null

    union all

    -- Date-only recurrence retains the established p_date behavior exactly.
    select
      t.id,
      t.due_has_time,
      t.due_timezone,
      public.next_recurrence_date(t.recurrence_rule, p_date) as next_date,
      coalesce(t.due_at::time, time '12:00') as due_time
    from public.tasks t
    where t.status = 'completed'
      and not t.due_has_time
      and t.recurrence_rule is not null
      and t.recurrence_instance_id is distinct from public.task_occurrence_key(t.recurrence_rule, p_date)
  )
  update public.tasks t
     set status = 'pending',
         completed_at = null,
         recurrence_instance_id = null,
         due_at = case
           when due.due_has_time then (due.next_date + due.due_time) at time zone due.due_timezone
           else (due.next_date + due.due_time) at time zone 'UTC'
         end,
         updated_at = now()
    from due
   where t.id = due.id;
  get diagnostics rolled = row_count;
  return rolled;
end $$;

revoke all on function public.rollover_recurring_tasks(date) from public, anon, authenticated;
