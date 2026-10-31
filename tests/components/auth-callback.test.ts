import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const exchangeCodeForSession = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { exchangeCodeForSession } }),
}));

import { GET } from "@/app/auth/callback/route";
import { safeDestination } from "@/lib/auth/safe-destination";

describe("auth callback", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE = "false";
    exchangeCodeForSession.mockResolvedValue({ error: null });
  });

  it("exchanges the PKCE code and redirects only to a safe relative destination", async () => {
    const response = await GET(new NextRequest("https://idobata.test/auth/callback?code=pkce-code&next=/update-password"));

    expect(exchangeCodeForSession).toHaveBeenCalledWith("pkce-code");
    expect(response.headers.get("location")).toBe("https://idobata.test/update-password");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("rejects protocol-relative and absolute destinations", () => {
    expect(safeDestination("//evil.test/path")).toBe("/home");
    expect(safeDestination("https://evil.test/path")).toBe("/home");
    expect(safeDestination("/\\evil.test/path")).toBe("/home");
    // URL parsing strips tabs and newlines, which would turn these into //evil.test.
    expect(safeDestination("/\t/evil.test/path")).toBe("/home");
    expect(safeDestination("/\n/evil.test/path")).toBe("/home");
    expect(safeDestination("/ /evil.test")).toBe("/home");
    // Dot segments that normalise to a protocol-relative path.
    expect(safeDestination("/..//evil.test/path")).toBe("/home");
    expect(safeDestination("/%2e%2e//evil.test/path")).toBe("/home");
    expect(safeDestination("/tasks/../story")).toBe("/story");
    expect(safeDestination(null)).toBe("/home");
    expect(safeDestination("/tasks?view=today")).toBe("/tasks?view=today");
  });

  it("lands on /home, which picks the page from the flags, when no destination is given", async () => {
    const response = await GET(new NextRequest("https://idobata.test/auth/callback?code=pkce-code"));

    expect(response.headers.get("location")).toBe("https://idobata.test/home");
  });

  it("keeps an explicit next destination", async () => {
    const response = await GET(new NextRequest("https://idobata.test/auth/callback?code=pkce-code&next=/onboarding"));

    expect(response.headers.get("location")).toBe("https://idobata.test/onboarding");
  });

  it("returns to login when the provider callback cannot create a session", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: new Error("invalid code") });

    const response = await GET(new NextRequest("https://idobata.test/auth/callback?code=expired&next=/feed"));

    expect(response.headers.get("location")).toBe("https://idobata.test/login?error=auth_callback");
  });
});
