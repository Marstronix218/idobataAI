export interface ViewablePost {
  authorId: string | null;
  visibility: "public" | "private";
  contentStatus?: "active" | "hidden" | "removed";
}

export function canViewPost(post: ViewablePost, viewerId: string | null): boolean {
  if (!viewerId || (post.contentStatus && post.contentStatus !== "active")) return false;
  return post.visibility === "public" || post.authorId === viewerId;
}
