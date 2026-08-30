-- Completed-task posts used to draw exactly one persona, chosen by hashing the
-- post id: the same character was as likely to answer a 5 km run as a stack
-- trace, and nobody else in the cast ever noticed anything. This makes the one
-- guaranteed responder relevant to the task and lets a small, capped set of
-- other personas engage selectively on top of it.

-- A persona quote repost is a post the persona authored, referencing the human
-- original, so it renders exactly like the human quote reposts already do.
alter table public.social_posts
  drop constraint if exists social_posts_quote_shape,
  add constraint social_posts_quote_shape check (
    (
      kind = 'human_quote'
      and author_id is not null
      and companion_id is null
      and task_id is null
    )
    or (
      kind = 'ai_quote'
      and companion_id is not null
      and author_id is null
      and task_id is null
      and quoted_post_id is not null
    )
    or (
      kind not in ('human_quote','ai_quote')
      and quoted_post_id is null
    )
  );

alter table public.social_ai_engagements
  add column if not exists quote_post_id uuid references public.social_posts(id) on delete set null;

alter table public.social_ai_engagements
  drop constraint if exists social_ai_engagements_kind_check,
  add constraint social_ai_engagements_kind_check check (kind in ('reply','reaction','repost','quote')),
  drop constraint if exists social_ai_engagements_source_check,
  add constraint social_ai_engagements_source_check check (
    source in ('human_post_guarantee','human_post_engagement','human_reply_response','daily_quota','ambient')
  );

-- Debug metadata for the selection engine. It explains why a persona engaged
-- and is never exposed through any user-facing route.
alter table public.social_ai_engagements
  add column if not exists decision jsonb;
comment on column public.social_ai_engagements.decision is
  'Internal selection metadata (affinity, probability, roll, prompt version). Never rendered to users.';

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
  check (job_type in ('enhance_reply','schedule_companion_posts','perform_social_action','plan_post_engagement'));

-- The taxonomy mirrors src/lib/domain/task-affinity.ts. This copy exists because
-- the guaranteed responder is chosen inside the insert trigger, before any
-- worker runs; the fuller keyword table lives in TypeScript and is applied to
-- the selective candidates.
create or replace function public.classify_task_category(
  p_title text, p_category text, p_content text
) returns text language sql immutable set search_path = '' as $$
  with source as (select lower(left(coalesce(p_category,'') || ' | ' || coalesce(p_title,'') || ' | ' || coalesce(p_content,''), 600)) as value)
  select case
    when value ~ '(cod(e|ed|ing)|program|debug|refactor|deploy|commit|bug ?fix|\mbugs?\M|api\M|typescript|javascript|python|sql\M|database|migration|frontend|backend|authentication|\mauth\M|repo)' then 'coding'
    when value ~ '(\mgam(e|es|ing)\M|ranked|raid|\mboss\M|speedrun|matchmaking|esports?|console|playthrough)' then 'gaming'
    when value ~ '(stud(y|ied|ying)|homework|assignment|essay|thesis|revis(e|ed|ing|ion)|exam|midterm|quiz|lecture|problem set|flashcard|econometric|calculus|chemistry|physics|coursework|semester)' then 'study'
    when value ~ '(\mrun\M|\mran\M|running|[0-9]+ ?k(m| )|jog|\mgym\M|workout|worked out|lift(ed|ing)?|squat|deadlift|yoga|pilates|swim|cycl(e|ed|ing)|cardio|stretch|hike|hiking|push[- ]?up)' then 'exercise'
    when value ~ '(clean(ed|ing)?|tid(y|ied)|declutter|vacuum|laundry|dish(es)?|mop|scrub|trash|garbage|dust(ed|ing)?|chore)' then 'cleaning'
    when value ~ '(cook(ed|ing)?|bak(e|ed|ing)|meal ?prep|recipe|dinner|breakfast|lunch|grocer|kitchen|bread|pasta)' then 'cooking'
    when value ~ '(draw|drew|drawing|paint|sketch|illustrat|design(ed|ing)?|piano|guitar|violin|vocal|rehears|choreograph|danc(e|ed|ing)|compos(e|ed|ing)|knit|\msew|photograph|portfolio|mockup)' then 'creative'
    when value ~ '(\mread\M|reading|\mbook\M|novel|chapter|manga|article|audiobook|\mpages?\M)' then 'reading'
    when value ~ '(tax(es)?|paperwork|invoice|\mbills?\M|insurance|appointment|renew|passport|visa|bank|budget|inbox|\memails?\M|filed|dmv|registration|receipt)' then 'admin'
    when value ~ '(\mwork(ed)?\M|\mshift\M|meeting|standup|client|slides?|presentation|\mreport\M|deadline|proposal|interview|resume|sprint|spreadsheet|shipped)' then 'work'
    when value ~ '(\mcall(ed)?\M|friend|famil(y|ies)|\mparty\M|meet ?up|catch up|caught up|birthday|visit(ed)?|hang(ing)? out)' then 'social'
    when value ~ '(sleep|slept|\mnap|rest(ed|ing)?|meditat|journal|therap(y|ist)|skincare|shower|\mbath\M|hydrat|breath|self[- ]?care|mental health|dentist|doctor)' then 'self-care'
    when value ~ '(\mtrip\M|travel|flight|\mflew\M|airport|pack(ed|ing)?|commut|hotel|itinerary|\mdrove\M|road trip|explor)' then 'travel'
    else 'other'
  end
  from source;
$$;

comment on function public.classify_task_category(text,text,text) is
  'Maps a completion post to the shared task taxonomy used by persona category affinity.';

-- Everything the selective planner needs, in one round trip: the post, the
-- feature flags, and every eligible persona with its engagement profile and the
-- recent-activity counters that suppress repetitive attention.
create or replace function public.get_post_engagement_context(p_post_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare post public.social_posts; result jsonb;
begin
  select * into post from public.social_posts where id = p_post_id;
  if not found or post.author_id is null or post.companion_id is not null then return null; end if;

  select jsonb_build_object(
    'post', jsonb_build_object(
      'id', post.id,
      'authorId', post.author_id,
      'kind', post.kind,
      'visibility', post.visibility,
      'contentStatus', post.content_status,
      'content', post.content,
      'taskTitle', post.task_title,
      'category', post.category,
      'streak', post.streak,
      'xpEarned', post.xp_earned,
      -- The planned focus time is a real signal of how demanding the task was,
      -- and it lives on the task rather than the post.
      'focusMinutes', (select task.focus_minutes from public.tasks task where task.id = post.task_id),
      'createdAt', post.created_at
    ),
    'flags', jsonb_build_object(
      'likes', public.feature_flag_enabled('AI_PERSONA_LIKES'),
      'replies', public.feature_flag_enabled('AI_PERSONA_REPLIES'),
      'quotes', public.feature_flag_enabled('AI_PERSONA_QUOTE_REPOSTS')
    ),
    'siblingReplies', coalesce((
      select jsonb_agg(reply.content order by reply.created_at)
      from public.social_replies reply
      where reply.post_id = post.id and reply.companion_id is not null and reply.content_status = 'active'
    ), '[]'::jsonb),
    'companions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', companion.id,
        'slug', companion.slug,
        'active', companion.active,
        'socialActivity', companion.social_activity,
        'likeAffinity', companion.like_affinity,
        'replyAffinity', companion.reply_affinity,
        'quoteAffinity', companion.quote_affinity,
        'categoryAffinity', companion.category_affinity,
        'engagedThisPost', exists(
          select 1 from public.social_ai_engagements engagement
          where engagement.post_id = post.id
            and engagement.companion_id = companion.id
            and engagement.state <> 'cancelled'
        ),
        'repliesToAuthorRecently', (
          select count(*) from public.social_ai_engagements engagement
          join public.social_posts authored on authored.id = engagement.post_id
          where engagement.companion_id = companion.id
            and engagement.kind = 'reply'
            and engagement.state <> 'cancelled'
            and authored.author_id = post.author_id
            and engagement.created_at > now() - interval '24 hours'
        ),
        'quotesRecently', (
          select count(*) from public.social_ai_engagements engagement
          where engagement.companion_id = companion.id
            and engagement.kind = 'quote'
            and engagement.state <> 'cancelled'
            and engagement.created_at > now() - interval '24 hours'
        )
      ))
      from public.social_companions companion
      where companion.active
        and not exists(
          select 1 from public.muted_companions muted
          where muted.user_id = post.author_id and muted.companion_id = companion.id
        )
    ), '[]'::jsonb)
  ) into result;
  return result;
end $$;

revoke all on function public.get_post_engagement_context(uuid) from public, anon, authenticated;

-- The persona a human post is guaranteed to hear from is now the persona whose
-- interests actually match the completed task, with a stable jitter so one
-- character does not permanently own a category.
create or replace function public.enqueue_human_post_engagements() returns trigger
language plpgsql security definer set search_path = '' as $$
declare selected_companion uuid; task_category text;
begin
  if new.author_id is null or new.companion_id is not null or new.is_ai_generated then return new; end if;
  if not coalesce((select p.companion_activity from public.notification_preferences p where p.user_id=new.author_id), true) then return new; end if;

  task_category := public.classify_task_category(new.task_title, new.category, new.content);

  select c.id into selected_companion
  from public.social_companions c
  where c.active
    and not exists(select 1 from public.muted_companions m where m.user_id=new.author_id and m.companion_id=c.id)
  order by (
    coalesce(
      (c.category_affinity ->> task_category)::numeric,
      (c.category_affinity ->> 'other')::numeric,
      0.3
    ) * 0.60
    + case c.social_activity when 'high' then 1.0 when 'selective' then 0.38 else 0.68 end * 0.26
    + (((hashtextextended(new.id::text || ':' || c.id::text, 0) % 1000 + 1000) % 1000)::numeric / 1000) * 0.14
  ) desc, c.id
  limit 1;
  if selected_companion is null then return new; end if;

  if public.feature_flag_enabled('AI_PERSONA_REPLIES') then
    perform public.enqueue_social_action('human-post:reply:'||new.id, 'human_post_guarantee',
      'reply', new.id, selected_companion, null, now());
  end if;
  if public.feature_flag_enabled('AI_PERSONA_LIKES') then
    perform public.enqueue_social_action('human-post:like:'||new.id, 'ambient',
      'reaction', new.id, selected_companion, null, now()+interval '1 minute');
  end if;

  -- Only a completed task earns the wider cast's attention. Progress posts keep
  -- the single guaranteed responder they have always had.
  if new.kind = 'human_completion' and new.content_status = 'active' then
    insert into public.ai_jobs(job_type, dedupe_key, payload, available_at)
    values(
      'plan_post_engagement', 'plan-engagement:'||new.id,
      jsonb_build_object('postId', new.id, 'excludeCompanionId', selected_companion),
      now() + interval '20 seconds'
    ) on conflict(dedupe_key) do nothing;
  end if;
  return new;
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
  -- A quote repost republishes the original into a persona feed, so a post the
  -- author has since made private must not be carried outward.
  elsif action.kind='quote' and not exists(select 1 from public.social_posts p where p.id=action.post_id and p.visibility='public') then invalid_reason := 'quote target not public';
  elsif action.kind='reply' and not public.feature_flag_enabled('AI_PERSONA_REPLIES') then invalid_reason := 'replies disabled';
  elsif action.kind='reaction' and not public.feature_flag_enabled('AI_PERSONA_LIKES') then invalid_reason := 'likes disabled';
  elsif action.kind='quote' and not public.feature_flag_enabled('AI_PERSONA_QUOTE_REPOSTS') then invalid_reason := 'quote reposts disabled';
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
  elsif action.kind='quote' then
    if char_length(trim(coalesce(p_content,''))) not between 1 and 500 then raise exception 'invalid generated quote'; end if;
    -- `source_key` carries the idempotency, so a retried lease republishes
    -- nothing even if the engagement row lost its pointer.
    select p.id into created_id from public.social_posts p
      where p.companion_id=action.companion_id and p.source_key='quote:'||action.id::text;
    if created_id is null then
      insert into public.social_posts(companion_id,kind,visibility,content,quoted_post_id,source_key,is_ai_generated)
      values(action.companion_id,'ai_quote','public',trim(p_content),action.post_id,'quote:'||action.id::text,true)
      returning id into created_id;
    end if;
    update public.social_ai_engagements set quote_post_id=created_id where id=action.id;
  else
    select r.id into created_id from public.social_reposts r where r.post_id=action.post_id and r.companion_id=action.companion_id;
    if created_id is null then
      insert into public.social_reposts(post_id,companion_id) values(action.post_id,action.companion_id) returning id into created_id;
    end if;
    update public.social_ai_engagements set repost_id=created_id where id=action.id;
  end if;

  if action.kind in ('reply','quote') and target_user is not null then
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

-- The reconciler revives terminal infrastructure failures. Selective engagement
-- shares that path so a provider outage does not silently drop it.
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

  update public.ai_jobs job set status='pending',attempts=0,available_at=now(),
    lease_token=null,lease_expires_at=null,last_error=null,completed_at=null
  from public.social_ai_engagements engagement
  join public.social_posts post on post.id=engagement.post_id and post.content_status='active'
  join public.social_companions companion on companion.id=engagement.companion_id and companion.active
  left join public.social_replies reply on reply.id=engagement.target_reply_id
  where job.dedupe_key='social-action:'||engagement.dedupe_key and job.status='cancelled'
    and engagement.source in ('human_post_guarantee','human_post_engagement','human_reply_response','daily_quota')
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

create index if not exists social_ai_engagements_companion_kind_recent_idx
  on public.social_ai_engagements(companion_id, kind, created_at desc);

notify pgrst, 'reload schema';

-- The planner records why it chose an action. A default argument cannot be
-- appended to an existing signature without creating an ambiguous overload, so
-- the seven-argument form is replaced outright.
drop function if exists public.enqueue_social_action(text,text,text,uuid,uuid,uuid,timestamptz);

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

  insert into public.ai_jobs(job_type, dedupe_key, payload, available_at)
  values(
    'perform_social_action', 'social-action:' || p_dedupe_key,
    jsonb_build_object('actionId',action_id,'engagementId',action_id,'postId',p_post_id,
      'companionId',p_companion_id,'kind',p_kind,'targetReplyId',p_target_reply_id),
    p_scheduled_for
  ) on conflict(dedupe_key) do nothing;
  return action_id;
end $$;

revoke all on function
  public.enqueue_social_action(text,text,text,uuid,uuid,uuid,timestamptz,jsonb),
  public.get_post_engagement_context(uuid),
  public.classify_task_category(text,text,text),
  public.feature_flag_enabled(text),
  public.enqueue_human_post_engagements(),
  public.finalize_social_action(uuid,uuid,text),
  public.reconcile_persona_engagements(date)
  from public, anon, authenticated;

grant execute on function
  public.enqueue_social_action(text,text,text,uuid,uuid,uuid,timestamptz,jsonb),
  public.get_post_engagement_context(uuid),
  public.classify_task_category(text,text,text),
  public.feature_flag_enabled(text),
  public.finalize_social_action(uuid,uuid,text),
  public.reconcile_persona_engagements(date)
  to service_role;

grant all on public.app_feature_flags to service_role;

comment on function public.finalize_social_action(uuid,uuid,text) is
  'Lease-checked, idempotent finalizer for persona replies, likes, reposts, and quote reposts.';

notify pgrst, 'reload schema';

-- Regenerating a near-duplicate twice and still landing on the same words means
-- the persona has nothing new to add. Dropping that action is better than
-- publishing an echo, and better than a retry loop that spends provider calls
-- reproducing the rejected text.
create or replace function public.cancel_social_action(
  p_job_id uuid, p_lease_token uuid, p_reason text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare job public.ai_jobs; action_id uuid;
begin
  select * into job from public.ai_jobs where id=p_job_id and job_type='perform_social_action' for update;
  if not found then return false; end if;
  if job.status<>'processing' or job.lease_token is distinct from p_lease_token or job.lease_expires_at<=now() then return false; end if;
  action_id := coalesce((job.payload->>'engagementId')::uuid,(job.payload->>'actionId')::uuid);
  update public.social_ai_engagements
    set state='cancelled', failure_reason=left(coalesce(p_reason,'cancelled'),1000)
    where id=action_id;
  update public.ai_jobs set status='cancelled',completed_at=now(),
    last_error=left(coalesce(p_reason,'cancelled'),1000),lease_token=null,lease_expires_at=null
    where id=job.id;
  return true;
end $$;

revoke all on function public.cancel_social_action(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.cancel_social_action(uuid,uuid,text) to service_role;

notify pgrst, 'reload schema';
