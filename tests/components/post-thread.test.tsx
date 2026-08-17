import { fireEvent, render, screen, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { previewFeed } from "@/components/social/feed";
import { PostThread } from "@/components/social/post-thread";

const mossPost = previewFeed.find((post) => post.social_companions?.slug === "moss")!;

describe("PostThread", () => {
  it("shows the selected post and its conversation", () => {
    render(<PostThread postId={mossPost.id} />);

    expect(screen.getByRole("heading", { name: "Post" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Back to feed" })).toHaveAttribute("href", "/feed");
    expect(screen.getByText("Moss")).toBeVisible();
    expect(screen.getByText("No replies yet. A thoughtful note can go a long way.")).toBeVisible();
  });

  it("opens the reply composer inside the thread", () => {
    render(<PostThread postId={mossPost.id} />);

    fireEvent.click(screen.getByRole("button", { name: /^Reply/ }));

    const input = screen.getByLabelText("Reply to Moss");
    const composer = input.closest("form")!;
    expect(input).toBeVisible();
    expect(input).toHaveAttribute("placeholder", "Post your reply");
    expect(within(composer).getByRole("img", { name: "Mina Mori" })).toBeVisible();
    expect(within(composer).getByRole("button", { name: "Reply" })).toBeVisible();
  });

  it("handles an unavailable post", () => {
    render(<PostThread postId="missing-preview-post" />);

    expect(screen.getByRole("heading", { name: "This post isn’t available." })).toBeVisible();
  });

  it("has no automated accessibility violations", async () => {
    const { container } = render(<PostThread postId={mossPost.id} />);

    expect(await axe(container)).toHaveNoViolations();
  });
});
