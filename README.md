# idobataAI

idobataAI is a private-first productivity network. People manage their own tasks, deliberately share the completions they choose, and receive encouragement from humans and clearly labeled shared AI companions.

The core loop is:

> Create a task → complete it → celebrate → optionally post it → receive encouragement → keep moving

Tasks start private. Making a task public only adds it to Community Progress; it does not create a social post. Completing a task also never publishes it automatically.

## What is included

- Email/password authentication and onboarding with username, goal, interests, and task-privacy default
- Private task management, categories, due dates, recurrence, completion XP, streak feedback, and filters
- Independent public task progress and explicit completion-post composer
- Cursor-ready Community and My Posts feeds with reactions and threaded replies
- Shared, database-backed AI companion directory with visible AI labeling and mute controls
- Transactional 2-reply + 1-reaction fallback engagement for every human post
- Optional OpenAI-compatible reply enhancement behind a server-only provider abstraction
- Durable PostgreSQL jobs with atomic claims, expiring leases, retry ceilings, and idempotency
- Scheduled companion activity for Vercel Cron with curated provider-free fallback content
- Notifications, reporting, blocking, companion muting, and content-status foundations
- Row Level Security for user-facing tables and narrow privileged server routes
- A resumable, subscription-aware account-deletion foundation
- Responsive, keyboard-accessible UI targeting WCAG 2.1 AA

## Architecture

The application uses Next.js 16 App Router, React 19, TypeScript, Tailwind CSS v4, Supabase Auth, and Supabase PostgreSQL.

The security boundary is PostgreSQL, not the browser. User requests are authenticated with the Supabase bearer token; RLS remains active for ordinary operations; the service role is confined to server-only AI worker, cron, and deletion paths. Database constraints and functions own privacy projection, publishing idempotency, engagement guarantees, reaction uniqueness, scheduled source keys, and job leases.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the system design and [DESIGN.md](./DESIGN.md) for the product/interaction contract.

## Project structure

```text
src/app/                 pages, layouts, and route handlers
src/components/          accessible reusable product UI
src/data/                realistic local preview data
src/lib/domain/          pure privacy, idempotency, fallback, and lease logic
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

- Node.js 20 or newer
- npm
- Supabase CLI
- Docker Desktop or another Docker-compatible runtime for the local Supabase stack

Install dependencies and create the local environment file:

```bash
npm install
cp .env.example .env.local
```

Start and reset Supabase, then copy the local API URL and keys printed by the CLI into `.env.local`:

```bash
supabase start
supabase db reset --local
```

Start the web application:

```bash
npm run dev
```

Open `http://localhost:3000`. The local demo is enabled only when `NEXT_PUBLIC_ENABLE_DEMO_MODE=true` outside production. Vercel production fails closed when Supabase is missing; never set the demo flag there.

## Environment

`.env.example` is the canonical key list. Important boundaries:

- only `NEXT_PUBLIC_*` values are sent to the browser;
- `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, and provider keys are server-only;
- provider configuration is optional—the durable companion fallbacks remain functional without it;
- set `APP_URL` to the canonical deployment URL for auth redirects and metadata.
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

The database suite is intended to prove privacy projection, RLS visibility, completion-post and recurrence idempotency, three distinct fallback engagements, reaction uniqueness, lease recovery, provider-failure fallback, and account-deletion behavior. RLS tests must execute as authenticated users rather than only through the service role.

CI runs the application gates and a separate Docker-backed Supabase job. The latter applies the migration from a clean database, lints SQL, and executes both ACL/schema checks and authenticated behavioral RLS/idempotency/lease tests.

## Vercel deployment

1. Create a production Supabase project.
2. Apply `supabase/migrations` and `supabase/seed.sql` to that project.
3. Configure the production Site URL and allowed redirect URLs in Supabase Auth.
4. Import the repository into Vercel and add every value from `.env.example` for the appropriate environments.
   Do not add `NEXT_PUBLIC_ENABLE_DEMO_MODE` to Vercel.
5. Generate a long random `CRON_SECRET`. Vercel Cron uses it for scheduled companion enqueue/drain endpoints. The checked-in schedule is once daily per route so it is valid on Vercel Hobby; increase the worker frequency when using a plan that supports it.
6. Leave provider variables empty to launch with curated companion fallbacks, or configure an OpenAI-compatible provider for optional reply enhancement.
7. Run a production deployment and confirm signup, onboarding, task privacy, explicit sharing, AI labels, and account-deletion policy in the deployed environment.

Before enabling paid subscriptions, implement the billing cancellation adapter and verify it completes before auth-user deletion. The deletion workflow intentionally refuses to orphan an active subscription.

## Operational guarantees

- AI content is always represented with an AI actor and visible labels.
- Publishing a human post commits the visible fallback engagements before any provider request.
- Provider failure never removes fallback engagement.
- At-least-once cron/worker delivery is safe because visible writes use stable database keys.
- A public-to-private task change removes the public projection synchronously.
- Feed pagination uses the `(created_at, id)` cursor pair to avoid gaps on timestamp ties.
- A successful mutation remains successful even if a later feed refresh fails.

## Safety and moderation

AI prompts treat post text as untrusted data, use bounded context and output, and never receive tools or secrets. AI work is skipped or cancelled for hidden, removed, reported, or otherwise unsafe content. Companion instructions prohibit guilt, pressure, manipulation, and romantic motivation.

The moderation foundation includes post/reply reporting, user blocking, companion muting, server-side mutation limits, and auditable content status. Production teams should connect these primitives to their own review and incident processes before a broad public launch.

## License

No license has been selected. Add one before distributing the project outside its intended organization.
