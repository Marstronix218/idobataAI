# Design

## Source of truth

- Status: Active
- Last refreshed: 2026-08-16
- Primary product surfaces: marketing, authentication, onboarding, social feed, task dashboard, completion composer, notifications, AI follower directory, profile, and settings.
- Evidence reviewed: the complete product brief in the supplied `pasted-text.txt`; the current app shell, feed, task, notification, follower, profile, settings, and theme implementation; Next.js 16 App Router guidance in `node_modules/next/dist/docs/`; WCAG 2.1 AA requirements from the brief; the approved TaskTomo dashboard theme reference captured at `.omx/artifacts/visual-ralph/tasktomo-theme/reference.png`; the 2026-08-13 direction to make the main feed structurally similar to X.com without changing the theme palette; the 2026-08-14 direction to simplify the Tasks tab into a legible “Your Tasks” workspace, remove visible XP, retain streaks, and support completion-post images; the 2026-08-14 direction to remove Followers from primary navigation and expose the AI follower directory from the profile like X; the 2026-08-14 direction to expose Settings as its own tab and make the profile’s Edit profile action a focused X-like identity editor; current official product and pricing material for Finch, Habitica, Focusmate, Todoist, and Sunsama; Habitica's public-community safety rationale; current Supabase Auth recovery guidance; and X's live profile hierarchy plus official profile-customization and profile-photo guidance reviewed on 2026-08-14.

## Brand

- Personality: warm, grounded, candid, quietly energetic, and communal—with a calm nocturnal focus inside the signed-in product.
- Trust signals: tasks start private; publishing is always explicit; every AI identity carries a visible `AI` tag; AI engagement is optional rather than guaranteed; no popularity rankings.
- Avoid: neon gamification, guilt, streak-loss pressure, childish confetti, loud or ubiquitous gradients, generic corporate dashboards, unlabeled AI activity, and color-only status indicators.

## Product goals

- Product promise: **Finish the small thing. Keep the details private. Share the win only when encouragement would help.**
- Goals: own the low-pressure, asynchronous moment after a person finishes something; make private task completion satisfying; give users one legible daily workspace; let users deliberately share chosen wins with optional images; provide specific, safe encouragement from humans and visibly labeled AI companions; reward understandable consistency over popularity.
- Non-goals: Todoist-level project management, calendar-led daily planning, live body doubling, clinical or mental-health-treatment claims, human account-follow/follower-growth mechanics, leaderboards, competition, guaranteed AI responses, automatic social publishing, private copies of shared AI accounts, or provider-dependent core behavior.
- Activation metric: a person creates a private task, completes it, deliberately chooses whether to share, receives optional encouragement, and creates another task within seven days. Track each step separately; never treat posting or AI interaction as required activation.
- Success signals: users complete tasks, understand privacy controls, deliberately post completions, receive accessible engagement, and return to continue their own momentum. The human-only feed remains useful without AI activity.

## Personas and jobs

- Primary personas: adults who already try task lists but abandon them because the experience becomes lonely, guilt-inducing, or performative, especially while managing mixed work, learning, wellbeing, and life-admin tasks.
- User jobs: capture a task quickly; keep it private by default; finish and celebrate it; optionally make progress visible; optionally post the completion; encourage others; tune AI and privacy preferences.
- Key contexts of use: brief mobile check-ins, focused desktop planning, low-energy days, reduced-motion settings, keyboard and assistive-technology use.

## Information architecture

- Primary navigation: a persistent X-inspired desktop rail and compact mobile bottom bar led by Feed, followed by Your Tasks, Chat, Notifications, Profile, and Settings; task creation remains the prominent global action. Profile and Settings are distinct destinations: Profile is the social identity/timeline, while Settings owns preferences, privacy, safety, and account controls. The AI follower directory is discovered from the profile header instead of occupying a primary-navigation destination.
- Core routes/screens: `/`, `/login`, `/sign-up`, `/forgot-password`, `/resend-confirmation`, `/auth/callback`, `/update-password`, `/onboarding`, `/feed`, `/posts/[postId]`, `/tasks`, `/tasks/[taskId]/share`, `/chat`, `/activity`, `/companions`, `/u/[username]`, `/u/[username]/edit`, `/settings`.
- Content hierarchy: Feed is the default destination after sign-in and onboarding. Feed, Notifications, and Profile may use navigation, a focused main column, and a personal context rail when the rail adds distinct value. Settings uses the persistent navigation plus one wider 900–980px workspace with no personal context rail, keeping its multi-section controls comfortably legible. The owner-only Edit profile action opens a focused editor for public identity fields (photo, display name, handle, bio, and interests); it does not expose privacy, notification, mute, logout, or account-deletion controls. Those controls remain under Settings. The profile header exposes the shared, clearly labeled AI companion directory through an X-style count link; `/companions` remains the directory route but is not a primary tab. On Feed, the rail labels today’s tasks as part of **Your Tasks**, explains that planning and completion happen there, and provides an explicit route into that workspace. **Your Tasks is intentionally different:** persistent navigation plus one dominant 900–980px task workspace, with no duplicate task rail. Within Your Tasks, time filters and list sections replace parallel columns. The feed timeline offers “For you,” interest-based “Your interests,” and “People only,” plus a category filter sourced from the user’s chosen interests. Completion and explicit sharing still precede social engagement.

## Design principles

- Private by default, explicit by design: profile visibility, task visibility, completion, and social publishing are separate concepts and controls.
- Celebrate effort without pressure: use “wins,” “momentum,” “today,” and a plainly defined streak; never imply shame or loss.
- AI identity is structural: a compact filled `AI` tag appears immediately after every AI account name, without repeating AI-generated disclosures inside the same post.
- AI attention is non-transactional: an AI follower may like, reply, or stay quiet; publishing never promises or guarantees engagement.
- Authenticity through distinct lives: the preview feed demonstrates a believable mix of people and AI, while a production bootstrap begins honestly empty instead of manufacturing human activity. Each active AI persona has several concrete tasks rather than one generic “today’s task,” posts at least three task notes per UTC day, and targets about six. Human-only participation stays one tap away. Synthetic likes and replies must remain visibly attributable, rate-limited, mutable, and optional.
- Progress before popularity: streak, completed work, goal progress, and categories outrank like counts. XP is not shown in the product UI.
- One strong action per surface: tasks emphasize completion, feed emphasizes encouragement, and the composer emphasizes audience confirmation.
- Tradeoffs: warm surfaces and celebration must remain quiet enough for dense task/feed use; clear labels take precedence over minimal chrome.

## Visual language

- Color: public marketing and auth surfaces retain the warm oat canvas `#f7f2e9`, cream/white surfaces, ink `#26221d`, clay brand red `#c94f2d`, and community teal `#156b67`. Signed-in product surfaces use a TaskTomo-inspired but distinct nocturnal palette: canvas `#070b16`, sidebar `#0e1625`, card `#141d2e`, raised control `#1b2639`, strong text `#f6f8fc`, muted text `#aab4c8`, violet brand `#7c3aed`, restrained berry accent `#be185d`, community blue `#55b6f6`, warm amber `#f4a261`, success green `#4ade80`, danger rose `#fb7185`, and blue focus `#60a5fa`. Violet-to-berry gradients are reserved for the strongest primary action; status meaning never depends on hue alone.
- Typography: expressive but readable grotesk headings and friendly UI body text, served through `next/font`; use robust system fallbacks. Match the live X hierarchy reviewed on 2026-08-14: standard interface and timeline copy is at least 15px/20px, supporting metadata is at least 13px/16px, and labeled desktop navigation is 20px/24px.
- Spacing/layout rhythm: 4px base; common gaps 8, 12, 16, 20, 24, 32, 48, and 64px. Timeline posts use the tighter end of that scale: 16px outer padding, 10–12px between identity, note, task context, and actions, and 12px task-card padding without reducing the established font sizes. At desktop sidebar breakpoints, the primary content frame starts flush against the sidebar boundary rather than re-centering inside the remaining viewport; surplus width stays to the right. The desktop feed timeline is a compact bordered column around 600–620px with a 320–350px contextual rail; Your Tasks and Settings use one wider 900–980px workspace; focused forms remain about 520px.
- Shape/radius/elevation: 10px inputs, 14px task rows, 18px cards, 24px sheets/dialogs, pill badges, and low-contrast cool borders with minimal shadow in signed-in dark surfaces.
- Motion: 140–180ms micro-interactions, 220–260ms overlays, and a completion seal no longer than 420ms. No endless animation.
- Imagery/iconography: simple line icons with accessible labels. The distinctive completion/gathering-ring motif repeats sparingly in goal meters, avatars, and success states. No model-authored decorative SVG illustrations.

## Components

- Existing components to reuse: the app shell, buttons, badges, avatars, page headers, task cards, post cards, like controls, and feedback notices created in `src/components`.
- New/changed components: `GoalMeter`, `PrivacyBadge`, `AITag`, `TaskRow`, `CompletionSharePrompt`, `PostMediaGrid`, `CommunityProgressCard`, compact timeline `PostCard`, `RelativeTime`, `LikeButton`, owner post controls, AI companion cards, X-inspired social profile header/tabs, focused profile editor, profile-photo upload control, password-recovery forms, settings panels, `AppTabLayout`, and `MomentumRail`. In Edit profile, the displayed circular avatar is itself the full upload trigger, with a persistent centered camera overlay; the action is not separated into a secondary upload button. Existing illustration and initials choices remain available below it. Your Tasks and Settings opt out of `MomentumRail`; Your Tasks integrates its non-duplicative streak/daily-progress context into the page header, while Settings uses the freed width for its section navigation and controls. Other primary tabs may retain the rail, which shows today’s tasks, daily-goal completion, and current streak without XP. On Feed, task rows and the rail footer use explicit “Your Tasks” destination language so first-time users understand where planning and completion happen. The feed uses “For you,” interest-based “Your interests,” and “People only,” an adjacent category selector, completion-gated sharing, privacy-scoped signed post media, and owner-only audience/delete actions; notifications uses “All” and “Unread” views. Social profiles use a compact cover/identity hierarchy (84px on mobile, 108px from the small breakpoint), display name plus handle, short bio, privacy state, Posts/Progress tabs, an X-style active AI companion count that links to the shared directory, and compact timeline rows without introducing human account-follow mechanics. Settings is a separate navigation destination and excludes public identity editing.
- Variants and states: owner/non-owner, human/AI, private/public profile, private/public post, pending/completed, avatar upload/invalid/success, loading/empty/error/success/disabled, optimistic mutation plus delayed-refresh warning, and reduced motion.
- Token/component ownership: semantic design tokens live in `src/app/globals.css`; reusable behavior and markup live in `src/components`; route pages compose those primitives without duplicating token definitions.

## Accessibility

- Target standard: WCAG 2.1 AA.
- Keyboard/focus behavior: 44px minimum targets, visible 3px focus rings with surface offset, skip link, semantic landmarks, complete keyboard navigation, and no hover-only information. The full profile avatar upload target is a keyboard-operable button with an accessible name; its camera affordance remains visible without hover.
- Contrast/readability: dark ink on warm light surfaces and near-white text on dark signed-in surfaces; muted signed-in text is at least `#8792a8` on `#141d2e`; filled high-contrast AI badge; category/status text accompanies color.
- Screen-reader semantics: icon buttons have accessible names; likes use `aria-pressed`; task and media mutations use polite live regions; privacy and AI status are readable text; meters expose textual equivalents.
- Reduced motion and sensory considerations: `prefers-reduced-motion` removes transforms, confetti/radial ticks, smooth scrolling, and stagger. State, text, and icon changes still communicate results.

## Responsive behavior

- Supported breakpoints/devices: 320px mobile through 1440px desktop; priority checks at 390×844, 768×1024, 1280×800, and 1440×900.
- Layout adaptations: single-column content and fixed labeled bottom navigation on mobile; centered content on tablet; compact 88px icon rail from 1024px; full 280px labeled navigation from 1280px. Once a desktop rail is present, tab content aligns directly to its right edge. Contextual rails remain optional and are hidden below 1280px. Your Tasks and Settings never add a right rail; their primary content uses the freed width while preserving comfortable line lengths.
- Touch/hover differences: controls remain at least 44px on touch; hover supplements focus/pressed styling; mobile filters and composers use sheets or stacked panels.

## Interaction states

- Loading: preserve layout with restrained skeletons and status text; avatar uploads retain the current image until the replacement is stored.
- Empty: explain the next useful action without pressure.
- Error: give a specific, recoverable action and keep successful local mutations successful.
- Success: use a brief completion seal, clear text, streak context, `Post a win`, `Undo`, and a live-region announcement.
- Disabled: preserve legibility and explain why when the reason is not obvious.
- Offline/slow network: keep canonical mutation feedback separate from refresh warnings; never report a saved reaction/post as failed only because refetching failed.

## Content voice

- Tone: specific, encouraging, calm, recognizably humorous, and respectful of unfinished work. AI persona posts should land a dry observation, playful comparison, or small punchline without becoming random, loud, or mean.
- Terminology: “Your Tasks,” “win,” “momentum,” “completion,” “recurring task” or “routine,” “Community progress,” “Post a win,” “Private,” “Public,” `AI follower`, the compact identity tag `AI`, and `AI-generated`. Chores use recurring-task behavior; habits are not a separate product type unless check-in frequency, missed-day rules, and history are specified.
- Microcopy rules: never use guilt, manipulation, romance, pressure, ranking, or generic praise. Explain privacy at the decision point. Say exactly what an action shares or changes. A completion card already states what was done, so its accompanying note should add a humorous reaction, impression, small observation, or personal takeaway instead of paraphrasing the task. AI task titles name the actual task and never use “Complete today’s [interest] task.”

## Implementation constraints

- Framework/styling system: Next.js App Router, React, TypeScript, Tailwind CSS v4, and authenticated Supabase Storage for user-uploaded profile photos.
- Design-token constraints: use semantic CSS variables; signed-in theme overrides live under the `.app-theme` scope; do not add a parallel token layer.
- Media constraints: completion posts accept up to four optional JPEG, PNG, or WebP images at 5MB each. Originals live in a private storage bucket; the database stores opaque paths, and clients receive short-lived signed URLs only after post visibility is authorized. Image selection never changes the post audience.
- Performance constraints: Server Components by default and narrow client boundaries for forms, task controls, likes, filters, dialogs, and uploads; avatar files are capped at 2 MB and stored under immutable user-owned paths to avoid stale CDN replacements.
- Compatibility constraints: mobile-first, keyboard and screen-reader friendly, reduced-motion safe, and Vercel-compatible.
- Test/screenshot expectations: component accessibility assertions plus mobile feed rendering; production build must not need runtime font, database, or AI-provider availability.

## Open questions

- [ ] Final illustrated companion avatar set / product owner / affects brand polish, not function.
- [ ] Final production domain and social preview image / deployment owner / affects metadata only.
- [ ] Counsel-reviewed terms, privacy notice, age policy, and vendor disclosures / operations owner / blocks broad public launch.
- [ ] Moderation owner, review queue, response SLA, escalation path, and abuse runbook / trust and safety owner / blocks broad public launch.
- [ ] Custom SMTP, exact production auth redirect allowlist, and recovery-email deliverability test / deployment owner / blocks inviting external beta users.
- [ ] Billing provider and subscription cancellation contract / product owner / blocks production activation of destructive account deletion when paid plans are introduced.
