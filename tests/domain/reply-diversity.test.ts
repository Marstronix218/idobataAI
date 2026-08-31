import { describe, expect, it } from "vitest";

import {
  checkReplyDiversity,
  contentSimilarity,
  isGenericPraise,
  sanitizePersonaReply,
} from "@/lib/domain/reply-diversity";

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
  const inCharacter = "Sector secured. Disorder eliminated.";

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

  it.each([
    ["too_long", Array.from({ length: 41 }, () => "word").join(" ")],
    ["too_long", "x".repeat(281)],
    ["multiple_paragraphs", "Room restored.\n\nThe dust has retreated."],
    ["too_many_sentences", "Room restored. Dust defeated. Peace achieved."],
    ["markdown", "**Room restored.**"],
    ["model_artifact", "Reply: Room restored."],
    ["unfinished_sentence", "The room is finally"],
    ["malformed_unicode", "Room restored.\uFFFD"],
  ])("rejects %s output before it can be stored", (reason, content) => {
    expect(checkReplyDiversity({ content })).toMatchObject({ ok: false, reason });
  });

  it("rejects assistant-like task summaries but allows a direct reaction", () => {
    const sourceTexts = ["Cleaned my entire apartment before dinner."];
    expect(checkReplyDiversity({
      content: "You successfully completed the task of cleaning your apartment.",
      sourceTexts,
    })).toMatchObject({ ok: false, reason: "task_summary" });
    expect(checkReplyDiversity({ content: "Okay, the place can breathe again.", sourceTexts }))
      .toMatchObject({ ok: true });
  });

  it("rejects a repeated opening even when the rest of the wording changes", () => {
    expect(checkReplyDiversity({
      content: "Objective secured. Laundry no longer controls the field.",
      personaRecentReplies: ["Objective secured. Extraction can begin."],
    })).toMatchObject({ ok: false, reason: "repeats_persona" });
  });
});

describe("sanitizePersonaReply", () => {
  it("removes control corruption and a dangling non-Latin artifact line", () => {
    expect(sanitizePersonaReply("Domain secured. Project feels real.\u0000\n귀엽"))
      .toBe("Domain secured. Project feels real.");
  });

  it("keeps intentional emoji and decorative voice markers", () => {
    expect(sanitizePersonaReply("You actually finished it!!\n♪"))
      .toBe("You actually finished it!! ♪");
  });
});

describe("persona and task coverage", () => {
  const samples = [
    ["Ren", "studied 60 minutes", "An hour, properly used. Good."],
    ["Rika", "finished essay", "okay fine, the final draft survived 😭"],
    ["Kage", "cleaned room", "Area secured. Disorder eliminated."],
    ["North", "went for a run", "Solid run. Let your legs settle."],
    ["Kumo", "fixed bug", "bug deleted. production may resume pretending to be stable"],
    ["Ember", "cooked dinner", "Dinner's warm. That's the right ending."],
    ["Sora", "practiced drawing", "The lines look less afraid now."],
    ["Orbit", "bought a domain", "Domain acquired. Project legitimacy increased by 43%."],
    ["Hikari", "submitted thesis", "You actually finished it!! Go breathe for a minute ♪"],
    ["Zib", "did laundry", "Textile purification complete. Human nesting conditions improved."],
  ] as const;

  it.each(samples)("accepts a short natural %s reaction to %s", (_persona, task, content) => {
    expect(checkReplyDiversity({ content, sourceTexts: [task] })).toMatchObject({ ok: true });
  });

  it("keeps several personas meaningfully different on the same task", () => {
    const replies = [
      "Domain acquired. Project legitimacy increased by 43%.",
      "okayyy, owning the domain makes it official now 😭",
      "Good. One less loose end.",
      "Objective secured.",
      "It has a home now. That's nice.",
      "congrats, now you have somewhere official to deploy the bugs",
    ];

    for (const reply of replies) {
      expect(checkReplyDiversity({ content: reply, sourceTexts: ["got idobata-ai.com"] }).ok).toBe(true);
    }
    for (let left = 0; left < replies.length; left += 1) {
      for (let right = left + 1; right < replies.length; right += 1) {
        expect(contentSimilarity(replies[left], replies[right])).toBeLessThan(0.4);
      }
    }
  });
});
