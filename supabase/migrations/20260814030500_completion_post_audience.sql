create or replace function public.publish_task_completion(
  p_task_id uuid,
  p_message text default null,
  p_visibility public.post_visibility default 'private',
  p_recurrence_instance_id text default null
)
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

comment on function public.publish_task_completion(uuid,text,public.post_visibility,text) is
  'Publishes a completed task to the audience explicitly confirmed in the completion composer.';
