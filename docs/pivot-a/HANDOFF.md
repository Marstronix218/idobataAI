# Pivot A, "Character Coach": handoff

**Branch:** `pivot-a/character-coach`. It is not pushed and not merged.
**Spec:** [SPEC.md](SPEC.md). **Plan and every decision:** [PLAN.md](PLAN.md).

Everything below sits behind feature flags. With `pivot_a.enabled` off, which is the default, the app behaves as it does today.

Billing (Phase 6) was **skipped by founder decision**. The plan is to run a free beta for testers, with the `beta_full_access.enabled` flag giving everyone Plus-level access.

---

## 1. What shipped

| Phase | Commit | What it adds |
|---|---|---|
| 0 | `e3475a7` | Spec and plan. 15 stale tests and one flaky test fixed. Out-of-date pgTAP assertions repaired. |
| 1 | `ba03ca9` | The Pivot A tables, with row-level security and users reading only their own rows. The flag system (`npm run flags`). A gate map covering every route. Database-level persona guardrails. A trigger that records task finishes once per occurrence. |
| 2 | `4aa443a` | The character content system and linter. One placeholder sample character and the seed script. Character pick in onboarding. The AI disclosure on character profiles and at first meeting. |
| 3 | `878af1c` | The reaction engine (Claude Haiku 5.5, server-side, falls back to prewritten lines in under 3 seconds). Atomic AI caps. The distress check and crisis card. The task splitter. Cost metering on every AI call. |
| 4 | `02b2ee0` | Story chapters that unlock by consistency days, never by time in the app. A session nudge after 10 minutes. A days count that only goes up. |
| 5 | `b771f9d` | The 18+ age gate: date of birth at sign-up, a single-use token, a database hook and a backstop trigger. The distress check on task create and edit. A placeholder `/safety` page. |
| 6 | — | Skipped. The unfinished Stripe work is in `git stash` (see §9). |
| 7 | `45bfd09` | First-party metrics, the `ai_arm` experiment report, the cost report and alert, a global AI spend breaker, and the `beta_full_access` flag. |
| 8 | (this commit) | The 30-day purge. Account-deletion coverage for every new table. `npm run launch-check`. A CI database job. The end-to-end onboarding test. |

**Test status at handoff:**
- Lint and typecheck pass for web and mobile.
- 1,991 unit and integration tests pass.
- The production build passes.
- 13 pgTAP files pass on a freshly rebuilt local database.
- The end-to-end onboarding suite passes 9 of 9 against the real local stack.

Every phase was reviewed by separate code reviewers; phases 1, 3 and 5 also got a security review. Each review's findings were fixed and re-checked before its commit.

---

## 2. Acceptance criteria

| Criterion | Status |
|---|---|
| A new US adult can sign up (18+ verified), pick a character, add, start and finish a task, and see a reaction that names the task | ✅ Covered by `npm run test:e2e`. On a brand-new account, the very first finish unlocks chapter 1, so its line comes from the `chapter_unlocked` pool, which never names the task. Later reactions do. Make sure the real copy covers this. |
| Free users get prewritten reactions plus at most 3 AI reactions per 7 days; Plus/trial get AI up to the caps, then prewritten | ✅ Enforced atomically in the database (`reserve_ai_usage`). There is no billing, so only `beta_full_access` produces Plus today. |
| AI failures or timeouts never show an error and fall back in under 3 s | ✅ Tested with a mocked model that never answers. |
| Distress text shows the crisis card, suppresses banter and increments only an aggregate counter | ✅ Applies to start, finish, split, create and edit. Nothing about the text is stored. |
| AI disclosure on character profiles and once per local day | ✅ The exact spec line is used everywhere. |
| Chapters unlock by consistency days, never by time in the app | ✅ |
| Persona feed autoposting and open-ended persona chat are off under Pivot A | ✅ Enforced in the routes and in the database. |
| Stripe trial → paid flow writes entitlements; cancellation works | ❌ **Not met by design.** Billing was skipped. The `entitlements` table, plan rules and analytics triggers are ready for a later integration. |
| The cost meter records tokens and estimated cost for every AI call; the admin report works | ✅ `npm run report:cost` |
| Reactions older than 30 days are purged; account deletion covers all new tables | ✅ A daily cron does the purge. A pgTAP test catches any future table that doesn't cascade on deletion. |
| `npm run launch-check` fails today and lists exactly what to fix | ✅ 49 items today (§7). |
| All tests pass in CI | ⚠️ The new `database-contract` CI job is written but hasn't run on GitHub yet, because nothing has been pushed. Every step passes locally. |

---

## 3. Turning on the beta in an environment

Do these in order. The first five are required before any tester signs up.

1. **Apply the migrations.** On staging this happens automatically on the next `npm run dev` or merge to `main`, because the linked project is staging. All migrations are additive and change nothing while `pivot_a.enabled` is off. Try them on a hosted branch first: the age gate adds triggers on Supabase's own `auth.users` and `auth.identities` tables.
2. **Enable the Before User Created hook.** In Supabase, go to Authentication → Hooks → Before User Created and choose the Postgres function `public.hook_before_user_created`. The database backstop blocks token-less sign-ups even without it, but the hook gives users a friendly error.
3. **Set the environment variables** (see §4):
   - `ANTHROPIC_API_KEY`
   - `AI_DAILY_SPEND_LIMIT_USD`
   - `APP_ENV` (`staging` or `production`)
   - `CRON_SECRET`
   - On **staging only**, `ALLOW_SELF_ATTESTED_AGE=true` for the beta.
4. **Set a spend limit on the Anthropic workspace** in the Anthropic Console, as a second cost backstop.
5. **Seed characters** (§5). Pivot A onboarding needs at least one selectable character.
6. **Turn on the flags:**
   ```
   npm run flags -- set pivot_a.enabled true
   npm run flags -- set beta_full_access.enabled true
   npm run flags          # shows every flag's effective value
   ```

**Turning it off:** run `npm run flags -- set pivot_a.enabled false`. Flags reach every server instance within about 30 seconds.

Before any **production** use, a real age-verification provider is required. Production refuses self-attestation, so until one exists, Pivot A sign-up stays closed there.

---

## 4. Flags and environment variables

### Flags (table `app_feature_flags`, one set per Supabase project)

| Flag | Default | Effect |
|---|---|---|
| `pivot_a.enabled` | off | Turns on everything in Pivot A. |
| `social_feed.enabled` | on today; **off under Pivot A** unless set | Controls the feed, notifications, profiles, follows and human DMs. |
| `persona_chat.enabled` | on today; **always off under Pivot A** (guardrail) | Controls persona chat, the AI persona pages and the companion APIs. |
| `persona_autopost.enabled` | on today; **always off under Pivot A** (guardrail) | Controls the persona posting cron. Database triggers also skip AI posts. |
| `share_win.enabled` | on | Controls "Post the win". Under Pivot A it is people-only: the default audience is "Only me" and personas don't engage. |
| `beta_full_access.enabled` | off | Only takes effect under Pivot A. Gives every user Plus-level access: 30 AI reactions a day, 10 splits a day and every chapter. Packs are not included. |

### New environment variables (all listed in `.env.example`)

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Server-only key for reactions, splits and the distress check. Without it, reactions use prewritten lines and the distress check uses keywords only. |
| `AI_ENABLED` | The existing kill switch. `false` stops every AI call. |
| `AI_REACTION_TIMEOUT_MS` (2500), `AI_SPLIT_TIMEOUT_MS` (5000) | Model time budgets. |
| `AI_PRICE_INPUT_PER_MTOK` (0.10), `AI_PRICE_OUTPUT_PER_MTOK` (0.50), `AI_PRICE_CACHE_WRITE_MULTIPLIER` (1.25), `AI_PRICE_CACHE_READ_MULTIPLIER` (0.1) | Prices used for the cost estimate. |
| `AI_CAP_PLUS_DAILY_REACTIONS` (30), `AI_CAP_PLUS_DAILY_SPLITS` (10), `AI_CAP_FREE_WEEKLY_REACTIONS` (3) | Caps. A failed AI call never uses one up, and attempts are capped at twice the limit. |
| `AI_DISCLOSURE_MAX_GAP_HOURS` (unset) | Optional. Shows the AI reminder again after N hours, in addition to once per local day. |
| `AI_DAILY_SPEND_LIMIT_USD` (unset = off) | Global breaker. Once today's UTC spend reaches it, reactions use prewritten lines and splits pause. Safety checks keep running. **Set this before turning on `beta_full_access`.** |
| `AI_COST_ALERT_PER_PAYING_USER_USD` (0.66) | The daily cron warns above this. While nobody pays, it compares against cost per active user over 30 days instead. |
| `AGE_VERIFIER` (`self_attested`) | Which age-verification provider to use. TODO(founder): choose a real provider. |
| `ALLOW_SELF_ATTESTED_AGE` | Must be `true` to allow self-attestation, and only works in a non-production `APP_ENV`. Never set it in production. |
| `APP_ENV` | `development`, `dev`, `local`, `test`, `staging` or `preview` count as non-production. Anything else, or a typo, counts as production. On Vercel production, only `staging` or `preview` count as non-production. |
| `CLIENT_IP_HEADER` | Only for hosting outside Vercel: the trusted client-IP header used for rate limits. |
| `CRON_SECRET` | Existing. Also protects the new daily job, `/api/cron/pivot-a-daily`, which runs at 00:20 UTC. |

**Keep these unset:** `BILLING_PROVIDER`, `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`. If any of them is set, account deletion refuses to run, because no step exists yet to cancel a subscription first.

---

## 5. Running locally and seeding content

- **Rule:** never run `npm run dev` or `npm run db:*` unless you mean to push migrations to the linked (staging) project. `predev` runs `supabase db push --linked --yes`.
- **Local database:**
  ```
  npx --yes supabase@2.115.0 start
  npx --yes supabase@2.115.0 db reset
  npx --yes supabase@2.115.0 test db     # 13 pgTAP files
  ```
- **App checks:**
  ```
  npm run lint && npm run typecheck && npm test && npm run build
  npm run test:e2e                        # needs the local stack
  ```
- **Seeding characters:**
  ```
  npm run content:seed -- --dry-run
  npm run content:seed
  ```
  - The seed runs the same linter as the tests.
  - It upserts characters, lines and chapters, and retires anything removed. It never deletes.
  - It refuses to send placeholder characters to a non-local database unless you pass `--allow-placeholder`. Use that only for a staging beta.
  - The launch cast is Akari, North, Ember, Kage and Vex, reusing the existing personas' art (`companion_slug`). Their copy is a DRAFT (`"placeholder": true`) awaiting founder review, so seeding staging needs `--allow-placeholder` until it is final.
  - `sample-coach` is retired (`"active": false`). The e2e setup turns it back on, on the local stack only.
- **Writing real characters:** the content format and lint rules are in [content/characters/README.md](../../content/characters/README.md). The spec asks for 300+ lines and 30 chapters per character, and a launch cast of 3–5 picked from the existing personas.

---

## 6. Reading the reports

Both scripts use the service role, so only someone with the key can run them. Add `--json` for machine-readable output.

- **`npm run report:experiment`:** tasks finished per user per week, and day-14 retention, for each `ai_arm` and plan tier.
  - Day 0 is the user's first Pivot A activity.
  - A user counts as retained with any task event or session on local days 14–20.
  - Beta testers show as "free" because tier comes from entitlements; the report notes when `beta_full_access` was on.
- **`npm run report:cost [--month YYYY-MM]`:** total AI cost, cost per paying user (active Plus or packs only, not trials), cost per active user over 30 days, and the share of users at their caps. Under `beta_full_access`, the caps are judged as Plus caps.

The daily cron logs a structured warning when cost goes above the alert threshold or approaches the spend limit. It never logs user ids or content.

---

## 7. `npm run launch-check`

It fails today with **53 items**, grouped as:

| Group | Items |
|---|---|
| Starter template text in privacy, terms and settings | 4 |
| Age verification still self-attested | 3 |
| `/safety` still a placeholder | 3 |
| `TODO(founder)` markers anywhere in app, mobile, content and Pivot A migration code (§8) | 30 |
| Launch characters still on draft (placeholder) copy | 5 |
| Unticked manual confirmations in [LAUNCH_CONFIRMATIONS.md](LAUNCH_CONFIRMATIONS.md) | 8 |

Run it any time for the exact list with file and line numbers. It makes no network or database calls.

---

## 8. Every `TODO(founder)` item

**Decisions and setup**
- Choose an age-verification provider (`src/lib/age/verifier.ts:66`), and enable the hook in every hosted project (`supabase/migrations/20261031180000_pivot_a_age_gate.sql:16`).
- Decide on a policy for existing accounts that turn out to be under 18 (`src/components/onboarding/pivot-onboarding.tsx:66`).
- Get a clinical review of the distress protocol: keywords, the model check, refusals counted as "possible", and the 300-per-day cap on model checks (`src/lib/safety/distress.ts:23`, `src/lib/safety/keywords.ts:5`).
- Have counsel confirm the AI reminder wording and cadence for New York (`src/lib/reactions/engine.ts:373`).
- Review and expand the launch cast's copy. The cast is Akari, North, Ember, Kage and Vex (`content/characters/<slug>/`), with DRAFT copy (`"placeholder": true`, 26 lines and 3 chapters each). The spec asks for 300+ lines and 30 chapters each. Set `"placeholder": false` in all three files once the copy is final.
- Set up Stripe and App Store products. This is deferred, since billing was skipped. The stashed Phase 6 work (§9) includes a draft `docs/pivot-a/IOS_ENTITLEMENTS.md` describing how App Store purchases would write the same `entitlements` table.
- Decide whether to purge or keep the legacy persona chat transcripts (D14).

**Copy needing review** (clinical and counsel where marked)
- Crisis card, web and mobile: `src/components/safety/crisis-card.tsx:32`, `apps/mobile/src/features/safety/crisis-notice.tsx:8`.
- `/safety` copy and contact details: `src/app/safety/page.tsx:24, 58, 59`.
- Under-18 block message and date-of-birth hint: `src/components/auth/auth-form.tsx:112, 130`, `apps/mobile/src/app/(auth)/sign-in.tsx:214`.
- Onboarding copy (why we ask your age, introducing the cast, why the time zone matters): `src/components/onboarding/pivot-onboarding.tsx:179, 187, 193`.
- Story lock notes, Plus notices and empty states: `src/components/coach/story-list.tsx:20, 24, 87, 97, 104, 126`, `src/components/coach/split-steps.tsx:73, 79`.
- Labels: `src/components/coach/consistency-days.tsx:12`, `src/components/layout/momentum-rail.tsx:93`, `src/components/coach/character-picker.tsx:45`, `src/components/settings/coach-settings.tsx:73`.
- Pivot A first-run copy on the task board: `src/components/tasks/task-board.tsx:731`.
- The privacy notice and terms are still starter copy and need counsel-reviewed replacements.

---

## 9. Known issues and risks

1. **Billing is not implemented.** The unfinished Phase 6 work is in `git stash` as "pivot-a phase 6 billing (skipped by founder, unfinished)". `git stash list`, then `git stash apply stash@{N}`, brings it back. It was never reviewed or finished.
2. **`next@16.3.0` has critical security advisories,** including unauthenticated remote code execution in Image Optimization, and `zod` has a high one. Both predate this work. Upgrade `next` to 16.4.3 or later.
3. **Fresh Supabase projects lack server-role grants on legacy tables.** The current Supabase image no longer gives `service_role` access to tables created without explicit grants. Pivot A adds the two grants it needs (`tasks`, and `account_deletion_requests` for account deletion). About 20 legacy tables used by the old social worker (for example `user_profiles` and `social_posts`) would fail on a brand-new project. The existing staging project is unaffected.
4. **The Phase 1 migrations cross a UTC boundary for date-only recurring tasks.** Such a task finished twice in one local day that crosses UTC midnight can record two finishes. Consistency days are unaffected.
5. **Rate-limit rows keyed by user id stay after account deletion** (`api_rate_limits`). This predates Pivot A, which only adds a few new buckets.
6. **The test suite can flake under extreme machine load.** It was hardened (20-second test timeout, waits around focus assertions) and was stable over repeated runs, but one failure was seen at a load average near 80.
7. **The end-to-end test can fail if a run crosses midnight in America/New_York,** because start and finish land on different local days.
8. **Prompt caching probably won't take effect until the real character sheets exist.** Haiku 5.5 needs at least 512 tokens to cache, and the sample sheet is about 460.
9. **Older docs are partly out of date under Pivot A.** `PRODUCT.md` says "no billing, no paid gates" and treats persona engagement as core; `ARCHITECTURE.md` describes persona autoposting. Both still describe legacy mode correctly.
10. **Mobile:** Pivot A screens are web-only (D7). Mobile shows the age gate and a crisis notice, and has API-client methods for the new endpoints. No native in-app purchase code exists.

---

## 10. Decisions to confirm

These were made during implementation and are recorded in [PLAN.md](PLAN.md):
- The task splitter is outside the `ai_arm` experiment; the arm applies only to reactions.
- After a crisis card, the board hides "Post the win" for that task.
- A refusal from the distress classifier counts as "possible", so it fails closed.
- The session nudge carries the daily AI reminder when it is the first character line of the day.
- `/safety` exists only while Pivot A is on.
- Under Pivot A, unverified users can't start tasks (403). They can still finish them, but get no banter.
