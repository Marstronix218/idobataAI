import { describe, expect, it } from "vitest";

import { checkReplyDiversity, contentSimilarity, isGenericPraise } from "@/lib/domain/reply-diversity";

describe("isGenericPraise", () => {
  it("catches the praise that could come from any character", () => {
    expect(isGenericPraise("Great job! You should be proud of yourself!")).toBe(true);
    expect(isGenericPraise("keep it up")).toBe(true);
    expect(isGenericPraise("Amazing work, seriously.")).toBe(true);
  });

  it("leaves an in-character reaction alone", () => {
    expect(isGenericPraise("QUEST COMPLETE: Economics Essay. Reward unlocked: temporary freedom.")).toBe(false);
    expect(isGenericPraise("Finished is finished. Stop looking at it and submit it.")).toBe(false);
  });
});

describe("contentSimilarity", () => {
  it("scores restatements high and different worldviews low", () => {
    expect(contentSimilarity(
      "The apartment is clean now, order restored.",
      "The apartment is clean now, order restored.",
    )).toBe(1);
    expect(contentSimilarity(
      "DUNGEON PURIFIED. Loot quality: improved floor visibility.",
      "Human nesting-area restoration appears to produce extraordinary satisfaction.",
    )).toBeLessThan(0.2);
  });

  it("ignores the connective words every short reply shares", () => {
    expect(contentSimilarity("That is done and it is enough.", "So you did it, and now it is over.")).toBeLessThan(0.3);
  });
});

describe("checkReplyDiversity", () => {
  const inCharacter = "Sector secured. Disorder eliminated. Acceptable work.";

  it("accepts a distinct in-character reply", () => {
    expect(checkReplyDiversity({
      content: inCharacter,
      siblingReplies: ["DUNGEON PURIFIED. Loot quality: improved floor visibility."],
    })).toMatchObject({ ok: true });
  });

  it("rejects generic praise before anything else", () => {
    expect(checkReplyDiversity({ content: "Great job on the room!" }))
      .toMatchObject({ ok: false, reason: "generic_praise" });
  });

  it("rejects a near-duplicate of another persona on the same post", () => {
    expect(checkReplyDiversity({
      content: "Sector secured, disorder eliminated, acceptable work.",
      siblingReplies: [inCharacter],
    })).toMatchObject({ ok: false, reason: "duplicate_of_sibling" });
  });

  it("rejects a persona repeating its own recent wording", () => {
    expect(checkReplyDiversity({
      content: "Objective completed. Maintain operational readiness tomorrow.",
      personaRecentReplies: ["Objective completed. Maintain operational readiness."],
    })).toMatchObject({ ok: false, reason: "repeats_persona" });
  });

  it("holds a sibling on the same post to a stricter bar than an older reply", () => {
    const content = "Objective complete. Disorder eliminated, sector held.";
    const prior = ["Sector secured. Disorder eliminated."];

    // Overlapping enough to read as an echo beside it, not enough to be a tic.
    expect(contentSimilarity(content, prior[0])).toBeGreaterThan(0.4);
    expect(contentSimilarity(content, prior[0])).toBeLessThan(0.55);
    expect(checkReplyDiversity({ content, siblingReplies: prior }).ok).toBe(false);
    expect(checkReplyDiversity({ content, personaRecentReplies: prior }).ok).toBe(true);
  });
});
