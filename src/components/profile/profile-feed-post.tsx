"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PostCard, type ReplyAuthor } from "@/components/social/feed";
import type { FeedPost } from "@/types";

export function ProfileFeedPost({
  post: initialPost,
  currentUserId,
  replyAuthor,
  repostedBy,
  repostActorId,
}: {
  post: FeedPost;
  currentUserId: string | null;
  replyAuthor?: ReplyAuthor | null;
  repostedBy?: string;
  repostActorId?: string;
}) {
  const router = useRouter();
  const [post, setPost] = useState(initialPost);
  const [notice, setNotice] = useState("");
  const [deleted, setDeleted] = useState(false);

  if (deleted) return notice ? <p className="sr-only" aria-live="polite">{notice}</p> : null;

  return <>
    <p className="sr-only" aria-live="polite">{notice}</p>
    <PostCard
      post={post}
      currentUserId={currentUserId}
      replyAuthor={replyAuthor}
      onChange={setPost}
      onDelete={() => setDeleted(true)}
      onQuoteCreated={() => router.refresh()}
      onRepostChange={(reposted) => { if (!reposted && repostActorId === currentUserId) setDeleted(true); }}
      repostAttribution={repostedBy ? { name: repostedBy } : undefined}
      onNotice={setNotice}
      onOpen={(postId) => router.push(`/posts/${encodeURIComponent(postId)}`)}
    />
  </>;
}
