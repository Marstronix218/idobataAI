-- Keep AI replies and AI-initiated follow requests as separate, consented actions.

create or replace function public.guard_companion_follow_transition()
returns trigger language plpgsql set search_path = '' as $$
declare prior_state text := case when tg_op='INSERT' then 'none' else old.companion_follow_state end;
begin
  if new.companion_follow_state in ('pending','following')
    and new.companion_follow_state is distinct from prior_state
    and coalesce(current_setting('app.companion_follow_transition',true),'') <> 'allowed'
  then
    raise exception 'companion follow transition requires an authorized consent path' using errcode='42501';
  end if;
  return new;
end $$;

create or replace function public.request_companion_follow(
  p_user_id uuid, p_companion_id uuid
) returns public.user_companion_relationships
language plpgsql security definer set search_path = '' as $$
declare result public.user_companion_relationships;
  prior_authorization text := current_setting('app.companion_follow_transition',true);
begin
  if not exists(select 1 from public.user_profiles profile where profile.id=p_user_id) then
    raise exception 'user not found' using errcode='P0002';
  end if;
  if not exists(select 1 from public.social_companions companion where companion.id=p_companion_id and companion.active) then
    raise exception 'companion not found' using errcode='P0002';
  end if;
  if exists(
    select 1 from public.muted_companions muted
    where muted.user_id=p_user_id and muted.companion_id=p_companion_id
  ) or not coalesce((
    select preferences.companion_activity
    from public.notification_preferences preferences
    where preferences.user_id=p_user_id
  ),true) then
    raise exception 'target opted out' using errcode='P0001';
  end if;

  perform set_config('app.companion_follow_transition','allowed',true);
  insert into public.user_companion_relationships(
    user_id,companion_id,companion_follow_state,companion_follow_requested_at
  ) values(p_user_id,p_companion_id,'pending',now())
  on conflict(user_id,companion_id) do nothing
  returning * into result;

  if result.user_id is null then
    select relationship.* into result
    from public.user_companion_relationships relationship
    where relationship.user_id=p_user_id and relationship.companion_id=p_companion_id
    for update;

    if result.companion_follow_state in ('pending','following') then
      perform set_config('app.companion_follow_transition',coalesce(prior_authorization,''),true);
      return result;
    end if;

    update public.user_companion_relationships set
      companion_follow_state='pending',
      companion_follow_requested_at=now(),
      companion_followed_at=null,
      dm_opt_in=false
    where user_id=p_user_id and companion_id=p_companion_id
    returning * into result;
  end if;

  insert into public.notifications(user_id,companion_id,kind)
  values(p_user_id,p_companion_id,'follow')
  on conflict(user_id,companion_id,kind) where kind='follow' do update set
    created_at=excluded.created_at,
    read_at=null;

  perform set_config('app.companion_follow_transition',coalesce(prior_authorization,''),true);
  return result;
end $$;

create or replace function public.respond_companion_follow(p_companion_id uuid, p_accept boolean)
returns public.user_companion_relationships language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); result public.user_companion_relationships;
  prior_authorization text := current_setting('app.companion_follow_transition',true);
begin
  if uid is null then raise exception 'authentication required' using errcode='42501'; end if;
  perform 1 from public.user_companion_relationships
    where user_id=uid and companion_id=p_companion_id and companion_follow_state='pending' for update;
  if not found then raise exception 'no pending companion follow request' using errcode='P0001'; end if;
  perform set_config('app.companion_follow_transition','allowed',true);
  update public.user_companion_relationships set
    companion_follow_state=case when p_accept then 'following' else 'none' end,
    companion_followed_at=case when p_accept then now() end,
    dm_opt_in=case when p_accept then dm_opt_in else false end
  where user_id=uid and companion_id=p_companion_id
  returning * into result;
  perform set_config('app.companion_follow_transition',coalesce(prior_authorization,''),true);
  return result;
end $$;

drop trigger if exists user_companion_relationships_guard_follow_transition
  on public.user_companion_relationships;
create trigger user_companion_relationships_guard_follow_transition
  before insert or update of companion_follow_state on public.user_companion_relationships
  for each row execute function public.guard_companion_follow_transition();

-- Wait for any legacy relationship write already in flight. Calls queued behind
-- this lock resume after commit, see the guard above, and retry through the new
-- neutral finalizer instead of creating another automatic follow edge.
lock table public.user_companion_relationships in access exclusive mode;

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

  update public.social_ai_engagements set state='completed',failure_reason=null where id=action.id;
  update public.ai_jobs set status='completed',completed_at=now(),lease_token=null,lease_expires_at=null where id=job.id;
  return true;
end $$;

-- Before this migration, a completed reply created either a pending request or
-- an immediate public-profile follow. With the transition guard and neutral
-- finalizer in place, remove only those machine-created edges. Preserve
-- relationships with explicit DM history and accepted private-profile requests,
-- whose request and follow timestamps were written in separate user transactions.
delete from public.notifications notification
using public.user_companion_relationships relationship
where notification.user_id=relationship.user_id
  and notification.companion_id=relationship.companion_id
  and notification.kind='follow'
  and not relationship.dm_opt_in
  and relationship.companion_dm_started_at is null
  and (
    relationship.companion_follow_state='pending'
    or (
      relationship.companion_follow_state='following'
      and relationship.companion_follow_requested_at is not null
      and relationship.companion_follow_requested_at=relationship.companion_followed_at
    )
  );

update public.user_companion_relationships relationship set
  companion_follow_state='none',
  companion_follow_requested_at=null,
  companion_followed_at=null,
  dm_opt_in=false
where not relationship.dm_opt_in
  and relationship.companion_dm_started_at is null
  and (
    relationship.companion_follow_state='pending'
    or (
      relationship.companion_follow_state='following'
      and relationship.companion_follow_requested_at is not null
      and relationship.companion_follow_requested_at=relationship.companion_followed_at
    )
  );

revoke all on function public.guard_companion_follow_transition() from public, anon, authenticated;
revoke all on function public.request_companion_follow(uuid,uuid) from public, anon, authenticated;
grant execute on function public.request_companion_follow(uuid,uuid) to service_role;
comment on function public.request_companion_follow(uuid,uuid) is
  'Creates an idempotent, consent-required AI companion follow request without coupling it to replies.';
comment on function public.guard_companion_follow_transition() is
  'Rejects pending/following state transitions outside the dedicated request and consent RPCs.';
comment on function public.finalize_social_action(uuid,uuid,text) is
  'Lease-checked, idempotent finalizer for persona replies, likes, and reposts; never mutates follow relationships.';

notify pgrst, 'reload schema';
