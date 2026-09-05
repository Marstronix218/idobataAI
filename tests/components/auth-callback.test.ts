import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const exchangeCodeForSession = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { exchangeCodeForSession } }),
}));

import { GET, safeDestination } from "@/app/auth/callback/route";

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
    expect(safeDestination("//evil.test/path")).toBe("/feed");
    expect(safeDestination("https://evil.test/path")).toBe("/feed");
    expect(safeDestination("/\\evil.test/path")).toBe("/feed");
  });

  it("returns to login when the provider callback cannot create a session", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: new Error("invalid code") });

    const response = await GET(new NextRequest("https://idobata.test/auth/callback?code=expired&next=/feed"));

    expect(response.headers.get("location")).toBe("https://idobata.test/login?error=auth_callback");
  });
});
