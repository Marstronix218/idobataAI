import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProfileCard } from "@/types";

const { createClient, notFound } = vi.hoisted(() => ({ createClient: vi.fn(), notFound: vi.fn() }));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({ notFound, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/supabase/env", () => ({ hasPublicSupabaseEnv: () => true }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/server/http", () => ({
  assertDatabase: <T,>(result: { data: T; error: { message: string } | null }) => {
    if (result.error) throw new Error(result.error.message);
    return result.data;
  },
}));
vi.mock("@/lib/server/post-media", () => ({ signPostMediaByPath: vi.fn().mockResolvedValue(new Map()) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock("@/components/layout/momentum-rail", () => ({ MomentumRail: () => null }));

import ProfilePage from "@/app/(app)/u/[username]/page";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

const VIEWER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TARGET_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

// What `get_profile_card` hands back for a profile `profiles_read` refuses to
// select: identity and nothing that privacy is actually about.
const card: ProfileCard = {
  id: TARGET_ID,
  username: "jonah",
  display_name: "Jonah",
  bio: "Keeping the next step small.",
  avatar_url: null,
  interests: ["Wellbeing"],
  current_streak: 2,
  profile_visibility: "private",
  created_at: "2026-08-01T00:00:00.000Z",
};

const viewer = { username: "mina", display_name: "Mina", avatar_url: null };

function query<T>(result: { data: T; error: null; count?: number }) {
  const builder = {} as Record<string, ReturnType<typeof vi.fn>> & PromiseLike<typeof result>;
  for (const method of ["eq", "ilike", "in", "is", "limit", "order"]) builder[method] = vi.fn(() => builder);
  builder.maybeSingle = vi.fn().mockResolvedValue(result);
  builder.then = (resolve) => Promise.resolve(result).then(resolve);
  return builder;
}

function mockPrivateProfile({
  viewerId = VIEWER_ID,
  viewerFollows = false,
  viewerRequested = false,
  pendingRequestCount = 0,
}: { viewerId?: string; viewerFollows?: boolean; viewerRequested?: boolean; pendingRequestCount?: number } = {}) {
  const rpc = vi.fn((name: string) => {
    if (name === "get_profile_card") return Promise.resolve({ data: [card], error: null });
    if (name === "get_profile_ai_following_count") return Promise.resolve({ data: 2, error: null });
    if (name === "list_profile_favorite_personas") return Promise.resolve({ data: [], error: null });
    if (name === "get_profile_follow_summary") {
      return Promise.resolve({
        data: [{
          follower_count: 10,
          following_count: 11,
          viewer_follows: viewerFollows,
          viewer_requested: viewerRequested,
          pending_request_count: pendingRequestCount,
        }],
        error: null,
      });
    }
    throw new Error(`Unexpected RPC: ${name}`);
  });
  const from = vi.fn((table: string) => ({
    select: vi.fn((selection: string, options?: { count?: string }) => {
      // The row-level policy hides the private profile from the viewer, which is
      // the whole reason the card RPC exists.
      if (table === "user_profiles") return query({ data: selection === "*" ? null : viewer, error: null });
      if (table === "task_completion_awards") return query({ data: null, count: 4, error: null });
      if (table === "social_posts" && options?.count) return query({ data: null, count: 5, error: null });
      if (table === "social_reposts" && options?.count) return query({ data: null, count: 0, error: null });
      if (table === "social_posts" || table === "social_reposts") return query({ data: [], error: null });
      throw new Error(`Unexpected table: ${table}`);
    }),
  }));
  createClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: viewerId } } }) },
    from,
    rpc,
  });
  return { from, rpc };
}

const renderProfile = async () => render(await ProfilePage({
  params: Promise.resolve({ username: "jonah" }),
  searchParams: Promise.resolve({}),
}));

describe("ProfilePage for a protected profile", () => {
  it("renders the identity card of a profile the viewer may not select", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_DEMO_MODE", "false");
    const { rpc } = mockPrivateProfile();

    await renderProfile();

    expect(notFound).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("get_profile_card", { p_username: "jonah" });
    expect(screen.getByRole("heading", { level: 2, name: "Jonah" })).toBeInTheDocument();
    expect(screen.getByText("@jonah")).toBeInTheDocument();
    expect(screen.getByText("Keeping the next step small.")).toBeInTheDocument();
    expect(screen.getByText(/Joined/)).toBeInTheDocument();
    expect(screen.getByText("Followers").closest("dd")).toHaveTextContent(/10\s*Followers/);
    expect(screen.getByText("People followed").closest("div")).toHaveTextContent(/11\s*Following/);
    expect(screen.getByText("Wellbeing")).toBeInTheDocument();
    expect(screen.getByLabelText("Private profile")).toBeInTheDocument();
  });

  it("withholds the timeline behind a protected notice with a way in", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_DEMO_MODE", "false");
    mockPrivateProfile();

    await renderProfile();

    expect(screen.getByRole("heading", { name: "These posts are protected" })).toBeInTheDocument();
    expect(screen.getByText(/To ask for access, tap Follow/)).toBeInTheDocument();
    expect(screen.queryByRole("tablist", { name: "Profile views" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Follow Jonah" })).toBeInTheDocument();
  });

  it("shows a pending request as waiting rather than as an unfollow", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_DEMO_MODE", "false");
    mockPrivateProfile({ viewerRequested: true });

    await renderProfile();

    expect(screen.getByRole("button", { name: "Cancel follow request to Jonah" })).toBeInTheDocument();
    expect(screen.getByText(/Your request is waiting for them/)).toBeInTheDocument();
  });

  it("opens the timeline to an approved follower", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_DEMO_MODE", "false");
    mockPrivateProfile({ viewerFollows: true });

    await renderProfile();

    expect(screen.queryByRole("heading", { name: "These posts are protected" })).not.toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "Profile views" })).toBeInTheDocument();
  });

  it("points the owner at the people waiting to follow them", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_DEMO_MODE", "false");
    mockPrivateProfile({ viewerId: TARGET_ID, pendingRequestCount: 3 });

    await renderProfile();

    expect(screen.getByRole("link", { name: /3 people are waiting to follow you/ }))
      .toHaveAttribute("href", "/follow-requests");
  });
});
