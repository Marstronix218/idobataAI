import { describe, expect, it } from "vitest";

import {
  canPlanPersonaEngagement,
  canViewPost,
  personaEngagementChannels,
} from "@/lib/domain/social-visibility";

type Post = Parameters<typeof canViewPost>[0];

const publicPost = {
  authorId: "user-1",
  visibility: "public",
  contentStatus: "active",
} as unknown as Post;

describe("canViewPost", () => {
  it("allows an authenticated user to view an active public post", () => {
    expect(canViewPost(publicPost, "user-2")).toBe(true);
  });

  it("denies anonymous access to a public post", () => {
    expect(canViewPost(publicPost, null)).toBe(false);
  });

  it("allows the author to view their active private post", () => {
    const privatePost = {
      ...publicPost,
      visibility: "private",
    } as unknown as Post;

    expect(canViewPost(privatePost, "user-1")).toBe(true);
  });

  it("denies another user access to a private post", () => {
    const privatePost = {
      ...publicPost,
      visibility: "private",
    } as unknown as Post;

    expect(canViewPost(privatePost, "user-2")).toBe(false);
  });

  it("denies access to a hidden post", () => {
    const hiddenPost = {
      ...publicPost,
      contentStatus: "hidden",
    } as unknown as Post;

    expect(canViewPost(hiddenPost, "user-1")).toBe(false);
  });

  it("denies access to a removed post", () => {
    const removedPost = {
      ...publicPost,
      contentStatus: "removed",
    } as unknown as Post;

    expect(canViewPost(removedPost, "user-1")).toBe(false);
  });
});

describe("private persona engagement", () => {
  it("lets the service planner consider active private completions", () => {
    expect(canPlanPersonaEngagement({
      kind: "human_completion",
      visibility: "private",
      contentStatus: "active",
    })).toBe(true);
  });

  it("keeps progress posts and inactive completions out of persona planning", () => {
    expect(canPlanPersonaEngagement({
      kind: "human_progress",
      visibility: "private",
      contentStatus: "active",
    })).toBe(false);
    expect(canPlanPersonaEngagement({
      kind: "human_completion",
      visibility: "private",
      contentStatus: "removed",
    })).toBe(false);
  });

  it("allows private likes and replies without allowing outward quote reposts", () => {
    expect(personaEngagementChannels(
      { visibility: "private" },
      { likes: true, replies: true, quotes: true },
    )).toEqual({ likes: true, replies: true, quotes: false });

    expect(personaEngagementChannels(
      { visibility: "public" },
      { likes: true, replies: true, quotes: true },
    )).toEqual({ likes: true, replies: true, quotes: true });
  });
});
