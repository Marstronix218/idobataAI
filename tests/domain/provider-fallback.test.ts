import { describe, expect, it, vi } from "vitest";

import {
  fallbackReply,
  resolveAIReply,
} from "@/lib/domain/provider-fallback";

type Companion = Parameters<typeof fallbackReply>[0];
type Context = Parameters<typeof fallbackReply>[1];

const context = {
  taskTitle: "Finished the first draft",
  category: "writing",
} as unknown as Context;

describe("fallbackReply", () => {
  it("returns usable fallback content without a provider", () => {
    const companion = {
      name: "Momo",
      personality: "warm",
    } as unknown as Companion;

    expect(fallbackReply(companion, context).trim().length).toBeGreaterThan(0);
  });

  it("varies fallback content by companion identity", () => {
    const momo = {
      name: "Moss",
      personality: "warm",
    } as unknown as Companion;
    const kai = {
      name: "North",
      personality: "analytical",
    } as unknown as Companion;

    expect(fallbackReply(momo, context)).not.toBe(fallbackReply(kai, context));
  });
});

describe("resolveAIReply", () => {
  it("returns generated content when the provider succeeds", async () => {
    const generate = vi.fn().mockResolvedValue("That first draft is real momentum.");

    await expect(
      resolveAIReply({ generate, fallback: "Fallback encouragement" }),
    ).resolves.toEqual({
      content: "That first draft is real momentum.",
      source: "provider",
    });
  });

  it("preserves fallback content when the provider fails", async () => {
    const generate = vi.fn().mockRejectedValue(new Error("provider unavailable"));

    await expect(
      resolveAIReply({ generate, fallback: "You made meaningful progress." }),
    ).resolves.toEqual({
      content: "You made meaningful progress.",
      source: "fallback",
      error: "provider unavailable",
    });
  });

  it("uses fallback content when the provider returns blank text", async () => {
    const generate = vi.fn().mockResolvedValue("   ");

    await expect(
      resolveAIReply({ generate, fallback: "Small steps still count." }),
    ).resolves.toEqual({
      content: "Small steps still count.",
      source: "fallback",
      error: "Provider returned empty content",
    });
  });
});
