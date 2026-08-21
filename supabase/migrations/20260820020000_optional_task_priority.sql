alter table public.tasks
  alter column priority drop default,
  alter column priority drop not null;

comment on column public.tasks.priority is
  'Optional task priority from 1 (highest) through 4 (lowest).';
