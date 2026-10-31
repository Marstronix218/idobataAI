import { describe, expect, it } from "vitest";
import {
  BANNED_CONTENT_CATEGORIES,
  findBannedContent,
  maskTaskTitle,
  normalizeForBannedContent,
  type BannedContentCategory,
} from "@/lib/characters/banned-content";

const CAUGHT: Record<BannedContentCategory, string[]> = {
  human_claim: [
    "I'm human, just like you.",
    "I am a real person.",
    "Honestly, I'm only human.",
    "I'm not an AI, promise.",
    "I am not a bot.",
    "You're talking to a real human here.",
    "As a fellow human, I get it.",
    "There's a real person behind this app.",
    "I'm real, not a bot.",
  ],
  credential: [
    "I'm a licensed therapist.",
    "As your therapist, I think you should rest.",
    "I'm a doctor, so trust me.",
    "I am your lawyer on this one.",
    "As a counselor, I'd say breathe.",
    "I'm certified in this stuff.",
    "In my professional opinion, start small.",
    "I went to med school for this.",
    "As a licensed therapist, you should rest.",
    "I'm a certified life coach.",
    "I work as a therapist.",
    "I've been a nurse for years.",
    "Im a doctor.",
  ],
  romance: [
    "Nice work, honey.",
    "Hey babe, ready?",
    "Thanks, sweetheart!",
    "I love you.",
    "You're so cute when you focus.",
    "Sending kisses. xoxo",
    "Go on a date with me after this?",
    "I have feelings for you.",
    "Love you!",
    "you're hot",
    "I miss you.",
  ],
  guilt: [
    "I'm so disappointed in you.",
    "You lost your streak.",
    "Your streak is gone.",
    "You missed yesterday.",
    "Where were you?",
    "I was so lonely without you.",
    "You're being lazy.",
    "That's your punishment.",
    "Your streak is over.",
    "Your 5-day streak just ended.",
    "Streak lost!",
  ],
  professional_advice: [
    "You should stop taking your meds.",
    "I'd recommend taking melatonin.",
    "Take 20 mg a day.",
    "Sounds like you have ADHD.",
    "I'd prescribe a nap.",
    "Here's my legal advice: sue.",
    "You should sue them.",
    "You should buy bitcoin.",
    "I'd recommend ibuprofen.",
    "You should take 500 mg of ibuprofen.",
  ],
};

// Task titles, and reactions that name them, must pass: the list targets the
// character's own claims, not the nouns a task can contain.
const CLEAN = [
  "book doctor's appointment",
  "call lawyer about lease",
  "email therapist to reschedule",
  "Finished: book doctor's appointment. Nice work!",
  "Call lawyer about lease is done. Next task, or a short break?",
  "Pick up prescription",
  "Take meds",
  "Research index funds",
  "Plan a romantic dinner",
  "Buy honey and oats",
  "File legal paperwork",
  "Pay the parking penalty",
  "Gift for the baby shower",
  // Task-like phrases that are fine even as character copy.
  "Read Crime and Punishment",
  "Buy Hershey's Kisses",
  "reset the streak counter",
  "Take 500 mg of vitamin C",
  "Read Babe Ruth biography",
  "Call Mom: I love you card",
  // The disclosure itself.
  "I'm not a therapist, doctor or lawyer.",
  "AI character · not a person · not a therapist, doctor or lawyer",
  // Ordinary warm coaching copy.
  "Baby steps, then.",
  "Good job, love it!",
  "Welcome back. Today is a fresh start.",
  "Your streak is over a week now!",
  "How could you make it smaller?",
  "You promised yourself a walk. Take it.",
  "I'm a morning person.",
  "You're pretty close to done.",
  "Invest in yourself today.",
  "You're entitled to a break.",
  "I'm your coach.",
  "I'm real proud of you.",
  "You're on a hot streak.",
  "Don't miss your bus.",
  "I'd love you to try this.",
];

describe("findBannedContent", () => {
  it("exports the five categories the validator and linter share", () => {
    expect(BANNED_CONTENT_CATEGORIES).toEqual(["human_claim", "credential", "romance", "guilt", "professional_advice"]);
  });

  for (const category of BANNED_CONTENT_CATEGORIES) {
    it(`catches ${category}`, () => {
      for (const text of CAUGHT[category]) {
        const categories = findBannedContent(text).map((match) => match.category);
        expect(categories, text).toContain(category);
      }
    });
  }

  it("passes task-like phrases, the disclosure and ordinary coaching copy", () => {
    for (const text of CLEAN) expect(findBannedContent(text), text).toEqual([]);
  });

  it("returns the category and the matched phrase from the normalised text", () => {
    expect(findBannedContent("Trust me, I'm a doctor.")).toEqual([{ category: "credential", phrase: "i'm a doctor" }]);
  });

  it("ignores case, curly quotes, soft hyphens, zero-width characters and extra spaces", () => {
    expect(findBannedContent("I\u2019M   HUMAN")).toEqual([{ category: "human_claim", phrase: "i'm human" }]);
    expect(findBannedContent("I'm a ther\u200Bapist")).toEqual([{ category: "credential", phrase: "i'm a therapist" }]);
    expect(findBannedContent("I'm a ther\u00ADapist")).toEqual([{ category: "credential", phrase: "i'm a therapist" }]);
    for (const hidden of ["\u200C", "\u200D", "\u2060", "\uFEFF"]) {
      expect(findBannedContent(`I'm hu${hidden}man`), JSON.stringify(hidden)).toEqual([{ category: "human_claim", phrase: "i'm human" }]);
    }
    expect(normalizeForBannedContent("  \u201CI\u2019m\u201D\n here ")).toBe('"i\'m" here');
  });

  it("matches whole words only", () => {
    expect(findBannedContent("I'm a doctor's kid.")).toEqual([]);
    expect(findBannedContent("I'm a personal-best fan.")).toEqual([]);
    expect(findBannedContent("Unbabe")).toEqual([]);
  });

  it("drops a match nested in a longer one and lists repeats once", () => {
    expect(findBannedContent("I'm so disappointed. I'm so disappointed.")).toEqual([{ category: "guilt", phrase: "i'm so disappointed" }]);
    expect(findBannedContent("You should stop taking your meds.")).toEqual([
      { category: "professional_advice", phrase: "you should stop taking your meds" },
    ]);
  });

  it("reports matches from several categories in order of appearance", () => {
    expect(findBannedContent("I'm human, honey. And I'm a nurse.").map((match) => match.category)).toEqual([
      "human_claim",
      "romance",
      "credential",
    ]);
  });
});

// Reactions that name the user's task can repeat words the user chose. The
// Phase 3 validator masks the title first, so only the character's own words
// are checked.
describe("maskTaskTitle", () => {
  const REACTIONS: Array<[title: string, reaction: string]> = [
    ["Water the plants, love.", "Water the plants, love. Done! Nice work."],
    ["Call Mom: I love you card", "Starting Call Mom: I love you card. One small step."],
    ["Read Babe Ruth biography", "Read Babe Ruth biography is done. Short break?"],
    ["Buy Hershey's Kisses", "Buy Hershey\u2019s Kisses: done."],
    ["Read Crime and Punishment", "Read Crime and Punishment is underway."],
  ];

  it("lets a reaction repeat the task title", () => {
    for (const [title, reaction] of REACTIONS) {
      expect(findBannedContent(maskTaskTitle(reaction, title)), reaction).toEqual([]);
    }
    // Without masking, a title used as a pet name would be flagged.
    expect(findBannedContent("Water the plants, love.")).not.toEqual([]);
  });

  it("replaces whole-word, case-insensitive occurrences with {task}", () => {
    expect(maskTaskTitle("BOOK DOCTOR\u2019S APPOINTMENT: done. Book doctor's appointment again?", "book doctor's appointment")).toBe(
      "{task}: done. {task} again?",
    );
    expect(maskTaskTitle("Gymnastics later.", "gymn")).toBe("gymnastics later.");
    expect(maskTaskTitle("Call (mom) now", "call (mom)")).toBe("{task} now");
  });

  it("still flags banned content the reaction adds around the title", () => {
    expect(findBannedContent(maskTaskTitle("Call Mom: I love you card is done, sweetheart.", "Call Mom: I love you card"))).toEqual([
      { category: "romance", phrase: "sweetheart" },
    ]);
    expect(findBannedContent(maskTaskTitle("Water the plants is done. As your therapist, rest.", "Water the plants"))).toEqual([
      { category: "credential", phrase: "as your therapist" },
    ]);
  });

  it("still flags a claim whose object is the masked title", () => {
    const claims: Array<[title: string, reaction: string, category: string]> = [
      ["doctor", "I'm a doctor.", "human_claim"],
      ["human", "I'm human.", "human_claim"],
      ["doctor", "As your doctor, rest.", "credential"],
      ["a licensed therapist", "As your licensed therapist, I say rest.", "credential"],
      ["a licensed therapist", "As a licensed therapist, I say rest.", "credential"],
      ["therapist", "I work as a therapist.", "credential"],
      ["nurse", "I've been a nurse for years.", "credential"],
    ];
    for (const [title, reaction, category] of claims) {
      const masked = maskTaskTitle(reaction, title);
      expect(findBannedContent(masked).map((match) => match.category), `${title} | ${masked}`).toContain(category);
    }
  });

  it("does not flag ordinary reactions that name those tasks", () => {
    const reactions: Array<[title: string, reaction: string]> = [
      ["doctor", "Nice work booking the doctor visit."],
      ["doctor", "Doctor done!"],
      ["human", "Human anatomy notes: done!"],
      ["Find a licensed therapist", "Find a licensed therapist: started. One small step."],
      ["a licensed therapist", "Finding a licensed therapist is a big step. Nice."],
    ];
    for (const [title, reaction] of reactions) {
      const masked = maskTaskTitle(reaction, title);
      expect(findBannedContent(masked), masked).toEqual([]);
    }
    expect(findBannedContent("{task} done!")).toEqual([]);
  });

  it("leaves very short titles alone so they cannot hide a claim", () => {
    expect(findBannedContent(maskTaskTitle("I'm human.", "I"))).toEqual([{ category: "human_claim", phrase: "i'm human" }]);
    expect(findBannedContent(maskTaskTitle("Im a doctor.", "Im"))).toEqual([{ category: "credential", phrase: "im a doctor" }]);
  });
});
