import "server-only";

import { getAIProvider } from "@/lib/ai/provider";
import { buildCompanionMemory, companionMemoryBoundary, messagesAfterMemoryReset } from "@/lib/server/companion-memory";
import { assertDatabase } from "@/lib/server/http";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ChatMessage, ChatThread, SocialCompanion } from "@/types";

function chooseFallback(companion: Pick<SocialCompanion, "name" | "fallback_replies">, content: string) {
  if (!companion.fallback_replies.length) return "I’m here with you. What part of that feels most useful to talk through?";
  const index = [...content].reduce((sum, character) => sum + character.charCodeAt(0), 0) % companion.fallback_replies.length;
  return companion.fallback_replies[index].trim().slice(0, 2000)
    || `${companion.name} is here and listening.`;
}

export async function createChatReply(thread: ChatThread, userMessage: ChatMessage) {
  if (!thread.companion_id || userMessage.thread_id !== thread.id || !userMessage.sender_user_id) return null;

  const admin = createAdminClient();
  const existing = assertDatabase(await admin.from("chat_messages")
    .select("*")
    .eq("reply_to_message_id", userMessage.id)
    .eq("sender_companion_id", thread.companion_id)
    .maybeSingle()) as ChatMessage | null;
  if (existing) return existing;

  const [companionResult, historyResult, memoryResult] = await Promise.all([
    admin.from("social_companions")
      .select("id, name, personality, writing_style, safety_instructions, fallback_replies")
      .eq("id", thread.companion_id)
      .single(),
    admin.from("chat_messages")
      .select("id, sender_companion_id, content, created_at")
      .eq("thread_id", thread.id)
      .eq("content_status", "active")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(12),
    admin.from("companion_user_memory")
      .select("summary, expires_at, reset_at, version")
      .eq("user_id", userMessage.sender_user_id)
      .eq("companion_id", thread.companion_id)
      .maybeSingle(),
  ]);
  const companion = assertDatabase(companionResult, true) as Pick<SocialCompanion, "id" | "name" | "personality" | "writing_style" | "safety_instructions" | "fallback_replies">;
  const historyRows = (assertDatabase(historyResult) as Array<Pick<ChatMessage, "id" | "sender_companion_id" | "content" | "created_at">>).reverse();
  const storedMemory = memoryResult.error ? null : memoryResult.data;
  const memoryExpired = Boolean(storedMemory?.expires_at && new Date(storedMemory.expires_at) <= new Date());
  const relationshipMemory = memoryExpired ? null : storedMemory?.summary ?? null;
  const memoryBoundary = companionMemoryBoundary({
    resetAt: storedMemory?.reset_at,
    expiresAt: storedMemory?.expires_at,
  });
  const history = historyRows.map((item) => ({
    role: item.sender_companion_id ? "assistant" as const : "user" as const,
    content: item.content,
  }));

  let reply = chooseFallback(companion, userMessage.content);
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
    // The persona's own fallback keeps chat usable during provider outages.
  }

  const aiMessage = assertDatabase(await admin.rpc("create_companion_chat_reply", {
    p_thread_id: thread.id,
    p_companion_id: companion.id,
    p_user_message_id: userMessage.id,
    p_content: reply,
  })) as ChatMessage;
  const memory = buildCompanionMemory(messagesAfterMemoryReset(historyRows, memoryBoundary));
  if (memory.summary) {
    const expiresAt = new Date();
    expiresAt.setUTCDate(expiresAt.getUTCDate() + 180);
    const { data: refreshed, error: memoryError } = await admin.rpc("refresh_companion_memory", {
      p_user_id: userMessage.sender_user_id,
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
  return aiMessage;
}
