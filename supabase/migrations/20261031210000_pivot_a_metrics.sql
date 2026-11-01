-- Pivot A Phase 7: metrics, the ai_arm experiment and the AI cost guardrail.
--
-- 1. beta_product_events (first-party, server-only, content-free) gains the
--    Pivot A events and two content-free columns:
--    - `detail`: one value from a fixed list per event (a reaction's source, a
--      paywall surface, a purchase's product kind). Never text from the user.
--    - `duration_seconds`: session_length only, 0..86400.
--    Every new event has its own source_id (the task event id, the reaction id,
--    ...), so the table's "first event per (event_name, source_id)" rule no
--    longer hides a recurring task's later finishes.
-- 2. Triggers emit task_started / task_finished (task_events), reaction_shown
--    (character_reactions, task reactions only), chapter_unlocked
--    (story_progress) and trial_started / purchase (entitlements, from any
--    billing source). Each swallows its own errors: a metric must never break
--    the write it describes. The source tables are only written under Pivot A,
--    so the triggers need no flag check of their own.
-- 3. record_coach_product_event(): the server's writer for split_used,
--    paywall_viewed and session_length. Service role only.
-- 4. Every coach profile gets its ai_arm when the row is created (the same
--    hash as src/lib/domain/ai-arm.ts), and existing rows are backfilled.
-- 5. ai_spend_daily: estimated AI spend per UTC day, for the spend breaker.
-- 6. report_ai_arm() and report_ai_cost(): service role only.
-- 7. pivot_flag_enabled() knows `beta_full_access.enabled` (the free beta,
--    founder decision 2026-10-31): its row alone, off when absent. With Pivot
--    A on it gives every user Plus-level access (src/lib/coach/plan.ts). The
--    reports still read tiers from entitlements, so beta testers show as free.
--
-- Event dates (event_date) stay UTC like every other beta_product_events row;
-- the reports read task_events.local_date and convert timestamps to each
-- user's own zone instead.

-- Fail fast instead of queueing behind a long transaction while holding locks
-- that block the app. Only effective inside a transaction (as under
-- `supabase db push`); a non-transactional local reset just warns.
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 0. The free beta flag. Same as 20261031120000_pivot_a_feature_flags.sql plus
--    one key; must match resolveFlags() in src/lib/domain/feature-flags.ts.
--    Nothing is seeded: the founder turns it on with
--    `npm run flags -- set beta_full_access.enabled true`.
-- ---------------------------------------------------------------------------

create or replace function public.pivot_flag_enabled(p_key text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  pivot boolean;
  stored boolean;
begin
  if p_key is null or p_key not in (
    'pivot_a.enabled', 'social_feed.enabled', 'persona_chat.enabled',
    'persona_autopost.enabled', 'share_win.enabled', 'beta_full_access.enabled'
  ) then
    raise exception 'unknown pivot flag: %', coalesce(p_key, '<null>') using errcode = '22023';
  end if;

  select flag.enabled into pivot from public.app_feature_flags flag where flag.key = 'pivot_a.enabled';
  pivot := coalesce(pivot, false);
  select flag.enabled into stored from public.app_feature_flags flag where flag.key = p_key;

  return case p_key
    when 'pivot_a.enabled' then pivot
    when 'social_feed.enabled' then coalesce(stored, not pivot)
    -- Persona chat and autoposting are guardrails, so Pivot A forces them off
    -- whatever their row says.
    when 'persona_chat.enabled' then case when pivot then false else coalesce(stored, true) end
    when 'persona_autopost.enabled' then case when pivot then false else coalesce(stored, true) end
    when 'share_win.enabled' then coalesce(stored, true)
    -- Free beta: its row alone decides; it only has an effect while Pivot A is on.
    when 'beta_full_access.enabled' then coalesce(stored, false)
  end;
end $$;

comment on function public.pivot_flag_enabled(text) is
  'Resolves a Pivot A flag. A missing row derives its default from pivot_a.enabled (beta_full_access.enabled: off); unknown keys raise 22023.';

-- ---------------------------------------------------------------------------
-- 1. beta_product_events: names and content-free columns
-- ---------------------------------------------------------------------------

alter table public.beta_product_events
  add column if not exists detail text,
  add column if not exists duration_seconds integer;

-- Every name from 20260830090000_persona_thread_conversations.sql, plus Pivot A's.
alter table public.beta_product_events drop constraint if exists beta_product_events_event_name_check;
alter table public.beta_product_events add constraint beta_product_events_event_name_check
  check (event_name in (
    'session_active',
    'daily_active',
    'task_created',
    'task_completed',
    'completion_post_created',
    'persona_followed',
    'persona_unfollowed',
    'persona_favorited',
    'persona_unfavorited',
    'ai_like_completed',
    'ai_reply_completed',
    'ai_quote_completed',
    'persona_chat_message_sent',
    'user_replied_to_ai',
    'ai_replied_to_user_reply',
    'ai_thread_conversation_started',
    'ai_thread_conversation_continued',
    'task_started',
    'task_finished',
    'reaction_shown',
    'split_used',
    'chapter_unlocked',
    'paywall_viewed',
    'trial_started',
    'purchase',
    'session_length'
  ));

-- A closed list per event, so no free text can ever land in `detail`.
alter table public.beta_product_events drop constraint if exists beta_product_events_detail_check;
alter table public.beta_product_events add constraint beta_product_events_detail_check
  check (
    detail is null
    or (event_name = 'reaction_shown' and detail in ('prewritten','ai'))
    or (event_name in ('trial_started','purchase') and detail in ('plus','pack'))
    or (event_name = 'paywall_viewed' and detail in ('split','story'))
  );

alter table public.beta_product_events drop constraint if exists beta_product_events_duration_check;
alter table public.beta_product_events add constraint beta_product_events_duration_check
  check (
    (event_name = 'session_length') = (duration_seconds is not null)
    and (duration_seconds is null or duration_seconds between 0 and 86400)
  );

-- The user's latest session, which record_coach_product_event may extend.
create index if not exists beta_product_events_session_length_idx
  on public.beta_product_events(user_id, occurred_at desc)
  where event_name = 'session_length';

comment on column public.beta_product_events.detail is
  'Pivot A only, from a fixed list per event: reaction_shown prewritten|ai, trial_started/purchase plus|pack, paywall_viewed split|story. Never user content.';
comment on column public.beta_product_events.duration_seconds is
  'session_length only: foreground seconds in one session (stretches less than 30 minutes apart are one session), 0..86400.';

-- The one insert path for the Pivot A events. Internal: callable only from
-- the definer functions below. A repeated (event_name, source_id) is dropped.
create or replace function public.capture_coach_product_event(
  p_event_name text,
  p_user_id uuid,
  p_source_id uuid,
  p_occurred_at timestamptz default now(),
  p_detail text default null,
  p_duration_seconds integer default null
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.beta_product_events(
    event_name, user_id, source_id, event_date, occurred_at, detail, duration_seconds
  ) values (
    p_event_name, p_user_id, p_source_id, (p_occurred_at at time zone 'UTC')::date,
    p_occurred_at, p_detail, p_duration_seconds
  ) on conflict do nothing;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Event triggers. Each runs after the write, catches its own errors and
--    only logs a warning (never row content).
-- ---------------------------------------------------------------------------

-- task_started / task_finished, one per task event. A recurring task's every
-- finished occurrence has its own task event, so each finish counts.
create or replace function public.capture_coach_task_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform public.capture_coach_product_event(
      case new.type when 'started' then 'task_started' else 'task_finished' end,
      new.user_id, new.id, new.occurred_at
    );
  exception when others then
    raise warning 'capture_coach_task_event skipped: % (SQLSTATE %)', sqlerrm, sqlstate;
  end;
  return null;
end $$;

create or replace trigger task_events_capture_product_event
  after insert on public.task_events
  for each row execute function public.capture_coach_task_event();

-- reaction_shown with the reaction's source, for reactions to a task start or
-- finish only. A session nudge has no task event and is not a reaction to a
-- task (SPEC Phase 7 tracks reactions "with source"); a session's length is
-- what session_length measures.
create or replace function public.capture_coach_reaction_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform public.capture_coach_product_event(
      'reaction_shown', new.user_id, new.id, new.created_at, new.source
    );
  exception when others then
    raise warning 'capture_coach_reaction_event skipped: % (SQLSTATE %)', sqlerrm, sqlstate;
  end;
  return null;
end $$;

create or replace trigger character_reactions_capture_product_event
  after insert on public.character_reactions
  for each row when (new.task_event_id is not null and new.event <> 'session_nudge')
  execute function public.capture_coach_reaction_event();

-- chapter_unlocked, one per chapter newly covered by unlocked_through. The id
-- is derived from (user, character, chapter), so a chapter counts once even if
-- unlocked_through were ever lowered and raised again.
create or replace function public.capture_coach_chapter_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  chapter integer;
begin
  begin
    for chapter in (old.unlocked_through + 1) .. least(new.unlocked_through, old.unlocked_through + 100) loop
      perform public.capture_coach_product_event(
        'chapter_unlocked', new.user_id,
        pg_catalog.md5('chapter_unlocked:' || new.user_id::text || ':' || new.character_id::text || ':' || chapter::text)::uuid,
        pg_catalog.now()
      );
    end loop;
  exception when others then
    raise warning 'capture_coach_chapter_event skipped: % (SQLSTATE %)', sqlerrm, sqlstate;
  end;
  return null;
end $$;

create or replace trigger story_progress_capture_chapter_event
  after update of unlocked_through on public.story_progress
  for each row when (new.unlocked_through > old.unlocked_through)
  execute function public.capture_coach_chapter_event();

-- trial_started when a row starts (or moves into) `trialing`, purchase when it
-- starts (or moves into) `active`, from any billing source, so a Stripe or App
-- Store integration needs no analytics code of its own. Both use the
-- entitlement id, so each counts once per row: a purchase is the first time a
-- row is active (a trial converting, or a pack or plan bought outright), and
-- renewals, past_due recoveries and replayed webhooks add nothing.
create or replace function public.capture_coach_entitlement_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  product_kind text := case when new.product = 'plus' then 'plus' else 'pack' end;
begin
  begin
    if new.status = 'trialing' and (tg_op = 'INSERT' or old.status is distinct from 'trialing') then
      perform public.capture_coach_product_event('trial_started', new.user_id, new.id, pg_catalog.now(), product_kind);
    elsif new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active') then
      perform public.capture_coach_product_event('purchase', new.user_id, new.id, pg_catalog.now(), product_kind);
    end if;
  exception when others then
    raise warning 'capture_coach_entitlement_event skipped: % (SQLSTATE %)', sqlerrm, sqlstate;
  end;
  return null;
end $$;

create or replace trigger entitlements_capture_product_event
  after insert or update of status on public.entitlements
  for each row execute function public.capture_coach_entitlement_event();

-- ---------------------------------------------------------------------------
-- 3. The server's writer for events no table write describes.
-- ---------------------------------------------------------------------------

-- split_used: one per delivered split (a random id each time).
-- paywall_viewed: detail split|story, once per user, local day and surface.
-- session_length: one foreground stretch of p_duration_seconds, clamped to
--   0..86400 (0 records nothing). A stretch that began less than 30 minutes
--   after the user's previous one ended extends that session (the session
--   nudge's 30-minute gap), so there is one row per session.
create or replace function public.record_coach_product_event(
  p_user_id uuid,
  p_event_name text,
  p_detail text default null,
  p_duration_seconds integer default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  observed_at timestamptz := pg_catalog.clock_timestamp();
  duration integer;
  latest_id bigint;
  latest_duration integer;
  latest_at timestamptz;
begin
  if p_user_id is null then raise exception 'user required' using errcode = '22023'; end if;

  if p_event_name = 'split_used' then
    perform public.capture_coach_product_event('split_used', p_user_id, gen_random_uuid(), observed_at);

  elsif p_event_name = 'paywall_viewed' then
    if p_detail is null or p_detail not in ('split','story') then
      raise exception 'unknown paywall surface' using errcode = '22023';
    end if;
    perform public.capture_coach_product_event(
      'paywall_viewed', p_user_id,
      pg_catalog.md5('paywall_viewed:' || p_user_id::text || ':'
        || public.coach_local_date(p_user_id, observed_at)::text || ':' || p_detail)::uuid,
      observed_at, p_detail
    );

  elsif p_event_name = 'session_length' then
    duration := least(greatest(coalesce(p_duration_seconds, 0), 0), 86400);
    if duration = 0 then return; end if;

    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('session-length:' || p_user_id::text, 0));
    select event.id, event.duration_seconds, event.occurred_at
      into latest_id, latest_duration, latest_at
    from public.beta_product_events event
    where event.user_id = p_user_id and event.event_name = 'session_length'
    order by event.occurred_at desc
    limit 1;

    if latest_id is not null
      and observed_at - pg_catalog.make_interval(secs => duration) < latest_at + interval '30 minutes'
    then
      update public.beta_product_events event
      set duration_seconds = least(latest_duration + duration, 86400),
          occurred_at = observed_at,
          event_date = (observed_at at time zone 'UTC')::date
      where event.id = latest_id;
    else
      perform public.capture_coach_product_event('session_length', p_user_id, gen_random_uuid(), observed_at, null, duration);
    end if;

  else
    raise exception 'unknown coach product event: %', coalesce(p_event_name, '<null>') using errcode = '22023';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. The ai_arm experiment: an arm on every coach profile.
-- ---------------------------------------------------------------------------

-- Mirrors assignAiArm() in src/lib/domain/ai-arm.ts: "ai" when the first byte
-- of SHA-256(lowercase user id) is even, "prewritten" when odd. uuid::text is
-- already lowercase with no surrounding space.
create or replace function public.coach_ai_arm(p_user_id uuid)
returns text language sql immutable set search_path = '' as $$
  select case
    when pg_catalog.get_byte(pg_catalog.sha256(pg_catalog.convert_to(p_user_id::text, 'UTF8')), 0) % 2 = 0 then 'ai'
    else 'prewritten'
  end;
$$;

-- The row is created by the first Pivot A write for a user (the age step or
-- the character pick, both before any task), so every Pivot A user is in an
-- arm from the start, whether or not they ever get a reaction. A stored arm is
-- never changed.
create or replace function public.assign_coach_ai_arm()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.ai_arm is null then
    new.ai_arm := public.coach_ai_arm(new.user_id);
  end if;
  return new;
end $$;

create or replace trigger user_coach_profiles_assign_ai_arm
  before insert or update of ai_arm on public.user_coach_profiles
  for each row execute function public.assign_coach_ai_arm();

update public.user_coach_profiles set ai_arm = public.coach_ai_arm(user_id) where ai_arm is null;

-- ---------------------------------------------------------------------------
-- 5. Estimated AI spend per UTC day.
-- ---------------------------------------------------------------------------

-- ai_usage_daily is keyed by each user's local date, which lags UTC by hours
-- for US users, so "today's spend" cannot be read from it. This ledger books
-- every increase of est_cost_usd on the UTC day it was metered. Service role
-- reads it (the spend breaker and the daily cron); only the trigger writes.
create table if not exists public.ai_spend_daily (
  date date primary key,
  est_cost_usd numeric(14,6) not null default 0 check (est_cost_usd >= 0),
  updated_at timestamptz not null default now()
);

alter table public.ai_spend_daily enable row level security;
revoke all on public.ai_spend_daily from public, anon, authenticated;
grant select on public.ai_spend_daily to service_role;

comment on table public.ai_spend_daily is
  'Estimated AI spend (USD) per UTC day across all users, booked when record_ai_usage meters it. No user id. Service role read only.';

create or replace function public.track_ai_spend_daily()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  delta numeric := new.est_cost_usd - case when tg_op = 'UPDATE' then old.est_cost_usd else 0 end;
begin
  if delta is null or delta <= 0 then return null; end if;
  begin
    insert into public.ai_spend_daily as spend (date, est_cost_usd)
    values ((pg_catalog.now() at time zone 'UTC')::date, delta)
    on conflict (date) do update set
      est_cost_usd = spend.est_cost_usd + excluded.est_cost_usd,
      updated_at = pg_catalog.now();
  exception when others then
    raise warning 'track_ai_spend_daily skipped: % (SQLSTATE %)', sqlerrm, sqlstate;
  end;
  return null;
end $$;

create or replace trigger ai_usage_daily_track_spend
  after insert or update of est_cost_usd on public.ai_usage_daily
  for each row execute function public.track_ai_spend_daily();

-- ---------------------------------------------------------------------------
-- 6. Reports (service role only; run through `npm run report:*` and the daily cron).
-- ---------------------------------------------------------------------------

-- The ai_arm experiment, per arm and per arm and current plan tier
-- (plan_tier 'all' is the arm as a whole). Population: every user with a
-- coach profile created by p_as_of.
-- - Day 0: the user's local date (coach time zone, UTC when unset) of their
--   first Pivot A activity: the coach profile's creation (age step or
--   character pick) or their first task event, whichever came first.
-- - tasks_finished_per_user_week: each user's finished task events with
--   task_events.local_date from day 0 to today, times 7, divided by the days
--   since day 0 inclusive (at least 7, so a new user is never extrapolated
--   from one good day); averaged over the users in the row.
-- - Day-14 retention: of the users whose local days 14-20 have fully passed
--   (today >= day 0 + 21), the share with any task event, or any app session
--   (daily_active, session_active or session_length), on local days 14-20.
-- - plan_tier is the plan now (the entitlements table keeps no history).
create or replace function public.report_ai_arm(p_as_of timestamptz default now())
returns table (
  arm text,
  plan_tier text,
  users bigint,
  tasks_finished bigint,
  tasks_finished_per_user_week numeric,
  day14_eligible_users bigint,
  day14_retained_users bigint,
  day14_retention numeric
)
language sql stable security definer set search_path = '' as $$
  with cohort as (
    select
      profile.user_id,
      coalesce(profile.ai_arm, public.coach_ai_arm(profile.user_id)) as arm,
      case
        when exists(
          select 1 from public.entitlements entitlement
          where entitlement.user_id = profile.user_id and entitlement.product = 'plus' and entitlement.status = 'active'
            and (entitlement.current_period_end is null or entitlement.current_period_end > p_as_of)
        ) then 'plus'
        when exists(
          select 1 from public.entitlements entitlement
          where entitlement.user_id = profile.user_id and entitlement.product = 'plus' and entitlement.status = 'trialing'
            and (entitlement.trial_ends_at is null or entitlement.trial_ends_at > p_as_of)
        ) then 'trial'
        else 'free'
      end as tier,
      coalesce(profile.timezone, 'UTC') as zone,
      least(
        profile.created_at,
        (select min(event.occurred_at) from public.task_events event where event.user_id = profile.user_id)
      ) as started_at
    from public.user_coach_profiles profile
    where profile.created_at <= p_as_of
  ),
  dated as (
    select
      cohort.user_id, cohort.arm, cohort.tier, cohort.zone,
      (cohort.started_at at time zone cohort.zone)::date as day0,
      (p_as_of at time zone cohort.zone)::date as today
    from cohort
  ),
  measured as (
    select
      dated.arm,
      dated.tier,
      (
        select count(*) from public.task_events event
        where event.user_id = dated.user_id and event.type = 'finished'
          and event.local_date between dated.day0 and dated.today
      ) as finished,
      greatest(dated.today - dated.day0 + 1, 7) as days_observed,
      dated.today >= dated.day0 + 21 as eligible,
      exists(
        select 1 from public.task_events event
        where event.user_id = dated.user_id
          and event.local_date between dated.day0 + 14 and dated.day0 + 20
      ) or exists(
        select 1 from public.beta_product_events activity
        where activity.user_id = dated.user_id
          and activity.event_name in ('daily_active','session_active','session_length')
          -- event_date is UTC: a cheap superset first, then the local date.
          and activity.event_date between dated.day0 + 13 and dated.day0 + 21
          and (activity.occurred_at at time zone dated.zone)::date between dated.day0 + 14 and dated.day0 + 20
      ) as returned
    from dated
  )
  select
    measured.arm,
    case when grouping(measured.tier) = 1 then 'all' else measured.tier end,
    count(*),
    sum(measured.finished)::bigint,
    round(avg(measured.finished * 7.0 / measured.days_observed), 2),
    count(*) filter (where measured.eligible),
    count(*) filter (where measured.eligible and measured.returned),
    round(
      (count(*) filter (where measured.eligible and measured.returned))::numeric
        / nullif(count(*) filter (where measured.eligible), 0),
      4
    )
  from measured
  group by grouping sets ((measured.arm), (measured.arm, measured.tier))
  order by measured.arm, grouping(measured.tier) desc, measured.tier;
$$;

-- AI cost for one month of ai_usage_daily (users' local dates), up to p_as_of.
-- - p_month: any date in the month; null is the current UTC month.
-- - p_as_of: the last date counted (null: today in UTC), capped at the month's
--   end; the projection scales the month so far to the whole month.
-- - Paying users: a plus entitlement that is active (period not ended), or
--   any active pack, as of now (no history is kept). Trials do not pay.
-- - cost_per_paying_user_usd: ALL AI cost in the period (free users' included,
--   since subscribers pay for it) divided by paying users; null with none.
-- - Active users: anyone with a task event or AI usage in the period.
-- - cost_per_active_user_30d_usd: AI cost over the 30 local days ending
--   as_of, divided by the users active in those 30 days: the monthly cost of
--   an active user, measured rather than extrapolated (distinct active users
--   keep growing through a month, so scaling a month-to-date per-user figure
--   would overstate it early in every month). The daily cron alerts on it
--   while there are no paying users (the free beta).
-- - At the reaction cap: a plus/trial user (current plan) whose delivered AI
--   reactions reached the daily cap on some local day in the period, or a free
--   user whose rolling 7-local-day total reached the weekly cap on some day in
--   the period. While the free beta's full access is on (pivot_a.enabled and
--   beta_full_access.enabled), every user has the Plus caps, so everyone is
--   judged against the daily cap; beta_full_access says so in the output. At
--   the split cap: delivered splits reached the daily cap on some day. Shares
--   are over active users. The caps are parameters so callers pass the
--   configured AI_CAP_* values; the defaults are the spec's.
create or replace function public.report_ai_cost(
  p_month date default null,
  p_as_of date default null,
  p_plus_daily_reactions integer default 30,
  p_plus_daily_splits integer default 10,
  p_free_weekly_reactions integer default 3
) returns table (
  month date,
  as_of date,
  days_elapsed integer,
  days_in_month integer,
  total_cost_usd numeric,
  active_users bigint,
  paying_users bigint,
  cost_per_active_user_usd numeric,
  active_users_30d bigint,
  cost_per_active_user_30d_usd numeric,
  cost_per_paying_user_usd numeric,
  projected_cost_per_paying_user_usd numeric,
  users_at_reaction_cap bigint,
  users_at_split_cap bigint,
  share_at_reaction_cap numeric,
  share_at_split_cap numeric,
  beta_full_access boolean
)
language sql stable security definer set search_path = '' as $$
  with month_start as (
    select pg_catalog.date_trunc('month', coalesce(p_month, (pg_catalog.now() at time zone 'UTC')::date))::date as first_day
  ),
  bounds as (
    select
      month_start.first_day,
      (month_start.first_day + interval '1 month' - interval '1 day')::date as last_day,
      least(
        (month_start.first_day + interval '1 month' - interval '1 day')::date,
        coalesce(p_as_of, (pg_catalog.now() at time zone 'UTC')::date)
      ) as as_of
    from month_start
  ),
  caps as (
    select
      greatest(coalesce(p_plus_daily_reactions, 30), 1) as plus_reactions,
      greatest(coalesce(p_plus_daily_splits, 10), 1) as plus_splits,
      greatest(coalesce(p_free_weekly_reactions, 3), 1) as free_reactions
  ),
  mode as (
    select public.pivot_flag_enabled('pivot_a.enabled') and public.pivot_flag_enabled('beta_full_access.enabled') as beta_full_access
  ),
  -- Who has the Plus caps by entitlement (trials included).
  plus_or_trial as (
    select distinct entitlement.user_id
    from public.entitlements entitlement
    where entitlement.product = 'plus' and (
      (entitlement.status = 'active' and (entitlement.current_period_end is null or entitlement.current_period_end > pg_catalog.now()))
      or (entitlement.status = 'trialing' and (entitlement.trial_ends_at is null or entitlement.trial_ends_at > pg_catalog.now()))
    )
  ),
  paying as (
    select entitlement.user_id from public.entitlements entitlement
    where (entitlement.product = 'plus' and entitlement.status = 'active'
        and (entitlement.current_period_end is null or entitlement.current_period_end > pg_catalog.now()))
      or (entitlement.product like 'pack:%' and entitlement.status = 'active')
    group by entitlement.user_id
  ),
  -- Six days before the month too, for the free tier's rolling window.
  usage as (
    select
      daily.user_id, daily.date, daily.reactions, daily.splits, daily.est_cost_usd,
      sum(daily.reactions) over (
        partition by daily.user_id order by daily.date
        range between interval '6 days' preceding and current row
      ) as reactions_7d
    from public.ai_usage_daily daily, bounds
    where daily.date between bounds.first_day - 6 and bounds.as_of
  ),
  in_period as (
    select usage.* from usage, bounds where usage.date >= bounds.first_day
  ),
  active as (
    select in_period.user_id from in_period
    union
    select event.user_id from public.task_events event, bounds
    where event.local_date between bounds.first_day and bounds.as_of
  ),
  trailing_usage as (
    select daily.user_id, daily.est_cost_usd
    from public.ai_usage_daily daily, bounds
    where daily.date between bounds.as_of - 29 and bounds.as_of
  ),
  trailing_active as (
    select trailing_usage.user_id from trailing_usage
    union
    select event.user_id from public.task_events event, bounds
    where event.local_date between bounds.as_of - 29 and bounds.as_of
  ),
  capped as (
    select
      in_period.user_id,
      bool_or(case
        when mode.beta_full_access or plus_or_trial.user_id is not null then in_period.reactions >= caps.plus_reactions
        else in_period.reactions_7d >= caps.free_reactions
      end) as at_reaction_cap,
      bool_or(in_period.splits >= caps.plus_splits) as at_split_cap
    from in_period
    cross join caps
    cross join mode
    left join plus_or_trial on plus_or_trial.user_id = in_period.user_id
    group by in_period.user_id
  ),
  totals as (
    select
      (select coalesce(sum(in_period.est_cost_usd), 0) from in_period)::numeric as total_cost,
      (select count(*) from active) as active_users,
      (select coalesce(sum(trailing_usage.est_cost_usd), 0) from trailing_usage)::numeric as trailing_cost,
      (select count(*) from trailing_active) as trailing_active_users,
      (select count(*) from paying) as paying_users,
      (select count(*) from capped where capped.at_reaction_cap) as at_reaction_cap,
      (select count(*) from capped where capped.at_split_cap) as at_split_cap
  ),
  period as (
    select
      bounds.first_day, bounds.as_of,
      greatest(bounds.as_of - bounds.first_day + 1, 0) as days_elapsed,
      bounds.last_day - bounds.first_day + 1 as days_in_month
    from bounds
  )
  select
    period.first_day,
    period.as_of,
    period.days_elapsed,
    period.days_in_month,
    round(totals.total_cost, 6),
    totals.active_users,
    totals.paying_users,
    round(totals.total_cost / nullif(totals.active_users, 0), 6),
    totals.trailing_active_users,
    round(totals.trailing_cost / nullif(totals.trailing_active_users, 0), 6),
    round(totals.total_cost / nullif(totals.paying_users, 0), 6),
    round(totals.total_cost / nullif(totals.paying_users, 0) * period.days_in_month / nullif(period.days_elapsed, 0), 6),
    totals.at_reaction_cap,
    totals.at_split_cap,
    round(totals.at_reaction_cap::numeric / nullif(totals.active_users, 0), 4),
    round(totals.at_split_cap::numeric / nullif(totals.active_users, 0), 4),
    mode.beta_full_access
  from period, totals, mode;
$$;

-- ---------------------------------------------------------------------------
-- Grants: trigger and internal functions for nobody, the writer and the
-- reports for the service role only.
-- ---------------------------------------------------------------------------

revoke all on function
  public.capture_coach_product_event(text, uuid, uuid, timestamptz, text, integer),
  public.capture_coach_task_event(),
  public.capture_coach_reaction_event(),
  public.capture_coach_chapter_event(),
  public.capture_coach_entitlement_event(),
  public.assign_coach_ai_arm(),
  public.track_ai_spend_daily(),
  public.record_coach_product_event(uuid, text, text, integer),
  public.coach_ai_arm(uuid),
  public.report_ai_arm(timestamptz),
  public.report_ai_cost(date, date, integer, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function
  public.record_coach_product_event(uuid, text, text, integer),
  public.coach_ai_arm(uuid),
  public.report_ai_arm(timestamptz),
  public.report_ai_cost(date, date, integer, integer, integer)
  to service_role;

comment on function public.record_coach_product_event(uuid, text, text, integer) is
  'Records split_used, paywall_viewed (detail split|story, once per local day) or session_length (seconds, merged into the session it continues) for a server-verified user. Service role only.';
comment on function public.coach_ai_arm(uuid) is
  'The ai_arm a user id hashes to; identical to assignAiArm() in src/lib/domain/ai-arm.ts.';
comment on function public.report_ai_arm(timestamptz) is
  'ai_arm experiment: users, tasks finished per user per week and day-14 retention per arm and plan tier. Definitions in the migration. Service role only.';
comment on function public.report_ai_cost(date, date, integer, integer, integer) is
  'AI cost for a month: total, per active user (and per active user over the last 30 days), per paying user (projected to the month), users at their caps (Plus caps for everyone while beta_full_access is on), and whether beta_full_access is on. Definitions in the migration. Service role only.';

notify pgrst, 'reload schema';
