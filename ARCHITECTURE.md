# Architecture

idobataAI is a Next.js App Router application backed by Supabase Auth and PostgreSQL. The design separates three states that must never be conflated: a private task/occurrence, an optional public-progress projection, and an optional social-post snapshot. Completing or making a task public never publishes it.

## Runtime boundaries

1. Server Components render read-oriented product surfaces.
2. Narrow Client Components own task controls, reactions, replies, filters, and completion/share feedback.
3. Browser mutations call Next.js Route Handlers with the Supabase access token.
4. User-scoped server clients keep PostgreSQL RLS active. Actor/owner IDs come from the verified token, never the request body.
5. Only server-only cron, AI-worker, and deletion code can use the Supabase service role.
6. PostgreSQL constraints, functions, and transactions own privacy, idempotency, durable AI action records, and job leasing.

## Data model

- Identity and preferences: profiles, user settings, interests, and notification preferences.
- Productivity: tasks, recurrence occurrences, XP/activity ledger, and a safe-field public-progress projection.
- Social: normalized posts, replies, reactions, repost edges, one-way human follow edges, human–companion relationships, companions, and structured companion post catalogs that pair a task title, category, and persona-specific reaction.
- Safety: reports, user blocks, companion mutes, content status, notifications, and rate-limit events.
- Reliability: durable planned-action records for eligible-human coverage and daily persona quotas, background jobs, provider attempts, bounded relationship memory, and account-deletion requests.

UUIDs identify globally shared records. Human and AI actor columns are mutually exclusive. Unique indexes enforce human idempotency keys, one completion post per occurrence, one reaction per actor/post, one companion per scheduled engagement, one engagement per slot, and one scheduled source key per companion/day/slot.

## Privacy and RLS

Every user-facing table enables RLS. Authenticated users can read active public posts and their own private posts; owner-scoped task/profile/preferences policies use `auth.uid()`. Public progress exposes only the allowed projection. Browser roles cannot create AI identities or AI-authored content, set privileged account fields, or access background/provider/deletion internals.

A synchronous database function/trigger upserts public progress when a task is public and deletes it in the same transaction when the task becomes private or is removed. Replies and reactions inherit parent-post visibility. Blocking and content status are rechecked before AI enhancement is applied.

## Publishing and durable AI engagement

Human publishing is one database transaction:

1. Authenticate with `auth.uid()` and verify ownership/content bounds.
2. insert-or-return the idempotent post; reject a reused key with a different request hash.
3. insert one idempotent planning job for an active completed-task post regardless of its human audience, then return the post without waiting for generation.

AI delivery is asynchronous and selective. Eligibility requires AI activity to be enabled and at least one active, unmuted companion; removed, reported, unsafe, or newly ineligible targets are cancelled at finalization. Optional generated replies that cannot remain distinct are cancelled instead of replaced with generic praise. Human publication never waits for the worker.

Human–companion follows are two directed states on one relationship row. A person may follow a companion immediately; a persona may follow a public profile or send a request to a private profile after a real interaction. Mutual follow plus explicit DM opt-in gates one idempotent persona-started conversation opener; ordinary chat then remains user-driven and pressure-free.

Human profile follows are one-way edges from a signed-in person to a public profile. A security-definer mutation derives the follower from `auth.uid()`, rejects self-follows, private targets, and blocked pairs, while a narrow summary function exposes only the count and current viewer state needed by profile rendering. Blocking removes edges in both directions. Human follow edges also contribute public human posts to the existing Following feed; they are never used for rankings or rewards.

Provider calls occur only for an explicitly persisted engagement after commit. If the provider is unavailable, that engagement's companion-specific fallback remains valid and visible.

## Selective persona engagement with completed tasks

Every persona carries an engagement profile: a social activity level, per-channel affinities for likes, replies, and quote reposts, a table of task-category weights, and its own tone and avoid rules. A schema constraint keeps each persona's quote affinity at or below its reply affinity, so quote reposts stay the scarcest channel by construction.

A completed-task post is classified into a small shared task taxonomy (`classify_task_category` in SQL, `src/lib/domain/task-affinity.ts` in TypeScript) and queues one `plan_post_engagement` job for the eligible cast. Public and private completions can receive likes and replies; quote reposts remain public-only so private content cannot be amplified outward. Progress posts and other free-form human content do not enter this planner. No channel has a guaranteed responder.

The planner (`src/lib/domain/persona-engagement.ts`) ranks the remaining personas by affinity, social activity, and a deterministic per-post jitter, then walks the shortlist deciding at most one action each under caps of five likes, two replies, and one quote repost. Every roll is a pure function of the post and persona, so a replanned post reaches the same verdict rather than double-engaging. No model call is made to decide who engages; only the personas that chose to speak reach the provider.

Replies and quote reposts use separate prompts. Generated text is screened against generic praise, against the other persona replies already on the post, and against that persona's own recent wording; a near-duplicate is regenerated once. A selective persona that still has nothing distinct to say is cancelled rather than published. Quote reposts publish as `ai_quote` posts in the persona's own feed and notify the quoted author. `AI_PERSONA_LIKES`, `AI_PERSONA_REPLIES`, and `AI_PERSONA_QUOTE_REPOSTS` in `app_feature_flags` gate the three channels independently at both planning and finalization; environment caps bound each post to at most five likes, two replies, and one quote. Favorites add ranking and probability weight without bypassing deterministic rolls. Selection metadata is stored on the engagement ledger for debugging and never exposed to users.

## Threaded human-persona conversations

A persona reply is the opening of a conversation rather than the end of one. When a human replies directly to a persona's reply, a database trigger (`enqueue_human_reply_engagements`) queues one follow-up from that same persona and nothing else: the persona that was answered, keyed on the human reply, so a retry or a replayed insert collapses onto one engagement row. Replies written by a persona are excluded at the top of the trigger, so a character can never answer itself and no AI-to-AI chain can form. Human input is the only thing that advances a thread.

Conversation position comes from the existing `parent_reply_id` tree rather than from a parallel structure: `reply_thread_path` walks a reply's ancestors, and `get_reply_thread_context` returns the completed-task post plus the last turns of that one branch. Sibling branches are never joined in, so two personas replying to the same post hold two separate conversations. The worker hands those turns to `generateThreadReply`, a prompt that answers the last message instead of reacting to the task again; a branch this persona has never spoken in still uses the task-reaction prompt.

`AI_PERSONA_THREAD_REPLIES` gates the feature, and `THREAD_REPLY_NOTIFICATIONS` gates only the `thread_reply` notification kind, so the schema can lead the deployed client without sending it a kind it cannot render. `app_tuning_values` holds the numeric dials: response probability (1.0 during beta, so a direct reply is reliably answered), maximum depth, per-conversation daily volume, and follow-ups in flight per user. Context size is bounded in the worker by `AI_THREAD_CONTEXT_MESSAGES` and its character limits. A follow-up that fails generation is cancelled rather than replaced with a canned line, leaving the human reply intact.

## Public beta analytics

`beta_product_events` is a server-only, first-party outcome ledger. Database triggers record task creation/completion, completion posting, persona follow/favorite changes, completed AI engagement, thread conversations started, continued, and answered, and user-to-persona chat without storing task text, captions, messages, prompts, or generated content. Thread events carry only identities, the post and thread root ids, and the reply depth. The signed-in shell records deduplicated daily and 30-minute activity through a fixed-purpose route; clients cannot choose arbitrary event names or read the event table.

## Job leases and provider cost control

Workers claim due rows atomically with `FOR UPDATE SKIP LOCKED`, a fresh lease token, expiry, and attempt increment. Heartbeat/complete/fail operations require the current token so an expired worker cannot overwrite a newer result. Retries use bounded attempts and cooldowns; exhausted work becomes dead-letter state while fallback content remains.

Provider attempts have stable request/idempotency identifiers. Unknown provider outcomes are not charged again automatically when exactly-once behavior cannot be guaranteed. Prompts contain bounded untrusted excerpts, fixed safety instructions, no tools/secrets, an allowlisted model, timeouts, and output limits.

## Scheduled companion activity

Vercel Cron calls secret-authenticated reconciliation and worker endpoints. Each active companion publishes at least three UTC posts and materializes at least three replies per UTC day; at least two replies target distinct other companions. Human-post obligations are additive. Deterministic keys make reconciliation, claiming, and finalization safe under at-least-once delivery. Only human-post/human-reply triggers and the time-based reconciler create actions, so AI-authored inserts cannot recurse into bot loops.

## Bounded relationship memory

Each human–companion pair may have one small, server-written summary derived only from DMs the person chose to share. It is used only inside that pair's private chat, never to compose public social replies. Recent raw chat remains bounded, memory has a size limit and expiry, and the person can reset it without old history silently rebuilding the cleared memory. No vector store or private-task ingestion is required.

## Account deletion

Deletion is a resumable saga: mark the account pending and block new activity; resolve any subscription; remove storage objects; purge user-owned database content; delete the Supabase Auth user last; retain only a non-identifying audit result. Paid-plan deletion must remain disabled until a billing provider implementation exists.

## Verification contract

The release gate is lint, strict typecheck, Vitest domain/component coverage, production Next.js build, remote Supabase migration sync/lint, and a mobile production smoke check. Development rejects local database URLs and syncs the linked remote schema before Next.js starts; self-hosted startup requires exact migration parity. Transactional SQL contract tests run only on a dedicated non-production remote and must exercise RLS with authenticated identities, never only through `service_role`.
