import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveFlags } from "@/lib/domain/feature-flags";

const { authed, enforceRateLimit, getFlags } = vi.hoisted(() => ({
  authed: vi.fn(),
  enforceRateLimit: vi.fn(),
  getFlags: vi.fn(),
}));

// The real withApi, parseJson and assertDatabase, so validation and database
// errors answer as they do in production.
vi.mock("@/lib/server/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/http")>()),
  authed,
}));
vi.mock("@/lib/flags", () => ({ getFlags }));
// Age verified; the guard itself is covered by tests/integration/coach-age-guard.test.ts.
vi.mock("@/lib/coach/age", () => ({ isAgeVerified: vi.fn(async () => true), requireAgeVerified: vi.fn(async () => undefined) }));
vi.mock("@/lib/server/rate-limit", () => ({ enforceRateLimit }));

import { GET, PUT } from "@/app/api/coach/profile/route";

const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const characterId = "c1000000-0000-4000-8000-000000000001";
const NOT_FOUND = { error: { code: "not_found", message: "Resource not found." } };

const storedRow = {
  user_id: userId,
  selected_character_id: characterId,
  timezone: "America/Chicago",
  age_verified_at: null,
  age_verification_method: null,
  ai_arm: "ai",
  created_at: "2026-10-31T12:00:00.000Z",
  updated_at: "2026-10-31T12:00:00.000Z",
};
const publicProfile = { selected_character_id: characterId, timezone: "America/Chicago", age_verified_at: null };

type Result = { data: unknown; error: { message: string; code?: string } | null };

function useDatabase({ row = { data: storedRow, error: null }, rpc = { data: storedRow, error: null } }: { row?: Result; rpc?: Result } = {}) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(() => Promise.resolve(row)),
  };
  const supabase = { from: vi.fn(() => chain), rpc: vi.fn(() => Promise.resolve(rpc)) };
  authed.mockResolvedValue({ user: { id: userId }, supabase });
  return { supabase, chain };
}

const put = (body: unknown) => new Request("http://localhost/api/coach/profile", {
  method: "PUT",
  headers: { authorization: "Bearer token", "content-type": "application/json" },
  body: typeof body === "string" ? body : JSON.stringify(body),
});
const get = () => new Request("http://localhost/api/coach/profile", { headers: { authorization: "Bearer token" } });

beforeEach(() => {
  vi.clearAllMocks();
  getFlags.mockResolvedValue(resolveFlags({ "pivot_a.enabled": true }));
  enforceRateLimit.mockResolvedValue(undefined);
});

describe("GET /api/coach/profile", () => {
  it("reads the caller's own row with named columns and keeps the experiment arm server-side", async () => {
    const { supabase, chain } = useDatabase({ row: { data: publicProfile, error: null } });

    const response = await GET(get());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: publicProfile });
    expect(supabase.from).toHaveBeenCalledWith("user_coach_profiles");
    expect(chain.select).toHaveBeenCalledWith("selected_character_id, timezone, age_verified_at");
    expect(chain.eq).toHaveBeenCalledWith("user_id", userId);
  });

  it("answers an empty profile before onboarding has saved anything", async () => {
    useDatabase({ row: { data: null, error: null } });

    const response = await GET(get());

    expect(await response.json()).toEqual({ data: { selected_character_id: null, timezone: null, age_verified_at: null } });
  });

  it("answers 404 before authenticating while Pivot A is off", async () => {
    getFlags.mockResolvedValue(resolveFlags({ "pivot_a.enabled": false }));

    const response = await GET(get());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual(NOT_FOUND);
    expect(authed).not.toHaveBeenCalled();
  });
});

describe("PUT /api/coach/profile", () => {
  it("rate limits, then saves through set_coach_profile and returns the public fields", async () => {
    const { supabase } = useDatabase();

    const response = await PUT(put({ characterId, timezone: "America/Chicago" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: publicProfile });
    expect(enforceRateLimit).toHaveBeenCalledWith(userId, "coach:profile:update", 60, 3600);
    expect(supabase.rpc).toHaveBeenCalledWith("set_coach_profile", { p_character_id: characterId, p_timezone: "America/Chicago" });
    expect(enforceRateLimit.mock.invocationCallOrder[0]).toBeLessThan(supabase.rpc.mock.invocationCallOrder[0]);
  });

  it("passes null for a field left out, so the database keeps its value", async () => {
    const { supabase } = useDatabase();

    await PUT(put({ timezone: "Europe/London" }));
    await PUT(put({ characterId }));

    expect(supabase.rpc).toHaveBeenNthCalledWith(1, "set_coach_profile", { p_character_id: null, p_timezone: "Europe/London" });
    expect(supabase.rpc).toHaveBeenNthCalledWith(2, "set_coach_profile", { p_character_id: characterId, p_timezone: null });
  });

  it.each([
    ["an empty body", {}],
    ["a character id that is not a uuid", { characterId: "launch-coach" }],
    ["an unknown time zone", { timezone: "Not/AZone" }],
    ["an empty time zone", { timezone: "" }],
    ["a field the route does not accept", { characterId, userId }],
    ["a null character", { characterId: null }],
  ])("rejects %s with 422 before touching the database", async (_name, body) => {
    const { supabase } = useDatabase();

    const response = await PUT(put(body));

    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("validation_error");
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON with 400", async () => {
    const { supabase } = useDatabase();

    const response = await PUT(put("{"));

    expect(response.status).toBe(400);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["an unselectable character", { code: "P0002", message: "character not found" }, 404, { code: "character_not_found", message: "That character is not available." }],
    ["a zone the database does not know", { code: "22023", message: "invalid time zone" }, 400, { code: "invalid_timezone", message: "Choose a valid time zone." }],
    ["Pivot A switched off after the gate", { code: "P0001", message: "feature disabled" }, 404, NOT_FOUND.error],
    ["the database rate limit", { code: "P0001", message: "rate limit exceeded" }, 429, { code: "rate_limited", message: "You are doing that a little too quickly. Try again shortly." }],
    ["an unmapped failure", { code: "XX999", message: "relation \"user_coach_profiles\" says no" }, 400, { code: "database_error", message: "That request could not be completed." }],
  ])("maps %s", async (_name, error, status, body) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    useDatabase({ rpc: { data: null, error } });

    const response = await PUT(put({ characterId, timezone: "America/Chicago" }));

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: body });
  });

  it("answers 404 before authenticating, rate limiting or saving while Pivot A is off", async () => {
    getFlags.mockResolvedValue(resolveFlags({}));

    const response = await PUT(put({ characterId }));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual(NOT_FOUND);
    expect(authed).not.toHaveBeenCalled();
    expect(enforceRateLimit).not.toHaveBeenCalled();
  });
});
