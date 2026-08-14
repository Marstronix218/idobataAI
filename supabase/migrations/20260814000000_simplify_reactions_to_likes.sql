do $$
begin
  if exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'reaction_kind'
      and e.enumlabel <> 'like'
  ) then
    drop function public.set_human_reaction(uuid, public.reaction_kind);
    alter type public.reaction_kind rename to reaction_kind_legacy;
    create type public.reaction_kind as enum ('like');

    alter table public.social_reactions
      alter column reaction type public.reaction_kind
      using 'like'::public.reaction_kind;

    drop type public.reaction_kind_legacy;
  end if;
end $$;

create or replace function public.set_human_reaction(p_post_id uuid, p_reaction public.reaction_kind)
returns public.social_reactions language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); result public.social_reactions;
begin
  if uid is null then raise exception 'authentication required' using errcode='42501'; end if;
  if not public.check_rate_limit('reaction:mutate',60,60,null) then raise exception 'rate limit exceeded' using errcode='P0001'; end if;
  if not exists(select 1 from public.social_posts p where p.id=p_post_id and p.content_status='active' and (p.visibility='public' or p.author_id=uid)
    and not exists(select 1 from public.blocked_users b where (b.blocker_id=uid and b.blocked_id=p.author_id) or (b.blocked_id=uid and b.blocker_id=p.author_id))
    and not exists(select 1 from public.muted_companions m where m.user_id=uid and m.companion_id=p.companion_id)) then
    raise exception 'post not found' using errcode='P0002';
  end if;
  select * into result from public.social_reactions where post_id=p_post_id and actor_id=uid for update;
  if found then
    update public.social_reactions set reaction=p_reaction where id=result.id returning * into result;
  else
    insert into public.social_reactions(post_id,actor_id,reaction) values(p_post_id,uid,p_reaction) returning * into result;
  end if;
  return result;
exception when unique_violation then
  update public.social_reactions set reaction=p_reaction where post_id=p_post_id and actor_id=uid returning * into result;
  return result;
end $$;

revoke all on function public.set_human_reaction(uuid, public.reaction_kind) from public;
grant execute on function public.set_human_reaction(uuid, public.reaction_kind) to authenticated;
