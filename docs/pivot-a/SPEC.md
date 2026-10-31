# Task: Implement idobata Pivot A, "Character Coach" (US market)

> Verbatim copy of the founder brief (2026-10-31). The implementation plan is in [PLAN.md](PLAN.md).

You are working in the idobata codebase. Today it is a web beta at idobata-ai.com (Next.js + Supabase, email/password auth) with a private task list, a social "wins" feed, 27 AI personas that post and reply, and a capped AI chat. A native iOS app may be in progress in this repo or another.

Pivot the product to the spec below. The spec is decided; your job is to implement it cleanly on top of what exists, behind feature flags, without deleting existing features.

---

## How to work

1. **Explore before changing anything.** Read the repo layout, `package.json`, Supabase migrations and schema, RLS policies, auth flow, task and post models, persona/AI code, env handling, existing tests and CI. Note where the AI provider is called and how the current daily cap works.
2. **Write `docs/pivot-a/PLAN.md`** covering:
   - what exists and what you will reuse;
   - what you will put behind flags;
   - schema changes;
   - the phases below mapped to concrete files.

   Put blocking questions at the top. **Stop and show me the plan before starting Phase 1.**
3. **Work one phase at a time.** After each phase:
   - run typecheck, lint and tests, and fix failures;
   - commit with a clear message;
   - tick the phase off in `PLAN.md`.
4. **Keep existing features.** Do not delete them; turn them off with flags.
5. **Don't invent sensitive content.** Do not write legal text, clinical claims, prices or copy beyond what this prompt gives. Where something needs a human decision, leave `TODO(founder): ...` and list it in the handoff.
6. **Flag conflicts.** If this spec conflicts with what the code or platform can do, say so in `PLAN.md` and propose the smallest change.

---

## The product in one paragraph

A US subscription app for adults (18+) who struggle to start or finish everyday tasks.

- **The loop:** the user picks one character from a small cast. The character reacts when the user starts a task and when they finish it. Finishing tasks unlocks a short story.
- **How AI is used:** only to write a 1–2 sentence reaction that names the user's actual task, and to split a stuck task into 3 steps. Everything else runs on prewritten lines.
- **The goal is less time in the app.** The north-star metric is tasks finished per user per week. Median session length should stay under 3 minutes. The character's job is to send the user off to do the thing.

---

## Non-negotiable guardrails

These come from Character.AI's 2026 bankruptcy and from US companion-chatbot law (California SB 243, New York's AI companion law, and the pending federal GUARD Act). Treat them as requirements, not suggestions.

**Excluded from the product:**
- **No open-ended chat.** Flag the existing persona chat off for Pivot A.
- **No user-created characters.** Only first-party characters from `content/characters/`.
- **No romance or sexual content.** Never flirt, never express romantic interest.
- **No professional advice.** No medical, mental-health, legal or financial advice, and no character ever claims credentials.
- **No ads and no ad SDKs.** No sale or sharing of user data.
- **No guilt mechanics.** No sad character, no lost-streak shaming, no punishment for missed days. A missed day triggers a warm "comeback" line.

**Age and disclosure:**
- **Adults only.** Sign-up must verify age 18+. Under 18 means no account is created.
- **Always disclose.**
  - The character profile and first meeting state that it is an AI character, not a person, and not a therapist, doctor or lawyer.
  - The first reaction of each local day includes a short AI reminder; New York requires a daily or 3-hourly reminder.

**Safety and privacy:**
- **Crisis routing.** If task text suggests distress or self-harm, suppress all character banter for that event and show the crisis card instead. The card offers the 988 Suicide & Crisis Lifeline (call or text 988) and 911 for immediate danger. Log only an aggregate counter, never the text; California requires annual crisis-referral reporting from July 2027.
- **Minimal memory.** Store tasks, streaks, story progress and settings only. Store generated reaction text for at most 30 days, then purge it. There are no chat transcripts.
- **Server-side AI only.** No API keys in the client.
- **Keep the privacy model.** Tasks stay private by default, and completing a task never posts anything.

---

## Phase 1: Data model and flags

Adapt the following to the existing schema and naming. Use Supabase migrations, enable RLS on every new table, and give users access only to their own rows.

- `characters`: `id`, `slug`, `name`, `role` (coach | rival | cheerleader | deadpan), `art_url`, `is_launch`, `pack_sku` (nullable).
- `character_lines`:
  - `id`, `character_id`, `text`;
  - `event`: one of `task_started`, `task_finished`, `first_of_day`, `streak`, `comeback`, `session_nudge`, `split_intro`, `chapter_unlocked`;
  - matching fields `min_streak`, `max_streak`, `task_age_bucket`, `tags`.
- `story_chapters`: `id`, `character_id`, `number`, `title`, `body`, `unlock_rule` (jsonb).
- Profile additions:
  - `selected_character_id`, `timezone`;
  - `age_verified_at`, `age_verification_method`;
  - `ai_arm` (for the experiment below).
- `task_events`: `id`, `user_id`, `task_id`, `type` (started | finished), `occurred_at`. Reuse the existing tasks table.
- `reactions`:
  - `id`, `user_id`, `task_event_id`, `character_id`;
  - `source` (prewritten | ai), `line_id` (nullable), `text`, `created_at`;
  - purged after 30 days.
- `ai_usage_daily`: `user_id`, `date`, `reactions`, `splits`, `input_tokens`, `output_tokens`, `est_cost_usd`.
- `story_progress`: `user_id`, `character_id`, `consistency_days`, `unlocked_through`.
- `entitlements`:
  - `user_id`, `product` (plus | pack:<slug>), `status`;
  - `source` (stripe | app_store);
  - `trial_ends_at`, `current_period_end`.
- `safety_counters`: `date`, `kind` (crisis_card_shown), `count`. Aggregate only; no user id, no text.

Add these flags, all configurable per environment:
- `pivot_a.enabled`
- `social_feed.enabled` (default off under Pivot A)
- `persona_chat.enabled` (off)
- `persona_autopost.enabled` (off; personas must never post fictional "wins")
- `share_win.enabled` (keeps the existing private-by-default "share a win" flow, people-only)

## Phase 2: Character content system

Create `content/characters/<slug>/` with three files:
- `sheet.json`: name, role, voice notes, do/don't list, sample lines;
- `lines.json`;
- `chapters.json`.

Add a JSON schema plus a content linter test. The linter checks:
- required events are covered;
- every line is under 40 words;
- banned phrases are absent (claims of being human, credentials, romance, guilt);
- chapters are numbered contiguously.

Build **one** sample character end to end, with about 20 lines across all events and 3 chapters. Clearly mark the copy as placeholder. The founder will write the real copy (300+ lines and 30 chapters per character) and pick 3–5 launch characters from the existing 27. Add a seed script that loads content into the tables.

## Phase 3: Reaction engine (server)

Build one server function, `getReaction(userId, taskEventId)`. It must never block the UI: return a prewritten line immediately if AI is slow.

1. **Safety first.** When a task title or note is created or edited, run the distress check (Phase 5). If it flags, return the crisis card and stop.
2. **Pick the source.**
   - Plus or trial users get AI if under the daily caps: 30 reactions and 10 splits per local day.
   - Free users get 3 AI reactions per rolling 7 days.
   - Otherwise, or if the `ai_arm` experiment says prewritten, use prewritten.
3. **Make the AI call.**
   - **Model:** Anthropic `claude-haiku-5-5`, server-side.
   - **Limits:** `max_tokens` about 120, timeout 2.5 s.
   - **Caching:** use prompt caching for the static system prompt plus the character sheet.
   - **Inputs:** task title, task age, current streak, event type, time of day, and the last 3 lines shown (to avoid repeats).
4. **Validate the output before showing it.** It must:
   - be 60 words or fewer;
   - mention the task;
   - contain none of the banned content.

   On failure, timeout, error or refusal, fall back to prewritten. If the model returns the token `SAFETY_ESCALATE`, route to the crisis card.
5. **Disclose once a day.** The first reaction of the local day gets the AI reminder line.
6. **Choosing a prewritten line.** Match on event, streak range and task-age bucket. Avoid the user's last 20 lines.
7. **Meter the cost.** Compute `est_cost_usd` from the returned token usage times the configured prices:
   - `AI_PRICE_INPUT_PER_MTOK=0.10`
   - `AI_PRICE_OUTPUT_PER_MTOK=0.50`

   Then upsert `ai_usage_daily`.

Draft system prompt (store as a template; fill from `sheet.json`):

```
You are {name}, a fictional AI character in the idobata app. Role: {role}. Voice: {voice_notes}.
You react to the user's real task in 1–2 sentences, at most 60 words. Name the task. Be specific and warm.
Never claim to be human. Never give medical, mental-health, legal or financial advice.
Never flirt or express romantic or sexual interest. Never guilt or shame the user.
Never encourage the user to keep using the app; after a finish, point them to their next task or to rest.
If the task text suggests distress, self-harm or danger, output exactly: SAFETY_ESCALATE
```

**Task splitter.** Endpoint `splitTask(userId, taskId)`.
- **Output:** JSON `{ "steps": [3 strings, each ≤ 12 words] }`, schema-validated, counted against the daily split cap.
- **Display:** in the character's voice, using a `split_intro` line.

## Phase 4: Story, session nudge, no-guilt streaks

- **Consistency day:** a local day with at least one finished task.
- **Unlocking chapters:** chapter *n* unlocks at *n* consistency days. Time in the app never counts.
  - Free users get chapters 1–3.
  - Plus users get all chapters.
  - A purchased character pack unlocks that character's full arc.
- **Session nudge:** after 10 minutes of foreground time in one session, the character shows a `session_nudge` line suggesting the user close the app.
- **Streaks:** show only positive progress. After a gap, the next reaction uses a `comeback` line.

## Phase 5: Safety, age gate, disclosures

- **Distress check:**
  - **Detection:** a fast keyword prefilter plus a small structured model check (`{ "risk": "none" | "possible" | "high" }`) on user-entered task text.
  - **Response:** for `possible` or `high`, show the crisis card and increment `safety_counters`.
  - **Clinical review:** put the method behind an interface so a clinically reviewed protocol can replace it. Add `TODO(founder): clinical review of distress protocol (SB 243 requires evidence-based methods)`.
- **Crisis card:** 988 (call or text) and 911 for immediate danger. Make no promises about confidentiality. Copy must be reviewed (`TODO(founder)`).
- **Age gate:**
  - Collect date of birth at sign-up and block under-18s before an account exists.
  - Implement an `AgeVerifier` interface with a `SelfAttestedVerifier` for dev and staging only.
  - Production must use a real provider: `TODO(founder): choose provider`.
- **Disclosures:** an "AI character · not a person · not a therapist, doctor or lawyer" line on every character profile and at first meeting.
- **Public safety page:** a route `/safety` that describes the protocols. It must carry placeholder copy marked for counsel review.

## Phase 6: Billing and entitlements

- **Products:**
  - Plus at $7.99/month or $39.99/year, with a 14-day free trial;
  - character pack at $4.99 one-time.
- **Web:**
  - Stripe Checkout plus a webhook that writes `entitlements`.
  - Price IDs come from env vars; no keys in the repo.
- **iOS:** define the entitlement interface so App Store purchases (via StoreKit or RevenueCat) can write the same table later. Implement it only if iOS code exists here; otherwise document it.
- **Onboarding:**
  - Offer the trial as the default path, with a clearly visible "continue free" option.
  - No dark patterns: cancel is easy and the trial-end reminder is sent before the first charge.
- **No random-draw purchases.**

## Phase 7: Metrics, experiment, cost guardrail

**Events.** Use the existing analytics if it is privacy-respecting; otherwise use a first-party events table. No third-party ad or attribution SDKs. Track:
- `task_started`, `task_finished`;
- `reaction_shown` (with source), `split_used`, `chapter_unlocked`;
- `paywall_viewed`, `trial_started`, `purchase`;
- `session_length`.

**Experiment `ai_arm`.**
- Assign beta users sticky 50/50 to `ai` or `prewritten`.
- Add a SQL view or report that compares the two arms on:
  - tasks finished per user per week;
  - day-14 retention.

**Cost report.** An admin-only query or page showing:
- average AI cost per paying user per month;
- the share of users at their caps.

Log a warning if the projected cost per paying user goes above **$0.66/month** (15% of $4.42 net).

## Phase 8: Retention, deletion, launch-readiness

- **Purge job:** a scheduled job (Supabase cron or equivalent) deletes `reactions` older than 30 days.
- **Account deletion:** removes all user rows. Keep the existing behaviour and extend it to the new tables.
- **Launch-readiness check:** a script (`npm run launch-check`) that fails if:
  - privacy or terms pages still contain template text (for example "Before public launch" or "replace this starter");
  - production uses `SelfAttestedVerifier`;
  - `/safety` is still placeholder;
  - any `TODO(founder)` remains in safety, legal or billing code.

---

## Tests (required)

**Unit tests:**
- cap logic (daily, weekly-free, reset at local midnight);
- the cost calculation;
- prewritten line selection and no-repeat;
- the output validator (banned content, length, must mention the task);
- the `SAFETY_ESCALATE` route;
- chapter unlock rules;
- the no-guilt comeback;
- the age gate.

**Integration and end-to-end:**
- the Stripe webhook (mocked) writing entitlements;
- AI timeout falling back to prewritten;
- an end-to-end onboarding flow with the age gate, character pick, first task, first reaction and the paywall. Use Playwright if the repo has it.

---

## Out of scope for v1

- open-ended chat, voice or text-to-speech, and user-created characters;
- a social graph beyond the existing flagged "share a win";
- Android native;
- B2B features;
- licensed IP;
- ads.

## Acceptance criteria

- [ ] With `pivot_a.enabled`, a new US adult can:
  - sign up (18+ verified);
  - pick a character;
  - add a task, start it and finish it;
  - see a character reaction that names the task.
- [ ] Free users see prewritten reactions plus at most 3 AI reactions per 7 days. Plus/trial users get AI reactions up to the caps, then prewritten.
- [ ] AI failures or timeouts never show an error to the user; they fall back to prewritten in under 3 s.
- [ ] Distress text shows the crisis card, suppresses banter and increments only an aggregate counter.
- [ ] AI disclosure appears on character profiles and once per local day.
- [ ] Chapters unlock by consistency days, never by time in the app.
- [ ] Feed autoposting by personas and open-ended persona chat are off under Pivot A.
- [ ] Stripe trial → paid flow writes entitlements; cancellation works.
- [ ] The cost meter records tokens and estimated cost for every AI call; the admin report works.
- [ ] Reactions older than 30 days are purged; account deletion covers all new tables.
- [ ] `npm run launch-check` fails today (because of the placeholder legal and safety content) and lists exactly what to fix.
- [ ] All tests pass in CI.

## When done

Write `docs/pivot-a/HANDOFF.md` covering:
- what shipped;
- every flag and env var;
- how to run locally;
- how to seed content;
- how to read the experiment and cost reports;
- the full list of `TODO(founder)` items. Expected items:
  - the age-verification provider;
  - clinical review of the distress protocol;
  - counsel-reviewed privacy, terms and safety pages;
  - final character copy and launch cast;
  - Stripe and App Store product setup.
