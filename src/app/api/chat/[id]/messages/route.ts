import { z } from "zod";
import { createChatReply } from "@/lib/server/chat-reply";
import { createAdminClient } from "@/lib/supabase/admin";
import { ApiError, assertDatabase, authed, ok, parseJson, withApi } from "@/lib/server/http";
import type { ChatMessage, ChatThread } from "@/types";

// The provider is called synchronously here. Without an explicit budget the
// route inherited the platform default of 10s -- shorter than the provider
// timeout it relied on -- so a slow provider killed the function before the
// companion's fallback reply could be substituted.
export const maxDuration = 30;

type Context = { params: Promise<{ id: string }> };
const messageSchema = z.object({
  content: z.string().trim().min(1).max(2000),
  requestId: z.uuid(),
});

function betaDailyChatLimit() {
  const parsed = Number.parseInt(process.env.BETA_DAILY_CHAT_LIMIT ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, 10_000) : 100;
}

export async function POST(request: Request, { params }: Context) {
  return withApi(async () => {
    const { user, supabase } = await authed(request);
    const id = z.uuid().parse((await params).id);
    const input = await parseJson(request, messageSchema);
    const thread = assertDatabase(await supabase.from("chat_threads").select("*").eq("id", id).single(), true) as ChatThread;
    const admin = createAdminClient();
    const created = await admin.rpc("create_beta_chat_message", {
      p_user_id: user.id,
      p_thread_id: id,
      p_content: input.content,
      p_client_request_id: input.requestId,
      p_daily_limit: betaDailyChatLimit(),
    });
    if (created.error?.message.includes("daily AI chat limit exceeded")) {
      throw new ApiError(429, "You’ve reached today’s AI chat limit. Try again tomorrow.", "daily_chat_limit");
    }
    const message = assertDatabase(created) as ChatMessage;

    if (!thread.companion_id) return ok({ message, aiMessage: null }, { status: 201 });

    try {
      const aiMessage = await createChatReply(thread, message);
      return ok({ message, aiMessage, aiReplyPending: false }, { status: 201 });
    } catch (error) {
      console.error("AI chat reply could not be persisted.", error);
      return ok({ message, aiMessage: null, aiReplyPending: true }, { status: 201 });
    }
  });
}
