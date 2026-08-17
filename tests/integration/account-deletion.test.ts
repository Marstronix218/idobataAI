import { beforeEach, describe, expect, it, vi } from "vitest";

const { authed, createAdminClient, deleteUser } = vi.hoisted(() => ({
  authed: vi.fn(),
  createAdminClient: vi.fn(),
  deleteUser: vi.fn(),
}));

vi.mock("@/lib/server/http", () => ({
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string, public code = "request_error") { super(message); }
  },
  authed,
  noContent: () => new Response(null, { status: 204 }),
  withApi: async (handler: () => Promise<Response>) => {
    try { return await handler(); }
    catch (error) {
      const status = typeof error === "object" && error !== null && "status" in error ? Number(error.status) : 500;
      return Response.json({ error: { message: error instanceof Error ? error.message : "error" } }, { status });
    }
  },
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));

import { DELETE } from "@/app/api/account/route";

function adminFixture(options: { anonymizationError?: Error; authError?: Error; finalizationError?: Error; storedObjects?: Record<string, string[]>; removeError?: Error } = {}) {
  const events: string[] = [];
  const removed: string[] = [];
  let updateCall = 0;
  const from = vi.fn(() => ({
    insert: () => ({ select: () => ({ single: async () => { events.push("request-recorded"); return { data: { id: "deletion-id" }, error: null }; } }) }),
    update: (value: { status: string }) => ({ eq: async () => {
      updateCall += 1;
      events.push(value.status);
      const error = updateCall === 1 ? options.anonymizationError : value.status === "completed" ? options.finalizationError : null;
      return { data: null, error: error ?? null };
    } }),
  }));
  // Erasure has to reach storage too: deleting the auth user cascades away
  // social_posts, and image_paths is the only record of which objects exist.
  const storage = {
    from: (bucket: string) => ({
      list: async (folder: string) => ({
        data: (options.storedObjects?.[`${bucket}/${folder}`] ?? []).map((name) => ({ id: name, name })),
        error: null,
      }),
      remove: async (paths: string[]) => {
        if (options.removeError) return { data: null, error: options.removeError };
        removed.push(...paths);
        events.push("storage-purged");
        return { data: null, error: null };
      },
    }),
  };
  deleteUser.mockImplementation(async () => { events.push("auth-deleted"); return { error: options.authError ?? null }; });
  return { events, removed, client: { from, storage, auth: { admin: { deleteUser } } } };
}

describe("account deletion route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authed.mockResolvedValue({ user: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } });
    process.env.BILLING_PROVIDER = "none";
    process.env.ACCOUNT_DELETION_AUDIT_SALT = "test-audit-salt";
  });

  it("pseudonymizes the audit before deleting Auth and marks completion", async () => {
    const fixture = adminFixture();
    createAdminClient.mockReturnValue(fixture.client);

    expect((await DELETE(new Request("http://localhost/api/account", { method: "DELETE" }))).status).toBe(204);
    expect(fixture.events).toEqual(["request-recorded", "auth_delete_pending", "auth-deleted", "completed"]);
  });

  it("purges avatars and completion media before deleting Auth", async () => {
    const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const fixture = adminFixture({
      storedObjects: {
        [`avatars/${userId}`]: ["portrait.jpg"],
        [`completion-post-media/${userId}/pending`]: ["abandoned.webp"],
      },
    });
    createAdminClient.mockReturnValue(fixture.client);

    expect((await DELETE(new Request("http://localhost/api/account", { method: "DELETE" }))).status).toBe(204);
    expect(fixture.removed).toEqual([`${userId}/portrait.jpg`, `${userId}/pending/abandoned.webp`]);
    // A public avatar left behind stays fetchable at a stable URL forever, and
    // orphaned post media becomes unreclaimable once its post row is gone.
    expect(fixture.events.indexOf("storage-purged")).toBeLessThan(fixture.events.indexOf("auth-deleted"));
  });

  it("does not delete account data when stored media cannot be removed", async () => {
    const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const fixture = adminFixture({
      storedObjects: { [`avatars/${userId}`]: ["portrait.jpg"] },
      removeError: new Error("storage unavailable"),
    });
    createAdminClient.mockReturnValue(fixture.client);

    expect((await DELETE(new Request("http://localhost/api/account", { method: "DELETE" }))).status).toBe(502);
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("does not delete Auth if audit anonymization fails", async () => {
    const fixture = adminFixture({ anonymizationError: new Error("audit unavailable") });
    createAdminClient.mockReturnValue(fixture.client);

    expect((await DELETE(new Request("http://localhost/api/account", { method: "DELETE" }))).status).toBe(500);
    expect(fixture.events).toEqual(["request-recorded", "auth_delete_pending"]);
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("records a pseudonymous failure if Auth deletion fails", async () => {
    const fixture = adminFixture({ authError: new Error("auth unavailable") });
    createAdminClient.mockReturnValue(fixture.client);

    expect((await DELETE(new Request("http://localhost/api/account", { method: "DELETE" }))).status).toBe(500);
    expect(fixture.events).toEqual(["request-recorded", "auth_delete_pending", "auth-deleted", "failed"]);
  });

  it("refuses deletion before any write when billing cancellation is unresolved", async () => {
    process.env.BILLING_PROVIDER = "stripe";
    const fixture = adminFixture();
    createAdminClient.mockReturnValue(fixture.client);

    expect((await DELETE(new Request("http://localhost/api/account", { method: "DELETE" }))).status).toBe(409);
    expect(fixture.events).toEqual([]);
  });
});
