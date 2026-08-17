alter table public.tasks
  add column priority smallint not null default 4
  constraint tasks_priority_range check (priority between 1 and 4);

create index tasks_owner_status_priority_updated_idx
  on public.tasks(owner_id, status, priority, updated_at desc);

revoke insert on public.tasks from authenticated;
grant insert(owner_id,title,description,category,due_at,recurrence_rule,visibility,status,priority)
  on public.tasks to authenticated;

revoke update on public.tasks from authenticated;
grant update(title,description,category,due_at,recurrence_rule,visibility,status,priority)
  on public.tasks to authenticated;
