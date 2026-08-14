create extension if not exists pgcrypto;

create type public.task_visibility as enum ('private', 'public');
create type public.task_status as enum ('pending', 'completed');
create type public.post_visibility as enum ('private', 'public');
create type public.post_kind as enum ('human_completion', 'human_progress', 'ai_daily_task', 'ai_progress', 'ai_completion');
create type public.content_status as enum ('active', 'hidden', 'removed');
create type public.reaction_kind as enum ('like');
create type public.engagement_kind as enum ('reply', 'reaction');
create type public.job_status as enum ('pending', 'processing', 'completed', 'failed', 'cancelled');

create table public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  avatar_url text,
  daily_goal integer not null default 3 check (daily_goal between 1 and 50),
  interests text[] not null default '{}',
  default_task_visibility public.task_visibility not null default 'private',
  xp integer not null default 0 check (xp >= 0),
  current_streak integer not null default 0 check (current_streak >= 0),
  last_completion_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint username_format check (username ~ '^[A-Za-z0-9_]{3,24}$')
);
create unique index user_profiles_username_lower_key on public.user_profiles(lower(username));

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.user_profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  description text check (description is null or char_length(description) <= 1000),
  category text check (category is null or char_length(category) <= 48),
  due_at timestamptz,
  recurrence_rule text check (recurrence_rule is null or recurrence_rule in ('daily','weekdays','weekly')),
  recurrence_instance_id text check (recurrence_instance_id is null or char_length(recurrence_instance_id) <= 100),
  visibility public.task_visibility not null default 'private',
  status public.task_status not null default 'pending',
  xp_earned integer not null default 0 check (xp_earned between 0 and 10000),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint completion_timestamp check ((status = 'completed') = (completed_at is not null))
);
create index tasks_owner_status_updated_idx on public.tasks(owner_id, status, updated_at desc);
create index tasks_owner_category_idx on public.tasks(owner_id, category) where category is not null;

create table public.public_task_progress (
  task_id uuid primary key references public.tasks(id) on delete cascade,
  owner_id uuid not null references public.user_profiles(id) on delete cascade,
  username text not null,
  avatar_url text,
  task_title text not null,
  category text,
  status public.task_status not null,
  xp_value integer,
  updated_at timestamptz not null
);
create index public_task_progress_updated_idx on public.public_task_progress(updated_at desc, task_id desc);

create table public.social_companions (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  name text not null check (char_length(name) between 1 and 50),
  avatar_url text,
  personality text not null check (char_length(personality) <= 500),
  writing_style text not null check (char_length(writing_style) <= 500),
  interests text[] not null default '{}',
  safety_instructions text not null,
  fallback_replies text[] not null,
  daily_templates text[] not null,
  active boolean not null default true,
  posting_frequency integer not null default 1 check (posting_frequency between 0 and 12),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(fallback_replies) > 0),
  check (cardinality(daily_templates) > 0)
);

create table public.social_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references public.user_profiles(id) on delete cascade,
  companion_id uuid references public.social_companions(id) on delete restrict,
  task_id uuid references public.tasks(id) on delete set null,
  kind public.post_kind not null,
  visibility public.post_visibility not null default 'public',
  content_status public.content_status not null default 'active',
  content text not null check (char_length(content) between 1 and 1200),
  task_title text check (task_title is null or char_length(task_title) <= 160),
  category text check (category is null or char_length(category) <= 48),
  xp_earned integer check (xp_earned is null or xp_earned between 0 and 10000),
  streak integer check (streak is null or streak >= 0),
  completed_at timestamptz,
  idempotency_key text check (idempotency_key is null or char_length(idempotency_key) <= 240),
  source_key text check (source_key is null or char_length(source_key) <= 160),
  is_ai_generated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint exactly_one_author check ((author_id is not null)::integer + (companion_id is not null)::integer = 1),
  constraint ai_identity_matches check (is_ai_generated = (companion_id is not null))
);
create unique index social_posts_human_idempotency_key on public.social_posts(author_id, idempotency_key) where author_id is not null and idempotency_key is not null;
create unique index social_posts_companion_source_key on public.social_posts(companion_id, source_key) where companion_id is not null and source_key is not null;
create index social_posts_feed_idx on public.social_posts(created_at desc, id desc) where content_status = 'active';
create index social_posts_author_idx on public.social_posts(author_id, created_at desc) where author_id is not null;
create index social_posts_companion_idx on public.social_posts(companion_id, created_at desc) where companion_id is not null;

create table public.social_replies (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.social_posts(id) on delete cascade,
  parent_reply_id uuid references public.social_replies(id) on delete cascade,
  author_id uuid references public.user_profiles(id) on delete cascade,
  companion_id uuid references public.social_companions(id) on delete restrict,
  content text not null check (char_length(content) between 1 and 500),
  content_status public.content_status not null default 'active',
  is_ai_generated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reply_exactly_one_author check ((author_id is not null)::integer + (companion_id is not null)::integer = 1),
  constraint reply_ai_identity_matches check (is_ai_generated = (companion_id is not null))
);
create index social_replies_post_idx on public.social_replies(post_id, created_at, id);
create index social_replies_parent_idx on public.social_replies(parent_reply_id) where parent_reply_id is not null;

create table public.social_reactions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.social_posts(id) on delete cascade,
  actor_id uuid references public.user_profiles(id) on delete cascade,
  companion_id uuid references public.social_companions(id) on delete restrict,
  reaction public.reaction_kind not null,
  created_at timestamptz not null default now(),
  constraint reaction_exactly_one_actor check ((actor_id is not null)::integer + (companion_id is not null)::integer = 1)
);
create unique index social_reactions_human_unique on public.social_reactions(post_id, actor_id) where actor_id is not null;
create unique index social_reactions_companion_unique on public.social_reactions(post_id, companion_id) where companion_id is not null;
create index social_reactions_post_idx on public.social_reactions(post_id, reaction);

create table public.social_ai_engagements (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.social_posts(id) on delete cascade,
  companion_id uuid not null references public.social_companions(id) on delete restrict,
  slot smallint not null check (slot between 1 and 3),
  kind public.engagement_kind not null,
  reply_id uuid references public.social_replies(id) on delete cascade,
  reaction_id uuid references public.social_reactions(id) on delete cascade,
  fallback_content text,
  enhanced boolean not null default false,
  created_at timestamptz not null default now(),
  unique(post_id, slot),
  unique(post_id, companion_id),
  constraint engagement_target check ((kind = 'reply' and reply_id is not null and reaction_id is null) or (kind = 'reaction' and reaction_id is not null and reply_id is null))
);

create table public.ai_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null check (job_type in ('enhance_reply', 'schedule_companion_posts')),
  dedupe_key text not null unique,
  payload jsonb not null default '{}',
  status public.job_status not null default 'pending',
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  available_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ai_jobs_claim_idx on public.ai_jobs(status, available_at, lease_expires_at) where status in ('pending', 'failed', 'processing');

create table public.notification_preferences (
  user_id uuid primary key references public.user_profiles(id) on delete cascade,
  replies boolean not null default true,
  reactions boolean not null default true,
  companion_activity boolean not null default true,
  email_digest boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  actor_id uuid references public.user_profiles(id) on delete cascade,
  companion_id uuid references public.social_companions(id) on delete restrict,
  post_id uuid references public.social_posts(id) on delete cascade,
  reply_id uuid references public.social_replies(id) on delete cascade,
  kind text not null check (kind in ('reply','reaction','system')),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  check ((actor_id is not null)::integer + (companion_id is not null)::integer <= 1)
);
create index notifications_user_unread_idx on public.notifications(user_id, created_at desc) where read_at is null;

create table public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  user_fingerprint text,
  status text not null default 'pending' check (status in ('pending','processing','auth_delete_pending','completed','failed')),
  last_error text,
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);
create index account_deletion_requests_user_idx on public.account_deletion_requests(user_id, requested_at desc);

create table public.task_completion_awards (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  owner_id uuid not null references public.user_profiles(id) on delete cascade,
  occurrence_key text not null,
  xp_awarded integer not null check (xp_awarded between 0 and 100),
  completed_at timestamptz not null default now(),
  unique(task_id, occurrence_key)
);

create table public.blocked_users (
  blocker_id uuid not null references public.user_profiles(id) on delete cascade,
  blocked_id uuid not null references public.user_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create table public.muted_companions (
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  companion_id uuid not null references public.social_companions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(user_id, companion_id)
);
create table public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.user_profiles(id) on delete cascade,
  post_id uuid references public.social_posts(id) on delete cascade,
  reply_id uuid references public.social_replies(id) on delete cascade,
  reason text not null check (char_length(reason) between 3 and 300),
  created_at timestamptz not null default now(),
  check ((post_id is not null)::integer + (reply_id is not null)::integer = 1)
);
create unique index content_reports_post_unique on public.content_reports(reporter_id, post_id) where post_id is not null;
create unique index content_reports_reply_unique on public.content_reports(reporter_id, reply_id) where reply_id is not null;

create table public.api_rate_limits (
  actor_key text not null,
  bucket text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 1,
  primary key(actor_key, bucket)
);

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger user_profiles_touch before update on public.user_profiles for each row execute function public.touch_updated_at();
create trigger tasks_touch before update on public.tasks for each row execute function public.touch_updated_at();
create trigger social_posts_touch before update on public.social_posts for each row execute function public.touch_updated_at();
create trigger social_replies_touch before update on public.social_replies for each row execute function public.touch_updated_at();
create trigger ai_jobs_touch before update on public.ai_jobs for each row execute function public.touch_updated_at();

create or replace function public.create_social_notification() returns trigger language plpgsql security definer set search_path = '' as $$
declare target_user uuid;
begin
  select author_id into target_user from public.social_posts where id=new.post_id;
  if target_user is null then return new; end if;
  if tg_table_name='social_replies' then
    if new.author_id is distinct from target_user
      and coalesce((select case when new.companion_id is not null then preferences.companion_activity else preferences.replies end from public.notification_preferences preferences where preferences.user_id=target_user),true) then
      insert into public.notifications(user_id,actor_id,companion_id,post_id,reply_id,kind)
      values(target_user,new.author_id,new.companion_id,new.post_id,new.id,'reply');
    end if;
  elsif tg_table_name='social_reactions' then
    if new.actor_id is distinct from target_user
      and coalesce((select case when new.companion_id is not null then preferences.companion_activity else preferences.reactions end from public.notification_preferences preferences where preferences.user_id=target_user),true) then
      insert into public.notifications(user_id,actor_id,companion_id,post_id,kind)
      values(target_user,new.actor_id,new.companion_id,new.post_id,'reaction');
    end if;
  end if;
  return new;
end $$;
create trigger social_replies_notify after insert on public.social_replies for each row execute function public.create_social_notification();
create trigger social_reactions_notify after insert on public.social_reactions for each row execute function public.create_social_notification();

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
declare candidate text;
begin
  candidate := coalesce(nullif(new.raw_user_meta_data->>'username', ''), 'user_' || substr(replace(new.id::text, '-', ''), 1, 8));
  if candidate !~ '^[A-Za-z0-9_]{3,24}$' then candidate := 'user_' || substr(replace(new.id::text, '-', ''), 1, 8); end if;
  insert into public.user_profiles(id, username) values(new.id, candidate)
  on conflict (id) do nothing;
  insert into public.notification_preferences(user_id) values(new.id) on conflict do nothing;
  return new;
exception when unique_violation then
  insert into public.user_profiles(id, username) values(new.id, 'user_' || substr(replace(new.id::text, '-', ''), 1, 12)) on conflict (id) do nothing;
  insert into public.notification_preferences(user_id) values(new.id) on conflict do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.sync_public_task_progress() returns trigger language plpgsql security definer set search_path = '' as $$
declare profile public.user_profiles;
begin
  if tg_op = 'DELETE' or new.visibility = 'private' then
    delete from public.public_task_progress where task_id = coalesce(new.id, old.id);
    return coalesce(new, old);
  end if;
  select * into profile from public.user_profiles where id = new.owner_id;
  insert into public.public_task_progress(task_id, owner_id, username, avatar_url, task_title, category, status, xp_value, updated_at)
  values(new.id, new.owner_id, profile.username, profile.avatar_url, new.title, new.category, new.status, new.xp_earned, new.updated_at)
  on conflict(task_id) do update set username=excluded.username, avatar_url=excluded.avatar_url, task_title=excluded.task_title,
    category=excluded.category, status=excluded.status, xp_value=excluded.xp_value, updated_at=excluded.updated_at;
  return new;
end $$;
create trigger tasks_sync_progress after insert or update or delete on public.tasks for each row execute function public.sync_public_task_progress();

create or replace function public.apply_task_completion() returns trigger language plpgsql security definer set search_path = '' as $$
declare today date := current_date; prior date; next_streak integer; occurrence text; award_id uuid;
begin
  if new.status = 'completed' and old.status <> 'completed' then
    new.completed_at := coalesce(new.completed_at, now());
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
    values(new.id,new.owner_id,occurrence,10,new.completed_at) on conflict(task_id,occurrence_key) do nothing returning id into award_id;
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
create trigger tasks_apply_completion before update of status on public.tasks for each row execute function public.apply_task_completion();

create or replace function public.publish_task_completion(p_task_id uuid, p_message text default null, p_visibility public.post_visibility default 'public', p_recurrence_instance_id text default null)
returns public.social_posts language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); t public.tasks; profile public.user_profiles; result public.social_posts; idem text;
begin
  if uid is null then raise exception 'authentication required' using errcode='42501'; end if;
  if not public.check_rate_limit('post:publish',10,60,null) then raise exception 'rate limit exceeded' using errcode='P0001'; end if;
  select * into t from public.tasks where id=p_task_id and owner_id=uid and status='completed' for update;
  if not found then raise exception 'completed task not found' using errcode='P0002'; end if;
  if p_message is not null and char_length(trim(p_message)) > 500 then raise exception 'message too long'; end if;
  if p_recurrence_instance_id is not null and nullif(trim(p_recurrence_instance_id),'') is distinct from nullif(trim(t.recurrence_instance_id),'') then raise exception 'invalid recurrence instance'; end if;
  idem := 'completion:' || uid::text || ':' || t.id::text || ':' || coalesce(nullif(trim(t.recurrence_instance_id), ''), 'single');
  select * into result from public.social_posts where author_id=uid and idempotency_key=idem;
  if found then return result; end if;
  select * into profile from public.user_profiles where id=uid;
  begin
    insert into public.social_posts(author_id,task_id,kind,visibility,content,task_title,category,xp_earned,streak,completed_at,idempotency_key)
    values(uid,t.id,'human_completion',p_visibility,coalesce(nullif(trim(p_message),''),'Completed “' || t.title || '”.'),t.title,t.category,t.xp_earned,profile.current_streak,t.completed_at,idem)
    returning * into result;
  exception when unique_violation then
    select * into result from public.social_posts where author_id=uid and idempotency_key=idem;
    return result;
  end;
  return result;
end $$;

create or replace function public.publish_progress_post(p_content text, p_visibility public.post_visibility, p_idempotency_key text, p_task_id uuid default null, p_task_title text default null, p_category text default null)
returns public.social_posts language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); result public.social_posts; idem text;
begin
  if uid is null then raise exception 'authentication required' using errcode='42501'; end if;
  if not public.check_rate_limit('post:progress',10,60,null) then raise exception 'rate limit exceeded' using errcode='P0001'; end if;
  if char_length(trim(p_content)) not between 1 and 1200 or char_length(trim(p_idempotency_key)) not between 1 and 160 then raise exception 'invalid content'; end if;
  if p_task_id is not null and not exists(select 1 from public.tasks where id=p_task_id and owner_id=uid) then raise exception 'task not found'; end if;
  idem := 'progress:' || trim(p_idempotency_key);
  select * into result from public.social_posts where author_id=uid and idempotency_key=idem;
  if found then return result; end if;
  begin
    insert into public.social_posts(author_id,task_id,kind,visibility,content,task_title,category,idempotency_key,is_ai_generated)
    values(uid,p_task_id,'human_progress',p_visibility,trim(p_content),nullif(trim(p_task_title),''),nullif(trim(p_category),''),idem,false)
    returning * into result;
  exception when unique_violation then
    select * into result from public.social_posts where author_id=uid and idempotency_key=idem;
    return result;
  end;
  return result;
end $$;

create or replace function public.set_human_reaction(p_post_id uuid, p_reaction public.reaction_kind)
returns public.social_reactions language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); result public.social_reactions;
begin
  if uid is null then raise exception 'authentication required' using errcode='42501'; end if;
  if not public.check_rate_limit('reaction:mutate',60,60,null) then raise exception 'rate limit exceeded' using errcode='P0001'; end if;
  if not exists(select 1 from public.social_posts p where p.id=p_post_id and p.content_status='active' and (p.visibility='public' or p.author_id=uid)
    and not exists(select 1 from public.blocked_users b where (b.blocker_id=uid and b.blocked_id=p.author_id) or (b.blocked_id=uid and b.blocker_id=p.author_id))
    and not exists(select 1 from public.muted_companions m where m.user_id=uid and m.companion_id=p.companion_id)) then
    raise exception 'post not found' using errcode='P0002';
  end if;
  select * into result from public.social_reactions where post_id=p_post_id and actor_id=uid for update;
  if found then
    update public.social_reactions set reaction=p_reaction where id=result.id returning * into result;
  else
    insert into public.social_reactions(post_id,actor_id,reaction) values(p_post_id,uid,p_reaction) returning * into result;
  end if;
  return result;
exception when unique_violation then
  update public.social_reactions set reaction=p_reaction where post_id=p_post_id and actor_id=uid returning * into result;
  return result;
end $$;

create or replace function public.create_human_reply(p_post_id uuid, p_content text, p_parent_reply_id uuid default null)
returns public.social_replies language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); result public.social_replies;
begin
  if uid is null then raise exception 'authentication required' using errcode='42501'; end if;
  if not public.check_rate_limit('reply:create',20,60,null) then raise exception 'rate limit exceeded' using errcode='P0001'; end if;
  if char_length(trim(p_content)) not between 1 and 500 then raise exception 'invalid reply'; end if;
  if not exists(select 1 from public.social_posts p where p.id=p_post_id and p.content_status='active' and (p.visibility='public' or p.author_id=uid)
    and not exists(select 1 from public.blocked_users b where (b.blocker_id=uid and b.blocked_id=p.author_id) or (b.blocked_id=uid and b.blocker_id=p.author_id))) then raise exception 'post not found'; end if;
  if p_parent_reply_id is not null and not exists(select 1 from public.social_replies r where r.id=p_parent_reply_id and r.post_id=p_post_id and r.content_status='active') then raise exception 'invalid parent reply'; end if;
  insert into public.social_replies(post_id,parent_reply_id,author_id,content,is_ai_generated)
  values(p_post_id,p_parent_reply_id,uid,trim(p_content),false) returning * into result;
  return result;
end $$;

create or replace function public.report_content(p_post_id uuid default null, p_reply_id uuid default null, p_reason text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); report_id uuid;
begin
  if uid is null then raise exception 'authentication required' using errcode='42501'; end if;
  if not public.check_rate_limit('moderation:report',10,3600,null) then raise exception 'rate limit exceeded' using errcode='P0001'; end if;
  if (p_post_id is not null)::integer + (p_reply_id is not null)::integer <> 1 or p_reason is null or char_length(trim(p_reason)) not between 3 and 300 then raise exception 'invalid report'; end if;
  if p_post_id is not null and not exists(
    select 1 from public.social_posts p where p.id=p_post_id and p.content_status<>'removed'
      and (p.visibility='public' or p.author_id=uid)
      and not exists(select 1 from public.blocked_users b where (b.blocker_id=uid and b.blocked_id=p.author_id) or (b.blocked_id=uid and b.blocker_id=p.author_id))
  ) then raise exception 'post not found'; end if;
  if p_reply_id is not null and not exists(
    select 1 from public.social_replies r join public.social_posts p on p.id=r.post_id
    where r.id=p_reply_id and r.content_status<>'removed' and p.content_status<>'removed'
      and (p.visibility='public' or p.author_id=uid)
      and not exists(select 1 from public.blocked_users b where (b.blocker_id=uid and b.blocked_id=p.author_id) or (b.blocked_id=uid and b.blocker_id=p.author_id))
  ) then raise exception 'reply not found'; end if;
  insert into public.content_reports(reporter_id,post_id,reply_id,reason) values(uid,p_post_id,p_reply_id,trim(p_reason))
  on conflict do nothing returning id into report_id;
  if report_id is null then select id into report_id from public.content_reports where reporter_id=uid and (post_id=p_post_id or reply_id=p_reply_id); end if;
  return report_id;
end $$;

create or replace function public.set_user_block(p_blocked_id uuid, p_blocked boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); changed integer;
begin
  if uid is null then raise exception 'authentication required' using errcode='42501'; end if;
  if not public.check_rate_limit('moderation:block',60,3600,null) then raise exception 'rate limit exceeded' using errcode='P0001'; end if;
  if p_blocked_id=uid or not exists(select 1 from public.user_profiles where id=p_blocked_id) then raise exception 'invalid user'; end if;
  if p_blocked then
    insert into public.blocked_users(blocker_id,blocked_id) values(uid,p_blocked_id) on conflict do nothing;
  else
    delete from public.blocked_users where blocker_id=uid and blocked_id=p_blocked_id;
  end if;
  get diagnostics changed = row_count;
  return changed > 0;
end $$;

create or replace function public.set_companion_mute(p_companion_id uuid, p_muted boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); changed integer;
begin
  if uid is null then raise exception 'authentication required' using errcode='42501'; end if;
  if not public.check_rate_limit('moderation:mute',60,3600,null) then raise exception 'rate limit exceeded' using errcode='P0001'; end if;
  if not exists(select 1 from public.social_companions where id=p_companion_id) then raise exception 'invalid companion'; end if;
  if p_muted then
    insert into public.muted_companions(user_id,companion_id) values(uid,p_companion_id) on conflict do nothing;
  else
    delete from public.muted_companions where user_id=uid and companion_id=p_companion_id;
  end if;
  get diagnostics changed = row_count;
  return changed > 0;
end $$;

create or replace function public.mark_notifications_read(p_ids uuid[] default null, p_all boolean default false)
returns integer language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); changed integer;
begin
  if uid is null then raise exception 'authentication required' using errcode='42501'; end if;
  if not p_all and (p_ids is null or cardinality(p_ids) not between 1 and 100) then raise exception 'invalid notification selection'; end if;
  update public.notifications set read_at=coalesce(read_at,now()) where user_id=uid and read_at is null and (p_all or id=any(p_ids));
  get diagnostics changed = row_count;
  return changed;
end $$;

create or replace function public.claim_ai_jobs(p_limit integer default 5, p_lease_seconds integer default 120)
returns setof public.ai_jobs language plpgsql security definer set search_path = '' as $$
begin
  return query with candidates as (
    select id from public.ai_jobs where attempts < max_attempts and available_at <= now()
      and (status in ('pending','failed') or (status='processing' and lease_expires_at <= now()))
    order by available_at, created_at for update skip locked limit greatest(1,least(p_limit,25))
  ) update public.ai_jobs j set status='processing',attempts=j.attempts+1,lease_token=gen_random_uuid(),lease_expires_at=now()+make_interval(secs=>greatest(30,least(p_lease_seconds,600))),last_error=null
  from candidates where j.id=candidates.id returning j.*;
end $$;

create or replace function public.complete_ai_job(p_job_id uuid, p_lease_token uuid)
returns boolean language sql security definer set search_path = '' as $$
  update public.ai_jobs set status='completed',completed_at=now(),lease_token=null,lease_expires_at=null
  where id=p_job_id and status='processing' and lease_token=p_lease_token and lease_expires_at > now()
  returning true;
$$;

create or replace function public.finalize_ai_reply_job(p_job_id uuid, p_lease_token uuid, p_content text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  reply_uuid uuid;
  post_uuid uuid;
  companion_uuid uuid;
begin
  if char_length(trim(p_content)) not between 1 and 500 then
    raise exception 'invalid generated reply';
  end if;

  select (j.payload->>'replyId')::uuid, (j.payload->>'postId')::uuid, (j.payload->>'companionId')::uuid
  into reply_uuid, post_uuid, companion_uuid
  from public.ai_jobs j
  where j.id=p_job_id and j.job_type='enhance_reply' and j.status='processing'
    and j.lease_token=p_lease_token and j.lease_expires_at > now()
  for update;

  if not found then return false; end if;
  if not exists(
    select 1
    from public.social_ai_engagements e
    join public.social_replies r on r.id=e.reply_id and r.post_id=e.post_id and r.companion_id=e.companion_id
    join public.social_posts p on p.id=e.post_id
    join public.social_companions c on c.id=e.companion_id
    where e.reply_id=reply_uuid and e.post_id=post_uuid and e.companion_id=companion_uuid
      and e.kind='reply' and r.content_status='active' and p.content_status='active' and c.active
      and not exists(
        select 1 from public.content_reports report
        where report.post_id=post_uuid or report.reply_id=reply_uuid
      )
  ) then return false; end if;

  update public.social_replies set content=trim(p_content) where id=reply_uuid;
  update public.social_ai_engagements set enhanced=true where reply_id=reply_uuid;
  update public.ai_jobs set status='completed',completed_at=now(),lease_token=null,lease_expires_at=null where id=p_job_id;
  return true;
end $$;
create or replace function public.fail_ai_job(p_job_id uuid, p_lease_token uuid, p_error text, p_cooldown_seconds integer default 60)
returns boolean language sql security definer set search_path = '' as $$
  update public.ai_jobs set status=case when attempts>=max_attempts then 'cancelled'::public.job_status else 'failed'::public.job_status end,
    available_at=now()+make_interval(secs=>greatest(30,least(p_cooldown_seconds,86400))),last_error=left(p_error,1000),lease_token=null,lease_expires_at=null
  where id=p_job_id and status='processing' and lease_token=p_lease_token returning true;
$$;

create or replace function public.schedule_companion_posts(p_date date default current_date)
returns integer language plpgsql security definer set search_path = '' as $$
declare c record; inserted integer := 0; template text; scheduled_kind public.post_kind;
begin
  for c in select * from public.social_companions where active and posting_frequency > 0 loop
    template := coalesce(c.daily_templates[1 + (abs(hashtext(c.id::text || p_date::text)) % cardinality(c.daily_templates))], c.name || ' is planning a focused day.');
    scheduled_kind := case abs(hashtext(c.id::text || ':' || p_date::text)) % 3
      when 0 then 'ai_daily_task'::public.post_kind
      when 1 then 'ai_progress'::public.post_kind
      else 'ai_completion'::public.post_kind
    end;
    insert into public.social_posts(companion_id,kind,visibility,content,source_key,is_ai_generated,created_at)
    values(c.id,scheduled_kind,'public',template,'daily:'||c.id::text||':'||p_date::text,true,p_date::timestamptz + make_interval(hours=>8+(abs(hashtext(c.id::text||p_date::text))%11)))
    on conflict(companion_id,source_key) where companion_id is not null and source_key is not null do nothing;
    if found then inserted := inserted + 1; end if;
  end loop;
  return inserted;
end $$;

create or replace function public.check_rate_limit(p_bucket text, p_limit integer, p_window_seconds integer, p_actor_key text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare actor text := coalesce(auth.uid()::text,p_actor_key); allowed boolean;
begin
  if actor is null then return false; end if;
  insert into public.api_rate_limits(actor_key,bucket,window_started_at,request_count) values(actor,p_bucket,now(),1)
  on conflict(actor_key,bucket) do update set
    window_started_at=case when public.api_rate_limits.window_started_at <= now()-make_interval(secs=>p_window_seconds) then now() else public.api_rate_limits.window_started_at end,
    request_count=case when public.api_rate_limits.window_started_at <= now()-make_interval(secs=>p_window_seconds) then 1 else public.api_rate_limits.request_count+1 end
  returning request_count <= p_limit into allowed;
  return allowed;
end $$;

alter table public.user_profiles enable row level security;
alter table public.tasks enable row level security;
alter table public.public_task_progress enable row level security;
alter table public.social_companions enable row level security;
alter table public.social_posts enable row level security;
alter table public.social_replies enable row level security;
alter table public.social_reactions enable row level security;
alter table public.social_ai_engagements enable row level security;
alter table public.ai_jobs enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.notifications enable row level security;
alter table public.account_deletion_requests enable row level security;
alter table public.task_completion_awards enable row level security;
alter table public.blocked_users enable row level security;
alter table public.muted_companions enable row level security;
alter table public.content_reports enable row level security;
alter table public.api_rate_limits enable row level security;

create policy profiles_read on public.user_profiles for select to authenticated using (true);
create policy profiles_update_self on public.user_profiles for update to authenticated using (id=auth.uid()) with check (id=auth.uid());
create policy tasks_owner_all on public.tasks for all to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
create policy progress_read on public.public_task_progress for select to authenticated using(
  not exists(select 1 from public.blocked_users b where (b.blocker_id=auth.uid() and b.blocked_id=owner_id) or (b.blocked_id=auth.uid() and b.blocker_id=owner_id))
);
create policy companions_read on public.social_companions for select to authenticated using(active or exists(select 1 from public.social_ai_engagements e where e.companion_id=id));
create policy posts_read on public.social_posts for select to authenticated using(content_status='active' and (visibility='public' or author_id=auth.uid()) and not exists(select 1 from public.blocked_users b where (b.blocker_id=auth.uid() and b.blocked_id=social_posts.author_id) or (b.blocked_id=auth.uid() and b.blocker_id=social_posts.author_id)) and not exists(select 1 from public.muted_companions m where m.user_id=auth.uid() and m.companion_id=social_posts.companion_id));
create policy posts_owner_update on public.social_posts for update to authenticated using(author_id=auth.uid()) with check(author_id=auth.uid() and companion_id is null and is_ai_generated=false);
create policy posts_owner_delete on public.social_posts for delete to authenticated using(author_id=auth.uid());
create policy replies_read on public.social_replies for select to authenticated using(content_status='active'
  and not exists(select 1 from public.blocked_users b where (b.blocker_id=auth.uid() and b.blocked_id=social_replies.author_id) or (b.blocked_id=auth.uid() and b.blocker_id=social_replies.author_id))
  and not exists(select 1 from public.muted_companions m where m.user_id=auth.uid() and m.companion_id=social_replies.companion_id)
  and exists(select 1 from public.social_posts p where p.id=post_id and p.content_status='active' and (p.visibility='public' or p.author_id=auth.uid()) and not exists(select 1 from public.blocked_users b where (b.blocker_id=auth.uid() and b.blocked_id=p.author_id) or (b.blocked_id=auth.uid() and b.blocker_id=p.author_id)) and not exists(select 1 from public.muted_companions m where m.user_id=auth.uid() and m.companion_id=p.companion_id)));
create policy replies_human_insert on public.social_replies for insert to authenticated with check(author_id=auth.uid() and companion_id is null and is_ai_generated=false and exists(select 1 from public.social_posts p where p.id=post_id and p.content_status='active' and (p.visibility='public' or p.author_id=auth.uid()) and not exists(select 1 from public.blocked_users b where (b.blocker_id=auth.uid() and b.blocked_id=p.author_id) or (b.blocked_id=auth.uid() and b.blocker_id=p.author_id)) and not exists(select 1 from public.muted_companions m where m.user_id=auth.uid() and m.companion_id=p.companion_id)));
create policy replies_owner_delete on public.social_replies for delete to authenticated using(author_id=auth.uid());
create policy reactions_read on public.social_reactions for select to authenticated using(
  not exists(select 1 from public.blocked_users b where (b.blocker_id=auth.uid() and b.blocked_id=social_reactions.actor_id) or (b.blocked_id=auth.uid() and b.blocker_id=social_reactions.actor_id))
  and
  not exists(select 1 from public.muted_companions m where m.user_id=auth.uid() and m.companion_id=social_reactions.companion_id)
  and exists(select 1 from public.social_posts p where p.id=post_id and p.content_status='active' and (p.visibility='public' or p.author_id=auth.uid()) and not exists(select 1 from public.blocked_users b where (b.blocker_id=auth.uid() and b.blocked_id=p.author_id) or (b.blocked_id=auth.uid() and b.blocker_id=p.author_id)) and not exists(select 1 from public.muted_companions m where m.user_id=auth.uid() and m.companion_id=p.companion_id)));
create policy reactions_human_insert on public.social_reactions for insert to authenticated with check(actor_id=auth.uid() and companion_id is null and exists(select 1 from public.social_posts p where p.id=post_id and p.content_status='active' and (p.visibility='public' or p.author_id=auth.uid()) and not exists(select 1 from public.blocked_users b where (b.blocker_id=auth.uid() and b.blocked_id=p.author_id) or (b.blocked_id=auth.uid() and b.blocker_id=p.author_id))));
create policy reactions_owner_update on public.social_reactions for update to authenticated using(actor_id=auth.uid()) with check(actor_id=auth.uid() and companion_id is null);
create policy reactions_owner_delete on public.social_reactions for delete to authenticated using(actor_id=auth.uid());
create policy preferences_owner_all on public.notification_preferences for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy notifications_owner_read on public.notifications for select to authenticated using(user_id=auth.uid());
create policy notifications_owner_update on public.notifications for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy awards_owner_read on public.task_completion_awards for select to authenticated using(owner_id=auth.uid());
create policy blocks_owner_all on public.blocked_users for all to authenticated using(blocker_id=auth.uid()) with check(blocker_id=auth.uid());
create policy mutes_owner_all on public.muted_companions for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy reports_owner_insert on public.content_reports for insert to authenticated with check(reporter_id=auth.uid());
create policy reports_owner_read on public.content_reports for select to authenticated using(reporter_id=auth.uid());

revoke all on public.ai_jobs, public.api_rate_limits, public.account_deletion_requests, public.social_ai_engagements from anon, authenticated;
grant select on public.user_profiles, public.tasks, public.public_task_progress, public.social_companions,
  public.social_posts, public.social_replies, public.social_reactions, public.notification_preferences,
  public.notifications, public.task_completion_awards, public.blocked_users, public.muted_companions,
  public.content_reports to authenticated;
grant delete on public.tasks, public.social_posts, public.social_replies, public.social_reactions to authenticated;
grant update on public.notification_preferences to authenticated;
revoke insert on public.social_posts from authenticated;
revoke update on public.social_posts from authenticated;
revoke insert on public.social_replies from authenticated;
revoke insert, update on public.social_reactions from authenticated;
revoke insert on public.tasks from authenticated;
grant insert(owner_id,title,description,category,due_at,recurrence_rule,visibility,status) on public.tasks to authenticated;
revoke update on public.user_profiles from authenticated;
grant update(username,avatar_url,daily_goal,interests,default_task_visibility) on public.user_profiles to authenticated;
revoke update on public.tasks from authenticated;
grant update(title,description,category,due_at,recurrence_rule,visibility,status) on public.tasks to authenticated;
revoke update on public.notifications from authenticated;
revoke insert, delete on public.notifications from authenticated;
revoke insert, update, delete on public.blocked_users, public.muted_companions, public.content_reports from authenticated;
revoke execute on function public.handle_new_user(), public.create_social_notification(), public.sync_public_task_progress(), public.apply_task_completion(),
  public.publish_task_completion(uuid,text,public.post_visibility,text), public.publish_progress_post(text,public.post_visibility,text,uuid,text,text),
  public.create_human_reply(uuid,text,uuid), public.set_human_reaction(uuid,public.reaction_kind), public.claim_ai_jobs(integer,integer),
  public.complete_ai_job(uuid,uuid), public.finalize_ai_reply_job(uuid,uuid,text), public.fail_ai_job(uuid,uuid,text,integer), public.schedule_companion_posts(date),
  public.check_rate_limit(text,integer,integer,text), public.report_content(uuid,uuid,text), public.set_user_block(uuid,boolean),
  public.set_companion_mute(uuid,boolean), public.mark_notifications_read(uuid[],boolean) from public, anon, authenticated;
grant execute on function public.publish_task_completion(uuid,text,public.post_visibility,text), public.publish_progress_post(text,public.post_visibility,text,uuid,text,text), public.create_human_reply(uuid,text,uuid), public.set_human_reaction(uuid,public.reaction_kind), public.report_content(uuid,uuid,text), public.set_user_block(uuid,boolean), public.set_companion_mute(uuid,boolean), public.mark_notifications_read(uuid[],boolean) to authenticated;
grant execute on function public.claim_ai_jobs(integer,integer), public.complete_ai_job(uuid,uuid), public.finalize_ai_reply_job(uuid,uuid,text), public.fail_ai_job(uuid,uuid,text,integer), public.schedule_companion_posts(date) to service_role;
