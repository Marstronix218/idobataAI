create table public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  user_one_id uuid not null references public.user_profiles(id) on delete cascade,
  user_two_id uuid references public.user_profiles(id) on delete cascade,
  companion_id uuid references public.social_companions(id) on delete cascade,
  created_by uuid not null references public.user_profiles(id) on delete cascade,
  last_message_preview text,
  last_sender_user_id uuid references public.user_profiles(id) on delete set null,
  last_sender_companion_id uuid references public.social_companions(id) on delete set null,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chat_thread_peer_kind check (
    (user_two_id is not null)::integer + (companion_id is not null)::integer = 1
  ),
  constraint chat_thread_distinct_users check (user_two_id is null or user_one_id < user_two_id),
  constraint chat_thread_creator_is_participant check (
    created_by = user_one_id or created_by = user_two_id
  ),
  constraint chat_thread_last_sender_kind check (
    (last_sender_user_id is not null)::integer + (last_sender_companion_id is not null)::integer <= 1
  ),
  constraint chat_thread_preview_length check (
    last_message_preview is null or char_length(last_message_preview) <= 240
  )
);

create unique index chat_threads_human_pair_key
  on public.chat_threads(user_one_id, user_two_id)
  where user_two_id is not null;
create unique index chat_threads_ai_pair_key
  on public.chat_threads(user_one_id, companion_id)
  where companion_id is not null;
create index chat_threads_user_one_recent_idx
  on public.chat_threads(user_one_id, last_message_at desc nulls last, created_at desc);
create index chat_threads_user_two_recent_idx
  on public.chat_threads(user_two_id, last_message_at desc nulls last, created_at desc)
  where user_two_id is not null;

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  sender_user_id uuid references public.user_profiles(id) on delete cascade,
  sender_companion_id uuid references public.social_companions(id) on delete restrict,
  content text not null check (char_length(content) between 1 and 2000),
  content_status public.content_status not null default 'active',
  is_ai_generated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chat_message_exactly_one_sender check (
    (sender_user_id is not null)::integer + (sender_companion_id is not null)::integer = 1
  ),
  constraint chat_message_ai_identity_matches check (
    is_ai_generated = (sender_companion_id is not null)
  )
);

create index chat_messages_thread_recent_idx
  on public.chat_messages(thread_id, created_at desc, id desc)
  where content_status = 'active';

create trigger chat_threads_touch
  before update on public.chat_threads
  for each row execute function public.touch_updated_at();
create trigger chat_messages_touch
  before update on public.chat_messages
  for each row execute function public.touch_updated_at();

create or replace function public.get_or_create_chat_thread(
  p_user_id uuid default null,
  p_companion_id uuid default null
)
returns public.chat_threads
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  first_user uuid;
  second_user uuid;
  result public.chat_threads;
begin
  if uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if (p_user_id is not null)::integer + (p_companion_id is not null)::integer <> 1 then
    raise exception 'choose exactly one chat recipient';
  end if;

  if p_user_id is not null then
    if p_user_id = uid then raise exception 'cannot message yourself'; end if;
    if not exists(select 1 from public.user_profiles where id = p_user_id) then
      raise exception 'user not found' using errcode = 'P0002';
    end if;
    if exists(
      select 1 from public.blocked_users
      where (blocker_id = uid and blocked_id = p_user_id)
         or (blocker_id = p_user_id and blocked_id = uid)
    ) then raise exception 'chat unavailable' using errcode = '42501'; end if;

    first_user := least(uid, p_user_id);
    second_user := greatest(uid, p_user_id);
    select * into result from public.chat_threads
      where user_one_id = first_user and user_two_id = second_user;
    if found then return result; end if;

    begin
      insert into public.chat_threads(user_one_id, user_two_id, created_by)
      values(first_user, second_user, uid)
      returning * into result;
    exception when unique_violation then
      select * into result from public.chat_threads
        where user_one_id = first_user and user_two_id = second_user;
    end;
    return result;
  end if;

  if not exists(select 1 from public.social_companions where id = p_companion_id and active) then
    raise exception 'AI profile not found' using errcode = 'P0002';
  end if;
  if exists(
    select 1 from public.muted_companions
    where user_id = uid and companion_id = p_companion_id
  ) then raise exception 'AI profile is muted' using errcode = '42501'; end if;

  select * into result from public.chat_threads
    where user_one_id = uid and companion_id = p_companion_id;
  if found then return result; end if;

  begin
    insert into public.chat_threads(user_one_id, companion_id, created_by)
    values(uid, p_companion_id, uid)
    returning * into result;
  exception when unique_violation then
    select * into result from public.chat_threads
      where user_one_id = uid and companion_id = p_companion_id;
  end;
  return result;
end $$;

create or replace function public.create_chat_message(p_thread_id uuid, p_content text)
returns public.chat_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  target public.chat_threads;
  result public.chat_messages;
begin
  if uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if char_length(trim(p_content)) not between 1 and 2000 then
    raise exception 'message must be between 1 and 2000 characters';
  end if;
  if not public.check_rate_limit('chat:send', 60, 60, null) then
    raise exception 'rate limit exceeded' using errcode = 'P0001';
  end if;

  select * into target from public.chat_threads where id = p_thread_id for update;
  if not found or (uid <> target.user_one_id and uid is distinct from target.user_two_id) then
    raise exception 'chat not found' using errcode = 'P0002';
  end if;
  if target.user_two_id is not null and exists(
    select 1 from public.blocked_users
    where (blocker_id = target.user_one_id and blocked_id = target.user_two_id)
       or (blocker_id = target.user_two_id and blocked_id = target.user_one_id)
  ) then raise exception 'chat unavailable' using errcode = '42501'; end if;
  if target.companion_id is not null then
    if exists(
      select 1 from public.muted_companions
      where user_id = uid and companion_id = target.companion_id
    ) then raise exception 'AI profile is muted' using errcode = '42501'; end if;
    if not public.check_rate_limit('chat:ai', 12, 60, null) then
      raise exception 'AI chat rate limit exceeded' using errcode = 'P0001';
    end if;
  end if;

  insert into public.chat_messages(thread_id, sender_user_id, content, is_ai_generated)
  values(target.id, uid, trim(p_content), false)
  returning * into result;

  update public.chat_threads set
    last_message_preview = left(trim(p_content), 240),
    last_sender_user_id = uid,
    last_sender_companion_id = null,
    last_message_at = result.created_at
  where id = target.id;

  return result;
end $$;

create or replace function public.create_companion_chat_message(
  p_thread_id uuid,
  p_companion_id uuid,
  p_content text
)
returns public.chat_messages
language plpgsql
security definer
set search_path = ''
as $$
declare result public.chat_messages;
begin
  if char_length(trim(p_content)) not between 1 and 2000 then
    raise exception 'invalid AI chat message';
  end if;
  if not exists(
    select 1 from public.chat_threads t
    join public.social_companions c on c.id = t.companion_id
    where t.id = p_thread_id and t.companion_id = p_companion_id and c.active
  ) then raise exception 'AI chat not found' using errcode = 'P0002'; end if;

  insert into public.chat_messages(thread_id, sender_companion_id, content, is_ai_generated)
  values(p_thread_id, p_companion_id, trim(p_content), true)
  returning * into result;

  update public.chat_threads set
    last_message_preview = left(trim(p_content), 240),
    last_sender_user_id = null,
    last_sender_companion_id = p_companion_id,
    last_message_at = result.created_at
  where id = p_thread_id;

  return result;
end $$;

alter table public.chat_threads enable row level security;
alter table public.chat_messages enable row level security;

create policy chat_threads_participant_read
on public.chat_threads for select to authenticated
using (
  auth.uid() = user_one_id or auth.uid() = user_two_id
);

create policy chat_messages_participant_read
on public.chat_messages for select to authenticated
using (
  content_status = 'active'
  and exists(
    select 1 from public.chat_threads t
    where t.id = thread_id
      and (auth.uid() = t.user_one_id or auth.uid() = t.user_two_id)
  )
);

revoke all on public.chat_threads, public.chat_messages from anon, authenticated;
grant select on public.chat_threads, public.chat_messages to authenticated;

revoke execute on function public.get_or_create_chat_thread(uuid, uuid),
  public.create_chat_message(uuid, text),
  public.create_companion_chat_message(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.get_or_create_chat_thread(uuid, uuid),
  public.create_chat_message(uuid, text)
to authenticated;
grant execute on function public.create_companion_chat_message(uuid, uuid, text)
to service_role;
