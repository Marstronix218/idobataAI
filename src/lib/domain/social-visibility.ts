export interface ViewablePost {
  authorId: string | null;
  visibility: "public" | "private";
  contentStatus?: "active" | "hidden" | "removed";
}

export interface PersonaEngageablePost {
  kind: string;
  visibility: "public" | "private";
  contentStatus: "active" | "hidden" | "removed";
}

export interface PersonaEngagementChannels {
  likes: boolean;
  replies: boolean;
  quotes: boolean;
}

export function canViewPost(post: ViewablePost, viewerId: string | null): boolean {
  if (!viewerId || (post.contentStatus && post.contentStatus !== "active")) return false;
  return post.visibility === "public" || post.authorId === viewerId;
}

/**
 * Post visibility limits the human audience. It does not hide a completion from
 * the service-owned persona planner, but outward amplification must stay public.
 */
export function canPlanPersonaEngagement(post: PersonaEngageablePost): boolean {
  return post.kind === "human_completion" && post.contentStatus === "active";
}

export function personaEngagementChannels(
  post: Pick<PersonaEngageablePost, "visibility">,
  channels: PersonaEngagementChannels,
): PersonaEngagementChannels {
  return {
    ...channels,
    quotes: post.visibility === "public" && channels.quotes,
  };
}
