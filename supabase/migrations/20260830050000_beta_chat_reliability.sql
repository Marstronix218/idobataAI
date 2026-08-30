begin;

alter table public.chat_messages
  add column client_request_id uuid,
  add column reply_to_message_id uuid references public.chat_messages(id) on delete set null;

create unique index chat_messages_user_request_key
  on public.chat_messages(sender_user_id, client_request_id)
  where sender_user_id is not null and client_request_id is not null;

create unique index chat_messages_companion_reply_key
  on public.chat_messages(reply_to_message_id)
  where sender_companion_id is not null and reply_to_message_id is not null;

create index chat_messages_daily_ai_usage_idx
  on public.chat_messages(sender_user_id, created_at desc)
  where sender_user_id is not null and client_request_id is not null;

create or replace function public.create_beta_chat_message(
  p_user_id uuid,
  p_thread_id uuid,
  p_content text,
  p_client_request_id uuid,
  p_daily_limit integer
)
returns public.chat_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.chat_threads;
  result public.chat_messages;
  daily_count integer;
begin
  if p_user_id is null or not exists(select 1 from public.user_profiles where id = p_user_id) then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_client_request_id is null then
    raise exception 'client request id is required' using errcode = '22023';
  end if;
  if char_length(trim(p_content)) not between 1 and 2000 then
    raise exception 'message must be between 1 and 2000 characters';
  end if;
  if p_daily_limit not between 1 and 10000 then
    raise exception 'invalid daily chat limit' using errcode = '22023';
  end if;

  -- Serialize a user's sends so the daily limit and request-key lookup remain
  -- correct even when two browser tabs submit at the same time.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('beta-ai-chat:' || p_user_id::text, 0)
  );

  select * into result
  from public.chat_messages
  where sender_user_id = p_user_id
    and client_request_id = p_client_request_id;
  if found then
    if result.thread_id <> p_thread_id or result.content <> trim(p_content) then
      raise exception 'client request id was already used' using errcode = '22023';
    end if;
    return result;
  end if;

  select * into target from public.chat_threads where id = p_thread_id for update;
  if not found or (p_user_id <> target.user_one_id and p_user_id is distinct from target.user_two_id) then
    raise exception 'chat not found' using errcode = 'P0002';
  end if;
  if target.user_two_id is not null and exists(
    select 1 from public.blocked_users
    where (blocker_id = target.user_one_id and blocked_id = target.user_two_id)
       or (blocker_id = target.user_two_id and blocked_id = target.user_one_id)
  ) then raise exception 'chat unavailable' using errcode = '42501'; end if;

  if not public.check_rate_limit('chat:send', 60, 60, p_user_id::text) then
    raise exception 'rate limit exceeded' using errcode = 'P0001';
  end if;

  if target.companion_id is not null then
    if exists(
      select 1 from public.muted_companions
      where user_id = p_user_id and companion_id = target.companion_id
    ) then raise exception 'AI profile is muted' using errcode = '42501'; end if;
    if not public.check_rate_limit('chat:ai', 12, 60, p_user_id::text) then
      raise exception 'AI chat rate limit exceeded' using errcode = 'P0001';
    end if;

    select count(*) into daily_count
    from public.chat_messages m
    join public.chat_threads t on t.id = m.thread_id
    where m.sender_user_id = p_user_id
      and m.client_request_id is not null
      and t.companion_id is not null
      and m.created_at >= (pg_catalog.date_trunc('day', pg_catalog.timezone('utc', now())) at time zone 'utc');
    if daily_count >= p_daily_limit then
      raise exception 'daily AI chat limit exceeded' using errcode = 'P0001';
    end if;
  end if;

  insert into public.chat_messages(thread_id, sender_user_id, content, is_ai_generated, client_request_id)
  values(target.id, p_user_id, trim(p_content), false, p_client_request_id)
  returning * into result;

  update public.chat_threads set
    last_message_preview = left(trim(p_content), 240),
    last_sender_user_id = p_user_id,
    last_sender_companion_id = null,
    last_message_at = result.created_at
  where id = target.id;

  return result;
end $$;

create or replace function public.create_companion_chat_reply(
  p_thread_id uuid,
  p_companion_id uuid,
  p_user_message_id uuid,
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

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('beta-ai-reply:' || p_user_message_id::text, 0)
  );

  select * into result
  from public.chat_messages
  where reply_to_message_id = p_user_message_id
    and sender_companion_id = p_companion_id;
  if found then return result; end if;

  if not exists(
    select 1
    from public.chat_threads t
    join public.social_companions c on c.id = t.companion_id
    join public.chat_messages m on m.thread_id = t.id
    where t.id = p_thread_id
      and t.companion_id = p_companion_id
      and c.active
      and m.id = p_user_message_id
      and m.sender_user_id = t.user_one_id
      and m.sender_companion_id is null
      and m.content_status = 'active'
  ) then raise exception 'AI chat message not found' using errcode = 'P0002'; end if;

  insert into public.chat_messages(
    thread_id,
    sender_companion_id,
    content,
    is_ai_generated,
    reply_to_message_id
  ) values(
    p_thread_id,
    p_companion_id,
    trim(p_content),
    true,
    p_user_message_id
  ) returning * into result;

  update public.chat_threads set
    last_message_preview = left(trim(p_content), 240),
    last_sender_user_id = null,
    last_sender_companion_id = p_companion_id,
    last_message_at = result.created_at
  where id = p_thread_id;

  return result;
end $$;

revoke execute on function public.create_chat_message(uuid, text)
from authenticated;

revoke all on function public.create_beta_chat_message(uuid, uuid, text, uuid, integer),
  public.create_companion_chat_reply(uuid, uuid, uuid, text)
from public, anon, authenticated;

grant execute on function public.create_beta_chat_message(uuid, uuid, text, uuid, integer),
  public.create_companion_chat_reply(uuid, uuid, uuid, text)
to service_role;

commit;
