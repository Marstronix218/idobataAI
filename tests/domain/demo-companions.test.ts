import { describe, expect, it } from "vitest";

import { AI_DAILY_POST_GOAL, AI_MIN_DAILY_POSTS, companionCompletionPosts } from "@/data/companion-posts";
import { activeCompanions, companions } from "@/data/demo";

const characterEngineSlugs = [
  "hikari-amane", "ren-kurose", "rika-kisaragi", "kai-arata", "mio-spark",
  "lucien-vale", "celeste-ravelle", "vex", "lyra", "aster-7",
];

describe("demo AI profile catalog", () => {
  it("preserves thirty distinct profiles while retiring the generic personas", () => {
    expect(companions).toHaveLength(30);
    expect(new Set(companions.map((companion) => companion.id)).size).toBe(30);
    expect(companions.every((companion) => /^[a-z0-9-]{2,40}$/.test(companion.id))).toBe(true);
    expect(activeCompanions).toHaveLength(27);
    expect(companions.filter((companion) => companion.active === false).map((companion) => companion.id)).toEqual([
      "tempo", "juniper", "lumen",
    ]);
  });

  it("gives every persona a recurring character engine rather than a generic label", () => {
    const characterEngineProfiles = companions.filter((companion) => characterEngineSlugs.includes(companion.id));
    expect(characterEngineProfiles).toHaveLength(10);
    expect(characterEngineProfiles.every((companion) => companion.tagline.length >= 80)).toBe(true);
    expect(characterEngineProfiles.every((companion) => companion.rhythm.length >= 60)).toBe(true);
    expect(new Set(activeCompanions.flatMap((companion) => companion.interests)).size).toBeGreaterThanOrEqual(35);
  });

  it("gives every profile searchable interests and a distinct voice", () => {
    expect(companions.every((companion) => companion.interests.length >= 2)).toBe(true);
    expect(new Set(companions.map((companion) => companion.tagline)).size).toBe(30);
    expect(new Set(companions.map((companion) => companion.rhythm)).size).toBe(30);
  });

  it("gives every revised active persona a premise strong enough to sustain a feed", () => {
    const revisedSlugs = [
      "moss", "north", "orbit", "sora", "pixel", "ember", "kumo", "kage", "akari",
      "nova-reyes", "zib", "solara", "brother-alden", "cipher", "mira-tomorrow", "barnaby-wisp", "rook",
    ];
    const revised = activeCompanions.filter((companion) => revisedSlugs.includes(companion.id));

    expect(revised).toHaveLength(revisedSlugs.length);
    expect(revised.every((companion) => companion.tagline.length >= 100)).toBe(true);
    expect(revised.every((companion) => companion.rhythm.length >= 70)).toBe(true);
  });

  it("gives every profile six distinct tasks with humorous social reactions", () => {
    const actionSummary = /^(completed|finished|sent|closed|cleared|fixed|baked|graded|checked|calibrated|returned|rotated|repotted|folded|illuminated|mended|measured|reshelved)\b/i;
    const genericTask = /^complete today(?:'|’)s .+ task$/i;

    expect(AI_MIN_DAILY_POSTS).toBe(3);
    expect(AI_DAILY_POST_GOAL).toBe(6);
    expect(Object.keys(companionCompletionPosts)).toHaveLength(companions.length);
    for (const companion of companions) {
      const posts = companionCompletionPosts[companion.id];
      expect(posts).toHaveLength(AI_DAILY_POST_GOAL);
      expect(new Set(posts.map((post) => post.taskTitle)).size).toBe(AI_DAILY_POST_GOAL);
      expect(posts.every((post) => companion.interests.includes(post.category))).toBe(true);
      expect(posts.every((post) => !genericTask.test(post.taskTitle))).toBe(true);
      expect(posts.every((post) => !actionSummary.test(post.content))).toBe(true);
      expect(posts.every((post) => post.content.length >= 45 && post.content !== post.taskTitle)).toBe(true);
    }
  });
});
