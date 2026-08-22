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
    'chat_threads','chat_messages','user_follows','user_companion_relationships','social_reposts','companion_user_memory',
    'feedback_submissions'
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
    'chat_threads','chat_messages','user_follows','user_companion_relationships','social_reposts','companion_user_memory',
    'feedback_submissions'
  ) and not c.relrowsecurity;
  if unprotected is not null then raise exception 'RLS disabled on: %', unprotected; end if;
end $$;

do $$
begin
  if (select array_agg(e.enumlabel::text order by e.enumsortorder)
      from pg_enum e join pg_type t on t.oid=e.enumtypid join pg_namespace n on n.oid=t.typnamespace
      where n.nspname='public' and t.typname='feedback_type')
      is distinct from array['idea','issue','other']::text[]
  then raise exception 'feedback type enum does not match the API contract'; end if;
  if not exists(
    select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid join pg_namespace n on n.oid=t.typnamespace
    where n.nspname='public' and t.typname='post_kind' and e.enumlabel='human_quote'
  ) then raise exception 'quote repost post kind is missing'; end if;
  if not exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='social_posts' and column_name='quoted_post_id' and data_type='uuid'
  ) then raise exception 'quote repost reference is missing'; end if;
  if not exists(
    select 1 from pg_constraint
    where conname='social_posts_quoted_post_id_fkey'
      and conrelid='public.social_posts'::regclass
      and confrelid='public.social_posts'::regclass
      and contype='f'
      and conkey=array[(select attnum from pg_attribute where attrelid='public.social_posts'::regclass and attname='quoted_post_id')]::smallint[]
      and confkey=array[(select attnum from pg_attribute where attrelid='public.social_posts'::regclass and attname='id')]::smallint[]
      and confdeltype='n'
  ) then raise exception 'quote repost self-relationship is missing'; end if;
  if has_table_privilege('authenticated','public.social_posts','INSERT') then raise exception 'authenticated can bypass post publishing RPC'; end if;
  if not has_table_privilege('authenticated','public.tasks','SELECT') then raise exception 'authenticated cannot read own tasks through RLS'; end if;
  if not has_table_privilege('authenticated','public.social_posts','SELECT') then raise exception 'authenticated cannot read visible posts through RLS'; end if;
  if not has_column_privilege('authenticated','public.social_posts','visibility','UPDATE') then raise exception 'post owners cannot change audience'; end if;
  if has_column_privilege('authenticated','public.social_posts','content','UPDATE') then raise exception 'authenticated can rewrite published post content directly'; end if;
  if has_table_privilege('authenticated','public.ai_jobs','SELECT') then raise exception 'authenticated can read privileged jobs'; end if;
  if has_table_privilege('authenticated','public.social_ai_engagements','SELECT') then raise exception 'authenticated can read internal AI fallback rows'; end if;
  if has_table_privilege('authenticated','public.user_companion_relationships','INSERT') then raise exception 'authenticated can bypass relationship RPCs'; end if;
  if has_table_privilege('authenticated','public.user_follows','INSERT') then raise exception 'authenticated can forge human follow identity'; end if;
  if not has_table_privilege('authenticated','public.user_follows','SELECT') then raise exception 'authenticated cannot read their own human follow edges through RLS'; end if;
  if not has_function_privilege('authenticated','public.set_user_follow(uuid,boolean)','EXECUTE') then raise exception 'authenticated cannot follow public profiles'; end if;
  if not has_function_privilege('authenticated','public.get_profile_follow_summary(uuid)','EXECUTE') then raise exception 'authenticated cannot read profile follow summaries'; end if;
  if not has_function_privilege('authenticated','public.get_following_post_ids(text,timestamp with time zone,uuid,integer)','EXECUTE') then raise exception 'authenticated cannot resolve their Following feed'; end if;
  if has_function_privilege('anon','public.set_user_follow(uuid,boolean)','EXECUTE') then raise exception 'anonymous users can mutate human follows'; end if;
  if has_function_privilege('anon','public.get_following_post_ids(text,timestamp with time zone,uuid,integer)','EXECUTE') then raise exception 'anonymous users can query relationship feeds'; end if;
  if has_table_privilege('authenticated','public.social_reposts','INSERT') then raise exception 'authenticated can forge repost identity'; end if;
  if has_table_privilege('authenticated','public.companion_user_memory','INSERT') then raise exception 'authenticated can write companion memory'; end if;
  if has_table_privilege('authenticated','public.companion_user_memory','DELETE') then raise exception 'authenticated can bypass the durable memory reset barrier'; end if;
  if not has_table_privilege('authenticated','public.companion_user_memory','SELECT') then raise exception 'authenticated cannot read own companion memory through RLS'; end if;
  if not has_function_privilege('authenticated','public.can_read_social_companion(uuid)','EXECUTE') then raise exception 'authenticated cannot resolve readable companion identities'; end if;
  if has_function_privilege('authenticated','public.check_rate_limit(text,integer,integer,text)','EXECUTE') then raise exception 'authenticated can bypass rate limits'; end if;
  if not has_function_privilege('service_role','public.check_rate_limit(text,integer,integer,text)','EXECUTE') then raise exception 'service role cannot enforce API rate limits'; end if;
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
  if has_function_privilege('authenticated','public.finalize_social_action(uuid,uuid,text)','EXECUTE') then raise exception 'authenticated can finalize persona jobs'; end if;
  if not has_function_privilege('service_role','public.finalize_social_action(uuid,uuid,text)','EXECUTE') then raise exception 'service role cannot finalize persona jobs'; end if;
  if has_function_privilege('authenticated','public.request_companion_follow(uuid,uuid)','EXECUTE') then raise exception 'authenticated can forge persona follow requests'; end if;
  if has_function_privilege('anon','public.request_companion_follow(uuid,uuid)','EXECUTE') then raise exception 'anonymous users can forge persona follow requests'; end if;
  if not has_function_privilege('service_role','public.request_companion_follow(uuid,uuid)','EXECUTE') then raise exception 'service role cannot create consented persona follow requests'; end if;
  if has_function_privilege('authenticated','public.guard_companion_follow_transition()','EXECUTE') then raise exception 'authenticated can invoke the companion follow transition guard'; end if;
  if not has_function_privilege('authenticated','public.get_profile_ai_follower_count(uuid)','EXECUTE') then raise exception 'authenticated cannot read visible AI follower counts'; end if;
  if has_function_privilege('anon','public.get_profile_ai_follower_count(uuid)','EXECUTE') then raise exception 'anonymous users can query AI follower counts'; end if;
  if not has_function_privilege('authenticated','public.set_human_repost(uuid,boolean)','EXECUTE') then raise exception 'authenticated cannot use repost RPC'; end if;
  if not has_function_privilege('authenticated','public.publish_quote_repost(uuid,text,public.post_visibility,text)','EXECUTE') then raise exception 'authenticated cannot publish quote reposts'; end if;
  if has_function_privilege('anon','public.publish_quote_repost(uuid,text,public.post_visibility,text)','EXECUTE') then raise exception 'anonymous users can publish quote reposts'; end if;
  if exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
      lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    where n.nspname='public' and p.proname='publish_quote_repost'
      and pg_get_function_identity_arguments(p.oid)='p_post_id uuid, p_content text, p_visibility post_visibility, p_idempotency_key text'
      and acl.grantee=0 and acl.privilege_type='EXECUTE'
  ) then raise exception 'PUBLIC can publish quote reposts'; end if;
  if not exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='quoted_post'
      and p.pronargs=1 and p.proargtypes[0]='public.social_posts'::regtype
      and p.prorettype='public.social_posts'::regtype and p.proretset
      and p.prorows=1 and p.provolatile='s' and not p.prosecdef
  ) then raise exception 'RLS-aware quote computed relationship is missing'; end if;
  if not has_function_privilege('authenticated','public.quoted_post(public.social_posts)','EXECUTE') then raise exception 'authenticated cannot resolve visible quote sources'; end if;
  if has_function_privilege('anon','public.quoted_post(public.social_posts)','EXECUTE') then raise exception 'anonymous users can resolve quote sources'; end if;
  if exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
      lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    where n.nspname='public' and p.proname='quoted_post'
      and p.pronargs=1 and p.proargtypes[0]='public.social_posts'::regtype
      and acl.grantee=0 and acl.privilege_type='EXECUTE'
  ) then raise exception 'PUBLIC can resolve quote sources'; end if;
  if not has_function_privilege('authenticated','public.reset_companion_memory(uuid)','EXECUTE') then raise exception 'authenticated cannot reset companion memory'; end if;
  if has_function_privilege('authenticated','public.refresh_companion_memory(uuid,uuid,text,jsonb,uuid,timestamp with time zone,integer,timestamp with time zone)','EXECUTE') then raise exception 'authenticated can forge companion memory refreshes'; end if;
  if not has_function_privilege('service_role','public.refresh_companion_memory(uuid,uuid,text,jsonb,uuid,timestamp with time zone,integer,timestamp with time zone)','EXECUTE') then raise exception 'service role cannot refresh companion memory'; end if;
  if has_function_privilege('authenticated','public.start_companion_dm(uuid,uuid,text)','EXECUTE') then raise exception 'authenticated can forge persona-started DMs'; end if;
  if has_table_privilege('authenticated','public.content_reports','INSERT') then raise exception 'authenticated can forge report identity directly'; end if;
  if has_table_privilege('authenticated','public.feedback_submissions','SELECT')
    or has_table_privilege('authenticated','public.feedback_submissions','INSERT')
    or has_table_privilege('authenticated','public.feedback_submissions','UPDATE')
    or has_table_privilege('authenticated','public.feedback_submissions','DELETE')
  then raise exception 'authenticated can access feedback submissions directly'; end if;
  if exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
      lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    where n.nspname='public' and p.proname='submit_feedback' and acl.grantee=0 and acl.privilege_type='EXECUTE'
  ) then raise exception 'PUBLIC can submit feedback'; end if;
  if has_function_privilege('anon','public.submit_feedback(public.feedback_type,text)','EXECUTE') then raise exception 'anonymous users can submit feedback'; end if;
  if not has_function_privilege('authenticated','public.submit_feedback(public.feedback_type,text)','EXECUTE') then raise exception 'authenticated users cannot submit feedback'; end if;
  if not has_function_privilege('service_role','public.submit_feedback(public.feedback_type,text)','EXECUTE') then raise exception 'service role cannot submit feedback'; end if;
  if has_table_privilege('authenticated','public.blocked_users','INSERT') then raise exception 'authenticated can forge block identity directly'; end if;
end $$;

do $$
declare scheduled integer;
begin
  scheduled := public.reconcile_persona_engagements('2099-01-16'::date);
  if scheduled <= 0 then raise exception 'persona reconciler did not create daily actions'; end if;
  if public.reconcile_persona_engagements('2099-01-16'::date) <> 0 then
    raise exception 'persona engagement reconciliation is not idempotent';
  end if;
  update public.ai_jobs job set status='cancelled',attempts=max_attempts,last_error='terminal test failure'
  from public.social_ai_engagements engagement
  where engagement.source='daily_quota' and engagement.kind='reply'
    and engagement.scheduled_for>='2099-01-16'::timestamptz and engagement.scheduled_for<'2099-01-17'::timestamptz
    and job.dedupe_key='social-action:'||engagement.dedupe_key
    and job.id=(select candidate.id from public.ai_jobs candidate
      join public.social_ai_engagements action on candidate.dedupe_key='social-action:'||action.dedupe_key
      where action.source='daily_quota' and action.kind='reply'
        and action.scheduled_for>='2099-01-16'::timestamptz and action.scheduled_for<'2099-01-17'::timestamptz
      order by candidate.id limit 1);
  if public.reconcile_persona_engagements('2099-01-16'::date) <> 1 then
    raise exception 'persona engagement reconciliation did not revive one terminal eligible job';
  end if;
  if not exists(
    select 1 from public.ai_jobs job join public.social_ai_engagements engagement
      on job.dedupe_key='social-action:'||engagement.dedupe_key
    where engagement.source='daily_quota' and engagement.kind='reply'
      and engagement.scheduled_for>='2099-01-16'::timestamptz and engagement.scheduled_for<'2099-01-17'::timestamptz
      and job.status='pending' and job.attempts=0 and engagement.state='planned'
  ) then raise exception 'revived social action did not return to a clean planned state'; end if;
  if exists(
    select 1 from public.social_companions c
    where c.active and (
      select count(*) from public.social_ai_engagements e
      where e.companion_id=c.id and e.source='daily_quota' and e.kind='reply'
        and e.scheduled_for>='2099-01-16'::timestamptz and e.scheduled_for<'2099-01-17'::timestamptz
    ) <> 3
  ) then raise exception 'reconciler did not ensure three daily replies per active persona'; end if;
  if exists(
    select 1 from public.social_companions c
    where c.active and (
      select count(distinct p.companion_id)
      from public.social_ai_engagements e join public.social_posts p on p.id=e.post_id
      where e.companion_id=c.id and e.source='daily_quota' and e.kind='reply'
        and e.scheduled_for>='2099-01-16'::timestamptz and e.scheduled_for<'2099-01-17'::timestamptz
    ) < 2
  ) then raise exception 'daily replies did not target two distinct persona authors'; end if;
  if exists(
    select 1 from public.social_companions c where c.active and (
      select count(*) from public.social_ai_engagements e
      where e.companion_id=c.id and e.source='daily_quota' and e.kind in ('reaction','repost')
        and e.scheduled_for>='2099-01-16'::timestamptz and e.scheduled_for<'2099-01-17'::timestamptz
    ) <> 2
  ) then raise exception 'daily like/repost cap is not one of each per persona'; end if;
end $$;

do $$
begin
  if exists(select 1 from public.social_companions where active and posting_frequency < 3) then
    raise exception 'an active persona can fall below the three-post daily minimum';
  end if;
  if not exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='companion_user_memory' and column_name='reset_at'
      and data_type='timestamp with time zone'
  ) then raise exception 'companion memory is missing its reset barrier'; end if;
  if not exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='tasks' and column_name='priority'
      and data_type='smallint' and is_nullable='YES' and column_default is null
  ) then raise exception 'tasks are missing the optional priority field'; end if;
  if not has_column_privilege('authenticated','public.tasks','priority','INSERT') then raise exception 'authenticated cannot set task priority on creation'; end if;
  if not has_column_privilege('authenticated','public.tasks','priority','UPDATE') then raise exception 'authenticated cannot change task priority'; end if;
  if not exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='tasks' and column_name='due_has_time'
      and data_type='boolean' and is_nullable='NO' and column_default like 'false%'
  ) then raise exception 'tasks are missing deadline-time precision metadata'; end if;
  if not exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='tasks' and column_name='due_timezone'
      and data_type='text' and is_nullable='YES'
  ) then raise exception 'tasks are missing deadline time zones'; end if;
  if not exists(
    select 1 from pg_constraint
    where conrelid='public.tasks'::regclass and conname='tasks_deadline_metadata_consistent'
      and pg_get_constraintdef(oid) ~ 'NOT due_has_time.*due_timezone IS NULL'
      and pg_get_constraintdef(oid) ~ 'due_has_time.*due_at IS NOT NULL.*due_timezone IS NOT NULL'
      and pg_get_constraintdef(oid) ~ 'timezone\(due_timezone, due_at\) IS NOT NULL'
  ) then raise exception 'task deadline metadata is not constrained to a valid date/time-zone pair'; end if;
  if not has_column_privilege('authenticated','public.tasks','due_has_time','INSERT') then raise exception 'authenticated cannot set task deadline-time precision on creation'; end if;
  if not has_column_privilege('authenticated','public.tasks','due_has_time','UPDATE') then raise exception 'authenticated cannot change task deadline-time precision'; end if;
  if not has_column_privilege('authenticated','public.tasks','due_timezone','INSERT') then raise exception 'authenticated cannot set task deadline time zone on creation'; end if;
  if not has_column_privilege('authenticated','public.tasks','due_timezone','UPDATE') then raise exception 'authenticated cannot change task deadline time zone'; end if;
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
  if not exists(select 1 from pg_indexes where schemaname='public' and indexname='user_follows_followed_idx') then raise exception 'missing human follower count index'; end if;
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
