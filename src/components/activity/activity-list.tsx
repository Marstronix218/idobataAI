"use client";

import { Bell, CheckCheck, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { KeyboardEvent, useEffect, useState } from "react";
import { activity as demoActivity } from "@/data/demo";
import { Avatar } from "@/components/ui/avatar";
import { RelativeTime } from "@/components/ui/relative-time";
import { AIBadge } from "@/components/ui/status";
import { apiRequest, errorMessage, isPreviewMode } from "@/lib/client/api";
import type { Notification } from "@/types";

type ActivityItem = Notification & {
  user_profiles: { username: string; avatar_url: string | null } | null;
  social_companions: { name: string; slug: string; avatar_url: string | null } | null;
  social_posts: { content: string; task_title: string | null; content_status: string } | null;
};
type ActivityPage = { items: ActivityItem[]; nextCursor: string | null };
type NotificationFilter = "all" | "unread";

const previewItems: ActivityItem[] = demoActivity.map((item, index) => ({
  id: item.id, user_id: "preview", actor_id: item.ai ? null : `preview-${index}`,
  companion_id: item.ai ? `companion-${index}` : null, post_id: item.postId,
  reply_id: item.text.includes("replied") ? `reply-${index}` : null,
  kind: item.text.includes("replied") ? "reply" : item.text.includes("liked") ? "reaction" : "system",
  read_at: item.id === "4" ? "2026-08-12T10:00:00.000Z" : null,
  created_at: new Date(Date.now() - (index + 1) * 1_800_000).toISOString(),
  user_profiles: item.ai ? null : { username: item.actor, avatar_url: null },
  social_companions: item.ai ? { name: item.actor, slug: item.actor.toLowerCase(), avatar_url: null } : null,
  social_posts: { content: item.detail, task_title: item.detail, content_status: "active" },
}));

function notificationCopy(item: ActivityItem) {
  if (item.kind === "reply") return "replied to your post";
  if (item.kind === "reaction") return "liked your post";
  if (item.kind === "follow") return "requested to follow you";
  return "shared an update about your progress";
}

export function ActivityList() {
  const router = useRouter();
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [items, setItems] = useState<ActivityItem[]>(isPreviewMode ? previewItems : []);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(!isPreviewMode);
  const [status, setStatus] = useState(isPreviewMode ? "Preview notifications are demo data and reset on reload." : "");
  const unread = items.filter((item) => !item.read_at);
  const displayedItems = filter === "unread" ? unread : items;

  async function load({ append = false, signal }: { append?: boolean; signal?: AbortSignal } = {}) {
    if (isPreviewMode) { setStatus("All preview notifications are loaded."); return; }
    setLoading(true); setStatus("");
    try {
      const query = new URLSearchParams({ limit: "30", ...(append && cursor ? { cursor } : {}) });
      const page = await apiRequest<ActivityPage>(`/api/notifications?${query}`, { signal });
      setItems((current) => append ? [...current, ...page.items] : page.items);
      setCursor(page.nextCursor); setStatus(page.items.length ? "Notifications are up to date." : "No notifications yet.");
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setStatus(errorMessage(error));
    } finally { if (!signal?.aborted) setLoading(false); }
  }

  useEffect(() => {
    if (isPreviewMode) return;
    const controller = new AbortController();
    apiRequest<ActivityPage>("/api/notifications?limit=30", { signal: controller.signal })
      .then((page) => { setItems(page.items); setCursor(page.nextCursor); setStatus(page.items.length ? "Notifications are up to date." : "No notifications yet."); })
      .catch((error) => { if (!(error instanceof DOMException && error.name === "AbortError")) setStatus(errorMessage(error)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  async function markRead(ids?: string[]) {
    const targets = ids ?? unread.map((item) => item.id);
    if (!targets.length) return;
    const readAt = new Date().toISOString();
    try {
      if (!isPreviewMode) await apiRequest<{ updated: number }>("/api/notifications", { method: "PATCH", body: JSON.stringify(ids ? { ids } : { all: true }) });
      setItems((current) => current.map((item) => targets.includes(item.id) ? { ...item, read_at: item.read_at ?? readAt } : item));
      setStatus(`${ids ? "Notification marked" : "All notifications marked"} as read.${isPreviewMode ? " Preview only." : ""}`);
    } catch (error) { setStatus(errorMessage(error)); }
  }

  async function openNotification(item: ActivityItem) {
    if (!item.read_at) await markRead([item.id]);
    if (item.kind === "follow" && item.social_companions?.slug) {
      router.push(`/companions/${encodeURIComponent(item.social_companions.slug)}`);
      return;
    }
    if (item.post_id && item.social_posts?.content_status === "active") {
      router.push(`/posts/${encodeURIComponent(item.post_id)}`);
      return;
    }
    if (item.social_companions?.slug) {
      router.push(`/companions/${encodeURIComponent(item.social_companions.slug)}`);
      return;
    }
    if (item.user_profiles?.username) router.push(`/u/${encodeURIComponent(item.user_profiles.username)}`);
  }

  function changeFilter(nextFilter: NotificationFilter) {
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
            <button className="icon-btn border-transparent bg-transparent" aria-label="Mark all notifications as read" disabled={!unread.length || loading} onClick={() => void markRead()}><CheckCheck size={19} /></button>
          </div>
        </div>
        <div className="grid grid-cols-2" role="tablist" aria-label="Notification view">
          <button id="notifications-all-tab" type="button" role="tab" aria-selected={filter === "all"} aria-controls="notifications-panel" tabIndex={filter === "all" ? 0 : -1} onClick={() => changeFilter("all")} onKeyDown={(event) => handleFilterKeyDown(event, "all")} className={`relative min-h-12 text-sm font-bold transition-colors hover:bg-surface/55 ${filter === "all" ? "text-ink" : "text-muted"}`}>All{filter === "all" && <span className="absolute inset-x-[30%] bottom-0 h-1 rounded-full bg-brand" />}</button>
          <button id="notifications-unread-tab" type="button" role="tab" aria-selected={filter === "unread"} aria-controls="notifications-panel" tabIndex={filter === "unread" ? 0 : -1} onClick={() => changeFilter("unread")} onKeyDown={(event) => handleFilterKeyDown(event, "unread")} className={`relative min-h-12 text-sm font-bold transition-colors hover:bg-surface/55 ${filter === "unread" ? "text-ink" : "text-muted"}`}>Unread{unread.length > 0 && <span className="ml-1 text-xs text-brand">{unread.length}</span>}{filter === "unread" && <span className="absolute inset-x-[30%] bottom-0 h-1 rounded-full bg-brand" />}</button>
        </div>
      </header>

      <div id="notifications-panel" role="tabpanel" aria-labelledby={`notifications-${filter}-tab`}>
        {isPreviewMode && <div role="note" className="border-b border-line bg-sun-soft px-4 py-3 text-sm"><strong>Preview mode.</strong> Notifications use demo data and read state resets on reload.</div>}
        {(loading || status) && <p className="border-b border-line px-4 py-2 text-center text-xs font-semibold text-muted" aria-live="polite">{loading ? "Checking for notifications…" : status}</p>}
        {displayedItems.length ? <section aria-label={filter === "unread" ? "Unread notifications" : "Recent notifications"}>{displayedItems.map((item) => {
          const ai = Boolean(item.companion_id); const actor = item.social_companions?.name ?? item.user_profiles?.username ?? "idobataAI";
          const detail = item.social_posts?.task_title ?? item.social_posts?.content ?? (item.kind === "follow" ? "Open this AI persona’s profile to accept or decline." : item.kind === "system" ? "A small streak is growing." : "A shared accomplishment");
          const avatarUrl = item.social_companions?.avatar_url ?? item.user_profiles?.avatar_url ?? null;
          const destination = item.post_id || item.social_companions?.slug || item.user_profiles?.username;
          return <button key={item.id} type="button" onClick={() => void openNotification(item)} aria-label={`${destination ? "Open" : "Mark"} notification from ${actor}${item.read_at ? ". Read" : ""}`} className={`relative flex w-full items-start gap-3 border-b border-line p-4 text-left transition-colors hover:bg-surface/55 sm:p-5 ${item.read_at ? "bg-canvas opacity-80" : "bg-brand-soft/20"}`}><Avatar initials={actor.slice(0, 2).toUpperCase()} ai={ai} avatarUrl={avatarUrl} name={actor} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"><strong>{actor}</strong>{ai && <AIBadge />}<span className="text-muted">{notificationCopy(item)}</span><span className="text-xs text-muted">· <RelativeTime value={item.created_at} /></span></div><p className="mt-2 border-l-2 border-line pl-3 text-sm leading-6 text-muted">{detail}</p></div>{!item.read_at && <span className="absolute right-4 top-5 h-2.5 w-2.5 rounded-full bg-brand"><span className="sr-only">Unread</span></span>}</button>;
        })}</section> : !loading && <div className="border-b border-line px-6 py-14 text-center"><Bell size={26} className="mx-auto text-community" /><h2 className="display mt-4 text-xl font-bold">{filter === "unread" ? "You’re all caught up" : "Quiet for now"}</h2><p className="mt-2 text-sm text-muted">{filter === "unread" ? "New likes, replies, and progress notes will appear here." : "Likes, replies, and progress notes will gather here."}</p></div>}
        {cursor && filter === "all" && <div className="border-b border-line p-4"><button className="btn btn-ghost w-full text-community" onClick={() => void load({ append: true })} disabled={loading}>Show earlier notifications</button></div>}
      </div>
  </div>;
}
