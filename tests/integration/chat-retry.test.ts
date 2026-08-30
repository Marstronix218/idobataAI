import { beforeEach, describe, expect, it, vi } from "vitest";

const { authed, createChatReply, enforceRateLimit, parseJson } = vi.hoisted(() => ({
  authed: vi.fn(),
  createChatReply: vi.fn(),
  enforceRateLimit: vi.fn(),
  parseJson: vi.fn(),
}));

vi.mock("@/lib/server/chat-reply", () => ({ createChatReply }));
vi.mock("@/lib/server/rate-limit", () => ({ enforceRateLimit }));
vi.mock("@/lib/server/http", () => ({
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string, public code = "request_error") { super(message); }
  },
  assertDatabase: <T>(result: { data: T; error: unknown }) => {
    if (result.error) throw result.error;
    return result.data;
  },
  authed,
  ok: (data: unknown, init?: ResponseInit) => Response.json({ data }, init),
  parseJson,
  withApi: async (handler: () => Promise<Response>) => handler(),
}));

import { POST } from "@/app/api/chat/[id]/messages/retry/route";

describe("AI chat reply retry route", () => {
  const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const threadId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const companionId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const messageId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const thread = { id: threadId, companion_id: companionId };
  const message = { id: messageId, thread_id: threadId, sender_user_id: userId, sender_companion_id: null };
  const aiMessage = { id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", reply_to_message_id: messageId };

  beforeEach(() => {
    vi.clearAllMocks();
    parseJson.mockResolvedValue({ messageId });
    enforceRateLimit.mockResolvedValue(undefined);
    createChatReply.mockResolvedValue(aiMessage);
    authed.mockResolvedValue({
      user: { id: userId },
      supabase: {
        from: vi.fn((table: string) => {
          const result = table === "chat_threads" ? thread : message;
          const query = {
            select: vi.fn(),
            eq: vi.fn(),
            single: vi.fn().mockResolvedValue({ data: result, error: null }),
          };
          query.select.mockReturnValue(query);
          query.eq.mockReturnValue(query);
          return query;
        }),
      },
    });
  });

  it("rate limits the verified user before regenerating the linked persona reply", async () => {
    const response = await POST(new Request(`http://localhost/api/chat/${threadId}/messages/retry`, {
      method: "POST",
      body: JSON.stringify({ messageId }),
    }), { params: Promise.resolve({ id: threadId }) });

    expect(enforceRateLimit).toHaveBeenCalledWith(userId, "chat:reply-retry", 10, 300);
    expect(createChatReply).toHaveBeenCalledWith(thread, message);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { message, aiMessage, aiReplyPending: false },
    });
  });
});
