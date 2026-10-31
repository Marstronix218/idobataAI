import { describe, expect, it } from "vitest";
import { clientRateKey } from "@/lib/server/client-ip";
import { assertJsonContentType, assertNotCrossSite } from "@/lib/server/request-guards";

const request = (headers: Record<string, string>, url = "https://idobata.test/api/auth/age-check") => new Request(url, { method: "POST", headers });
const VERCEL = { VERCEL: "1" };

describe("clientRateKey on Vercel", () => {
  it("prefers x-vercel-forwarded-for, then x-forwarded-for, then x-real-ip", () => {
    expect(clientRateKey(request({ "x-vercel-forwarded-for": "203.0.113.8, 10.0.0.1", "x-forwarded-for": "198.51.100.1", "x-real-ip": "198.51.100.2" }), VERCEL)).toBe("ip:203.0.113.8");
    expect(clientRateKey(request({ "x-forwarded-for": " 198.51.100.1 , 10.0.0.1", "x-real-ip": "198.51.100.2" }), VERCEL)).toBe("ip:198.51.100.1");
    expect(clientRateKey(request({ "x-real-ip": "198.51.100.2" }), VERCEL)).toBe("ip:198.51.100.2");
  });

  it("skips a value that is not an address, so a header cannot inject a key", () => {
    expect(clientRateKey(request({ "x-vercel-forwarded-for": "user:aaaa", "x-forwarded-for": "198.51.100.1" }), VERCEL)).toBe("ip:198.51.100.1");
    expect(clientRateKey(request({ "x-vercel-forwarded-for": "garbage" }), VERCEL)).toBeNull();
  });
});

describe("clientRateKey elsewhere", () => {
  it("trusts no header by default, not even x-real-ip", () => {
    expect(clientRateKey(request({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1", "x-vercel-forwarded-for": "198.51.100.3" }), {})).toBeNull();
    expect(clientRateKey(request({}), {})).toBeNull();
  });

  it("trusts only the header named by CLIENT_IP_HEADER, first entry", () => {
    const env = { CLIENT_IP_HEADER: "X-Real-IP" };
    expect(clientRateKey(request({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" }), env)).toBe("ip:203.0.113.7");
    expect(clientRateKey(request({ "x-forwarded-for": "198.51.100.1" }), env)).toBeNull();
    expect(clientRateKey(request({ "cf-connecting-ip": "203.0.113.9, 10.0.0.1" }), { CLIENT_IP_HEADER: "cf-connecting-ip" })).toBe("ip:203.0.113.9");
  });
});

describe("clientRateKey for IPv6", () => {
  it("keys an IPv6 client by its /64", () => {
    expect(clientRateKey(request({ "x-vercel-forwarded-for": "2001:DB8:85a3:0042:1000:8a2e:0370:7334" }), VERCEL)).toBe("ip6:2001:db8:85a3:42::/64");
    expect(clientRateKey(request({ "x-vercel-forwarded-for": "2001:db8:85a3:42:ffff::1" }), VERCEL)).toBe("ip6:2001:db8:85a3:42::/64");
    expect(clientRateKey(request({ "x-vercel-forwarded-for": "2001:db8::1" }), VERCEL)).toBe("ip6:2001:db8:0:0::/64");
    expect(clientRateKey(request({ "x-vercel-forwarded-for": "::1" }), VERCEL)).toBe("ip6:0:0:0:0::/64");
  });

  it("keys an IPv4-mapped address as IPv4", () => {
    expect(clientRateKey(request({ "x-vercel-forwarded-for": "::ffff:203.0.113.7" }), VERCEL)).toBe("ip:203.0.113.7");
  });

  it("ignores an address with a zone id", () => {
    expect(clientRateKey(request({ "x-vercel-forwarded-for": "fe80::1%eth0" }), VERCEL)).toBeNull();
  });
});

describe("assertJsonContentType", () => {
  it("accepts JSON with or without parameters", () => {
    expect(() => assertJsonContentType(request({ "content-type": "application/json" }))).not.toThrow();
    expect(() => assertJsonContentType(request({ "content-type": "Application/JSON; charset=utf-8" }))).not.toThrow();
  });

  it.each([["text/plain"], ["application/x-www-form-urlencoded"], ["multipart/form-data; boundary=x"], [""]])("refuses %j with 415", (type) => {
    expect(() => assertJsonContentType(request(type ? { "content-type": type } : {}))).toThrow(expect.objectContaining({ status: 415, code: "unsupported_media_type" }));
  });
});

describe("assertNotCrossSite", () => {
  it("lets same-origin browser requests and requests without browser headers through", () => {
    expect(() => assertNotCrossSite(request({ "sec-fetch-site": "same-origin", origin: "https://idobata.test" }), undefined)).not.toThrow();
    expect(() => assertNotCrossSite(request({ "sec-fetch-site": "none" }), undefined)).not.toThrow();
    expect(() => assertNotCrossSite(request({}), undefined)).not.toThrow();
    // The configured public origin, behind a proxy that rewrites the host.
    expect(() => assertNotCrossSite(request({ origin: "https://idobata-ai.com" }, "http://internal:3000/api/auth/age-check"), "https://idobata-ai.com")).not.toThrow();
  });

  it.each([
    [{ "sec-fetch-site": "cross-site" }],
    [{ "sec-fetch-site": "Cross-Site", origin: "https://idobata.test" }],
    [{ origin: "https://evil.test" }],
    [{ origin: "null" }],
    [{ origin: "http://idobata.test" }],
  ])("refuses %j with 403", (headers) => {
    expect(() => assertNotCrossSite(request(headers), "https://idobata.test")).toThrow(expect.objectContaining({ status: 403, code: "cross_site_request" }));
  });
});
