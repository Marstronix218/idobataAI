-- Durable, lease-backed social actions for living AI personas.

create table public.user_companion_relationships (
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  companion_id uuid not null references public.social_companions(id) on delete cascade,
  user_followed_at timestamptz,
  companion_follow_state text not null default 'none'
    check (companion_follow_state in ('none','pending','following')),
  companion_follow_requested_at timestamptz,
  companion_followed_at timestamptz,
  dm_opt_in boolean not null default false,
  companion_dm_started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(user_id, companion_id),
  check (companion_follow_state <> 'pending' or companion_follow_requested_at is not null),
  check (companion_follow_state <> 'following' or companion_followed_at is not null)
);

create table public.social_reposts (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.social_posts(id) on delete cascade,
  actor_id uuid references public.user_profiles(id) on delete cascade,
  companion_id uuid references public.social_companions(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint repost_exactly_one_actor check (
    (actor_id is not null)::integer + (companion_id is not null)::integer = 1
  )
);
create unique index social_reposts_human_unique
  on public.social_reposts(post_id, actor_id) where actor_id is not null;
create unique index social_reposts_companion_unique
  on public.social_reposts(post_id, companion_id) where companion_id is not null;
create index social_reposts_post_created_idx on public.social_reposts(post_id, created_at desc);

create table public.companion_user_memory (
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  companion_id uuid not null references public.social_companions(id) on delete cascade,
  summary text not null default '' check (char_length(summary) <= 2000),
  facts jsonb not null default '{}'::jsonb check (jsonb_typeof(facts) in ('object','array')),
  source_watermark uuid references public.chat_messages(id) on delete set null,
  expires_at timestamptz,
  reset_at timestamptz,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(user_id, companion_id)
);
create index companion_user_memory_expiry_idx
  on public.companion_user_memory(expires_at) where expires_at is not null;

create trigger user_companion_relationships_touch before update
  on public.user_companion_relationships for each row execute function public.touch_updated_at();
create trigger companion_user_memory_touch before update
  on public.companion_user_memory for each row execute function public.touch_updated_at();

-- Active personas cannot silently opt out of the product's daily minimum.
update public.social_companions
set posting_frequency=3
where active and posting_frequency < 3;

with fallback_catalog as (
  select companion.id,
    jsonb_agg(jsonb_build_object(
      'task_title', 'Finish ' || coalesce(nullif(companion.interests[1 + ((slot-1) % greatest(cardinality(companion.interests),1))],''),'daily') || ' task ' || slot,
      'category', initcap(coalesce(nullif(companion.interests[1 + ((slot-1) % greatest(cardinality(companion.interests),1))],''),'Daily')),
      'content', companion.daily_templates[1 + ((slot-1) % cardinality(companion.daily_templates))]
    ) order by slot) posts
  from public.social_companions companion
  cross join lateral generate_series(1,companion.posting_frequency) slot
  where companion.active and jsonb_array_length(companion.daily_posts) < companion.posting_frequency
  group by companion.id
)
update public.social_companions companion
set daily_posts=fallback_catalog.posts
from fallback_catalog where companion.id=fallback_catalog.id;

alter table public.social_companions
  drop constraint if exists social_companions_active_post_cadence,
  add constraint social_companions_active_post_cadence check(
    not active or (
      posting_frequency between 3 and 12
      and jsonb_array_length(daily_posts) >= posting_frequency
    )
  );

-- Convert the old result-only engagement records into a planned action ledger.
alter table public.social_ai_engagements drop constraint if exists social_ai_engagements_post_id_slot_key;
alter table public.social_ai_engagements drop constraint if exists social_ai_engagements_post_id_companion_id_key;
alter table public.social_ai_engagements drop constraint if exists engagement_target;
alter table public.social_ai_engagements alter column slot drop not null;
alter table public.social_ai_engagements alter column kind type text using kind::text;
alter table public.social_ai_engagements
  add column dedupe_key text,
  add column source text,
  add column state text,
  add column scheduled_for timestamptz,
  add column target_reply_id uuid references public.social_replies(id) on delete cascade,
  add column repost_id uuid references public.social_reposts(id) on delete cascade,
  add column failure_reason text;

update public.social_ai_engagements
set dedupe_key = 'legacy:' || id::text,
    source = 'ambient',
    state = 'completed',
    scheduled_for = created_at;

alter table public.social_ai_engagements
  alter column dedupe_key set not null,
  alter column source set not null,
  alter column state set not null,
  alter column scheduled_for set not null,
  alter column scheduled_for set default now(),
  add constraint social_ai_engagements_kind_check check (kind in ('reply','reaction','repost')),
  add constraint social_ai_engagements_source_check check (
    source in ('human_post_guarantee','human_reply_response','daily_quota','ambient')
  ),
  add constraint social_ai_engagements_state_check check (
    state in ('planned','processing','completed','failed','cancelled')
  ),
  add constraint social_ai_engagements_failure_reason_length check (
    failure_reason is null or char_length(failure_reason) <= 1000
  );
create unique index social_ai_engagements_dedupe_key on public.social_ai_engagements(dedupe_key);
create index social_ai_engagements_schedule_idx
  on public.social_ai_engagements(state, scheduled_for) where state in ('planned','failed');
create index social_ai_engagements_companion_day_idx
  on public.social_ai_engagements(companion_id, scheduled_for, source);

-- Replace the generated check constraint without depending on its generated name.
do $$
declare constraint_name text;
begin
  select con.conname into constraint_name
  from pg_constraint con
  where con.conrelid = 'public.ai_jobs'::regclass
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) like '%job_type%';
  if constraint_name is not null then
    execute format('alter table public.ai_jobs drop constraint %I', constraint_name);
  end if;
end $$;
alter table public.ai_jobs add constraint ai_jobs_job_type_check
  check (job_type in ('enhance_reply','schedule_companion_posts','perform_social_action'));

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('reply','reaction','follow','system'));
create unique index notifications_companion_follow_unique
  on public.notifications(user_id, companion_id, kind) where kind='follow';

create or replace function public.enqueue_social_action(
  p_dedupe_key text,
  p_source text,
  p_kind text,
  p_post_id uuid,
  p_companion_id uuid,
  p_target_reply_id uuid default null,
  p_scheduled_for timestamptz default now()
) returns uuid language plpgsql security definer set search_path = '' as $$
declare action_id uuid;
begin
  insert into public.social_ai_engagements(
    post_id, companion_id, kind, dedupe_key, source, state,
    scheduled_for, target_reply_id
  ) values (
    p_post_id, p_companion_id, p_kind, p_dedupe_key, p_source, 'planned',
    p_scheduled_for, p_target_reply_id
  )
  on conflict(dedupe_key) do update set dedupe_key=excluded.dedupe_key
  returning id into action_id;

  insert into public.ai_jobs(job_type, dedupe_key, payload, available_at)
  values(
    'perform_social_action', 'social-action:' || p_dedupe_key,
    jsonb_build_object('actionId',action_id,'engagementId',action_id,'postId',p_post_id,
      'companionId',p_companion_id,'kind',p_kind,'targetReplyId',p_target_reply_id),
    p_scheduled_for
  ) on conflict(dedupe_key) do nothing;
  return action_id;
end $$;

create or replace function public.sync_social_action_job_state() returns trigger
language plpgsql security definer set search_path = '' as $$
declare action_id uuid;
begin
  if new.job_type <> 'perform_social_action' then return new; end if;
  action_id := coalesce((new.payload->>'engagementId')::uuid,(new.payload->>'actionId')::uuid);
  update public.social_ai_engagements set
    state=case new.status
      when 'pending' then 'planned'
      when 'processing' then 'processing'
      when 'failed' then 'failed'
      when 'cancelled' then 'cancelled'
      when 'completed' then 'completed'
    end,
    failure_reason=case when new.status in ('failed','cancelled') then left(new.last_error,1000) else null end
  where id=action_id;
  return new;
end $$;

drop trigger if exists ai_jobs_sync_social_action_state on public.ai_jobs;
create trigger ai_jobs_sync_social_action_state
  after update of status, last_error on public.ai_jobs
  for each row execute function public.sync_social_action_job_state();

create or replace function public.enqueue_human_post_engagements() returns trigger
language plpgsql security definer set search_path = '' as $$
declare selected_companion uuid;
begin
  if new.author_id is null or new.companion_id is not null or new.is_ai_generated then return new; end if;
  if not coalesce((select p.companion_activity from public.notification_preferences p where p.user_id=new.author_id), true) then return new; end if;

  select c.id into selected_companion
  from public.social_companions c
  where c.active
    and not exists(select 1 from public.muted_companions m where m.user_id=new.author_id and m.companion_id=c.id)
  order by hashtextextended(new.id::text || ':' || c.id::text, 0), c.id
  limit 1;
  if selected_companion is null then return new; end if;

  perform public.enqueue_social_action('human-post:reply:'||new.id, 'human_post_guarantee',
    'reply', new.id, selected_companion, null, now());
  perform public.enqueue_social_action('human-post:like:'||new.id, 'ambient',
    'reaction', new.id, selected_companion, null, now()+interval '1 minute');
  return new;
end $$;

drop trigger if exists social_posts_enqueue_persona_engagements on public.social_posts;
create trigger social_posts_enqueue_persona_engagements after insert on public.social_posts
  for each row execute function public.enqueue_human_post_engagements();

create or replace function public.enqueue_human_reply_engagements() returns trigger
language plpgsql security definer set search_path = '' as $$
declare target_companion uuid;
begin
  if new.author_id is null or new.companion_id is not null or new.is_ai_generated then return new; end if;

  if new.parent_reply_id is not null then
    select r.companion_id into target_companion from public.social_replies r where r.id=new.parent_reply_id;
  else
    select p.companion_id into target_companion from public.social_posts p where p.id=new.post_id;
  end if;
  if target_companion is null
    or not exists(select 1 from public.social_companions c where c.id=target_companion and c.active)
    or exists(select 1 from public.muted_companions m where m.user_id=new.author_id and m.companion_id=target_companion)
    or not coalesce((select p.companion_activity from public.notification_preferences p where p.user_id=new.author_id), true)
  then return new; end if;

  perform public.enqueue_social_action('human-reply:response:'||new.id, 'human_reply_response',
    'reply', new.post_id, target_companion, new.id, now());
  perform public.enqueue_social_action('human-reply:like:'||new.id, 'ambient',
    'reaction', new.post_id, target_companion, new.id, now()+interval '1 minute');
  return new;
end $$;

drop trigger if exists social_replies_enqueue_persona_engagements on public.social_replies;
create trigger social_replies_enqueue_persona_engagements after insert on public.social_replies
  for each row execute function public.enqueue_human_reply_engagements();

create or replace function public.set_user_companion_follow(p_companion_id uuid, p_following boolean)
returns public.user_companion_relationships language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); result public.user_companion_relationships;
begin
  if uid is null then raise exception 'authentication required' using errcode='42501'; end if;
  if not exists(select 1 from public.social_companions c where c.id=p_companion_id and c.active) then
    raise exception 'companion not found' using errcode='P0002';
  end if;
  insert into public.user_companion_relationships(user_id,companion_id,user_followed_at)
  values(uid,p_companion_id,case when p_following then now() end)
  on conflict(user_id,companion_id) do update
    set user_followed_at=case when p_following then coalesce(public.user_companion_relationships.user_followed_at,now()) end,
        dm_opt_in=case when p_following then public.user_companion_relationships.dm_opt_in else false end
  returning * into result;
  return result;
end $$;

create or replace function public.start_companion_dm(
  p_user_id uuid, p_companion_id uuid, p_content text
) returns public.chat_messages language plpgsql security definer set search_path = '' as $$
declare relationship public.user_companion_relationships; thread public.chat_threads; result public.chat_messages;
begin
  if char_length(trim(p_content)) not between 1 and 2000 then raise exception 'invalid companion DM'; end if;
  select r.* into relationship from public.user_companion_relationships r
  join public.social_companions c on c.id=r.companion_id and c.active
  where r.user_id=p_user_id and r.companion_id=p_companion_id
    and r.user_followed_at is not null and r.companion_follow_state='following' and r.dm_opt_in
    and not exists(select 1 from public.muted_companions m where m.user_id=p_user_id and m.companion_id=p_companion_id)
    and coalesce((select n.companion_activity from public.notification_preferences n where n.user_id=p_user_id),true)
  for update of r;
  if not found then raise exception 'mutual DM permission required' using errcode='42501'; end if;
  if relationship.companion_dm_started_at is not null then return null; end if;

  select * into thread from public.chat_threads
  where user_one_id=p_user_id and companion_id=p_companion_id for update;
  if not found then
    begin
      insert into public.chat_threads(user_one_id,companion_id,created_by)
      values(p_user_id,p_companion_id,p_user_id) returning * into thread;
    exception when unique_violation then
      select * into thread from public.chat_threads
      where user_one_id=p_user_id and companion_id=p_companion_id for update;
    end;
  end if;

  insert into public.chat_messages(thread_id,sender_companion_id,content,is_ai_generated)
  values(thread.id,p_companion_id,trim(p_content),true) returning * into result;
  update public.chat_threads set last_message_preview=left(trim(p_content),240),
    last_sender_user_id=null,last_sender_companion_id=p_companion_id,last_message_at=result.created_at
  where id=thread.id;
  update public.user_companion_relationships set companion_dm_started_at=result.created_at
  where user_id=p_user_id and companion_id=p_companion_id;
  return result;
end $$;

create or replace function public.respond_companion_follow(p_companion_id uuid, p_accept boolean)
returns public.user_companion_relationships language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); result public.user_companion_relationships;
begin
  if uid is null then raise exception 'authentication required' using errcode='42501'; end if;
  perform 1 from public.user_companion_relationships
    where user_id=uid and companion_id=p_companion_id and companion_follow_state='pending' for update;
  if not found then raise exception 'no pending companion follow request' using errcode='P0001'; end if;
  update public.user_companion_relationships set
    companion_follow_state=case when p_accept then 'following' else 'none' end,
    companion_followed_at=case when p_accept then now() end,
    dm_opt_in=case when p_accept then dm_opt_in else false end
  where user_id=uid and companion_id=p_companion_id
  returning * into result;
  return result;
end $$;

create or replace function public.set_companion_dm_opt_in(p_companion_id uuid, p_opt_in boolean)
returns public.user_companion_relationships language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); result public.user_companion_relationships; companion_name text; companion_topic text;
begin
  if uid is null then raise exception 'authentication required' using errcode='42501'; end if;
  if p_opt_in and not exists(
    select 1 from public.user_companion_relationships r
    where r.user_id=uid and r.companion_id=p_companion_id
      and r.user_followed_at is not null and r.companion_follow_state='following'
  ) then raise exception 'mutual follow required for companion DMs' using errcode='P0001'; end if;
  insert into public.user_companion_relationships(user_id,companion_id,dm_opt_in)
  values(uid,p_companion_id,p_opt_in)
  on conflict(user_id,companion_id) do update set dm_opt_in=excluded.dm_opt_in
  returning * into result;
  if p_opt_in and result.companion_dm_started_at is null then
    select c.name,coalesce(nullif(c.interests[1],''),'what you are working on')
      into companion_name,companion_topic from public.social_companions c where c.id=p_companion_id;
    perform public.start_companion_dm(uid,p_companion_id,
      'Hi, it''s '||companion_name||', your AI companion. You invited me to message you here. If you want, tell me what is on your mind: '||companion_topic||' or anything else.');
    select * into result from public.user_companion_relationships where user_id=uid and companion_id=p_companion_id;
  end if;
  return result;
end $$;

create or replace function public.reset_companion_memory(p_companion_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); changed boolean;
begin
  if uid is null then raise exception 'authentication required' using errcode='42501'; end if;
  if not exists(select 1 from public.social_companions where id=p_companion_id) then
    raise exception 'companion not found' using errcode='P0002';
  end if;
  insert into public.companion_user_memory(
    user_id,companion_id,summary,facts,source_watermark,expires_at,reset_at,version
  ) values(uid,p_companion_id,'','{}'::jsonb,null,null,now(),1)
  on conflict(user_id,companion_id) do update set
    summary='',facts='{}'::jsonb,source_watermark=null,expires_at=null,reset_at=now(),
    version=public.companion_user_memory.version+1
  returning true into changed;
  return coalesce(changed,false);
end $$;

create or replace function public.refresh_companion_memory(
  p_user_id uuid,
  p_companion_id uuid,
  p_summary text,
  p_facts jsonb,
  p_source_watermark uuid,
  p_expires_at timestamptz,
  p_expected_version integer,
  p_memory_boundary timestamptz
) returns boolean language plpgsql security definer set search_path = '' as $$
declare current_memory public.companion_user_memory; next_boundary timestamptz;
begin
  if char_length(p_summary) not between 1 and 2000
    or jsonb_typeof(p_facts) not in ('object','array')
    or p_expires_at <= now()
    or p_expected_version < 0
  then raise exception 'invalid companion memory refresh'; end if;
  if p_source_watermark is not null and not exists(
    select 1 from public.chat_messages message
    join public.chat_threads thread on thread.id=message.thread_id
    where message.id=p_source_watermark and thread.user_one_id=p_user_id
      and thread.companion_id=p_companion_id and message.sender_user_id=p_user_id
  ) then raise exception 'invalid companion memory watermark'; end if;

  select * into current_memory from public.companion_user_memory
  where user_id=p_user_id and companion_id=p_companion_id for update;
  if not found then
    if p_expected_version <> 0 then return false; end if;
    insert into public.companion_user_memory(
      user_id,companion_id,summary,facts,source_watermark,expires_at,reset_at,version
    ) values(
      p_user_id,p_companion_id,p_summary,p_facts,p_source_watermark,p_expires_at,p_memory_boundary,1
    );
    return true;
  end if;
  if current_memory.version <> p_expected_version then return false; end if;

  next_boundary := case
    when current_memory.reset_at is null then p_memory_boundary
    when p_memory_boundary is null then current_memory.reset_at
    else greatest(current_memory.reset_at,p_memory_boundary)
  end;
  update public.companion_user_memory set
    summary=p_summary,facts=p_facts,source_watermark=p_source_watermark,
    expires_at=p_expires_at,reset_at=next_boundary,version=current_memory.version+1
  where user_id=p_user_id and companion_id=p_companion_id;
  return true;
end $$;

create or replace function public.set_human_repost(p_post_id uuid, p_reposted boolean)
returns public.social_reposts language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); result public.social_reposts;
begin
  if uid is null then raise exception 'authentication required' using errcode='42501'; end if;
  if not exists(
    select 1 from public.social_posts p where p.id=p_post_id and p.content_status='active'
      and p.visibility='public'
      and not exists(select 1 from public.blocked_users b where (b.blocker_id=uid and b.blocked_id=p.author_id) or (b.blocked_id=uid and b.blocker_id=p.author_id))
      and not exists(select 1 from public.muted_companions m where m.user_id=uid and m.companion_id=p.companion_id)
  ) then raise exception 'post not found' using errcode='P0002'; end if;
  if p_reposted then
    insert into public.social_reposts(post_id,actor_id) values(p_post_id,uid)
    on conflict(post_id,actor_id) where actor_id is not null do update set post_id=excluded.post_id
    returning * into result;
  else
    delete from public.social_reposts where post_id=p_post_id and actor_id=uid returning * into result;
  end if;
  return result;
end $$;

create or replace function public.reconcile_persona_engagements(p_date date default current_date)
returns integer language plpgsql security definer set search_path = '' as $$
declare persona record; target record; slot integer; inserted_before bigint; inserted_after bigint; other_count integer; revived_count integer := 0;
begin
  perform public.schedule_companion_posts(p_date);
  update public.companion_user_memory set
    summary='',facts='{}'::jsonb,source_watermark=null,
    reset_at=case
      when reset_at is null then expires_at
      else greatest(reset_at,expires_at)
    end,
    expires_at=null,version=version+1
  where expires_at is not null and expires_at <= now();

  -- Terminal infrastructure/provider failures are retried on the next
  -- reconciliation while the target is still eligible. Safety cancellations
  -- remain cancelled because their current target fails these predicates.
  update public.ai_jobs job set status='pending',attempts=0,available_at=now(),
    lease_token=null,lease_expires_at=null,last_error=null,completed_at=null
  from public.social_ai_engagements engagement
  join public.social_posts post on post.id=engagement.post_id and post.content_status='active'
  join public.social_companions companion on companion.id=engagement.companion_id and companion.active
  left join public.social_replies reply on reply.id=engagement.target_reply_id
  where job.dedupe_key='social-action:'||engagement.dedupe_key and job.status='cancelled'
    and engagement.source in ('human_post_guarantee','human_reply_response','daily_quota')
    and (engagement.target_reply_id is null or (reply.content_status='active' and reply.post_id=post.id))
    and not exists(select 1 from public.content_reports report where report.post_id=post.id or report.reply_id=engagement.target_reply_id)
    and not exists(select 1 from public.muted_companions muted
      where muted.user_id=coalesce(reply.author_id,post.author_id) and muted.companion_id=engagement.companion_id)
    and coalesce((select preferences.companion_activity from public.notification_preferences preferences
      where preferences.user_id=coalesce(reply.author_id,post.author_id)),true);
  get diagnostics revived_count=row_count;

  select count(*) into inserted_before from public.social_ai_engagements;
  for persona in select id from public.social_companions where active order by id loop
    select count(distinct p.companion_id) into other_count
    from public.social_posts p
    where p.companion_id<>persona.id and p.companion_id is not null
      and p.content_status='active' and p.visibility='public'
      and p.created_at>=p_date::timestamptz and p.created_at<(p_date+1)::timestamptz;
    if other_count = 0 then continue; end if;
    for slot in 1..3 loop
      select candidate.post_id, candidate.companion_id into target
      from (
        select distinct on (p.companion_id) p.id post_id, p.companion_id
        from public.social_posts p
        where p.companion_id<>persona.id and p.companion_id is not null
          and p.content_status='active' and p.visibility='public'
          and p.created_at>=p_date::timestamptz and p.created_at<(p_date+1)::timestamptz
        order by p.companion_id, p.created_at, p.id
      ) candidate
      order by candidate.companion_id
      offset ((slot-1) % other_count) limit 1;
      if target.post_id is not null then
        perform public.enqueue_social_action(
          'daily:'||p_date||':reply:'||persona.id||':'||slot, 'daily_quota', 'reply',
          target.post_id, persona.id, null, p_date::timestamptz + make_interval(hours=>10+slot*2)
        );
        if slot=1 then
          perform public.enqueue_social_action(
            'daily:'||p_date||':like:'||persona.id, 'daily_quota', 'reaction',
            target.post_id, persona.id, null, p_date::timestamptz + interval '17 hours'
          );
          perform public.enqueue_social_action(
            'daily:'||p_date||':repost:'||persona.id, 'daily_quota', 'repost',
            target.post_id, persona.id, null, p_date::timestamptz + interval '19 hours'
          );
        end if;
      end if;
    end loop;
  end loop;
  select count(*) into inserted_after from public.social_ai_engagements;
  return (inserted_after-inserted_before)::integer + revived_count;
end $$;

create or replace function public.finalize_social_action(
  p_job_id uuid, p_lease_token uuid, p_content text default null
) returns boolean language plpgsql security definer set search_path = '' as $$
declare job public.ai_jobs; action public.social_ai_engagements; target_user uuid; created_id uuid;
  invalid_reason text;
begin
  select * into job from public.ai_jobs where id=p_job_id and job_type='perform_social_action' for update;
  if not found then return false; end if;
  select * into action from public.social_ai_engagements
    where id=coalesce((job.payload->>'engagementId')::uuid,(job.payload->>'actionId')::uuid) for update;
  if job.status='completed' and action.state='completed' then return true; end if;
  if job.status<>'processing' or job.lease_token is distinct from p_lease_token or job.lease_expires_at<=now() then return false; end if;

  if not exists(select 1 from public.social_companions c where c.id=action.companion_id and c.active) then invalid_reason := 'companion inactive';
  elsif not exists(select 1 from public.social_posts p where p.id=action.post_id and p.content_status='active') then invalid_reason := 'post unavailable';
  elsif action.target_reply_id is not null and not exists(select 1 from public.social_replies r where r.id=action.target_reply_id and r.post_id=action.post_id and r.content_status='active') then invalid_reason := 'reply unavailable';
  elsif exists(select 1 from public.content_reports r where r.post_id=action.post_id or r.reply_id=action.target_reply_id) then invalid_reason := 'target reported';
  end if;

  if action.target_reply_id is not null then
    select r.author_id into target_user from public.social_replies r where r.id=action.target_reply_id;
  else
    select p.author_id into target_user from public.social_posts p where p.id=action.post_id;
  end if;
  if invalid_reason is null and target_user is not null and (
    exists(select 1 from public.muted_companions m where m.user_id=target_user and m.companion_id=action.companion_id)
    or not coalesce((select n.companion_activity from public.notification_preferences n where n.user_id=target_user),true)
  ) then invalid_reason := 'target opted out'; end if;

  if invalid_reason is not null then
    update public.social_ai_engagements set state='cancelled',failure_reason=invalid_reason where id=action.id;
    update public.ai_jobs set status='cancelled',completed_at=now(),last_error=invalid_reason,lease_token=null,lease_expires_at=null where id=job.id;
    return true;
  end if;

  if action.kind='reply' then
    if char_length(trim(coalesce(p_content,''))) not between 1 and 500 then raise exception 'invalid generated reply'; end if;
    if action.reply_id is null then
      insert into public.social_replies(post_id,parent_reply_id,companion_id,content,is_ai_generated)
      values(action.post_id,action.target_reply_id,action.companion_id,trim(p_content),true)
      returning id into created_id;
      update public.social_ai_engagements set reply_id=created_id where id=action.id;
    end if;
  elsif action.kind='reaction' then
    select r.id into created_id from public.social_reactions r
      where r.post_id=action.post_id and r.reply_id is not distinct from action.target_reply_id and r.companion_id=action.companion_id;
    if created_id is null then
      insert into public.social_reactions(post_id,reply_id,companion_id,reaction)
      values(action.post_id,action.target_reply_id,action.companion_id,'like') returning id into created_id;
    end if;
    update public.social_ai_engagements set reaction_id=created_id where id=action.id;
  else
    select r.id into created_id from public.social_reposts r where r.post_id=action.post_id and r.companion_id=action.companion_id;
    if created_id is null then
      insert into public.social_reposts(post_id,companion_id) values(action.post_id,action.companion_id) returning id into created_id;
    end if;
    update public.social_ai_engagements set repost_id=created_id where id=action.id;
  end if;

  if action.kind='reply' and target_user is not null then
    insert into public.user_companion_relationships(
      user_id,companion_id,companion_follow_state,companion_follow_requested_at,companion_followed_at
    ) select target_user,action.companion_id,
      case when p.profile_visibility='public' then 'following' else 'pending' end,
      now(),case when p.profile_visibility='public' then now() end
    from public.user_profiles p where p.id=target_user
    on conflict(user_id,companion_id) do update set
      companion_follow_state=case
        when public.user_companion_relationships.companion_follow_state='following' then 'following'
        when excluded.companion_follow_state='following' then 'following'
        else 'pending'
      end,
      companion_follow_requested_at=coalesce(public.user_companion_relationships.companion_follow_requested_at,excluded.companion_follow_requested_at),
      companion_followed_at=case
        when public.user_companion_relationships.companion_follow_state='following'
          then public.user_companion_relationships.companion_followed_at
        when excluded.companion_follow_state='following'
          then coalesce(public.user_companion_relationships.companion_followed_at,excluded.companion_followed_at)
      end;

    if exists(select 1 from public.user_profiles p where p.id=target_user and p.profile_visibility='private') then
      insert into public.notifications(user_id,companion_id,post_id,kind)
      values(target_user,action.companion_id,action.post_id,'follow')
      on conflict(user_id,companion_id,kind) where kind='follow' do nothing;
    end if;
  end if;

  update public.social_ai_engagements set state='completed',failure_reason=null where id=action.id;
  update public.ai_jobs set status='completed',completed_at=now(),lease_token=null,lease_expires_at=null where id=job.id;
  return true;
end $$;

alter table public.user_companion_relationships enable row level security;
alter table public.social_reposts enable row level security;
alter table public.companion_user_memory enable row level security;

create policy relationships_owner_read on public.user_companion_relationships
  for select to authenticated using(user_id=auth.uid());
create policy reposts_read on public.social_reposts for select to authenticated using(
  not exists(select 1 from public.blocked_users b where (b.blocker_id=auth.uid() and b.blocked_id=social_reposts.actor_id) or (b.blocked_id=auth.uid() and b.blocker_id=social_reposts.actor_id))
  and not exists(select 1 from public.muted_companions m where m.user_id=auth.uid() and m.companion_id=social_reposts.companion_id)
  and exists(select 1 from public.social_posts p where p.id=post_id and p.content_status='active' and p.visibility='public')
);
create policy memory_owner_read on public.companion_user_memory
  for select to authenticated using(user_id=auth.uid());

revoke all on public.user_companion_relationships, public.social_reposts, public.companion_user_memory from anon, authenticated;
grant select on public.user_companion_relationships, public.social_reposts, public.companion_user_memory to authenticated;
grant all on public.user_companion_relationships, public.social_reposts, public.companion_user_memory to service_role;

revoke all on function public.enqueue_social_action(text,text,text,uuid,uuid,uuid,timestamptz),
  public.sync_social_action_job_state(), public.enqueue_human_post_engagements(), public.enqueue_human_reply_engagements(),
  public.start_companion_dm(uuid,uuid,text),
  public.set_user_companion_follow(uuid,boolean), public.respond_companion_follow(uuid,boolean),
  public.set_companion_dm_opt_in(uuid,boolean), public.reset_companion_memory(uuid),
  public.refresh_companion_memory(uuid,uuid,text,jsonb,uuid,timestamptz,integer,timestamptz),
  public.set_human_repost(uuid,boolean), public.reconcile_persona_engagements(date),
  public.finalize_social_action(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.set_user_companion_follow(uuid,boolean), public.respond_companion_follow(uuid,boolean),
  public.set_companion_dm_opt_in(uuid,boolean), public.reset_companion_memory(uuid),
  public.set_human_repost(uuid,boolean) to authenticated;
grant execute on function public.enqueue_social_action(text,text,text,uuid,uuid,uuid,timestamptz),
  public.start_companion_dm(uuid,uuid,text), public.reconcile_persona_engagements(date),
  public.finalize_social_action(uuid,uuid,text),
  public.refresh_companion_memory(uuid,uuid,text,jsonb,uuid,timestamptz,integer,timestamptz) to service_role;

comment on table public.social_ai_engagements is 'Internal planned/action/result ledger for AI-labeled social engagement.';
comment on function public.finalize_social_action(uuid,uuid,text) is 'Lease-checked, idempotent finalizer for persona replies, likes, and reposts.';
