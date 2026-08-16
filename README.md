# idobataAI

idobataAI is a private-first productivity network. People manage their own tasks, deliberately share the completions they choose, and receive encouragement from humans and clearly labeled shared AI companions.

> Finish the small thing. Keep the details private. Share the win only when encouragement would help.

The core loop is:

> Create a task → complete it → celebrate → optionally post it → receive encouragement → keep moving

Tasks start private. Making a task public only adds it to Community Progress; it does not create a social post. Completing a task also never publishes it automatically.

## What is included

- Email/password authentication, secure password recovery, confirmation resend, and onboarding with username, goal, interests, and task-privacy default
- Private task management, categories, due dates, recurring chores/routines, streak feedback, and focused time filters
- Explicit completion-post composer with per-post audience selection and up to four optional images
- Private completion-post media delivered through short-lived, visibility-scoped links
- Independent public task progress that never publishes a social post on its own
- Cursor-paginated feeds with “For you,” “Your interests,” and “People only,” plus post permalinks, likes, threaded replies, and human social profiles
- Owner-controlled post audience changes and deletion
- Editable profile identity, privacy, interests, bio, and built-in or uploaded avatars
- Shared, database-backed AI companion directory with dedicated profiles, visible AI labeling, and mute controls
- Private one-to-one chat with people or AI companions, protected by RLS, blocking, muting, and rate limits
- Optional companion posts, likes, replies, and OpenAI-compatible response enhancement behind server-only boundaries
- Durable PostgreSQL jobs with atomic claims, expiring leases, retry ceilings, and idempotency
- Scheduled companion activity for a small rotating daily cast, with curated provider-free fallback content
- Notifications, reporting, blocking, companion muting, and content-status foundations
- Row Level Security for user-facing tables and narrow privileged server routes
- A resumable, subscription-aware account-deletion foundation
- Responsive, keyboard-accessible UI targeting WCAG 2.1 AA

## Architecture

The application uses Next.js 16 App Router, React 19, TypeScript, Tailwind CSS v4, Supabase Auth, and Supabase PostgreSQL.

The security boundary is PostgreSQL, not the browser. User requests are authenticated with the Supabase bearer token, and RLS remains active for ordinary operations. The service role is restricted to narrow server-only media, AI, cron, and deletion paths. Database constraints and functions own privacy projection, chat participation, publishing idempotency, reaction uniqueness, scheduled source keys, and job leases.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the system design, [DESIGN.md](./DESIGN.md) for the product/interaction contract, and [PRODUCT.md](./PRODUCT.md) for the market position, activation metric, experiments, and launch decision.

## Project structure

```text
src/app/                 pages, layouts, and route handlers
src/components/          accessible reusable product UI
src/data/                realistic local preview data
src/lib/domain/          pure privacy, media, idempotency, fallback, and lease logic
src/lib/supabase/        browser, token-scoped, and server-only clients
src/lib/server/          authenticated services and request validation
src/lib/ai/              provider abstraction, safety, scheduling, and worker
src/types/               database, API, and domain types
supabase/migrations/     schema, functions, triggers, RLS, grants, and indexes
supabase/tests/          executable database/security contracts
supabase/seed.sql        initial companion catalog and fallback templates
tests/                   Vitest domain and component coverage
```

## Local development

Requirements:

- Node.js 20.9 or newer (CI uses Node.js 22)
- npm
- Supabase CLI and Docker Desktop (or another Docker-compatible runtime) for persistent local development

Install dependencies and create the local environment file:

```bash
npm install
cp .env.example .env.local
```

For a UI-only preview with demo data, leave `NEXT_PUBLIC_ENABLE_DEMO_MODE=true` and start the app:

```bash
npm run dev
```

For the full persistent stack, start and reset Supabase, copy the local API URL and keys printed by the CLI into `.env.local`, then remove `NEXT_PUBLIC_ENABLE_DEMO_MODE` or set it to `false`:

```bash
supabase start
supabase db reset --local
npm run dev
```

Open `http://localhost:3000`. Demo mode is available only outside production and does not persist mutations. Vercel production fails closed when Supabase is missing; never set the demo flag there.

## Environment

`.env.example` is the canonical key list. Important boundaries:

- only `NEXT_PUBLIC_*` values are sent to the browser;
- `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `WORKER_SECRET`, and provider keys are server-only;
- provider configuration is optional—the durable companion fallbacks remain functional without it;
- set `APP_URL` to the canonical deployment URL for auth redirects and metadata;
- `NEXT_PUBLIC_ENABLE_DEMO_MODE=true` is for local UI preview only; leave it unset in Vercel Preview and Production so missing Supabase configuration fails closed.

Never expose the service-role or AI-provider key through a public environment variable.

## Verification

Run the application gates locally:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

With the local Supabase stack running, also validate migrations and database contracts:

```bash
supabase db reset --local
supabase db lint --local
supabase test db
```

The database suite is intended to prove privacy projection, RLS visibility, completion-post and recurrence idempotency, chat isolation, like uniqueness, lease recovery, provider-failure fallback, and account-deletion behavior. RLS tests must execute as authenticated users rather than only through the service role.

CI runs the application gates and a separate Docker-backed Supabase job. The latter applies the migration from a clean database, lints SQL, and executes both ACL/schema checks and authenticated behavioral RLS/idempotency/lease tests.

## Vercel deployment

1. Create a production Supabase project.
2. Apply `supabase/migrations` and `supabase/seed.sql` to that project.
3. Configure the production Site URL and exact allowed redirect URLs in Supabase Auth, including `/auth/callback`; configure custom SMTP and ensure custom email templates preserve `{{ .RedirectTo }}`.
4. Import the repository into Vercel and add every value from `.env.example` for the appropriate environments.
   Do not add `NEXT_PUBLIC_ENABLE_DEMO_MODE` to Vercel.
5. Generate distinct long random values for `CRON_SECRET` and `WORKER_SECRET`. Vercel uses `CRON_SECRET` for scheduled requests; `WORKER_SECRET` also authorizes manual worker calls. The checked-in schedule is once daily per route so it is valid on Vercel Hobby; increase the worker frequency when using a plan that supports it.
6. Leave provider variables empty to launch with curated companion fallbacks, or configure an OpenAI-compatible provider for optional reply enhancement.
7. Run a production deployment and confirm signup, confirmation resend, password recovery, onboarding, task privacy, explicit sharing, owner audience/deletion controls, AI labels, the people-only feed, and account-deletion policy in the deployed environment.

Before enabling paid subscriptions, implement the billing cancellation adapter and verify it completes before auth-user deletion. The deletion workflow intentionally refuses to orphan an active subscription.

## Operational guarantees

- AI content is always represented with an AI actor and visible labels.
- Publishing a human post is independent from optional companion engagement and never waits on an AI provider.
- When companion engagement has been scheduled, provider failure leaves its persisted fallback content available.
- Human and companion chat threads are visible only to their human participants.
- At-least-once cron/worker delivery is safe because visible writes use stable database keys.
- A public-to-private task change removes the public projection synchronously.
- Feed pagination uses the `(created_at, id)` cursor pair to avoid gaps on timestamp ties.
- A successful mutation remains successful even if a later feed refresh fails.

## Safety and moderation

AI prompts treat post text as untrusted data, use bounded context and output, and never receive tools or secrets. AI work is skipped or cancelled for hidden, removed, reported, or otherwise unsafe content. Companion instructions prohibit guilt, pressure, manipulation, and romantic motivation.

The moderation foundation includes post/reply reporting, user blocking, companion muting, server-side mutation limits, and auditable content status. A supervised private beta still needs a named report-review owner. A broad public launch additionally requires a working moderation queue, response SLA, escalation and appeal rules, age policy, incident process, and counsel-reviewed terms and privacy notice. See [PRODUCT.md](./PRODUCT.md#launch-gates).

## License

No license has been selected. Add one before distributing the project outside its intended organization.
