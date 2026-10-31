import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveFlags } from "@/lib/domain/feature-flags";

const { authed, createAdminClient, enforceRateLimit, getFlags } = vi.hoisted(() => ({
  authed: vi.fn(),
  createAdminClient: vi.fn(),
  enforceRateLimit: vi.fn(),
  getFlags: vi.fn(),
}));

// The real withApi and parseJson, so validation errors answer as in production.
vi.mock("@/lib/server/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/http")>()),
  authed,
}));
vi.mock("@/lib/flags", () => ({ getFlags }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
vi.mock("@/lib/server/rate-limit", () => ({ enforceRateLimit }));

import { POST } from "@/app/api/coach/age/route";

const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const verifiedRow = {
  user_id: userId,
  selected_character_id: null,
  timezone: "America/Chicago",
  age_verified_at: "2026-10-31T12:00:00.000Z",
  age_verification_method: "self_attested",
  ai_arm: "ai",
  created_at: "2026-10-01T12:00:00.000Z",
  updated_at: "2026-10-31T12:00:00.000Z",
};

function useAdmin(result: { data: unknown; error: { message: string; code?: string } | null } = { data: verifiedRow, error: null }) {
  const rpc = vi.fn((name: string, args: unknown) => {
    void name;
    void args;
    return Promise.resolve(result);
  });
  createAdminClient.mockReturnValue({ rpc });
  return rpc;
}

const post = (body: unknown) => new Request("http://localhost/api/coach/age", {
  method: "POST",
  headers: { authorization: "Bearer token", "content-type": "application/json" },
  body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ now: new Date("2026-10-31T12:00:00.000Z"), toFake: ["Date"] });
  vi.stubEnv("AGE_VERIFIER", "");
  vi.stubEnv("ALLOW_SELF_ATTESTED_AGE", "true");
  vi.stubEnv("APP_ENV", "test");
  vi.stubEnv("VERCEL_ENV", "");
  getFlags.mockResolvedValue(resolveFlags({ "pivot_a.enabled": true }));
  enforceRateLimit.mockResolvedValue(undefined);
  authed.mockResolvedValue({ user: { id: userId }, supabase: { rpc: vi.fn(), from: vi.fn() } });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("POST /api/coach/age", () => {
  it("records the verification for the signed-in user through the service-role function", async () => {
    const rpc = useAdmin();

    const response = await POST(post({ dateOfBirth: "1990-05-17", timeZone: "America/Chicago" }));

    expect(response.status).toBe(200);
    // The experiment arm and method stay server-side.
    expect(await response.json()).toEqual({ data: { selected_character_id: null, timezone: "America/Chicago", age_verified_at: "2026-10-31T12:00:00.000Z" } });
    expect(rpc).toHaveBeenCalledWith("set_coach_age_verified", { p_user_id: userId, p_method: "self_attested" });
    expect(enforceRateLimit).toHaveBeenCalledWith(userId, "coach:age", 10, 3600);
  });

  it("answers 403 age_requirement to an under-18 and stores nothing", async () => {
    const rpc = useAdmin();

    const response = await POST(post({ dateOfBirth: "2012-03-04" }));

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("age_requirement");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("answers 422 for a date in the future and stores nothing", async () => {
    const rpc = useAdmin();

    const response = await POST(post({ dateOfBirth: "2030-01-01" }));

    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("invalid_date_of_birth");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("answers 503 when self-attestation is configured in production", async () => {
    vi.stubEnv("APP_ENV", "production");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rpc = useAdmin();

    const response = await POST(post({ dateOfBirth: "1990-05-17" }));

    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("age_verification_unavailable");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("needs a session", async () => {
    const { AuthenticationError } = await import("@/lib/supabase/bearer");
    authed.mockRejectedValue(new AuthenticationError("Please log in to continue."));
    const rpc = useAdmin();

    const response = await POST(post({ dateOfBirth: "1990-05-17" }));

    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("is a 404 while Pivot A is off", async () => {
    getFlags.mockResolvedValue(resolveFlags({}));
    const rpc = useAdmin();

    const response = await POST(post({ dateOfBirth: "1990-05-17" }));

    expect(response.status).toBe(404);
    expect(authed).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
