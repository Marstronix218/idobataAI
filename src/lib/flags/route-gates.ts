import { notFound } from "next/navigation";
import { isGateOpen, type PivotFlags, type RouteGate } from "@/lib/domain/feature-flags";
import { getFlags } from "@/lib/flags";
import { ApiError } from "@/lib/server/http";

export { isGateOpen, type RouteGate };

/**
 * Every route folder under `src/app/api` and `src/app/(app)`, keyed by its path
 * relative to `src/app`, mapped to the flag that switches it off. The longest
 * matching prefix wins, so a subfolder can override its parent. A route that
 * matches nothing fails `tests/domain/route-gates.test.ts`.
 *
 * A closed API gate answers 404 like any missing resource; a closed page gate
 * renders the not-found page. Privileged cron and worker routes answer 200 with
 * `skipped` instead, so the scheduler does not record a failure.
 */
export const ROUTE_GATES = {
  // Always on: the task workspace, the account, and the safety tools.
  "api/account": "always",
  "api/analytics": "always",
  "api/blocks": "always",
  // Muting keeps a persona out of the feed and notifications, so it stays
  // reachable as a safety control whatever else is switched off.
  "api/companion-mutes": "always",
  "api/cron/rollover": "always",
  "api/feedback": "always",
  "api/health": "always",
  // Settings loads these together with the profile; they gate nothing social.
  "api/notification-preferences": "always",
  "api/profile": "always",
  "api/reports": "always",
  "api/task-categories": "always",
  "api/tasks": "always",

  // Thread list and contacts are filtered per kind; persona threads need
  // persona_chat and human DM threads need social_feed.
  "api/chat": "chat",
  // Retry only ever applies to a persona's reply.
  "api/chat/[id]/messages/retry": "persona_chat",
  "api/companions": "persona_chat",

  // 200 `skipped` rather than 404 (privileged scheduler routes).
  "api/cron/companions": "persona_autopost",
  // Every queued job is persona work, so the drain follows persona engagement:
  // off under Pivot A; with it off the SQL AI_PERSONA_* flags decide what is queued.
  "api/workers": "persona_engagement",

  "api/directory": "social_feed",
  // The Wins view reads people-only shared wins when social_feed is off (D10).
  "api/feed": "wins",
  "api/follow-requests": "social_feed",
  "api/notifications": "social_feed",
  "api/posts": "social_feed",
  // Owners can still make a shared win private or delete it from the Wins
  // view; reading the post detail needs social_feed (checked in GET).
  "api/posts/[id]": "wins",
  "api/posts/[id]/reactions": "social_feed",
  "api/posts/[id]/replies": "social_feed",
  "api/posts/[id]/repost": "social_feed",
  "api/progress": "social_feed",
  "api/replies": "social_feed",
  "api/users": "social_feed",

  "api/tasks/[id]/publish": "share_win",
  "api/uploads/completion-images": "share_win",

  "(app)/activity": "social_feed",
  "(app)/ai-personas": "persona_chat",
  "(app)/chat": "chat",
  "(app)/companions": "persona_chat",
  "(app)/feed": "wins",
  "(app)/follow-requests": "social_feed",
  "(app)/notifications": "social_feed",
  "(app)/posts": "social_feed",
  // Redirects to /u/{username}, or to /settings while social_feed is off.
  "(app)/profile": "always",
  "(app)/settings": "always",
  "(app)/tasks": "always",
  "(app)/tasks/[taskId]/share": "share_win",
  "(app)/u": "social_feed",
} as const satisfies Record<string, RouteGate>;

/** `routePath` is a route folder relative to `src/app`, e.g. `api/chat/[id]/messages`. */
export function gateForRoute(routePath: string): RouteGate | null {
  const segments = routePath.split("/").filter(Boolean);
  for (let length = segments.length; length > 0; length -= 1) {
    const key = segments.slice(0, length).join("/");
    if (Object.hasOwn(ROUTE_GATES, key)) return ROUTE_GATES[key as keyof typeof ROUTE_GATES];
  }
  return null;
}

/** Call inside `withApi`. Returns the flags so the handler can apply per-item rules. */
export async function requireApiGate(gate: RouteGate): Promise<PivotFlags> {
  const flags = await getFlags();
  if (!isGateOpen(flags, gate)) throw new ApiError(404, "Resource not found.", "not_found");
  return flags;
}

export async function requirePageGate(gate: RouteGate): Promise<PivotFlags> {
  const flags = await getFlags();
  if (!isGateOpen(flags, gate)) notFound();
  return flags;
}
