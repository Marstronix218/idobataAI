import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProfileFollowPerson, ProfileFollowPersona } from "@/types";

const { apiRequest, createClient, notFound } = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  createClient: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({ notFound }));
vi.mock("@/lib/supabase/env", () => ({ hasPublicSupabaseEnv: () => true }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/client/api", () => ({
  apiRequest,
  isPreviewMode: false,
  errorMessage: (error: unknown) => error instanceof Error ? error.message : "Request failed.",
}));
vi.mock("@/lib/server/http", () => ({
  assertDatabase: <T,>(result: { data: T; error: { message: string } | null }) => {
    if (result.error) throw new Error(result.error.message);
    return result.data;
  },
}));
vi.mock("@/components/layout/momentum-rail", () => ({ MomentumRail: () => null }));

import { FollowPage } from "@/components/profile/follow-page";

const OWNER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const VIEWER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const followers: ProfileFollowPerson[] = [
  { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", username: "amara", display_name: "Amara Osei", avatar_url: null, bio: "Slow mornings.", profile_visibility: "public", followed_at: "2026-08-28T00:00:00.000Z", viewer_follows: false, viewer_requested: false, is_viewer: false },
  { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", username: "noor", display_name: null, avatar_url: null, bio: null, profile_visibility: "private", followed_at: "2026-08-27T00:00:00.000Z", viewer_follows: false, viewer_requested: true, is_viewer: false },
  { id: VIEWER, username: "mina", display_name: "Mina", avatar_url: null, bio: null, profile_visibility: "public", followed_at: "2026-08-26T00:00:00.000Z", viewer_follows: false, viewer_requested: false, is_viewer: true },
];

const personas: ProfileFollowPersona[] = [
  { id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", slug: "moss", name: "Moss", avatar_url: null, personality: "A forest spirit at a human university.", followed_at: "2026-08-28T00:00:00.000Z", viewer_follows: false, is_favorite: false },
];

type Summary = { follower_count: number; following_count: number; viewer_follows: boolean; viewer_requested: boolean; pending_request_count: number };

function mockClient({
  visibility = "public",
  viewerId = VIEWER,
  summary,
  lists = {},
}: {
  visibility?: "public" | "private";
  viewerId?: string;
  summary?: Partial<Summary>;
  lists?: Partial<Record<
    "list_profile_followers" | "list_profile_following" | "list_profile_ai_followers" | "list_profile_ai_following" | "list_profile_favorite_personas",
    unknown[]
  >>;
} = {}) {
  const resolved: Summary = { follower_count: 3, following_count: 4, viewer_follows: true, viewer_requested: false, pending_request_count: 0, ...summary };
  const rpc = vi.fn((name: string) => {
    if (name === "get_profile_follow_summary") return Promise.resolve({ data: [resolved], error: null });
    if (name === "get_profile_ai_follower_count") return Promise.resolve({ data: 2, error: null });
    if (name === "get_profile_ai_following_count") return Promise.resolve({ data: 5, error: null });
    if (name === "list_profile_favorite_personas") return Promise.resolve({ data: lists.list_profile_favorite_personas ?? [], error: null });
    if (name in lists) return Promise.resolve({ data: lists[name as keyof typeof lists], error: null });
    throw new Error(`Unexpected RPC: ${name}`);
  });
  createClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: viewerId } } }) },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        ilike: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: OWNER, username: "jonah", display_name: "Jonah", profile_visibility: visibility },
            error: null,
          }),
        })),
      })),
    })),
    rpc,
  });
  return { rpc };
}

describe("FollowPage", () => {
  beforeEach(() => {
    // Demo mode is on by default in the test environment, and it short-circuits
    // every database read below.
    vi.stubEnv("NEXT_PUBLIC_ENABLE_DEMO_MODE", "false");
    apiRequest.mockReset();
    createClient.mockReset();
    notFound.mockClear();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("splits the graph by direction on top and by audience underneath", async () => {
    mockClient({ lists: { list_profile_followers: followers } });

    render(await FollowPage({ username: "jonah", direction: "followers", audience: "people" }));

    // Direction is the page; the audience is a filter across both pages, so
    // neither axis has to carry the other's options.
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Followers", "Following"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toHaveAttribute("href", "/u/jonah/following");

    // Each count is printed exactly once, and never as a people+AI total.
    const chips = within(screen.getByRole("group", { name: "Filter by audience" })).getAllByRole("link");
    expect(chips.map((chip) => chip.textContent)).toEqual(["People3", "AI2"]);
    expect(chips[0]).toHaveAttribute("aria-current", "true");
    expect(chips[1]).toHaveAttribute("href", "/u/jonah/followers?kind=ai");
  });

  it("keeps the audience filter while moving between directions", async () => {
    mockClient({ lists: { list_profile_ai_following: personas } });

    render(await FollowPage({ username: "jonah", direction: "following", audience: "ai" }));

    // Switching direction from the AI list lands on the other AI list rather
    // than silently dropping back to people.
    expect(screen.getAllByRole("tab")[0]).toHaveAttribute("href", "/u/jonah/followers?kind=ai");
    const chips = within(screen.getByRole("group", { name: "Filter by audience" })).getAllByRole("link");
    expect(chips.map((chip) => chip.textContent)).toEqual(["People4", "AI5"]);
    expect(chips[0]).toHaveAttribute("href", "/u/jonah/following");
  });

  it("renders each follower with the control that matches where the reader stands", async () => {
    mockClient({ lists: { list_profile_followers: followers } });

    render(await FollowPage({ username: "jonah", direction: "followers", audience: "people" }));

    expect(screen.getByRole("link", { name: /Amara Osei/ })).toHaveAttribute("href", "/u/amara");
    expect(screen.getByRole("button", { name: "Follow Amara Osei" })).toBeInTheDocument();
    // A pending request reads as Requested, not as an offer to follow again.
    expect(screen.getByRole("button", { name: "Cancel follow request to noor" })).toHaveTextContent("Requested");
    // The reader's own row has nothing to act on.
    expect(screen.queryByRole("button", { name: /Mina/ })).not.toBeInTheDocument();
  });

  it("files a request instead of a follow against a protected row", async () => {
    mockClient({ lists: { list_profile_followers: followers } });
    apiRequest.mockResolvedValue({ state: "requested" });

    render(await FollowPage({ username: "jonah", direction: "followers", audience: "people" }));
    fireEvent.click(screen.getByRole("button", { name: "Follow Amara Osei" }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(
      "/api/users/cccccccc-cccc-4ccc-8ccc-cccccccccccc/follow",
      { method: "PUT" },
    ));
    expect(await screen.findByRole("button", { name: "Cancel follow request to Amara Osei" })).toBeInTheDocument();
  });

  it("lists the profile's own AI followers instead of the global persona directory", async () => {
    const { rpc } = mockClient({ lists: { list_profile_ai_followers: personas } });

    render(await FollowPage({ username: "jonah", direction: "followers", audience: "ai" }));

    expect(rpc).toHaveBeenCalledWith("list_profile_ai_followers", { p_user_id: OWNER, p_limit: 31, p_offset: 0 });
    expect(screen.getByRole("link", { name: /Moss/ })).toHaveAttribute("href", "/ai-personas/moss");
    expect(screen.getByRole("button", { name: "Follow Moss" })).toBeInTheDocument();
  });

  it("follows a persona through the relationship endpoint, not the human follow route", async () => {
    mockClient({ lists: { list_profile_ai_followers: personas } });
    apiRequest.mockResolvedValue(undefined);

    render(await FollowPage({ username: "jonah", direction: "followers", audience: "ai" }));
    fireEvent.click(screen.getByRole("button", { name: "Follow Moss" }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(
      "/api/companions/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/relationship",
      { method: "PUT", body: JSON.stringify({ action: "follow", following: true }) },
    ));
  });

  it("lets the owner star a persona from their own AI following list", async () => {
    const { rpc } = mockClient({ viewerId: OWNER, lists: { list_profile_ai_following: personas } });
    apiRequest.mockResolvedValue(undefined);

    render(await FollowPage({ username: "jonah", direction: "following", audience: "ai" }));

    expect(rpc).toHaveBeenCalledWith("list_profile_ai_following", { p_user_id: OWNER, p_limit: 31, p_offset: 0 });
    expect(screen.getByText("0 of 3 favorites")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Favorite Moss" }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(
      "/api/companions/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/relationship",
      { method: "PUT", body: JSON.stringify({ action: "favorite", favorite: true }) },
    ));
    expect(await screen.findByRole("button", { name: "Remove Moss from favorites" })).toBeInTheDocument();
  });

  it("stops the owner at three favorites without asking the server", async () => {
    const favorites = Array.from({ length: 3 }, (_, index) => ({ ...personas[0], id: `favorite-${index}` }));
    mockClient({
      viewerId: OWNER,
      lists: { list_profile_ai_following: personas, list_profile_favorite_personas: favorites },
    });

    render(await FollowPage({ username: "jonah", direction: "following", audience: "ai" }));

    expect(screen.getByText("3 of 3 favorites")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Favorite Moss" })).toBeDisabled();
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it("shows another reader the owner's favorites as a fact rather than a control", async () => {
    mockClient({ lists: { list_profile_ai_following: [{ ...personas[0], is_favorite: true }] } });

    render(await FollowPage({ username: "jonah", direction: "following", audience: "ai" }));

    // The star says "one of Jonah's three"; only Jonah can change that.
    expect(screen.getByLabelText("Favorite persona")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /favorites?/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/of 3 favorites/)).not.toBeInTheDocument();
  });

  it("withholds the social graph of a protected profile from a reader it has not approved", async () => {
    const { rpc } = mockClient({ visibility: "private", summary: { viewer_follows: false, viewer_requested: true } });

    render(await FollowPage({ username: "jonah", direction: "followers", audience: "people" }));

    expect(screen.getByText("This list is protected")).toBeInTheDocument();
    expect(screen.getByText(/Your request is waiting for them/)).toBeInTheDocument();
    // The counts still render -- they describe the account, not its graph.
    expect(within(screen.getByRole("group", { name: "Filter by audience" })).getAllByRole("link")[0]).toHaveTextContent("People3");
    expect(rpc).not.toHaveBeenCalledWith("list_profile_followers", expect.anything());
  });

  it("shows a protected profile its own list", async () => {
    const { rpc } = mockClient({ visibility: "private", viewerId: OWNER, summary: { viewer_follows: false }, lists: { list_profile_followers: followers } });

    render(await FollowPage({ username: "jonah", direction: "followers", audience: "people" }));

    expect(screen.queryByText("This list is protected")).not.toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith("list_profile_followers", { p_user_id: OWNER, p_limit: 31, p_offset: 0 });
  });

  it("reads as a 404 when the two accounts have blocked each other", async () => {
    mockClient();
    createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: VIEWER } } }) },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          ilike: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: OWNER, username: "jonah", display_name: "Jonah", profile_visibility: "public" }, error: null }),
          })),
        })),
      })),
      // A blocked pair is exactly the case where the summary returns no row.
      rpc: vi.fn((name: string) => name === "get_profile_follow_summary"
        ? Promise.resolve({ data: [], error: null })
        : Promise.resolve({ data: 0, error: null })),
    });

    await expect(FollowPage({ username: "jonah", direction: "followers", audience: "people" })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });

  it("pages the list rather than dumping every row", async () => {
    const many = Array.from({ length: 31 }, (_, index) => ({
      ...followers[0],
      id: `person-${index}`,
      username: `person${index}`,
      display_name: `Person ${index}`,
      is_viewer: false,
    }));
    mockClient({ lists: { list_profile_followers: many } });
    apiRequest.mockResolvedValue({ items: [{ ...followers[0], id: "person-31", username: "person31", display_name: "Person 31" }], hasMore: false });

    render(await FollowPage({ username: "jonah", direction: "followers", audience: "people" }));

    // The 31st row is the "is there more" probe and is never rendered.
    expect(screen.queryByText("Person 30")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(`/api/users/${OWNER}/follows?kind=followers&offset=30`));
    expect(await screen.findByText("Person 31")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
  });
});
