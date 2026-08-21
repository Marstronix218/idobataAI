import { z } from "zod";
import { getAIProvider } from "@/lib/ai/provider";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertDatabase, authed, ok, parseJson, withApi } from "@/lib/server/http";
import { buildCompanionMemory, companionMemoryBoundary, messagesAfterMemoryReset } from "@/lib/server/companion-memory";
import type { ChatMessage, ChatThread, SocialCompanion } from "@/types";

// The provider is called synchronously here. Without an explicit budget the
// route inherited the platform default of 10s -- shorter than the provider
// timeout it relied on -- so a slow provider killed the function before the
// companion's fallback reply could be substituted.
export const maxDuration = 30;

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
      const [companionResult, historyResult, memoryResult] = await Promise.all([
        supabase.from("social_companions")
          .select("id, name, personality, writing_style, safety_instructions, fallback_replies")
          .eq("id", thread.companion_id)
          .single(),
        supabase.from("chat_messages")
          .select("id, sender_companion_id, content, created_at")
          .eq("thread_id", id)
          .eq("content_status", "active")
          .order("created_at", { ascending: false })
          .limit(12),
        supabase.from("companion_user_memory")
          .select("summary, expires_at, reset_at, version")
          .eq("user_id", message.sender_user_id!)
          .eq("companion_id", thread.companion_id)
          .maybeSingle(),
      ]);
      const companion = assertDatabase(companionResult, true) as Pick<SocialCompanion, "id" | "name" | "personality" | "writing_style" | "safety_instructions" | "fallback_replies">;
      const historyRows = assertDatabase(historyResult) as Array<Pick<ChatMessage, "id" | "sender_companion_id" | "content" | "created_at">>;
      const storedMemory = memoryResult.error ? null : memoryResult.data;
      const memoryExpired = Boolean(storedMemory?.expires_at && new Date(storedMemory.expires_at) <= new Date());
      const relationshipMemory = memoryExpired ? null : storedMemory?.summary ?? null;
      const memoryBoundary = companionMemoryBoundary({
        resetAt: storedMemory?.reset_at,
        expiresAt: storedMemory?.expires_at,
      });
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
          relationshipMemory,
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
      const memoryMessages = messagesAfterMemoryReset(historyRows, memoryBoundary);
      const memory = buildCompanionMemory(memoryMessages);
      if (memory.summary && message.sender_user_id) {
        const expiresAt = new Date();
        expiresAt.setUTCDate(expiresAt.getUTCDate() + 180);
        const { data: refreshed, error: memoryError } = await admin.rpc("refresh_companion_memory", {
          p_user_id: message.sender_user_id,
          p_companion_id: companion.id,
          p_summary: memory.summary,
          p_facts: memory.facts,
          p_source_watermark: memory.sourceWatermark,
          p_expires_at: expiresAt.toISOString(),
          p_expected_version: storedMemory?.version ?? 0,
          p_memory_boundary: memoryBoundary,
        });
        if (memoryError) console.error("Companion memory could not be refreshed.", memoryError);
        else if (!refreshed) console.info("Companion memory changed while this reply was generated; the stale refresh was skipped.");
      }
      return ok({ message, aiMessage, aiReplyPending: false }, { status: 201 });
    } catch (error) {
      console.error("AI chat reply could not be persisted.", error);
      return ok({ message, aiMessage: null, aiReplyPending: true }, { status: 201 });
    }
  });
}
