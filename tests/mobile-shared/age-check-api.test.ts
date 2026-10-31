import { describe, expect, it, vi } from "vitest";

import { ApiClientError, createApiClient } from "../../packages/api-client/src";
import { AGE_CHECK_ERROR_CODES, ageCheckInputSchema } from "../../packages/contracts/src";
import { checkSignUpAge, fetchAgeRequirement, isDateOfBirthFormat } from "../../apps/mobile/src/lib/auth/age-gate";
import { friendlyAuthError } from "../../apps/mobile/src/lib/auth/errors";

const ok = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200, headers: { "Content-Type": "application/json" } });
const failure = (status: number, code: string, message: string) =>
  new Response(JSON.stringify({ error: { code, message } }), { status, headers: { "Content-Type": "application/json" } });

function signedOutClient(response: Response) {
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    void input;
    void init;
    return response;
  });
  const getAccessToken = vi.fn(() => null);
  const onUnauthorized = vi.fn();
  const refreshAccessToken = vi.fn(() => "refreshed");
  return {
    fetch,
    getAccessToken,
    onUnauthorized,
    refreshAccessToken,
    client: createApiClient({ baseUrl: "https://example.com/", getAccessToken, onUnauthorized, refreshAccessToken, fetch }),
  };
}

describe("age check contract", () => {
  it("takes a YYYY-MM-DD date and an optional zone, and nothing else", () => {
    expect(ageCheckInputSchema.parse({ dateOfBirth: "1990-05-17", timeZone: " America/Chicago " })).toEqual({ dateOfBirth: "1990-05-17", timeZone: "America/Chicago" });
    expect(ageCheckInputSchema.safeParse({ dateOfBirth: "05/17/1990" }).success).toBe(false);
    expect(ageCheckInputSchema.safeParse({ dateOfBirth: "1990-05-17", email: "a@example.com" }).success).toBe(false);
    expect(ageCheckInputSchema.safeParse({}).success).toBe(false);
  });
});

describe("api client checkAge", () => {
  it("posts the date of birth without a session and returns the token", async () => {
    const { client, fetch, getAccessToken } = signedOutClient(ok({ token: "age-token-abcdefghijklmnop", expiresAt: "2026-10-31T12:15:00.000Z" }));

    await expect(client.checkAge({ dateOfBirth: "1990-05-17", timeZone: "America/Chicago" }))
      .resolves.toEqual({ token: "age-token-abcdefghijklmnop", expiresAt: "2026-10-31T12:15:00.000Z" });

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("https://example.com/api/auth/age-check");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ dateOfBirth: "1990-05-17", timeZone: "America/Chicago" });
    expect(new Headers(init?.headers).has("Authorization")).toBe(false);
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it("surfaces the route's errors without touching the session", async () => {
    const blocked = signedOutClient(failure(403, "age_requirement", "You need to be 18 or older to use idobata."));
    await expect(blocked.client.checkAge({ dateOfBirth: "2012-01-01" })).rejects.toMatchObject({ status: 403, code: AGE_CHECK_ERROR_CODES.ageRequirement });

    const unauthorized = signedOutClient(failure(401, "unauthorized", "No."));
    await expect(unauthorized.client.checkAge({ dateOfBirth: "1990-05-17" })).rejects.toBeInstanceOf(ApiClientError);
    expect(unauthorized.onUnauthorized).not.toHaveBeenCalled();
    expect(unauthorized.refreshAccessToken).not.toHaveBeenCalled();
  });

  it("rejects a response without a usable token", async () => {
    const { client } = signedOutClient(ok({ token: "short", expiresAt: "2026-10-31T12:15:00.000Z" }));

    await expect(client.checkAge({ dateOfBirth: "1990-05-17" })).rejects.toMatchObject({ code: "invalid_response" });
  });
});

describe("api client getAgeRequirement", () => {
  it("asks without a session whether sign-up needs the age check", async () => {
    const { client, fetch, getAccessToken } = signedOutClient(ok({ required: true }));

    await expect(client.getAgeRequirement()).resolves.toEqual({ required: true });

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("https://example.com/api/auth/age-check");
    expect(init?.method).toBe("GET");
    expect(new Headers(init?.headers).has("Authorization")).toBe(false);
    expect(getAccessToken).not.toHaveBeenCalled();
  });
});

describe("api client verifyCoachAge", () => {
  it("posts to the coach age route with the session and returns the profile", async () => {
    const profile = { selected_character_id: null, timezone: "America/Chicago", age_verified_at: "2026-10-31T12:00:00.000Z" };
    const fetch = vi.fn(async (input: string, init?: RequestInit) => {
      void input;
      void init;
      return ok(profile);
    });
    const client = createApiClient({ baseUrl: "https://example.com", getAccessToken: () => "session-token", fetch });

    await expect(client.verifyCoachAge({ dateOfBirth: "1990-05-17" })).resolves.toEqual(profile);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("https://example.com/api/coach/age");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer session-token");
  });
});

describe("mobile sign-up age check", () => {
  const clientFailing = (error: unknown) => ({ checkAge: vi.fn(() => Promise.reject(error)) });

  it("returns the token to sign up with", async () => {
    const client = { checkAge: vi.fn(() => Promise.resolve({ token: "age-token-abcdefghijklmnop", expiresAt: "2026-10-31T12:15:00.000Z" })) };

    await expect(checkSignUpAge(client, " 1990-05-17 ", "America/Chicago")).resolves.toEqual({ kind: "token", token: "age-token-abcdefghijklmnop" });
    expect(client.checkAge).toHaveBeenCalledWith({ dateOfBirth: "1990-05-17", timeZone: "America/Chicago" });
  });

  it("leaves out an unknown time zone", async () => {
    const client = { checkAge: vi.fn(() => Promise.resolve({ token: "age-token-abcdefghijklmnop", expiresAt: "x" })) };

    await checkSignUpAge(client, "1990-05-17");
    expect(client.checkAge).toHaveBeenCalledWith({ dateOfBirth: "1990-05-17" });
  });

  it.each([
    ["Pivot A is off (404)", new ApiClientError("Resource not found.", 404, "not_found")],
    ["the device is offline", new ApiClientError("You appear to be offline.", 0, "network_error")],
    ["the check timed out", new ApiClientError("That took longer than expected.", 408, "timeout")],
    ["verification is unavailable (503)", new ApiClientError("Age verification is not available right now.", 503, "age_verification_unavailable")],
    ["the server failed (500)", new ApiClientError("Unexpected server error.", 500, "internal_error")],
    ["the client could not be built", new TypeError("baseUrl is required.")],
  ])("falls back to the legacy sign-up when %s; the server still enforces the gate", async (_name, error) => {
    await expect(checkSignUpAge(clientFailing(error), "1990-05-17")).resolves.toEqual({ kind: "legacy" });
  });

  it("blocks an under-18 (403 age_requirement)", async () => {
    await expect(checkSignUpAge(clientFailing(new ApiClientError("Under 18.", 403, "age_requirement")), "2012-01-01"))
      .resolves.toEqual({ kind: "blocked" });
  });

  it.each([
    [new ApiClientError("Enter your real date of birth.", 422, "invalid_date_of_birth"), "Enter your real date of birth as YYYY-MM-DD."],
    [new ApiClientError("Too quick.", 429, "rate_limited"), "Too quick."],
    [new ApiClientError("Forbidden.", 403, "cross_site_request"), "Forbidden."],
  ])("reports %s as an error, never as a pass", async (error, message) => {
    await expect(checkSignUpAge(clientFailing(error), "1990-05-17")).resolves.toEqual({ kind: "error", message });
  });

  it("tells whether a date of birth is needed, or null when it cannot tell", async () => {
    await expect(fetchAgeRequirement({ getAgeRequirement: vi.fn(() => Promise.resolve({ required: true })) })).resolves.toBe(true);
    await expect(fetchAgeRequirement({ getAgeRequirement: vi.fn(() => Promise.resolve({ required: false })) })).resolves.toBe(false);
    await expect(fetchAgeRequirement({ getAgeRequirement: vi.fn(() => Promise.reject(new ApiClientError("offline", 0, "network_error"))) })).resolves.toBeNull();
  });

  it("explains a sign-up the server refused for want of an age check", () => {
    expect(friendlyAuthError("age verification required")).toBe("Confirm your date of birth to create an account.");
  });

  it("checks the date format before calling the server", () => {
    expect(isDateOfBirthFormat("1990-05-17")).toBe(true);
    expect(isDateOfBirthFormat(" 1990-05-17 ")).toBe(true);
    expect(isDateOfBirthFormat("17/05/1990")).toBe(false);
    expect(isDateOfBirthFormat("")).toBe(false);
  });
});
