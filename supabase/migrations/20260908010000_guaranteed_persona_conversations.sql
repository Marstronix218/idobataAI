-- Human posts should never feel ignored, while public persona conversations
-- should not become an unbounded substitute for DMs. Guarantee one persona
-- reply plus a lightweight reaction for the first four posts a user publishes
-- in a rolling day, then answer every direct human follow-up until the branch
-- reaches six persona turns. Follow relationships are ranking hints, not gates.

insert into public.app_tuning_values(key, value, description) values
  ('AI_POST_GUARANTEED_REPLIES_PER_USER_DAY', 4,
    'Human posts per user in a rolling 24-hour window that receive one guaranteed persona reply.'),
  ('AI_THREAD_MAX_PERSONA_REPLIES', 6,
    'Maximum persona turns in one public reply branch before the UI guides the user to DMs.')
on conflict (key) do update set
  value = excluded.value,
  description = excluded.description;

create or replace function public.enqueue_human_post_engagements()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  selected_companion uuid;
  reaction_companion uuid;
  task_category text;
  guaranteed_today integer;
begin
  if new.author_id is null or new.companion_id is not null or new.is_ai_generated then return new; end if;
  if new.content_status <> 'active' then return new; end if;

  -- Serialize the cap check per author so simultaneous posts cannot both claim
  -- the fourth guaranteed slot.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.author_id::text||':post-reply-guarantee',0)
  );

  select count(*) into guaranteed_today
  from public.social_ai_engagements engagement
  join public.social_posts post on post.id=engagement.post_id
  where engagement.source='human_post_guarantee'
    and engagement.kind='reply'
    and engagement.state<>'cancelled'
    and post.author_id=new.author_id
    and engagement.created_at>=now()-interval '24 hours';

  if guaranteed_today < public.app_tuning_value('AI_POST_GUARANTEED_REPLIES_PER_USER_DAY',4)
    and public.feature_flag_enabled('AI_PERSONA_REPLIES')
  then
    task_category := public.classify_task_category(new.task_title,new.category,new.content);
    select companion.id into selected_companion
    from public.social_companions companion
    left join public.user_companion_relationships relationship
      on relationship.user_id=new.author_id and relationship.companion_id=companion.id
    where companion.active
      and not exists(select 1 from public.muted_companions muted
        where muted.user_id=new.author_id and muted.companion_id=companion.id)
    order by (
      coalesce((companion.category_affinity->>task_category)::numeric,
        (companion.category_affinity->>'other')::numeric,0.3) * 0.55
      + case companion.social_activity when 'high' then 1.0 when 'selective' then 0.38 else 0.68 end * 0.20
      + case when coalesce(relationship.is_favorite,false) then 1.0 else 0.0 end * 0.15
      + (((hashtextextended(new.id::text||':'||companion.id::text,0)%1000+1000)%1000)::numeric/1000) * 0.10
    ) desc, companion.id
    limit 1;

    if selected_companion is not null then
      perform public.enqueue_social_action(
        'human-post:reply:'||new.id,'human_post_guarantee','reply',
        new.id,selected_companion,null,now(),
        jsonb_build_object('guaranteed',true,'reply_due_at',now()+interval '1 hour')
      );

      -- A second lightweight signal keeps a new user's feed from feeling empty
      -- even when they have no persona relationship rows yet. Prefer a
      -- different character, but let the responder also react when it is the
      -- only eligible active persona.
      if public.feature_flag_enabled('AI_PERSONA_LIKES') then
        select companion.id into reaction_companion
        from public.social_companions companion
        where companion.active
          and companion.id<>selected_companion
          and not exists(select 1 from public.muted_companions muted
            where muted.user_id=new.author_id and muted.companion_id=companion.id)
        order by (((hashtextextended(new.id::text||':reaction:'||companion.id::text,0)%1000+1000)%1000)) desc,
          companion.id
        limit 1;

        reaction_companion := coalesce(reaction_companion,selected_companion);
        perform public.enqueue_social_action(
          'human-post:reaction:'||new.id,'human_post_guarantee','reaction',
          new.id,reaction_companion,null,now()+interval '1 minute',
          jsonb_build_object('guaranteed_presence',true)
        );
      end if;
    end if;
  end if;

  -- A completion can still earn additional selective attention. The guaranteed
  -- responder is excluded explicitly as well as through the engagement ledger.
  if new.kind='human_completion' then
    insert into public.ai_jobs(job_type,dedupe_key,payload,available_at,priority)
    values(
      'plan_post_engagement','plan-engagement:'||new.id,
      jsonb_strip_nulls(jsonb_build_object('postId',new.id,'excludeCompanionId',selected_companion)),
      now(),10
    ) on conflict(dedupe_key) do nothing;
  end if;
  return new;
end $$;

create or replace function public.enqueue_human_reply_engagements() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  target_companion uuid;
  thread_root uuid;
  thread_depth integer;
  prior_persona_turns integer;
  skip_reason text;
begin
  if new.author_id is null or new.companion_id is not null or new.is_ai_generated then return new; end if;
  if new.content_status <> 'active' then return new; end if;

  if new.parent_reply_id is not null then
    select reply.companion_id into target_companion
    from public.social_replies reply where reply.id=new.parent_reply_id;
  else
    select post.companion_id into target_companion
    from public.social_posts post where post.id=new.post_id;
  end if;

  if target_companion is null
    or not exists(select 1 from public.social_companions companion where companion.id=target_companion and companion.active)
    or exists(select 1 from public.muted_companions muted where muted.user_id=new.author_id and muted.companion_id=target_companion)
  then return new; end if;

  select max(path.depth),(array_agg(path.reply_id order by path.depth))[1]
    into thread_depth,thread_root
  from public.reply_thread_path(new.id) path;
  thread_depth := coalesce(thread_depth,0);

  select count(*) into prior_persona_turns
  from public.reply_thread_path(new.id) path
  join public.social_replies reply on reply.id=path.reply_id
  where reply.id<>new.id and reply.companion_id=target_companion;

  perform public.capture_beta_product_event(
    'user_replied_to_ai',new.author_id,new.id,target_companion,new.created_at,null,
    new.post_id,thread_root,thread_depth
  );
  perform public.capture_beta_product_event(
    case when prior_persona_turns>1 then 'ai_thread_conversation_continued'
         else 'ai_thread_conversation_started' end,
    new.author_id,new.id,target_companion,new.created_at,null,
    new.post_id,thread_root,thread_depth
  );

  if not public.feature_flag_enabled('AI_PERSONA_THREAD_REPLIES') then skip_reason := 'thread replies disabled';
  elsif not public.feature_flag_enabled('AI_PERSONA_REPLIES') then skip_reason := 'replies disabled';
  elsif thread_depth > public.app_tuning_value('AI_THREAD_MAX_DEPTH',40) then skip_reason := 'thread too deep';
  elsif prior_persona_turns >= public.app_tuning_value('AI_THREAD_MAX_PERSONA_REPLIES',6) then skip_reason := 'public thread reply limit reached';
  end if;

  if skip_reason is null then
    perform public.enqueue_social_action(
      'human-reply:response:'||new.id,'human_reply_response','reply',
      new.post_id,target_companion,new.id,now(),
      jsonb_build_object(
        'thread_root_reply_id',thread_root,
        'thread_depth',thread_depth,
        'prior_persona_turns',prior_persona_turns,
        'guaranteed',true,
        'reply_due_at',new.created_at+interval '1 hour'
      )
    );
  end if;

  perform public.enqueue_social_action(
    'human-reply:like:'||new.id,'ambient','reaction',
    new.post_id,target_companion,new.id,now()+interval '1 minute'
  );
  return new;
end $$;

-- A selective-engagement migration accidentally restored the older behavior
-- where a generated reply also created a follow edge. That now conflicts with
-- the explicit-consent transition guard and can roll back the promised reply.
-- Keep social-action finalization relationship-neutral: a reply is a reply,
-- never an implicit follow request.
create or replace function public.finalize_social_action(
  p_job_id uuid, p_lease_token uuid, p_content text default null
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  job public.ai_jobs;
  action public.social_ai_engagements;
  target_user uuid;
  created_id uuid;
  invalid_reason text;
begin
  select * into job from public.ai_jobs
  where id=p_job_id and job_type='perform_social_action' for update;
  if not found then return false; end if;

  select * into action from public.social_ai_engagements
  where id=coalesce((job.payload->>'engagementId')::uuid,(job.payload->>'actionId')::uuid)
  for update;
  if job.status='completed' and action.state='completed' then return true; end if;
  if job.status<>'processing' or job.lease_token is distinct from p_lease_token
    or job.lease_expires_at<=now() then return false; end if;

  if not exists(select 1 from public.social_companions companion
    where companion.id=action.companion_id and companion.active)
    then invalid_reason := 'companion inactive';
  elsif not exists(select 1 from public.social_posts post
    where post.id=action.post_id and post.content_status='active')
    then invalid_reason := 'post unavailable';
  elsif action.target_reply_id is not null and not exists(
    select 1 from public.social_replies reply
    where reply.id=action.target_reply_id and reply.post_id=action.post_id and reply.content_status='active'
  ) then invalid_reason := 'reply unavailable';
  elsif exists(select 1 from public.content_reports report
    where report.post_id=action.post_id or report.reply_id=action.target_reply_id)
    then invalid_reason := 'target reported';
  elsif action.kind='quote' and not exists(select 1 from public.social_posts post
    where post.id=action.post_id and post.visibility='public')
    then invalid_reason := 'quote target not public';
  elsif action.kind='reply' and not public.feature_flag_enabled('AI_PERSONA_REPLIES')
    then invalid_reason := 'replies disabled';
  elsif action.kind='reaction' and not public.feature_flag_enabled('AI_PERSONA_LIKES')
    then invalid_reason := 'likes disabled';
  elsif action.kind='quote' and not public.feature_flag_enabled('AI_PERSONA_QUOTE_REPOSTS')
    then invalid_reason := 'quote reposts disabled';
  end if;

  if action.target_reply_id is not null then
    select reply.author_id into target_user from public.social_replies reply
    where reply.id=action.target_reply_id;
  else
    select post.author_id into target_user from public.social_posts post
    where post.id=action.post_id;
  end if;
  if invalid_reason is null and target_user is not null and exists(
    select 1 from public.muted_companions muted
    where muted.user_id=target_user and muted.companion_id=action.companion_id
  ) then invalid_reason := 'target opted out'; end if;

  if invalid_reason is not null then
    update public.social_ai_engagements
    set state='cancelled',failure_reason=invalid_reason where id=action.id;
    update public.ai_jobs set
      status='cancelled',completed_at=now(),last_error=invalid_reason,
      lease_token=null,lease_expires_at=null
    where id=job.id;
    return true;
  end if;

  if action.kind='reply' then
    if char_length(trim(coalesce(p_content,''))) not between 1 and 500
      then raise exception 'invalid generated reply'; end if;
    if action.reply_id is null then
      insert into public.social_replies(post_id,parent_reply_id,companion_id,content,is_ai_generated)
      values(action.post_id,action.target_reply_id,action.companion_id,trim(p_content),true)
      returning id into created_id;
      update public.social_ai_engagements set reply_id=created_id where id=action.id;
    end if;
  elsif action.kind='reaction' then
    select reaction.id into created_id from public.social_reactions reaction
    where reaction.post_id=action.post_id
      and reaction.reply_id is not distinct from action.target_reply_id
      and reaction.companion_id=action.companion_id;
    if created_id is null then
      insert into public.social_reactions(post_id,reply_id,companion_id,reaction)
      values(action.post_id,action.target_reply_id,action.companion_id,'like')
      returning id into created_id;
    end if;
    update public.social_ai_engagements set reaction_id=created_id where id=action.id;
  elsif action.kind='quote' then
    if char_length(trim(coalesce(p_content,''))) not between 1 and 500
      then raise exception 'invalid generated quote'; end if;
    select post.id into created_id from public.social_posts post
    where post.companion_id=action.companion_id and post.source_key='quote:'||action.id::text;
    if created_id is null then
      insert into public.social_posts(
        companion_id,kind,visibility,content,quoted_post_id,source_key,is_ai_generated
      ) values(
        action.companion_id,'ai_quote','public',trim(p_content),action.post_id,
        'quote:'||action.id::text,true
      ) returning id into created_id;
    end if;
    update public.social_ai_engagements set quote_post_id=created_id where id=action.id;
  else
    select repost.id into created_id from public.social_reposts repost
    where repost.post_id=action.post_id and repost.companion_id=action.companion_id;
    if created_id is null then
      insert into public.social_reposts(post_id,companion_id)
      values(action.post_id,action.companion_id) returning id into created_id;
    end if;
    update public.social_ai_engagements set repost_id=created_id where id=action.id;
  end if;

  update public.social_ai_engagements
  set state='completed',failure_reason=null where id=action.id;
  update public.ai_jobs set
    status='completed',completed_at=now(),lease_token=null,lease_expires_at=null
  where id=job.id;
  return true;
end $$;

revoke all on function
  public.enqueue_human_post_engagements(),
  public.enqueue_human_reply_engagements(),
  public.finalize_social_action(uuid,uuid,text)
  from public, anon, authenticated;

grant execute on function public.finalize_social_action(uuid,uuid,text) to service_role;

comment on function public.enqueue_human_post_engagements() is
  'Guarantees a persona reply and lightweight reaction for up to four active human posts per rolling day without requiring a follow relationship.';
comment on function public.enqueue_human_reply_engagements() is
  'Guarantees the addressed persona follows up immediately until six persona turns, after which the UI guides the user to DMs.';
comment on function public.finalize_social_action(uuid,uuid,text) is
  'Finalizes one durable persona action without creating or changing a follow relationship.';

notify pgrst, 'reload schema';
