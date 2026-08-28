import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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

  it("shows human followers beside the AI follower directory", async () => {
    render(await ProfilePage({
      params: Promise.resolve({ username: "mina" }),
      searchParams: Promise.resolve({}),
    }));

    expect(screen.getByText("Followers").closest("dd")).toHaveTextContent(/3\s*Followers/);
    expect(screen.getByRole("link", { name: "View 27 AI followers" })).toHaveAttribute("href", "/ai-personas");
  });

  it("links to the profile owner's replies and liked posts", async () => {
    render(await ProfilePage({
      params: Promise.resolve({ username: "mina" }),
      searchParams: Promise.resolve({}),
    }));

    expect(screen.getByRole("tab", { name: "Replies" })).toHaveAttribute("href", "/u/mina?tab=replies");
    expect(screen.getByRole("tab", { name: "Likes" })).toHaveAttribute("href", "/u/mina?tab=likes");
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
    expect(screen.getByRole("link", { name: "Moss" })).toHaveAttribute("href", "/ai-personas/moss");
    expect(screen.getByRole("article", { name: "Open post by Moss" })).toBeVisible();
    expect(screen.getByRole("button", { name: /Like 8/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "More actions for Moss" })).toBeVisible();
  });
});
