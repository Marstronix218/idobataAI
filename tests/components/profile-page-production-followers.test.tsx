import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UserProfile } from "@/types";

const { createClient, refresh } = vi.hoisted(() => ({ createClient: vi.fn(), refresh: vi.fn() }));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
  useRouter: () => ({ refresh }),
}));
vi.mock("@/lib/supabase/env", () => ({ hasPublicSupabaseEnv: () => true }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/server/http", () => ({
  assertDatabase: <T,>(result: { data: T; error: { message: string; code?: string } | null }) => {
    if (result.error?.code?.startsWith("08")) throw new Error("The service is temporarily unavailable. Please try again shortly.");
    if (result.error) throw new Error(result.error.message);
    return result.data;
  },
}));
vi.mock("@/lib/server/post-media", () => ({
  signPostMediaByPath: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock("@/components/layout/momentum-rail", () => ({ MomentumRail: () => null }));

import ProfilePage from "@/app/(app)/u/[username]/page";

afterEach(() => vi.unstubAllEnvs());

type DatabaseError = { message: string; code?: string };

function query<T>(result: { data: T; error: DatabaseError | null; count?: number }) {
  const builder = {} as Record<string, ReturnType<typeof vi.fn>> & PromiseLike<typeof result>;
  for (const method of ["eq", "ilike", "in", "is", "limit", "order"]) builder[method] = vi.fn(() => builder);
  builder.maybeSingle = vi.fn().mockResolvedValue(result);
  builder.then = (resolve) => Promise.resolve(result).then(resolve);
  return builder;
}

const target: UserProfile = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  username: "jonah",
  display_name: "Jonah",
  bio: "Keeping the next step small.",
  avatar_url: null,
  profile_visibility: "public",
  daily_goal: 3,
  interests: ["Wellbeing"],
  default_task_visibility: "private",
  completion_visibility: "private",
  xp: 0,
  current_streak: 2,
  last_completion_date: null,
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-20T00:00:00.000Z",
};

const viewer = { username: "mina", display_name: "Mina", avatar_url: null };

const favoritePersona = {
  id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  slug: "moss",
  name: "Moss",
  avatar_url: null,
  personality: "A forest spirit at a human university.",
  followed_at: "2026-08-28T00:00:00.000Z",
  viewer_follows: false,
  is_favorite: true,
};

function mockProfileClient(followSummaryResult: {
  data: Array<{ follower_count: number; following_count: number; viewer_follows: boolean }> | null;
  error: { message: string; code?: string } | null;
}, aiCounts = { followers: 3, following: 2 }, config: { viewerId?: string; completionAwards?: number; favorites?: unknown[] } = {}) {
  const from = vi.fn((table: string) => ({
    select: vi.fn((selection: string, options?: { count?: string }) => {
      if (table === "user_profiles") return query({ data: selection === "*" ? target : viewer, error: null });
      if (table === "task_completion_awards") return query({ data: null, count: config.completionAwards ?? 0, error: null });
      if (table === "social_posts" && options?.count) return query({ data: null, count: 0, error: null });
      if (table === "social_posts") return query({ data: [], error: null });
      if (table === "social_reposts" && options?.count) return query({ data: null, count: 0, error: null });
      if (table === "social_reposts") return query({ data: [], error: null });
      throw new Error(`Unexpected table: ${table}`);
    }),
  }));
  createClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: config.viewerId ?? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } } }) },
    from,
    rpc: vi.fn((name: string) => {
      if (name === "get_profile_follow_summary") return Promise.resolve(followSummaryResult);
      if (name === "get_profile_ai_follower_count") return Promise.resolve({ data: aiCounts.followers, error: null });
      if (name === "get_profile_ai_following_count") return Promise.resolve({ data: aiCounts.following, error: null });
      if (name === "list_profile_favorite_personas") return Promise.resolve({ data: config.favorites ?? [], error: null });
      throw new Error(`Unexpected RPC: ${name}`);
    }),
  });
  return { from };
}

type ProfilePostsFailure = "authored-posts" | "repost-count" | "repost-list" | "repost-hydration";

function mockProfilePostsFailure(failure: ProfilePostsFailure) {
  const databaseError = { message: "connection failed", code: "08006" };
  let socialPostListCalls = 0;
  const from = vi.fn((table: string) => ({
    select: vi.fn((selection: string, options?: { count?: string }) => {
      if (table === "user_profiles") return query({ data: selection === "*" ? target : viewer, error: null });
      if (table === "social_posts" && options?.count) return query({ data: null, count: 0, error: null });
      if (table === "social_reposts" && options?.count) {
        return failure === "repost-count"
          ? query({ data: null, count: 0, error: databaseError })
          : query({ data: null, count: 0, error: null });
      }
      if (table === "social_posts") {
        socialPostListCalls += 1;
        if (failure === "authored-posts" && socialPostListCalls === 1) {
          return query({ data: null, error: databaseError });
        }
        if (failure === "repost-hydration" && socialPostListCalls === 2) {
          return query({ data: null, error: databaseError });
        }
        return query({ data: [], error: null });
      }
      if (table === "social_reposts") {
        if (failure === "repost-list") return query({ data: null, error: databaseError });
        return query({
          data: failure === "repost-hydration"
            ? [{
                id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                post_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                actor_id: target.id,
                created_at: "2026-08-21T00:00:00.000Z",
              }]
            : [],
          error: null,
        });
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  }));
  createClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } } }) },
    from,
    rpc: vi.fn((name: string) => {
      if (name === "get_profile_follow_summary") {
        return Promise.resolve({ data: [{ follower_count: 7, following_count: 4, viewer_follows: true }], error: null });
      }
      if (name === "get_profile_ai_follower_count") return Promise.resolve({ data: 3, error: null });
      if (name === "get_profile_ai_following_count") return Promise.resolve({ data: 2, error: null });
      if (name === "list_profile_favorite_personas") return Promise.resolve({ data: [], error: null });
      throw new Error(`Unexpected RPC: ${name}`);
    }),
  });
}

describe("ProfilePage production followers", () => {
  it("counts the owner's completed task occurrences even when they were not posted", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_DEMO_MODE", "false");
    const { from } = mockProfileClient(
      { data: [{ follower_count: 0, following_count: 0, viewer_follows: false }], error: null },
      { followers: 0, following: 0 },
      { viewerId: target.id, completionAwards: 9 },
    );

    render(await ProfilePage({
      params: Promise.resolve({ username: "jonah" }),
      searchParams: Promise.resolve({}),
    }));

    expect(screen.getByText("Completions").closest("div")).toHaveTextContent(/Completions\s*9/);
    expect(from).toHaveBeenCalledWith("task_completion_awards");
  });

  it("renders combined human and AI relationship totals", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_DEMO_MODE", "false");
    const { from } = mockProfileClient(
      { data: [{ follower_count: 7, following_count: 4, viewer_follows: true }], error: null },
      { followers: 3, following: 2 },
      { favorites: [favoritePersona] },
    );

    render(await ProfilePage({
      params: Promise.resolve({ username: "jonah" }),
      searchParams: Promise.resolve({}),
    }));

    expect(screen.getByText("Followers").closest("dd")).toHaveTextContent(/10\s*Followers/);
    expect(screen.getByRole("link", { name: "View all 6 accounts Jonah follows" })).toHaveTextContent(/6\s*Following/);
    expect(screen.getByRole("button", { name: "Unfollow Jonah" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("link", { name: "View all 10 followers" })).toHaveAttribute("href", "/u/jonah/followers");
    expect(screen.getByRole("link", { name: "View all 6 accounts Jonah follows" })).toHaveAttribute("href", "/u/jonah/following");
    // The totals include AI, while the favorites strip still opens the AI
    // filter without adding another count to the profile card.
    expect(screen.queryByText(/AI followers/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View AI following" })).toHaveAttribute("href", "/u/jonah/following?kind=ai");
    expect(screen.queryByText("See all 2")).not.toBeInTheDocument();
    expect(from).toHaveBeenCalledWith("social_reposts");
    expect(from).not.toHaveBeenCalledWith("social_companions");
  });

  it("collapses the favorites strip on someone else's profile when they have none", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_DEMO_MODE", "false");
    mockProfileClient({ data: [{ follower_count: 7, following_count: 4, viewer_follows: true }], error: null });

    render(await ProfilePage({
      params: Promise.resolve({ username: "jonah" }),
      searchParams: Promise.resolve({}),
    }));

    // A visitor learns nothing from an empty strip, and the AI list is still
    // one tap away behind the Following count.
    expect(screen.queryByRole("region", { name: "Favorite AI personas" })).not.toBeInTheDocument();
  });

  it("fails loudly instead of rendering a false zero when the follower summary is unavailable", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_DEMO_MODE", "false");
    mockProfileClient({ data: null, error: { message: "connection failed", code: "08006" } });

    await expect(ProfilePage({
      params: Promise.resolve({ username: "jonah" }),
      searchParams: Promise.resolve({}),
    })).rejects.toThrow("The service is temporarily unavailable");
  });

  it.each([
    ["authored posts", "authored-posts"],
    ["repost count", "repost-count"],
    ["repost activity", "repost-list"],
    ["reposted post hydration", "repost-hydration"],
  ] as const)("surfaces a database failure while loading %s", async (_label, failure) => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_DEMO_MODE", "false");
    mockProfilePostsFailure(failure);

    await expect(ProfilePage({
      params: Promise.resolve({ username: "jonah" }),
      searchParams: Promise.resolve({}),
    })).rejects.toThrow("The service is temporarily unavailable");
  });
});
