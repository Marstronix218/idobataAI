import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiRequest, push } = vi.hoisted(() => ({ apiRequest: vi.fn(), push: vi.fn() }));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => <a href={href} {...props}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/client/api", () => ({
  apiRequest,
  errorMessage: (error: unknown) => error instanceof Error ? error.message : "Request failed.",
  isPreviewMode: false,
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) } }),
}));

import { Feed, PostCard, previewFeed } from "@/components/social/feed";

describe("Feed production data loading", () => {
  beforeEach(() => {
    apiRequest.mockReset();
    push.mockReset();
    apiRequest.mockImplementation((path: string) => {
      if (path === "/api/profile") return Promise.resolve({ interests: ["Work"] });
      if (path.startsWith("/api/feed")) return Promise.resolve({ items: [], nextCursor: null });
      return Promise.reject(new Error(`Unexpected path: ${path}`));
    });
  });

  it("loads feed posts without requesting a separate progress interstitial", async () => {
    render(<Feed />);
    await screen.findByRole("heading", { name: "No posts here yet." });

    fireEvent.click(screen.getByRole("tab", { name: "People only" }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(
      "/api/feed?scope=people&limit=10",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ));
    expect(apiRequest.mock.calls.some(([path]) => path.startsWith("/api/progress"))).toBe(false);
    expect(screen.queryByText("Up to date · refreshed just now")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Community progress" })).not.toBeInTheDocument();
  });

  // The list feed carries `reply_count` and does not join reply bodies. A card
  // must therefore render from a payload with no replies attached: reading
  // `social_replies.length` on that shape crashed the whole feed route.
  it("renders a post that carries a reply count without reply bodies", async () => {
    apiRequest.mockImplementation((path: string) => {
      if (path === "/api/profile") return Promise.resolve({ interests: ["Work"] });
      if (path.startsWith("/api/feed")) {
        return Promise.resolve({
          items: [{
            id: "11111111-1111-4111-8111-111111111111",
            author_id: "22222222-2222-4222-8222-222222222222",
            companion_id: null,
            task_id: null,
            kind: "human_completion",
            visibility: "public",
            content_status: "active",
            content: "Finished the kitchen shelf.",
            task_title: "Build the shelf",
            category: "Home",
            xp_earned: 10,
            streak: null,
            completed_at: new Date().toISOString(),
            idempotency_key: null,
            source_key: null,
            image_paths: [],
            image_urls: [],
            is_ai_generated: false,
            reply_count: 7,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            user_profiles: { username: "mina", display_name: "Mina", avatar_url: null },
            social_companions: null,
            social_reactions: [],
            // Deliberately absent, not empty: this is the exact payload shape
            // that crashed the feed when the card read `.length` on it.
          }],
          nextCursor: null,
        });
      }
      return Promise.reject(new Error(`Unexpected path: ${path}`));
    });

    render(<Feed />);

    const reply = await screen.findByRole("button", { name: /Reply/ });
    expect(reply).toHaveTextContent("7");
    expect(screen.getByText("Finished the kitchen shelf.")).toBeVisible();
  });

  it("renders a completed-task card without an empty comment body", () => {
    render(<PostCard
      post={{ ...previewFeed[0], content: "", task_title: "Build the shelf", social_reposts: [] }}
      currentUserId={null}
      onChange={vi.fn()}
      onNotice={vi.fn()}
    />);

    const post = screen.getByRole("article");
    expect(screen.getByText("Build the shelf")).toBeVisible();
    expect(post.querySelector("p.leading-7")).toBeNull();
    expect(screen.queryByText("Glad to have this one wrapped up.")).not.toBeInTheDocument();
  });

  it("posts quote commentary with a request key and returns the new feed item", async () => {
    const source = { ...previewFeed[0], author_id: "user-2" };
    const saved = {
      ...source,
      id: "33333333-3333-4333-8333-333333333333",
      author_id: "user-1",
      quoted_post_id: source.id,
      kind: "human_quote" as const,
      content: "Keep this one close.",
      task_title: null,
      category: null,
      social_reactions: undefined,
      social_reposts: undefined,
      social_replies: undefined,
      quoted_post: undefined,
      user_profiles: undefined,
      social_companions: undefined,
      image_urls: undefined,
    };
    apiRequest.mockResolvedValueOnce(saved);
    const onQuoteCreated = vi.fn();
    render(<PostCard
      post={source}
      currentUserId="user-1"
      replyAuthor={{ name: "Mina", username: "mina", avatarUrl: null }}
      onChange={vi.fn()}
      onNotice={vi.fn()}
      onQuoteCreated={onQuoteCreated}
    />);

    fireEvent.click(screen.getByRole("button", { name: /^Repost/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Quote repost" }));
    const dialog = screen.getByRole("dialog", { name: "Quote repost" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Add a comment" }), { target: { value: "Keep this one close." } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Post" }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(`/api/posts/${source.id}/repost`, expect.objectContaining({ method: "POST" })));
    const request = apiRequest.mock.calls[0][1];
    expect(JSON.parse(request.body)).toEqual({
      content: "Keep this one close.",
      visibility: "public",
      idempotencyKey: expect.any(String),
    });
    expect(onQuoteCreated).toHaveBeenCalledWith(expect.objectContaining({
      id: saved.id,
      kind: "human_quote",
      quoted_post: expect.objectContaining({ id: source.id }),
    }));
  });

  it("keeps focus in the quote composer while a failed submission settles", async () => {
    const source = { ...previewFeed[0], author_id: "user-2" };
    let rejectRequest: (error: Error) => void = () => {};
    apiRequest.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectRequest = reject; }));
    render(<PostCard
      post={source}
      currentUserId="user-1"
      replyAuthor={{ name: "Mina", username: "mina", avatarUrl: null }}
      onChange={vi.fn()}
      onNotice={vi.fn()}
    />);
    const trigger = screen.getByRole("button", { name: /^Repost/ });

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "Quote repost" }));
    const dialog = screen.getByRole("dialog", { name: "Quote repost" });
    const comment = within(dialog).getByRole("textbox", { name: "Add a comment" });
    fireEvent.change(comment, { target: { value: "Keep this one close." } });
    comment.focus();
    fireEvent.click(within(dialog).getByRole("button", { name: "Post" }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(1));
    expect(comment).toHaveFocus();
    expect(trigger).not.toHaveFocus();
    rejectRequest(new Error("Quote service unavailable."));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Quote service unavailable.");
    expect(comment).toHaveFocus();
    expect(trigger).not.toHaveFocus();
  });
});
