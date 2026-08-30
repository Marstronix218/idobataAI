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
  ('10000000-0000-4000-8000-000000000002','test-two','Test Two','Practical and kind.','Plainspoken.','{}','No pressure.',array['Another safe fallback.'],array['Another safe daily note.'],true,3,
    '[{"task_title":"Test two A","category":"Test","content":"Two A"},{"task_title":"Test two B","category":"Test","content":"Two B"},{"task_title":"Test two C","category":"Test","content":"Two C"}]'::jsonb),
  ('10000000-0000-4000-8000-000000000003','test-three','Test Three','Thoughtful and warm.','Concise.','{}','No pressure.',array['A third safe fallback.'],array['A third safe daily note.'],true,3,
    '[{"task_title":"Test three A","category":"Test","content":"Three A"},{"task_title":"Test three B","category":"Test","content":"Three B"},{"task_title":"Test three C","category":"Test","content":"Three C"}]'::jsonb)
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

-- A larger AI-follower set must not fan one human post out to multiple
-- guaranteed persona replies.
select set_config('app.companion_follow_transition','allowed',true);
insert into public.user_companion_relationships(
  user_id,companion_id,companion_follow_state,companion_follow_requested_at,companion_followed_at
)
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',companion.id,'following',now(),now()
from public.social_companions companion
where companion.id in (
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003'
);
select set_config('app.companion_follow_transition','',true);

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
  if (
    select count(*) from public.social_ai_engagements
    where post_id='aaaaaaaa-1000-4000-8000-000000000002'
      and source='human_post_guarantee' and kind='reply'
  ) <> 1 then raise exception 'eligible human post did not cap guaranteed AI replies at one'; end if;
  if (
    select count(*) from public.social_ai_engagements
    where post_id='aaaaaaaa-1000-4000-8000-000000000002'
      and source='ambient' and kind='reaction'
  ) <> 1 then raise exception 'eligible human post did not plan exactly one ambient like'; end if;
end $$;

-- Task relevance decides who the guaranteed responder is, so the classifier the
-- trigger depends on must agree with the persona affinity tables.
do $$ begin
  if public.classify_task_category('Finished economics essay', null, null) <> 'study'
    then raise exception 'classifier did not read an essay as study'; end if;
  if public.classify_task_category('Cleaned my room', null, null) <> 'cleaning'
    then raise exception 'classifier did not read cleaning'; end if;
  if public.classify_task_category('Finished a 5 km run', null, null) <> 'exercise'
    then raise exception 'classifier did not read a run as exercise'; end if;
  if public.classify_task_category('Fixed the authentication bug', null, null) <> 'coding'
    then raise exception 'classifier did not read a bug fix as coding'; end if;
  if public.classify_task_category('Session 4', null, 'Finally finished my tax paperwork.') <> 'admin'
    then raise exception 'classifier did not fall back to the completion note'; end if;
  if public.classify_task_category(null, null, null) <> 'other'
    then raise exception 'classifier guessed instead of returning other'; end if;
end $$;

-- Only a completed task draws the wider cast. A progress post keeps the single
-- guaranteed responder it has always had.
insert into public.social_posts(id,author_id,task_id,kind,visibility,content,task_title,category,idempotency_key)
values('aaaaaaaa-1000-4000-8000-0000000000e1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'aaaaaaaa-0000-4000-8000-000000000003','human_completion','public','Cleaned my entire apartment.',
  'Clean the apartment','Home','completion-engagement-fixture');

do $$ begin
  if (
    select count(*) from public.ai_jobs
    where job_type='plan_post_engagement' and dedupe_key='plan-engagement:aaaaaaaa-1000-4000-8000-0000000000e1'
  ) <> 1 then raise exception 'completed-task post did not queue exactly one selective engagement plan'; end if;
  if exists(
    select 1 from public.ai_jobs
    where job_type='plan_post_engagement' and dedupe_key='plan-engagement:aaaaaaaa-1000-4000-8000-000000000002'
  ) then raise exception 'a progress post queued selective persona engagement'; end if;
  if (
    select count(*) from public.social_ai_engagements
    where post_id='aaaaaaaa-1000-4000-8000-0000000000e1' and source='human_post_guarantee'
  ) <> 1 then raise exception 'completed-task post did not keep exactly one guaranteed reply'; end if;
end $$;

-- A persona quote repost is an authored post carrying the original, and it
-- notifies the quoted human the same way a human quote does.
insert into public.social_posts(id,companion_id,kind,visibility,content,quoted_post_id,source_key,is_ai_generated)
values('aaaaaaaa-1000-4000-8000-0000000000e2','10000000-0000-4000-8000-000000000001','ai_quote','public',
  'Full territory secured. I acknowledge this operation.','aaaaaaaa-1000-4000-8000-0000000000e1',
  'quote:test-engagement',true);

do $$ begin
  if not exists(
    select 1 from public.notifications
    where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and kind='quote' and companion_id='10000000-0000-4000-8000-000000000001'
      and post_id='aaaaaaaa-1000-4000-8000-0000000000e2'
  ) then raise exception 'a persona quote repost did not notify the quoted author'; end if;
  if exists(
    select 1 from public.social_ai_engagements where post_id='aaaaaaaa-1000-4000-8000-0000000000e2'
  ) then raise exception 'a persona quote post recursively enqueued persona engagement'; end if;

  begin
    insert into public.social_posts(companion_id,kind,visibility,content,source_key,is_ai_generated)
    values('10000000-0000-4000-8000-000000000002','ai_quote','public','Quote without an original.','quote:test-missing',true);
    raise exception 'a persona quote post without an original was accepted';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.social_posts(author_id,kind,visibility,content,quoted_post_id,idempotency_key)
    values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','ai_quote','public','Human wearing a persona quote kind.',
      'aaaaaaaa-1000-4000-8000-0000000000e1','quote-shape-fixture');
    raise exception 'a human-authored post was accepted as a persona quote';
  exception when check_violation then
    null;
  end;
end $$;

-- Quote scarcity is a product rule, so the schema refuses a persona configured
-- to quote more readily than it replies.
do $$ begin
  begin
    update public.social_companions
      set reply_affinity=0.2, quote_affinity=0.9
      where id='10000000-0000-4000-8000-000000000001';
    raise exception 'a persona was allowed to quote more readily than it replies';
  exception when check_violation then
    null;
  end;
end $$;

delete from public.user_companion_relationships
where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  and companion_id in (
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000003'
  );

do $$ begin
  begin
    insert into public.user_companion_relationships(
      user_id,companion_id,companion_follow_state,companion_follow_requested_at
    ) values(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '10000000-0000-4000-8000-000000000001',
      'pending',now()
    );
    raise exception 'direct companion follow transition bypassed the consent guard';
  exception when insufficient_privilege then null;
  end;
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
select public.publish_quote_repost('aaaaaaaa-1000-4000-8000-000000000002','Worth keeping in mind.','public','rls-quote-idempotency');
select public.publish_quote_repost('aaaaaaaa-1000-4000-8000-000000000002','Worth keeping in mind.','public','rls-quote-idempotency');
reset role;
do $$ begin
  if (select count(*) from public.social_reactions where post_id='aaaaaaaa-1000-4000-8000-000000000002' and actor_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') <> 1 then raise exception 'reaction uniqueness/upsert failed'; end if;
  if not exists(select 1 from public.social_reactions where post_id='aaaaaaaa-1000-4000-8000-000000000002' and actor_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and reaction='like') then raise exception 'like upsert failed'; end if;
  if (select count(*) from public.social_reposts where post_id='aaaaaaaa-1000-4000-8000-000000000002' and actor_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') <> 1 then raise exception 'repost uniqueness/upsert failed'; end if;
  if (select count(*) from public.social_posts where author_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and kind='human_quote' and quoted_post_id='aaaaaaaa-1000-4000-8000-000000000002') <> 1 then raise exception 'quote repost idempotency/reference failed'; end if;
  if not exists(select 1 from public.social_posts where author_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and kind='human_quote' and content='Worth keeping in mind.' and visibility='public') then raise exception 'quote repost content/audience failed'; end if;
end $$;

-- Quote reposts must never turn an inaccessible source into readable content.
-- User C exercises each rejection independently so these calls do not consume
-- User B's post-publishing rate-limit budget used above.
insert into public.social_posts(id,author_id,kind,visibility,content,content_status,idempotency_key)
values
  ('aaaaaaaa-1000-4000-8000-000000000005','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','human_progress','public','Hidden source must stay hidden.','hidden','hidden-quote-source'),
  ('aaaaaaaa-1000-4000-8000-000000000006','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','human_progress','public','Sensitive source text that must not be copied.','active','mutable-quote-source');

set local role authenticated;
set local "request.jwt.claim.sub" = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

do $$ begin
  begin
    perform public.publish_quote_repost('aaaaaaaa-1000-4000-8000-000000000001','Private source quote.','public','reject-private-source');
    raise exception 'private post was accepted as a quote source';
  exception when no_data_found then null;
  end;
end $$;

do $$ begin
  begin
    perform public.publish_quote_repost('aaaaaaaa-1000-4000-8000-000000000005','Hidden source quote.','public','reject-hidden-source');
    raise exception 'hidden post was accepted as a quote source';
  exception when no_data_found then null;
  end;
end $$;

select public.set_user_block('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
do $$ begin
  begin
    perform public.publish_quote_repost('aaaaaaaa-1000-4000-8000-000000000002','Blocked source quote.','public','reject-blocked-source');
    raise exception 'blocked author post was accepted as a quote source';
  exception when no_data_found then null;
  end;
end $$;
select public.set_user_block('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false);

select public.set_companion_mute('10000000-0000-4000-8000-000000000001', true);
do $$ begin
  begin
    perform public.publish_quote_repost('aaaaaaaa-1000-4000-8000-000000000004','Muted source quote.','public','reject-muted-source');
    raise exception 'muted companion post was accepted as a quote source';
  exception when no_data_found then null;
  end;
end $$;
select public.set_companion_mute('10000000-0000-4000-8000-000000000001', false);

select public.publish_quote_repost(
  'aaaaaaaa-1000-4000-8000-000000000006',
  'Commentary remains after source changes.',
  'private',
  'source-lifecycle'
);
reset role;

update public.social_posts
set visibility='private'
where id='aaaaaaaa-1000-4000-8000-000000000006';

set local role authenticated;
set local "request.jwt.claim.sub" = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
do $$ begin
  if not exists(
    select 1 from public.social_posts
    where author_id=auth.uid() and kind='human_quote'
      and content='Commentary remains after source changes.'
  ) then raise exception 'quote disappeared when its source became private'; end if;
  if exists(
    select 1
    from public.social_posts quote
    join public.social_posts source on source.id=quote.quoted_post_id
    where quote.author_id=auth.uid()
      and quote.content='Commentary remains after source changes.'
  ) then raise exception 'private quote source remained readable through its quote'; end if;
end $$;
reset role;

delete from public.social_posts
where id='aaaaaaaa-1000-4000-8000-000000000006';

do $$ begin
  if not exists(
    select 1 from public.social_posts
    where author_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
      and kind='human_quote'
      and content='Commentary remains after source changes.'
      and quoted_post_id is null
  ) then raise exception 'source deletion did not preserve the quote with a cleared reference'; end if;
  if exists(
    select 1 from public.social_posts
    where author_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
      and kind='human_quote'
      and content like '%Sensitive source text%'
  ) then raise exception 'quote copied stale source content into its own row'; end if;
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
  if exists(select 1 from public.user_companion_relationships where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and companion_id=persona) then
    raise exception 'AI reply silently created a companion relationship';
  end if;
  if exists(select 1 from public.notifications where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and companion_id=persona and kind='follow') then
    raise exception 'AI reply silently created a follow notification';
  end if;

  update public.user_profiles set profile_visibility='public'
  where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  perform public.request_companion_follow('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',persona);
  perform public.request_companion_follow('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',persona);
  if (select count(*) from public.user_companion_relationships where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and companion_id=persona and companion_follow_state='pending' and companion_followed_at is null) <> 1 then
    raise exception 'explicit companion follow request was not consent-gated or idempotent';
  end if;
  if (select count(*) from public.notifications where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and companion_id=persona and kind='follow') <> 1 then
    raise exception 'explicit companion follow request notification was not idempotent';
  end if;
  update public.user_profiles set profile_visibility='private'
  where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
end $$;

set local role authenticated;
set local "request.jwt.claim.sub" = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $$
declare persona uuid;
begin
  select companion_id into persona from public.user_companion_relationships
    where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and companion_follow_state='pending' limit 1;
  if public.get_profile_ai_follower_count(auth.uid()) <> 0 then
    raise exception 'pending companion request was counted as an AI follower';
  end if;
  begin
    perform public.set_companion_dm_opt_in(persona,true);
    raise exception 'DM opt-in succeeded before mutual follow';
  exception when raise_exception then
    if sqlerrm='DM opt-in succeeded before mutual follow' then raise; end if;
  end;
  perform public.respond_companion_follow(persona,true);
  if public.get_profile_ai_follower_count(auth.uid()) <> 1 then
    raise exception 'accepted companion request was not counted as an AI follower';
  end if;
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
  ) then raise exception 'later reply changed an explicit mutual-follow relationship'; end if;

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
  begin
    perform public.get_profile_ai_follower_count('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    raise exception 'private AI follower count was readable';
  exception when no_data_found then null;
  end;
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

set local role authenticated;
set local "request.jwt.claim.sub" = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select public.set_user_block('cccccccc-cccc-4ccc-8ccc-cccccccccccc', true);
do $$ begin
  begin
    perform public.get_profile_ai_follower_count('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    raise exception 'viewer-blocked AI follower count was readable';
  exception when no_data_found then null;
  end;
end $$;
select public.set_user_block('cccccccc-cccc-4ccc-8ccc-cccccccccccc', false);
reset role;

set local role authenticated;
set local "request.jwt.claim.sub" = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
select public.set_user_block('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $$ begin
  begin
    perform public.get_profile_ai_follower_count('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    raise exception 'target-blocked AI follower count was readable';
  exception when no_data_found then null;
  end;
end $$;
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
select public.set_user_block('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', false);
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
  if exists(select 1 from public.social_posts where author_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') then raise exception 'quote posts did not cascade on author deletion'; end if;
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

  -- America/Los_Angeles enters daylight saving time on 2026-03-08. A
  -- recurring 09:30 deadline must therefore move from 17:30 UTC to 16:30 UTC
  -- while remaining 09:30 in its saved local zone.
  insert into public.tasks(
    id, owner_id, title, due_at, due_has_time, due_timezone,
    recurrence_rule, recurrence_instance_id, visibility, status, completed_at
  ) values (
    'aaaaaaaa-0000-4000-8000-000000000005',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'DST recurring deadline',
    '2026-03-07 17:30:00+00',
    true,
    'America/Los_Angeles',
    'daily',
    '2026-03-07',
    'private',
    'completed',
    '2026-03-07 18:00:00+00'
  );

  if public.rollover_recurring_tasks(date '2026-03-08') <> 1 then
    raise exception 'DST rollover did not reopen the exact recurring deadline';
  end if;
  select * into task from public.tasks where id='aaaaaaaa-0000-4000-8000-000000000005';
  if task.due_at <> timestamptz '2026-03-08 16:30:00+00' then
    raise exception 'DST rollover shifted the recurring local wall-clock deadline';
  end if;
  if (task.due_at at time zone task.due_timezone)::time <> time '09:30' then
    raise exception 'DST rollover did not preserve 09:30 in America/Los_Angeles';
  end if;

  -- 17:30 on August 21 in Los Angeles is already August 22 UTC. Completion
  -- identity must still use the deadline's August 21 local occurrence so the
  -- August 22 local occurrence can reopen normally.
  insert into public.tasks(
    id, owner_id, title, due_at, due_has_time, due_timezone,
    recurrence_rule, visibility, status
  ) values (
    'aaaaaaaa-0000-4000-8000-000000000006',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'UTC boundary recurring deadline',
    '2026-08-21 16:30:00+00',
    true,
    'America/Los_Angeles',
    'daily',
    'private',
    'pending'
  );
  if public.rollover_recurring_tasks(date '2026-08-22') <> 0 then
    raise exception 'UTC-boundary cron reopened an exact task before it was completed';
  end if;
  update public.tasks
     set status='completed', completed_at='2026-08-22 00:30:00+00'
   where id='aaaaaaaa-0000-4000-8000-000000000006';
  select * into task from public.tasks where id='aaaaaaaa-0000-4000-8000-000000000006';
  if task.recurrence_instance_id <> '2026-08-21' then
    raise exception 'UTC-boundary completion used the UTC date instead of its local occurrence';
  end if;
  if public.rollover_recurring_tasks(date '2026-08-23') <> 1 then
    raise exception 'first cron after UTC-boundary completion skipped the next local occurrence';
  end if;
  select * into task from public.tasks where id='aaaaaaaa-0000-4000-8000-000000000006';
  if task.due_at <> timestamptz '2026-08-22 16:30:00+00' then
    raise exception 'UTC-boundary rollover did not advance to the next local deadline';
  end if;
  if public.rollover_recurring_tasks(date '2026-08-23') <> 0 then
    raise exception 'exact rollover rewrote an already reopened occurrence';
  end if;

  insert into public.tasks(
    id, owner_id, title, due_at, due_has_time, due_timezone,
    recurrence_rule, recurrence_instance_id, visibility, status, completed_at
  ) values (
    'aaaaaaaa-0000-4000-8000-000000000007',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'Weekday recurring deadline',
    '2026-08-21 16:30:00+00',
    true,
    'America/Los_Angeles',
    'weekdays',
    '2026-08-21',
    'private',
    'completed',
    '2026-08-22 00:30:00+00'
  );
  if public.rollover_recurring_tasks(date '2026-08-23') <> 1 then
    raise exception 'first post-completion cron did not create the next local Monday occurrence';
  end if;
  if (select due_at from public.tasks where id='aaaaaaaa-0000-4000-8000-000000000007')
      <> timestamptz '2026-08-24 16:30:00+00' then
    raise exception 'weekday rollover chose the wrong local due date';
  end if;

  insert into public.tasks(
    id, owner_id, title, due_at, due_has_time, due_timezone,
    recurrence_rule, recurrence_instance_id, visibility, status, completed_at
  ) values (
    'aaaaaaaa-0000-4000-8000-000000000008',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'Weekly recurring deadline',
    '2026-08-19 16:30:00+00',
    true,
    'America/Los_Angeles',
    'weekly',
    '2026-W34',
    'private',
    'completed',
    '2026-08-22 00:30:00+00'
  );
  if public.rollover_recurring_tasks(date '2026-08-23') <> 1 then
    raise exception 'first post-completion cron did not create the next local due-weekday occurrence';
  end if;
  if (select due_at from public.tasks where id='aaaaaaaa-0000-4000-8000-000000000008')
      <> timestamptz '2026-08-26 16:30:00+00' then
    raise exception 'weekly rollover did not preserve the due weekday and local time';
  end if;
end $$;

select extensions.pass('authenticated privacy, publishing, recurrence, deletion, reaction, and lease contracts hold');
select * from extensions.finish();

rollback;
