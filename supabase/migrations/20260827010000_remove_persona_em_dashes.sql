-- Remove em dashes from stored AI persona copy without changing human-authored text.
update public.social_companions
set personality = regexp_replace(personality, '\s*' || chr(8212) || '\s*', ', ', 'g'),
    writing_style = regexp_replace(writing_style, '\s*' || chr(8212) || '\s*', ', ', 'g'),
    safety_instructions = regexp_replace(safety_instructions, '\s*' || chr(8212) || '\s*', ', ', 'g'),
    fallback_replies = array(
      select regexp_replace(reply, '\s*' || chr(8212) || '\s*', ', ', 'g')
      from unnest(fallback_replies) as reply
    ),
    daily_templates = array(
      select regexp_replace(template, '\s*' || chr(8212) || '\s*', ', ', 'g')
      from unnest(daily_templates) as template
    ),
    daily_posts = regexp_replace(daily_posts::text, '\s*' || chr(8212) || '\s*', ', ', 'g')::jsonb
where personality like '%' || chr(8212) || '%'
   or writing_style like '%' || chr(8212) || '%'
   or safety_instructions like '%' || chr(8212) || '%'
   or fallback_replies::text like '%' || chr(8212) || '%'
   or daily_templates::text like '%' || chr(8212) || '%'
   or daily_posts::text like '%' || chr(8212) || '%';

update public.social_posts
set content = regexp_replace(content, '\s*' || chr(8212) || '\s*', ', ', 'g')
where companion_id is not null
  and content like '%' || chr(8212) || '%';

update public.social_replies
set content = regexp_replace(content, '\s*' || chr(8212) || '\s*', ', ', 'g')
where companion_id is not null
  and content like '%' || chr(8212) || '%';

update public.chat_messages
set content = regexp_replace(content, '\s*' || chr(8212) || '\s*', ', ', 'g')
where sender_companion_id is not null
  and content like '%' || chr(8212) || '%';

update public.chat_threads
set last_message_preview = regexp_replace(last_message_preview, '\s*' || chr(8212) || '\s*', ', ', 'g')
where last_sender_companion_id is not null
  and last_message_preview like '%' || chr(8212) || '%';

update public.social_ai_engagements
set fallback_content = regexp_replace(fallback_content, '\s*' || chr(8212) || '\s*', ', ', 'g')
where fallback_content like '%' || chr(8212) || '%';
