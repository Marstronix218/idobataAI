"use client";

import { Bell, CheckCheck, Heart, MessageCircle, RefreshCw, Repeat2, Sparkles, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { KeyboardEvent, useEffect, useState } from "react";
import { activity as demoActivity } from "@/data/demo";
import { QuotedPostCard } from "@/components/social/quoted-post-card";
import { Avatar } from "@/components/ui/avatar";
import { RelativeTime } from "@/components/ui/relative-time";
import { AIBadge } from "@/components/ui/status";
import { apiRequest, errorMessage, isPreviewMode } from "@/lib/client/api";
import { activityHeadline, groupActivity, type ActivityGroup } from "@/lib/domain/activity-groups";
import type { ActivityItem, ActivityPost, NotificationKind, QuotedFeedPost } from "@/types";

type ActivityPage = { items: ActivityItem[]; nextCursor: string | null };
type NotificationFilter = "all" | "unread";

// The leading glyph carries the kind at a glance, the way a feed does, so the
// sentence beneath does not have to be read to know what happened.
const kindIcon: Record<NotificationKind, { Icon: typeof Heart; className: string }> = {
  reaction: { Icon: Heart, className: "fill-current text-rose-500" },
  repost: { Icon: Repeat2, className: "text-emerald-500" },
  reply: { Icon: MessageCircle, className: "text-community" },
  quote: { Icon: Repeat2, className: "text-emerald-500" },
  follow: { Icon: UserPlus, className: "text-brand" },
  follow_request: { Icon: UserPlus, className: "text-brand" },
  follow_accepted: { Icon: UserPlus, className: "text-brand" },
  system: { Icon: Sparkles, className: "text-brand" },
};

const MAX_SHOWN_AVATARS = 6;

function previewPost(content: string, taskTitle: string | null, ai: boolean, author: string): ActivityPost {
  return {
    id: `preview-post-${author}`, content, task_title: taskTitle, category: "Work",
    kind: "human_progress", content_status: "active", image_paths: [], image_urls: [],
    created_at: new Date().toISOString(), author_id: ai ? null : "preview-author",
    companion_id: ai ? "preview-companion" : null, visibility: "public",
    user_profiles: ai ? null : { username: author.toLowerCase().replace(/\s+/g, ""), display_name: author, avatar_url: null },
    social_companions: ai ? { name: author, slug: author.toLowerCase().replace(/\s+/g, "-"), avatar_url: null } : null,
    quoted_post: null,
  };
}

const previewItems: ActivityItem[] = demoActivity.map((item, index) => ({
  id: item.id, user_id: "preview", actor_id: item.ai ? null : `preview-${index}`,
  companion_id: item.ai ? `companion-${index}` : null, post_id: item.postId,
  reply_id: item.kind === "reply" ? `reply-${index}` : null,
  kind: item.kind,
  read_at: item.id === "4" ? "2026-08-12T10:00:00.000Z" : null,
  created_at: new Date(Date.now() - (index + 1) * 1_800_000).toISOString(),
  user_profiles: item.ai ? null : { username: item.actor, display_name: item.actor, avatar_url: null },
  social_companions: item.ai ? { name: item.actor, slug: item.actor.toLowerCase(), avatar_url: null } : null,
  social_posts: {
    ...previewPost(item.detail, item.kind === "quote" ? null : item.detail, item.ai, item.actor),
    quoted_post: item.quoted
      ? previewPost(item.quoted.message, item.quoted.task, item.quoted.ai, item.quoted.author)
      : null,
  },
}));

// A quote notification points at the quoting post, whose own `quoted_post` is
// the reader's original. That inner post is what the embedded card renders.
function quotedOriginal(group: ActivityGroup): QuotedFeedPost | null {
  const quoted = group.item.social_posts?.quoted_post;
  return quoted ? { ...quoted, image_urls: quoted.image_urls ?? [] } as QuotedFeedPost : null;
}

function previewDetail(group: ActivityGroup) {
  const post = group.item.social_posts;
  if (group.kind === "quote") return post?.content ?? "";
  if (post?.task_title || post?.content) return post.task_title ?? post.content;
  if (group.kind === "follow") return "Open this AI persona’s profile to accept or decline.";
  if (group.kind === "follow_request") return "Open your follower requests to accept or decline.";
  if (group.kind === "follow_accepted") return "Their protected posts are now on their profile.";
  if (group.kind === "system") return "A small streak is growing.";
  return "A shared accomplishment";
}

function ActivityRow({ group, onOpen }: { group: ActivityGroup; onOpen: () => void }) {
  const { Icon, className: iconClassName } = kindIcon[group.kind];
  const [lead, ...rest] = group.actors;
  const shown = group.actors.slice(0, MAX_SHOWN_AVATARS);
  const quoted = group.kind === "quote" ? quotedOriginal(group) : null;
  const destination = group.postId || lead.slug || lead.username;
  const others = rest.length;

  return <button
    type="button"
    onClick={onOpen}
    aria-label={`${destination ? "Open" : "Mark"} notification from ${lead.name}${others ? ` and ${others} ${others === 1 ? "other" : "others"}` : ""}${group.readAt ? ". Read" : ""}`}
    className={`relative flex w-full items-start gap-3 border-b border-line p-4 text-left transition-colors hover:bg-surface/55 sm:p-5 ${group.readAt ? "bg-canvas opacity-80" : "bg-brand-soft/20"}`}
  >
    <Icon size={20} className={`mt-0.5 shrink-0 ${iconClassName}`} aria-hidden="true" />
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-1.5">
        {shown.map((actor) => <Avatar
          key={actor.key}
          initials={actor.name.slice(0, 2).toUpperCase()}
          ai={actor.ai}
          avatarUrl={actor.avatarUrl}
          name={actor.name}
          size="sm"
        />)}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <strong>{lead.name}</strong>
        {lead.ai && <AIBadge />}
        <span className="text-muted">{activityHeadline(group)}</span>
        <span className="text-xs text-muted"><RelativeTime value={group.createdAt} /></span>
      </div>
      {group.kind === "quote"
        ? <div className="mt-1">
          <p className="text-sm leading-6">{previewDetail(group)}</p>
          {quoted && <QuotedPostCard post={quoted} interactive={false} />}
        </div>
        : <p className="mt-1 text-sm leading-6 text-muted">{previewDetail(group)}</p>}
    </div>
    {!group.readAt && <span className="absolute right-4 top-5 h-2.5 w-2.5 rounded-full bg-brand"><span className="sr-only">Unread</span></span>}
  </button>;
}

export function ActivityList() {
  const router = useRouter();
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [items, setItems] = useState<ActivityItem[]>(isPreviewMode ? previewItems : []);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(!isPreviewMode);
  const [status, setStatus] = useState(isPreviewMode ? "Preview notifications are demo data and reset on reload." : "");
  const [unreadCount, setUnreadCount] = useState(isPreviewMode ? previewItems.filter((item) => !item.read_at).length : 0);
  const visibleUnread = items.filter((item) => !item.read_at);
  const displayedGroups = groupActivity(isPreviewMode && filter === "unread" ? visibleUnread : items);

  async function load({ append = false, signal }: { append?: boolean; signal?: AbortSignal } = {}) {
    if (isPreviewMode) { setStatus("All preview notifications are loaded."); return; }
    setLoading(true); setStatus("");
    try {
      const query = new URLSearchParams({ limit: "30", ...(filter === "unread" ? { unread: "true" } : {}), ...(append && cursor ? { cursor } : {}) });
      const [page, count] = await Promise.all([
        apiRequest<ActivityPage>(`/api/notifications?${query}`, { signal }),
        append ? Promise.resolve(null) : apiRequest<{ unread: number }>("/api/notifications/unread-count", { signal }).catch(() => null),
      ]);
      setItems((current) => append ? [...current, ...page.items] : page.items);
      setCursor(page.nextCursor);
      if (count) setUnreadCount(count.unread);
      setStatus(page.items.length ? "Notifications are up to date." : filter === "unread" ? "No unread notifications." : "No notifications yet.");
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setStatus(errorMessage(error));
    } finally { if (!signal?.aborted) setLoading(false); }
  }

  useEffect(() => {
    if (isPreviewMode) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ limit: "30", ...(filter === "unread" ? { unread: "true" } : {}) });
    Promise.all([
      apiRequest<ActivityPage>(`/api/notifications?${query}`, { signal: controller.signal }),
      apiRequest<{ unread: number }>("/api/notifications/unread-count", { signal: controller.signal }).catch(() => null),
    ])
      .then(([page, count]) => {
        setItems(page.items); setCursor(page.nextCursor);
        if (count) setUnreadCount(count.unread);
        setStatus(page.items.length ? "Notifications are up to date." : filter === "unread" ? "No unread notifications." : "No notifications yet.");
      })
      .catch((error) => { if (!(error instanceof DOMException && error.name === "AbortError")) setStatus(errorMessage(error)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [filter]);

  async function markRead(ids?: string[]) {
    const targets = ids ?? visibleUnread.map((item) => item.id);
    if ((ids && !targets.length) || (!ids && unreadCount === 0)) return;
    const readAt = new Date().toISOString();
    try {
      if (!isPreviewMode) await apiRequest<{ updated: number }>("/api/notifications", { method: "PATCH", body: JSON.stringify(ids ? { ids } : { all: true }) });
      setItems((current) => filter === "unread"
        ? current.filter((item) => !targets.includes(item.id))
        : current.map((item) => targets.includes(item.id) ? { ...item, read_at: item.read_at ?? readAt } : item));
      const nextUnreadCount = ids ? Math.max(0, unreadCount - targets.length) : 0;
      setUnreadCount(nextUnreadCount);
      if (!ids) setCursor(null);
      window.dispatchEvent(new CustomEvent("idobata:notifications-changed", { detail: { unread: nextUnreadCount } }));
      setStatus(`${ids ? "Notification marked" : "All notifications marked"} as read.${isPreviewMode ? " Preview only." : ""}`);
    } catch (error) { setStatus(errorMessage(error)); }
  }

  // Opening a group clears every notification folded into it, so a row cannot
  // come back as unread just because one of its members was never touched.
  async function openGroup(group: ActivityGroup) {
    const unread = group.ids.filter((id) => items.some((item) => item.id === id && !item.read_at));
    if (unread.length) await markRead(unread);
    const item = group.item;
    if (group.kind === "follow" && item.social_companions?.slug) {
      router.push(`/ai-personas/${encodeURIComponent(item.social_companions.slug)}`);
      return;
    }
    if (group.kind === "follow_request") {
      router.push("/follow-requests");
      return;
    }
    if (group.postId && item.social_posts?.content_status === "active") {
      router.push(`/posts/${encodeURIComponent(group.postId)}`);
      return;
    }
    if (item.social_companions?.slug) {
      router.push(`/ai-personas/${encodeURIComponent(item.social_companions.slug)}`);
      return;
    }
    if (item.user_profiles?.username) router.push(`/u/${encodeURIComponent(item.user_profiles.username)}`);
  }

  function changeFilter(nextFilter: NotificationFilter) {
    if (!isPreviewMode && nextFilter !== filter) {
      setItems([]);
      setCursor(null);
      setLoading(true);
      setStatus("");
    }
    setFilter(nextFilter);
  }

  function handleFilterKeyDown(event: KeyboardEvent<HTMLButtonElement>, currentFilter: NotificationFilter) {
    let nextFilter: NotificationFilter | null = null;
    if (event.key === "ArrowRight" || event.key === "End") nextFilter = "unread";
    if (event.key === "ArrowLeft" || event.key === "Home") nextFilter = "all";
    if (!nextFilter || nextFilter === currentFilter) return;
    event.preventDefault();
    changeFilter(nextFilter);
    requestAnimationFrame(() => document.getElementById(`notifications-${nextFilter}-tab`)?.focus());
  }

  return <div className="min-w-0 border-x border-line bg-canvas">
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/88 backdrop-blur-xl">
        <div className="flex min-h-14 items-center justify-between gap-3 px-4">
          <h1 className="display text-xl font-bold">Notifications</h1>
          <div className="flex gap-1">
            <button className="icon-btn border-transparent bg-transparent" aria-label="Refresh notifications" onClick={() => void load()} disabled={loading}><RefreshCw size={18} className={loading ? "animate-spin" : ""} /></button>
            <button className="icon-btn border-transparent bg-transparent" aria-label="Mark all notifications as read" disabled={!unreadCount || loading} onClick={() => void markRead()}><CheckCheck size={19} /></button>
          </div>
        </div>
        <div className="grid grid-cols-2" role="tablist" aria-label="Notification view">
          <button id="notifications-all-tab" type="button" role="tab" aria-selected={filter === "all"} aria-controls="notifications-panel" tabIndex={filter === "all" ? 0 : -1} onClick={() => changeFilter("all")} onKeyDown={(event) => handleFilterKeyDown(event, "all")} className={`relative min-h-12 text-sm font-bold transition-colors hover:bg-surface/55 ${filter === "all" ? "text-ink" : "text-muted"}`}>All{filter === "all" && <span className="absolute inset-x-[30%] bottom-0 h-1 rounded-full bg-brand" />}</button>
          <button id="notifications-unread-tab" type="button" role="tab" aria-selected={filter === "unread"} aria-controls="notifications-panel" tabIndex={filter === "unread" ? 0 : -1} onClick={() => changeFilter("unread")} onKeyDown={(event) => handleFilterKeyDown(event, "unread")} className={`relative min-h-12 text-sm font-bold transition-colors hover:bg-surface/55 ${filter === "unread" ? "text-ink" : "text-muted"}`}>Unread{unreadCount > 0 && <span className="ml-1 text-xs text-brand">{unreadCount}</span>}{filter === "unread" && <span className="absolute inset-x-[30%] bottom-0 h-1 rounded-full bg-brand" />}</button>
        </div>
      </header>

      <div id="notifications-panel" role="tabpanel" aria-labelledby={`notifications-${filter}-tab`}>
        {isPreviewMode && <div role="note" className="border-b border-line bg-sun-soft px-4 py-3 text-sm"><strong>Preview mode.</strong> Notifications use demo data and read state resets on reload.</div>}
        {(loading || status) && <p className="border-b border-line px-4 py-2 text-center text-xs font-semibold text-muted" aria-live="polite">{loading ? "Checking for notifications…" : status}</p>}
        {displayedGroups.length ? <section aria-label={filter === "unread" ? "Unread notifications" : "Recent notifications"}>
          {displayedGroups.map((group) => <ActivityRow key={group.id} group={group} onOpen={() => void openGroup(group)} />)}
        </section> : !loading && <div className="border-b border-line px-6 py-14 text-center"><Bell size={26} className="mx-auto text-community" /><h2 className="display mt-4 text-xl font-bold">{filter === "unread" ? "You’re all caught up" : "Quiet for now"}</h2><p className="mt-2 text-sm text-muted">{filter === "unread" ? "New likes, replies, and progress notes will appear here." : "Likes, replies, and progress notes will gather here."}</p></div>}
        {cursor && <div className="border-b border-line p-4"><button className="btn btn-ghost w-full text-community" onClick={() => void load({ append: true })} disabled={loading}>Show earlier notifications</button></div>}
      </div>
  </div>;
}
