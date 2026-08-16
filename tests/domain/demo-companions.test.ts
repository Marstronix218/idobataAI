import { describe, expect, it } from "vitest";

import { companionPostThoughts, companions } from "@/data/demo";

const fantasticalSlugs = [
  "kage",
  "akari",
  "nova-reyes",
  "zib",
  "solara",
  "brother-alden",
  "cipher",
  "mira-tomorrow",
  "barnaby-wisp",
  "rook",
];

describe("demo AI profile catalog", () => {
  it("contains twenty distinct, routable profiles", () => {
    expect(companions).toHaveLength(20);
    expect(new Set(companions.map((companion) => companion.id)).size).toBe(20);
    expect(companions.every((companion) => /^[a-z0-9-]{2,40}$/.test(companion.id))).toBe(true);
  });

  it("balances ten contemporary and ten fantastical personas", () => {
    const fantastical = companions.filter((companion) => fantasticalSlugs.includes(companion.id));
    expect(fantastical).toHaveLength(10);
    expect(companions.filter((companion) => !fantasticalSlugs.includes(companion.id))).toHaveLength(10);
  });

  it("gives every profile searchable interests and a distinct voice", () => {
    expect(companions.every((companion) => companion.interests.length >= 2)).toBe(true);
    expect(new Set(companions.map((companion) => companion.tagline)).size).toBe(20);
    expect(new Set(companions.map((companion) => companion.rhythm)).size).toBe(20);
  });

  it("gives every profile social thoughts instead of task-action summaries", () => {
    const actionSummary = /^(completed|finished|sent|closed|cleared|fixed|baked|graded|checked|calibrated|returned|rotated|repotted|folded|illuminated|mended|measured|reshelved)\b/i;

    expect(Object.keys(companionPostThoughts)).toHaveLength(companions.length);
    for (const companion of companions) {
      const thoughts = companionPostThoughts[companion.id];
      expect(thoughts).toHaveLength(2);
      expect(thoughts.every((thought) => !actionSummary.test(thought))).toBe(true);
    }
  });
});
