import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveFlags } from "@/lib/domain/feature-flags";

const { authed, createAdminClient, enforceRateLimit, getFlags } = vi.hoisted(() => ({
  authed: vi.fn(),
  createAdminClient: vi.fn(),
  enforceRateLimit: vi.fn(),
  getFlags: vi.fn(),
}));

// The real withApi and requireAgeVerified: only the session, flags, limiter
// and database are stand-ins.
vi.mock("@/lib/server/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/http")>()),
  authed,
}));
vi.mock("@/lib/flags", () => ({ getFlags }));
vi.mock("@/lib/server/rate-limit", () => ({ enforceRateLimit }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));

import { GET as listCharacters } from "@/app/api/characters/route";
import { GET as getNudge } from "@/app/api/coach/nudge/route";
import { GET as getCoachProfile, PUT as putCoachProfile } from "@/app/api/coach/profile/route";
import { GET as getStory } from "@/app/api/story/route";
import { GET as getChapter } from "@/app/api/story/[number]/route";
import { isAgeVerified, requireAgeVerified } from "@/lib/coach/age";

const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AGE_REQUIRED = { error: { code: "age_requirement", message: "Confirm your age to continue." } };

type Result = { data: unknown; error: { message: string; code?: string } | null };

/** A user client whose coach profile read answers `profile`; any other table read fails the test. */
function givenSession(profile: Result) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(() => Promise.resolve(profile)),
  };
  const supabase = {
    from: vi.fn((table: string) => {
      if (table !== "user_coach_profiles") throw new Error(`unexpected read of ${table}`);
      return chain;
    }),
    rpc: vi.fn(() => { throw new Error("unexpected rpc"); }),
  };
  authed.mockResolvedValue({ user: { id: userId }, supabase });
  return { supabase, chain };
}

const request = (path: string, init: RequestInit = {}) => new Request(`http://localhost${path}`, {
  ...init,
  headers: { authorization: "Bearer token", "content-type": "application/json" },
});

beforeEach(() => {
  vi.clearAllMocks();
  getFlags.mockResolvedValue(resolveFlags({ "pivot_a.enabled": true }));
  enforceRateLimit.mockResolvedValue(undefined);
  createAdminClient.mockImplementation(() => { throw new Error("unexpected admin client"); });
});

describe("requireAgeVerified", () => {
  it("reads only the caller's verification time", async () => {
    const { supabase, chain } = givenSession({ data: { age_verified_at: "2026-10-01T12:00:00.000Z" }, error: null });

    await expect(requireAgeVerified(supabase as never, userId)).resolves.toBeUndefined();
    expect(chain.select).toHaveBeenCalledWith("age_verified_at");
    expect(chain.eq).toHaveBeenCalledWith("user_id", userId);
  });

  it("refuses a missing row or a null verification with 403 age_requirement", async () => {
    for (const data of [null, { age_verified_at: null }]) {
      const { supabase } = givenSession({ data, error: null });
      await expect(isAgeVerified(supabase as never, userId)).resolves.toBe(false);
      await expect(requireAgeVerified(supabase as never, userId)).rejects.toMatchObject({ status: 403, code: "age_requirement" });
    }
  });

  it("does not treat a failed read as verified", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { supabase } = givenSession({ data: null, error: { code: "XX999", message: "boom" } });

    await expect(requireAgeVerified(supabase as never, userId)).rejects.toBeTruthy();
  });
});

describe("Pivot A coach routes for an account whose age is not verified", () => {
  it.each([
    ["GET /api/characters", () => listCharacters(request("/api/characters"))],
    ["GET /api/story", () => getStory(request("/api/story"))],
    ["GET /api/story/1", () => getChapter(request("/api/story/1"), { params: Promise.resolve({ number: "1" }) })],
    ["GET /api/coach/nudge", () => getNudge(request("/api/coach/nudge"))],
    ["PUT /api/coach/profile", () => putCoachProfile(request("/api/coach/profile", { method: "PUT", body: JSON.stringify({ timezone: "America/Chicago" }) }))],
  ])("%s answers 403 age_requirement and does nothing else", async (_name, call) => {
    const { supabase } = givenSession({ data: { age_verified_at: null }, error: null });

    const response = await call();

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(AGE_REQUIRED);
    expect(enforceRateLimit).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("keeps GET /api/coach/profile open, so the client can show the age step", async () => {
    givenSession({ data: { selected_character_id: null, timezone: null, age_verified_at: null }, error: null });

    const response = await getCoachProfile(request("/api/coach/profile"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { selected_character_id: null, timezone: null, age_verified_at: null } });
  });

  it("still answers 404 first while Pivot A is off", async () => {
    getFlags.mockResolvedValue(resolveFlags({}));
    givenSession({ data: { age_verified_at: null }, error: null });

    expect((await getStory(request("/api/story"))).status).toBe(404);
    expect(authed).not.toHaveBeenCalled();
  });
});
