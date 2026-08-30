import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { PostCard } from "@/components/social/feed";
import { toQuotedFeedPost } from "@/lib/domain/social-post";
import type { FeedPost } from "@/types";

const now = new Date("2026-08-29T18:00:00.000Z").toISOString();

const humanCompletion: FeedPost = {
  id: "post-human",
  author_id: "user-1",
  companion_id: null,
  task_id: "task-1",
  quoted_post_id: null,
  kind: "human_completion",
  visibility: "public",
  content_status: "active",
  content: "Cleaned my entire apartment.",
  task_title: "Clean the apartment",
  category: "Home",
  xp_earned: 40,
  streak: 3,
  completed_at: now,
  idempotency_key: null,
  source_key: null,
  image_paths: [],
  image_urls: [],
  is_ai_generated: false,
  reply_count: 0,
  created_at: now,
  updated_at: now,
  user_profiles: { username: "mina", display_name: "Mina Mori", avatar_url: null },
  social_companions: null,
  social_reactions: [],
  social_replies: [],
  social_reposts: [],
  quoted_post: null,
};

const personaQuote: FeedPost = {
  ...humanCompletion,
  id: "post-quote",
  author_id: null,
  companion_id: "companion-kage",
  task_id: null,
  quoted_post_id: humanCompletion.id,
  kind: "ai_quote",
  content: "Full territory secured. I acknowledge this operation.",
  task_title: null,
  category: null,
  xp_earned: null,
  streak: null,
  completed_at: null,
  source_key: "quote:engagement-1",
  is_ai_generated: true,
  user_profiles: null,
  social_companions: { name: "Kage", slug: "kage", avatar_url: null },
  quoted_post: toQuotedFeedPost(humanCompletion),
};

function renderQuote(post: FeedPost = personaQuote) {
  return render(<PostCard post={post} currentUserId="user-1" onChange={vi.fn()} onNotice={vi.fn()} />);
}

describe("persona quote repost in the feed", () => {
  it("reads as a post the persona authored, not as a reply", () => {
    renderQuote();

    expect(screen.getByText("Kage")).toBeVisible();
    expect(screen.getByText("AI")).toBeVisible();
    expect(screen.getByText("Quote repost")).toBeVisible();
    expect(screen.getByText("Full territory secured. I acknowledge this operation.")).toBeVisible();
  });

  it("embeds the original completion with its author and task", () => {
    renderQuote();
    const original = screen.getByRole("link", { name: "View quoted post by Mina Mori" });

    expect(within(original).getByText("Cleaned my entire apartment.")).toBeVisible();
    expect(within(original).getByText("Clean the apartment")).toBeVisible();
    expect(within(original).getByText("Completed")).toBeVisible();
    expect(original).toHaveAttribute("href", "/posts/post-human");
  });

  it("stays readable after the quoted completion is deleted", () => {
    renderQuote({ ...personaQuote, quoted_post: null });

    expect(screen.getByText("The quoted post is no longer available.")).toBeVisible();
  });

  it("lets a reader like and reply to the persona's quote itself", () => {
    renderQuote();

    expect(screen.getByRole("button", { name: /Like/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Reply/ })).toBeEnabled();
  });
});
