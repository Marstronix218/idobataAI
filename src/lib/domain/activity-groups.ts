import type { ActivityItem, NotificationKind } from "@/types";

export type ActivityActor = {
  /** Stable identity for de-duplication: one person or persona, however many rows they produced. */
  key: string;
  name: string;
  username: string | null;
  slug: string | null;
  avatarUrl: string | null;
  ai: boolean;
};

export type ActivityGroup = {
  /** The newest member's id, so React keys stay stable as older pages load. */
  id: string;
  /** Every notification folded into this row. Marking it read marks all of them. */
  ids: string[];
  kind: NotificationKind;
  postId: string | null;
  createdAt: string;
  /** Null while any member is unread, so a group never looks read too early. */
  readAt: string | null;
  actors: ActivityActor[];
  /** Representative row, used for the post preview and for routing on open. */
  item: ActivityItem;
};

// Likes and reposts are the high-volume, low-information kinds: ten of them say
// the same thing ten times. Replies, quotes, and follow requests each carry
// their own content or their own decision, so they stay separate rows.
const GROUPED_KINDS = new Set<NotificationKind>(["reaction", "repost"]);

function actorOf(item: ActivityItem): ActivityActor {
  const companion = item.social_companions;
  if (companion) {
    return {
      key: item.companion_id ?? `companion:${companion.slug}`,
      name: companion.name,
      username: null,
      slug: companion.slug,
      avatarUrl: companion.avatar_url,
      ai: true,
    };
  }
  const profile = item.user_profiles;
  const name = profile?.display_name?.trim() || profile?.username || "idobataAI";
  return {
    key: item.actor_id ?? `user:${name}`,
    name,
    username: profile?.username ?? null,
    slug: null,
    avatarUrl: profile?.avatar_url ?? null,
    ai: false,
  };
}

/**
 * Folds a page of notifications into the rows a reader actually wants: one line
 * per post per kind, naming the newest actor and counting the rest.
 *
 * Grouping happens over everything loaded so far rather than server-side, so a
 * group that straddles a page boundary merges once the older page arrives
 * instead of showing up twice. Input order is preserved: a group sits where its
 * newest member sat.
 */
export function groupActivity(items: ActivityItem[]): ActivityGroup[] {
  const groups: ActivityGroup[] = [];
  const byKey = new Map<string, ActivityGroup>();

  for (const item of items) {
    const actor = actorOf(item);
    const key = GROUPED_KINDS.has(item.kind) && item.post_id ? `${item.kind}:${item.post_id}` : null;
    const existing = key ? byKey.get(key) : undefined;

    if (!existing) {
      const group: ActivityGroup = {
        id: item.id,
        ids: [item.id],
        kind: item.kind,
        postId: item.post_id,
        createdAt: item.created_at,
        readAt: item.read_at,
        actors: [actor],
        item,
      };
      groups.push(group);
      if (key) byKey.set(key, group);
      continue;
    }

    existing.ids.push(item.id);
    // A repost toggled off and on again writes a second row for the same
    // person. Counting distinct actors keeps that from reading as two people.
    if (!existing.actors.some((candidate) => candidate.key === actor.key)) existing.actors.push(actor);
    if (!item.read_at) existing.readAt = null;
  }

  return groups;
}

export function activityHeadline(group: ActivityGroup) {
  const verb = {
    reply: "replied to your post",
    reaction: "liked your post",
    repost: "reposted your post",
    quote: "quoted your post",
    follow: "requested to follow you",
    follow_request: "requested to follow you",
    follow_accepted: "accepted your follow request",
    system: "shared an update about your progress",
  }[group.kind];
  const others = group.actors.length - 1;
  if (others <= 0) return verb;
  return `and ${others} ${others === 1 ? "other" : "others"} ${verb}`;
}
