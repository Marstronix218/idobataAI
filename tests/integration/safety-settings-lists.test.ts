import { beforeEach, describe, expect, it, vi } from "vitest";

const { authed } = vi.hoisted(() => ({ authed: vi.fn() }));

vi.mock("@/lib/server/http", () => ({
  authed,
  assertDatabase: <T>(result: { data: T; error: Error | null }) => {
    if (result.error) throw result.error;
    return result.data;
  },
  ok: (data: unknown) => Response.json({ data }),
  withApi: async (handler: () => Promise<Response>) => handler(),
}));

import { GET as getBlocks } from "@/app/api/blocks/route";
import { GET as getMutes } from "@/app/api/companion-mutes/route";

function queryFixture(data: unknown[]) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    order: vi.fn(async () => ({ data, error: null })),
  };
  return query;
}

describe("safety settings collection routes", () => {
  const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  beforeEach(() => vi.clearAllMocks());

  it("returns only flattened blocked-person identity fields", async () => {
    const query = queryFixture([{ user_profiles: { id: "blocked-id", display_name: "Sam Lee", username: "sam", avatar_url: "/sam.png", bio: "private" } }]);
    authed.mockResolvedValue({ user: { id: userId }, supabase: { from: vi.fn(() => query) } });

    const response = await getBlocks(new Request("http://localhost/api/blocks"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { items: [{ id: "blocked-id", name: "Sam Lee", username: "sam", avatarUrl: "/sam.png" }] } });
    expect(query.eq).toHaveBeenCalledWith("blocker_id", userId);
  });

  it("returns only flattened muted-companion identity fields", async () => {
    const query = queryFixture([{ social_companions: { id: "companion-id", name: "Moss", slug: "moss", avatar_url: "/moss.png", personality: "private" } }]);
    authed.mockResolvedValue({ user: { id: userId }, supabase: { from: vi.fn(() => query) } });

    const response = await getMutes(new Request("http://localhost/api/companion-mutes"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { items: [{ id: "companion-id", name: "Moss", slug: "moss", avatarUrl: "/moss.png" }] } });
    expect(query.eq).toHaveBeenCalledWith("user_id", userId);
  });
});
