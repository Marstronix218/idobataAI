-- Pivot A ("Character Coach") core schema: first-party characters and their
-- content, coach profile fields, task start/finish events, reactions, AI usage,
-- story progress, entitlements and aggregate safety counters.
--
-- Everything here is inert while `pivot_a.enabled` is off: start_task() refuses
-- and the finish trigger returns before doing anything. Users can only read
-- their own rows; every write goes through a definer function or the service
-- role. Every user-owned table cascades from user_profiles, so the existing
-- account deletion (auth.users -> user_profiles) removes it too.
--
-- Everything that locks public.tasks (the task_events foreign key and the
-- finish trigger) is at the end of the file, so the live tasks table is held
-- for as short a time as possible before commit.

-- Fail fast instead of queueing behind a long transaction while holding locks
-- that block the app. Only effective inside a transaction (as under
-- `supabase db push`); a non-transactional local reset just warns.
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- Content: characters, lines and chapters (first-party only)
-- ---------------------------------------------------------------------------

create table if not exists public.characters (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 48),
  name text not null check (char_length(name) between 1 and 60),
  role text not null check (role in ('coach','rival','cheerleader','deadpan')),
  art_url text,
  is_launch boolean not null default false,
  pack_sku text,
  -- Optional link to an existing persona, so a character can reuse its art.
  companion_id uuid references public.social_companions(id) on delete set null,
  sheet jsonb not null default '{}'::jsonb check (jsonb_typeof(sheet) = 'object'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.character_lines (
  -- Stable content id, e.g. `sample-coach.task_started.001`, so reseeding
  -- updates a line in place instead of duplicating it.
  id text primary key check (char_length(id) between 1 and 120),
  character_id uuid not null references public.characters(id) on delete cascade,
  event text not null check (event in (
    'task_started','task_finished','first_of_day','streak','comeback',
    'session_nudge','split_intro','chapter_unlocked'
  )),
  text text not null check (char_length(text) between 1 and 400),
  min_streak integer check (min_streak >= 0),
  max_streak integer check (max_streak >= 0),
  -- Null matches any task age.
  task_age_bucket text check (task_age_bucket in ('fresh','days','weeks','stale')),
  tags text[] not null default '{}',
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint character_lines_streak_range check (max_streak is null or min_streak is null or max_streak >= min_streak)
);
create index if not exists character_lines_character_event_idx
  on public.character_lines(character_id, event) where active;

comment on column public.character_lines.task_age_bucket is
  'Age of the task when the line is shown: fresh < 1 day, days 1-6, weeks 7-29, stale >= 30. Null matches any age.';

create table if not exists public.story_chapters (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters(id) on delete cascade,
  number integer not null check (number >= 1),
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 20000),
  unlock_rule jsonb not null default '{}'::jsonb check (jsonb_typeof(unlock_rule) = 'object'),
  active boolean not null default true,
  unique (character_id, number)
);

-- ---------------------------------------------------------------------------
-- Per-user coach state
-- ---------------------------------------------------------------------------

-- Pivot A profile fields live here rather than on user_profiles, because
-- user_profiles has a table-wide SELECT grant and a read-all policy that would
-- expose them on public profiles.
create table if not exists public.user_coach_profiles (
  user_id uuid primary key references public.user_profiles(id) on delete cascade,
  selected_character_id uuid references public.characters(id) on delete set null,
  -- An IANA zone; code treats null as UTC. The name is also checked against
  -- pg_timezone_names by a trigger below, because timezone() alone accepts
  -- POSIX strings such as 'FOO-167'.
  timezone text check (timezone is null or (
    timezone <> '' and char_length(timezone) <= 100
    and timezone(timezone, timestamptz '2000-01-01 00:00:00+00') is not null
  )),
  age_verified_at timestamptz,
  age_verification_method text check (char_length(age_verification_method) <= 40),
  ai_arm text check (ai_arm in ('ai','prewritten')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- task_id references public.tasks; the constraint is added at the end of the file.
create table if not exists public.task_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  task_id uuid not null,
  type text not null check (type in ('started','finished')),
  occurred_at timestamptz not null default now(),
  -- The user's local date at occurred_at, fixed when the event is written.
  local_date date not null,
  -- Which occurrence of the task was finished: 'single' for a one-off task,
  -- otherwise the recurrence_instance_id that apply_task_completion set (a date
  -- or an ISO week). Mirrors task_completion_awards(task_id, occurrence_key).
  occurrence_key text,
  constraint task_events_finished_occurrence check (type <> 'finished' or occurrence_key is not null)
);
create index if not exists task_events_user_local_date_idx on public.task_events(user_id, local_date);
create index if not exists task_events_task_occurred_idx on public.task_events(task_id, occurred_at desc);
-- At most one finished event per occurrence, so completing, reopening and
-- completing a task again cannot inflate finishes or consistency days.
create unique index if not exists task_events_finished_occurrence_key
  on public.task_events(task_id, occurrence_key) where type = 'finished';
-- At most one started event per task per local day; start_task returns the
-- existing one instead of piling up rows.
create unique index if not exists task_events_started_local_date_key
  on public.task_events(task_id, local_date) where type = 'started';

-- The spec's `reactions`, renamed so it does not clash with social_reactions.
-- Purged after 30 days (Phase 8).
create table if not exists public.character_reactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  task_event_id uuid references public.task_events(id) on delete cascade,
  character_id uuid not null references public.characters(id) on delete cascade,
  event text not null check (event in (
    'task_started','task_finished','first_of_day','streak','comeback',
    'session_nudge','split_intro','chapter_unlocked'
  )),
  source text not null check (source in ('prewritten','ai')),
  line_id text references public.character_lines(id) on delete set null,
  text text not null check (char_length(text) between 1 and 600),
  disclosure_shown boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists character_reactions_user_created_idx on public.character_reactions(user_id, created_at desc);
create index if not exists character_reactions_created_idx on public.character_reactions(created_at);
-- Deleting a task cascades through task_events to here.
create index if not exists character_reactions_task_event_idx
  on public.character_reactions(task_event_id) where task_event_id is not null;

-- `date` is the user's local date.
create table if not exists public.ai_usage_daily (
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  date date not null,
  reactions integer not null default 0 check (reactions >= 0),
  splits integer not null default 0 check (splits >= 0),
  safety_checks integer not null default 0 check (safety_checks >= 0),
  aborted_calls integer not null default 0 check (aborted_calls >= 0),
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  cache_read_input_tokens bigint not null default 0 check (cache_read_input_tokens >= 0),
  cache_creation_input_tokens bigint not null default 0 check (cache_creation_input_tokens >= 0),
  est_cost_usd numeric(12,6) not null default 0 check (est_cost_usd >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

create table if not exists public.story_progress (
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  character_id uuid not null references public.characters(id) on delete cascade,
  -- Local days with at least one finished task while this character was selected.
  consistency_days integer not null default 0 check (consistency_days >= 0),
  unlocked_through integer not null default 0 check (unlocked_through >= 0),
  last_consistency_date date,
  updated_at timestamptz not null default now(),
  primary key (user_id, character_id)
);

create table if not exists public.entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  product text not null check (product = 'plus' or product ~ '^pack:[a-z0-9]+(-[a-z0-9]+)*$'),
  status text not null check (status in ('trialing','active','past_due','canceled','expired','refunded')),
  source text not null check (source in ('stripe','app_store')),
  external_id text,
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, product, source)
);

-- Aggregate only: no user id and no text, ever. California requires annual
-- crisis-referral reporting from July 2027.
create table if not exists public.safety_counters (
  date date not null,
  kind text not null check (kind in ('crisis_card_shown','distress_check_unavailable')),
  count bigint not null default 0 check (count >= 0),
  primary key (date, kind)
);

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

drop trigger if exists characters_touch on public.characters;
create trigger characters_touch before update on public.characters
  for each row execute function public.touch_updated_at();
drop trigger if exists character_lines_touch on public.character_lines;
create trigger character_lines_touch before update on public.character_lines
  for each row execute function public.touch_updated_at();
drop trigger if exists user_coach_profiles_touch on public.user_coach_profiles;
create trigger user_coach_profiles_touch before update on public.user_coach_profiles
  for each row execute function public.touch_updated_at();
drop trigger if exists ai_usage_daily_touch on public.ai_usage_daily;
create trigger ai_usage_daily_touch before update on public.ai_usage_daily
  for each row execute function public.touch_updated_at();
drop trigger if exists story_progress_touch on public.story_progress;
create trigger story_progress_touch before update on public.story_progress
  for each row execute function public.touch_updated_at();
drop trigger if exists entitlements_touch on public.entitlements;
create trigger entitlements_touch before update on public.entitlements
  for each row execute function public.touch_updated_at();

-- timezone() accepts POSIX offset strings such as 'FOO-167', which would shift
-- local dates by days. Only named zones Postgres knows are allowed.
create or replace function public.validate_user_coach_timezone()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.timezone is not null
    and not exists(select 1 from pg_catalog.pg_timezone_names zone where zone.name = new.timezone)
  then
    raise exception 'invalid time zone' using errcode = '22023';
  end if;
  return new;
end $$;

drop trigger if exists user_coach_profiles_validate_timezone on public.user_coach_profiles;
create trigger user_coach_profiles_validate_timezone
  before insert or update of timezone on public.user_coach_profiles
  for each row execute function public.validate_user_coach_timezone();

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------

alter table public.characters enable row level security;
alter table public.character_lines enable row level security;
alter table public.story_chapters enable row level security;
alter table public.user_coach_profiles enable row level security;
alter table public.task_events enable row level security;
alter table public.character_reactions enable row level security;
alter table public.ai_usage_daily enable row level security;
alter table public.story_progress enable row level security;
alter table public.entitlements enable row level security;
alter table public.safety_counters enable row level security;

-- character_lines and story_chapters have no client policy: the server picks
-- lines, and only returns a chapter body after checking it is unlocked.
-- safety_counters has no client access at all.
drop policy if exists characters_read_active on public.characters;
create policy characters_read_active on public.characters for select to authenticated
  using (active);
drop policy if exists user_coach_profiles_read_own on public.user_coach_profiles;
create policy user_coach_profiles_read_own on public.user_coach_profiles for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists task_events_read_own on public.task_events;
create policy task_events_read_own on public.task_events for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists character_reactions_read_own on public.character_reactions;
create policy character_reactions_read_own on public.character_reactions for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists ai_usage_daily_read_own on public.ai_usage_daily;
create policy ai_usage_daily_read_own on public.ai_usage_daily for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists story_progress_read_own on public.story_progress;
create policy story_progress_read_own on public.story_progress for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists entitlements_read_own on public.entitlements;
create policy entitlements_read_own on public.entitlements for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.characters, public.character_lines, public.story_chapters,
  public.user_coach_profiles, public.task_events, public.character_reactions,
  public.ai_usage_daily, public.story_progress, public.entitlements, public.safety_counters
  from public, anon, authenticated;
-- characters.sheet holds the prompt material (voice notes, do/don't lists), so
-- clients get every column except it. Select explicit columns, never `*`.
grant select (id, slug, name, role, art_url, is_launch, pack_sku, companion_id, active, created_at, updated_at)
  on public.characters to authenticated;
grant select on public.user_coach_profiles, public.task_events, public.character_reactions,
  public.ai_usage_daily, public.story_progress, public.entitlements
  to authenticated;
grant all on public.characters, public.character_lines, public.story_chapters,
  public.user_coach_profiles, public.task_events, public.character_reactions,
  public.ai_usage_daily, public.story_progress, public.entitlements, public.safety_counters
  to service_role;

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

create or replace function public.coach_local_date(p_user_id uuid, p_at timestamptz default now())
returns date language sql stable security definer set search_path = '' as $$
  select (p_at at time zone coalesce(
    (select profile.timezone from public.user_coach_profiles profile where profile.user_id = p_user_id),
    'UTC'
  ))::date;
$$;

-- Starts are events, not a task status, so the mobile app and the existing
-- task APIs keep working unchanged.
create or replace function public.start_task(p_task_id uuid)
returns public.task_events language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  started_at timestamptz := now();
  started_date date;
  t public.tasks;
  result public.task_events;
begin
  if uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if not public.pivot_flag_enabled('pivot_a.enabled') then
    raise exception 'feature disabled' using errcode = 'P0001';
  end if;
  if not public.check_rate_limit('task:start', 60, 60, null) then
    raise exception 'rate limit exceeded' using errcode = 'P0001';
  end if;
  select * into t from public.tasks where id = p_task_id and owner_id = uid;
  if not found then raise exception 'task not found' using errcode = 'P0002'; end if;
  if t.status <> 'pending' then raise exception 'task is not pending' using errcode = '22023'; end if;

  started_date := public.coach_local_date(uid, started_at);
  insert into public.task_events(user_id, task_id, type, occurred_at, local_date)
  values (uid, t.id, 'started', started_at, started_date)
  on conflict (task_id, local_date) where type = 'started' do nothing
  returning * into result;
  -- Already started today: hand back that event instead of adding another.
  if not found then
    select * into result from public.task_events event
    where event.task_id = t.id and event.local_date = started_date and event.type = 'started';
  end if;
  return result;
end $$;

create or replace function public.record_ai_usage(
  p_user_id uuid,
  p_date date,
  p_reactions integer,
  p_splits integer,
  p_safety_checks integer,
  p_aborted_calls integer,
  p_input_tokens bigint,
  p_output_tokens bigint,
  p_cache_read bigint,
  p_cache_creation bigint,
  p_cost numeric
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_user_id is null or p_date is null then
    raise exception 'user and date are required' using errcode = '22023';
  end if;
  if least(
    coalesce(p_reactions, 0), coalesce(p_splits, 0), coalesce(p_safety_checks, 0),
    coalesce(p_aborted_calls, 0), coalesce(p_input_tokens, 0), coalesce(p_output_tokens, 0),
    coalesce(p_cache_read, 0), coalesce(p_cache_creation, 0), coalesce(p_cost, 0)
  ) < 0 then
    raise exception 'usage increments must not be negative' using errcode = '22023';
  end if;

  insert into public.ai_usage_daily(
    user_id, date, reactions, splits, safety_checks, aborted_calls, input_tokens,
    output_tokens, cache_read_input_tokens, cache_creation_input_tokens, est_cost_usd
  ) values (
    p_user_id, p_date, coalesce(p_reactions, 0), coalesce(p_splits, 0),
    coalesce(p_safety_checks, 0), coalesce(p_aborted_calls, 0), coalesce(p_input_tokens, 0),
    coalesce(p_output_tokens, 0), coalesce(p_cache_read, 0), coalesce(p_cache_creation, 0),
    coalesce(p_cost, 0)
  )
  on conflict (user_id, date) do update set
    reactions = public.ai_usage_daily.reactions + excluded.reactions,
    splits = public.ai_usage_daily.splits + excluded.splits,
    safety_checks = public.ai_usage_daily.safety_checks + excluded.safety_checks,
    aborted_calls = public.ai_usage_daily.aborted_calls + excluded.aborted_calls,
    input_tokens = public.ai_usage_daily.input_tokens + excluded.input_tokens,
    output_tokens = public.ai_usage_daily.output_tokens + excluded.output_tokens,
    cache_read_input_tokens = public.ai_usage_daily.cache_read_input_tokens + excluded.cache_read_input_tokens,
    cache_creation_input_tokens = public.ai_usage_daily.cache_creation_input_tokens + excluded.cache_creation_input_tokens,
    est_cost_usd = public.ai_usage_daily.est_cost_usd + excluded.est_cost_usd;
end $$;

create or replace function public.increment_safety_counter(
  p_kind text,
  p_date date default (now() at time zone 'utc')::date
) returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.safety_counters(date, kind, count)
  values (coalesce(p_date, (now() at time zone 'utc')::date), p_kind, 1)
  on conflict (date, kind) do update set count = public.safety_counters.count + 1;
end $$;

revoke all on function
  public.validate_user_coach_timezone(),
  public.coach_local_date(uuid, timestamptz),
  public.start_task(uuid),
  public.record_ai_usage(uuid, date, integer, integer, integer, integer, bigint, bigint, bigint, bigint, numeric),
  public.increment_safety_counter(text, date)
  from public, anon, authenticated, service_role;
grant execute on function public.start_task(uuid) to authenticated;
grant execute on function
  public.coach_local_date(uuid, timestamptz),
  public.record_ai_usage(uuid, date, integer, integer, integer, integer, bigint, bigint, bigint, bigint, numeric),
  public.increment_safety_counter(text, date)
  to service_role;

comment on table public.safety_counters is
  'Aggregate safety counts per UTC date. No user id and no text. Service role only.';
comment on function public.start_task(uuid) is
  'Records one started event per task per local day for the caller''s pending task, returning the existing one on repeat calls. Refuses while pivot_a.enabled is off.';
comment on function public.record_ai_usage(uuid, date, integer, integer, integer, integer, bigint, bigint, bigint, bigint, numeric) is
  'Adds one AI call''s counts, tokens and estimated cost to the user''s local-day usage row. Service role only.';

-- ---------------------------------------------------------------------------
-- public.tasks: foreign key and finish trigger. Kept last so the locks they
-- take on the live tasks table are held only briefly before commit.
-- ---------------------------------------------------------------------------

alter table public.task_events
  add constraint task_events_task_id_fkey foreign key (task_id) references public.tasks(id) on delete cascade;

-- Runs after apply_task_completion has set completed_at, so it sees the final
-- row. It returns before doing anything while Pivot A is off, and swallows its
-- own errors: completing a task must never fail because of it.
create or replace function public.record_task_finished_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  finished_at timestamptz;
  finished_date date;
  finished_event uuid;
  selected_character uuid;
begin
  if new.status <> 'completed' or (tg_op = 'UPDATE' and old.status = 'completed') then
    return null;
  end if;
  if not public.pivot_flag_enabled('pivot_a.enabled') then return null; end if;

  begin
    finished_at := coalesce(new.completed_at, now());
    finished_date := public.coach_local_date(new.owner_id, finished_at);

    insert into public.task_events(user_id, task_id, type, occurred_at, local_date, occurrence_key)
    values (new.owner_id, new.id, 'finished', finished_at, finished_date,
      coalesce(new.recurrence_instance_id, 'single'))
    on conflict (task_id, occurrence_key) where type = 'finished' do nothing
    returning id into finished_event;

    -- This occurrence was already finished once: nothing new to record.
    if finished_event is null then return null; end if;

    select profile.selected_character_id into selected_character
    from public.user_coach_profiles profile where profile.user_id = new.owner_id;

    -- The first finish of a local day counts once toward the selected
    -- character's story. Chapter unlocking (unlocked_through) is Phase 4.
    if selected_character is not null then
      insert into public.story_progress(user_id, character_id, consistency_days, last_consistency_date)
      values (new.owner_id, selected_character, 1, finished_date)
      on conflict (user_id, character_id) do update set
        consistency_days = public.story_progress.consistency_days + 1,
        last_consistency_date = excluded.last_consistency_date
      where public.story_progress.last_consistency_date is null
         or public.story_progress.last_consistency_date < excluded.last_consistency_date;
    end if;
  exception when others then
    raise warning 'record_task_finished_event skipped for task %: % (SQLSTATE %)', new.id, sqlerrm, sqlstate;
  end;
  return null;
end $$;

revoke all on function public.record_task_finished_event() from public, anon, authenticated, service_role;

-- CREATE OR REPLACE TRIGGER takes SHARE ROW EXCLUSIVE on tasks; a
-- DROP TRIGGER IF EXISTS would take ACCESS EXCLUSIVE, blocking reads too.
create or replace trigger tasks_record_finished_event
  after insert or update of status on public.tasks
  for each row when (new.status = 'completed')
  execute function public.record_task_finished_event();

notify pgrst, 'reload schema';
