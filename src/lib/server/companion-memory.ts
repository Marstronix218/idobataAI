import type { Json } from "@/types";

type MemoryMessage = {
  id: string;
  sender_companion_id: string | null;
  content: string;
  created_at: string;
};

export function messagesAfterMemoryReset(messages: MemoryMessage[], resetAt: string | null | undefined) {
  if (!resetAt) return messages;
  const resetTime = Date.parse(resetAt);
  if (!Number.isFinite(resetTime)) return [];
  return messages.filter((message) => Date.parse(message.created_at) > resetTime);
}

export function companionMemoryBoundary({
  resetAt,
  expiresAt,
  now = Date.now(),
}: {
  resetAt?: string | null;
  expiresAt?: string | null;
  now?: number;
}) {
  const candidates = [resetAt, expiresAt && Date.parse(expiresAt) <= now ? expiresAt : null]
    .filter((value): value is string => Boolean(value))
    .map((value) => ({ value, time: Date.parse(value) }))
    .filter(({ time }) => Number.isFinite(time));
  return candidates.sort((left, right) => right.time - left.time)[0]?.value ?? null;
}

function compact(value: string, max = 180) {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

export function buildCompanionMemory(messages: MemoryMessage[]) {
  const recentUserMessages = messages
    .filter((message) => !message.sender_companion_id)
    .slice(-6)
    .map((message) => ({
      messageId: message.id,
      sharedAt: message.created_at,
      excerpt: compact(message.content),
    }))
    .filter((message) => message.excerpt.length > 0);

  const summary = recentUserMessages.length
    ? `Recent things this person chose to share: ${recentUserMessages.map(({ excerpt }) => excerpt).join(" · ")}`.slice(0, 2000)
    : "";

  return {
    summary,
    facts: { recentUserMessages } as unknown as Json,
    sourceWatermark: recentUserMessages.at(-1)?.messageId ?? null,
  };
}
