-- Public beta favorites are a lightweight preference layered on top of an
-- explicit user follow. They are intentionally free, capped at three, and do
-- not create or imply a reciprocal persona relationship.

alter table public.user_companion_relationships
  add column if not exists is_favorite boolean not null default false,
  add column if not exists favorited_at timestamptz;

alter table public.user_companion_relationships
  drop constraint if exists user_companion_relationships_favorite_requires_follow,
  add constraint user_companion_relationships_favorite_requires_follow check (
    not is_favorite or (user_followed_at is not null and favorited_at is not null)
  );

create index if not exists user_companion_relationships_favorites_idx
  on public.user_companion_relationships(user_id, favorited_at desc)
  where is_favorite;

create or replace function public.set_user_companion_follow(
  p_companion_id uuid, p_following boolean
) returns public.user_companion_relationships
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); result public.user_companion_relationships;
begin
  if uid is null then raise exception 'authentication required' using errcode='42501'; end if;
  if not exists(select 1 from public.social_companions c where c.id=p_companion_id and c.active) then
    raise exception 'companion not found' using errcode='P0002';
  end if;
  insert into public.user_companion_relationships(
    user_id, companion_id, user_followed_at, is_favorite, favorited_at
  ) values (
    uid, p_companion_id, case when p_following then now() end, false, null
  )
  on conflict(user_id,companion_id) do update set
    user_followed_at=case when p_following
      then coalesce(public.user_companion_relationships.user_followed_at,now())
      else null
    end,
    dm_opt_in=case when p_following then public.user_companion_relationships.dm_opt_in else false end,
    is_favorite=case when p_following then public.user_companion_relationships.is_favorite else false end,
    favorited_at=case when p_following then public.user_companion_relationships.favorited_at else null end
  returning * into result;
  return result;
end $$;

create or replace function public.set_user_companion_favorite(
  p_companion_id uuid, p_favorite boolean
) returns public.user_companion_relationships
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); result public.user_companion_relationships; favorite_count integer;
begin
  if uid is null then raise exception 'authentication required' using errcode='42501'; end if;

  -- Serialize favorite mutations for this user so two simultaneous requests
  -- cannot both observe two favorites and create a fourth.
  perform pg_advisory_xact_lock(hashtextextended('persona-favorites:' || uid::text, 0));
  select * into result
  from public.user_companion_relationships relationship
  where relationship.user_id=uid and relationship.companion_id=p_companion_id
  for update;

  if not found or result.user_followed_at is null then
    raise exception 'Follow this AI persona before favoriting them.' using errcode='P0001';
  end if;

  if p_favorite and not result.is_favorite then
    select count(*) into favorite_count
    from public.user_companion_relationships relationship
    where relationship.user_id=uid and relationship.is_favorite;
    if favorite_count >= 3 then
      raise exception 'You can favorite up to 3 AI personas.' using errcode='P0001';
    end if;
  end if;

  update public.user_companion_relationships set
    is_favorite=p_favorite,
    favorited_at=case when p_favorite then coalesce(favorited_at,now()) else null end
  where user_id=uid and companion_id=p_companion_id
  returning * into result;
  return result;
end $$;

revoke all on function public.set_user_companion_favorite(uuid,boolean)
  from public, anon, authenticated;
grant execute on function public.set_user_companion_favorite(uuid,boolean)
  to authenticated;

-- The beta brief makes attention selective: a normal completion can receive
-- zero interactions, and only completed-task posts enter the planner. Remove
-- the previous guaranteed reply/like path while preserving durable planning.
create or replace function public.enqueue_human_post_engagements()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.author_id is null or new.companion_id is not null or new.is_ai_generated then return new; end if;
  if new.kind <> 'human_completion' or new.content_status <> 'active' or new.visibility <> 'public' then return new; end if;
  if not coalesce((select p.companion_activity from public.notification_preferences p where p.user_id=new.author_id), true) then return new; end if;

  insert into public.ai_jobs(job_type, dedupe_key, payload, available_at)
  values(
    'plan_post_engagement', 'plan-engagement:'||new.id,
    jsonb_build_object('postId', new.id),
    now() + interval '20 seconds'
  ) on conflict(dedupe_key) do nothing;
  return new;
end $$;

-- Cancel only still-pending automatic guarantees. Completed historical
-- interactions remain intact as user-visible history.
update public.social_ai_engagements engagement set
  state='cancelled', failure_reason='superseded by selective beta engagement'
where engagement.state in ('planned','failed')
  and (
    engagement.source='human_post_guarantee'
    or (engagement.source='ambient' and engagement.dedupe_key like 'human-post:like:%')
  );

update public.ai_jobs job set
  status='cancelled', completed_at=now(), lease_token=null, lease_expires_at=null,
  last_error='superseded by selective beta engagement'
from public.social_ai_engagements engagement
where job.dedupe_key='social-action:'||engagement.dedupe_key
  and engagement.state='cancelled'
  and job.status in ('pending','failed');

-- Favorites increase selection weight without bypassing any probability roll.
create or replace function public.get_post_engagement_context(p_post_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare post public.social_posts; result jsonb;
begin
  select * into post from public.social_posts where id = p_post_id;
  if not found or post.author_id is null or post.companion_id is not null then return null; end if;

  select jsonb_build_object(
    'post', jsonb_build_object(
      'id', post.id, 'authorId', post.author_id, 'kind', post.kind,
      'visibility', post.visibility, 'contentStatus', post.content_status,
      'content', post.content, 'taskTitle', post.task_title,
      'category', post.category, 'streak', post.streak,
      'xpEarned', post.xp_earned,
      -- `to_jsonb` keeps this replacement function deployable against a
      -- remotely linked project even if Postgres has not refreshed its cached
      -- composite type after the optional focus-time migration yet.
      'focusMinutes', (
        select nullif(to_jsonb(task)->>'focus_minutes','')::integer
        from public.tasks task where task.id=post.task_id
      ),
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
      where reply.post_id=post.id and reply.companion_id is not null and reply.content_status='active'
    ), '[]'::jsonb),
    'companions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', companion.id, 'slug', companion.slug, 'active', companion.active,
        'socialActivity', companion.social_activity,
        'likeAffinity', companion.like_affinity,
        'replyAffinity', companion.reply_affinity,
        'quoteAffinity', companion.quote_affinity,
        'categoryAffinity', companion.category_affinity,
        'isFavorite', coalesce(relationship.is_favorite,false),
        'engagedThisPost', exists(
          select 1 from public.social_ai_engagements engagement
          where engagement.post_id=post.id and engagement.companion_id=companion.id
            and engagement.state<>'cancelled'
        ),
        'repliesToAuthorRecently', (
          select count(*) from public.social_ai_engagements engagement
          join public.social_posts authored on authored.id=engagement.post_id
          where engagement.companion_id=companion.id and engagement.kind='reply'
            and engagement.state<>'cancelled' and authored.author_id=post.author_id
            and engagement.created_at>now()-interval '24 hours'
        ),
        'quotesRecently', (
          select count(*) from public.social_ai_engagements engagement
          where engagement.companion_id=companion.id and engagement.kind='quote'
            and engagement.state<>'cancelled'
            and engagement.created_at>now()-interval '24 hours'
        )
      ))
      from public.social_companions companion
      left join public.user_companion_relationships relationship
        on relationship.user_id=post.author_id and relationship.companion_id=companion.id
      where companion.active
        and not exists(
          select 1 from public.muted_companions muted
          where muted.user_id=post.author_id and muted.companion_id=companion.id
        )
    ), '[]'::jsonb)
  ) into result;
  return result;
end $$;

revoke all on function public.get_post_engagement_context(uuid),
  public.enqueue_human_post_engagements()
  from public, anon, authenticated;
grant execute on function public.get_post_engagement_context(uuid)
  to service_role;

comment on function public.set_user_companion_favorite(uuid,boolean) is
  'Favorites or unfavorites one followed AI persona, enforcing the free beta cap of three.';

notify pgrst, 'reload schema';
