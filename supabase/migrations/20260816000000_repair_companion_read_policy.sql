-- Keep internal AI engagement rows private while allowing authenticated users
-- to resolve companion identities that are active or already part of visible
-- social activity.
create or replace function public.can_read_social_companion(p_companion_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(
    select 1
    from public.social_companions companion
    where companion.id = p_companion_id
      and (
        companion.active
        or exists(
          select 1
          from public.social_ai_engagements engagement
          where engagement.companion_id = companion.id
        )
      )
  );
$$;

revoke all on function public.can_read_social_companion(uuid) from public, anon;
grant execute on function public.can_read_social_companion(uuid) to authenticated;

drop policy if exists companions_read on public.social_companions;
create policy companions_read
on public.social_companions
for select
to authenticated
using (public.can_read_social_companion(id));
