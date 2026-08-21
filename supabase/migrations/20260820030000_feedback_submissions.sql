create type public.feedback_type as enum ('idea', 'issue', 'other');

create table public.feedback_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  category public.feedback_type not null,
  message text not null check (char_length(message) between 5 and 2000 and message = trim(message)),
  created_at timestamptz not null default now()
);

create index feedback_submissions_user_created_idx
  on public.feedback_submissions(user_id, created_at desc);

alter table public.feedback_submissions enable row level security;

create or replace function public.submit_feedback(
  p_category public.feedback_type,
  p_message text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  feedback_id uuid;
begin
  if uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not public.check_rate_limit('feedback:submit', 5, 3600, null) then
    raise exception 'rate limit exceeded' using errcode = 'P0001';
  end if;
  if p_category is null or p_message is null or char_length(trim(p_message)) not between 5 and 2000 then
    raise exception 'invalid feedback' using errcode = '22023';
  end if;

  insert into public.feedback_submissions(user_id, category, message)
  values(uid, p_category, trim(p_message))
  returning id into feedback_id;

  return feedback_id;
end $$;

revoke all on table public.feedback_submissions from public, anon, authenticated;
grant select on table public.feedback_submissions to service_role;

revoke all on function public.submit_feedback(public.feedback_type, text) from public, anon, authenticated;
grant execute on function public.submit_feedback(public.feedback_type, text) to authenticated, service_role;
