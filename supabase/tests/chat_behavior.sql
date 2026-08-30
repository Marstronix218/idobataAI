begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(1);

insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','authenticated','authenticated','chat-a@example.test',crypt('test-password',gen_salt('bf')),now(),'{}','{"username":"chat_a"}',now(),now()),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','authenticated','authenticated','chat-b@example.test',crypt('test-password',gen_salt('bf')),now(),'{}','{"username":"chat_b"}',now(),now()),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','authenticated','authenticated','chat-c@example.test',crypt('test-password',gen_salt('bf')),now(),'{}','{"username":"chat_c"}',now(),now());

insert into public.social_companions(id,slug,name,personality,writing_style,interests,safety_instructions,fallback_replies,daily_templates,posting_frequency,daily_posts)
values(
  '20000000-0000-4000-8000-000000000001','chat-guide','Chat Guide','Calm and practical.','Brief.','{}','Stay safe.',
  array['A safe fallback.'],array['A daily note.'],3,
  '[{"task_title":"Chat A","category":"Test","content":"Chat A"},{"task_title":"Chat B","category":"Test","content":"Chat B"},{"task_title":"Chat C","category":"Test","content":"Chat C"}]'::jsonb
)
on conflict (id) do nothing;

set local role authenticated;
set local "request.jwt.claim.sub" = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

select public.get_or_create_chat_thread('dddddddd-dddd-4ddd-8ddd-dddddddddddd', null);
select public.get_or_create_chat_thread('dddddddd-dddd-4ddd-8ddd-dddddddddddd', null);
select public.get_or_create_chat_thread(null, '20000000-0000-4000-8000-000000000001');

reset role;
do $$
declare human_thread uuid; ai_thread uuid; ai_message public.chat_messages;
begin
  select id into human_thread from public.chat_threads where user_two_id is not null;
  select id into ai_thread from public.chat_threads where companion_id is not null;
  perform public.create_beta_chat_message(
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc', human_thread, 'A private hello.',
    '10000000-0000-4000-8000-000000000001', 100
  );
  ai_message := public.create_beta_chat_message(
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc', ai_thread, 'Hello, AI profile.',
    '10000000-0000-4000-8000-000000000002', 100
  );
  perform public.create_beta_chat_message(
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc', ai_thread, 'Hello, AI profile.',
    '10000000-0000-4000-8000-000000000002', 100
  );
  perform public.create_companion_chat_reply(
    ai_thread, '20000000-0000-4000-8000-000000000001', ai_message.id,
    'A clearly labeled AI reply.'
  );
  perform public.create_companion_chat_reply(
    ai_thread, '20000000-0000-4000-8000-000000000001', ai_message.id,
    'A duplicate generation that must not be inserted.'
  );

  begin
    perform public.create_beta_chat_message(
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc', ai_thread, 'This exceeds a one-message daily limit.',
      '10000000-0000-4000-8000-000000000003', 1
    );
    raise exception 'daily AI chat limit was not enforced';
  exception when others then
    if sqlerrm <> 'daily AI chat limit exceeded' then raise; end if;
  end;
end $$;

do $$ begin
  if (select count(*) from public.chat_threads where user_two_id is not null) <> 1 then
    raise exception 'human chat thread creation was not idempotent';
  end if;
  if (select count(*) from public.chat_messages) <> 3 then
    raise exception 'expected two human messages and one AI message';
  end if;
  if not exists(select 1 from public.chat_messages where is_ai_generated and sender_companion_id is not null) then
    raise exception 'AI chat identity was not preserved';
  end if;
  if has_table_privilege('authenticated', 'public.chat_threads', 'INSERT')
    or has_table_privilege('authenticated', 'public.chat_messages', 'INSERT') then
    raise exception 'authenticated users can bypass chat RPCs';
  end if;
  if has_function_privilege('authenticated', 'public.create_chat_message(uuid,text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.create_beta_chat_message(uuid,uuid,text,uuid,integer)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.create_companion_chat_reply(uuid,uuid,uuid,text)', 'EXECUTE') then
    raise exception 'authenticated users can forge AI chat messages';
  end if;
  if not has_function_privilege('service_role', 'public.create_beta_chat_message(uuid,uuid,text,uuid,integer)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.create_companion_chat_reply(uuid,uuid,uuid,text)', 'EXECUTE') then
    raise exception 'service role cannot create reliable chat messages';
  end if;
  if (select count(*) from public.chat_messages where client_request_id = '10000000-0000-4000-8000-000000000002') <> 1 then
    raise exception 'client request id did not deduplicate the user message';
  end if;
  if (select count(*) from public.chat_messages where reply_to_message_id is not null) <> 1 then
    raise exception 'user message did not deduplicate the AI reply';
  end if;
end $$;

set local role authenticated;
set local "request.jwt.claim.sub" = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
do $$ begin
  if exists(select 1 from public.chat_threads) then raise exception 'non-participant can read chat threads'; end if;
  if exists(select 1 from public.chat_messages) then raise exception 'non-participant can read chat messages'; end if;
end $$;

select extensions.pass('private human and AI chat contracts hold');
select * from extensions.finish();

rollback;
