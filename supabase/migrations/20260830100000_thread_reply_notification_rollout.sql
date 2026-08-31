-- The thread conversation migration can reach the database before the bundle
-- that understands it reaches the browser, and a notification kind an older
-- client has never seen renders as a broken row rather than a new one.
--
-- The kind is therefore held behind its own flag, seeded off. Nothing else in
-- the conversation feature is affected: the follow-up is still queued, still
-- answered, and the person answered is still notified, under the kind older
-- clients already render. Flip this flag on once the client that knows the new
-- kind is deployed, with no further migration:
--
--   update public.app_feature_flags set enabled = true where key = 'THREAD_REPLY_NOTIFICATIONS';

insert into public.app_feature_flags(key, enabled, description) values
  ('THREAD_REPLY_NOTIFICATIONS', false,
   'Notify a reply that was answered as ''thread_reply'' (reads as "replied to you") rather than as ''reply''. Requires a client that renders the kind.')
on conflict (key) do nothing;

create or replace function public.create_social_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
declare target_user uuid; parent_author uuid; answered_kind text; post_author_kind text;
begin
  select author_id into target_user from public.social_posts where id=new.post_id;
  if tg_table_name='social_replies' then
    if new.parent_reply_id is not null then
      select reply.author_id into parent_author
      from public.social_replies reply where reply.id=new.parent_reply_id;
    end if;
    answered_kind := case when public.feature_flag_enabled('THREAD_REPLY_NOTIFICATIONS') then 'thread_reply' else 'reply' end;
    -- Answering the post author's own reply is the conversation case even when
    -- they also own the post, so the kind is decided per recipient.
    post_author_kind := case when parent_author is not null and parent_author = target_user then answered_kind else 'reply' end;

    if target_user is not null and new.author_id is distinct from target_user
      and coalesce((select case when new.companion_id is not null then preferences.companion_activity else preferences.replies end from public.notification_preferences preferences where preferences.user_id=target_user),true) then
      insert into public.notifications(user_id,actor_id,companion_id,post_id,reply_id,kind)
      values(target_user,new.author_id,new.companion_id,new.post_id,new.id,post_author_kind);
    end if;

    if parent_author is not null
      and parent_author is distinct from target_user
      and parent_author is distinct from new.author_id
      and coalesce((select case when new.companion_id is not null then preferences.companion_activity else preferences.replies end from public.notification_preferences preferences where preferences.user_id=parent_author),true)
      and not exists(select 1 from public.notifications existing
        where existing.user_id=parent_author and existing.reply_id=new.id and existing.kind in ('reply','thread_reply'))
    then
      insert into public.notifications(user_id,actor_id,companion_id,post_id,reply_id,kind)
      values(parent_author,new.author_id,new.companion_id,new.post_id,new.id,answered_kind);
    end if;
  elsif tg_table_name='social_reactions' then
    if target_user is not null and new.actor_id is distinct from target_user
      and coalesce((select case when new.companion_id is not null then preferences.companion_activity else preferences.reactions end from public.notification_preferences preferences where preferences.user_id=target_user),true) then
      insert into public.notifications(user_id,actor_id,companion_id,post_id,kind)
      values(target_user,new.actor_id,new.companion_id,new.post_id,'reaction');
    end if;
  end if;
  return new;
end $$;

revoke all on function public.create_social_notification() from public, anon, authenticated;

notify pgrst, 'reload schema';
