import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveFlags } from "@/lib/domain/feature-flags";

const { createAdminClient, enforceRateLimit, getFlags } = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  enforceRateLimit: vi.fn(),
  getFlags: vi.fn(),
}));

vi.mock("@/lib/flags", () => ({ getFlags }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
vi.mock("@/lib/server/rate-limit", () => ({ enforceRateLimit }));

import { GET, POST } from "@/app/api/auth/age-check/route";
import { ApiError } from "@/lib/server/http";

// 12:00 UTC: the start of 31 October in UTC-12, the earliest zone, which decides "today".
const NOW = new Date("2026-10-31T12:00:00.000Z");
const ADULT = "1990-05-17";
const MINOR = "2010-01-01";

function useDatabase(result: { data: unknown; error: { message: string; code?: string } | null } = { data: null, error: null }) {
  const insert = vi.fn((row: unknown) => {
    void row;
    return Promise.resolve(result);
  });
  const from = vi.fn(() => ({ insert }));
  createAdminClient.mockReturnValue({ from });
  return { from, insert };
}

const post = (body: unknown, headers: Record<string, string> = {}) => new Request("https://idobata.test/api/auth/age-check", {
  method: "POST",
  headers: { "content-type": "application/json", "x-vercel-forwarded-for": "203.0.113.7", ...headers },
  body: typeof body === "string" ? body : JSON.stringify(body),
});
const get = (headers: Record<string, string> = { "x-vercel-forwarded-for": "203.0.113.7" }) => new Request("https://idobata.test/api/auth/age-check", { headers });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  vi.stubEnv("AGE_VERIFIER", "");
  vi.stubEnv("ALLOW_SELF_ATTESTED_AGE", "true");
  vi.stubEnv("APP_ENV", "test");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("APP_URL", "");
  getFlags.mockResolvedValue(resolveFlags({ "pivot_a.enabled": true }));
  enforceRateLimit.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("POST /api/auth/age-check", () => {
  it("issues a single-use token to an adult and stores only its hash, method and expiry", async () => {
    const { from, insert } = useDatabase();

    const response = await POST(post({ dateOfBirth: ADULT, timeZone: "America/Chicago" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const { data } = await response.json();
    expect(data.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(data.expiresAt).toBe("2026-10-31T12:15:00.000Z");

    expect(from).toHaveBeenCalledWith("age_verification_tokens");
    expect(insert).toHaveBeenCalledTimes(1);
    const row = insert.mock.calls[0][0] as Record<string, unknown>;
    expect(row).toEqual({
      token_hash: createHash("sha256").update(data.token, "utf8").digest("hex"),
      method: "self_attested",
      verified_at: NOW.toISOString(),
      expires_at: "2026-10-31T12:15:00.000Z",
    });
    // Neither the token nor the date of birth is stored.
    expect(JSON.stringify(row)).not.toContain(data.token);
    expect(JSON.stringify(row)).not.toContain(ADULT);
  });

  it("answers 403 age_requirement to an under-18 and stores nothing", async () => {
    const { insert } = useDatabase();

    const response = await POST(post({ dateOfBirth: MINOR }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "age_requirement", message: "You need to be 18 or older to use idobata." } });
    expect(insert).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("decides an 18th birthday in the earliest time zone, whatever zone the client sends", async () => {
    useDatabase();
    // 1 November has begun in Kiritimati (UTC+14) but not in UTC-12.
    expect((await POST(post({ dateOfBirth: "2008-11-01", timeZone: "Pacific/Kiritimati" }))).status).toBe(403);
    expect((await POST(post({ dateOfBirth: "2008-11-01" }))).status).toBe(403);
    // 31 October has begun everywhere.
    expect((await POST(post({ dateOfBirth: "2008-10-31", timeZone: "Pacific/Pago_Pago" }))).status).toBe(200);
  });

  it.each([
    ["a future date", { dateOfBirth: "2027-01-01" }],
    ["an impossible date", { dateOfBirth: "2001-02-29" }],
    ["an implausible age", { dateOfBirth: "1890-01-01" }],
  ])("answers 422 invalid_date_of_birth for %s and stores nothing", async (_name, body) => {
    const { insert } = useDatabase();

    const response = await POST(post(body));

    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("invalid_date_of_birth");
    expect(insert).not.toHaveBeenCalled();
  });

  it.each([
    ["a malformed date", { dateOfBirth: "17/05/1990" }],
    ["a missing date", {}],
    ["an unknown field", { dateOfBirth: ADULT, email: "adult@example.com" }],
  ])("answers 422 validation_error for %s", async (_name, body) => {
    const { insert } = useDatabase();

    const response = await POST(post(body));

    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("validation_error");
    expect(insert).not.toHaveBeenCalled();
  });

  it.each([
    ["self-attestation in production (APP_ENV)", { APP_ENV: "production" }],
    ["self-attestation under a mistyped APP_ENV", { APP_ENV: "prod" }],
    ["self-attestation on Vercel production", { APP_ENV: "", VERCEL_ENV: "production" }],
    ["self-attestation on another production host", { APP_ENV: "", VERCEL_ENV: "", NODE_ENV: "production" }],
    ["self-attestation without ALLOW_SELF_ATTESTED_AGE", { ALLOW_SELF_ATTESTED_AGE: "" }],
    ["an unknown verifier", { AGE_VERIFIER: "unknown_provider" }],
  ])("answers 503 for %s, without logging the date of birth", async (_name, env) => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    const { insert } = useDatabase();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(post({ dateOfBirth: ADULT }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "age_verification_unavailable", message: "Age verification is not available right now. Please try again later." } });
    expect(insert).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain(ADULT);
  });

  it("is a 404 while Pivot A is off, before anything else runs", async () => {
    getFlags.mockResolvedValue(resolveFlags({}));
    const { insert } = useDatabase();

    const response = await POST(post({ dateOfBirth: ADULT }));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "not_found", message: "Resource not found." } });
    expect(enforceRateLimit).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("is rate limited per client address before the body is read", async () => {
    const { insert } = useDatabase();
    enforceRateLimit.mockRejectedValue(new ApiError(429, "You are doing that a little too quickly. Try again shortly.", "rate_limited"));

    const response = await POST(post({ dateOfBirth: ADULT }, { "x-vercel-forwarded-for": "198.51.100.23" }));

    expect(response.status).toBe(429);
    expect(enforceRateLimit).toHaveBeenCalledWith("ip:198.51.100.23", "auth:age-check", 10, 900);
    expect(insert).not.toHaveBeenCalled();
  });

  it("keys an IPv6 client by its /64", async () => {
    useDatabase();

    await POST(post({ dateOfBirth: ADULT }, { "x-vercel-forwarded-for": "2001:db8:1:2:3:4:5:6" }));

    expect(enforceRateLimit).toHaveBeenCalledWith("ip6:2001:db8:1:2::/64", "auth:age-check", 10, 900);
  });

  it("uses one coarse shared limit, not a per-address bucket, when no address can be trusted", async () => {
    vi.stubEnv("VERCEL", "");
    useDatabase();

    const response = await POST(post({ dateOfBirth: ADULT }, { "x-real-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" }));

    expect(response.status).toBe(200);
    expect(enforceRateLimit).toHaveBeenCalledTimes(1);
    expect(enforceRateLimit).toHaveBeenCalledWith("unknown-client", "auth:age-check:unknown-client", 300, 900);
  });

  it("answers 415 to a body that is not declared as JSON", async () => {
    const { insert } = useDatabase();

    const response = await POST(post(`dateOfBirth=${ADULT}`, { "content-type": "application/x-www-form-urlencoded" }));

    expect(response.status).toBe(415);
    expect((await response.json()).error.code).toBe("unsupported_media_type");
    expect(insert).not.toHaveBeenCalled();
  });

  it.each([
    [{ "sec-fetch-site": "cross-site" }],
    [{ origin: "https://evil.test" }],
  ])("answers 403 to a cross-site browser request (%j)", async (headers) => {
    const { insert } = useDatabase();

    const response = await POST(post({ dateOfBirth: ADULT }, headers));

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("cross_site_request");
    expect(insert).not.toHaveBeenCalled();
    expect(enforceRateLimit).not.toHaveBeenCalled();
  });

  it("accepts a same-origin browser request", async () => {
    useDatabase();

    const response = await POST(post({ dateOfBirth: ADULT }, { "sec-fetch-site": "same-origin", origin: "https://idobata.test" }));

    expect(response.status).toBe(200);
  });

  it("fails without a token when the hash cannot be stored", async () => {
    useDatabase({ data: null, error: { message: "connection refused", code: "08006" } });

    const response = await POST(post({ dateOfBirth: ADULT }));

    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("token\":");
  });
});

describe("GET /api/auth/age-check", () => {
  it("says the age check is required while Pivot A is on", async () => {
    const response = await GET(get());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ data: { required: true } });
    expect(enforceRateLimit).toHaveBeenCalledWith("ip:203.0.113.7", "auth:age-requirement", 60, 60);
  });

  it("says it is not required while Pivot A is off, rather than answering 404", async () => {
    getFlags.mockResolvedValue(resolveFlags({}));

    expect(await (await GET(get())).json()).toEqual({ data: { required: false } });
  });

  it("is not limited by a shared bucket when no address can be trusted", async () => {
    vi.stubEnv("VERCEL", "");

    expect((await GET(get({}))).status).toBe(200);
    expect(enforceRateLimit).not.toHaveBeenCalled();
  });
});
