begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(1);

do $$
declare missing text;
begin
  select string_agg(expected, ', ') into missing
  from unnest(array[
    'user_profiles','tasks','public_task_progress','social_posts','social_replies','social_reactions',
    'social_companions','social_ai_engagements','ai_jobs','notifications','notification_preferences',
    'content_reports','blocked_users','muted_companions','account_deletion_requests','task_completion_awards',
    'chat_threads','chat_messages'
  ]) expected
  where to_regclass('public.' || expected) is null;
  if missing is not null then raise exception 'missing required tables: %', missing; end if;
end $$;

do $$
declare unprotected text;
begin
  select string_agg(c.relname, ', ') into unprotected
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r' and c.relname in (
    'user_profiles','tasks','public_task_progress','social_posts','social_replies','social_reactions',
    'social_companions','social_ai_engagements','ai_jobs','notifications','notification_preferences',
    'content_reports','blocked_users','muted_companions','account_deletion_requests','task_completion_awards',
    'chat_threads','chat_messages'
  ) and not c.relrowsecurity;
  if unprotected is not null then raise exception 'RLS disabled on: %', unprotected; end if;
end $$;

do $$
begin
  if has_table_privilege('authenticated','public.social_posts','INSERT') then raise exception 'authenticated can bypass post publishing RPC'; end if;
  if not has_table_privilege('authenticated','public.tasks','SELECT') then raise exception 'authenticated cannot read own tasks through RLS'; end if;
  if not has_table_privilege('authenticated','public.social_posts','SELECT') then raise exception 'authenticated cannot read visible posts through RLS'; end if;
  if not has_column_privilege('authenticated','public.social_posts','visibility','UPDATE') then raise exception 'post owners cannot change audience'; end if;
  if has_column_privilege('authenticated','public.social_posts','content','UPDATE') then raise exception 'authenticated can rewrite published post content directly'; end if;
  if has_table_privilege('authenticated','public.ai_jobs','SELECT') then raise exception 'authenticated can read privileged jobs'; end if;
  if has_table_privilege('authenticated','public.social_ai_engagements','SELECT') then raise exception 'authenticated can read internal AI fallback rows'; end if;
  if not has_function_privilege('authenticated','public.can_read_social_companion(uuid)','EXECUTE') then raise exception 'authenticated cannot resolve readable companion identities'; end if;
  if has_function_privilege('authenticated','public.check_rate_limit(text,integer,integer,text)','EXECUTE') then raise exception 'authenticated can bypass rate limits'; end if;
  if exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
      lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    where n.nspname='public' and p.proname='publish_task_completion' and acl.grantee=0 and acl.privilege_type='EXECUTE'
  ) then raise exception 'PUBLIC can execute privileged publisher'; end if;
  if not has_function_privilege('authenticated','public.publish_task_completion(uuid,text,public.post_visibility,text)','EXECUTE') then raise exception 'authenticated cannot execute publisher'; end if;
  if exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
      lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    where n.nspname='public' and p.proname='report_content' and acl.grantee=0 and acl.privilege_type='EXECUTE'
  ) then raise exception 'PUBLIC can execute reporting RPC'; end if;
  if exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
      lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    where n.nspname='public' and p.proname='finalize_ai_reply_job' and acl.grantee=0 and acl.privilege_type='EXECUTE'
  ) then raise exception 'PUBLIC can finalize AI jobs'; end if;
  if has_function_privilege('authenticated','public.finalize_ai_reply_job(uuid,uuid,text)','EXECUTE') then raise exception 'authenticated can finalize AI jobs'; end if;
  if not has_function_privilege('service_role','public.finalize_ai_reply_job(uuid,uuid,text)','EXECUTE') then raise exception 'service role cannot finalize AI jobs'; end if;
  if has_table_privilege('authenticated','public.content_reports','INSERT') then raise exception 'authenticated can forge report identity directly'; end if;
  if has_table_privilege('authenticated','public.blocked_users','INSERT') then raise exception 'authenticated can forge block identity directly'; end if;
end $$;

do $$
begin
  if not exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='tasks' and column_name='priority'
      and data_type='smallint' and is_nullable='NO' and column_default='4'
  ) then raise exception 'tasks are missing the required priority field'; end if;
  if not has_column_privilege('authenticated','public.tasks','priority','INSERT') then raise exception 'authenticated cannot set task priority on creation'; end if;
  if not has_column_privilege('authenticated','public.tasks','priority','UPDATE') then raise exception 'authenticated cannot change task priority'; end if;
  if not exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='social_posts' and column_name='image_paths'
  ) then raise exception 'social_posts is missing private media paths'; end if;
  if not exists(
    select 1 from storage.buckets
    where id='completion-post-media'
      and public=false
      and file_size_limit=5242880
      and allowed_mime_types @> array['image/jpeg','image/png','image/webp']
  ) then raise exception 'completion post media bucket is missing or unsafe'; end if;
end $$;

do $$
begin
  if not exists(select 1 from pg_indexes where schemaname='public' and indexname='social_posts_human_idempotency_key') then raise exception 'missing human post idempotency index'; end if;
  if not exists(select 1 from pg_indexes where schemaname='public' and indexname='social_posts_companion_source_key') then raise exception 'missing scheduled post idempotency index'; end if;
  if not exists(select 1 from pg_indexes where schemaname='public' and indexname='social_reactions_actor_created_idx') then raise exception 'missing profile likes index'; end if;
  if not exists(select 1 from pg_indexes where schemaname='public' and indexname='social_replies_author_created_idx') then raise exception 'missing profile replies index'; end if;
  if not exists(select 1 from pg_indexes where schemaname='public' and indexname='ai_jobs_claim_idx') then raise exception 'missing job claim index'; end if;
  if has_function_privilege('authenticated', 'public.apply_companion_post_catalog()', 'EXECUTE') then
    raise exception 'authenticated users must not execute the internal companion catalog helper';
  end if;
end $$;

do $$
declare
  scheduled integer;
  expected integer;
begin
  select coalesce(sum(posting_frequency), 0)::integer into expected
  from public.social_companions
  where active and posting_frequency > 0;

  if exists(
    select 1
    from public.social_companions companion
    where companion.active and companion.posting_frequency > 0
      and (
        select count(*) <> companion.posting_frequency
          or count(distinct post.task_title) <> companion.posting_frequency
          or count(distinct post.created_at) <> companion.posting_frequency
        from public.social_posts post
        where post.companion_id = companion.id
          and post.source_key like 'daily-completion:%:' || current_date::text || '%'
      )
  ) then raise exception 'migration-day companion slots are missing or repetitive'; end if;

  select public.schedule_companion_posts('2099-01-15'::date) into scheduled;

  if exists(select 1 from public.social_companions where active and posting_frequency not between 3 and 12) then
    raise exception 'active companions must schedule at least three daily posts';
  end if;
  if expected < 60 or scheduled <> expected then
    raise exception 'expected each active companion to reach its daily cadence, got % of %', scheduled, expected;
  end if;
  if exists(
    select 1
    from public.social_companions companion
    where companion.active and companion.posting_frequency > 0
      and (
        select count(*)
        from public.social_posts post
        where post.companion_id=companion.id
          and post.source_key like 'daily-completion:%:2099-01-15%'
      ) <> companion.posting_frequency
  ) then raise exception 'a companion did not receive its configured daily post count'; end if;
  if exists(
    select 1
    from public.social_posts
    where source_key like 'daily-completion:%:2099-01-15%'
    group by companion_id
    having count(distinct task_title) <> count(*) or count(distinct created_at) <> count(*)
  ) then raise exception 'daily companion tasks and times must be distinct'; end if;
  if exists(
    select 1 from public.social_posts
    where kind = 'ai_completion'
      and task_title ~* '^complete today(''|’)s .+ task$'
  ) then raise exception 'scheduled companion posts must use concrete task titles'; end if;
  if exists(
    select 1 from public.social_posts
    where source_key like 'daily-completion:%:2099-01-15%'
      and (content is null or btrim(content)='' or content=task_title)
  ) then raise exception 'scheduled companion posts must pair tasks with reactions'; end if;
  if exists(
    select 1 from public.social_companions
    where active and posting_frequency > 0
      and (jsonb_typeof(daily_posts) <> 'array' or jsonb_array_length(daily_posts) < posting_frequency)
  ) then raise exception 'active companion daily post catalogs cannot satisfy cadence'; end if;
  if exists(
    select 1 from public.social_companions companion
    cross join lateral jsonb_array_elements(companion.daily_posts) post
    where companion.active and posting_frequency > 0
      and not (
        post ? 'task_title' and post ? 'category' and post ? 'content'
        and length(btrim(post->>'task_title')) > 0
        and length(btrim(post->>'category')) > 0
        and length(btrim(post->>'content')) > 0
      )
  ) then raise exception 'daily post catalog entries are incomplete'; end if;
  if exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='social_companions' and column_name='daily_posts'
      and data_type <> 'jsonb'
  ) or not exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='social_companions' and column_name='daily_posts'
  ) then raise exception 'social companions are missing the structured daily post catalog'; end if;
  if exists(
    select 1 from public.social_posts
    where source_key like 'daily-completion:%:2099-01-15%'
      and source_key !~ '^daily-completion:[0-9a-f-]+:2099-01-15(:[2-9]|:1[0-2])?$'
  ) then raise exception 'scheduled companion source keys are not slot-aware'; end if;
  if exists(
    select 1 from public.social_posts
    where source_key like 'daily-completion:%:2099-01-15%'
      and (kind <> 'ai_completion' or completed_at is null or task_title is null)
  ) then raise exception 'scheduled companion posts must be complete task records'; end if;
  if exists(
    select 1 from public.social_posts
    where source_key like 'daily-completion:%:2099-01-15%'
      and (created_at < '2099-01-15 06:00:00+00' or created_at >= '2099-01-15 23:00:00+00')
  ) then raise exception 'scheduled companion posts must stay inside the daily time window'; end if;
  if public.schedule_companion_posts('2099-01-15'::date) <> 0 then
    raise exception 'daily companion scheduling must be idempotent';
  end if;
end $$;

do $$
begin
  if exists(
    select 1 from public.social_posts
    where source_key like 'starter-completion:%'
  ) then raise exception 'a new community must not manufacture an all-AI starter feed'; end if;
end $$;

select extensions.pass('schema, RLS, ACL, and index contracts hold');
select * from extensions.finish();

rollback;
