import { beforeEach, describe, expect, it, vi } from "vitest";

const { authed, parseJson, rpc } = vi.hoisted(() => ({
  authed: vi.fn(),
  parseJson: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/server/http", () => ({
  assertDatabase: <T>(result: { data: T; error: Error | null }) => {
    if (result.error) throw result.error;
    return result.data;
  },
  authed,
  ok: (data: unknown, init?: ResponseInit) => Response.json({ data }, init),
  parseJson,
  withApi: async (handler: () => Promise<Response>) => handler(),
}));

import { POST } from "@/app/api/feedback/route";
import { feedbackSchema } from "@/lib/server/schemas";

describe("feedback submission route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    parseJson.mockResolvedValue({ category: "idea", message: "A weekly recap would help." });
    rpc.mockResolvedValue({ data: "aaaaaaaa-0000-4000-8000-000000000001", error: null });
    authed.mockResolvedValue({ user: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }, supabase: { rpc } });
  });

  it("submits validated feedback through the identity-safe RPC", async () => {
    const response = await POST(new Request("http://localhost/api/feedback", {
      method: "POST",
      body: JSON.stringify({ category: "idea", message: "A weekly recap would help." }),
    }));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ data: { id: "aaaaaaaa-0000-4000-8000-000000000001" } });
    expect(authed).toHaveBeenCalledOnce();
    expect(parseJson).toHaveBeenCalledWith(expect.any(Request), feedbackSchema);
    expect(rpc).toHaveBeenCalledWith("submit_feedback", {
      p_category: "idea",
      p_message: "A weekly recap would help.",
    });
  });

  it("trims messages and rejects invalid categories and lengths", () => {
    expect(feedbackSchema.parse({ category: "issue", message: "  broken button  " })).toEqual({
      category: "issue",
      message: "broken button",
    });
    expect(feedbackSchema.safeParse({ category: "feature", message: "Useful feedback" }).success).toBe(false);
    expect(feedbackSchema.safeParse({ category: "other", message: " no " }).success).toBe(false);
    expect(feedbackSchema.safeParse({ category: "other", message: "x".repeat(2001) }).success).toBe(false);
  });
});
