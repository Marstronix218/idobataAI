import { fireEvent, render, screen, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { TaskBoard } from "@/components/tasks/task-board";
import { Feed, PostCard } from "@/components/social/feed";
import type { FeedPost } from "@/types";

const winWithStreak = {
  id: "aaaaaaaa-1000-4000-8000-000000000009",
  author_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  companion_id: null,
  kind: "human_completion",
  visibility: "public",
  content: "",
  task_title: "Water the plants",
  category: null,
  streak: 5,
  created_at: "2026-10-31T12:00:00.000Z",
  image_urls: [],
  user_profiles: { username: "maya", avatar_url: null },
  social_companions: null,
  social_reactions: [],
  social_replies: [],
  social_reposts: [],
  reply_count: 0,
  quoted_post: null,
} as unknown as FeedPost;

describe("share_win off", () => {
  it("removes every way to post a win from Your Tasks", async () => {
    const { container } = render(<TaskBoard shareWin={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Complete: Draft the project kickoff outline" }));
    expect(screen.getByText("Done")).toBeVisible();
    expect(screen.queryByRole("link", { name: "Post the win" })).not.toBeInTheDocument();
    expect(screen.queryByText("Post it and the people following you can cheer you on.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss completion message" }));
    fireEvent.click(screen.getByRole("button", { name: /Completed/ }));
    expect(screen.queryByRole("link", { name: "Post" })).not.toBeInTheDocument();
    expect(container.querySelector('a[href$="/share"]')).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("Feed in Wins-only mode", () => {
  it("shows people's wins without tabs, search, profiles or engagement buttons", async () => {
    const { container } = render(<Feed winsOnly />);

    expect(screen.getByRole("heading", { name: "Community" })).toBeVisible();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("tabpanel")).not.toBeInTheDocument();
    expect(screen.queryByRole("search")).not.toBeInTheDocument();
    const posts = screen.getAllByRole("article");
    expect(posts.length).toBeGreaterThan(0);
    for (const post of posts) {
      expect(within(post).queryByText("AI")).not.toBeInTheDocument();
      expect(within(post).queryByRole("button", { name: /Like/ })).not.toBeInTheDocument();
      expect(within(post).queryByRole("button", { name: /Repost/ })).not.toBeInTheDocument();
      expect(within(post).queryByRole("link")).not.toBeInTheDocument();
    }
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("streak badge on a shared win", () => {
  const card = (winsOnly: boolean) => render(
    <PostCard post={winWithStreak} currentUserId={null} onChange={vi.fn()} onNotice={vi.fn()} winsOnly={winsOnly} />,
  );

  it("is hidden in the Wins view, which only shows positive progress", () => {
    card(true);
    expect(screen.getByText("Water the plants")).toBeVisible();
    expect(screen.queryByText(/day streak/)).not.toBeInTheDocument();
  });

  it("still shows in the full feed", () => {
    card(false);
    expect(screen.getByText("🔥 5-day streak")).toBeVisible();
  });
});
