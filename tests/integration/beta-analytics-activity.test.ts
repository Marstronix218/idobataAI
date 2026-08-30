import { beforeEach, describe, expect, it, vi } from "vitest";

const { authed, createAdminClient, rpc } = vi.hoisted(() => ({
  authed: vi.fn(),
  createAdminClient: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/server/http", () => ({
  assertDatabase: <T>(result: { data: T; error: Error | null }) => {
    if (result.error) throw result.error;
    return result.data;
  },
  authed,
  noContent: () => new Response(null, { status: 204 }),
  withApi: async (handler: () => Promise<Response>) => handler(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));

import { POST } from "@/app/api/analytics/activity/route";

describe("beta analytics activity route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authed.mockResolvedValue({ user: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } });
    rpc.mockResolvedValue({ data: null, error: null });
    createAdminClient.mockReturnValue({ rpc });
  });

  it("records only server-selected session activity for the authenticated user", async () => {
    const request = new Request("http://localhost/api/analytics/activity", {
      method: "POST",
      body: JSON.stringify({ event: "task_created", content: "must be ignored" }),
    });

    const response = await POST(request);

    expect(response.status).toBe(204);
    expect(authed).toHaveBeenCalledWith(request);
    expect(rpc).toHaveBeenCalledWith("record_beta_session_activity", {
      p_user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(rpc).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      event: expect.anything(),
      content: expect.anything(),
    }));
  });
});
