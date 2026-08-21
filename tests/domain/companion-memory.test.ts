import { describe, expect, it } from "vitest";

import { buildCompanionMemory, companionMemoryBoundary, messagesAfterMemoryReset } from "@/lib/server/companion-memory";

describe("buildCompanionMemory", () => {
  it("keeps only a bounded window of user-authored messages", () => {
    const messages = Array.from({ length: 9 }, (_, index) => ({
      id: `message-${index}`,
      sender_companion_id: index === 2 ? "companion" : null,
      content: `  detail   ${index}  `,
      created_at: `2026-08-20T00:0${index}:00.000Z`,
    }));

    const memory = buildCompanionMemory(messages);
    const facts = memory.facts as { recentUserMessages: Array<{ messageId: string; excerpt: string }> };

    expect(facts.recentUserMessages).toHaveLength(6);
    expect(facts.recentUserMessages.map(({ messageId }) => messageId)).not.toContain("message-2");
    expect(facts.recentUserMessages.at(-1)?.excerpt).toBe("detail 8");
    expect(memory.sourceWatermark).toBe("message-8");
    expect(memory.summary.length).toBeLessThanOrEqual(2000);
  });

  it("does not rebuild cleared memory from messages before the reset barrier", () => {
    const messages = [
      { id: "old", sender_companion_id: null, content: "old detail", created_at: "2026-08-20T10:00:00.000Z" },
      { id: "new", sender_companion_id: null, content: "new detail", created_at: "2026-08-20T10:00:02.000Z" },
    ];

    const memory = buildCompanionMemory(messagesAfterMemoryReset(messages, "2026-08-20T10:00:01.000Z"));
    const facts = memory.facts as { recentUserMessages: Array<{ messageId: string }> };

    expect(facts.recentUserMessages.map(({ messageId }) => messageId)).toEqual(["new"]);
  });

  it("treats an expired retention window as a forget boundary", () => {
    expect(companionMemoryBoundary({
      resetAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-08-01T00:00:00.000Z",
      now: Date.parse("2026-08-20T00:00:00.000Z"),
    })).toBe("2026-08-01T00:00:00.000Z");

    expect(companionMemoryBoundary({
      resetAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-09-01T00:00:00.000Z",
      now: Date.parse("2026-08-20T00:00:00.000Z"),
    })).toBe("2026-01-01T00:00:00.000Z");
  });
});
