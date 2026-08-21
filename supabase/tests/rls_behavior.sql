begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(1);

insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','authenticated','authenticated','user-a@example.test',crypt('test-password',gen_salt('bf')),now(),'{}','{"username":"user_a"}',now(),now()),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','authenticated','authenticated','user-b@example.test',crypt('test-password',gen_salt('bf')),now(),'{}','{"username":"user_b"}',now(),now()),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','authenticated','authenticated','user-c@example.test',crypt('test-password',gen_salt('bf')),now(),'{}','{"username":"user_c"}',now(),now());

insert into public.social_companions(id,slug,name,personality,writing_style,interests,safety_instructions,fallback_replies,daily_templates,active,posting_frequency,daily_posts)
values
  ('10000000-0000-4000-8000-000000000001','test-one','Test One','Specific and calm.','Brief.','{}','No pressure.',array['One safe fallback.'],array['One safe daily note.'],true,3,
    '[{"task_title":"Test one A","category":"Test","content":"One A"},{"task_title":"Test one B","category":"Test","content":"One B"},{"task_title":"Test one C","category":"Test","content":"One C"}]'::jsonb),
  ('10000000-0000-4000-8000-000000000002','test-two','Test Two','Practical and kind.','Plainspoken.','{}','No pressure.',array['Another safe fallback.'],array['Another safe daily note.'],false,0,'[]'::jsonb),
  ('10000000-0000-4000-8000-000000000003','test-three','Test Three','Thoughtful and warm.','Concise.','{}','No pressure.',array['A third safe fallback.'],array['A third safe daily note.'],false,0,'[]'::jsonb)
on conflict (id) do nothing;

insert into public.tasks(id,owner_id,title,recurrence_rule,visibility,status)
values
  ('aaaaaaaa-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Private test task',null,'private','pending'),
  ('aaaaaaaa-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Public test task',null,'public','pending'),
  ('aaaaaaaa-0000-4000-8000-000000000003','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Completed test task',null,'private','pending'),
  ('aaaaaaaa-0000-4000-8000-000000000004','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Recurring daily test task','daily','private','pending');

set local role authenticated;
set local "request.jwt.claim.sub" = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

select public.submit_feedback('idea', '  A calmer dashboard would help.  ');
select public.submit_feedback('issue', 'The task filter is difficult to find.');
select public.submit_feedback('other', 'Please keep the quiet visual style.');
select public.submit_feedback('idea', 'A compact task view would be useful.');
select public.submit_feedback('issue', 'The mobile composer needs more room.');

do $$ begin
  begin
    perform public.submit_feedback('other', 'This sixth submission must be rate limited.');
    raise exception 'feedback rate limit did not reject the sixth submission';
  exception when raise_exception then
    if sqlerrm='feedback rate limit did not reject the sixth submission' then raise; end if;
    if sqlerrm<>'rate limit exceeded' then raise; end if;
  end;
end $$;

reset role;
do $$ begin
  if (select count(*) from public.feedback_submissions where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> 5 then
    raise exception 'feedback RPC did not store exactly five identity-bound submissions';
  end if;
  if not exists(
    select 1 from public.feedback_submissions
    where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and category='idea' and message='A calmer dashboard would help.'
  ) then raise exception 'feedback RPC did not trim and attribute the submission'; end if;
end $$;

set local role anon;
do $$ begin
  begin
    perform public.submit_feedback('idea', 'Anonymous feedback must not be accepted.');
    raise exception 'anonymous feedback submission succeeded';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

insert into public.tasks(owner_id,title,visibility,status)
values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Client-created test task','private','pending');

do $$ begin
  if (select count(*) from public.tasks) <> 5 then raise exception 'owner cannot create/read own tasks'; end if;
  if not exists(select 1 from public.social_companions where id='10000000-0000-4000-8000-000000000001') then raise exception 'authenticated user cannot read an active companion'; end if;
  if exists(select 1 from public.public_task_progress where task_id='aaaaaaaa-0000-4000-8000-000000000001') then raise exception 'private task leaked to public progress'; end if;
  if not exists(select 1 from public.public_task_progress where task_id='aaaaaaaa-0000-4000-8000-000000000002') then raise exception 'public task missing from progress'; end if;
end $$;

update public.tasks set visibility='private' where id='aaaaaaaa-0000-4000-8000-000000000002';
do $$ begin
  if exists(select 1 from public.public_task_progress where task_id='aaaaaaaa-0000-4000-8000-000000000002') then raise exception 'public-to-private transition left a stale projection'; end if;
end $$;

update public.tasks set status='completed' where id='aaaaaaaa-0000-4000-8000-000000000003';
select public.publish_task_completion('aaaaaaaa-0000-4000-8000-000000000003', null, 'private', null);
select public.publish_task_completion('aaaaaaaa-0000-4000-8000-000000000003', 'A completed test.', 'private', null);
select public.publish_progress_post('Some visible progress.', 'public', 'optional-ai-engagement-test', null, null, null);

update public.tasks set status='completed' where id='aaaaaaaa-0000-4000-8000-000000000004';
select public.publish_task_completion('aaaaaaaa-0000-4000-8000-000000000004', 'Recurring completion.', 'public', current_date::text);
select public.publish_task_completion('aaaaaaaa-0000-4000-8000-000000000004', 'Recurring completion.', 'public', current_date::text);
update public.tasks set status='pending' where id='aaaaaaaa-0000-4000-8000-000000000004';
update public.tasks set status='completed' where id='aaaaaaaa-0000-4000-8000-000000000004';

reset role;
do $$
declare published_id uuid; progress_id uuid;
begin
  select id into published_id from public.social_posts where author_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and task_id='aaaaaaaa-0000-4000-8000-000000000003';
  select id into progress_id from public.social_posts where author_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and idempotency_key='progress:optional-ai-engagement-test';
  if published_id is null then raise exception 'completion post was not created'; end if;
  if not exists(select 1 from public.social_posts where id=published_id and visibility='private') then raise exception 'completion publisher did not enforce the profile privacy preference'; end if;
  if not exists(select 1 from public.social_posts where id=published_id and content='') then raise exception 'blank completion comment was not preserved as blank'; end if;
  if progress_id is null then raise exception 'progress post was not created'; end if;
  if (select count(*) from public.social_posts where author_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and task_id='aaaaaaaa-0000-4000-8000-000000000003') <> 1 then raise exception 'completion publishing was not idempotent'; end if;
  if (select count(*) from public.social_ai_engagements where post_id=published_id and state='planned') <> 2 then raise exception 'completion publishing did not plan one reply and one ambient like'; end if;
  if exists(select 1 from public.social_replies where post_id=published_id and companion_id is not null) then raise exception 'completion publishing automatically created an AI reply'; end if;
  if exists(select 1 from public.social_reactions where post_id=published_id and companion_id is not null) then raise exception 'completion publishing automatically created an AI reaction'; end if;
  if (select count(*) from public.ai_jobs where payload->>'postId'=published_id::text and job_type='perform_social_action') <> 2 then raise exception 'completion publishing did not queue persona work'; end if;
  if (select count(*) from public.social_ai_engagements where post_id=progress_id and state='planned') <> 2 then raise exception 'progress publishing did not plan persona engagement'; end if;
  if exists(select 1 from public.social_replies where post_id=progress_id and companion_id is not null) then raise exception 'progress publishing automatically created an AI reply'; end if;
  if exists(select 1 from public.social_reactions where post_id=progress_id and companion_id is not null) then raise exception 'progress publishing automatically created an AI reaction'; end if;
  if (select count(*) from public.ai_jobs where payload->>'postId'=progress_id::text and job_type='perform_social_action') <> 2 then raise exception 'progress publishing did not queue persona work'; end if;
  if (select count(*) from public.task_completion_awards where task_id='aaaaaaaa-0000-4000-8000-000000000004') <> 1 then raise exception 'recurring completion awarded twice in one occurrence'; end if;
  if (select count(*) from public.social_posts where task_id='aaaaaaaa-0000-4000-8000-000000000004') <> 1 then raise exception 'recurring completion published twice in one occurrence'; end if;
  if not exists(select 1 from public.social_posts where task_id='aaaaaaaa-0000-4000-8000-000000000004' and visibility='public') then raise exception 'completion publisher ignored the explicitly confirmed audience'; end if;
  if not exists(select 1 from public.tasks where id='aaaaaaaa-0000-4000-8000-000000000004' and recurrence_instance_id=current_date::text) then raise exception 'recurring task did not use its canonical occurrence key'; end if;
end $$;

do $$ begin
  begin
    insert into public.social_posts(author_id,kind,visibility,content,idempotency_key)
    values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','human_progress','private','','blank-progress-must-fail');
    raise exception 'blank non-completion post content was accepted';
  exception when check_violation then
    null;
  end;
end $$;

insert into public.social_posts(id,author_id,kind,visibility,content,idempotency_key)
values
  ('aaaaaaaa-1000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','human_progress','private','Private post','private-fixture'),
  ('aaaaaaaa-1000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','human_progress','public','Public post','public-fixture'),
  ('aaaaaaaa-1000-4000-8000-000000000003','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','human_progress','public','Owner controlled post','owner-control-fixture');

insert into public.social_posts(id,companion_id,kind,visibility,content,source_key,is_ai_generated)
values('aaaaaaaa-1000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','ai_progress','public','AI fixture','ai-no-recursion',true);

do $$ begin
  if exists(select 1 from public.social_ai_engagements where post_id='aaaaaaaa-1000-4000-8000-000000000004') then
    raise exception 'AI-authored post recursively enqueued persona engagement';
  end if;
  if (select count(*) from public.social_ai_engagements where post_id='aaaaaaaa-1000-4000-8000-000000000002') <> 2 then
    raise exception 'eligible human post did not enqueue exactly one guaranteed reply and ambient like';
  end if;
end $$;

set local role authenticated;
set local "request.jwt.claim.sub" = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $$ begin
  if exists(select 1 from public.tasks where owner_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') then raise exception 'another user can read private tasks'; end if;
  if exists(select 1 from public.social_posts where id='aaaaaaaa-1000-4000-8000-000000000001') then raise exception 'another user can read a private post'; end if;
  if not exists(select 1 from public.social_posts where id='aaaaaaaa-1000-4000-8000-000000000002') then raise exception 'authenticated user cannot read a public post'; end if;
end $$;

update public.social_posts set visibility='private' where id='aaaaaaaa-1000-4000-8000-000000000003';
delete from public.social_posts where id='aaaaaaaa-1000-4000-8000-000000000003';
reset role;
do $$ begin
  if not exists(select 1 from public.social_posts where id='aaaaaaaa-1000-4000-8000-000000000003' and visibility='public') then raise exception 'another user changed or deleted a post they do not own'; end if;
end $$;

set local role authenticated;
set local "request.jwt.claim.sub" = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
update public.social_posts set visibility='private' where id='aaaaaaaa-1000-4000-8000-000000000003';
do $$ begin
  if not exists(select 1 from public.social_posts where id='aaaaaaaa-1000-4000-8000-000000000003' and visibility='private') then raise exception 'post owner could not change audience'; end if;
end $$;
delete from public.social_posts where id='aaaaaaaa-1000-4000-8000-000000000003';
reset role;
do $$ begin
  if exists(select 1 from public.social_posts where id='aaaaaaaa-1000-4000-8000-000000000003') then raise exception 'post owner could not delete their post'; end if;
end $$;

set local role authenticated;
set local "request.jwt.claim.sub" = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

do $$ begin
  begin
    insert into public.social_posts(author_id,kind,visibility,content) values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','human_progress','public','Bypass attempt');
    raise exception 'authenticated user bypassed the post publisher';
  exception when insufficient_privilege then null;
  end;
end $$;

select public.set_human_reaction('aaaaaaaa-1000-4000-8000-000000000002','like');
select public.set_human_reaction('aaaaaaaa-1000-4000-8000-000000000002','like');
select public.set_human_repost('aaaaaaaa-1000-4000-8000-000000000002',true);
select public.set_human_repost('aaaaaaaa-1000-4000-8000-000000000002',true);
reset role;
do $$ begin
  if (select count(*) from public.social_reactions where post_id='aaaaaaaa-1000-4000-8000-000000000002' and actor_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') <> 1 then raise exception 'reaction uniqueness/upsert failed'; end if;
  if not exists(select 1 from public.social_reactions where post_id='aaaaaaaa-1000-4000-8000-000000000002' and actor_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and reaction='like') then raise exception 'like upsert failed'; end if;
  if (select count(*) from public.social_reposts where post_id='aaaaaaaa-1000-4000-8000-000000000002' and actor_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') <> 1 then raise exception 'repost uniqueness/upsert failed'; end if;
end $$;

do $$
declare selected_job public.ai_jobs; token uuid := gen_random_uuid(); selected_action uuid; persona uuid;
begin
  select j.* into selected_job from public.ai_jobs j
  where j.job_type='perform_social_action' and j.payload->>'postId'='aaaaaaaa-1000-4000-8000-000000000002'
    and j.payload->>'kind'='reply' limit 1;
  selected_action := (selected_job.payload->>'actionId')::uuid;
  persona := (selected_job.payload->>'companionId')::uuid;
  update public.ai_jobs set status='processing',lease_token=token,lease_expires_at=now()+interval '1 minute'
    where id=selected_job.id;
  if not public.finalize_social_action(selected_job.id,token,'A clearly AI-authored reply.') then
    raise exception 'leased social action did not finalize';
  end if;
  if not public.finalize_social_action(selected_job.id,token,'A clearly AI-authored reply.') then
    raise exception 'completed social finalization was not idempotent';
  end if;
  if (select count(*) from public.social_replies where post_id='aaaaaaaa-1000-4000-8000-000000000002' and companion_id=persona and is_ai_generated) <> 1 then
    raise exception 'reply finalization duplicated or lost AI identity';
  end if;
  if not exists(select 1 from public.social_ai_engagements where id=selected_action and state='completed' and reply_id is not null) then
    raise exception 'action ledger did not record completed reply result';
  end if;
  if not exists(select 1 from public.user_companion_relationships where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and companion_id=persona and companion_follow_state='pending') then
    raise exception 'reply to private-profile human did not request companion follow';
  end if;
  if (select count(*) from public.notifications where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and companion_id=persona and kind='follow') <> 1 then
    raise exception 'private-profile follow request notification was not created exactly once';
  end if;
end $$;

set local role authenticated;
set local "request.jwt.claim.sub" = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $$
declare persona uuid;
begin
  select companion_id into persona from public.user_companion_relationships
    where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and companion_follow_state='pending' limit 1;
  begin
    perform public.set_companion_dm_opt_in(persona,true);
    raise exception 'DM opt-in succeeded before mutual follow';
  exception when raise_exception then
    if sqlerrm='DM opt-in succeeded before mutual follow' then raise; end if;
  end;
  perform public.respond_companion_follow(persona,true);
  perform public.set_user_companion_follow(persona,true);
  perform public.set_companion_dm_opt_in(persona,true);
  if not exists(select 1 from public.user_companion_relationships where user_id=auth.uid() and companion_id=persona and user_followed_at is not null and companion_follow_state='following' and dm_opt_in) then
    raise exception 'mutual-follow relationship transition failed';
  end if;
  if not exists(
    select 1 from public.user_companion_relationships relationship
    join public.chat_threads thread on thread.user_one_id=relationship.user_id and thread.companion_id=relationship.companion_id
    join public.chat_messages message on message.thread_id=thread.id and message.sender_companion_id=relationship.companion_id
    where relationship.user_id=auth.uid() and relationship.companion_id=persona
      and relationship.companion_dm_started_at is not null and message.is_ai_generated
  ) then raise exception 'mutual DM opt-in did not create a persona-started conversation'; end if;
  perform public.set_companion_dm_opt_in(persona,false);
  perform public.set_companion_dm_opt_in(persona,true);
  if (
    select count(*) from public.chat_messages message
    join public.chat_threads thread on thread.id=message.thread_id
    where thread.user_one_id=auth.uid() and thread.companion_id=persona and message.sender_companion_id=persona
  ) <> 1 then raise exception 'repeated DM opt-in duplicated the persona opener'; end if;
  perform public.reset_companion_memory(persona);
  if not exists(
    select 1 from public.companion_user_memory
    where user_id=auth.uid() and companion_id=persona and summary='' and facts='{}'::jsonb and reset_at is not null
  ) then raise exception 'memory reset did not leave a durable re-ingestion barrier'; end if;
  perform public.set_user_companion_follow(persona,false);
  if exists(select 1 from public.user_companion_relationships where user_id=auth.uid() and companion_id=persona and dm_opt_in) then
    raise exception 'unfollowing did not disable companion DMs';
  end if;
  begin
    perform public.respond_companion_follow(persona,false);
    raise exception 'follow response succeeded without a pending request';
  exception when raise_exception then
    if sqlerrm='follow response succeeded without a pending request' then raise; end if;
  end;
end $$;
reset role;

do $$
declare selected_job public.ai_jobs; token uuid := gen_random_uuid(); persona uuid; memory_version integer; expiry_version integer;
begin
  select companion_id into persona from public.user_companion_relationships
    where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and companion_follow_state='following' limit 1;
  perform public.enqueue_social_action(
    'test:accepted-private-follow-preserved', 'human_post_guarantee', 'reply',
    'aaaaaaaa-1000-4000-8000-000000000002', persona, null, now()
  );
  select j.* into selected_job from public.ai_jobs j
  where j.dedupe_key='social-action:test:accepted-private-follow-preserved';
  update public.ai_jobs set status='processing',lease_token=token,lease_expires_at=now()+interval '1 minute'
    where id=selected_job.id;
  if not public.finalize_social_action(selected_job.id,token,'A second clearly AI-authored reply.') then
    raise exception 'second leased social action did not finalize';
  end if;
  if not exists(
    select 1 from public.user_companion_relationships
    where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and companion_id=persona and companion_follow_state='following'
  ) then raise exception 'later reply reset an accepted private-profile follow request'; end if;

  select version into memory_version from public.companion_user_memory
  where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and companion_id=persona;
  if public.refresh_companion_memory(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',persona,'stale pre-reset detail','{}'::jsonb,
    null,now()+interval '180 days',memory_version-1,null
  ) then raise exception 'a stale in-flight refresh overwrote a newer memory reset'; end if;
  if not exists(
    select 1 from public.companion_user_memory
    where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and companion_id=persona and summary=''
  ) then raise exception 'stale memory refresh repopulated cleared memory'; end if;

  if not public.refresh_companion_memory(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',persona,'fresh post-reset detail','{}'::jsonb,
    null,now()+interval '180 days',memory_version,
    (select reset_at from public.companion_user_memory
      where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and companion_id=persona)
  ) then raise exception 'current memory refresh was rejected'; end if;
  update public.companion_user_memory set expires_at=now()-interval '1 second',reset_at=null
  where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and companion_id=persona
  returning version into expiry_version;
  perform public.reconcile_persona_engagements(current_date);
  if not exists(
    select 1 from public.companion_user_memory
    where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and companion_id=persona
      and summary='' and expires_at is null and reset_at is not null and version=expiry_version+1
  ) then raise exception 'expired memory did not become a durable forget boundary'; end if;
  if public.refresh_companion_memory(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',persona,'stale pre-expiry detail','{}'::jsonb,
    null,now()+interval '180 days',expiry_version,null
  ) then raise exception 'a stale in-flight refresh overwrote an expiry boundary'; end if;
end $$;

-- The preceding block ran under `reset role`, i.e. as the table owner, which
-- bypasses RLS entirely. Re-enter the authenticated role before asserting
-- anything about policy behaviour.
set local role authenticated;
set local "request.jwt.claim.sub" = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

-- profile_visibility must be enforced by RLS, not only by the profile page.
-- The anon key is published to the browser by design, so a UI-only check left
-- every row of user_profiles -- bio, interests, streak, last_completion_date --
-- readable straight from PostgREST by any signed-in user.
do $$ begin
  -- User C is private and has published nothing.
  if exists(select 1 from public.user_profiles where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc') then
    raise exception 'private profile leaked to another authenticated user';
  end if;
  -- User A is private too, but authored a live public post, so their identity
  -- must stay readable or that post cannot render its own author.
  if not exists(select 1 from public.user_profiles where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') then
    raise exception 'author of a public post was not readable';
  end if;
  -- Directory search must not enumerate private accounts either.
  if exists(select 1 from public.search_chat_contacts('user_c')) then
    raise exception 'private profile was enumerable through contact search';
  end if;
end $$;
reset role;

update public.user_profiles set profile_visibility='public' where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
insert into public.social_posts(id,author_id,kind,visibility,content,idempotency_key)
values('cccccccc-1000-4000-8000-000000000001','cccccccc-cccc-4ccc-8ccc-cccccccccccc','human_progress','public','Public followed-user post','followed-user-post');

set local role authenticated;
set local "request.jwt.claim.sub" = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $$ begin
  if not exists(select 1 from public.user_profiles where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc') then
    raise exception 'public profile was not readable';
  end if;
  if not exists(select 1 from public.search_chat_contacts('user_c')) then
    raise exception 'public profile was not findable through contact search';
  end if;
end $$;
reset role;

-- Human follows are one-way, public-profile relationships. The database owns
-- identity, privacy, blocking, and the count returned to profile pages.
set local role authenticated;
set local "request.jwt.claim.sub" = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $$
declare summary record;
begin
  if not public.set_user_follow('cccccccc-cccc-4ccc-8ccc-cccccccccccc', true) then
    raise exception 'public profile follow was not created';
  end if;
  if not public.set_user_follow('cccccccc-cccc-4ccc-8ccc-cccccccccccc', true) then
    raise exception 'repeated public profile follow did not preserve following state';
  end if;
  if not exists(
    select 1 from public.user_follows
    where follower_id=auth.uid() and followed_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  ) then raise exception 'follower could not read their own human follow edge'; end if;
  select * into summary from public.get_profile_follow_summary('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  if summary.follower_count <> 1 or not summary.viewer_follows then
    raise exception 'profile follow summary did not include the human follower';
  end if;
  perform public.set_user_companion_follow('10000000-0000-4000-8000-000000000001', true);
  if not exists(
    select 1 from public.get_following_post_ids(null,null,null,20)
    where post_id='cccccccc-1000-4000-8000-000000000001'
  ) then raise exception 'Following feed omitted a followed human profile post'; end if;
  if not exists(
    select 1 from public.get_following_post_ids(null,null,null,20)
    where post_id='aaaaaaaa-1000-4000-8000-000000000004'
  ) then raise exception 'Following feed omitted a followed AI companion post'; end if;
  begin
    perform public.set_user_follow('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
    raise exception 'private profile accepted a human follow';
  exception when raise_exception then
    if sqlerrm='private profile accepted a human follow' then raise; end if;
  end;
  begin
    perform public.set_user_follow('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
    raise exception 'self-follow was accepted';
  exception when raise_exception then
    if sqlerrm='self-follow was accepted' then raise; end if;
  end;
  begin
    insert into public.user_follows(follower_id, followed_id)
    values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    raise exception 'direct human follow insert bypassed the RPC';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

set local role authenticated;
set local "request.jwt.claim.sub" = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $$ begin
  if exists(
    select 1 from public.user_follows
    where follower_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
      and followed_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  ) then raise exception 'uninvolved user could read a human follow edge'; end if;
end $$;
reset role;

set local role authenticated;
set local "request.jwt.claim.sub" = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
do $$ begin
  if exists(
    select 1 from public.user_follows
    where follower_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
      and followed_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  ) then raise exception 'followed user could enumerate inbound human follow details'; end if;
end $$;
select public.set_user_block('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
do $$ begin
  if exists(
    select 1 from public.user_follows
    where follower_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
      and followed_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  ) then raise exception 'blocking did not remove the human follow edge'; end if;
end $$;
select public.set_user_block('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', false);
reset role;

update public.user_profiles set profile_visibility='public'
where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
set local role authenticated;
set local "request.jwt.claim.sub" = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select public.set_user_follow('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
reset role;

insert into public.account_deletion_requests(user_id,status)
values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','processing');
update public.account_deletion_requests set user_id=null,user_fingerprint=encode(digest('user-b:test-salt','sha256'),'hex'),status='auth_delete_pending' where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
delete from auth.users where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $$ begin
  if exists(select 1 from public.user_profiles where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') then raise exception 'profile did not cascade on auth deletion'; end if;
  if exists(select 1 from public.social_reactions where actor_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') then raise exception 'reactions did not cascade on auth deletion'; end if;
  if exists(select 1 from public.social_reposts where actor_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') then raise exception 'reposts did not cascade on auth deletion'; end if;
  if exists(select 1 from public.user_follows where follower_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' or followed_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') then raise exception 'human follows did not cascade on auth deletion'; end if;
  if not exists(select 1 from public.account_deletion_requests where user_id is null and user_fingerprint is not null and status='auth_delete_pending') then raise exception 'deletion audit was not pseudonymized before auth deletion'; end if;
end $$;

update public.ai_jobs set status='completed',completed_at=now(),lease_token=null,lease_expires_at=null;
insert into public.ai_jobs(id,job_type,dedupe_key,payload,status,available_at)
values('aaaaaaaa-2000-4000-8000-000000000001','enhance_reply','lease-contract','{}','pending',now());

do $$
declare claimed public.ai_jobs;
begin
  select * into claimed from public.claim_ai_jobs(1,30);
  if claimed.id <> 'aaaaaaaa-2000-4000-8000-000000000001' or claimed.status <> 'processing' or claimed.lease_token is null then
    raise exception 'claim did not create an owned processing lease';
  end if;
  if exists(select 1 from public.claim_ai_jobs(1,30)) then raise exception 'active lease was claimed twice'; end if;
  if public.complete_ai_job(claimed.id,gen_random_uuid()) is true then raise exception 'stale lease completed a job'; end if;
  update public.ai_jobs set lease_expires_at=now()-interval '1 second' where id=claimed.id;
  if not exists(select 1 from public.claim_ai_jobs(1,30) where id=claimed.id and lease_token<>claimed.lease_token) then
    raise exception 'expired lease was not recovered';
  end if;
end $$;

-- The list feed shows a reply count but never reply bodies. That count is
-- denormalized, so it has to track inserts, moderation status changes, and
-- deletes -- otherwise the number drifts from what the detail view lists.
do $$
declare reply_id uuid; baseline integer;
begin
  select reply_count into baseline from public.social_posts where id='aaaaaaaa-1000-4000-8000-000000000002';

  insert into public.social_replies(post_id, author_id, content)
  values('aaaaaaaa-1000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','A first reply.')
  returning id into reply_id;
  if (select reply_count from public.social_posts where id='aaaaaaaa-1000-4000-8000-000000000002') <> baseline + 1 then
    raise exception 'reply_count did not follow an insert';
  end if;

  -- A hidden reply is not listed by the detail view, so it must not be counted.
  update public.social_replies set content_status='hidden' where id=reply_id;
  if (select reply_count from public.social_posts where id='aaaaaaaa-1000-4000-8000-000000000002') <> baseline then
    raise exception 'reply_count counted a hidden reply';
  end if;

  update public.social_replies set content_status='active' where id=reply_id;
  delete from public.social_replies where id=reply_id;
  if (select reply_count from public.social_posts where id='aaaaaaaa-1000-4000-8000-000000000002') <> baseline then
    raise exception 'reply_count did not follow a delete';
  end if;
end $$;

-- A completed recurring task previously stayed completed forever, so a "daily
-- routine" fired exactly once and the habit loop could not repeat. Rollover
-- must be a no-op inside the same occurrence and must reopen the task once the
-- occurrence has passed.
do $$
declare rolled integer; task public.tasks;
begin
  select * into task from public.tasks where id='aaaaaaaa-0000-4000-8000-000000000004';
  if task.status <> 'completed' or task.recurrence_instance_id is null then
    raise exception 'recurring fixture was not left completed for the rollover contract';
  end if;

  rolled := public.rollover_recurring_tasks(current_date);
  if rolled <> 0 then raise exception 'rollover reopened a task inside its own occurrence'; end if;
  if exists(select 1 from public.tasks where id='aaaaaaaa-0000-4000-8000-000000000004' and status='pending') then
    raise exception 'rollover reopened a task completed today';
  end if;

  rolled := public.rollover_recurring_tasks(current_date + 1);
  if rolled <> 1 then raise exception 'rollover did not reopen a task whose occurrence has passed'; end if;
  select * into task from public.tasks where id='aaaaaaaa-0000-4000-8000-000000000004';
  if task.status <> 'pending' or task.completed_at is not null or task.recurrence_instance_id is not null then
    raise exception 'rollover left the task in an inconsistent state';
  end if;
  if task.due_at is null or task.due_at::date <> current_date + 1 then
    raise exception 'rollover did not advance the due date to the next occurrence';
  end if;

  -- Idempotent: running again within the new occurrence must change nothing.
  if public.rollover_recurring_tasks(current_date + 1) <> 0 then
    raise exception 'rollover was not idempotent within an occurrence';
  end if;

  -- A non-recurring completed task must never be reopened.
  if exists(select 1 from public.tasks where id='aaaaaaaa-0000-4000-8000-000000000003' and status='pending') then
    raise exception 'rollover reopened a task that does not repeat';
  end if;
end $$;

select extensions.pass('authenticated privacy, publishing, recurrence, deletion, reaction, and lease contracts hold');
select * from extensions.finish();

rollback;
