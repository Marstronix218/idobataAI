import { fireEvent, render, screen, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { PostThread } from "@/components/social/post-thread";
import { previewFeed } from "@/components/social/feed";
import { buildReplyTree, replyIdentity } from "@/components/social/reply-thread";
import type { ThreadReply } from "@/types";

const mossPost = previewFeed.find((post) => post.social_companions?.slug === "moss")!;

function reply(id: string, parentReplyId: string | null): ThreadReply {
  return {
    id, post_id: mossPost.id, parent_reply_id: parentReplyId, author_id: `author-${id}`, companion_id: null,
    content: `reply ${id}`, content_status: "active", is_ai_generated: false, like_count: 0, reply_count: 0,
    viewer_liked: false, created_at: "2026-08-18T00:00:00.000Z", updated_at: "2026-08-18T00:00:00.000Z",
    user_profiles: { username: id, display_name: null, avatar_url: null }, social_companions: null,
  };
}

async function postReplyInThread(text: string) {
  fireEvent.click(screen.getAllByRole("button", { name: /^Reply/ })[0]);
  const input = screen.getByLabelText("Reply to Moss");
  fireEvent.change(input, { target: { value: text } });
  fireEvent.submit(input.closest("form")!);
  await screen.findByText("Reply posted. Preview only.");
}

describe("buildReplyTree", () => {
  it("nests answers under the reply they respond to", () => {
    const tree = buildReplyTree([reply("a", null), reply("b", "a"), reply("c", "b"), reply("d", null)]);

    expect(tree.map((node) => node.id)).toEqual(["a", "d"]);
    expect(tree[0].children.map((node) => node.id)).toEqual(["b"]);
    expect(tree[0].children[0].children.map((node) => node.id)).toEqual(["c"]);
    expect(tree[0].children[0].children[0].depth).toBe(2);
  });

  it("promotes a reply whose parent is outside the loaded window", () => {
    // The thread is capped server-side, and a parent can also be hidden by a
    // block or a mute -- the orphan must still appear, not vanish.
    const tree = buildReplyTree([reply("orphan", "never-loaded")]);

    expect(tree.map((node) => node.id)).toEqual(["orphan"]);
  });

  it("caps how deep the visual indentation goes", () => {
    const chain = ["a", "b", "c", "d", "e", "f", "g"].map((id, index, all) => reply(id, index ? all[index - 1] : null));

    let node = buildReplyTree(chain)[0];
    const depths = [node.depth];
    while (node.children.length) { node = node.children[0]; depths.push(node.depth); }

    expect(depths).toEqual([0, 1, 2, 3, 4, 4, 4]);
  });
});

describe("replyIdentity", () => {
  it("links AI replies to the canonical AI Personas route", () => {
    expect(replyIdentity({
      user_profiles: null,
      social_companions: { name: "Moss", slug: "moss", avatar_url: "/companions/moss.webp" },
    }).href).toBe("/ai-personas/moss");
  });
});

describe("ReplyThread", () => {
  it("shows the replier's avatar, handle and per-reply actions", async () => {
    render(<PostThread postId={mossPost.id} />);
    await postReplyInThread("Great work.");

    const reply = screen.getByRole("article", { name: "Reply by Mina Mori" });
    expect(within(reply).getByRole("img", { name: "Mina Mori" })).toBeVisible();
    expect(within(reply).getByText("@mina")).toBeVisible();
    expect(within(reply).getByText("Great work.")).toBeVisible();
    expect(within(reply).getByRole("button", { name: /^Like/ })).toBeVisible();
    expect(within(reply).getByRole("button", { name: /^Reply/ })).toBeVisible();
  });

  it("likes a reply and toggles the like back off", async () => {
    render(<PostThread postId={mossPost.id} />);
    await postReplyInThread("Great work.");
    const reply = screen.getByRole("article", { name: "Reply by Mina Mori" });

    const like = within(reply).getByRole("button", { name: /^Like/ });
    expect(like).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(like);
    expect(await within(reply).findByRole("button", { name: "Like 1" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(within(reply).getByRole("button", { name: "Like 1" }));
    expect(await within(reply).findByRole("button", { name: "Like" })).toHaveAttribute("aria-pressed", "false");
  });

  it("threads an answer underneath the reply it responds to", async () => {
    render(<PostThread postId={mossPost.id} />);
    await postReplyInThread("Great work.");
    const parent = screen.getByRole("article", { name: "Reply by Mina Mori" });

    fireEvent.click(within(parent).getByRole("button", { name: /^Reply/ }));
    const nested = within(parent).getByLabelText("Reply to Mina Mori");
    expect(nested).toHaveAttribute("placeholder", "Reply to @mina");
    fireEvent.change(nested, { target: { value: "Thanks!" } });
    fireEvent.submit(nested.closest("form")!);

    const answer = await within(parent).findByText("Thanks!");
    // Nested inside the parent article, not a sibling of it.
    expect(answer.closest("article")).not.toBe(parent);
    expect(parent).toContainElement(answer);
    expect(within(parent).getByRole("button", { name: "Reply 1" })).toBeVisible();
  });

  it("deleting a reply removes the answers underneath it", async () => {
    render(<PostThread postId={mossPost.id} />);
    await postReplyInThread("Great work.");
    const parent = screen.getByRole("article", { name: "Reply by Mina Mori" });
    fireEvent.click(within(parent).getByRole("button", { name: /^Reply/ }));
    const nested = within(parent).getByLabelText("Reply to Mina Mori");
    fireEvent.change(nested, { target: { value: "Thanks!" } });
    fireEvent.submit(nested.closest("form")!);
    await within(parent).findByText("Thanks!");

    // Parent and answer share an author here, so target the parent's own trigger.
    fireEvent.click(within(parent).getAllByRole("button", { name: "More actions for Mina Mori's reply" })[0]);
    fireEvent.click(within(parent).getByRole("menuitem", { name: "Delete reply" }));

    expect(await screen.findByText("Reply deleted. Preview only.")).toBeInTheDocument();
    expect(screen.queryByText("Great work.")).not.toBeInTheDocument();
    expect(screen.queryByText("Thanks!")).not.toBeInTheDocument();
  });

  it("has no automated accessibility violations with a thread rendered", async () => {
    const { container } = render(<PostThread postId={mossPost.id} />);
    await postReplyInThread("Great work.");

    expect(await axe(container)).toHaveNoViolations();
  });
});
