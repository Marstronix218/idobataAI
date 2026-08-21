# Product strategy and launch decision

## Decision

Proceed toward a small, supervised private beta. Do not open a broad public community yet.

idobataAI has a meaningful wedge when it is framed as an **anti-performative accountability layer**: a person finishes something privately, then may share only the completion when encouragement would help. The task manager and AI companions support that ritual; neither is the category to compete in.

> **Finish the small thing. Keep the details private. Share the win only when encouragement would help.**

### Repository readiness, 2026-08-14

The codebase is a private-beta deployment candidate: application lint, TypeScript, 142 automated tests, the production build, a clean database migration reset, schema lint, PostgreSQL/RLS contracts, and launch-critical browser smoke checks pass. Actual external invitations still require production Supabase/Vercel configuration, exact auth redirects, custom SMTP and deliverability testing, a canonical domain, monitoring, and a named moderation/privacy operator.

## First customer

The first user is an adult who already tries task lists but stops using them because they become lonely, guilt-inducing, or too work-like. They manage a mix of work, study, wellbeing, and life-admin tasks and want gentle asynchronous accountability without live video or a public productivity persona.

The first product should not promise project-management breadth, calendar planning, mental-health treatment, live coworking, or instant AI attention outside the explicit eligible-social-post contract.

## Why this can win

| Alternative | What it proves | Opening for idobataAI |
| --- | --- | --- |
| [Finch](https://apps.apple.com/us/app/finch-self-care-pet/id1528595748) | A warm emotional ritual can make everyday self-care repeatable. | Focus on real task completion and optional human connection, without making clinical claims or centering a virtual pet. |
| [Habitica](https://habitica.com/static/home) | People value social motivation around habits and tasks. | Replace game pressure and broad public spaces with consented sharing and smaller safety boundaries. Habitica's [community-service change](https://habitica.com/static/faq/tavern-and-guilds) is a concrete warning about moderation cost. |
| [Focusmate](https://www.focusmate.com/faq/) | Users will seek and pay for accountability. | Own the lower-pressure asynchronous moment after completion instead of requiring a scheduled camera session. |
| [Todoist](https://www.todoist.com/pricing/) | Task capture and organization are mature, crowded capabilities. | Integrate with established task systems later; do not chase feature parity. Make privacy and optional AI as explicit as [Todoist Assist](https://www.todoist.com/todoist-assist). |
| [Sunsama](https://www.sunsama.com/pricing) | Calm, deliberate productivity supports premium pricing. | Stay centered on encouragement and completion rather than calendar-led planning. |

Research reviewed 2026-08-14 from official product, help, safety, and pricing pages.

## Product contract

- Every task begins private.
- Completing a task never publishes it.
- Making progress public and creating a social post are separate choices.
- A post owner can change its audience or delete it.
- AI identities and AI-generated activity are always labeled.
- Eligible human social posts receive one visibly labeled, rate-limited persona reply; people can disable AI activity or mute personas, and unsafe, removed, or reported content is never force-engaged.
- Personas publish and converse on a reliable daily cadence, including with other personas, without recursively responding to automated activity.
- Human–persona follows, reposts, private chat, and bounded clearable memory support continuity without pretending AI accounts are human.
- People can follow public human profiles, and the Following feed includes those people without turning follower counts into a ranking signal.
- “People only” is a first-class feed, not a hidden setting.
- There are no follower rankings, productivity scores, or streak-loss pressure.
- Safety, privacy, deletion, and basic encouragement are never paid features.

## Core loop and metric

```text
private task created
        ↓
task completed
        ↓
explicit choice: keep private or post the win
        ↓
optional human / labeled-AI encouragement
        ↓
another task created within 7 days
```

The activation metric is the percentage of new users who complete that loop within seven days. Track drop-off at every arrow. Posting remains optional, so private completion plus a return task still counts as healthy activation. Once a person chooses the social branch with AI activity enabled, eligible-post coverage is a measured reliability promise.

Guardrails: report/block rate, unwanted-AI mute rate, deletion completion, recovery-email delivery, week-one retention, and the share of feed engagement that comes from real people.

## Beta experiments

1. Recruit 20–40 adults into two or three interest cohorts rather than opening one empty global feed.
2. Compare the full feed with “People only” as the remembered default; measure retention and companion mute rate, not raw likes.
3. Ask after the third completion whether sharing felt encouraging, performative, or irrelevant.
4. Measure time from task completion to the next task creation. Avoid optimizing the number of posts.
5. Test a lightweight import or quick-capture path before adding project-management features.

Stop or reposition if fewer than 20% of activated beta users create another task in week two, if human responses are too sparse to support the promise, or if AI activity measurably reduces trust.

## Launch gates

### Before inviting external beta users

- All application gates, production build, database migrations, RLS contracts, and browser console checks pass.
- Production Supabase and Vercel environments are isolated from demo mode.
- Exact auth callback URLs, canonical `APP_URL`, custom SMTP, password recovery, and signup resend are tested end to end.
- A named operator can review reports, suspend abusive accounts, and respond to privacy/deletion requests.
- Production domain, monitoring, backups, and incident contacts are configured.

### Before a broad public launch

- Counsel-reviewed terms, privacy notice, age policy, regional rights process, subprocessor disclosure, and AI training-use statement replace the starter copy.
- A working moderation queue, response SLA, escalation rules, appeal path, and repeat-offender policy exist.
- Retention/deletion behavior, media access, export, and account deletion are exercised in production-like tests.
- Cold-start cohorts show repeat private completion and enough genuine human encouragement.
- AI and moderation unit costs are measured before pricing is announced.
- A license is selected before distributing the code outside its intended organization.

## Monetization hypothesis

Keep private tasks, sharing, safety controls, account deletion, and basic encouragement free. A later paid tier may include deeper history, routines, personalization, integrations, and companion preferences. Do not launch billing until retention is proven and the subscription-cancellation adapter is wired into account deletion.
