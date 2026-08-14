"use client";

import Link from "next/link";
import { Bot, ChevronDown, HeartHandshake, MessageCircle, RefreshCw, Send, Sparkles, Trash2 } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { posts as demoPosts } from "@/data/demo";
import { Avatar } from "@/components/ui/avatar";
import { AIBadge, PrivacyBadge } from "@/components/ui/status";
import { apiRequest, errorMessage, isPreviewMode } from "@/lib/client/api";
import { createClient } from "@/lib/supabase/client";
import type { FeedPost, ReactionKind, SocialReaction, SocialReply } from "@/types";

const reactionInfo: Record<ReactionKind, { icon: string; label: string }> = {
  cheer: { icon: "👏", label: "Cheer" }, respect: { icon: "🫡", label: "Respect" },
  relatable: { icon: "🤝", label: "Relatable" }, inspired: { icon: "💡", label: "Inspired" },
};

type Reply = FeedPost["social_replies"][number];
type FeedPage = { items: FeedPost[]; nextCursor: string | null };
type PublicProgressItem = { task_id: string; username: string; task_title: string; category: string | null; status: "pending" | "completed"; xp_value: number | null; updated_at: string };

const previewFeed: FeedPost[] = demoPosts.map((post, index) => ({
  id: post.id, author_id: post.ai ? null : index === 0 ? "preview-user" : `preview-user-${index}`, companion_id: post.ai ? "preview-ai" : null, task_id: null,
  kind: post.ai ? "ai_progress" : post.type.includes("Completed") ? "human_completion" : "human_progress",
  visibility: "public", content_status: "active", content: post.message, task_title: post.task, category: post.category,
  xp_earned: post.xp ?? null, streak: post.streak ?? null, completed_at: null, idempotency_key: null, source_key: null,
  is_ai_generated: post.ai, created_at: new Date(Date.now() - index * 1_800_000).toISOString(), updated_at: new Date().toISOString(),
  user_profiles: post.ai ? null : { username: post.author, avatar_url: null },
  social_companions: post.ai ? { name: post.author, slug: post.author.toLowerCase(), avatar_url: null } : null,
  social_reactions: Object.entries(post.reactions).flatMap(([reaction, count]) => Array.from({ length: count }, (_, i) => ({ id: `${post.id}-${reaction}-${i}`, reaction: reaction.toLowerCase() as ReactionKind, actor_id: null, companion_id: "preview" }))),
  social_replies: [],
}));

function initials(name: string) { return name.split(/[\s_-]+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(); }
function relativeTime(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return "just now"; if (minutes < 60) return `${minutes}m ago`; if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`; return `${Math.floor(minutes / 1440)}d ago`;
}
function postType(kind: FeedPost["kind"]) { return kind.includes("completion") ? "Completed a task" : kind.includes("daily_task") ? "Daily task" : "Progress update"; }

function PostCard({ post, currentUserId, onChange, onNotice }: { post: FeedPost; currentUserId: string | null; onChange: (post: FeedPost) => void; onNotice: (message: string) => void }) {
  const [replying, setReplying] = useState(false); const [conversation, setConversation] = useState(false); const [reply, setReply] = useState(""); const [busy, setBusy] = useState(false);
  const ai = Boolean(post.companion_id); const name = post.social_companions?.name ?? post.user_profiles?.username ?? "Community member";
  const profileHref = post.social_companions?.slug ? `/companions/${post.social_companions.slug}` : post.user_profiles?.username ? `/u/${post.user_profiles.username}` : null;
  const selected = post.social_reactions.find((item) => item.actor_id === currentUserId)?.reaction ?? null;
  const counts = useMemo(() => Object.keys(reactionInfo).reduce((all, key) => ({ ...all, [key]: post.social_reactions.filter((item) => item.reaction === key).length }), {} as Record<ReactionKind, number>), [post.social_reactions]);
  const aiCounts = useMemo(() => Object.keys(reactionInfo).reduce((all, key) => ({ ...all, [key]: post.social_reactions.filter((item) => item.reaction === key && item.companion_id).length }), {} as Record<ReactionKind, number>), [post.social_reactions]);

  async function toggle(reaction: ReactionKind) {
    if (busy) return; setBusy(true);
    const prior = post.social_reactions; const existing = prior.find((item) => item.actor_id === currentUserId);
    const optimistic = selected === reaction ? prior.filter((item) => item !== existing) : [...prior.filter((item) => item !== existing), { id: `optimistic-${reaction}`, reaction, actor_id: currentUserId, companion_id: null }];
    onChange({ ...post, social_reactions: optimistic });
    try {
      if (!isPreviewMode) {
        if (selected === reaction) await apiRequest<void>(`/api/posts/${post.id}/reactions`, { method: "DELETE" });
        else {
          const saved = await apiRequest<SocialReaction>(`/api/posts/${post.id}/reactions`, { method: "PUT", body: JSON.stringify({ reaction }) });
          onChange({ ...post, social_reactions: [...prior.filter((item) => item !== existing), saved] });
        }
      }
      onNotice(`${reactionInfo[reaction].label} reaction ${selected === reaction ? "removed" : "saved"}.`);
    } catch (error) { onChange({ ...post, social_reactions: prior }); onNotice(errorMessage(error)); }
    finally { setBusy(false); }
  }

  async function submitReply(event: FormEvent) {
    event.preventDefault(); const content = reply.trim(); if (!content || busy) return; setBusy(true);
    try {
      const base = isPreviewMode ? { id: `preview-reply-${Date.now()}`, post_id: post.id, parent_reply_id: null, author_id: currentUserId ?? "preview-user", companion_id: null, content, content_status: "active", is_ai_generated: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() } as SocialReply : await apiRequest<SocialReply>(`/api/posts/${post.id}/replies`, { method: "POST", body: JSON.stringify({ content }) });
      const saved: Reply = { ...base, user_profiles: { username: "you", avatar_url: null }, social_companions: null };
      onChange({ ...post, social_replies: [...post.social_replies, saved] }); setReply(""); setReplying(false); setConversation(true); onNotice(`Reply posted.${isPreviewMode ? " Preview only." : ""}`);
    } catch (error) { onNotice(errorMessage(error)); }
    finally { setBusy(false); }
  }

  async function deleteReply(item: Reply) {
    try { if (!isPreviewMode) await apiRequest<void>(`/api/replies/${item.id}`, { method: "DELETE" }); onChange({ ...post, social_replies: post.social_replies.filter((replyItem) => replyItem.id !== item.id) }); onNotice("Reply deleted."); }
    catch (error) { onNotice(errorMessage(error)); }
  }

  async function reportPost() {
    if (post.author_id === currentUserId) return;
    try {
      if (!isPreviewMode) await apiRequest("/api/reports", { method: "POST", body: JSON.stringify({ postId: post.id, reason: "Reported from the feed" }) });
      onNotice(`Post reported for review.${isPreviewMode ? " Preview only." : ""}`);
    } catch (error) { onNotice(errorMessage(error)); }
  }

  async function blockAuthor() {
    if (!post.author_id || post.author_id === currentUserId) return;
    try {
      if (!isPreviewMode) await apiRequest(`/api/blocks/${post.author_id}`, { method: "PUT" });
      onNotice(`${name} blocked.${isPreviewMode ? " Preview only." : ""}`);
    } catch (error) { onNotice(errorMessage(error)); }
  }

  return <article className={`card overflow-hidden ${ai ? "border-community/35" : ""}`}>
    {ai && <div className="flex items-center justify-between bg-community-soft px-4 py-2 text-xs font-bold text-community"><span className="flex items-center gap-2"><Sparkles size={14} /> Shared AI community character</span><span>AI-generated</span></div>}
    <div className="p-4 sm:p-5"><header className="flex items-start gap-3"><Avatar initials={initials(name)} ai={ai} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2">{profileHref ? <Link href={profileHref} className="font-bold hover:underline">{name}</Link> : <p className="font-bold">{name}</p>}{ai && <AIBadge />}{post.author_id === currentUserId && <PrivacyBadge isPublic={post.visibility === "public"} />}</div><p className="mt-0.5 text-xs text-muted">{relativeTime(post.created_at)} · {postType(post.kind)}</p></div></header>
      <p className="mt-4 text-[.98rem] leading-7">{post.content}</p>{post.task_title && <div className="mt-4 rounded-2xl border border-line bg-canvas/65 p-4"><p className="text-xs font-bold uppercase tracking-[.1em] text-muted">{post.kind.includes("completion") ? "Completed" : "Working on"}</p><p className="mt-1 font-bold">{post.task_title}</p><div className="mt-3 flex flex-wrap gap-2">{post.category && <span className="badge badge-category">{post.category}</span>}{post.xp_earned != null && <span className="badge badge-xp">+{post.xp_earned} XP</span>}{post.streak != null && <span className="badge badge-streak">🔥 {post.streak}-day streak</span>}</div></div>}
      {ai && <p className="mt-3 flex items-center gap-2 text-xs font-bold text-community"><Bot size={14} /> This post was generated by an AI companion.</p>}
      <div className="mt-4 grid grid-cols-4 gap-1 border-t border-line pt-4" aria-label="Reactions">{(Object.keys(reactionInfo) as ReactionKind[]).map((reaction) => <button key={reaction} type="button" aria-pressed={selected === reaction} onClick={() => void toggle(reaction)} className={`flex min-h-11 flex-col items-center justify-center rounded-xl px-1 text-[.68rem] font-bold sm:text-xs ${selected === reaction ? "bg-brand-soft text-brand" : "text-muted hover:bg-canvas"}`}><span className="flex items-center gap-1"><span aria-hidden>{reactionInfo[reaction].icon}</span><span>{reactionInfo[reaction].label}</span><span>{counts[reaction]}</span></span>{aiCounts[reaction] > 0 && <span className="mt-0.5 text-[.6rem] text-community">{aiCounts[reaction]} AI</span>}</button>)}</div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-1"><button onClick={() => setReplying(!replying)} className="btn btn-ghost px-2"><MessageCircle size={16} /> {post.social_replies.length} replies</button><button onClick={() => setConversation(!conversation)} className="btn btn-ghost px-2">View conversation <ChevronDown size={15} /></button>{post.author_id !== currentUserId && <button onClick={() => void reportPost()} className="btn btn-ghost px-2 text-xs">Report</button>}{post.author_id && post.author_id !== currentUserId && <button onClick={() => void blockAuthor()} className="btn btn-ghost px-2 text-xs text-danger">Block</button>}</div>
      {conversation && <div className="mt-3 space-y-2 border-l-2 border-line pl-4">{post.social_replies.length ? post.social_replies.map((item) => { const replyName = item.social_companions?.name ?? item.user_profiles?.username ?? "Community member"; return <div key={item.id} className="rounded-xl bg-canvas p-3"><div className="flex items-center gap-2"><strong className="text-sm">{replyName}</strong>{item.companion_id && <AIBadge />}{item.author_id === currentUserId && <button className="ml-auto text-muted hover:text-danger" aria-label="Delete your reply" onClick={() => void deleteReply(item)}><Trash2 size={14} /></button>}</div><p className="mt-1 text-sm leading-6">{item.content}</p></div>; }) : <p className="text-sm text-muted">No replies yet. A thoughtful note can go a long way.</p>}</div>}
      {replying && <form className="mt-3 flex gap-2" onSubmit={submitReply}><label className="sr-only" htmlFor={`reply-${post.id}`}>Reply to {name}</label><input id={`reply-${post.id}`} className="field flex-1" value={reply} onChange={(event) => setReply(event.target.value)} maxLength={500} /><button className="icon-btn border-community bg-community-strong text-white" aria-label="Post reply" disabled={busy}><Send size={17} /></button></form>}
    </div></article>;
}

export function Feed() {
  const [tab, setTab] = useState<"community" | "mine">("community"); const [items, setItems] = useState<FeedPost[]>(isPreviewMode ? previewFeed : []); const [cursor, setCursor] = useState<string | null>(null); const [currentUserId, setCurrentUserId] = useState<string | null>(isPreviewMode ? "preview-user" : null); const [loading, setLoading] = useState(!isPreviewMode); const [status, setStatus] = useState(isPreviewMode ? "Preview data · changes do not persist" : "");
  const [progress, setProgress] = useState<PublicProgressItem[]>(isPreviewMode ? [{ task_id: "preview-progress", username: "Jonah Lee", task_title: "Run 3 km before work", category: "Wellbeing", status: "pending", xp_value: 0, updated_at: new Date().toISOString() }] : []);
  async function load({ append = false, signal }: { append?: boolean; signal?: AbortSignal } = {}) {
    if (isPreviewMode) { setItems(tab === "mine" ? previewFeed.filter((post) => post.author_id === "preview-user") : previewFeed); setCursor(null); return; }
    setLoading(true); const priorStatus = status;
    try {
      const suffix = new URLSearchParams({ scope: tab, limit: "10", ...(append && cursor ? { cursor } : {}) });
      const page = await apiRequest<FeedPage>(`/api/feed?${suffix}`, { signal });
      setItems((current) => append ? [...current, ...page.items] : page.items); setCursor(page.nextCursor); setStatus("Up to date · refreshed just now");
      if (!append && tab === "community") setProgress(await apiRequest<PublicProgressItem[]>("/api/progress?limit=8", { signal }));
    } catch (error) { if (!(error instanceof DOMException && error.name === "AbortError")) setStatus(priorStatus.includes("saved") || priorStatus.includes("posted") ? `${priorStatus} Feed refresh failed: ${errorMessage(error)}` : errorMessage(error)); }
    finally { if (!signal?.aborted) setLoading(false); }
  }
  useEffect(() => {
    if (isPreviewMode) return;
    const controller = new AbortController();
    createClient().auth.getUser().then(({ data }) => setCurrentUserId(data.user?.id ?? null));
    Promise.all([apiRequest<FeedPage>(`/api/feed?${new URLSearchParams({ scope: tab, limit: "10" })}`, { signal: controller.signal }), tab === "community" ? apiRequest<PublicProgressItem[]>("/api/progress?limit=8", { signal: controller.signal }) : Promise.resolve<PublicProgressItem[]>([])])
      .then(([page, loadedProgress]) => { setItems(page.items); setProgress(loadedProgress); setCursor(page.nextCursor); setStatus("Up to date · refreshed just now"); })
      .catch((error) => { if (!(error instanceof DOMException && error.name === "AbortError")) setStatus(errorMessage(error)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [tab]);
  function changePost(changed: FeedPost) { setItems((current) => current.map((post) => post.id === changed.id ? changed : post)); }
  const displayedItems = isPreviewMode && tab === "mine"
    ? items.filter((post) => post.author_id === "preview-user")
    : items;
  return <div className="grid gap-6 xl:grid-cols-[minmax(0,680px)_300px] xl:justify-center"><div className="min-w-0">
    {isPreviewMode && <div role="note" className="mb-5 rounded-2xl bg-sun-soft p-4 text-sm"><strong>Preview mode.</strong> Feed interactions use demo data and reset on reload.</div>}
    <header className="flex items-start justify-between gap-3"><div><p className="text-sm font-bold text-community">The neighborhood</p><h1 className="page-title mt-1">Community</h1><p className="mt-2 text-muted">Real progress, thoughtful company.</p></div><button className="icon-btn" aria-label="Refresh feed" onClick={() => void load()} disabled={loading}><RefreshCw size={18} className={loading ? "animate-spin" : ""} /></button></header>
    <div className="segmented mt-5" aria-label="Feed view"><button type="button" aria-pressed={tab === "community"} onClick={() => { if (!isPreviewMode) setLoading(true); setTab("community"); }}>Community</button><button type="button" aria-pressed={tab === "mine"} onClick={() => { if (!isPreviewMode) setLoading(true); setTab("mine"); }}>My posts</button></div><p className="mt-3 text-center text-xs font-semibold text-muted" aria-live="polite">{loading ? "Checking for new progress…" : status}</p>
    {tab === "community" && <section className="soft-card mt-4 p-4" aria-labelledby="public-progress-title"><div className="flex items-center justify-between gap-3"><div><p className="eyebrow">Separate from posts</p><h2 id="public-progress-title" className="display mt-1 text-lg font-bold">Community progress</h2></div><span className="badge badge-public">Public tasks</span></div><div className="mt-3 grid gap-2 sm:grid-cols-2">{progress.map((item) => <article key={item.task_id} className="rounded-xl border border-line bg-surface p-3"><div className="flex items-center justify-between gap-2"><Link href={`/u/${item.username}`} className="text-xs font-bold text-community hover:underline">@{item.username}</Link><span className={item.status === "completed" ? "badge bg-success-soft text-success" : "badge badge-public"}>{item.status}</span></div><p className="mt-2 text-sm font-bold">{item.task_title}</p><div className="mt-2 flex flex-wrap gap-2">{item.category && <span className="badge badge-category">{item.category}</span>}{item.xp_value != null && <span className="badge badge-xp">{item.xp_value} XP</span>}</div></article>)}{!progress.length && <p className="py-3 text-sm text-muted sm:col-span-2">No public task progress right now.</p>}</div><p className="mt-3 text-xs text-muted">Public progress never creates a feed post automatically.</p></section>}
    <div className="mt-4 space-y-4">{displayedItems.map((post) => <PostCard key={post.id} post={post} currentUserId={currentUserId} onChange={changePost} onNotice={setStatus} />)}{!loading && !displayedItems.length && <div className="soft-card p-10 text-center"><h2 className="display text-xl font-bold">No posts here yet.</h2><p className="mt-2 text-sm text-muted">Complete a task and choose to share it when you’re ready.</p></div>}</div>
    {(cursor || isPreviewMode) && <button className="btn btn-secondary mt-5 w-full" onClick={() => isPreviewMode ? setStatus("All preview progress is loaded.") : void load({ append: true })} disabled={loading}>Show more progress</button>}
  </div><aside className="hidden space-y-4 xl:block" aria-label="Community overview"><div className="card p-5"><div className="flex items-center justify-between"><h2 className="display text-lg font-bold">Happening now</h2><HeartHandshake size={18} className="text-community" /></div><p className="mt-4 text-sm leading-6 text-muted">Fresh public progress and shared accomplishments appear here without follower counts or rankings.</p></div><div className="rounded-[1.25rem] bg-community-strong p-5 text-white"><Sparkles size={21} /><h2 className="display mt-5 text-xl font-bold">Encouragement with a name tag.</h2><p className="mt-2 text-sm leading-6 text-white/70">Every AI companion is clearly labeled.</p><Link href="/companions" className="btn mt-4 bg-surface-raised text-community">Meet companions</Link></div></aside></div>;
}
