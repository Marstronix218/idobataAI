import { z } from "zod";
import { createChatReply } from "@/lib/server/chat-reply";
import { ApiError, assertDatabase, authed, ok, parseJson, withApi } from "@/lib/server/http";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import type { ChatMessage, ChatThread } from "@/types";

export const maxDuration = 30;

type Context = { params: Promise<{ id: string }> };
const retrySchema = z.object({ messageId: z.uuid() });

export async function POST(request: Request, { params }: Context) {
  return withApi(async () => {
    const { user, supabase } = await authed(request);
    const id = z.uuid().parse((await params).id);
    const { messageId } = await parseJson(request, retrySchema);
    await enforceRateLimit(user.id, "chat:reply-retry", 10, 300);
    const [threadResult, messageResult] = await Promise.all([
      supabase.from("chat_threads").select("*").eq("id", id).single(),
      supabase.from("chat_messages").select("*").eq("id", messageId).eq("thread_id", id).single(),
    ]);
    const thread = assertDatabase(threadResult, true) as ChatThread;
    const message = assertDatabase(messageResult, true) as ChatMessage;
    if (!thread.companion_id || message.sender_user_id !== user.id || message.sender_companion_id) {
      throw new ApiError(404, "Resource not found.", "not_found");
    }

    try {
      const aiMessage = await createChatReply(thread, message);
      return ok({ message, aiMessage, aiReplyPending: false });
    } catch (error) {
      console.error("AI chat reply retry could not be persisted.", error);
      throw new ApiError(503, "The AI reply is still unavailable. Please try again shortly.", "ai_reply_unavailable");
    }
  });
}
