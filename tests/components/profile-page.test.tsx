import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { activeCompanions } from "@/data/demo";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/supabase/env", () => ({
  hasPublicSupabaseEnv: () => false,
}));

vi.mock("@/lib/server/http", () => ({
  assertDatabase: <T,>(result: { data: T; error: { message: string } | null }) => {
    if (result.error) throw new Error(result.error.message);
    return result.data;
  },
}));

vi.mock("@/lib/server/post-media", () => ({
  signPostMediaByPath: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/components/layout/momentum-rail", () => ({
  MomentumRail: () => null,
}));

import ProfilePage from "@/app/(app)/u/[username]/page";

describe("ProfilePage", () => {
  it("keeps the owner edit action focused on profile editing", async () => {
    render(await ProfilePage({
      params: Promise.resolve({ username: "mina" }),
      searchParams: Promise.resolve({}),
    }));

    expect(screen.getByRole("link", { name: "Edit profile" })).toHaveAttribute("href", "/u/mina/edit");
  });

  it("opens each follower count on the list behind it", async () => {
    render(await ProfilePage({
      params: Promise.resolve({ username: "mina" }),
      searchParams: Promise.resolve({}),
    }));

    const followerCount = 3 + activeCompanions.length;
    const followingCount = 5 + activeCompanions.length;
    expect(screen.getByText("Followers").closest("dd")).toHaveTextContent(new RegExp(`${followerCount}\\s*Followers`));
    expect(screen.getByRole("link", { name: `View all ${followerCount} followers` })).toHaveAttribute("href", "/u/mina/followers");
    expect(screen.getByRole("link", { name: `View all ${followingCount} accounts Mina Mori follows` })).toHaveAttribute("href", "/u/mina/following");
    // The totals include people and AI without adding separate count columns.
    expect(screen.queryByText(/AI followers/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage favorites" })).toHaveAttribute("href", "/u/mina/following?kind=ai");
  });

  it("names the owner's favorite personas under the counts, capped at three", async () => {
    render(await ProfilePage({
      params: Promise.resolve({ username: "mina" }),
      searchParams: Promise.resolve({}),
    }));

    const strip = screen.getByRole("region", { name: "Favorite AI personas" });
    const personas = within(strip).getAllByRole("link").filter((link) => link.getAttribute("href")?.startsWith("/ai-personas/"));
    expect(personas).toHaveLength(3);
    // The strip sits directly after the metrics rather than inside them, so the
    // counts stay a row of numbers and the personas stay a row of faces.
    expect(strip.previousElementSibling?.tagName).toBe("DL");
  });

  it("links to the profile owner's replies and liked posts", async () => {
    render(await ProfilePage({
      params: Promise.resolve({ username: "mina" }),
      searchParams: Promise.resolve({}),
    }));

    expect(screen.getByRole("tab", { name: "Replies" })).toHaveAttribute("href", "/u/mina?tab=replies");
    expect(screen.getByRole("tab", { name: "Likes" })).toHaveAttribute("href", "/u/mina?tab=likes");
    expect(screen.queryByRole("tab", { name: "Progress" })).not.toBeInTheDocument();
  });

  it("shows plain reposts and quote reposts in the existing Posts tab", async () => {
    render(await ProfilePage({
      params: Promise.resolve({ username: "mina" }),
      searchParams: Promise.resolve({}),
    }));

    expect(screen.getByRole("tab", { name: "Posts" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Mina Mori reposted")).toBeVisible();
    expect(screen.getByText("This is exactly the kind of patient progress I want to remember.")).toBeVisible();
    expect(screen.getByRole("link", { name: "View quoted post by Moss" })).toHaveAttribute("href", "/posts/moss-study");
    const repostedPost = screen.getByRole("article", { name: "Open post by Moss" });
    expect(within(repostedPost).getByRole("button", { name: /^Repost/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("removes an undone plain repost from the owner's Posts timeline", async () => {
    render(await ProfilePage({
      params: Promise.resolve({ username: "mina" }),
      searchParams: Promise.resolve({}),
    }));
    const repostedPost = screen.getByRole("article", { name: "Open post by Moss" });

    fireEvent.click(within(repostedPost).getByRole("button", { name: /^Repost/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Undo repost" }));

    expect(await screen.findByText("Repost removed. Preview only.")).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "Open post by Moss" })).not.toBeInTheDocument();
  });

  it("shows the profile owner's replies with their conversation context", async () => {
    render(await ProfilePage({
      params: Promise.resolve({ username: "mina" }),
      searchParams: Promise.resolve({ tab: "replies" }),
    }));

    expect(screen.getByRole("tab", { name: "Replies" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Keeping the run easy sounds like a smart way to make tomorrow feel possible too.")).toBeVisible();
    expect(screen.getByRole("link", { name: "View conversation with Jonah" })).toHaveAttribute("href", "/posts/jonah-run");
  });

  it("shows posts liked by the profile owner", async () => {
    render(await ProfilePage({
      params: Promise.resolve({ username: "mina" }),
      searchParams: Promise.resolve({ tab: "likes" }),
    }));

    expect(screen.getByRole("tab", { name: "Likes" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText("Mina Mori liked")).not.toBeInTheDocument();
    const post = screen.getByRole("article", { name: "Open post by Moss" });
    expect(post).toBeVisible();
    // Scoped to the post: the same persona can also appear in the card's
    // favorites strip above, which links to the same page.
    expect(within(post).getByRole("link", { name: "Moss" })).toHaveAttribute("href", "/ai-personas/moss");
    expect(screen.getByRole("button", { name: /Like 8/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "More actions for Moss" })).toBeVisible();
  });
});
