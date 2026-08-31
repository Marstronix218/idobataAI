-- Post visibility is a human-audience control. Service-owned AI personas may
-- notice private completions and leave interactions that remain owner-only under
-- the existing post/reply/reaction RLS policies. Outward quote reposts continue
-- to require a public source at planning and finalization.

create or replace function public.social_action_priority(p_source text)
returns smallint language sql immutable set search_path = '' as $$
  select case p_source
    when 'human_post_guarantee' then 10::smallint
    when 'human_post_engagement' then 10::smallint
    when 'human_reply_response' then 10::smallint
    when 'ambient' then 20::smallint
    else 100::smallint
  end;
$$;

-- The decision-aware overload introduced by selective engagement accidentally
-- stopped writing the priority column. Restore it so human-facing work cannot
-- sit behind the ambient daily queue.
create or replace function public.enqueue_social_action(
  p_dedupe_key text,
  p_source text,
  p_kind text,
  p_post_id uuid,
  p_companion_id uuid,
  p_target_reply_id uuid default null,
  p_scheduled_for timestamptz default now(),
  p_decision jsonb default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare action_id uuid;
begin
  insert into public.social_ai_engagements(
    post_id, companion_id, kind, dedupe_key, source, state,
    scheduled_for, target_reply_id, decision
  ) values (
    p_post_id, p_companion_id, p_kind, p_dedupe_key, p_source, 'planned',
    p_scheduled_for, p_target_reply_id, p_decision
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

create or replace function public.enqueue_human_post_engagements()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.author_id is null or new.companion_id is not null or new.is_ai_generated then return new; end if;
  if new.kind <> 'human_completion' or new.content_status <> 'active' then return new; end if;
  if not coalesce((select p.companion_activity from public.notification_preferences p where p.user_id=new.author_id), true) then return new; end if;

  insert into public.ai_jobs(job_type, dedupe_key, payload, available_at, priority)
  values(
    'plan_post_engagement', 'plan-engagement:'||new.id,
    jsonb_build_object('postId', new.id),
    now(), 10
  ) on conflict(dedupe_key) do nothing;
  return new;
end $$;

-- Pick up recent completions that were skipped solely because their human
-- audience was private, including posts made shortly before this migration.
insert into public.ai_jobs(job_type, dedupe_key, payload, available_at, priority)
select
  'plan_post_engagement', 'plan-engagement:'||post.id,
  jsonb_build_object('postId', post.id),
  now(), 10
from public.social_posts post
where post.author_id is not null
  and post.companion_id is null
  and not post.is_ai_generated
  and post.kind='human_completion'
  and post.content_status='active'
  and post.created_at >= now()-interval '7 days'
  and coalesce((select preferences.companion_activity
    from public.notification_preferences preferences
    where preferences.user_id=post.author_id),true)
on conflict(dedupe_key) do nothing;

update public.ai_jobs job
set priority=public.social_action_priority(engagement.source)
from public.social_ai_engagements engagement
where job.dedupe_key='social-action:'||engagement.dedupe_key
  and job.status in ('pending','failed')
  and job.priority is distinct from public.social_action_priority(engagement.source);

revoke all on function
  public.enqueue_social_action(text,text,text,uuid,uuid,uuid,timestamptz,jsonb),
  public.enqueue_human_post_engagements()
  from public, anon, authenticated;

grant execute on function
  public.enqueue_social_action(text,text,text,uuid,uuid,uuid,timestamptz,jsonb)
  to service_role;

comment on function public.enqueue_human_post_engagements() is
  'Queues selective persona planning for active human completion posts regardless of human audience.';

notify pgrst, 'reload schema';
