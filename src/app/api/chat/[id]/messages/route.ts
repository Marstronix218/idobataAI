import { z } from "zod";
import { getAIProvider } from "@/lib/ai/provider";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertDatabase, authed, ok, parseJson, withApi } from "@/lib/server/http";
import type { ChatMessage, ChatThread, SocialCompanion } from "@/types";

type Context = { params: Promise<{ id: string }> };
const messageSchema = z.object({ content: z.string().trim().min(1).max(2000) });

function chooseFallback(companion: Pick<SocialCompanion, "name" | "fallback_replies">, content: string) {
  if (!companion.fallback_replies.length) return `I’m here with you. What part of that feels most useful to talk through?`;
  const index = [...content].reduce((sum, character) => sum + character.charCodeAt(0), 0) % companion.fallback_replies.length;
  return companion.fallback_replies[index].replace(/^\s+|\s+$/g, "").slice(0, 2000)
    || `${companion.name} is here and listening.`;
}

export async function POST(request: Request, { params }: Context) {
  return withApi(async () => {
    const { supabase } = await authed(request);
    const id = z.uuid().parse((await params).id);
    const input = await parseJson(request, messageSchema);
    const thread = assertDatabase(await supabase.from("chat_threads").select("*").eq("id", id).single(), true) as ChatThread;
    const message = assertDatabase(await supabase.rpc("create_chat_message", {
      p_thread_id: id,
      p_content: input.content,
    })) as ChatMessage;

    if (!thread.companion_id) return ok({ message, aiMessage: null }, { status: 201 });

    try {
      const companion = assertDatabase(await supabase.from("social_companions")
        .select("id, name, personality, writing_style, safety_instructions, fallback_replies")
        .eq("id", thread.companion_id)
        .single(), true) as Pick<SocialCompanion, "id" | "name" | "personality" | "writing_style" | "safety_instructions" | "fallback_replies">;
      const historyRows = assertDatabase(await supabase.from("chat_messages")
        .select("sender_companion_id, content")
        .eq("thread_id", id)
        .eq("content_status", "active")
        .order("created_at", { ascending: false })
        .limit(12)) as Array<Pick<ChatMessage, "sender_companion_id" | "content">>;
      const history = historyRows.reverse().map((item) => ({
        role: item.sender_companion_id ? "assistant" as const : "user" as const,
        content: item.content,
      }));

      let reply = chooseFallback(companion, input.content);
      try {
        reply = await getAIProvider().generateChatReply({
          companionName: companion.name,
          personality: companion.personality,
          writingStyle: companion.writing_style,
          safetyInstructions: companion.safety_instructions,
          history,
        });
      } catch {
        // The persisted companion fallback keeps chat available when the provider is disabled or unavailable.
      }

      const admin = createAdminClient();
      const aiMessage = assertDatabase(await admin.rpc("create_companion_chat_message", {
        p_thread_id: id,
        p_companion_id: companion.id,
        p_content: reply,
      })) as ChatMessage;
      return ok({ message, aiMessage, aiReplyPending: false }, { status: 201 });
    } catch (error) {
      console.error("AI chat reply could not be persisted.", error);
      return ok({ message, aiMessage: null, aiReplyPending: true }, { status: 201 });
    }
  });
}
