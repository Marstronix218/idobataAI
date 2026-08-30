"use client";

import Link from "next/link";
import { Heart, MessageCircle, MoreHorizontal } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { RelativeTime } from "@/components/ui/relative-time";
import { AIBadge } from "@/components/ui/status";
import { apiRequest, errorMessage, isPreviewMode } from "@/lib/client/api";
import type { SocialReaction, ThreadReply } from "@/types";

// `username` is carried alongside the display name because a reply row renders
// an @handle: the insert returns the bare row without its author joined, so the
// handle has to come from the signed-in profile the composer already loaded.
export type ReplyAuthor = { name: string; username: string; avatarUrl: string | null };

export function initials(name: string) {
  return name.split(/[\s_-]+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

// Indentation stops here and deeper answers continue at the same inset, the way
// a long back-and-forth flattens on X. Without a cap a ten-deep argument walks
// itself off the right edge of a phone.
const MAX_VISUAL_DEPTH = 4;
// A parent past this many answers collapses to keep one busy sub-thread from
// burying everything under it.
const COLLAPSE_AFTER = 3;
const VISIBLE_WHEN_COLLAPSED = 2;

export type ThreadNode = ThreadReply & { depth: number; children: ThreadNode[] };

/**
 * Rebuilds the parent/child tree the server sends flat.
 *
 * A reply whose parent is missing from the window -- the thread is capped at a
 * fixed number of rows, and a parent can also be hidden by a block or a mute --
 * is promoted to the top level rather than dropped, so no one's answer silently
 * disappears from a conversation they can otherwise see.
 */
export function buildReplyTree(replies: ThreadReply[]): ThreadNode[] {
  const nodes = new Map<string, ThreadNode>();
  for (const reply of replies) nodes.set(reply.id, { ...reply, depth: 0, children: [] });

  const roots: ThreadNode[] = [];
  for (const reply of replies) {
    const node = nodes.get(reply.id)!;
    const parent = reply.parent_reply_id ? nodes.get(reply.parent_reply_id) : undefined;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }

  // Depth is assigned by walking down from the roots, after every link exists,
  // rather than while linking: replies written in one transaction share a
  // timestamp, so a child can arrive before its parent and read a depth that
  // has not been set yet.
  const walk = (node: ThreadNode, depth: number) => {
    node.depth = Math.min(depth, MAX_VISUAL_DEPTH);
    for (const child of node.children) walk(child, depth + 1);
  };
  for (const root of roots) walk(root, 0);

  return roots;
}

function descendantIds(replies: ThreadReply[], rootId: string) {
  const removed = new Set([rootId]);
  // Iterated to a fixpoint rather than in one pass: replies written in the same
  // transaction share a timestamp, so a child is not guaranteed to sort after
  // its parent, and a single pass would leave part of the subtree behind.
  for (let changed = true; changed; ) {
    changed = false;
    for (const reply of replies) {
      if (reply.parent_reply_id && removed.has(reply.parent_reply_id) && !removed.has(reply.id)) {
        removed.add(reply.id);
        changed = true;
      }
    }
  }
  return removed;
}

export function replyIdentity(reply: Pick<ThreadReply, "user_profiles" | "social_companions">) {
  const companion = reply.social_companions;
  const profile = reply.user_profiles;
  return {
    name: companion?.name ?? profile?.display_name?.trim() ?? profile?.username ?? "Community member",
    handle: companion?.slug ?? profile?.username ?? null,
    avatarUrl: companion?.avatar_url ?? profile?.avatar_url ?? null,
    href: companion?.slug ? `/ai-personas/${companion.slug}` : profile?.username ? `/u/${profile.username}` : null,
    ai: Boolean(companion),
  };
}

/**
 * Posts one reply. Shared by the post-level composer and every in-thread
 * composer so a top-level reply and an answer to an answer take exactly the
 * same path, differing only by `parentReplyId`.
 */
export async function postReply(
  { postId, content, parentReplyId, author, currentUserId }:
  { postId: string; content: string; parentReplyId: string | null; author: ReplyAuthor | null; currentUserId: string | null },
): Promise<ThreadReply> {
  const base = isPreviewMode
    ? {
        id: `preview-reply-${postId}-${parentReplyId ?? "root"}-${Math.random().toString(36).slice(2)}`,
        post_id: postId, parent_reply_id: parentReplyId, author_id: currentUserId ?? "preview-user", companion_id: null,
        content, content_status: "active" as const, is_ai_generated: false, like_count: 0, reply_count: 0,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }
    : await apiRequest<Omit<ThreadReply, "user_profiles" | "social_companions" | "viewer_liked">>(
        `/api/posts/${postId}/replies`,
        { method: "POST", body: JSON.stringify({ content, ...(parentReplyId ? { parentReplyId } : {}) }) },
      );

  // The insert returns the bare row, so the author is stitched on from the
  // signed-in profile already loaded for the composer -- otherwise a reply
  // renders as an anonymous blank until the next refetch.
  return {
    ...base,
    like_count: base.like_count ?? 0,
    reply_count: base.reply_count ?? 0,
    viewer_liked: false,
    user_profiles: { username: author?.username ?? "you", display_name: author?.name ?? "You", avatar_url: author?.avatarUrl ?? null },
    social_companions: null,
  };
}

function ReplyComposer({ label, placeholder, author, submitLabel = "Reply", busy, onSubmit, onCancel, autoFocus = false }: {
  label: string; placeholder: string; author: ReplyAuthor | null; submitLabel?: string; busy: boolean;
  onSubmit: (content: string) => void | Promise<void>; onCancel?: () => void; autoFocus?: boolean;
}) {
  const [value, setValue] = useState("");
  const id = `reply-composer-${label.replace(/\W+/g, "-").toLowerCase()}`;

  return <form
    className="mt-2 flex items-center gap-2"
    onSubmit={async (event: FormEvent) => {
      event.preventDefault();
      const content = value.trim();
      if (!content || busy) return;
      await onSubmit(content);
      setValue("");
    }}
  >
    <Avatar size="sm" initials={initials(author?.name ?? "You")} avatarUrl={author?.avatarUrl} name={author?.name ?? "You"} />
    <label className="sr-only" htmlFor={id}>{label}</label>
    <input
      id={id}
      className="field-bare min-h-11 min-w-0 flex-1 rounded-lg px-1 py-2 text-base placeholder:text-muted"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => { if (event.key === "Escape" && onCancel) onCancel(); }}
      maxLength={500}
      placeholder={placeholder}
      autoFocus={autoFocus}
    />
    {onCancel && <button type="button" className="btn btn-ghost shrink-0 rounded-full px-3 text-sm" onClick={onCancel}>Cancel</button>}
    <button type="submit" className="btn btn-community shrink-0 rounded-full px-4 text-sm" disabled={busy || !value.trim()}>
      {busy ? "Replying…" : submitLabel}
    </button>
  </form>;
}

type RowProps = {
  node: ThreadNode;
  currentUserId: string | null;
  replyAuthor: ReplyAuthor | null;
  busyId: string | null;
  replyingTo: string | null;
  setReplyingTo: (id: string | null) => void;
  onLike: (reply: ThreadReply) => void;
  onSubmitReply: (parent: ThreadNode, content: string) => Promise<void>;
  onDelete: (reply: ThreadReply) => void;
  onReport: (reply: ThreadReply) => void;
};

function ReplyRow(props: RowProps) {
  const { node, currentUserId, replyAuthor, busyId, replyingTo, setReplyingTo, onLike, onSubmitReply, onDelete, onReport } = props;
  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { name, handle, avatarUrl, href, ai } = replyIdentity(node);
  const owned = Boolean(currentUserId && node.author_id === currentUserId);
  const busy = busyId === node.id;
  const composing = replyingTo === node.id;

  const collapsed = node.children.length > COLLAPSE_AFTER && !expanded;
  const shownChildren = collapsed ? node.children.slice(0, VISIBLE_WHEN_COLLAPSED) : node.children;
  const hiddenCount = node.children.length - shownChildren.length;
  const showConnector = shownChildren.length > 0 || composing;

  return <article className="flex gap-2.5" aria-label={`Reply by ${name}`}>
    <div className="flex flex-col items-center">
      {href
        ? <Link href={href} aria-label={`View ${name}`}><Avatar size="sm" initials={initials(name)} ai={ai} avatarUrl={avatarUrl} name={name} /></Link>
        : <Avatar size="sm" initials={initials(name)} ai={ai} avatarUrl={avatarUrl} name={name} />}
      {/* The thread line: it runs from under this avatar down past everything
          nested beneath it, so a chain of answers reads as one conversation. */}
      {showConnector && <span aria-hidden="true" className="mt-1.5 w-px flex-1 bg-line" />}
    </div>

    <div className="min-w-0 flex-1 pb-1">
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
          {href ? <Link href={href} className="truncate text-sm font-bold hover:underline">{name}</Link> : <span className="truncate text-sm font-bold">{name}</span>}
          {ai && <AIBadge />}
          {handle && <span className="truncate text-xs text-muted">@{handle}</span>}
          <span className="text-xs text-muted">· <RelativeTime value={node.created_at} /></span>
        </div>
        <div
          className="relative ml-auto shrink-0"
          onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setMenuOpen(false); }}
          onKeyDown={(event) => { if (event.key === "Escape") { setMenuOpen(false); event.currentTarget.querySelector("button")?.focus(); } }}
        >
          <button
            type="button" className="post-menu-trigger h-8 w-8" aria-label={`More actions for ${name}'s reply`}
            aria-expanded={menuOpen} aria-controls={`reply-menu-${node.id}`} onClick={() => setMenuOpen((open) => !open)} disabled={busy}
          ><MoreHorizontal aria-hidden="true" size={16} /></button>
          {menuOpen && <div id={`reply-menu-${node.id}`} role="menu" aria-label={`Actions for ${name}'s reply`} className="absolute right-0 top-9 z-30 min-w-44 overflow-hidden rounded-xl border border-line bg-surface-raised p-1 shadow-lg">
            {owned
              ? <button type="button" role="menuitem" className="btn btn-ghost w-full justify-start px-3 text-sm text-danger" onClick={() => { setMenuOpen(false); onDelete(node); }}>Delete reply</button>
              : <button type="button" role="menuitem" className="btn btn-ghost w-full justify-start px-3 text-sm" onClick={() => { setMenuOpen(false); onReport(node); }}>Report reply</button>}
          </div>}
        </div>
      </div>

      {node.parent_reply_id && node.depth >= MAX_VISUAL_DEPTH && <p className="text-xs text-muted">in this thread</p>}
      <p className="mt-0.5 whitespace-pre-wrap text-[.94rem] leading-6">{node.content}</p>

      <div className="-ml-2 mt-0.5 flex items-center gap-1">
        <button
          type="button" className="btn btn-ghost post-action min-h-9 gap-1.5 px-2 text-xs text-muted"
          aria-expanded={composing} onClick={() => setReplyingTo(composing ? null : node.id)}
        >
          <MessageCircle size={15} aria-hidden="true" /> Reply {node.reply_count > 0 && <span>{node.reply_count}</span>}
        </button>
        <button
          type="button" aria-pressed={node.viewer_liked} disabled={busy}
          className={`btn btn-ghost post-action min-h-9 gap-1.5 px-2 text-xs ${node.viewer_liked ? "bg-brand-soft text-brand" : "text-muted"}`}
          onClick={() => onLike(node)}
        >
          <Heart size={15} aria-hidden="true" fill={node.viewer_liked ? "currentColor" : "none"} /> Like {node.like_count > 0 && <span>{node.like_count}</span>}
        </button>
      </div>

      {composing && <ReplyComposer
        autoFocus
        label={`Reply to ${name}`}
        placeholder={handle ? `Reply to @${handle}` : `Reply to ${name}`}
        author={replyAuthor}
        busy={busy}
        onCancel={() => setReplyingTo(null)}
        onSubmit={(content) => onSubmitReply(node, content)}
      />}

      {shownChildren.length > 0 && <div className="mt-2 space-y-3">
        {shownChildren.map((child) => <ReplyRow key={child.id} {...props} node={child} />)}
      </div>}

      {hiddenCount > 0 && <button type="button" className="btn btn-ghost mt-2 min-h-9 px-2 text-xs font-bold text-community" onClick={() => setExpanded(true)}>
        Show {hiddenCount} more {hiddenCount === 1 ? "reply" : "replies"}
      </button>}
    </div>
  </article>;
}

export function ReplyThread({ postId, replies, currentUserId, replyAuthor, onChange, onNotice }: {
  postId: string;
  replies: ThreadReply[];
  currentUserId: string | null;
  replyAuthor: ReplyAuthor | null;
  onChange: (replies: ThreadReply[]) => void;
  onNotice: (message: string) => void;
}) {
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const tree = useMemo(() => buildReplyTree(replies), [replies]);

  function patch(replyId: string, changes: Partial<ThreadReply>) {
    onChange(replies.map((reply) => reply.id === replyId ? { ...reply, ...changes } : reply));
  }

  async function toggleLike(reply: ThreadReply) {
    if (busyId) return;
    const liked = reply.viewer_liked;
    setBusyId(reply.id);
    patch(reply.id, { viewer_liked: !liked, like_count: Math.max(0, reply.like_count + (liked ? -1 : 1)) });
    try {
      if (!isPreviewMode) {
        if (liked) await apiRequest<void>(`/api/replies/${reply.id}/reactions`, { method: "DELETE" });
        else await apiRequest<SocialReaction>(`/api/replies/${reply.id}/reactions`, { method: "PUT", body: JSON.stringify({ reaction: "like" }) });
      }
    } catch (error) {
      patch(reply.id, { viewer_liked: liked, like_count: reply.like_count });
      onNotice(errorMessage(error));
    } finally { setBusyId(null); }
  }

  async function submitReply(parent: ThreadNode, content: string) {
    if (busyId) return;
    setBusyId(parent.id);
    try {
      const saved = await postReply({ postId, content, parentReplyId: parent.id, author: replyAuthor, currentUserId });
      // The new answer is appended flat and the parent's own count bumped; the
      // tree is derived, so no nested insertion is needed.
      onChange([...replies.map((reply) => reply.id === parent.id ? { ...reply, reply_count: reply.reply_count + 1 } : reply), saved]);
      setReplyingTo(null);
      onNotice(`Reply posted.${isPreviewMode ? " Preview only." : ""}`);
    } catch (error) { onNotice(errorMessage(error)); }
    finally { setBusyId(null); }
  }

  async function deleteReply(reply: ThreadReply) {
    if (busyId) return;
    setBusyId(reply.id);
    try {
      if (!isPreviewMode) await apiRequest<void>(`/api/replies/${reply.id}`, { method: "DELETE" });
      // Deleting a reply cascades to its answers in the database, so the whole
      // subtree has to leave the client too or the children reappear as orphans
      // promoted to the top of the thread.
      const removed = descendantIds(replies, reply.id);
      onChange(replies
        .filter((item) => !removed.has(item.id))
        .map((item) => item.id === reply.parent_reply_id ? { ...item, reply_count: Math.max(0, item.reply_count - 1) } : item));
      onNotice(`Reply deleted.${isPreviewMode ? " Preview only." : ""}`);
    } catch (error) { onNotice(errorMessage(error)); }
    finally { setBusyId(null); }
  }

  async function reportReply(reply: ThreadReply) {
    try {
      if (!isPreviewMode) await apiRequest("/api/reports", { method: "POST", body: JSON.stringify({ replyId: reply.id, reason: "Reported reply from the conversation" }) });
      onNotice(`Reply reported for review.${isPreviewMode ? " Preview only." : ""}`);
    } catch (error) { onNotice(errorMessage(error)); }
  }

  if (!replies.length) return <p className="mt-3 text-sm text-muted">No replies yet. A thoughtful note can go a long way.</p>;

  return <div className="mt-3 space-y-3" aria-label="Conversation">
    {tree.map((node) => <ReplyRow
      key={node.id}
      node={node}
      currentUserId={currentUserId}
      replyAuthor={replyAuthor}
      busyId={busyId}
      replyingTo={replyingTo}
      setReplyingTo={setReplyingTo}
      onLike={(reply) => void toggleLike(reply)}
      onSubmitReply={submitReply}
      onDelete={(reply) => void deleteReply(reply)}
      onReport={(reply) => void reportReply(reply)}
    />)}
  </div>;
}
