import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, ChatThreadDetail, ChatThreadSummary } from "@/types";
import { ChatPanel } from "@/components/chat/chat-panel";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock("@/lib/client/api", () => ({
  apiRequest,
  isPreviewMode: false,
  errorMessage: (error: unknown) => error instanceof Error ? error.message : "Something went wrong.",
}));

const threadId = "10000000-0000-4000-8000-000000000001";
const companionId = "20000000-0000-4000-8000-000000000001";
const userMessageId = "30000000-0000-4000-8000-000000000001";
const now = "2026-08-30T12:00:00.000Z";
const summary: ChatThreadSummary = {
  thread: {
    id: threadId,
    user_one_id: "40000000-0000-4000-8000-000000000001",
    user_two_id: null,
    companion_id: companionId,
    created_by: "40000000-0000-4000-8000-000000000001",
    last_message_preview: "Please help me plan this.",
    last_sender_user_id: "40000000-0000-4000-8000-000000000001",
    last_sender_companion_id: null,
    last_message_at: now,
    created_at: now,
    updated_at: now,
  },
  peer: {
    id: companionId,
    kind: "companion",
    name: "Moss",
    handle: "moss",
    avatarUrl: null,
    description: "A patient forest spirit.",
  },
};

function userMessage(clientRequestId = "50000000-0000-4000-8000-000000000001"): ChatMessage {
  return {
    id: userMessageId,
    thread_id: threadId,
    sender_user_id: summary.thread.user_one_id,
    sender_companion_id: null,
    client_request_id: clientRequestId,
    reply_to_message_id: null,
    content: "Please help me plan this.",
    content_status: "active",
    is_ai_generated: false,
    created_at: now,
    updated_at: now,
  };
}

function detail(messages: ChatMessage[]): ChatThreadDetail {
  return { ...summary, messages };
}

describe("ChatPanel reliability", () => {
  beforeEach(() => {
    apiRequest.mockReset();
  });

  it("restores a persisted pending AI reply and retries it without resending the user message", async () => {
    const pending = userMessage();
    const reply: ChatMessage = {
      ...pending,
      id: "60000000-0000-4000-8000-000000000001",
      sender_user_id: null,
      sender_companion_id: companionId,
      client_request_id: null,
      reply_to_message_id: pending.id,
      content: "Let’s make the first step small enough to begin.",
      is_ai_generated: true,
    };
    apiRequest.mockImplementation((path: string) => {
      if (path === "/api/chat") return Promise.resolve({ items: [summary] });
      if (path === `/api/chat/${threadId}`) return Promise.resolve(detail([pending]));
      if (path === `/api/chat/${threadId}/messages/retry`) return Promise.resolve({ message: pending, aiMessage: reply, aiReplyPending: false });
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    render(<ChatPanel />);
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(`/api/chat/${threadId}`, expect.objectContaining({ signal: expect.any(AbortSignal) })), { timeout: 5_000 });
    const retry = await screen.findByRole("button", { name: "Retry AI reply" }, { timeout: 5_000 });
    fireEvent.click(retry);

    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(`/api/chat/${threadId}/messages/retry`, {
      method: "POST",
      body: JSON.stringify({ messageId: pending.id }),
    }));
    expect(await screen.findAllByText(reply.content)).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Retry AI reply" })).not.toBeInTheDocument();
    expect(screen.getAllByText(pending.content)).toHaveLength(1);
  }, 15_000);

  it("reuses the same request UUID after a failed send", async () => {
    let sendAttempts = 0;
    const requestIds: string[] = [];
    apiRequest.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/api/chat") return Promise.resolve({ items: [summary] });
      if (path === `/api/chat/${threadId}`) return Promise.resolve(detail([]));
      if (path === `/api/chat/${threadId}/messages`) {
        sendAttempts += 1;
        const body = JSON.parse(String(init?.body)) as { content: string; requestId: string };
        requestIds.push(body.requestId);
        if (sendAttempts === 1) return Promise.reject(new Error("Connection interrupted."));
        const saved = { ...userMessage(body.requestId), content: body.content };
        return Promise.resolve({ message: saved, aiMessage: null, aiReplyPending: true });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    render(<ChatPanel />);
    const composer = await screen.findByLabelText("Message Moss");
    fireEvent.change(composer, { target: { value: "Please help me plan this." } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await screen.findByText("Connection interrupted.");
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await screen.findByRole("button", { name: "Retry AI reply" });
    expect(requestIds).toHaveLength(2);
    expect(requestIds[0]).toMatch(/^[0-9a-f-]{36}$/i);
    expect(requestIds[1]).toBe(requestIds[0]);
  });
});
