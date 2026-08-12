begin;

create extension if not exists pgtap with schema extensions;
select plan(1);

do $$
declare missing text;
begin
  select string_agg(expected, ', ') into missing
  from unnest(array[
    'user_profiles','tasks','public_task_progress','social_posts','social_replies','social_reactions',
    'social_companions','social_ai_engagements','ai_jobs','notifications','notification_preferences',
    'content_reports','blocked_users','muted_companions','account_deletion_requests','task_completion_awards'
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
    'content_reports','blocked_users','muted_companions','account_deletion_requests','task_completion_awards'
  ) and not c.relrowsecurity;
  if unprotected is not null then raise exception 'RLS disabled on: %', unprotected; end if;
end $$;

do $$
begin
  if has_table_privilege('authenticated','public.social_posts','INSERT') then raise exception 'authenticated can bypass post publishing RPC'; end if;
  if not has_table_privilege('authenticated','public.tasks','SELECT') then raise exception 'authenticated cannot read own tasks through RLS'; end if;
  if not has_table_privilege('authenticated','public.social_posts','SELECT') then raise exception 'authenticated cannot read visible posts through RLS'; end if;
  if has_table_privilege('authenticated','public.ai_jobs','SELECT') then raise exception 'authenticated can read privileged jobs'; end if;
  if has_table_privilege('authenticated','public.social_ai_engagements','SELECT') then raise exception 'authenticated can read internal AI fallback rows'; end if;
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
  if not exists(select 1 from pg_indexes where schemaname='public' and indexname='social_posts_human_idempotency_key') then raise exception 'missing human post idempotency index'; end if;
  if not exists(select 1 from pg_indexes where schemaname='public' and indexname='social_posts_companion_source_key') then raise exception 'missing scheduled post idempotency index'; end if;
  if not exists(select 1 from pg_indexes where schemaname='public' and indexname='ai_jobs_claim_idx') then raise exception 'missing job claim index'; end if;
end $$;

select pass('schema, RLS, ACL, and index contracts hold');
select * from finish();

rollback;
