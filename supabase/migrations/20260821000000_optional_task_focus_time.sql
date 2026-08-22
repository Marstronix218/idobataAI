alter table public.tasks
  add column focus_minutes integer
  constraint tasks_focus_minutes_range check (focus_minutes between 1 and 480);

comment on column public.tasks.focus_minutes is
  'Optional soft time limit in minutes for focusing on a task; no countdown state is persisted.';

grant insert(focus_minutes) on public.tasks to authenticated;
grant update(focus_minutes) on public.tasks to authenticated;
