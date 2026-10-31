import { readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isGateOpen, resolveFlags, type PivotFlagKey, type RouteGate } from "@/lib/domain/feature-flags";

const {
  authed,
  createAdminClient,
  createChatReply,
  drainAIJobs,
  drainAfterHumanEngagement,
  enforceRateLimit,
  getFlags,
} = vi.hoisted(() => ({
  authed: vi.fn(),
  createAdminClient: vi.fn(),
  createChatReply: vi.fn(),
  drainAIJobs: vi.fn(),
  drainAfterHumanEngagement: vi.fn(),
  enforceRateLimit: vi.fn(),
  getFlags: vi.fn(),
}));

vi.mock("@/lib/server/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/http")>()),
  authed,
}));
vi.mock("@/lib/flags", () => ({ getFlags }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
vi.mock("@/lib/server/rate-limit", () => ({ enforceRateLimit }));
vi.mock("@/lib/server/chat-reply", () => ({ createChatReply }));
vi.mock("@/lib/ai", () => ({ drainAIJobs, drainAfterHumanEngagement }));

import { gateForRoute } from "@/lib/flags/route-gates";

const APP_DIR = join(process.cwd(), "src", "app");
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const NOT_FOUND = { error: { code: "not_found", message: "Resource not found." } };
const CRON_SECRET = "test-cron-secret";
const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/** The smallest flag change that closes each gate. */
const CLOSING_ROWS: Record<Exclude<RouteGate, "always">, Partial<Record<PivotFlagKey, boolean>>> = {
  pivot_a: { "pivot_a.enabled": false },
  social_feed: { "social_feed.enabled": false },
  persona_chat: { "persona_chat.enabled": false },
  persona_autopost: { "persona_autopost.enabled": false },
  persona_engagement: { "pivot_a.enabled": true },
  share_win: { "share_win.enabled": false },
  wins: { "social_feed.enabled": false, "share_win.enabled": false },
  chat: { "social_feed.enabled": false, "persona_chat.enabled": false },
};

// Privileged scheduler routes answer 200 `skipped` so the cron run is not
// recorded as a failure; every other closed route is a plain 404.
const SKIPPED: Partial<Record<RouteGate, string>> = {
  persona_autopost: "persona_autopost disabled",
  persona_engagement: "persona_engagement disabled",
};

const gatedRoutes = (readdirSync(join(APP_DIR, "api"), { recursive: true }) as string[])
  .filter((path) => path.split(sep).at(-1) === "route.ts")
  .map((path) => {
    const file = join(APP_DIR, "api", path);
    const folder = relative(APP_DIR, dirname(file)).split(sep).join("/");
    return { file, folder, gate: gateForRoute(folder) };
  })
  .filter((route): route is { file: string; folder: string; gate: Exclude<RouteGate, "always"> } => Boolean(route.gate) && route.gate !== "always");

function requestFor(folder: string, method: string) {
  return new Request(`http://localhost/${folder.replaceAll("[id]", ID).replaceAll("[userId]", ID).replaceAll("[companionId]", ID)}`, {
    method,
    headers: { authorization: `Bearer ${CRON_SECRET}`, "content-type": "application/json" },
    ...(method === "GET" ? {} : { body: "{}" }),
  });
}

const context = { params: Promise.resolve({ id: ID, userId: ID, companionId: ID }) };
type Handler = (request: Request, context: unknown) => Promise<Response>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", CRON_SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("every gated API handler with its gate closed", () => {
  it("covers the gated routes", () => {
    expect(gatedRoutes.length).toBeGreaterThanOrEqual(27);
  });

  it.each(Object.entries(CLOSING_ROWS))("closes %s with its closing rows", (gate, rows) => {
    expect(isGateOpen(resolveFlags(rows), gate as RouteGate)).toBe(false);
  });

  it.each(gatedRoutes.map((route) => [route.folder, route.gate, route]))("%s (%s) answers before any auth or database call", async (folder, gate, { file }) => {
    getFlags.mockResolvedValue(resolveFlags(CLOSING_ROWS[gate]));
    const routeModule = await import(file) as Partial<Record<(typeof HTTP_METHODS)[number], Handler>>;
    const methods = HTTP_METHODS.filter((method) => typeof routeModule[method] === "function");
    expect(methods.length).toBeGreaterThan(0);

    for (const method of methods) {
      const response = await routeModule[method]!(requestFor(folder, method), context);
      const skipped = SKIPPED[gate];
      expect(response.status, `${method} ${folder}`).toBe(skipped ? 200 : 404);
      expect(await response.json(), `${method} ${folder}`).toEqual(skipped ? { data: { skipped } } : NOT_FOUND);
    }
    expect(authed).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(enforceRateLimit).not.toHaveBeenCalled();
    expect(drainAIJobs).not.toHaveBeenCalled();
  });

  it("refuses the post detail in the Wins view, where only social_feed is off", async () => {
    getFlags.mockResolvedValue(resolveFlags({ "social_feed.enabled": false }));
    const { GET } = await import("@/app/api/posts/[id]/route");

    const response = await GET(requestFor("api/posts/[id]", "GET"), context);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual(NOT_FOUND);
    expect(authed).not.toHaveBeenCalled();
  });
});
