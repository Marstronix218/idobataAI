import { describe, expect, it } from "vitest";
import { activityHeadline, groupActivity } from "@/lib/domain/activity-groups";
import type { ActivityItem, NotificationKind } from "@/types";

function item(overrides: Partial<ActivityItem> & { id: string; kind: NotificationKind }): ActivityItem {
  return {
    user_id: "reader", actor_id: null, companion_id: null, post_id: "post-1", reply_id: null,
    read_at: null, created_at: "2026-08-20T12:00:00.000Z",
    user_profiles: null, social_companions: null, social_posts: null,
    ...overrides,
  } as ActivityItem;
}

function human(id: string, kind: NotificationKind, username: string, extra: Partial<ActivityItem> = {}) {
  return item({ id, kind, actor_id: `user-${username}`, user_profiles: { username, avatar_url: null }, ...extra });
}

describe("groupActivity", () => {
  it("folds likes on the same post into one row and keeps the newest actor first", () => {
    const groups = groupActivity([
      human("1", "reaction", "kai"),
      human("2", "reaction", "rin"),
      human("3", "reaction", "sena"),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].actors.map((actor) => actor.name)).toEqual(["kai", "rin", "sena"]);
    expect(groups[0].ids).toEqual(["1", "2", "3"]);
    expect(activityHeadline(groups[0])).toBe("and 2 others liked your post");
  });

  it("keeps likes and reposts on the same post as separate rows", () => {
    const groups = groupActivity([
      human("1", "reaction", "kai"),
      human("2", "repost", "rin"),
    ]);

    expect(groups.map((group) => group.kind)).toEqual(["reaction", "repost"]);
    expect(activityHeadline(groups[1])).toBe("reposted your post");
  });

  it("keeps likes on different posts apart", () => {
    const groups = groupActivity([
      human("1", "reaction", "kai"),
      human("2", "reaction", "rin", { post_id: "post-2" }),
    ]);

    expect(groups).toHaveLength(2);
  });

  it("counts one person once even when a toggled repost wrote two rows", () => {
    const groups = groupActivity([
      human("1", "repost", "kai"),
      human("2", "repost", "kai"),
    ]);

    expect(groups[0].actors).toHaveLength(1);
    expect(groups[0].ids).toEqual(["1", "2"]);
    expect(activityHeadline(groups[0])).toBe("reposted your post");
  });

  it("leaves a group unread while any member is unread", () => {
    const groups = groupActivity([
      human("1", "reaction", "kai", { read_at: "2026-08-20T13:00:00.000Z" }),
      human("2", "reaction", "rin"),
    ]);

    expect(groups[0].readAt).toBeNull();
  });

  it("never folds replies, quotes, or follow requests, which each carry their own content", () => {
    const groups = groupActivity([
      human("1", "reply", "kai"),
      human("2", "reply", "rin"),
      human("3", "quote", "sena"),
      human("4", "quote", "toma"),
      human("5", "follow_request", "uta", { post_id: null }),
      human("6", "follow_request", "yuki", { post_id: null }),
    ]);

    expect(groups).toHaveLength(6);
  });

  it("labels an AI persona actor so the row can badge it", () => {
    const groups = groupActivity([
      item({ id: "1", kind: "reaction", companion_id: "companion-1", social_companions: { name: "Moss", slug: "moss", avatar_url: null } }),
    ]);

    expect(groups[0].actors[0]).toMatchObject({ name: "Moss", slug: "moss", ai: true });
  });

  it("prefers a display name over a username when one is set", () => {
    const groups = groupActivity([
      human("1", "reaction", "kai", { user_profiles: { username: "kai", display_name: "Kai Tanaka", avatar_url: null } }),
    ]);

    expect(groups[0].actors[0].name).toBe("Kai Tanaka");
  });
});
