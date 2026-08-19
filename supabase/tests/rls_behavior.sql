begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(1);

insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','authenticated','authenticated','user-a@example.test',crypt('test-password',gen_salt('bf')),now(),'{}','{"username":"user_a"}',now(),now()),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','authenticated','authenticated','user-b@example.test',crypt('test-password',gen_salt('bf')),now(),'{}','{"username":"user_b"}',now(),now()),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','authenticated','authenticated','user-c@example.test',crypt('test-password',gen_salt('bf')),now(),'{}','{"username":"user_c"}',now(),now());

insert into public.social_companions(id,slug,name,personality,writing_style,interests,safety_instructions,fallback_replies,daily_templates,posting_frequency)
values
  ('10000000-0000-4000-8000-000000000001','test-one','Test One','Specific and calm.','Brief.','{}','No pressure.',array['One safe fallback.'],array['One safe daily note.'],0),
  ('10000000-0000-4000-8000-000000000002','test-two','Test Two','Practical and kind.','Plainspoken.','{}','No pressure.',array['Another safe fallback.'],array['Another safe daily note.'],0),
  ('10000000-0000-4000-8000-000000000003','test-three','Test Three','Thoughtful and warm.','Concise.','{}','No pressure.',array['A third safe fallback.'],array['A third safe daily note.'],0)
on conflict (id) do nothing;

insert into public.tasks(id,owner_id,title,recurrence_rule,visibility,status)
values
  ('aaaaaaaa-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Private test task',null,'private','pending'),
  ('aaaaaaaa-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Public test task',null,'public','pending'),
  ('aaaaaaaa-0000-4000-8000-000000000003','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Completed test task',null,'private','pending'),
  ('aaaaaaaa-0000-4000-8000-000000000004','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Recurring daily test task','daily','private','pending');

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
  if not exists(select 1 from public.social_posts where id=published_id and content='Glad to have this one wrapped up.') then raise exception 'blank completion note did not use the reflective fallback'; end if;
  if progress_id is null then raise exception 'progress post was not created'; end if;
  if (select count(*) from public.social_posts where author_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and task_id='aaaaaaaa-0000-4000-8000-000000000003') <> 1 then raise exception 'completion publishing was not idempotent'; end if;
  if exists(select 1 from public.social_ai_engagements where post_id=published_id) then raise exception 'completion publishing automatically created AI engagement'; end if;
  if exists(select 1 from public.social_replies where post_id=published_id and companion_id is not null) then raise exception 'completion publishing automatically created an AI reply'; end if;
  if exists(select 1 from public.social_reactions where post_id=published_id and companion_id is not null) then raise exception 'completion publishing automatically created an AI reaction'; end if;
  if exists(select 1 from public.ai_jobs where payload->>'postId'=published_id::text) then raise exception 'completion publishing automatically queued AI work'; end if;
  if exists(select 1 from public.social_ai_engagements where post_id=progress_id) then raise exception 'progress publishing automatically created AI engagement'; end if;
  if exists(select 1 from public.social_replies where post_id=progress_id and companion_id is not null) then raise exception 'progress publishing automatically created an AI reply'; end if;
  if exists(select 1 from public.social_reactions where post_id=progress_id and companion_id is not null) then raise exception 'progress publishing automatically created an AI reaction'; end if;
  if exists(select 1 from public.ai_jobs where payload->>'postId'=progress_id::text) then raise exception 'progress publishing automatically queued AI work'; end if;
  if (select count(*) from public.task_completion_awards where task_id='aaaaaaaa-0000-4000-8000-000000000004') <> 1 then raise exception 'recurring completion awarded twice in one occurrence'; end if;
  if (select count(*) from public.social_posts where task_id='aaaaaaaa-0000-4000-8000-000000000004') <> 1 then raise exception 'recurring completion published twice in one occurrence'; end if;
  if not exists(select 1 from public.social_posts where task_id='aaaaaaaa-0000-4000-8000-000000000004' and visibility='public') then raise exception 'completion publisher ignored the explicitly confirmed audience'; end if;
  if not exists(select 1 from public.tasks where id='aaaaaaaa-0000-4000-8000-000000000004' and recurrence_instance_id=current_date::text) then raise exception 'recurring task did not use its canonical occurrence key'; end if;
end $$;

insert into public.social_posts(id,author_id,kind,visibility,content,idempotency_key)
values
  ('aaaaaaaa-1000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','human_progress','private','Private post','private-fixture'),
  ('aaaaaaaa-1000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','human_progress','public','Public post','public-fixture'),
  ('aaaaaaaa-1000-4000-8000-000000000003','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','human_progress','public','Owner controlled post','owner-control-fixture');

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
reset role;
do $$ begin
  if (select count(*) from public.social_reactions where post_id='aaaaaaaa-1000-4000-8000-000000000002' and actor_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') <> 1 then raise exception 'reaction uniqueness/upsert failed'; end if;
  if not exists(select 1 from public.social_reactions where post_id='aaaaaaaa-1000-4000-8000-000000000002' and actor_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and reaction='like') then raise exception 'like upsert failed'; end if;
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

insert into public.account_deletion_requests(user_id,status)
values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','processing');
update public.account_deletion_requests set user_id=null,user_fingerprint=encode(digest('user-b:test-salt','sha256'),'hex'),status='auth_delete_pending' where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
delete from auth.users where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $$ begin
  if exists(select 1 from public.user_profiles where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') then raise exception 'profile did not cascade on auth deletion'; end if;
  if exists(select 1 from public.social_reactions where actor_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') then raise exception 'reactions did not cascade on auth deletion'; end if;
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
declare reply_id uuid;
begin
  if (select reply_count from public.social_posts where id='aaaaaaaa-1000-4000-8000-000000000002') <> 0 then
    raise exception 'reply_count did not start at zero';
  end if;

  insert into public.social_replies(post_id, author_id, content)
  values('aaaaaaaa-1000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','A first reply.')
  returning id into reply_id;
  if (select reply_count from public.social_posts where id='aaaaaaaa-1000-4000-8000-000000000002') <> 1 then
    raise exception 'reply_count did not follow an insert';
  end if;

  -- A hidden reply is not listed by the detail view, so it must not be counted.
  update public.social_replies set content_status='hidden' where id=reply_id;
  if (select reply_count from public.social_posts where id='aaaaaaaa-1000-4000-8000-000000000002') <> 0 then
    raise exception 'reply_count counted a hidden reply';
  end if;

  update public.social_replies set content_status='active' where id=reply_id;
  delete from public.social_replies where id=reply_id;
  if (select reply_count from public.social_posts where id='aaaaaaaa-1000-4000-8000-000000000002') <> 0 then
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
