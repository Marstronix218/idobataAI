import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => <a href={href} {...props}>{children}</a>,
}));
vi.mock("@/lib/client/api", () => ({
  apiRequest,
  errorMessage: (error: unknown) => error instanceof Error ? error.message : "Request failed.",
  isPreviewMode: false,
}));

import { ReplyThread } from "@/components/social/reply-thread";
import type { ThreadReply } from "@/types";

const POST = "post-1";

function baseReply(overrides: Partial<ThreadReply> & Pick<ThreadReply, "id">): ThreadReply {
  return {
    post_id: POST, parent_reply_id: null, author_id: null, companion_id: null,
    content: "…", content_status: "active", is_ai_generated: false, like_count: 0, reply_count: 0,
    viewer_liked: false, created_at: "2026-08-30T00:00:00.000Z", updated_at: "2026-08-30T00:00:00.000Z",
    user_profiles: null, social_companions: null,
    ...overrides,
  };
}

const personaReply = baseReply({
  id: "reply-rika",
  companion_id: "companion-rika",
  content: "finally, thought that assignment was gonna outlive you",
  is_ai_generated: true,
  social_companions: { name: "Rika", slug: "rika", avatar_url: null },
});

const humanReply = baseReply({
  id: "reply-kenji",
  author_id: "user-2",
  content: "nice one",
  user_profiles: { username: "kenji", display_name: "Kenji", avatar_url: null },
});

/**
 * The thread is a controlled component, so the test owns the list exactly the
 * way the post card does: a reply only appears once the parent has stored it.
 */
function renderThread(initial: ThreadReply[]) {
  const onChange = vi.fn();

  function Host() {
    const [replies, setReplies] = useState(initial);
    return <ReplyThread
      postId={POST}
      replies={replies}
      currentUserId="user-1"
      replyAuthor={{ name: "Mina", username: "mina", avatarUrl: null }}
      onChange={(next) => { onChange(next); setReplies(next); }}
      onNotice={vi.fn()}
    />;
  }

  render(<Host />);
  return { onChange };
}

async function answer(name: string, text: string) {
  fireEvent.click(screen.getAllByRole("button", { name: /^Reply/ })[0]);
  const input = await screen.findByLabelText(`Reply to ${name}`);
  fireEvent.change(input, { target: { value: text } });
  fireEvent.submit(input.closest("form")!);
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  apiRequest.mockReset();
});

describe("answering an AI persona in a thread", () => {
  it("posts the answer against the persona's reply and says a response is coming", async () => {
    apiRequest.mockImplementation((path: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Promise.resolve(baseReply({ id: "reply-mina", parent_reply_id: "reply-rika", author_id: "user-1", content: "it almost did lol" }));
      }
      return Promise.resolve([personaReply]);
    });
    renderThread([personaReply]);

    await answer("Rika", "it almost did lol");

    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(
      `/api/posts/${POST}/replies`,
      expect.objectContaining({ method: "POST", body: JSON.stringify({ content: "it almost did lol", parentReplyId: "reply-rika" }) }),
    ));
    expect(await screen.findByText("Rika is replying…")).toBeVisible();
  });

  it("shows the persona's answer as soon as the thread carries it, then stops waiting", async () => {
    const minaReply = baseReply({ id: "reply-mina", parent_reply_id: "reply-rika", author_id: "user-1", content: "it almost did lol" });
    const rikaFollowUp = baseReply({
      id: "reply-rika-2", parent_reply_id: "reply-mina", companion_id: "companion-rika",
      content: "skill issue. but fine, you won in the end", is_ai_generated: true,
      social_companions: { name: "Rika", slug: "rika", avatar_url: null },
    });
    apiRequest.mockImplementation((path: string, init?: RequestInit) => {
      if (init?.method === "POST") return Promise.resolve(minaReply);
      return Promise.resolve([personaReply, minaReply, rikaFollowUp]);
    });
    const { onChange } = renderThread([personaReply]);

    await answer("Rika", "it almost did lol");
    await screen.findByText("Rika is replying…");

    await vi.advanceTimersByTimeAsync(2500);

    await waitFor(() => expect(onChange).toHaveBeenCalledWith([personaReply, minaReply, rikaFollowUp]));
    await waitFor(() => expect(screen.queryByText("Rika is replying…")).toBeNull());
    // One post plus a single successful poll: the watch stops once the answer
    // is there rather than refetching on every remaining tick.
    expect(apiRequest.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method !== "POST")).toHaveLength(1);
  });

  it("gives up quietly when no answer ever arrives", async () => {
    const minaReply = baseReply({ id: "reply-mina", parent_reply_id: "reply-rika", author_id: "user-1", content: "it almost did lol" });
    apiRequest.mockImplementation((path: string, init?: RequestInit) => {
      if (init?.method === "POST") return Promise.resolve(minaReply);
      return Promise.resolve([personaReply, minaReply]);
    });
    renderThread([personaReply]);

    await answer("Rika", "it almost did lol");
    await screen.findByText("Rika is replying…");

    await vi.advanceTimersByTimeAsync(40_000);

    await waitFor(() => expect(screen.queryByText("Rika is replying…")).toBeNull());
    expect(screen.getByText("it almost did lol")).toBeVisible();
  });

  it("expects nothing back when the answer was addressed to another person", async () => {
    apiRequest.mockImplementation((path: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Promise.resolve(baseReply({ id: "reply-mina", parent_reply_id: "reply-kenji", author_id: "user-1", content: "agreed" }));
      }
      return Promise.resolve([humanReply]);
    });
    renderThread([humanReply]);

    await answer("Kenji", "agreed");

    await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(40_000);

    expect(screen.queryByText(/is replying…/)).toBeNull();
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });
});
