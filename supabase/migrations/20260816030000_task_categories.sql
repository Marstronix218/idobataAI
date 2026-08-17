create table public.task_categories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 48 and name = btrim(name)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index task_categories_owner_name_idx
  on public.task_categories(owner_id, lower(btrim(name)));
create index task_categories_owner_updated_idx
  on public.task_categories(owner_id, updated_at desc);

create trigger task_categories_touch
before update on public.task_categories
for each row execute function public.touch_updated_at();

insert into public.task_categories(owner_id, name)
select owner_id, min(btrim(category))
from public.tasks
where category is not null and btrim(category) <> ''
group by owner_id, lower(btrim(category));

alter table public.task_categories enable row level security;

create policy task_categories_owner_all
  on public.task_categories
  for all
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

grant select, delete on public.task_categories to authenticated;
grant insert(owner_id, name) on public.task_categories to authenticated;
grant update(name) on public.task_categories to authenticated;

create or replace function public.sync_task_category_library()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  canonical_name text;
begin
  if new.category is null or btrim(new.category) = '' then
    new.category := null;
    return new;
  end if;

  new.category := btrim(new.category);

  select category.name
  into canonical_name
  from public.task_categories category
  where category.owner_id = new.owner_id
    and lower(category.name) = lower(new.category)
  limit 1;

  if canonical_name is null then
    begin
      insert into public.task_categories(owner_id, name)
      values (new.owner_id, new.category)
      returning name into canonical_name;
    exception when unique_violation then
      select category.name
      into canonical_name
      from public.task_categories category
      where category.owner_id = new.owner_id
        and lower(category.name) = lower(new.category)
      limit 1;
    end;
  end if;

  new.category := canonical_name;
  return new;
end;
$$;

create trigger sync_task_category_library_before_write
before insert or update of category on public.tasks
for each row execute function public.sync_task_category_library();

create or replace function public.propagate_task_category_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and old.name is distinct from new.name then
    update public.tasks
    set category = new.name
    where owner_id = old.owner_id
      and category is not null
      and lower(btrim(category)) = lower(old.name);
    return new;
  end if;

  if tg_op = 'DELETE' then
    update public.tasks
    set category = null
    where owner_id = old.owner_id
      and category is not null
      and lower(btrim(category)) = lower(old.name);
    return old;
  end if;

  return new;
end;
$$;

create trigger task_categories_propagate_rename
after update of name on public.task_categories
for each row execute function public.propagate_task_category_change();

create trigger task_categories_clear_tasks_before_delete
before delete on public.task_categories
for each row execute function public.propagate_task_category_change();

create or replace function public.rename_task_category(p_category_id uuid, p_name text)
returns public.task_categories
language plpgsql
set search_path = public, pg_temp
as $$
declare
  current_category public.task_categories;
  renamed_category public.task_categories;
  clean_name text := btrim(p_name);
begin
  if char_length(clean_name) not between 1 and 48 then
    raise exception 'Category name must be between 1 and 48 characters.' using errcode = '22023';
  end if;

  select *
  into current_category
  from public.task_categories
  where id = p_category_id and owner_id = auth.uid()
  for update;

  if current_category.id is null then
    raise exception 'Task category not found.' using errcode = 'P0002';
  end if;

  update public.task_categories
  set name = clean_name
  where id = current_category.id
  returning * into renamed_category;

  return renamed_category;
end;
$$;

create or replace function public.delete_task_category(p_category_id uuid)
returns boolean
language plpgsql
set search_path = public, pg_temp
as $$
declare
  current_category public.task_categories;
begin
  select *
  into current_category
  from public.task_categories
  where id = p_category_id and owner_id = auth.uid()
  for update;

  if current_category.id is null then
    raise exception 'Task category not found.' using errcode = 'P0002';
  end if;

  delete from public.task_categories where id = current_category.id;
  return true;
end;
$$;

revoke execute on function public.rename_task_category(uuid, text), public.delete_task_category(uuid) from public, anon;
grant execute on function public.rename_task_category(uuid, text), public.delete_task_category(uuid) to authenticated;

comment on table public.task_categories is
  'Reusable, user-owned labels for optional task organization.';
comment on function public.rename_task_category(uuid, text) is
  'Renames a user-owned task category and propagates the new label to current tasks.';
comment on function public.delete_task_category(uuid) is
  'Deletes a user-owned task category and clears it from current tasks without rewriting published post snapshots.';
