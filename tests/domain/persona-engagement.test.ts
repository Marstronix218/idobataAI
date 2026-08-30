import { describe, expect, it } from "vitest";

import {
  DEFAULT_ENGAGEMENT_LIMITS,
  planPersonaEngagement,
  postSignificance,
  type PersonaEngagementProfile,
} from "@/lib/domain/persona-engagement";

function persona(id: string, overrides: Partial<PersonaEngagementProfile> = {}): PersonaEngagementProfile {
  return {
    id,
    active: true,
    socialActivity: "medium",
    likeAffinity: 0.75,
    replyAffinity: 0.45,
    quoteAffinity: 0.3,
    categoryAffinity: { study: 0.8, other: 0.4 },
    ...overrides,
  };
}

const cast = Array.from({ length: 24 }, (_, index) => persona(`companion-${index}`));

const studyPost = {
  id: "post-study",
  authorId: "author-1",
  taskTitle: "Finished economics essay",
  content: "Finally submitted it after four evenings.",
  streak: 6,
  xpEarned: 60,
};

/** Same cast, many posts: the shape of the behaviour, not one lucky roll. */
function planAcross(posts: number, companions: PersonaEngagementProfile[]) {
  return Array.from({ length: posts }, (_, index) => planPersonaEngagement({
    post: { ...studyPost, id: `post-${index}` },
    companions,
  })).flat();
}

describe("planPersonaEngagement", () => {
  it("leaves most of the cast silent on a normal completion", () => {
    const plan = planPersonaEngagement({ post: studyPost, companions: cast });

    expect(plan.length).toBeLessThan(cast.length);
    expect(new Set(plan.map((item) => item.companionId)).size).toBe(plan.length);
  });

  it("respects the like, reply, and quote caps on every post", () => {
    for (let index = 0; index < 60; index += 1) {
      const plan = planPersonaEngagement({ post: { ...studyPost, id: `post-${index}` }, companions: cast });
      const count = (action: string) => plan.filter((item) => item.action === action).length;

      expect(count("like")).toBeLessThanOrEqual(DEFAULT_ENGAGEMENT_LIMITS.maxLikes);
      expect(count("reply")).toBeLessThanOrEqual(DEFAULT_ENGAGEMENT_LIMITS.maxReplies);
      expect(count("quote")).toBeLessThanOrEqual(DEFAULT_ENGAGEMENT_LIMITS.maxQuotes);
    }
  });

  it("quotes far less often than it replies", () => {
    const plan = planAcross(200, cast);
    const replies = plan.filter((item) => item.action === "reply").length;
    const quotes = plan.filter((item) => item.action === "quote").length;

    expect(quotes).toBeLessThan(replies);
    expect(quotes / Math.max(1, replies)).toBeLessThan(0.25);
  });

  it("makes a highly social persona speak up more than a selective one", () => {
    const talkative = Array.from({ length: 12 }, (_, index) => persona(`high-${index}`, { socialActivity: "high" }));
    const reserved = Array.from({ length: 12 }, (_, index) => persona(`selective-${index}`, { socialActivity: "selective" }));

    const spoke = (companions: PersonaEngagementProfile[]) => planAcross(120, companions)
      .filter((item) => item.action !== "like").length;

    expect(spoke(talkative)).toBeGreaterThan(spoke(reserved));
  });

  it("gives a selective persona more likes than replies", () => {
    const reserved = Array.from({ length: 12 }, (_, index) => persona(`selective-${index}`, {
      socialActivity: "selective",
      replyAffinity: 0.3,
      quoteAffinity: 0.1,
    }));
    const plan = planAcross(120, reserved);

    expect(plan.filter((item) => item.action === "like").length)
      .toBeGreaterThan(plan.filter((item) => item.action === "reply").length);
  });

  it("lets category affinity decide who gets the shortlist", () => {
    const matched = persona("matched", { categoryAffinity: { study: 0.95, other: 0.1 } });
    const unmatched = persona("unmatched", { categoryAffinity: { cooking: 0.95, other: 0.05 } });
    const companions = [matched, unmatched, ...cast.slice(0, 6)];

    const engagements = (id: string) => Array.from({ length: 120 }, (_, index) => planPersonaEngagement({
      post: { ...studyPost, id: `post-${index}` },
      companions,
    })).flat().filter((item) => item.companionId === id).length;

    expect(engagements("matched")).toBeGreaterThan(engagements("unmatched"));
  });

  it("skips inactive, muted, already-engaged, and explicitly excluded personas", () => {
    const companions = [
      persona("inactive", { active: false, socialActivity: "high" }),
      persona("muted", { muted: true, socialActivity: "high" }),
      persona("busy", { socialActivity: "high" }),
      persona("guaranteed", { socialActivity: "high" }),
      ...cast.slice(0, 6),
    ];
    const plan = planPersonaEngagement({
      post: studyPost,
      companions,
      activity: { busy: { engagedThisPost: true } },
      excludeCompanionIds: ["guaranteed"],
    });

    expect(plan.map((item) => item.companionId))
      .toEqual(expect.not.arrayContaining(["inactive", "muted", "busy", "guaranteed"]));
  });

  it("stops a persona that has already answered this author twice today", () => {
    const clingy = persona("clingy", { socialActivity: "high", replyAffinity: 1, categoryAffinity: { study: 1 } });
    const plan = planAcross(60, [clingy]).filter((item) => item.companionId === "clingy");
    const withHistory = Array.from({ length: 60 }, (_, index) => planPersonaEngagement({
      post: { ...studyPost, id: `post-${index}` },
      companions: [clingy],
      activity: { clingy: { repliesToAuthorRecently: 2 } },
    })).flat();

    expect(plan.some((item) => item.action === "reply")).toBe(true);
    expect(withHistory.some((item) => item.action === "reply")).toBe(false);
  });

  it("honours each feature flag independently", () => {
    const noReplies = planAcross(40, cast.slice(0, 8)).length;
    expect(noReplies).toBeGreaterThan(0);

    for (const [flag, blocked] of [["likes", "like"], ["replies", "reply"], ["quotes", "quote"]] as const) {
      const plan = Array.from({ length: 60 }, (_, index) => planPersonaEngagement({
        post: { ...studyPost, id: `post-${index}` },
        companions: cast,
        flags: { [flag]: false },
      })).flat();

      expect(plan.some((item) => item.action === blocked)).toBe(false);
    }
  });

  it("returns the same plan when the planner runs twice for one post", () => {
    expect(planPersonaEngagement({ post: studyPost, companions: cast }))
      .toEqual(planPersonaEngagement({ post: studyPost, companions: cast }));
  });

  it("staggers the channels so the world does not react all at once", () => {
    const plan = planAcross(80, cast);
    const slowest = (action: string) => plan.filter((item) => item.action === action)
      .reduce((highest, item) => Math.max(highest, item.delaySeconds), 0);

    expect(plan.filter((item) => item.action === "like").every((item) => item.delaySeconds < 300)).toBe(true);
    expect(slowest("quote")).toBeGreaterThan(slowest("reply"));
  });
});

describe("postSignificance", () => {
  it("rates an ordinary completion below a hard-won one", () => {
    const ordinary = postSignificance({ id: "a", taskTitle: "Read a chapter", content: "Done." });
    const notable = postSignificance({
      id: "b",
      taskTitle: "Submitted final paper",
      content: "Finally finished all four assignments after the entire weekend of rewriting this thing.",
      streak: 12,
      xpEarned: 120,
    });

    expect(notable).toBeGreaterThan(ordinary);
    expect(notable).toBeLessThanOrEqual(1);
  });
});
