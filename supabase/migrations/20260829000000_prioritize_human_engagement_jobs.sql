-- Persona replies to human posts were queued correctly but never reached in
-- time. The queue is strict FIFO by `available_at`, the worker drains at most
-- 25 jobs, and the nightly reconciler plans hundreds of ambient persona-to-
-- persona actions per day, so a reply owed to a real person sat behind a
-- backlog that grew faster than it drained. Three changes fix that:
--   1. jobs carry a priority, and human-facing work is claimed first;
--   2. the per-drain cap rises so one run can actually clear a day of work;
--   3. ambient `daily_quota` work expires instead of accumulating forever.

alter table public.ai_jobs add column if not exists priority smallint not null default 100;

-- Lower sorts first. Human-facing work is claimed ahead of ambient filler no
-- matter how far behind the filler has fallen.
create or replace function public.social_action_priority(p_source text)
returns smallint language sql immutable set search_path = '' as $$
  select case p_source
    when 'human_post_guarantee' then 10::smallint
    when 'human_reply_response' then 10::smallint
    when 'ambient' then 20::smallint
    else 100::smallint
  end;
$$;

create index if not exists ai_jobs_priority_claim_idx
  on public.ai_jobs(priority, available_at, created_at)
  where status in ('pending', 'failed', 'processing');

update public.ai_jobs job
  set priority = public.social_action_priority(engagement.source)
  from public.social_ai_engagements engagement
  where job.dedupe_key = 'social-action:' || engagement.dedupe_key
    and job.priority is distinct from public.social_action_priority(engagement.source);

-- A legacy enhancement job is already visible to a human as fallback text.
update public.ai_jobs set priority = 10 where job_type = 'enhance_reply' and priority <> 10;

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

  insert into public.ai_jobs(job_type, dedupe_key, payload, available_at, priority)
  values(
    'perform_social_action', 'social-action:' || p_dedupe_key,
    jsonb_build_object('actionId',action_id,'engagementId',action_id,'postId',p_post_id,
      'companionId',p_companion_id,'kind',p_kind,'targetReplyId',p_target_reply_id),
    p_scheduled_for, public.social_action_priority(p_source)
  ) on conflict(dedupe_key) do nothing;
  return action_id;
end $$;

-- Claim by priority first, then by schedule. The cap rises from 25 to 200 so a
-- single scheduled drain can clear a full day of planned engagement.
create or replace function public.claim_ai_jobs(p_limit integer default 5, p_lease_seconds integer default 120)
returns setof public.ai_jobs language plpgsql security definer set search_path = '' as $$
begin
  return query with candidates as (
    select id from public.ai_jobs where attempts < max_attempts and available_at <= now()
      and (status in ('pending','failed') or (status='processing' and lease_expires_at <= now()))
    order by priority, available_at, created_at for update skip locked limit greatest(1,least(p_limit,200))
  ) update public.ai_jobs j set status='processing',attempts=j.attempts+1,lease_token=gen_random_uuid(),lease_expires_at=now()+make_interval(secs=>greatest(30,least(p_lease_seconds,600))),last_error=null
  from candidates where j.id=candidates.id returning j.*;
end $$;

-- Ambient persona-to-persona activity is only interesting on the day it was
-- planned for. Retiring stale entries keeps the queue bounded, so the backlog
-- can never again outrun the drain rate.
create or replace function public.expire_stale_ambient_engagements(p_max_age interval default interval '1 day')
returns integer language plpgsql security definer set search_path = '' as $$
declare expired_count integer;
begin
  update public.ai_jobs job set
    status='cancelled', completed_at=now(), last_error='ambient backlog expired',
    lease_token=null, lease_expires_at=null
  from public.social_ai_engagements engagement
  where job.dedupe_key = 'social-action:' || engagement.dedupe_key
    and job.status in ('pending','failed')
    and engagement.source = 'daily_quota'
    and engagement.scheduled_for < now() - p_max_age;
  get diagnostics expired_count = row_count;

  -- The ai_jobs status trigger mirrors each cancellation onto its engagement.
  -- This second pass catches engagement rows whose job row was already gone.
  update public.social_ai_engagements set state='cancelled', failure_reason='ambient backlog expired'
  where source='daily_quota' and state in ('planned','failed') and scheduled_for < now() - p_max_age;

  return expired_count;
end $$;

revoke all on function public.expire_stale_ambient_engagements(interval),
  public.social_action_priority(text) from public, anon, authenticated;
grant execute on function public.expire_stale_ambient_engagements(interval) to service_role;

comment on column public.ai_jobs.priority is 'Claim order, lowest first. Human-facing engagement outranks ambient persona activity.';

-- Reconciliation now retires the stale ambient backlog before planning more,
-- and refuses to revive an ambient action that has already been retired.
create or replace function public.reconcile_persona_engagements(p_date date default current_date)
returns integer language plpgsql security definer set search_path = '' as $$
declare persona record; target record; slot integer; inserted_before bigint; inserted_after bigint; other_count integer; revived_count integer := 0;
begin
  -- Retire yesterday's unplayed ambient actions before planning today's, so the
  -- queue length stays proportional to one day of activity.
  perform public.expire_stale_ambient_engagements();
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
    -- An expired ambient action stays expired; only fresh filler is revived.
    and (engagement.source <> 'daily_quota' or engagement.scheduled_for > now() - interval '1 day')
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

-- One-time: retire the backlog that accumulated while every job ranked equally,
-- so the first drain after this migration reaches live work immediately.
select public.expire_stale_ambient_engagements();
