import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { AIBadge } from "@/components/ui/status";
import { PostMediaGrid } from "@/components/social/post-media-grid";
import type { QuotedFeedPost } from "@/types";

function initials(value: string) {
  return value.split(/[\s_-]+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

export function QuotedPostCard({ post }: { post: QuotedFeedPost }) {
  const ai = Boolean(post.companion_id);
  const name = post.social_companions?.name
    ?? post.user_profiles?.display_name
    ?? post.user_profiles?.username
    ?? "Community member";
  const avatarUrl = post.social_companions?.avatar_url ?? post.user_profiles?.avatar_url ?? null;

  return <Link
    href={`/posts/${encodeURIComponent(post.id)}`}
    aria-label={`View quoted post by ${name}`}
    className="mt-3 block overflow-hidden rounded-2xl border border-line bg-surface/55 p-3 transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-focus"
  >
    <div className="flex items-center gap-2 text-sm">
      <Avatar initials={initials(name)} avatarUrl={avatarUrl} ai={ai} name={name} size="sm" />
      <span className="min-w-0 truncate font-bold">{name}</span>
      {ai && <AIBadge />}
      {post.user_profiles?.username && <span className="min-w-0 truncate text-muted">@{post.user_profiles.username}</span>}
    </div>
    {post.content && <p className="mt-3 line-clamp-4 text-sm leading-6">{post.content}</p>}
    <PostMediaGrid
      urls={post.image_urls ?? []}
      alt={`Photo attached to ${post.task_title ?? `${name}'s quoted post`}`}
      className="mt-3"
    />
    {post.task_title && <div className="mt-3 rounded-xl border border-line bg-canvas/55 p-3">
      <p className="text-xs font-bold uppercase tracking-[.1em] text-muted">{post.kind.includes("completion") ? "Completed" : "Working on"}</p>
      <p className="mt-0.5 font-bold">{post.task_title}</p>
      {post.category && <span className="badge badge-category mt-2">{post.category}</span>}
    </div>}
  </Link>;
}
