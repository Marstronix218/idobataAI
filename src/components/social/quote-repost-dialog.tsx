"use client";

import { FormEvent, type RefObject, useRef, useState } from "react";
import { X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { QuotedPostCard } from "@/components/social/quoted-post-card";
import { useDialog } from "@/lib/client/use-dialog";
import type { PostVisibility, QuotedFeedPost } from "@/types";
import type { ReplyAuthor } from "@/components/social/reply-thread";

export type QuoteRepostInput = { content: string; visibility: PostVisibility };

export function QuoteRepostDialog({
  post,
  author,
  busy,
  error,
  returnFocusRef,
  onClose,
  onSubmit,
}: {
  post: QuotedFeedPost;
  author: ReplyAuthor | null;
  busy: boolean;
  error: string;
  returnFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onSubmit: (input: QuoteRepostInput) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const [content, setContent] = useState("");
  const [visibility, setVisibility] = useState<PostVisibility>("public");
  useDialog(dialogRef, { open: true, onClose, returnFocusRef });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!content.trim() || busy) return;
    await onSubmit({ content: content.trim(), visibility });
  }

  const authorName = author?.name ?? "You";
  const authorInitials = authorName.split(/[\s_-]+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();

  return <div className="fixed inset-0 z-[70] grid place-items-end bg-overlay/70 backdrop-blur-sm sm:place-items-center sm:p-5">
    <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={`quote-repost-title-${post.id}`} className="flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-[1.5rem] border border-line bg-canvas shadow-2xl sm:rounded-[1.5rem]">
      <div className="flex min-h-14 items-center justify-between border-b border-line px-4">
        <button type="button" className="icon-btn border-transparent bg-transparent" aria-label="Close quote repost" onClick={onClose} disabled={busy}><X size={19} /></button>
        <h2 id={`quote-repost-title-${post.id}`} className="font-bold">Quote repost</h2>
        <span className="w-11" aria-hidden="true" />
      </div>
      <form className="overflow-y-auto p-4 sm:p-5" onSubmit={(event) => void submit(event)}>
        <div className="flex items-start gap-3">
          <Avatar initials={authorInitials} avatarUrl={author?.avatarUrl} name={authorName} />
          <div className="min-w-0 flex-1">
            <label htmlFor={`quote-repost-content-${post.id}`} className="sr-only">Add a comment</label>
            <textarea
              id={`quote-repost-content-${post.id}`}
              className="field-bare min-h-28 w-full resize-y py-2 text-base leading-7 placeholder:text-muted"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              maxLength={500}
              placeholder="Add a comment"
              autoFocus
            />
            <div className="flex justify-end text-xs font-semibold text-muted">{content.length}/500</div>
          </div>
        </div>

        <QuotedPostCard post={post} />

        <div className="mt-4 flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-end sm:justify-between">
          <label className="text-sm font-bold text-muted" htmlFor={`quote-repost-visibility-${post.id}`}>
            Audience
            <select
              id={`quote-repost-visibility-${post.id}`}
              className="field mt-1 min-h-11 w-full sm:w-40"
              value={visibility}
              onChange={(event) => setVisibility(event.target.value as PostVisibility)}
              disabled={busy}
            >
              <option value="public">Public</option>
              <option value="private">Private</option>
            </select>
          </label>
          <div className="flex items-center justify-end gap-2">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn btn-community rounded-full px-5" disabled={busy || !content.trim()}>{busy ? "Posting…" : "Post"}</button>
          </div>
        </div>
        {error && <p className="mt-3 text-sm font-semibold text-danger" role="alert">{error}</p>}
      </form>
    </section>
  </div>;
}
