-- A persona reply used to be the end of the exchange: the character reacted to a
-- completed task, the human answered, and nothing came back. The queue already
-- responded to a direct reply, but it responded to it as though it were the task
-- all over again, with no idea what had been said in between.
--
-- This migration turns that single reaction into a conversation that a human
-- drives: it records the thread position of every human answer to a persona,
-- gates the follow-up behind configurable probability and cost limits, and
-- exposes the ancestor chain the generator needs to reply to what was actually
-- said. Personas still never answer themselves, and no persona is ever pulled
-- into a conversation that belongs to another persona.

-- Numeric product tuning. The existing flag table is boolean only, and a
-- response probability, a depth cap, and a daily budget are the dials this
-- feature needs to be adjustable in production without a deploy.
create table if not exists public.app_tuning_values (
  key text primary key,
  value numeric not null,
  description text,
  updated_at timestamptz not null default now()
);

drop trigger if exists app_tuning_values_touch on public.app_tuning_values;
create trigger app_tuning_values_touch before update
  on public.app_tuning_values for each row execute function public.touch_updated_at();

insert into public.app_tuning_values(key, value, description) values
  ('AI_THREAD_REPLY_PROBABILITY', 1.0,
    'Chance that a direct human reply to a persona earns a response. 1.0 keeps the beta deterministic; lower it to make personas answer selectively.'),
  ('AI_THREAD_MAX_DEPTH', 40,
    'Deepest reply position that may still trigger a persona follow-up.'),
  ('AI_THREAD_MAX_PERSONA_REPLIES_PER_DAY', 24,
    'Persona follow-ups one character may publish in one conversation per rolling day.'),
  ('AI_THREAD_MAX_ACTIVE_PER_USER', 8,
    'Persona follow-ups that may be queued or generating for one user at once.')
on conflict (key) do nothing;

alter table public.app_tuning_values enable row level security;
revoke all on public.app_tuning_values from public, anon, authenticated;
grant all on public.app_tuning_values to service_role;

create or replace function public.app_tuning_value(p_key text, p_default numeric)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce((select tuning.value from public.app_tuning_values tuning where tuning.key = p_key), p_default);
$$;

insert into public.app_feature_flags(key, enabled, description) values
  ('AI_PERSONA_THREAD_REPLIES', true,
    'Personas may answer a human who replies directly to one of their replies.')
on conflict (key) do nothing;

-- The ancestor chain of one reply, root first. Threading is already modelled by
-- `parent_reply_id`; this only reads it, so conversation position needs no
-- denormalized column that could drift from the tree it describes.
create or replace function public.reply_thread_path(p_reply_id uuid)
returns table(reply_id uuid, depth integer)
language sql stable security definer set search_path = '' as $$
  with recursive ancestry as (
    select reply.id, reply.parent_reply_id, 0 as height
    from public.social_replies reply
    where reply.id = p_reply_id
    union all
    select parent.id, parent.parent_reply_id, child.height + 1
    from ancestry child
    join public.social_replies parent on parent.id = child.parent_reply_id
    -- A cycle is impossible through the parent column, but a bounded walk keeps
    -- a corrupted row from hanging every insert on the table.
    where child.height < 100
  )
  select ancestry.id, (max(ancestry.height) over () - ancestry.height)::integer
  from ancestry
  order by ancestry.height desc;
$$;

comment on function public.reply_thread_path(uuid) is
  'Ancestor chain of a reply, root first, with 0-based depth.';

-- The conversation a persona follow-up is written against: the completed task
-- underneath, then the last few turns of this one branch. Sibling branches are
-- deliberately excluded, so two personas answering the same post never read each
-- other's conversation.
create or replace function public.get_reply_thread_context(p_reply_id uuid, p_limit integer default 10)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  target public.social_replies;
  post public.social_posts;
  thread_root uuid;
  thread_depth integer;
  messages jsonb;
begin
  select * into target from public.social_replies where id = p_reply_id;
  if not found then return null; end if;
  select * into post from public.social_posts where id = target.post_id;
  if not found then return null; end if;

  select max(path.depth), (array_agg(path.reply_id order by path.depth))[1]
    into thread_depth, thread_root
  from public.reply_thread_path(p_reply_id) path;

  select coalesce(jsonb_agg(entry order by (entry->>'depth')::integer), '[]'::jsonb) into messages
  from (
    select jsonb_build_object(
      'reply_id', reply.id,
      'depth', path.depth,
      'speaker', case when reply.companion_id is not null then 'persona' else 'user' end,
      'companion_id', reply.companion_id,
      'companion_name', companion.name,
      'author_id', reply.author_id,
      'author_label', coalesce(nullif(btrim(profile.display_name), ''), profile.username),
      'content', left(reply.content, 1000),
      'created_at', reply.created_at
    ) as entry
    from public.reply_thread_path(p_reply_id) path
    join public.social_replies reply on reply.id = path.reply_id
    left join public.social_companions companion on companion.id = reply.companion_id
    left join public.user_profiles profile on profile.id = reply.author_id
    where reply.content_status = 'active'
    order by path.depth desc
    limit greatest(2, least(coalesce(p_limit, 10), 20))
  ) window_rows;

  return jsonb_build_object(
    'post', jsonb_build_object(
      'id', post.id,
      'author_id', post.author_id,
      'author_label', (
        select coalesce(nullif(btrim(profile.display_name), ''), profile.username)
        from public.user_profiles profile where profile.id = post.author_id
      ),
      'kind', post.kind,
      'task_title', post.task_title,
      'category', post.category,
      'content', left(post.content, 1000),
      'streak', post.streak,
      'xp_earned', post.xp_earned,
      'created_at', post.created_at
    ),
    'target_reply_id', target.id,
    'root_reply_id', thread_root,
    'depth', thread_depth,
    'messages', messages
  );
end $$;

comment on function public.get_reply_thread_context(uuid,integer) is
  'Completed-task post plus the last turns of one reply branch, for persona follow-up generation.';

-- Analytics gains the thread shape. Identities and positions only: no reply
-- bodies, task titles, or generated text ever reach this table.
alter table public.beta_product_events
  add column if not exists post_id uuid,
  add column if not exists thread_root_reply_id uuid,
  add column if not exists thread_depth smallint;

alter table public.beta_product_events drop constraint if exists beta_product_events_event_name_check;
alter table public.beta_product_events add constraint beta_product_events_event_name_check
  check (event_name in (
    'session_active',
    'daily_active',
    'task_created',
    'task_completed',
    'completion_post_created',
    'persona_followed',
    'persona_unfollowed',
    'persona_favorited',
    'persona_unfavorited',
    'ai_like_completed',
    'ai_reply_completed',
    'ai_quote_completed',
    'persona_chat_message_sent',
    'user_replied_to_ai',
    'ai_replied_to_user_reply',
    'ai_thread_conversation_started',
    'ai_thread_conversation_continued'
  ));

create index if not exists beta_product_events_thread_idx
  on public.beta_product_events(thread_root_reply_id, event_name, occurred_at)
  where thread_root_reply_id is not null;

-- Replaced rather than overloaded: two arities both reachable with six
-- positional arguments would make every existing caller ambiguous.
drop function if exists public.capture_beta_product_event(text,uuid,uuid,uuid,timestamptz,timestamptz);

create or replace function public.capture_beta_product_event(
  p_event_name text,
  p_user_id uuid,
  p_source_id uuid default null,
  p_companion_id uuid default null,
  p_occurred_at timestamptz default now(),
  p_activity_bucket timestamptz default null,
  p_post_id uuid default null,
  p_thread_root_reply_id uuid default null,
  p_thread_depth integer default null
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.beta_product_events(
    event_name, user_id, companion_id, source_id, event_date,
    activity_bucket, occurred_at, post_id, thread_root_reply_id, thread_depth
  ) values (
    p_event_name, p_user_id, p_companion_id, p_source_id,
    (p_occurred_at at time zone 'UTC')::date,
    p_activity_bucket, p_occurred_at, p_post_id, p_thread_root_reply_id,
    least(greatest(coalesce(p_thread_depth, 0), 0), 32767)::smallint
  ) on conflict do nothing;
end $$;

-- A persona follow-up is the outcome the conversation funnel measures, so it is
-- recorded separately from the first reaction to a post.
create or replace function public.capture_beta_ai_engagement_event()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  target_user uuid;
  captured_name text;
  thread_root uuid;
  thread_depth integer;
begin
  if old.state = 'completed' or new.state <> 'completed' then return new; end if;

  if new.target_reply_id is not null then
    select reply.author_id into target_user
    from public.social_replies reply where reply.id = new.target_reply_id;
    select max(path.depth), (array_agg(path.reply_id order by path.depth))[1]
      into thread_depth, thread_root
    from public.reply_thread_path(new.target_reply_id) path;
  else
    select post.author_id into target_user
    from public.social_posts post where post.id = new.post_id;
  end if;
  if target_user is null then return new; end if;

  captured_name := case new.kind
    when 'reaction' then 'ai_like_completed'
    when 'reply' then 'ai_reply_completed'
    when 'quote' then 'ai_quote_completed'
  end;
  if captured_name is not null then
    perform public.capture_beta_product_event(
      captured_name, target_user, new.id, new.companion_id, now(), null,
      new.post_id, thread_root, thread_depth
    );
  end if;

  if new.kind = 'reply' and new.source = 'human_reply_response' then
    perform public.capture_beta_product_event(
      'ai_replied_to_user_reply', target_user, new.id, new.companion_id, now(), null,
      new.post_id, thread_root, coalesce(thread_depth, 0) + 1
    );
  end if;
  return new;
end $$;

-- A persona answering inside a thread addresses the person it is replying to,
-- who is often not the post author. Without a separate kind that person is
-- either told nothing at all, or told that someone replied to a post when what
-- actually happened is that a character answered them.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('reply','thread_reply','reaction','repost','quote','follow','follow_request','follow_accepted','system'));

create or replace function public.create_social_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
declare target_user uuid; parent_author uuid; post_author_kind text;
begin
  select author_id into target_user from public.social_posts where id=new.post_id;
  if tg_table_name='social_replies' then
    if new.parent_reply_id is not null then
      select reply.author_id into parent_author
      from public.social_replies reply where reply.id=new.parent_reply_id;
    end if;
    -- Answering the post author's own reply is the conversation case even when
    -- they also own the post, so the kind is decided per recipient.
    post_author_kind := case when parent_author is not null and parent_author = target_user then 'thread_reply' else 'reply' end;

    if target_user is not null and new.author_id is distinct from target_user
      and coalesce((select case when new.companion_id is not null then preferences.companion_activity else preferences.replies end from public.notification_preferences preferences where preferences.user_id=target_user),true) then
      insert into public.notifications(user_id,actor_id,companion_id,post_id,reply_id,kind)
      values(target_user,new.author_id,new.companion_id,new.post_id,new.id,post_author_kind);
    end if;

    if parent_author is not null
      and parent_author is distinct from target_user
      and parent_author is distinct from new.author_id
      and coalesce((select case when new.companion_id is not null then preferences.companion_activity else preferences.replies end from public.notification_preferences preferences where preferences.user_id=parent_author),true)
      and not exists(select 1 from public.notifications existing
        where existing.user_id=parent_author and existing.reply_id=new.id and existing.kind in ('reply','thread_reply'))
    then
      insert into public.notifications(user_id,actor_id,companion_id,post_id,reply_id,kind)
      values(parent_author,new.author_id,new.companion_id,new.post_id,new.id,'thread_reply');
    end if;
  elsif tg_table_name='social_reactions' then
    if target_user is not null and new.actor_id is distinct from target_user
      and coalesce((select case when new.companion_id is not null then preferences.companion_activity else preferences.reactions end from public.notification_preferences preferences where preferences.user_id=target_user),true) then
      insert into public.notifications(user_id,actor_id,companion_id,post_id,kind)
      values(target_user,new.actor_id,new.companion_id,new.post_id,'reaction');
    end if;
  end if;
  return new;
end $$;

-- The conversation gate. Everything that decides whether a character answers a
-- human lives here, so the queue downstream stays a pure execution path.
create or replace function public.enqueue_human_reply_engagements() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  target_companion uuid;
  thread_root uuid;
  thread_depth integer;
  prior_persona_turns integer;
  persona_turns_today integer;
  active_generations integer;
  probability numeric;
  roll numeric;
  skip_reason text;
begin
  -- A persona reply can never start this: only a human answering drives the
  -- conversation forward, which is what keeps AI-to-AI chains impossible.
  if new.author_id is null or new.companion_id is not null or new.is_ai_generated then return new; end if;
  if new.content_status <> 'active' then return new; end if;

  if new.parent_reply_id is not null then
    select reply.companion_id into target_companion
    from public.social_replies reply where reply.id=new.parent_reply_id;
  else
    select post.companion_id into target_companion
    from public.social_posts post where post.id=new.post_id;
  end if;

  -- Answering a human, or commenting under a human's post, reaches no persona.
  if target_companion is null
    or not exists(select 1 from public.social_companions c where c.id=target_companion and c.active)
    or exists(select 1 from public.muted_companions m where m.user_id=new.author_id and m.companion_id=target_companion)
    or not coalesce((select p.companion_activity from public.notification_preferences p where p.user_id=new.author_id), true)
  then return new; end if;

  select max(path.depth), (array_agg(path.reply_id order by path.depth))[1]
    into thread_depth, thread_root
  from public.reply_thread_path(new.id) path;
  thread_depth := coalesce(thread_depth, 0);

  select count(*) into prior_persona_turns
  from public.reply_thread_path(new.id) path
  join public.social_replies reply on reply.id=path.reply_id
  where reply.id <> new.id and reply.companion_id = target_companion;

  -- Recorded before the roll: the human reached out either way, and the ratio of
  -- these events to the responses below is the funnel this feature is judged on.
  perform public.capture_beta_product_event(
    'user_replied_to_ai', new.author_id, new.id, target_companion, new.created_at, null,
    new.post_id, thread_root, thread_depth
  );
  perform public.capture_beta_product_event(
    case when prior_persona_turns > 1 then 'ai_thread_conversation_continued'
         else 'ai_thread_conversation_started' end,
    new.author_id, new.id, target_companion, new.created_at, null,
    new.post_id, thread_root, thread_depth
  );

  select count(*) into persona_turns_today
  from public.social_replies reply
  where reply.companion_id = target_companion
    and reply.post_id = new.post_id
    and reply.created_at >= now() - interval '24 hours'
    and exists(select 1 from public.reply_thread_path(reply.id) path where path.reply_id = thread_root);

  select count(*) into active_generations
  from public.social_ai_engagements engagement
  join public.social_replies reply on reply.id = engagement.target_reply_id
  where engagement.source = 'human_reply_response'
    and engagement.state in ('planned','processing')
    and reply.author_id = new.author_id;

  probability := public.app_tuning_value('AI_THREAD_REPLY_PROBABILITY', 1.0);
  -- Deterministic in the reply id so a retried insert or a replayed trigger
  -- reaches the same verdict instead of rolling the dice a second time.
  roll := ((hashtextextended(new.id::text || ':thread-reply', 0) & 1073741823::bigint)::numeric / 1073741824::numeric);

  if not public.feature_flag_enabled('AI_PERSONA_THREAD_REPLIES') then skip_reason := 'thread replies disabled';
  elsif not public.feature_flag_enabled('AI_PERSONA_REPLIES') then skip_reason := 'replies disabled';
  elsif thread_depth > public.app_tuning_value('AI_THREAD_MAX_DEPTH', 40) then skip_reason := 'thread too deep';
  elsif persona_turns_today >= public.app_tuning_value('AI_THREAD_MAX_PERSONA_REPLIES_PER_DAY', 24) then skip_reason := 'daily thread budget reached';
  elsif active_generations >= public.app_tuning_value('AI_THREAD_MAX_ACTIVE_PER_USER', 8) then skip_reason := 'user has too many replies generating';
  elsif roll >= probability then skip_reason := 'probability roll declined';
  end if;

  if skip_reason is null then
    -- One engagement row per human reply, keyed on that reply: a retry, a
    -- replayed webhook, or a double submit all collapse onto the same row.
    perform public.enqueue_social_action('human-reply:response:'||new.id, 'human_reply_response',
      'reply', new.post_id, target_companion, new.id, now(),
      jsonb_build_object(
        'thread_root_reply_id', thread_root,
        'thread_depth', thread_depth,
        'prior_persona_turns', prior_persona_turns,
        'probability', probability,
        'roll', roll
      ));
  end if;

  perform public.enqueue_social_action('human-reply:like:'||new.id, 'ambient',
    'reaction', new.post_id, target_companion, new.id, now()+interval '1 minute');
  return new;
end $$;

comment on function public.enqueue_human_reply_engagements() is
  'Queues at most one follow-up from the persona a human answered, never from any other character.';

revoke all on function
  public.app_tuning_value(text,numeric),
  public.reply_thread_path(uuid),
  public.get_reply_thread_context(uuid,integer),
  public.capture_beta_product_event(text,uuid,uuid,uuid,timestamptz,timestamptz,uuid,uuid,integer),
  public.capture_beta_ai_engagement_event(),
  public.create_social_notification(),
  public.enqueue_human_reply_engagements()
  from public, anon, authenticated;

grant execute on function
  public.reply_thread_path(uuid),
  public.get_reply_thread_context(uuid,integer)
  to service_role;

notify pgrst, 'reload schema';
