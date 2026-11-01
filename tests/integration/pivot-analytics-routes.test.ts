import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveFlags } from "@/lib/domain/feature-flags";

const { authed, createAdminClient, enforceRateLimit, getFlags, rpc } = vi.hoisted(() => ({
  authed: vi.fn(),
  createAdminClient: vi.fn(),
  enforceRateLimit: vi.fn(),
  getFlags: vi.fn(),
  rpc: vi.fn(),
}));

// The real withApi, parseJson and errors; only authentication is stubbed.
vi.mock("@/lib/server/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/http")>()),
  authed,
}));
vi.mock("@/lib/flags", () => ({ getFlags }));
vi.mock("@/lib/server/rate-limit", () => ({ enforceRateLimit }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));

import { POST as postEvent } from "@/app/api/analytics/event/route";
import { POST as postSession } from "@/app/api/analytics/session/route";
import { ApiError } from "@/lib/server/http";
import { AuthenticationError } from "@/lib/supabase/bearer";

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NOT_FOUND = { error: { code: "not_found", message: "Resource not found." } };

const request = (path: string, body: unknown) => new Request(`http://localhost${path}`, {
  method: "POST",
  headers: { authorization: "Bearer token", "content-type": "application/json" },
  body: typeof body === "string" ? body : JSON.stringify(body),
});
const event = (body: unknown) => postEvent(request("/api/analytics/event", body));
const session = (body: unknown) => postSession(request("/api/analytics/session", body));
const recorded = () => rpc.mock.calls.filter(([name]) => name === "record_coach_product_event").map(([, args]) => args as Record<string, unknown>);

beforeEach(() => {
  vi.clearAllMocks();
  getFlags.mockResolvedValue(resolveFlags({ "pivot_a.enabled": true }));
  authed.mockResolvedValue({ user: { id: USER_ID } });
  enforceRateLimit.mockResolvedValue(undefined);
  rpc.mockResolvedValue({ data: null, error: null });
  createAdminClient.mockReturnValue({ rpc });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("POST /api/analytics/event", () => {
  it.each(["split", "story"])("records paywall_viewed for the %s notice, for the signed-in user only", async (detail) => {
    const response = await event({ name: "paywall_viewed", detail });

    expect(response.status).toBe(204);
    expect(recorded()).toEqual([{ p_user_id: USER_ID, p_event_name: "paywall_viewed", p_detail: detail, p_duration_seconds: null }]);
    expect(enforceRateLimit).toHaveBeenCalledWith(USER_ID, "analytics:event", 60, 3600);
  });

  it("leaves the once-a-day dedupe to the database, keyed by the server's user and surface", async () => {
    await event({ name: "paywall_viewed", detail: "split" });
    await event({ name: "paywall_viewed", detail: "split" });

    // record_coach_product_event derives one source id per user, local day and surface (pgTAP covers the dedupe).
    expect(recorded()).toHaveLength(2);
    expect(new Set(recorded().map((args) => JSON.stringify(args))).size).toBe(1);
  });

  it.each([
    ["any other event name", { name: "purchase", detail: "split" }],
    ["a trigger-owned name", { name: "task_finished", detail: "split" }],
    ["session_length", { name: "session_length", detail: "split" }],
    ["an unknown surface", { name: "paywall_viewed", detail: "banner" }],
    ["no surface", { name: "paywall_viewed" }],
    ["extra fields (content)", { name: "paywall_viewed", detail: "split", title: "Water the plants" }],
    ["a user id from the client", { name: "paywall_viewed", detail: "story", userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }],
    ["an array", [{ name: "paywall_viewed", detail: "split" }]],
  ])("refuses %s with 422 and records nothing", async (_name, body) => {
    const response = await event(body);

    expect(response.status).toBe(422);
    expect(recorded()).toEqual([]);
  });

  it("answers 400 for a body that is not JSON", async () => {
    expect((await event("name=paywall_viewed")).status).toBe(400);
    expect(recorded()).toEqual([]);
  });

  it("is a 404 with Pivot A off, before authentication", async () => {
    getFlags.mockResolvedValue(resolveFlags({}));

    const response = await event({ name: "paywall_viewed", detail: "split" });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual(NOT_FOUND);
    expect(authed).not.toHaveBeenCalled();
  });

  it("needs a signed-in user", async () => {
    authed.mockRejectedValue(new AuthenticationError("Authentication required."));

    expect((await event({ name: "paywall_viewed", detail: "split" })).status).toBe(401);
    expect(recorded()).toEqual([]);
  });

  it("is rate limited before anything is recorded", async () => {
    enforceRateLimit.mockRejectedValue(new ApiError(429, "Slow down.", "rate_limited"));

    expect((await event({ name: "paywall_viewed", detail: "split" })).status).toBe(429);
    expect(recorded()).toEqual([]);
  });

  it("still answers 204 when the write fails, logging no user id", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom", code: "XX000" } });

    expect((await event({ name: "paywall_viewed", detail: "split" })).status).toBe(204);
    const logged = vi.mocked(console.error).mock.calls.map(([line]) => String(line)).join("\n");
    expect(logged).toContain("paywall_viewed not recorded");
    expect(logged).not.toContain(USER_ID);
  });
});

describe("POST /api/analytics/session", () => {
  it.each([
    [95, 95],
    [95.4, 95],
    [95.6, 96],
    [86_400, 86_400],
    [100_000, 86_400],
  ])("records %s seconds as %s", async (sent, stored) => {
    const response = await session({ durationSeconds: sent });

    expect(response.status).toBe(204);
    expect(recorded()).toEqual([{ p_user_id: USER_ID, p_event_name: "session_length", p_detail: null, p_duration_seconds: stored }]);
    expect(enforceRateLimit).toHaveBeenCalledWith(USER_ID, "analytics:session", 120, 3600);
  });

  it.each([0, 0.4, -5, -100_000])("records nothing for %s seconds", async (sent) => {
    expect((await session({ durationSeconds: sent })).status).toBe(204);
    expect(recorded()).toEqual([]);
  });

  it.each([
    ["a string", { durationSeconds: "90" }],
    ["Infinity (null in JSON)", { durationSeconds: Infinity }],
    ["no duration", {}],
    ["a page or other content", { durationSeconds: 90, path: "/tasks" }],
  ])("refuses %s with 422", async (_name, body) => {
    expect((await session(body)).status).toBe(422);
    expect(recorded()).toEqual([]);
  });

  it("needs a signed-in user (the bearer token the tracker sends with keepalive)", async () => {
    authed.mockRejectedValue(new AuthenticationError("Authentication required."));

    expect((await session({ durationSeconds: 60 })).status).toBe(401);
    expect(recorded()).toEqual([]);
  });

  it("is a 404 with Pivot A off, before authentication", async () => {
    getFlags.mockResolvedValue(resolveFlags({}));

    expect((await session({ durationSeconds: 60 })).status).toBe(404);
    expect(authed).not.toHaveBeenCalled();
    expect(recorded()).toEqual([]);
  });

  it("is rate limited", async () => {
    enforceRateLimit.mockRejectedValue(new ApiError(429, "Slow down.", "rate_limited"));

    expect((await session({ durationSeconds: 60 })).status).toBe(429);
    expect(recorded()).toEqual([]);
  });
});
