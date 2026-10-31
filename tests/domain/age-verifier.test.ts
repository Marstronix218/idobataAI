import { describe, expect, it } from "vitest";
import { isProductionEnvironment, isSelfAttestedAgeAllowed } from "@/lib/age/environment";
import { AgeVerifierConfigurationError, SelfAttestedVerifier, getAgeVerifier } from "@/lib/age/verifier";
import { createAgeToken, hashAgeToken, AGE_TOKEN_TTL_MS } from "@/lib/age/tokens";

describe("isProductionEnvironment", () => {
  it.each([
    // APP_ENV decides when set: only the known non-production names are non-production.
    [{ APP_ENV: "development" }, false],
    [{ APP_ENV: "dev" }, false],
    [{ APP_ENV: "local" }, false],
    [{ APP_ENV: "test" }, false],
    [{ APP_ENV: "staging" }, false],
    [{ APP_ENV: "preview" }, false],
    [{ APP_ENV: " Staging " }, false],
    [{ APP_ENV: "staging", VERCEL_ENV: "production", NODE_ENV: "production" }, false],
    [{ APP_ENV: "preview", VERCEL_ENV: "production" }, false],
    // On Vercel production only staging and preview are non-production.
    [{ APP_ENV: "local", VERCEL_ENV: "production" }, true],
    [{ APP_ENV: "dev", VERCEL_ENV: "production" }, true],
    [{ APP_ENV: "development", VERCEL_ENV: "production" }, true],
    [{ APP_ENV: "test", VERCEL_ENV: "production" }, true],
    [{ APP_ENV: "local", VERCEL_ENV: "preview" }, false],
    [{ APP_ENV: "production" }, true],
    [{ APP_ENV: "Production" }, true],
    [{ APP_ENV: "prod" }, true],
    [{ APP_ENV: "live" }, true],
    [{ APP_ENV: "stagign" }, true], // a typo fails closed
    [{ APP_ENV: "production", VERCEL_ENV: "preview" }, true],
    // APP_ENV unset, on Vercel: VERCEL_ENV decides (previews run NODE_ENV=production too).
    [{ VERCEL_ENV: "production" }, true],
    [{ APP_ENV: "", VERCEL_ENV: "production" }, true],
    [{ VERCEL_ENV: "preview", NODE_ENV: "production" }, false],
    [{ VERCEL_ENV: "development" }, false],
    // Neither set: another host, where NODE_ENV=production means production.
    [{ NODE_ENV: "production" }, true],
    [{ NODE_ENV: "development" }, false],
    [{ NODE_ENV: "test" }, false],
    [{}, false],
  ] satisfies Array<[Record<string, string>, boolean]>)("%j -> %s", (env, expected) => {
    expect(isProductionEnvironment(env)).toBe(expected);
  });
});

describe("isSelfAttestedAgeAllowed", () => {
  it("needs ALLOW_SELF_ATTESTED_AGE=true and a non-production deployment", () => {
    expect(isSelfAttestedAgeAllowed({ ALLOW_SELF_ATTESTED_AGE: "true", APP_ENV: "staging" })).toBe(true);
    expect(isSelfAttestedAgeAllowed({ ALLOW_SELF_ATTESTED_AGE: "true", NODE_ENV: "development" })).toBe(true);
    expect(isSelfAttestedAgeAllowed({ APP_ENV: "staging" })).toBe(false);
    expect(isSelfAttestedAgeAllowed({ ALLOW_SELF_ATTESTED_AGE: "1", APP_ENV: "staging" })).toBe(false);
    expect(isSelfAttestedAgeAllowed({ ALLOW_SELF_ATTESTED_AGE: "TRUE", APP_ENV: "staging" })).toBe(false);
    expect(isSelfAttestedAgeAllowed({ ALLOW_SELF_ATTESTED_AGE: "true", APP_ENV: "production" })).toBe(false);
    expect(isSelfAttestedAgeAllowed({ ALLOW_SELF_ATTESTED_AGE: "true", APP_ENV: "prod" })).toBe(false);
    expect(isSelfAttestedAgeAllowed({ ALLOW_SELF_ATTESTED_AGE: "true", VERCEL_ENV: "production" })).toBe(false);
    // A non-Vercel production host with APP_ENV unset.
    expect(isSelfAttestedAgeAllowed({ ALLOW_SELF_ATTESTED_AGE: "true", NODE_ENV: "production" })).toBe(false);
    // A local .env copied to a Vercel production deployment.
    expect(isSelfAttestedAgeAllowed({ ALLOW_SELF_ATTESTED_AGE: "true", APP_ENV: "local", VERCEL_ENV: "production" })).toBe(false);
    expect(isSelfAttestedAgeAllowed({ ALLOW_SELF_ATTESTED_AGE: "true", APP_ENV: "staging", VERCEL_ENV: "production" })).toBe(true);
  });
});

describe("getAgeVerifier", () => {
  const allowed = { ALLOW_SELF_ATTESTED_AGE: "true" };

  it("returns the self-attested verifier when explicitly allowed outside production", () => {
    for (const env of [allowed, { ...allowed, AGE_VERIFIER: "self_attested" }, { ...allowed, AGE_VERIFIER: "  " }, { ...allowed, VERCEL_ENV: "preview", NODE_ENV: "production" }, { ...allowed, APP_ENV: "staging" }]) {
      const verifier = getAgeVerifier(env);
      expect(verifier).toBeInstanceOf(SelfAttestedVerifier);
      expect(verifier.method).toBe("self_attested");
    }
  });

  it("refuses it without ALLOW_SELF_ATTESTED_AGE=true, even in development", () => {
    expect(() => getAgeVerifier({ NODE_ENV: "development" })).toThrow(/ALLOW_SELF_ATTESTED_AGE=true/);
    expect(() => getAgeVerifier({ APP_ENV: "staging", ALLOW_SELF_ATTESTED_AGE: "yes" })).toThrow(AgeVerifierConfigurationError);
  });

  it.each([
    [{ APP_ENV: "production" }],
    [{ APP_ENV: "Production" }],
    [{ APP_ENV: "prod" }],
    [{ APP_ENV: "live" }],
    [{ VERCEL_ENV: "production" }],
    [{ NODE_ENV: "production" }],
  ])("refuses it in production (%j), whatever ALLOW_SELF_ATTESTED_AGE says", (env) => {
    expect(() => getAgeVerifier({ ...allowed, ...env })).toThrow(/not allowed in production/);
  });

  it("throws for an unknown verifier name, in every environment", () => {
    expect(() => getAgeVerifier({ ...allowed, AGE_VERIFIER: "yoti" })).toThrow(AgeVerifierConfigurationError);
    expect(() => getAgeVerifier({ AGE_VERIFIER: "yoti", APP_ENV: "production" })).toThrow(/Unknown AGE_VERIFIER/);
  });
});

describe("SelfAttestedVerifier", () => {
  // 2026-10-31T12:00Z is already 31 October in UTC-12 (00:00), and 1 November in Kiritimati (UTC+14).
  const noon = new SelfAttestedVerifier(() => new Date("2026-10-31T12:00:00Z"));
  // 2026-10-31T02:30Z is 31 October in UTC and Tokyo, but still 30 October in UTC-12.
  const early = new SelfAttestedVerifier(() => new Date("2026-10-31T02:30:00Z"));

  it("passes an adult and records its method", async () => {
    await expect(noon.verify({ dateOfBirth: "1990-05-17" })).resolves.toEqual({ ok: true, method: "self_attested" });
  });

  it("passes on the 18th birthday and refuses the day before", async () => {
    await expect(noon.verify({ dateOfBirth: "2008-10-31" })).resolves.toEqual({ ok: true, method: "self_attested" });
    await expect(noon.verify({ dateOfBirth: "2008-11-01" })).resolves.toEqual({ ok: false, reason: "under_18" });
  });

  it("waits until the 18th birthday has arrived everywhere (UTC-12), ignoring the claimed zone", async () => {
    for (const timeZone of [undefined, "UTC", "Asia/Tokyo", "Pacific/Kiritimati", "Etc/GMT-14", "Not/AZone"]) {
      await expect(early.verify({ dateOfBirth: "2008-10-31", timeZone })).resolves.toEqual({ ok: false, reason: "under_18" });
    }
    // In Kiritimati it is already 1 November, but not yet anywhere else.
    await expect(noon.verify({ dateOfBirth: "2008-11-01", timeZone: "Pacific/Kiritimati" })).resolves.toEqual({ ok: false, reason: "under_18" });
  });

  it.each(["2026-11-01", "1900-01-01", "2007-02-29", "17/05/1990", ""])("treats %j as invalid", async (dateOfBirth) => {
    await expect(noon.verify({ dateOfBirth })).resolves.toEqual({ ok: false, reason: "invalid" });
  });
});

describe("age tokens", () => {
  it("are 32 random bytes in base64url, stored only as a sha256 hex hash, for 15 minutes", () => {
    const now = new Date("2026-10-31T12:00:00Z");
    const first = createAgeToken(now);
    const second = createAgeToken(now);

    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(first.token, "base64url")).toHaveLength(32);
    expect(first.token).not.toBe(second.token);
    expect(first.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.tokenHash).toBe(hashAgeToken(first.token));
    expect(first.tokenHash).not.toContain(first.token);
    expect(first.expiresAt.getTime() - now.getTime()).toBe(AGE_TOKEN_TTL_MS);
    expect(AGE_TOKEN_TTL_MS).toBe(15 * 60_000);
  });

  // The same digest the database computes: encode(sha256(convert_to(token, 'UTF8')), 'hex').
  it("hashes like Postgres", () => {
    expect(hashAgeToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
