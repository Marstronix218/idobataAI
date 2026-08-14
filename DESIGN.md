# Design

## Source of truth

- Status: Active
- Last refreshed: 2026-08-12
- Primary product surfaces: marketing, authentication, onboarding, task dashboard, social feed, completion composer, activity, companion directory, profile, and settings.
- Evidence reviewed: the complete product brief in the supplied `pasted-text.txt`; the initial empty repository; Next.js App Router and Tailwind scaffold; WCAG 2.1 AA requirements from the brief; and the approved TaskTomo dashboard theme reference captured at `.omx/artifacts/visual-ralph/tasktomo-theme/reference.png` from `https://tasktomo.vercel.app/dashboard` on 2026-08-12.

## Brand

- Personality: warm, grounded, candid, quietly energetic, and communal—with a calm nocturnal focus inside the signed-in product.
- Trust signals: tasks start private; publishing is always explicit; every AI identity is labeled in text; no follower counts or popularity rankings.
- Avoid: neon gamification, guilt, streak-loss pressure, childish confetti, loud or ubiquitous gradients, generic corporate dashboards, unlabeled AI activity, and color-only status indicators.

## Product goals

- Goals: make private task completion satisfying; let users deliberately share chosen wins; provide specific, safe encouragement from humans and visibly labeled AI companions; reward consistency over popularity.
- Non-goals: follower growth, leaderboards, competition, automatic social publishing, private copies of shared AI companions, or provider-dependent core behavior.
- Success signals: users complete tasks, understand privacy controls, deliberately post completions, receive accessible engagement, and return to continue their own momentum.

## Personas and jobs

- Primary personas: people managing work, learning, wellbeing, and life-admin tasks who benefit from gentle accountability without public pressure.
- User jobs: capture a task quickly; keep it private by default; finish and celebrate it; optionally make progress visible; optionally post the completion; encourage others; tune AI and privacy preferences.
- Key contexts of use: brief mobile check-ins, focused desktop planning, low-energy days, reduced-motion settings, keyboard and assistive-technology use.

## Information architecture

- Primary navigation: Tasks, Feed, Activity, Companions, You.
- Core routes/screens: `/`, `/login`, `/sign-up`, `/onboarding`, `/tasks`, `/feed`, `/tasks/[taskId]/share`, `/activity`, `/companions`, `/u/[username]`, `/settings`.
- Content hierarchy: current task/goal action first; completion feedback second; explicit sharing choice third; social engagement after publishing. Motivation metrics are more prominent than engagement counts.

## Design principles

- Private by default, explicit by design: task visibility, completion, and social publishing are separate concepts and controls.
- Celebrate effort without pressure: use “wins,” “momentum,” and “today”; never imply shame or loss.
- AI identity is structural: a filled `AI companion` badge appears beside every AI author and AI posts include an `AI-generated` disclosure.
- Progress before popularity: XP, streak, goal progress, and categories outrank reaction counts.
- One strong action per surface: tasks emphasize completion, feed emphasizes encouragement, and the composer emphasizes audience confirmation.
- Tradeoffs: warm surfaces and celebration must remain quiet enough for dense task/feed use; clear labels take precedence over minimal chrome.

## Visual language

- Color: public marketing and auth surfaces retain the warm oat canvas `#f7f2e9`, cream/white surfaces, ink `#26221d`, clay brand red `#c94f2d`, and community teal `#156b67`. Signed-in product surfaces use a TaskTomo-inspired but distinct nocturnal palette: canvas `#070b16`, sidebar `#0e1625`, card `#141d2e`, raised control `#1b2639`, strong text `#f6f8fc`, muted text `#aab4c8`, violet brand `#7c3aed`, restrained berry accent `#be185d`, community blue `#55b6f6`, warm amber `#f4a261`, success green `#4ade80`, danger rose `#fb7185`, and blue focus `#60a5fa`. Violet-to-berry gradients are reserved for the strongest primary action; status meaning never depends on hue alone.
- Typography: expressive but readable grotesk headings and friendly UI body text, served through `next/font`; use robust system fallbacks.
- Spacing/layout rhythm: 4px base; common gaps 8, 12, 16, 20, 24, 32, 48, and 64px. Feed reading width is about 680px; focused forms about 520px.
- Shape/radius/elevation: 10px inputs, 14px task rows, 18px cards, 24px sheets/dialogs, pill badges, and low-contrast cool borders with minimal shadow in signed-in dark surfaces.
- Motion: 140–180ms micro-interactions, 220–260ms overlays, and a completion seal no longer than 420ms. No endless animation.
- Imagery/iconography: simple line icons with accessible labels. The distinctive completion/gathering-ring motif repeats sparingly in goal meters, avatars, and success states. No model-authored decorative SVG illustrations.

## Components

- Existing components to reuse: the app shell, buttons, badges, avatars, page headers, task cards, post cards, reaction controls, and feedback notices created in `src/components`.
- New/changed components: `GoalMeter`, `PrivacyBadge`, `AICompanionBadge`, `TaskRow`, `CompletionSharePrompt`, `CommunityProgressCard`, `PostCard`, `ReactionBar`, `CompanionCard`, and settings panels.
- Variants and states: owner/non-owner, human/AI, private/public, pending/completed, loading/empty/error/success/disabled, optimistic mutation plus delayed-refresh warning, and reduced motion.
- Token/component ownership: semantic design tokens live in `src/app/globals.css`; reusable behavior and markup live in `src/components`; route pages compose those primitives without duplicating token definitions.

## Accessibility

- Target standard: WCAG 2.1 AA.
- Keyboard/focus behavior: 44px minimum targets, visible 3px focus rings with surface offset, skip link, semantic landmarks, complete keyboard navigation, and no hover-only information.
- Contrast/readability: dark ink on warm light surfaces and near-white text on dark signed-in surfaces; muted signed-in text is at least `#8792a8` on `#141d2e`; filled high-contrast AI badge; category/status text accompanies color.
- Screen-reader semantics: icon buttons have accessible names; reactions use `aria-pressed`; mutation and XP feedback use polite live regions; privacy and AI status are readable text; meters expose textual equivalents.
- Reduced motion and sensory considerations: `prefers-reduced-motion` removes transforms, confetti/radial ticks, smooth scrolling, and stagger. State, text, and icon changes still communicate results.

## Responsive behavior

- Supported breakpoints/devices: 320px mobile through 1440px desktop; priority checks at 390×844, 768×1024, 1280×800, and 1440×900.
- Layout adaptations: single-column content and fixed labeled bottom navigation on mobile; centered content on tablet; sticky 232px left rail and optional 280–320px contextual right rail from desktop sizes.
- Touch/hover differences: controls remain at least 44px on touch; hover supplements focus/pressed styling; mobile filters and composers use sheets or stacked panels.

## Interaction states

- Loading: preserve layout with restrained skeletons and status text.
- Empty: explain the next useful action without pressure.
- Error: give a specific, recoverable action and keep successful local mutations successful.
- Success: use a brief completion seal, clear text, XP/streak detail, and a live-region announcement.
- Disabled: preserve legibility and explain why when the reason is not obvious.
- Offline/slow network: keep canonical mutation feedback separate from refresh warnings; never report a saved reaction/post as failed only because refetching failed.

## Content voice

- Tone: specific, encouraging, calm, lightly playful, and respectful of unfinished work.
- Terminology: “win,” “momentum,” “completion,” “Community progress,” “Post to Social,” “Private,” “Public,” `AI companion`, and `AI-generated`.
- Microcopy rules: never use guilt, manipulation, romance, pressure, ranking, or generic praise. Explain privacy at the decision point. Say exactly what an action shares or changes.

## Implementation constraints

- Framework/styling system: Next.js App Router, React, TypeScript, and Tailwind CSS v4.
- Design-token constraints: use semantic CSS variables; signed-in theme overrides live under the `.app-theme` scope; do not add a parallel token layer.
- Performance constraints: Server Components by default and narrow client boundaries for forms, task controls, reactions, filters, and dialogs.
- Compatibility constraints: mobile-first, keyboard and screen-reader friendly, reduced-motion safe, and Vercel-compatible.
- Test/screenshot expectations: component accessibility assertions plus mobile feed rendering; production build must not need runtime font, database, or AI-provider availability.

## Open questions

- [ ] Final illustrated companion avatar set / product owner / affects brand polish, not function.
- [ ] Final production domain and social preview image / deployment owner / affects metadata only.
- [ ] Billing provider and subscription cancellation contract / product owner / blocks production activation of destructive account deletion when paid plans are introduced.
