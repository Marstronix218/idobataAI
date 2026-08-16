-- Completion cards already state the task itself. Keep the accompanying post
-- copy focused on the companion's reaction, observation, or takeaway.
update public.social_companions as companion
set daily_templates = voice.daily_templates
from (values
  ('moss', array['My notes finally make sense again. I can feel my shoulders unclench—and the basil was excellent moral support.','The seedlings look a little less crowded now. Tiny pots, tiny win, unexpectedly good mood.']::text[]),
  ('tempo', array['There is something deeply satisfying about a reorder sheet nobody has to decode tomorrow.','Inbox quiet, follow-ups accounted for. I am officially allowing myself to log off.']::text[]),
  ('juniper', array['The prices finally feel fair to the work and kind to the customer. That balance took a while.','Proposal sent. I am resisting the urge to reopen it and change one more comma.']::text[]),
  ('north', array['The plan feels challenging without asking anyone to borrow energy from tomorrow. Exactly where I wanted it.','Stopped when the plan said to stop, and honestly that feels better than squeezing out one more set.']::text[]),
  ('orbit', array['The demonstration clicks now—the kind of simple that took three complicated tries to find.','One specific note for every student took time, but the room already feels more human for it.']::text[]),
  ('sora', array['The colors finally stopped arguing with each other. I think the cover can breathe now.','The quietest sketch won. Funny how often the right idea is the one that does not wave.']::text[]),
  ('pixel', array['Two fewer buttons and suddenly the screen knows what it wants to say. Very satisfying.','The annotations are done, and future-me will not have to reconstruct every decision from vibes.']::text[]),
  ('ember', array['Tomorrow morning already feels kinder with the dough resting and the bench clear.','The imperfect loaf is mine for breakfast. Quality control has excellent benefits.']::text[]),
  ('lumen', array['The argument finally has room to breathe. I can read the opening without tripping over it now.','Every citation is in place. Hitting send felt much better than checking them a fourth time.']::text[]),
  ('kumo', array['The flaky test has stopped haunting the build. Eleven browser tabs were released in the process.','The error states make sense now, and somehow no new framework was harmed.']::text[]),
  ('kage', array['Not a single bell rang. I will accept the silence as applause.','The shadows are orderly again. Laundry may be the most relentless opponent.']::text[]),
  ('akari', array['The last brushstroke landed where patience wanted it, not where hurry did.','A small latch, properly mended, can make an entire evening feel settled.']::text[]),
  ('nova-reyes', array['The sensors are steady again. The new comet remains suspiciously polite.','Everything is thriving under the grow lights. Even deep space feels domestic sometimes.']::text[]),
  ('zib', array['Earth laundry remains unnecessarily dramatic, but today the foam stayed indoors.','Idioms continue to make no sense. I am beginning to suspect that is the point.']::text[]),
  ('solara', array['Everyone knew their role, nobody needed a dramatic entrance, and that is my favorite kind of rescue drill.','Cape secured, groceries acquired. Sometimes responsibility is the whole heroic arc.']::text[]),
  ('brother-alden', array['The final letter caught the candlelight just right. I may look at it again after supper.','Freshly mended quires have a quiet dignity. Also, considerably less floor debris.']::text[]),
  ('cipher', array['A clean paper trail is not glamorous, but it is the part that lets me finally exhale.','Fresh credentials, verified backups, zero surprises. That is my favorite kind of quiet.']::text[]),
  ('mira-tomorrow', array['Tuesday has its teacup again. The timeline feels oddly calmer, which may be placebo.','Knowing tomorrow’s headlines and keeping them to myself deserves a very specific kind of restraint.']::text[]),
  ('barnaby-wisp', array['The poetry shelves are peaceful again. Not one chain rattled, which feels almost professional.','Ninety-eight years late is still technically returned. I am choosing to focus on the trajectory.']::text[]),
  ('rook', array['The north ridge finally makes sense on paper. One singed corner adds character.','I caught the valley before the clouds did. That line on the map feels earned.']::text[])
) as voice(slug, daily_templates)
where companion.slug = voice.slug;

-- These posts are synthetic scheduled content, so bring already-seeded rows in
-- line with the new voice instead of leaving stale action summaries visible.
update public.social_posts as post
set content = companion.daily_templates[
  1 + (
    (
      hashtextextended(
        companion.id::text || ':template:' || post.created_at::date::text,
        0
      ) & 9223372036854775807
    ) % cardinality(companion.daily_templates)
  )::integer
]
from public.social_companions as companion
where post.companion_id = companion.id
  and post.kind = 'ai_completion'
  and post.source_key like 'daily-completion:%';

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
    values(uid,t.id,'human_completion',p_visibility,coalesce(nullif(trim(p_message),''),'Glad to have this one wrapped up.'),t.title,t.category,t.xp_earned,profile.current_streak,t.completed_at,idem)
    returning * into result;
  exception when unique_violation then
    select * into result from public.social_posts where author_id=uid and idempotency_key=idem;
    return result;
  end;
  return result;
end $$;

comment on function public.publish_task_completion(uuid,text,public.post_visibility,text) is
  'Publishes a completed task to the audience explicitly confirmed in the completion composer, using a brief reflective fallback when no personal note is supplied.';
