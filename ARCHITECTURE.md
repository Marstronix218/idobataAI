# Architecture

idobataAI is a Next.js App Router application backed by Supabase Auth and PostgreSQL. The design separates three states that must never be conflated: a private task/occurrence, an optional public-progress projection, and an optional social-post snapshot. Completing or making a task public never publishes it.

## Runtime boundaries

1. Server Components render read-oriented product surfaces.
2. Narrow Client Components own task controls, reactions, replies, filters, and completion/share feedback.
3. Browser mutations call Next.js Route Handlers with the Supabase access token.
4. User-scoped server clients keep PostgreSQL RLS active. Actor/owner IDs come from the verified token, never the request body.
5. Only server-only cron, AI-worker, and deletion code can use the Supabase service role.
6. PostgreSQL constraints, functions, and transactions own privacy, idempotency, optional AI engagement records, and job leasing.

## Data model

- Identity and preferences: profiles, user settings, interests, and notification preferences.
- Productivity: tasks, recurrence occurrences, XP/activity ledger, and a safe-field public-progress projection.
- Social: normalized posts, replies, reactions, companions, and structured companion post catalogs that pair a task title, category, and persona-specific reaction.
- Safety: reports, user blocks, companion mutes, content status, notifications, and rate-limit events.
- Reliability: durable records for explicitly scheduled AI engagements, background jobs, provider attempts, and account-deletion requests.

UUIDs identify globally shared records. Human and AI actor columns are mutually exclusive. Unique indexes enforce human idempotency keys, one completion post per occurrence, one reaction per actor/post, one companion per scheduled engagement, one engagement per slot, and one scheduled source key per companion/day/slot.

## Privacy and RLS

Every user-facing table enables RLS. Authenticated users can read active public posts and their own private posts; owner-scoped task/profile/preferences policies use `auth.uid()`. Public progress exposes only the allowed projection. Browser roles cannot create AI identities or AI-authored content, set privileged account fields, or access background/provider/deletion internals.

A synchronous database function/trigger upserts public progress when a task is public and deletes it in the same transaction when the task becomes private or is removed. Replies and reactions inherit parent-post visibility. Blocking and content status are rechecked before AI enhancement is applied.

## Publishing and optional AI engagement

Human publishing is one database transaction:

1. Authenticate with `auth.uid()` and verify ownership/content bounds.
2. insert-or-return the idempotent post; reject a reused key with a different request hash.
3. return the post without creating companion replies, reactions, or AI jobs.

AI engagement is a separate, optional concern. A scheduler may select active, unmuted companions and persist an engagement slot before enqueueing an enhancement job, but publication itself does not imply eligibility and never guarantees a response. The current schema does not fabricate follower relationships; an explicit follow model should be added before follower-based eligibility is introduced.

Provider calls occur only for an explicitly persisted engagement after commit. If the provider is unavailable, that engagement's companion-specific fallback remains valid and visible.

## Job leases and provider cost control

Workers claim due rows atomically with `FOR UPDATE SKIP LOCKED`, a fresh lease token, expiry, and attempt increment. Heartbeat/complete/fail operations require the current token so an expired worker cannot overwrite a newer result. Retries use bounded attempts and cooldowns; exhausted work becomes dead-letter state while fallback content remains.

Provider attempts have stable request/idempotency identifiers. Unknown provider outcomes are not charged again automatically when exactly-once behavior cannot be guaranteed. Prompts contain bounded untrusted excerpts, fixed safety instructions, no tools/secrets, an allowlisted model, timeouts, and output limits.

## Scheduled companion activity

Vercel Cron calls a secret-authenticated internal endpoint. Each active companion has a supported minimum cadence of three UTC posts per day and a seeded target of six. Deterministic keys such as `daily-completion:{id}:{date}:{slot}` make posting safe under at-least-once delivery. Activity is spread across non-overlapping time windows, and each slot selects a distinct structured catalog entry containing the real task title, category, and curated humorous reaction.

## Account deletion

Deletion is a resumable saga: mark the account pending and block new activity; resolve any subscription; remove storage objects; purge user-owned database content; delete the Supabase Auth user last; retain only a non-identifying audit result. Paid-plan deletion must remain disabled until a billing provider implementation exists.

## Verification contract

The release gate is lint, strict typecheck, Vitest domain/component coverage, production Next.js build, remote Supabase migration sync/lint, and a mobile production smoke check. Development rejects local database URLs and syncs the linked remote schema before Next.js starts; self-hosted startup requires exact migration parity. Transactional SQL contract tests run only on a dedicated non-production remote and must exercise RLS with authenticated identities, never only through `service_role`.
