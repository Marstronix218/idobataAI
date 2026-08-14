"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { PostCard, previewFeed } from "@/components/social/feed";
import { apiRequest, errorMessage, isPreviewMode } from "@/lib/client/api";
import { createClient } from "@/lib/supabase/client";
import type { FeedPost } from "@/types";

export function PostThread({ postId }: { postId: string }) {
  const [post, setPost] = useState<FeedPost | null>(() => isPreviewMode ? previewFeed.find((item) => item.id === postId) ?? null : null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(isPreviewMode ? "preview-user" : null);
  const [loading, setLoading] = useState(!isPreviewMode);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (isPreviewMode) return;
    const controller = new AbortController();
    Promise.all([
      apiRequest<FeedPost>(`/api/posts/${encodeURIComponent(postId)}`, { signal: controller.signal }),
      createClient().auth.getUser(),
    ])
      .then(([loadedPost, auth]) => {
        setPost(loadedPost);
        setCurrentUserId(auth.data.user?.id ?? null);
      })
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setStatus(errorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [postId]);

  return <div className="min-w-0 border-x border-line bg-canvas">
    <header className="sticky top-0 z-20 flex min-h-14 items-center gap-4 border-b border-line bg-canvas/88 px-4 backdrop-blur-xl">
      <Link href="/feed" className="icon-btn border-transparent bg-transparent" aria-label="Back to feed"><ArrowLeft size={19} /></Link>
      <h1 className="text-xl font-bold">Post</h1>
    </header>

    {isPreviewMode && <div role="note" className="border-b border-line bg-sun-soft px-4 py-3 text-sm"><strong>Preview mode.</strong> Thread interactions use demo data and reset on reload.</div>}
    {loading ? <div className="border-b border-line p-10 text-center text-muted">Loading conversation…</div> : post ? <PostCard post={post} currentUserId={currentUserId} onChange={setPost} onNotice={setStatus} detail /> : <div className="border-b border-line p-10 text-center"><h2 className="display text-xl font-bold">This post isn’t available.</h2><p className="mt-2 text-sm text-muted">It may have been removed or you may not be able to view it.</p><Link href="/feed" className="btn btn-primary mt-5">Back to feed</Link></div>}
    {status && <p className="border-b border-line px-4 py-3 text-center text-sm font-semibold text-muted" aria-live="polite">{status}</p>}
  </div>;
}
