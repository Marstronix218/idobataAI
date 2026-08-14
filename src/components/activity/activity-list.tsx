"use client";

import { Bell, CheckCheck, Flame, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { activity as demoActivity } from "@/data/demo";
import { Avatar } from "@/components/ui/avatar";
import { AIBadge } from "@/components/ui/status";
import { apiRequest, errorMessage, isPreviewMode } from "@/lib/client/api";
import type { Notification } from "@/types";

type ActivityItem = Notification & {
  user_profiles: { username: string; avatar_url: string | null } | null;
  social_companions: { name: string; slug: string; avatar_url: string | null } | null;
  social_posts: { content: string; task_title: string | null; content_status: string } | null;
};
type ActivityPage = { items: ActivityItem[]; nextCursor: string | null };

const previewItems: ActivityItem[] = demoActivity.map((item, index) => ({
  id: item.id, user_id: "preview", actor_id: item.ai ? null : `preview-${index}`,
  companion_id: item.ai ? `companion-${index}` : null, post_id: index < 3 ? `post-${index}` : null,
  reply_id: item.text.includes("replied") ? `reply-${index}` : null,
  kind: item.text.includes("replied") ? "reply" : item.text.includes("Respect") || item.text.includes("Cheer") ? "reaction" : "system",
  read_at: item.id === "4" ? "2026-08-12T10:00:00.000Z" : null,
  created_at: new Date(Date.now() - (index + 1) * 1_800_000).toISOString(),
  user_profiles: item.ai ? null : { username: item.actor, avatar_url: null },
  social_companions: item.ai ? { name: item.actor, slug: item.actor.toLowerCase(), avatar_url: null } : null,
  social_posts: { content: item.detail, task_title: item.detail, content_status: "active" },
}));

function relativeTime(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}

function notificationCopy(item: ActivityItem) {
  if (item.kind === "reply") return "replied to your post";
  if (item.kind === "reaction") return "encouraged your post";
  return "shared an update about your progress";
}

export function ActivityList() {
  const [items, setItems] = useState<ActivityItem[]>(isPreviewMode ? previewItems : []);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(!isPreviewMode);
  const [status, setStatus] = useState(isPreviewMode ? "Preview activity is demo data and will reset on reload." : "");
  const unread = items.filter((item) => !item.read_at);

  async function load({ append = false, signal }: { append?: boolean; signal?: AbortSignal } = {}) {
    if (isPreviewMode) { setStatus("All preview activity is loaded."); return; }
    setLoading(true); setStatus("");
    try {
      const query = new URLSearchParams({ limit: "30", ...(append && cursor ? { cursor } : {}) });
      const page = await apiRequest<ActivityPage>(`/api/notifications?${query}`, { signal });
      setItems((current) => append ? [...current, ...page.items] : page.items);
      setCursor(page.nextCursor); setStatus(page.items.length ? "Activity is up to date." : "No activity yet.");
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setStatus(errorMessage(error));
    } finally { if (!signal?.aborted) setLoading(false); }
  }

  useEffect(() => {
    if (isPreviewMode) return;
    const controller = new AbortController();
    apiRequest<ActivityPage>("/api/notifications?limit=30", { signal: controller.signal })
      .then((page) => { setItems(page.items); setCursor(page.nextCursor); setStatus(page.items.length ? "Activity is up to date." : "No activity yet."); })
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
      setStatus(`${ids ? "Activity marked" : "All activity marked"} as read.${isPreviewMode ? " Preview only." : ""}`);
    } catch (error) { setStatus(errorMessage(error)); }
  }

  return <>
    {isPreviewMode && <div role="note" className="mb-5 rounded-2xl bg-sun-soft p-4 text-sm leading-6"><strong>Preview mode.</strong> Activity below is demo data; read state is not persisted.</div>}
    <header className="flex items-start justify-between gap-3"><div><p className="text-sm font-bold text-brand">Encouragement, gathered</p><h1 className="page-title mt-1">Activity</h1><p className="mt-2 text-muted">The thoughtful bits, without the noise.</p></div><div className="flex gap-2"><button className="icon-btn" aria-label="Refresh activity" onClick={() => void load()} disabled={loading}><RefreshCw size={17} className={loading ? "animate-spin" : ""} /></button><button className="btn btn-secondary px-3 sm:px-4" disabled={!unread.length || loading} onClick={() => void markRead()}><CheckCheck size={17} /><span className="hidden sm:inline">Mark all read</span></button></div></header>
    <p className="mt-4 min-h-5 text-sm font-bold text-muted" aria-live="polite">{loading ? "Loading activity…" : status}</p>
    {items.length ? <section className="card mt-4 overflow-hidden" aria-label="Recent activity">{items.map((item) => {
      const ai = Boolean(item.companion_id); const actor = item.social_companions?.name ?? item.user_profiles?.username ?? "idobataAI";
      const detail = item.social_posts?.task_title ?? item.social_posts?.content ?? (item.kind === "system" ? "A small streak is growing." : "A shared accomplishment");
      const avatarUrl = item.social_companions?.avatar_url ?? item.user_profiles?.avatar_url ?? null;
      return <button key={item.id} onClick={() => void markRead([item.id])} disabled={Boolean(item.read_at)} className="relative flex w-full items-start gap-3 border-b border-line p-4 text-left last:border-0 hover:bg-canvas/60 disabled:cursor-default disabled:opacity-80 sm:p-5"><Avatar initials={actor.slice(0, 2).toUpperCase()} ai={ai} avatarUrl={avatarUrl} name={actor} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2 text-sm"><strong>{actor}</strong>{ai && <AIBadge />}<span className="text-muted">{notificationCopy(item)}</span></div><p className="mt-2 rounded-xl bg-canvas px-3 py-2 text-sm leading-5 text-muted">{detail}</p><span className="mt-2 block text-xs font-bold text-muted">{relativeTime(item.created_at)}</span></div>{!item.read_at && <span className="absolute right-4 top-4 h-2.5 w-2.5 rounded-full bg-brand"><span className="sr-only">Unread</span></span>}</button>;
    })}</section> : !loading && <div className="soft-card mt-6 py-12 text-center"><Bell size={26} className="mx-auto text-community" /><h2 className="display mt-4 text-xl font-bold">Quiet for now</h2><p className="mt-2 text-sm text-muted">Replies, reactions, and progress notes will gather here.</p></div>}
    {cursor && <button className="btn btn-secondary mt-5 w-full" onClick={() => void load({ append: true })} disabled={loading}>Show earlier activity</button>}
    <aside className="soft-card mt-6 flex items-start gap-3 p-4"><Flame size={18} className="mt-0.5 text-community" /><div><p className="text-sm font-bold">You’re in control of the pace.</p><p className="mt-1 text-sm leading-6 text-muted">Choose which replies, reactions, and companion updates reach you in Settings.</p></div></aside>
  </>;
}
