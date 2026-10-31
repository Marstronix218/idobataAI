import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getClaims: async () => ({ data: { claims: null } }) },
  }),
}));

import { proxy } from "@/proxy";

describe("auth proxy", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE = "false";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  });

  it("protects the password update page", async () => {
    const response = await proxy(new NextRequest("https://idobata.test/update-password"));

    expect(response.headers.get("location")).toBe("https://idobata.test/login?next=%2Fupdate-password");
  });

  it.each([
    ["/home", "%2Fhome"],
    ["/characters/sample-coach", "%2Fcharacters%2Fsample-coach"],
  ])("protects the Pivot A route %s", async (path, next) => {
    const response = await proxy(new NextRequest(`https://idobata.test${path}`));

    expect(response.headers.get("location")).toBe(`https://idobata.test/login?next=${next}`);
  });

  it("forwards the pathname to the app, overwriting any value the client sent", async () => {
    const response = await proxy(new NextRequest("https://idobata.test/privacy", { headers: { "x-idobata-pathname": "/settings" } }));

    expect(response.headers.get("x-middleware-request-x-idobata-pathname")).toBe("/privacy");
  });

  it("protects AI persona pages at their canonical route", async () => {
    const response = await proxy(new NextRequest("https://idobata.test/ai-personas/moss?tab=about"));

    expect(response.headers.get("location")).toBe("https://idobata.test/login?next=%2Fai-personas%2Fmoss%3Ftab%3Dabout");
  });
});
