# Pivot A, "Character Coach": implementation plan

**Status:** draft for founder review. No application code has changed yet.
**Spec:** [SPEC.md](SPEC.md), a verbatim copy of the brief.
**Branch:** `pivot-a/character-coach`, cut from `main` in Phase 0. Nothing is pushed (see Q1).

## Progress

- [x] Phase 0: baseline and guard rails
- [x] Phase 1: data model and flags
- [ ] Phase 2: character content, character pick, profile disclosure
- [ ] Phase 3: reaction engine, splitter, plan resolution, crisis routing
- [ ] Phase 4: story, session nudge, no-guilt streaks
- [ ] Phase 5: age gate, create/edit distress check, `/safety`
- [ ] Phase 6: billing and entitlements
- [ ] Phase 7: metrics, experiment, cost guardrail
- [ ] Phase 8: retention, deletion, launch check, handoff

Every phase ends with the same steps:
1. Run `npm run typecheck`, `npm run lint` and `npm test`, and get them green.
2. Run `npm run build` too if the phase adds routes.
3. Run pgTAP on the local stack if the phase changes SQL.
4. Get a separate reviewer pass.
5. Make one commit.
6. Tick the phase off here.

The phases are ordered so that each one is complete and can be tested on its own. Nothing depends on a later phase.

---

## 1. Blocking questions

### Founder answers (2026-10-31)

- **Q1:** the linked Supabase project is **staging**, so pushing there is acceptable. Migrations are still tested on the local stack first, and are still inert while the flag is off, because production will eventually receive them.
- **Q2:** flags live in the **`app_feature_flags` database table**.
- **D1:** the experiment arm **applies to everyone, as the spec says**, paying users included.
- **D3:** distress is **re-checked at every reaction, with nothing stored**.
- All other decisions use the defaults in the table below.

### Answer before Phase 1 (resolved, see above)

**Q1. Which database will these migrations reach?**

Two things push migrations to the linked Supabase project without asking:
- `npm run dev` runs `predev`, then `db:sync`, then `supabase db push --linked --yes`.
- CI runs `db:deploy` on every push to `main`.

So any migration I add reaches the linked project the next time someone runs `npm run dev` or merges to `main`.

- Is the linked project production? Is there a separate staging project?
- **What I'll do unless you say otherwise:**
  - Work only on the branch.
  - Never run `npm run dev` or any `db:*` script.
  - Check migrations only against a local Docker stack: `supabase start`, `supabase db reset` and `supabase test db`, all without `--linked`. Docker and Supabase CLI 2.75 are installed here.
- Every migration is written to be **inert while `pivot_a.enabled` is off**:
  - New triggers check the flag first and catch their own exceptions, so they can never break task completion or sign-up.
  - pgTAP tests cover the flag-off path.
- **Optional:** change `predev` to the read-only `db:check`. I'll leave it alone unless you ask.

**Q2. Where should the flags live?**

- **Recommendation: the existing `app_feature_flags` table.** One Supabase project is one environment.
- **Why:**
  - Postgres triggers queue persona engagement, and SQL does persona autoposting, so only a database flag stops them where they start.
  - A second copy in env vars could disagree with the database.
- **How it would work:**
  - TypeScript reads flags through one server-only module with a 30-second cache.
  - `npm run flags` lists or sets them for whichever environment the credentials point at.
  - Pivot A flags treat a missing row as **off**. This differs from the existing `feature_flag_enabled()`, where a missing row means on.
- **Alternative:** env vars per Vercel environment, plus flipping the SQL-side persona switches by hand. That gives you two switches to keep in sync.
- If local dev and production share one Supabase project, database flags can't differ between them. That is one more reason to answer Q1.

### Decisions with a default

I'll use the default unless you tell me otherwise. Each one is needed by the phase shown.

| # | Phase | Question | Default (and alternative) |
|---|---|---|---|
| D1 | 3 | Who does the `ai_arm` experiment apply to? | **Everyone, as the spec says**, paying users included: a `prewritten` arm means prewritten only. The arm is assigned the first time a Pivot A request comes in, by hashing the user id, so existing beta users get one too. *Alternatives:* exempt Plus/trial users, or add a `comp` entitlement source so beta testers in the `ai` arm get Plus caps. Without one of these, the arms differ by at most 3 AI reactions a week, and the experiment measures very little. |
| D2 | 3 | Can free users use the splitter? | No. Splitting is Plus or trial only. Free users see the paywall, with "continue free" clearly visible. |
| D3 | 3 | How do start and finish reactions stay safe on a task whose text suggests distress? | **Nothing is stored, as the spec says.** Every reaction re-runs the keyword prefilter (instant) and the model distress check, alongside reaction generation and inside the same 2.5 s budget. Either one flagging shows the crisis card and suppresses the banter. This also covers task text edited through the Supabase API directly, since users have column grants on `tasks`. It costs at most about $0.03 per Plus user per month. *Alternative:* a stored `tasks.safety_hold` flag. That is cheaper, but it stores a health-related inference about the user, so counsel would need to approve it. |
| D4 | 3, 5 | How does the distress check behave? | A keyword hit shows the card straight away, with no model call. Otherwise one structured check runs on Haiku. If the model fails or times out, the keyword result stands and a `distress_check_unavailable` counter goes up. Safety checks are never capped or behind the paywall. They are metered for cost but don't count toward the reaction or split caps. TODO(founder): clinical review, including what happens when the check fails. |
| D5 | 5 | How do we block under-18 sign-ups on every path, not just the web form? | The other paths are the mobile app and direct calls to the Supabase API with the public key. Google OAuth is configured in `supabase/config.toml` but no app code uses it.<br>1. `POST /api/auth/age-check` runs `AgeVerifier`. On a pass it returns a single-use token that expires in 15 minutes. The date of birth is never stored.<br>2. The client passes the token in `signUp({ options: { data: { age_token } } })`.<br>3. A Supabase `before_user_created` hook looks up the token's hash in `age_verification_tokens`, rejects if it is missing, expired or used, and otherwise marks it used.<br>4. `handle_new_user` copies `age_verified_at` and the method into `user_coach_profiles`, and removes the token from the user's metadata.<br>The hook runs as `supabase_auth_admin`, which gets grants on the token table and nothing else. **With `pivot_a.enabled` off the hook lets every sign-up through**, so turning it on early is harmless. It must be enabled in each Supabase environment (TODO(founder)). The launch check asks you to confirm that by hand, because no script can verify it. |
| D6 | 5 | Existing beta accounts have no age verification. What happens to them? | Under Pivot A they see a one-time date-of-birth step before entering the app. An under-18 result blocks the app. What happens to that account needs a human decision, marked TODO(founder). |
| D7 | all | How much of this goes into the mobile app? | Pivot A screens ship on the web only. Mobile gets three things. First, shared contracts and API-client methods for the new endpoints. Second, a sign-up that calls the age-check route first, without which the D5 hook breaks mobile sign-up. Third, a written StoreKit/RevenueCat entitlement interface. Nothing native is built, because `ios/` is not tracked and no purchase code exists. |
| D8 | 8 | How do we run the end-to-end test without Playwright? | Playwright is not installed. Instead, a Vitest flow test runs against the **local Supabase stack**, so the real triggers, RLS and the age hook are exercised. Anthropic and Stripe are mocked. It walks through the age gate, character pick, first task, start, finish, reaction and paywall. It runs as `npm run test:e2e`, plus a new CI job (see §2). Playwright is a follow-up. |
| D9 | 1 | Do personas still react to shared wins under Pivot A? | No, because the spec says sharing is "people-only". With `pivot_a.enabled` on, `feature_flag_enabled()` returns false for the `AI_PERSONA_*` keys, so persona likes, replies, quotes and thread replies stop. |
| D10 | 1 | `share_win` is on but `social_feed` is off. Where do shared wins appear? | In a minimal people-only Wins view that reuses the existing "People only" feed mode with persona content filtered out, reachable from the share flow. The directory, persona pages and the full feed stay off. *Alternative:* sharing only works when `social_feed` is also on, which means it is effectively off by default under Pivot A. |
| D11 | 3 | How often does the AI reminder appear? | Once, on the first reaction of each local day, as the spec says. An optional `AI_DISCLOSURE_MAX_GAP_HOURS` (unset by default) can also re-show it after N hours. TODO(founder): the reminder's exact wording, and counsel confirming the cadence New York needs. |
| D12 | 6 | Does the trial need a card, and who sends the trial-end reminder? | A card is required to start the trial (Stripe Checkout with `trial_period_days=14`). The reminder comes from Stripe's built-in trial-ending email, which is a dashboard setting (TODO(founder)). We also record `customer.subscription.trial_will_end` and show an in-app banner from `trial_ends_at`. The app has no email provider apart from Supabase's auth email. |
| D13 | 1 | Can `persona_chat` and `persona_autopost` be turned on under Pivot A? | No. They are **forced off whenever `pivot_a.enabled` is on**, because they are guardrails. They can still be set per environment while Pivot A is off. *Alternative:* fully configurable, as a literal reading of "all configurable per environment" would suggest. |
| D14 | 8 | What happens to existing persona chat transcripts? | The spec says "There are no chat transcripts". By default the existing `chat_messages` data is left alone and chat is off under Pivot A. TODO(founder): decide on purging or retaining it before launch, and the launch check lists it. No data is deleted without your approval. |

---

## 2. What exists and what I'll reuse

| Area | What exists today | Plan |
|---|---|---|
| Auth | Supabase email/password. Google OAuth is configured in `supabase/config.toml` but no app code uses it. The browser calls `signUp` directly in `src/components/auth/auth-form.tsx`. `src/proxy.ts` refreshes sessions and protects routes, and `src/app/(app)/layout.tsx` checks again. API routes use bearer auth via `authed()`, `withApi`, `parseJson` and `enforceRateLimit` in `src/lib/server/`. | Reuse all of it. Add a date-of-birth step, the age-check route and the hook (D5). |
| Profiles | `user_profiles`, created by the `handle_new_user` trigger. Users can only write some columns, but every column is readable on visible profiles. | Pivot A fields go in a separate owner-only `user_coach_profiles` table. Only `selected_character_id` and `timezone` are writable, through the profile route, which checks them. |
| Onboarding | A three-step flow in `src/components/onboarding/onboarding-flow.tsx`: username and avatar, interests, visibility. Nothing records whether it was completed. | With Pivot A on, a new flow: age, character, timezone and the first task, then the paywall. The old flow stays as it is. |
| Tasks | The `tasks` table: `pending` or `completed`, private by default, recurring, with a `description` column that serves as the note. The `apply_task_completion` trigger sets XP and the streak. A rollover cron resets recurring tasks. The UI is `task-board.tsx`, backed by `/api/tasks` and `/api/tasks/[id]`. There is no concept of starting a task. | Reuse the table and the PATCH completion. Add start, finish and split routes. The finish trigger writes the event, so completions from mobile and the old PATCH count too. |
| Sharing | A post is only created when the user explicitly calls `publish_task_completion`, via `share-composer.tsx`. The feed has a "People only" mode. | Keep both behind `share_win`, people-only under Pivot A (D9, D10). |
| Personas | `social_companions` rows with avatars. Autoposting runs from cron through `reconcile_persona_engagements` to `schedule_companion_posts`, in SQL. Triggers queue engagement, which `src/lib/ai/worker.ts` runs. Persona chat runs synchronously in `src/lib/server/chat-reply.ts`. | Keep all of it, switched off under Pivot A. Launch characters are new `characters` rows, which can link to a persona to reuse its art. |
| AI provider | A hand-written OpenAI-compatible `fetch` client in `src/lib/ai/provider.ts`. It reads no token usage and does no caching. | Leave it for the legacy features. Pivot A adds a separate server-only client using the Anthropic SDK. |
| Flags | `app_feature_flags` with `feature_flag_enabled()`. Only SQL reads it, and a missing row means on. There is also `app_tuning_values`. | Reuse (Q2). |
| Analytics | `beta_product_events`: first-party, written by triggers, no content stored, no third-party SDKs. It dates events in UTC, and keeps only the first event per (`event_name`, `source_id`). | Extend it, using the task-event id as `source_id` so each recurring task's finishes all count. The experiment report reads `task_events.local_date`. |
| Rate limits | `api_rate_limits` with `check_rate_limit`. | Use it on every new route. |
| Cron | Vercel cron jobs authenticated with a `CRON_SECRET` bearer token. No pg_cron. | Add one combined daily Pivot A job. |
| Account deletion | `DELETE /api/account` purges storage, deletes the auth user, and lets foreign keys cascade the rest. It refuses whenever any billing env var is set. | Add Stripe cancellation. New tables cascade from the user. |
| Legal pages | `/privacy` and `/terms` still have starter copy ("Before public launch…"). There is no `/safety` page. | The launch check targets these. |
| Tests | Vitest: 527 tests covering domain logic, components (with jest-axe), and route handlers with Supabase mocked. pgTAP tests sit in `supabase/tests`, but the only script runs them against the remote project. 15 tests fail today because their expected copy is out of date, and `tests/components/task-board.test.tsx:97` is flaky. No Playwright. | Fix all of them in Phase 0. Add local-stack pgTAP and a flow test. |
| Mobile | An Expo SDK 57 app covering tasks and sharing. It signs in with Supabase directly and gets data through `@idobata/api-client`. `ios/` is not tracked, and there is no purchase code. | See D7. |
| CI | Lint, typecheck, tests, build, and the mobile checks. On `main` it also deploys migrations. | Add a `database-contract` job that runs `supabase start`, `supabase db reset`, `supabase test db` and `npm run test:e2e`, all against the local stack, with no secrets. CI already installs the Supabase CLI. |

---

## 3. Flags

All flag logic lives in one pure function, `resolveFlags()` in `src/lib/domain/feature-flags.ts`. SQL mirrors it in `pivot_flag_enabled()`, and tests cover both. A missing Pivot A flag row means **off**.

| Flag | Pivot A off (today) | Pivot A on |
|---|---|---|
| `pivot_a.enabled` | `false` (seeded explicitly) | `true` |
| `social_feed.enabled` | On | Off, unless you turn it on explicitly |
| `persona_chat.enabled` | On (configurable) | **Always off** (D13) |
| `persona_autopost.enabled` | On (configurable) | **Always off** (D13) |
| `share_win.enabled` | On | On, people-only (D9, D10) |

**Route gate map.** Phase 1 adds `src/lib/flags/route-gates.ts`, which assigns every route folder to exactly one flag, or to "always on". A test fails if any route under `src/app/api/**` or `src/app/(app)/**` is unassigned, so routes added later can't slip through.

This is the map as built in Phase 1. `src/lib/flags/route-gates.ts` is the source of truth; longest prefix wins.

- **`social_feed`**
  - Pages: `posts/*`, `activity`, `u/*`, `notifications`, `follow-requests`.
  - APIs: `posts`, `posts/[id]/{reactions,replies,repost}`, `replies`, `users`, `directory`, `follow-requests`, `progress`, `notifications`.
- **`wins`** (`social_feed` or `share_win`)
  - Page: `feed`, which runs people-only when `social_feed` is off.
  - APIs: `feed` and `posts/[id]`. The owner can make a win private or delete it from the Wins view; reading a post's detail page still needs `social_feed`.
- **`chat`** (`social_feed` or `persona_chat`)
  - Page and API: `chat`.
  - Each thread is checked separately: persona threads need `persona_chat`, human DMs need `social_feed`.
- **`persona_chat`**
  - Pages: `ai-personas`, `companions`.
  - APIs: `companions`, `chat/[id]/messages/retry`.
- **`persona_autopost`**: `cron/companions` and `workers`. Under Pivot A these return `skipped`, and jobs already queued stay queued; SQL finalization re-checks the flags.
- **`share_win`**: `tasks/[id]/publish`, the share page, and `uploads/completion-images`.
- **Always on**: `tasks`, `task-categories`, `profile`, `settings`, `account`, `feedback`, `health`, `analytics`, `blocks`, `reports`, `cron/rollover`, `companion-mutes` and `notification-preferences`.
  - `companion-mutes` stays on because muting is a safety control.
  - `notification-preferences` stays on because Settings loads it together with the profile; gating it would break Settings, including account deletion.

A route that is switched off returns 404, and its nav entry is hidden. Nothing is deleted.

---

## 4. Schema changes

Naming follows the existing schema:
- The spec's `reactions` table becomes `character_reactions`, so it doesn't clash with `social_reactions` (likes).
- Profile fields go on `user_profiles`.
- Every user-owned table references `user_profiles(id) on delete cascade`. The existing account deletion therefore covers it through the `auth.users` cascade.
- Writes go through `security definer` functions with `set search_path = ''`, or through the service role. Users can only read their own rows.

### Phase 1 migrations

| Table | Key columns | RLS |
|---|---|---|
| `characters` | `id`, `slug` (unique), `name`, `role` (coach, rival, cheerleader or deadpan), `art_url`, `is_launch`, `pack_sku` (nullable), `companion_id` (nullable, for persona art), `sheet` (jsonb, used to build the prompt), `active` | Signed-in users can read active rows. Only the service role can write. |
| `character_lines` | `id` (stable text, e.g. `sample-coach.task_started.001`), `character_id`, `event` (the 8 events), `text`, `min_streak`, `max_streak`, `task_age_bucket`, `tags`, `active` | RLS on, no client policy. The server picks lines. |
| `story_chapters` | `id`, `character_id`, `number` (unique per character), `title`, `body`, `unlock_rule` (jsonb) | RLS on, no client policy. The server only returns a body after checking it is unlocked. |
| `user_coach_profiles` (the spec's "profile additions") | `user_id` (primary key, references `user_profiles`), `selected_character_id`, `timezone` (must be a valid IANA zone; code treats null as UTC), `age_verified_at`, `age_verification_method`, `ai_arm` (`ai`, `prewritten` or null) | Users read only their own row and can't write it directly. The profile route checks and sets `selected_character_id` (must be active, and either a launch character or one whose pack the user owns) and `timezone`. These fields are kept off `user_profiles` because that table grants `SELECT` on every column, which would expose them on public profiles. |
| `task_events` | `id`, `user_id`, `task_id`, `type` (started or finished), `occurred_at`, `local_date` | Users read their own. Rows are written by `start_task()` and the finish trigger. |
| `character_reactions` | `id`, `user_id`, `task_event_id`, `character_id`, `source` (prewritten or ai), `line_id`, `text`, `disclosure_shown`, `created_at` | Users read their own. The server writes them. They are purged at 30 days. |
| `ai_usage_daily` | Primary key (`user_id`, `date`), where `date` is the user's local date. Columns: `reactions`, `splits`, `safety_checks`, `aborted_calls`, `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, `est_cost_usd` | Users read their own. Upserted through `record_ai_usage()`, service role only. |
| `story_progress` | Primary key (`user_id`, `character_id`). Columns: `consistency_days`, `unlocked_through`, `last_consistency_date` | Users read their own. Updated by the finish trigger. |
| `entitlements` | `user_id`, `product` (`plus` or `pack:<slug>`), `status`, `source` (stripe or app_store), `external_id`, `trial_ends_at`, `current_period_end`. Unique on (`user_id`, `product`, `source`). | Users read their own. Only the service role writes. |
| `safety_counters` | Primary key (`date`, `kind`). Columns: `count`. `kind` is `crisis_card_shown` or `distress_check_unavailable`. No user id and no text. | No user access at all. Incremented through a function only the service role can call. |
| `app_feature_flags` (new rows) | The five flags, seeded so today's behaviour is unchanged. `feature_flag_enabled()` returns false for `AI_PERSONA_*` only while Pivot A is on (D9). | Unchanged: service role only. |

### Functions added in Phase 1

- `pivot_flag_enabled(key)`
- `start_task(task_id)`
- `record_ai_usage(...)`
- `increment_safety_counter(kind)`
- A trigger that runs when a task's status changes to `completed`:
  - It exits immediately unless Pivot A is on.
  - It catches its own exceptions, so task completion can never fail because of it.
  - Otherwise it inserts a `finished` event in the user's local day, and on the first finish of a local day it increments `story_progress.consistency_days` for the selected character.

### Later small migrations

| Phase | Change |
|---|---|
| 5 | `age_verification_tokens`: token hash, method, expiry, consumed time. No user id and no date of birth. |
| 5 | The `before_user_created` hook function, which only acts when Pivot A is on |
| 5 | `handle_new_user` copies the age fields and strips the token. It is exception-safe and makes no other change to existing behaviour. |
| 5 | The hook block in `supabase/config.toml` (local stack only) |
| 6 | `billing_customers`: user id to Stripe customer id |
| 7 | New `beta_product_events` names, plus two content-free columns: `detail` (constrained, e.g. a reaction source) and `duration_seconds` |
| 7 | Report functions, service role only |
| 8 | `purge_expired_character_reactions()` |

---

## 5. Phases and the files they touch

### Phase 0: baseline and guard rails

- Cut the branch `pivot-a/character-coach`.
- Fix the 15 out-of-date tests (`tests/components/directory-search.test.tsx`, `tests/components/momentum-rail.test.tsx`) and the flaky `tests/components/task-board.test.tsx:97`. This touches tests only.
- Confirm that a local stack boots: `supabase start`, then `supabase db reset` (local), then `supabase test db` (local) with the existing pgTAP files. If the existing migrations or seed fail locally, I'll report that before going further.
- Commit `docs/pivot-a/SPEC.md` and `PLAN.md`.

**Phase 0 results**
- **Vitest:** 527/527 pass on two full runs. `task-board.test.tsx` passed 10 times in a row.
- **Lint and typecheck** pass for both web and mobile.
- **Local pgTAP:** 3/3 files pass with `npx supabase@2.115.0 test db`, the version CI uses. Three assertions in `rls_behavior.sql` had fallen behind the deliberate follow-request and private-profile-card changes in `20260828050000`, and were updated. No security regressions were found.
- **Fresh `db reset` is broken** at an existing migration (§6, item 16). The local stack was brought up by applying that one file inside a transaction by hand.

### Phase 1: data model and flags

**Phase 1 results and caveats carried forward**
- **Finish events:** a task gets at most one `finished` event per occurrence, keyed like XP awards. Marking a task done, undone and done again writes nothing more.
  - For date-only recurring tasks, the existing completion trigger keys occurrences by the database's UTC date. A daily task finished twice in one local day that crosses UTC midnight can therefore record two finishes. Consistency days still use the user's local date.
- **Deleting a task** cascades its events and reactions. This is privacy-first, but it lowers past metric counts.
- **Consistency days** only move forward from `last_consistency_date`. A finish dated earlier, for example after a time-zone change, isn't counted.
- **`start_task`** is limited to 60 calls a minute.
- **Phase 2 must fix the post-login landing page.** After login, users go to `/feed`. Under Pivot A with sharing off, that is a 404.
- **Copy needing review:** task-board's first-run copy still says "AI personas and other members can react". Phase 2 needs Pivot A copy here, marked TODO(founder).
- **Switched-off pages may return status 200.** They render the not-found page, but `(app)/loading.tsx` streams the response, so the page can return 200 with a noindex tag instead of a real 404. The APIs return real 404s.
- **Flag changes** take up to 30 seconds to reach each server instance.
- **Do not turn on `pivot_a.enabled` in any environment before Phase 8.** The 30-day purge of reaction text arrives in Phase 8; until then, reaction text would outlive the spec's retention limit.
- **The database enforces the persona guardrails itself**, so a failed flag read or a direct Supabase API call can't get around them (`20261031120200_pivot_a_persona_guards.sql`). Insert triggers:
  - silently skip AI-authored posts when `persona_autopost` is off, and AI-authored replies under Pivot A;
  - reject persona chat threads and messages when `persona_chat` is off.
  The TypeScript flag reader also fails closed for those two flags.
- **The cold-start fail-safe is a deliberate trade-off.** If a server instance has never read the flags and the read fails, it closes persona chat and autoposting but otherwise uses today's values for up to 5 seconds. For that window, Pivot A users could see the full feed, and persona jobs queued before the switch could start draining; the database guards still block persona output.
- **Known minor issues, deferred:**
  - With Pivot A off and `persona_autopost.enabled` explicitly false, a persona quote is still generated and then dropped by the guard, wasting one AI call.
  - Persona jobs queued before Pivot A drain all at once if Pivot A is later turned off.
  - The finish trigger's failures only go to the database log as warnings.
- **`characters.sheet` is service-role only.** Signed-in reads of `characters` must name their columns, because `select("*")` fails. Phase 2 must follow this.

**Migrations**
- `supabase/migrations/20261031120000_pivot_a_feature_flags.sql`
- `supabase/migrations/20261031120100_pivot_a_core_schema.sql`

**Types and flag code**
- Hand-edit `src/types/database.ts` in its current style. Regenerating it needs the linked project.
- `src/lib/domain/feature-flags.ts`: the pure resolver.
- `src/lib/flags.ts`: server-only, cached.
- `src/lib/flags/route-gates.ts`
- `scripts/flags.mjs`, run as `npm run flags`.

**Gates**
- `app-shell.tsx`: navigation follows the flags.
- `src/app/(app)/layout.tsx`: passes the flags down.
- Every route in the §3 gate map.
- `src/app/api/cron/companions/route.ts`
- `src/lib/ai/worker.ts` and `src/app/api/workers/ai/route.ts`: cancel queued persona jobs under Pivot A.
- `share-composer.tsx`: people-only under Pivot A.

**Tests**
- `tests/domain/feature-flags.test.ts`
- `tests/domain/route-gates.test.ts`: every route is assigned to a gate.
- Integration tests showing that gated routes return 404.
- `supabase/tests/pivot_a_contract.sql`: RLS is on and only the user's own rows are visible, for every new table; with the flag off, completing a task writes no event and never fails; with the flag on, the event and consistency day are written.

### Phase 2: character content, character pick, profile disclosure

**Content**
- `content/characters/schema/{sheet,lines,chapters}.schema.json`: generated from Zod with `z.toJSONSchema`. A test fails if they drift.
- `content/characters/sample-coach/{sheet,lines,chapters}.json`: about 20 lines across all 8 events and 3 chapters, each marked as placeholder.

**Code**
- `src/lib/characters/content-schema.ts`
- `src/lib/characters/lint.ts`: checks that every required event is covered, that every line is under 40 words, that no banned phrases appear, and that chapters are numbered without gaps.
- `src/lib/characters/banned-content.ts`: shared with the AI output validator.
- `scripts/seed-characters.mjs`, run as `npm run content:seed`. It is idempotent: it upserts by slug and line id, and deactivates removed lines. It has a `--dry-run` option.

**Character pick**
- `src/components/coach/character-picker.tsx`
- `src/app/(app)/characters/[slug]/page.tsx`: the character profile.
- `src/components/coach/ai-disclosure.tsx`: the spec's exact line, "AI character · not a person · not a therapist, doctor or lawyer", shown on every profile and on the picker card the user meets first.

**Onboarding**
- `src/components/onboarding/pivot-onboarding.tsx`, chosen by `src/app/onboarding/page.tsx` when the flag is on.
- Steps in this phase: pick a character, then capture the timezone automatically with `Intl.DateTimeFormat().resolvedOptions().timeZone` (shown, and editable in settings). Phase 5 adds the age step and Phase 6 adds the paywall step.
- `PATCH /api/profile` accepts `selectedCharacterId` and `timezone` and checks them on the server.
- Under Pivot A, `(app)/layout.tsx` sends users without a character or timezone to onboarding.

**Tests**
- Lint every character folder.
- Confirm the linter catches each kind of mistake.
- Picker and disclosure component tests, including accessibility.
- The profile route rejects inactive characters, pack characters the user doesn't own, and invalid time zones.

### Phase 3: reaction engine, splitter, plan resolution, crisis routing

**New dependency:** `@anthropic-ai/sdk`.

**AI client and prompt**
- `src/lib/ai/anthropic.ts`: server-only. Uses `claude-haiku-5-5` with `timeout: 2500`, `maxRetries: 0`, thinking disabled, `max_tokens: 120` and no temperature.
- `src/lib/reactions/prompt.ts`: fills the spec's template from the character sheet as one cached system block.

**Plan and arm**
- `src/lib/billing/plan.ts`: `getPlan(userId)` reads `entitlements` and returns free, trial or plus, plus any packs. Stripe only writes that table later, in Phase 6.
- `src/lib/experiments/ai-arm.ts`: sticky assignment by hash, written to the profile the first time a Pivot A request comes in (D1).

**Safety**
- `src/lib/safety/distress.ts`: a `DistressDetector` interface and a keyword-plus-model implementation, with `TODO(founder): clinical review of distress protocol (SB 243 requires evidence-based methods)`.
- `src/lib/safety/keywords.ts`
- `src/components/safety/crisis-card.tsx`: 988 by call or text, and 911 for immediate danger. It makes no promise of confidentiality. TODO(founder): copy review.

**Engine**
- `src/lib/reactions/engine.ts`: `getReaction(userId, taskEventId)`. In order:
  1. Pick the prewritten line first.
  2. Run the distress check (D3). If it flags, return the crisis card and increment the counter; no banter.
  3. If AI is allowed, race the AI call against the timeout.
  4. Validate the output. On failure, refusal or timeout, use the prewritten line. On `SAFETY_ESCALATE`, return the crisis card.
  5. Record the reaction and the usage.
  6. Attach the disclosure on the first reaction of the local day.
- When a call is aborted at 2.5 s, no token usage comes back, so its cost is recorded as an estimate: input tokens from the prompt size, output tokens at `max_tokens`. It is counted in `aborted_calls`.
- `src/lib/reactions/splitter.ts`: `splitTask(userId, taskId)`, using structured JSON output (`{ steps: [3 × ≤12 words] }`) and introduced by a `split_intro` line.

**Pure logic, all unit tested**
- `src/lib/domain/local-day.ts`
- `src/lib/domain/reaction-caps.ts`: 30 reactions and 10 splits per local day for Plus or trial; 3 per rolling 7 local days for free; resets at local midnight.
- `src/lib/domain/ai-cost.ts`
- `src/lib/domain/line-selection.ts`: matches event, streak range and task-age bucket, and avoids the user's last 20 lines.
- `src/lib/domain/reaction-validator.ts`: 60 words or fewer, mentions the task, no banned content, and recognises `SAFETY_ESCALATE`.

**Routes**
- `src/app/api/tasks/[id]/start/route.ts`
- `src/app/api/tasks/[id]/finish/route.ts`: same status update as PATCH, and returns the reaction.
- `src/app/api/tasks/[id]/split/route.ts`
- Contract schemas go in `packages/contracts`, with matching methods in `packages/api-client`.

**UI (only when Pivot A is on)**
- `reaction-bubble.tsx`
- `split-steps.tsx`
- Start, finish and split controls in `task-board.tsx`.
- The task updates straight away; only the reaction bubble shows a "typing" state, for at most about 2.6 s.

**Tests**
- Unit tests for every module above, including that a `prewritten` arm forces prewritten for every plan.
- `tests/integration/reaction-engine.test.ts`, with the SDK mocked and fake timers:
  - an AI timeout falls back to prewritten in under 3 s;
  - a refusal falls back;
  - invalid output falls back;
  - `SAFETY_ESCALATE` shows the crisis card;
  - distress text in the task suppresses banter and increments only the counter;
  - an aborted call is still metered.
- `tests/integration/task-split.test.ts`

### Phase 4: story, session nudge, no-guilt streaks

**Pure logic**
- `src/lib/domain/story-unlock.ts`: chapter n needs n consistency days. Free users get chapters 1–3, Plus users get all, and a pack unlocks that character's full arc.
- `src/lib/domain/consistency.ts`: positive-only progress, and comeback detection after a gap.

**Routes**
- `src/app/api/story/route.ts`: chapter list with lock state.
- `src/app/api/story/[number]/route.ts`: returns a chapter body only if it is unlocked, and records `chapter_unlocked`.

**UI**
- `src/app/(app)/story/page.tsx` and `src/components/coach/story-list.tsx`
- `session-nudge.tsx`: counts 10 minutes of foreground time per session, pausing on `visibilitychange`, then shows a prewritten `session_nudge` line.
- Under Pivot A, the streak badges in `task-board.tsx`, `app-shell.tsx` and `momentum-rail.tsx` show consistency days instead.

**Tests**
- Chapter unlock rules.
- The comeback after a gap.
- The nudge timer (component test with fake timers), including a check that it ignores background time.

### Phase 5: age gate, create/edit distress check, `/safety`

**Age gate**
- `src/lib/domain/age.ts`: pure age-from-date-of-birth, including the 18th birthday falling today and leap days.
- `src/lib/age/verifier.ts`: the `AgeVerifier` interface and `SelfAttestedVerifier`.
  - The factory refuses the self-attested verifier only when `APP_ENV=production`, falling back to `VERCEL_ENV=production`. `NODE_ENV` isn't enough, because Vercel previews and staging also run with `NODE_ENV=production`.
  - TODO(founder): choose provider.
- `src/app/api/auth/age-check/route.ts`
- The token table, hook and `handle_new_user` migration (D5).
- `auth-form.tsx` gets a date-of-birth field when Pivot A is on.
- `apps/mobile/src/app/(auth)/sign-in.tsx` calls the age-check route first.
- An age step for existing accounts (D6). TODO(founder): the wording of the under-18 block message.

**Distress check on create and edit**
- `src/app/api/tasks/route.ts` and `src/app/api/tasks/[id]/route.ts` run the Phase 3 detector on the title and `description`.
- When it flags, the response includes `safety: { crisisCard: true }`, the UI shows the card instead of any banter, and the counter goes up.
- Nothing is stored about the result (D3).

**Safety page and disclosure**
- `src/app/safety/page.tsx`: placeholder copy describing the protocols, carrying a machine-readable `PLACEHOLDER: counsel review` marker.
- An end-to-end check that the first-meeting disclosure appears in onboarding.

**Tests**
- Age-gate boundaries.
- The age-check route: under-18 returns no token and stores nothing.
- The hook in pgTAP: no token is rejected; expired and reused tokens are rejected; everything is allowed when Pivot A is off.
- The task routes show the crisis card and increment the counter with no text stored.

### Phase 6: billing and entitlements

**New dependency:** `stripe`. I'll check the current Stripe guidance first.

**Server**
- `src/lib/billing/stripe.ts`
- `src/lib/billing/entitlement-sources.ts`: an `EntitlementSource` interface with Stripe and App Store as sources.
- `src/app/api/billing/checkout/route.ts`: subscription mode for Plus with a 14-day trial, and payment mode for packs. Price ids come from env vars.
- `src/app/api/billing/portal/route.ts`: cancellation goes through Stripe's customer portal.
- `src/app/api/billing/webhook/route.ts`: verifies the signature, then upserts `entitlements` on `checkout.session.completed`, `customer.subscription.*` and `customer.subscription.trial_will_end`. Replayed events are ignored.

**Account deletion**
- `src/app/api/account/route.ts`: replace the env-var guard with a cancellation adapter. It cancels active Stripe subscriptions, then deletes the account.
- App Store subscriptions don't block deletion; the user is shown how to cancel them. TODO(founder): that copy.

**UI**
- `src/components/billing/paywall.tsx`: the trial is the default path, and "continue free" is clearly visible. TODO(founder): paywall and auto-renewal disclosure copy.
- The paywall appears as an onboarding step.
- Settings gets "Manage subscription".
- There are no random-draw purchases.

**iOS**
- `docs/pivot-a/IOS_ENTITLEMENTS.md` describes how StoreKit 2 or RevenueCat server notifications will write the same `entitlements` rows.
- The entitlement schema goes in `packages/contracts`.

**Tests**
- `tests/integration/stripe-webhook.test.ts`: mocked signature and events cover trial, paid, cancelled, a pack purchase and replays.
- A test for cancellation during account deletion.

### Phase 7: metrics, experiment, cost guardrail

**Migration**
- New event names, all using the task-event id or a row id as `source_id`: `task_started`, `task_finished`, `reaction_shown` (with source), `split_used`, `chapter_unlocked`, `paywall_viewed`, `trial_started`, `purchase`, `session_length`.
- Report functions:
  - `report_ai_arm()`: tasks finished per user per local week (from `task_events`), and day-14 retention, for each arm and plan.
  - `report_ai_cost()`: average AI cost per paying user per month, and the share of users at their caps.

**Code**
- `src/lib/analytics/events.ts`
- `src/app/api/analytics/session/route.ts`: receives `session_length` via `sendBeacon`, as a duration only.
- `scripts/report.mjs`, run as `npm run report:experiment` and `npm run report:cost`. It uses the service role, so it is admin-only by construction.

**Daily cron**
- `src/app/api/cron/pivot-a-daily/route.ts`, plus an entry in `vercel.json`.
- It logs a warning when projected AI cost per paying user goes above `AI_COST_ALERT_PER_PAYING_USER_USD` (default 0.66).

**Tests**
- Arm assignment is deterministic and roughly 50/50.
- The cost projection and its threshold warning.
- The analytics route accepts only allowed event names.
- Recurring tasks are counted every time they are finished.

### Phase 8: retention, deletion, launch check, handoff

**Purge**
- A migration adds `purge_expired_character_reactions()`.
- The daily cron calls it, deleting reactions older than 30 days.

**Account deletion**
- pgTAP checks that deleting a user removes their rows from every new table.
- An integration test covers the extended route.

**Launch check**
- `scripts/launch-check.mjs`, run as `npm run launch-check`, prints a numbered list of everything still to fix. It fails when:
  - `/privacy` or `/terms` still contain template text;
  - the production verifier factory can choose `SelfAttestedVerifier`, or it is the only verifier;
  - `/safety` still carries its placeholder marker;
  - any `TODO(founder)` remains under the folders it scans;
  - `docs/pivot-a/LAUNCH_CONFIRMATIONS.md` still has unticked manual items: the age hook enabled per environment, Stripe's trial reminder email on, and the decision on legacy chat transcripts (D14).
- It scans `src/app/{privacy,terms,safety}`, `src/app/api/{billing,account,auth}`, `src/lib/{safety,age,billing,reactions}`, `src/components/{safety,billing,coach}`, `content/characters`, and `supabase/migrations/*pivot_a*`.
- `tests/integration/launch-check.test.ts` runs it against a fixture that fails and one that passes. The real repo's failing output today is recorded in `HANDOFF.md`, so CI won't break once the items are fixed.

**CI and handoff**
- Add the `database-contract` CI job (§2), which runs `npm run test:e2e`.
- Write `docs/pivot-a/HANDOFF.md` as the brief specifies.

---

## 6. Conflicts and the smallest change for each

1. **Migrations reach production automatically.** See Q1. Migrations are additive, inert with the flag off, and tested on a local stack.

2. **Account deletion and billing clash.** Deletion currently refuses (409) whenever a Stripe or billing env var is set, so switching on Stripe would switch off account deletion. Phase 6 replaces that guard with a real cancellation step.

3. **Haiku 5.5 has API limits the spec doesn't mention.**
   - Thinking is on by default, and with `max_tokens` around 120 it can use up the output, so it is disabled. That is allowed at the default `medium` effort.
   - Any non-default `temperature` returns a 400.
   - Assistant prefill isn't allowed.
   - Refusals have no server-side fallback, so `stop_reason: "refusal"` falls back to prewritten.
   - The SDK's retries would multiply the 2.5 s timeout, so they are turned off.
   - This adds `@anthropic-ai/sdk`. The existing provider stays for the legacy features.

4. **Prompt caching may never kick in.** Haiku 5.5 only caches prompts of at least 512 tokens. The draft system prompt is about 150 tokens; below 512, caching silently does nothing. I'll mark the template and sheet as one cached block and log the cache-read token count. `est_cost_usd` will include cache writes (1.25× the input price) and cache reads (0.1×) through two extra price settings. Real character sheets will probably pass 512.

5. **Aborted calls don't report usage.** A call aborted at 2.5 s returns no token counts, so I estimate them (Phase 3) and count the call in `aborted_calls`.

6. **Older product docs disagree.** `PRODUCT.md` says "do not add billing or paid gates", and `ARCHITECTURE.md` describes persona autoposting as core. This spec overrides them when the flag is on. `HANDOFF.md` will list the sections that no longer apply.

7. **Today's streak doesn't fit "no guilt".** `current_streak` resets to 1 after a gap and uses the database date, not the user's local day. Under Pivot A the badge shows positive-only consistency days instead. The old streak is untouched when the flag is off.

8. **There is no "start".** Starts are recorded in `task_events` rather than as a new task status, so the mobile app and existing APIs keep working.

9. **Legacy onboarding defaults wins to Community.** `onboarding-flow.tsx:25` defaults the posted-wins audience to Community, but the database default is private. Pivot A onboarding doesn't ask this. I'll leave legacy onboarding alone unless you want the one-line fix.

10. **There is no admin role.** Reports are service-role SQL functions run through `npm run report:*`. The cost warning goes to the logs.

11. **Persona count.** I can't confirm the spec's 27 from the migrations. It doesn't block anything, because the launch cast is new `characters` rows.

12. **Vercel cron limits.** There are already three daily jobs. Pivot A adds a single combined job.

13. **"Never block the UI".** The task changes on screen straight away. The prewritten line is chosen before the AI call starts, so falling back when the 2.5 s timer wins is instant.

14. **Story progress is per character.** The spec keys `story_progress` on (user, character), so switching characters starts that character's arc at 0.

15. **Chat transcripts already exist.** The spec says there are none, but `chat_messages` is already in the database. See D14.

16. **A fresh database rebuild fails (found in Phase 0).** `supabase db reset` stops at `20260821012000_neutral_ai_follow_relationships.sql` with `LOCK TABLE can only be used in transaction blocks`, on both CLI 2.75 and CI's 2.115. The remote project already has this migration, so it is unaffected. But a clean local stack, which the planned CI `database-contract` job needs, cannot be built from scratch.
    - **Resolved (founder approved, Phase 1):** that one `lock table` statement is now wrapped in a `do $$ begin … end $$;` block. Behaviour is unchanged, and remote history only records version numbers. A fresh `supabase db reset` now completes and all pgTAP files pass.

---

## 7. TODO(founder) list

This list grows phase by phase. Every item will also be marked `TODO(founder)` in the code.

- Choose the age-verification provider, and turn on the `before_user_created` hook in each Supabase environment.
- Decide what happens to existing under-18 accounts, and the wording of the under-18 block message.
- Get a clinical review of the distress protocol (keywords, model check, behaviour when the check fails).
- Get counsel to review the privacy, terms and `/safety` pages, the crisis card copy, and the daily AI reminder wording and cadence (New York).
- Write the final character copy (300+ lines and 30 chapters per character) and pick the 3–5 launch characters.
- Set up Stripe: products, prices, the trial, the customer portal, the trial-ending reminder email, and the webhook endpoint. Write the paywall and auto-renewal disclosure copy.
- Set up App Store products, and write the App Store cancellation instructions shown when an account is deleted.
- Decide whether to purge or keep the legacy persona chat transcripts (D14).

---

## 8. How each phase is verified

- **Domain logic** gets unit tests: caps, cost, line selection, the validator, unlock rules, comeback, age, flags and the route gate map.
- **Route handlers** get integration tests with Supabase, Anthropic and Stripe mocked, following `tests/integration/`.
- **New SQL** gets pgTAP tests on the local stack, covering RLS, flag-off behaviour, the finish trigger, the age hook and the deletion cascade. Since Phase 8 these also run in CI.
- **The onboarding flow** gets an end-to-end test against the local stack (D8).
- **Review:** after each phase, a separate reviewer subagent goes over the diff before the commit.
