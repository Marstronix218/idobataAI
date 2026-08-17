"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PostCard } from "@/components/social/feed";
import type { FeedPost } from "@/types";

export function ProfileFeedPost({
  post: initialPost,
  currentUserId,
}: {
  post: FeedPost;
  currentUserId: string | null;
}) {
  const router = useRouter();
  const [post, setPost] = useState(initialPost);
  const [notice, setNotice] = useState("");
  const [deleted, setDeleted] = useState(false);

  if (deleted) return null;

  return <>
    <p className="sr-only" aria-live="polite">{notice}</p>
    <PostCard
      post={post}
      currentUserId={currentUserId}
      onChange={setPost}
      onDelete={() => setDeleted(true)}
      onNotice={setNotice}
      onOpen={(postId) => router.push(`/posts/${encodeURIComponent(postId)}`)}
    />
  </>;
}
