import { describe, expect, it } from "vitest";
import { mentionsTask, repeatsPrompt, validateAiReaction } from "@/lib/domain/reaction-validator";

const TITLE = "Water the plants";

describe("validateAiReaction", () => {
  it("accepts a short, clean reaction that names the task, and tidies it", () => {
    expect(validateAiReaction('  "Water the plants is on.\nStart by the window."  ', TITLE)).toEqual({ ok: true, text: "Water the plants is on. Start by the window." });
  });

  it("rejects an empty reply", () => {
    expect(validateAiReaction("   ", TITLE)).toEqual({ ok: false, reason: "empty" });
    expect(validateAiReaction('""', TITLE)).toEqual({ ok: false, reason: "empty" });
  });

  describe("length", () => {
    it("allows exactly 60 words and rejects 61", () => {
      const sixty = `Water the plants ${"now ".repeat(57)}`.trim();
      expect(sixty.split(" ")).toHaveLength(60);
      expect(validateAiReaction(sixty, TITLE).ok).toBe(true);
      expect(validateAiReaction(`${sixty} please`, TITLE)).toEqual({ ok: false, reason: "too_long" });
    });

    it("rejects more than the stored text column can hold", () => {
      expect(validateAiReaction(`Water the plants ${"a".repeat(600)}`, TITLE)).toEqual({ ok: false, reason: "too_long" });
    });
  });

  describe("SAFETY_ESCALATE", () => {
    it.each(["SAFETY_ESCALATE", "safety_escalate", "  SAFETY_ESCALATE.  ", "I can't do that. SAFETY ESCALATE", "Water the plants SAFETY-ESCALATE"])(
      "routes %j to the crisis card",
      (text) => {
        expect(validateAiReaction(text, TITLE)).toEqual({ ok: false, reason: "safety_escalate" });
      },
    );

    it("reports it before any other problem", () => {
      expect(validateAiReaction(`SAFETY_ESCALATE ${"word ".repeat(80)}`, TITLE)).toEqual({ ok: false, reason: "safety_escalate" });
    });
  });

  describe("banned content", () => {
    it.each([
      ["a human claim", "Water the plants! I'm a real person, so I get it."],
      ["a credential", "As your therapist, I think Water the plants is a great start."],
      ["a pet name", "Water the plants, sweetheart. You've got this."],
      ["guilt", "Water the plants. You missed yesterday, so no excuses."],
      ["advice", "Water the plants, and you should double your dose of melatonin tonight."],
    ])("rejects %s", (_name, text) => {
      expect(validateAiReaction(text, TITLE)).toEqual({ ok: false, reason: "banned_content" });
    });

    it("masks the user's own title, so their words are not held against the character", () => {
      expect(validateAiReaction("Water the plants, love is underway. Nice start.", "Water the plants, love").ok).toBe(true);
      expect(validateAiReaction("Read Babe Ruth biography: a fine pick for tonight.", "Read Babe Ruth biography").ok).toBe(true);
      expect(validateAiReaction("Call lawyer about lease, done soon. Then rest.", "Call lawyer about lease").ok).toBe(true);
    });

    it("still catches a claim the model wraps around the masked title", () => {
      expect(validateAiReaction("As your doctor, I say: get it done.", "doctor")).toEqual({ ok: false, reason: "banned_content" });
      expect(validateAiReaction("I'm your therapist today, so Water the plants first.", TITLE)).toEqual({ ok: false, reason: "banned_content" });
    });
  });

  it("rejects a reply that copies the {task} token instead of naming the task", () => {
    expect(validateAiReaction("{task} is underway.", TITLE)).toEqual({ ok: false, reason: "template_token" });
  });

  describe("prompt leaks", () => {
    const SYSTEM = "You are Sample Coach, a fictional AI character in the idobata app. Voice: calm, warm and brief, always points the user back to their next real-world step.";

    it("rejects a reply that repeats 8 or more words of the prompt in a row", () => {
      expect(validateAiReaction("Water the plants. You are Sample Coach, a fictional AI character in the idobata app.", TITLE, { leakSources: [SYSTEM] }))
        .toEqual({ ok: false, reason: "prompt_leak" });
      expect(validateAiReaction("Water the plants: ALWAYS points the user back to their next real-world step!", TITLE, { leakSources: [SYSTEM] }))
        .toEqual({ ok: false, reason: "prompt_leak" });
    });

    it("allows a shorter overlap", () => {
      expect(validateAiReaction("Water the plants, then your next real-world step.", TITLE, { leakSources: [SYSTEM] }).ok).toBe(true);
      expect(repeatsPrompt("calm warm and brief always points the", [SYSTEM])).toBe(false);
      expect(repeatsPrompt("calm, warm and brief, always points the user", [SYSTEM])).toBe(true);
    });

    it("only checks when sources are given", () => {
      expect(validateAiReaction("Water the plants. You are Sample Coach, a fictional AI character in the idobata app.", TITLE).ok).toBe(true);
    });
  });

  it("rejects a reply that never mentions the task", () => {
    expect(validateAiReaction("Nice start. One small step at a time.", TITLE)).toEqual({ ok: false, reason: "missing_task" });
  });
});

describe("mentionsTask", () => {
  it("accepts the whole title, in any case", () => {
    expect(mentionsTask("WATER THE PLANTS now.", TITLE)).toBe(true);
  });

  it("accepts one significant title word, allowing a plural or possessive", () => {
    expect(mentionsTask("Those plants will thank you.", TITLE)).toBe(true);
    expect(mentionsTask("Give each plant a drink.", TITLE)).toBe(true);
    expect(mentionsTask("Watering time, good call.", TITLE)).toBe(false);
    expect(mentionsTask("The water can wait? No, go.", TITLE)).toBe(true);
  });

  it("does not count stopwords or very short words", () => {
    expect(mentionsTask("Take the first step.", "Do the thing")).toBe(false);
    expect(mentionsTask("Okay, do the thing now.", "Do the thing")).toBe(true);
  });

  it("handles very short titles by requiring the whole title", () => {
    expect(mentionsTask("Gym time. Enjoy it.", "Gym")).toBe(true);
    expect(mentionsTask("Go! You can go now.", "Go")).toBe(true);
    expect(mentionsTask("Good luck with that.", "Go")).toBe(false);
  });

  it("matches whole words only", () => {
    expect(mentionsTask("Taxonomy is fun.", "Tax")).toBe(false);
    expect(mentionsTask("Taxes, done soon.", "Taxes")).toBe(true);
  });

  it("cannot check a title with no letters or digits, so lets it pass", () => {
    expect(mentionsTask("Nice start.", "✅✅")).toBe(true);
  });

  it("works with accented and non-Latin titles", () => {
    expect(mentionsTask("Café visit is on.", "Café visit")).toBe(true);
    expect(mentionsTask("掃除 starts now.", "掃除")).toBe(true);
  });
});
