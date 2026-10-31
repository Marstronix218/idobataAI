begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(1);

-- Persona guardrails enforced by BEFORE INSERT triggers. Default flags must
-- leave persona posts, replies and chat untouched; Pivot A must stop them at
-- the table no matter which function or client writes.

insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('c1c1c1c1-1111-4111-8111-c1c1c1c1c1c1','authenticated','authenticated','guard-a@example.test',crypt('test-password',gen_salt('bf')),now(),'{}','{"username":"guard_a"}',now(),now()),
  ('d2d2d2d2-1111-4111-8111-d2d2d2d2d2d2','authenticated','authenticated','guard-b@example.test',crypt('test-password',gen_salt('bf')),now(),'{}','{"username":"guard_b"}',now(),now());

insert into public.social_companions(id,slug,name,personality,writing_style,interests,safety_instructions,fallback_replies,daily_templates,active,posting_frequency,daily_posts)
values
  ('30000000-0000-4000-8000-000000000001','guard-one','Guard One','Calm.','Brief.','{}','No pressure.',array['A safe fallback.'],array['A daily note.'],true,3,
    '[{"task_title":"Guard one A","category":"Test","content":"One A"},{"task_title":"Guard one B","category":"Test","content":"One B"},{"task_title":"Guard one C","category":"Test","content":"One C"}]'::jsonb),
  ('30000000-0000-4000-8000-000000000002','guard-two','Guard Two','Kind.','Plain.','{}','No pressure.',array['Another fallback.'],array['Another note.'],true,3,
    '[{"task_title":"Guard two A","category":"Test","content":"Two A"},{"task_title":"Guard two B","category":"Test","content":"Two B"},{"task_title":"Guard two C","category":"Test","content":"Two C"}]'::jsonb);

do $$ begin
  if not exists(
    select 1 from pg_trigger
    where tgname in ('social_posts_guard_persona_insert','social_replies_guard_persona_insert',
      'social_reposts_guard_persona_insert','chat_threads_guard_persona_insert','chat_messages_guard_persona_insert')
      and not tgisinternal
    having count(*) = 5
  ) then raise exception 'a persona guard trigger is missing'; end if;
  if exists(
    select 1 from unnest(array[
      'public.guard_persona_post_insert()','public.guard_persona_reply_insert()','public.guard_persona_repost_insert()',
      'public.guard_persona_chat_thread_insert()','public.guard_persona_chat_message_insert()'
    ]) f
    where has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE')
  ) then raise exception 'clients can execute a persona guard function'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Default flags (pivot off, derived rows absent): everything still works.
-- ---------------------------------------------------------------------------

do $$
declare ai_post uuid; ai_reply uuid; scheduled integer;
begin
  if (select enabled from public.app_feature_flags where key='pivot_a.enabled') is distinct from false
    or exists(select 1 from public.app_feature_flags where key in ('social_feed.enabled','persona_chat.enabled','persona_autopost.enabled','share_win.enabled'))
  then raise exception 'this test expects the seeded default flags'; end if;

  insert into public.social_posts(companion_id, kind, visibility, content, source_key, is_ai_generated)
  values ('30000000-0000-4000-8000-000000000001','ai_progress','public','Guard test: persona post with default flags.','guard-test:defaults',true)
  returning id into ai_post;
  if ai_post is null then raise exception 'an AI post was skipped with default flags'; end if;

  insert into public.social_replies(post_id, companion_id, content, is_ai_generated)
  values (ai_post,'30000000-0000-4000-8000-000000000002','Guard test: persona reply with default flags.',true)
  returning id into ai_reply;
  if ai_reply is null then raise exception 'an AI reply was skipped with default flags'; end if;

  scheduled := public.schedule_companion_posts('2099-02-01'::date);
  if scheduled <= 0 then raise exception 'schedule_companion_posts created no posts with default flags'; end if;
end $$;

-- A human post by B is the repost target, so a repost notifies B.
insert into public.social_posts(author_id, kind, visibility, content, idempotency_key)
values ('d2d2d2d2-1111-4111-8111-d2d2d2d2d2d2','human_progress','public','Guard test: repost target.','guard-test-repost-target');

do $$
declare target uuid; persona_repost uuid;
begin
  select id into target from public.social_posts where idempotency_key='guard-test-repost-target';
  insert into public.social_reposts(post_id, companion_id)
  values (target, '30000000-0000-4000-8000-000000000001')
  returning id into persona_repost;
  if persona_repost is null then raise exception 'a persona repost was skipped with default flags'; end if;
  if not exists(
    select 1 from public.notifications
    where user_id='d2d2d2d2-1111-4111-8111-d2d2d2d2d2d2' and post_id=target and kind='repost'
      and companion_id='30000000-0000-4000-8000-000000000001'
  ) then raise exception 'a persona repost did not notify the author with default flags'; end if;
end $$;

set local role authenticated;
set local "request.jwt.claim.sub" = 'c1c1c1c1-1111-4111-8111-c1c1c1c1c1c1';
select public.get_or_create_chat_thread(null, '30000000-0000-4000-8000-000000000001');

reset role;
do $$
declare thread uuid; first_message public.chat_messages; second_message public.chat_messages; reply public.chat_messages;
begin
  select id into thread from public.chat_threads
  where user_one_id='c1c1c1c1-1111-4111-8111-c1c1c1c1c1c1' and companion_id='30000000-0000-4000-8000-000000000001';
  if thread is null then raise exception 'a companion chat thread was not created with default flags'; end if;

  first_message := public.create_beta_chat_message('c1c1c1c1-1111-4111-8111-c1c1c1c1c1c1', thread,
    'First message with default flags.', 'e0000000-0000-4000-8000-000000000001', 100);
  reply := public.create_companion_chat_reply(thread, '30000000-0000-4000-8000-000000000001', first_message.id,
    'A labeled AI reply with default flags.');
  -- Left unanswered on purpose: answering it later must hit the guard.
  second_message := public.create_beta_chat_message('c1c1c1c1-1111-4111-8111-c1c1c1c1c1c1', thread,
    'Second message with default flags.', 'e0000000-0000-4000-8000-000000000002', 100);
  if first_message.id is null or second_message.id is null or reply.id is null or reply.sender_companion_id is null then
    raise exception 'companion chat messages were not written with default flags';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Pivot A on: persona posts, replies and chat stop; people are untouched.
-- ---------------------------------------------------------------------------

update public.app_feature_flags set enabled=true where key='pivot_a.enabled';

do $$
declare scheduled integer; skipped uuid; ai_post uuid;
begin
  scheduled := public.schedule_companion_posts('2099-02-02'::date);
  if scheduled <> 0 then raise exception 'schedule_companion_posts reported % posts under Pivot A', scheduled; end if;
  if exists(select 1 from public.social_posts where source_key like 'daily-completion:%:2099-02-02%') then
    raise exception 'schedule_companion_posts created persona posts under Pivot A';
  end if;

  insert into public.social_posts(companion_id, kind, visibility, content, source_key, is_ai_generated)
  values ('30000000-0000-4000-8000-000000000001','ai_progress','public','Guard test: persona post under Pivot A.','guard-test:pivot-on',true)
  returning id into skipped;
  if skipped is not null or exists(select 1 from public.social_posts where source_key='guard-test:pivot-on') then
    raise exception 'a direct AI post insert was not skipped under Pivot A';
  end if;

  select id into ai_post from public.social_posts where source_key='guard-test:defaults';
  insert into public.social_replies(post_id, companion_id, content, is_ai_generated)
  values (ai_post,'30000000-0000-4000-8000-000000000002','Guard test: persona reply under Pivot A.',true)
  returning id into skipped;
  if skipped is not null or exists(select 1 from public.social_replies where content='Guard test: persona reply under Pivot A.') then
    raise exception 'a direct AI reply insert was not skipped under Pivot A';
  end if;

  insert into public.social_reposts(post_id, companion_id)
  values ((select id from public.social_posts where idempotency_key='guard-test-repost-target'), '30000000-0000-4000-8000-000000000002')
  returning id into skipped;
  if skipped is not null or exists(select 1 from public.social_reposts where companion_id='30000000-0000-4000-8000-000000000002') then
    raise exception 'a persona repost was not skipped under Pivot A';
  end if;
  if exists(select 1 from public.notifications where kind='repost' and companion_id='30000000-0000-4000-8000-000000000002') then
    raise exception 'a skipped persona repost still notified the author';
  end if;
end $$;

set local role authenticated;
set local "request.jwt.claim.sub" = 'c1c1c1c1-1111-4111-8111-c1c1c1c1c1c1';

select public.publish_progress_post('Guard test: human progress under Pivot A.', 'public', 'guard-test-human', null, null, null);
select public.create_human_reply(
  (select id from public.social_posts where idempotency_key='progress:guard-test-human'),
  'Guard test: human reply under Pivot A.', null
);
select public.set_human_repost(
  (select id from public.social_posts where idempotency_key='guard-test-repost-target'), true
);

do $$
declare state text; msg text;
begin
  begin
    perform public.get_or_create_chat_thread(null, '30000000-0000-4000-8000-000000000002');
  exception when others then get stacked diagnostics state = returned_sqlstate, msg = message_text;
  end;
  if state is distinct from 'P0001' or msg is distinct from 'feature disabled' then
    raise exception 'opening a new companion thread under Pivot A: expected P0001 feature disabled, got % %', state, msg;
  end if;

  perform public.get_or_create_chat_thread('d2d2d2d2-1111-4111-8111-d2d2d2d2d2d2', null);
end $$;

reset role;
do $$
declare
  thread uuid;
  human_thread uuid;
  unanswered uuid;
  sent public.chat_messages;
  state text;
  msg text;
begin
  if not exists(select 1 from public.social_posts where idempotency_key='progress:guard-test-human' and author_id is not null) then
    raise exception 'a human post was blocked under Pivot A';
  end if;
  if not exists(select 1 from public.social_replies where content='Guard test: human reply under Pivot A.' and author_id is not null) then
    raise exception 'a human reply was blocked under Pivot A';
  end if;
  if not exists(
    select 1 from public.social_reposts repost
    join public.social_posts post on post.id=repost.post_id and post.idempotency_key='guard-test-repost-target'
    where repost.actor_id='c1c1c1c1-1111-4111-8111-c1c1c1c1c1c1'
  ) then raise exception 'a human repost was blocked under Pivot A'; end if;
  if not exists(
    select 1 from public.notifications
    where user_id='d2d2d2d2-1111-4111-8111-d2d2d2d2d2d2' and kind='repost'
      and actor_id='c1c1c1c1-1111-4111-8111-c1c1c1c1c1c1'
  ) then raise exception 'a human repost under Pivot A did not notify the author'; end if;
  if exists(select 1 from public.chat_threads where companion_id='30000000-0000-4000-8000-000000000002') then
    raise exception 'a companion thread was created under Pivot A';
  end if;

  select id into thread from public.chat_threads
  where user_one_id='c1c1c1c1-1111-4111-8111-c1c1c1c1c1c1' and companion_id='30000000-0000-4000-8000-000000000001';
  select id into unanswered from public.chat_messages where client_request_id='e0000000-0000-4000-8000-000000000002';

  begin
    perform public.create_beta_chat_message('c1c1c1c1-1111-4111-8111-c1c1c1c1c1c1', thread,
      'A new message under Pivot A.', 'e0000000-0000-4000-8000-000000000003', 100);
  exception when others then get stacked diagnostics state = returned_sqlstate, msg = message_text;
  end;
  if state is distinct from 'P0001' or msg is distinct from 'feature disabled' then
    raise exception 'a user message into a companion thread under Pivot A: got % %', state, msg;
  end if;

  state := null; msg := null;
  begin
    perform public.create_companion_chat_reply(thread, '30000000-0000-4000-8000-000000000001', unanswered,
      'An AI reply under Pivot A.');
  exception when others then get stacked diagnostics state = returned_sqlstate, msg = message_text;
  end;
  if state is distinct from 'P0001' or msg is distinct from 'feature disabled' then
    raise exception 'an AI reply into a companion thread under Pivot A: got % %', state, msg;
  end if;

  state := null; msg := null;
  begin
    insert into public.chat_messages(thread_id, sender_companion_id, content, is_ai_generated)
    values (thread, '30000000-0000-4000-8000-000000000001', 'A direct AI message under Pivot A.', true);
  exception when others then get stacked diagnostics state = returned_sqlstate, msg = message_text;
  end;
  if state is distinct from 'P0001' or msg is distinct from 'feature disabled' then
    raise exception 'a direct message into a companion thread under Pivot A: got % %', state, msg;
  end if;

  if (select count(*) from public.chat_messages where thread_id=thread) <> 3 then
    raise exception 'a companion thread gained messages under Pivot A';
  end if;

  select id into human_thread from public.chat_threads
  where user_one_id=least('c1c1c1c1-1111-4111-8111-c1c1c1c1c1c1'::uuid,'d2d2d2d2-1111-4111-8111-d2d2d2d2d2d2'::uuid)
    and user_two_id=greatest('c1c1c1c1-1111-4111-8111-c1c1c1c1c1c1'::uuid,'d2d2d2d2-1111-4111-8111-d2d2d2d2d2d2'::uuid);
  if human_thread is null then raise exception 'a human-to-human thread was blocked under Pivot A'; end if;
  sent := public.create_beta_chat_message('c1c1c1c1-1111-4111-8111-c1c1c1c1c1c1', human_thread,
    'Human chat still works under Pivot A.', 'e0000000-0000-4000-8000-000000000004', 100);
  if sent.id is null then raise exception 'a human-to-human message was blocked under Pivot A'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Pivot off, but persona_autopost.enabled explicitly false: posts are skipped,
-- persona replies (gated on Pivot A only) and chat keep working.
-- ---------------------------------------------------------------------------

update public.app_feature_flags set enabled=false where key='pivot_a.enabled';
insert into public.app_feature_flags(key, enabled) values ('persona_autopost.enabled', false);

do $$
declare scheduled integer; skipped uuid; ai_reply uuid; state text; msg text;
begin
  scheduled := public.schedule_companion_posts('2099-02-03'::date);
  if scheduled <> 0 or exists(select 1 from public.social_posts where source_key like 'daily-completion:%:2099-02-03%') then
    raise exception 'schedule_companion_posts created persona posts with persona_autopost off';
  end if;

  insert into public.social_posts(companion_id, kind, visibility, content, source_key, is_ai_generated)
  values ('30000000-0000-4000-8000-000000000001','ai_progress','public','Guard test: persona post with autopost off.','guard-test:autopost-off',true)
  returning id into skipped;
  if skipped is not null or exists(select 1 from public.social_posts where source_key='guard-test:autopost-off') then
    raise exception 'a direct AI post insert was not skipped with persona_autopost off';
  end if;

  insert into public.social_replies(post_id, companion_id, content, is_ai_generated)
  values ((select id from public.social_posts where source_key='guard-test:defaults'),
    '30000000-0000-4000-8000-000000000002','Guard test: persona reply with autopost off.',true)
  returning id into ai_reply;
  if ai_reply is null then raise exception 'an AI reply was skipped with only persona_autopost off'; end if;

  -- persona_chat.enabled off without Pivot A also blocks persona chat.
  insert into public.app_feature_flags(key, enabled) values ('persona_chat.enabled', false);
  begin
    insert into public.chat_threads(user_one_id, companion_id, created_by)
    values ('d2d2d2d2-1111-4111-8111-d2d2d2d2d2d2','30000000-0000-4000-8000-000000000001','d2d2d2d2-1111-4111-8111-d2d2d2d2d2d2');
  exception when others then get stacked diagnostics state = returned_sqlstate, msg = message_text;
  end;
  if state is distinct from 'P0001' or msg is distinct from 'feature disabled' then
    raise exception 'a companion thread with persona_chat off: got % %', state, msg;
  end if;
end $$;

select extensions.pass('persona guards leave defaults unchanged and stop persona writes under Pivot A');
select * from extensions.finish();

rollback;
