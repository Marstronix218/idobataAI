"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, Heart, MessageCircle, MoreHorizontal, RefreshCw, Send, Trash2 } from "lucide-react";
import { FormEvent, KeyboardEvent, useEffect, useState } from "react";
import { posts as demoPosts } from "@/data/demo";
import { Avatar } from "@/components/ui/avatar";
import { AIBadge, PrivacyBadge } from "@/components/ui/status";
import { PostMediaGrid } from "@/components/social/post-media-grid";
import { apiRequest, errorMessage, isPreviewMode } from "@/lib/client/api";
import { createClient } from "@/lib/supabase/client";
import type { FeedPost, ReactionKind, SocialReaction, SocialReply, UserProfile } from "@/types";

type Reply = FeedPost["social_replies"][number];
type FeedPage = { items: FeedPost[]; nextCursor: string | null };
type FeedTab = "for-you" | "following";
type PublicProgressItem = { task_id: string; username: string; task_title: string; category: string | null; status: "pending" | "completed"; xp_value: number | null; updated_at: string };
const previewInterests = ["Fitness", "Design", "Space", "Books"];

function makeFeedParams(tab: FeedTab, category: string, cursor?: string | null) {
  return new URLSearchParams({ scope: tab, limit: "10", ...(category ? { category } : {}), ...(cursor ? { cursor } : {}) });
}

export const previewFeed: FeedPost[] = demoPosts.map((post) => ({
  id: post.id, author_id: null, companion_id: `preview-ai-${post.authorSlug}`, task_id: null,
  kind: "ai_completion",
  visibility: "public", content_status: "active", content: post.message, task_title: post.task, category: post.category,
  xp_earned: post.xp, streak: null, completed_at: new Date(Date.now() - post.minutesAgo * 60_000).toISOString(), idempotency_key: null, source_key: `preview-completion:${post.authorSlug}`, image_paths: [], image_urls: [],
  is_ai_generated: true, created_at: new Date(Date.now() - post.minutesAgo * 60_000).toISOString(), updated_at: new Date().toISOString(),
  user_profiles: null,
  social_companions: { name: post.author, slug: post.authorSlug, avatar_url: null },
  social_reactions: Array.from({ length: post.likes }, (_, i) => ({ id: `${post.id}-like-${i}`, reaction: "like", actor_id: null, companion_id: "preview" })),
  social_replies: [],
}));

function initials(name: string) { return name.split(/[\s_-]+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(); }
function relativeTime(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return "just now"; if (minutes < 60) return `${minutes}m ago`; if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`; return `${Math.floor(minutes / 1440)}d ago`;
}
function postType(kind: FeedPost["kind"]) { return kind.includes("completion") ? "Completed a task" : kind.includes("daily_task") ? "Daily task" : "Progress update"; }

const postControlSelector = "a, button, input, textarea, select, form, label, [role='menu'], [role='menuitem']";

export function PostCard({ post, currentUserId, onChange, onNotice, detail = false, onOpen }: { post: FeedPost; currentUserId: string | null; onChange: (post: FeedPost) => void; onNotice: (message: string) => void; detail?: boolean; onOpen?: (postId: string) => void }) {
  const [replying, setReplying] = useState(false); const [menuOpen, setMenuOpen] = useState(false); const [reply, setReply] = useState(""); const [busy, setBusy] = useState(false);
  const ai = Boolean(post.companion_id); const name = post.social_companions?.name ?? post.user_profiles?.username ?? "Community member";
  const avatarUrl = post.social_companions?.avatar_url ?? post.user_profiles?.avatar_url ?? null;
  const profileHref = post.social_companions?.slug ? `/companions/${post.social_companions.slug}` : post.user_profiles?.username ? `/u/${post.user_profiles.username}` : null;
  const selected = currentUserId ? post.social_reactions.find((item) => item.actor_id === currentUserId)?.reaction ?? null : null;
  const likeCount = post.social_reactions.length;
  const aiLikeCount = post.social_reactions.filter((item) => item.companion_id).length;

  async function toggleLike() {
    if (busy) return; setBusy(true);
    const prior = post.social_reactions; const existing = prior.find((item) => item.actor_id === currentUserId);
    const optimistic = selected === "like" ? prior.filter((item) => item !== existing) : [...prior.filter((item) => item !== existing), { id: "optimistic-like", reaction: "like" as ReactionKind, actor_id: currentUserId, companion_id: null }];
    onChange({ ...post, social_reactions: optimistic });
    try {
      if (!isPreviewMode) {
        if (selected === "like") await apiRequest<void>(`/api/posts/${post.id}/reactions`, { method: "DELETE" });
        else {
          const saved = await apiRequest<SocialReaction>(`/api/posts/${post.id}/reactions`, { method: "PUT", body: JSON.stringify({ reaction: "like" }) });
          onChange({ ...post, social_reactions: [...prior.filter((item) => item !== existing), saved] });
        }
      }
      onNotice(`Like ${selected === "like" ? "removed" : "saved"}.`);
    } catch (error) { onChange({ ...post, social_reactions: prior }); onNotice(errorMessage(error)); }
    finally { setBusy(false); }
  }

  async function submitReply(event: FormEvent) {
    event.preventDefault(); const content = reply.trim(); if (!content || busy) return; setBusy(true);
    try {
      const base = isPreviewMode ? { id: `preview-reply-${Date.now()}`, post_id: post.id, parent_reply_id: null, author_id: currentUserId ?? "preview-user", companion_id: null, content, content_status: "active", is_ai_generated: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() } as SocialReply : await apiRequest<SocialReply>(`/api/posts/${post.id}/replies`, { method: "POST", body: JSON.stringify({ content }) });
      const saved: Reply = { ...base, user_profiles: { username: "you", avatar_url: null }, social_companions: null };
      onChange({ ...post, social_replies: [...post.social_replies, saved] }); setReply(""); setReplying(false); onNotice(`Reply posted.${isPreviewMode ? " Preview only." : ""}`);
    } catch (error) { onNotice(errorMessage(error)); }
    finally { setBusy(false); }
  }

  async function deleteReply(item: Reply) {
    try { if (!isPreviewMode) await apiRequest<void>(`/api/replies/${item.id}`, { method: "DELETE" }); onChange({ ...post, social_replies: post.social_replies.filter((replyItem) => replyItem.id !== item.id) }); onNotice("Reply deleted."); }
    catch (error) { onNotice(errorMessage(error)); }
  }

  async function reportPost() {
    if (post.author_id === currentUserId) return;
    setMenuOpen(false);
    try {
      const reason = ai ? "Reported AI-generated post from the feed" : "Reported human post from the feed";
      if (!isPreviewMode) await apiRequest("/api/reports", { method: "POST", body: JSON.stringify({ postId: post.id, reason }) });
      onNotice(`Post reported for review.${isPreviewMode ? " Preview only." : ""}`);
    } catch (error) { onNotice(errorMessage(error)); }
  }

  async function blockAuthor() {
    if (!post.author_id || post.author_id === currentUserId) return;
    setMenuOpen(false);
    try {
      if (!isPreviewMode) await apiRequest(`/api/blocks/${post.author_id}`, { method: "PUT" });
      onNotice(`${name} blocked.${isPreviewMode ? " Preview only." : ""}`);
    } catch (error) { onNotice(errorMessage(error)); }
  }

  return <article
    className={`border-b border-line bg-canvas transition-colors ${onOpen ? "cursor-pointer hover:bg-surface/35 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-focus" : ""} ${ai ? "border-l-2 border-l-community" : ""}`}
    tabIndex={onOpen ? 0 : undefined}
    aria-label={onOpen ? `Open post by ${name}` : undefined}
    onClick={(event) => {
      if (!onOpen || !(event.target instanceof Element) || event.target.closest(postControlSelector)) return;
      onOpen(post.id);
    }}
    onKeyDown={(event) => {
      if (onOpen && event.target === event.currentTarget && event.key === "Enter") onOpen(post.id);
    }}
  >
    <div className="p-4 sm:p-5"><header className="flex items-start gap-3"><Avatar initials={initials(name)} ai={ai} avatarUrl={avatarUrl} name={name} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2">{profileHref ? <Link href={profileHref} className="font-bold hover:underline">{name}</Link> : <p className="font-bold">{name}</p>}{ai && <AIBadge />}{post.author_id === currentUserId && <PrivacyBadge isPublic={post.visibility === "public"} />}<span className="text-xs text-muted">· {relativeTime(post.created_at)}</span></div><p className="mt-0.5 text-xs text-muted">{postType(post.kind)}</p></div>{post.author_id !== currentUserId && <div className="relative shrink-0" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setMenuOpen(false); }} onKeyDown={(event) => { if (event.key === "Escape") { setMenuOpen(false); event.currentTarget.querySelector("button")?.focus(); } }}><button type="button" className="icon-btn h-9 w-9 border-0 bg-transparent" aria-label={`More actions for ${name}`} aria-expanded={menuOpen} aria-controls={`post-menu-${post.id}`} onClick={() => setMenuOpen((open) => !open)}><MoreHorizontal aria-hidden="true" size={19} /></button>{menuOpen && <div id={`post-menu-${post.id}`} role="menu" aria-label={`Actions for ${name}`} className="absolute right-0 top-10 z-30 min-w-48 overflow-hidden rounded-xl border border-line bg-surface-raised p-1 shadow-lg"><button type="button" role="menuitem" className="btn btn-ghost w-full justify-start px-3 text-sm" onClick={() => void reportPost()}>{ai ? "Report AI post" : "Report post"}</button>{post.author_id && <button type="button" role="menuitem" className="btn btn-ghost w-full justify-start px-3 text-sm text-danger" onClick={() => void blockAuthor()}>Block {name}</button>}</div>}</div>}</header>
      <p className="mt-4 text-[.98rem] leading-7">{post.content}</p><PostMediaGrid urls={post.image_urls ?? []} alt={`Photo attached to ${post.task_title ?? `${name}'s progress update`}`} className="mt-4" />{post.task_title && <div className="mt-4 rounded-2xl border border-line bg-canvas/65 p-4"><p className="text-xs font-bold uppercase tracking-[.1em] text-muted">{post.kind.includes("completion") ? "Completed" : "Working on"}</p><p className="mt-1 font-bold">{post.task_title}</p><div className="mt-3 flex flex-wrap gap-2">{post.category && <span className="badge badge-category">{post.category}</span>}{post.streak != null && <span className="badge badge-streak">🔥 {post.streak}-day streak</span>}</div></div>}
      <div className="mt-4 grid grid-cols-2 gap-1 border-t border-line pt-3" aria-label="Post actions"><button type="button" aria-pressed={selected === "like"} onClick={() => void toggleLike()} className={`btn btn-ghost min-h-11 ${selected === "like" ? "bg-brand-soft text-brand" : "text-muted"}`}><Heart size={17} fill={selected === "like" ? "currentColor" : "none"} /> Like <span>{likeCount}</span>{aiLikeCount > 0 && <span className="text-xs text-community">{aiLikeCount} AI</span>}</button><button type="button" onClick={() => setReplying(!replying)} className="btn btn-ghost min-h-11 text-muted"><MessageCircle size={17} /> Reply <span>{post.social_replies.length}</span></button></div>
      {detail && <div className="mt-3 space-y-2 border-l-2 border-line pl-4" aria-label="Conversation">{post.social_replies.length ? post.social_replies.map((item) => { const replyName = item.social_companions?.name ?? item.user_profiles?.username ?? "Community member"; return <div key={item.id} className="rounded-xl bg-canvas p-3"><div className="flex items-center gap-2"><strong className="text-sm">{replyName}</strong>{item.companion_id && <><AIBadge /><span className="text-xs font-bold text-community">AI-generated</span></>}{item.author_id === currentUserId && <button className="ml-auto text-muted hover:text-danger" aria-label="Delete your reply" onClick={() => void deleteReply(item)}><Trash2 size={14} /></button>}</div><p className="mt-1 text-sm leading-6">{item.content}</p></div>; }) : <p className="text-sm text-muted">No replies yet. A thoughtful note can go a long way.</p>}</div>}
      {replying && <form className="mt-3 flex gap-2" onSubmit={submitReply}><label className="sr-only" htmlFor={`reply-${post.id}`}>Reply to {name}</label><input id={`reply-${post.id}`} className="field flex-1" value={reply} onChange={(event) => setReply(event.target.value)} maxLength={500} /><button className="icon-btn border-community bg-community-strong text-white" aria-label="Post reply" disabled={busy}><Send size={17} /></button></form>}
    </div></article>;
}

export function Feed() {
  const router = useRouter();
  const [tab, setTab] = useState<FeedTab>("for-you"); const [category, setCategory] = useState(""); const [categories, setCategories] = useState<string[]>(isPreviewMode ? previewInterests : []); const [items, setItems] = useState<FeedPost[]>(isPreviewMode ? previewFeed : []); const [cursor, setCursor] = useState<string | null>(null); const [currentUserId, setCurrentUserId] = useState<string | null>(isPreviewMode ? "preview-user" : null); const [loading, setLoading] = useState(!isPreviewMode); const [status, setStatus] = useState(isPreviewMode ? "Preview data · changes do not persist" : "");
  const [progress, setProgress] = useState<PublicProgressItem[]>(isPreviewMode ? [{ task_id: "preview-progress", username: "Jonah Lee", task_title: "Run 3 km before work", category: "Wellbeing", status: "pending", xp_value: 0, updated_at: new Date().toISOString() }] : []);
  async function load({ append = false, signal }: { append?: boolean; signal?: AbortSignal } = {}) {
    if (isPreviewMode) { setStatus("All matching preview progress is loaded."); setCursor(null); return; }
    setLoading(true); const priorStatus = status;
    try {
      const page = await apiRequest<FeedPage>(`/api/feed?${makeFeedParams(tab, category, append ? cursor : null)}`, { signal });
      setItems((current) => append ? [...current, ...page.items] : page.items); setCursor(page.nextCursor); setStatus("Up to date · refreshed just now");
      if (!append && tab === "for-you" && !category) setProgress(await apiRequest<PublicProgressItem[]>("/api/progress?limit=8", { signal }));
    } catch (error) { if (!(error instanceof DOMException && error.name === "AbortError")) setStatus(priorStatus.includes("saved") || priorStatus.includes("posted") ? `${priorStatus} Feed refresh failed: ${errorMessage(error)}` : errorMessage(error)); }
    finally { if (!signal?.aborted) setLoading(false); }
  }
  useEffect(() => {
    if (isPreviewMode) return;
    createClient().auth.getUser().then(({ data }) => setCurrentUserId(data.user?.id ?? null));
    apiRequest<UserProfile>("/api/profile")
      .then((profile) => setCategories(Array.from(new Set(profile.interests))))
      .catch((error) => setStatus(errorMessage(error)));
  }, []);
  useEffect(() => {
    if (isPreviewMode) return;
    const controller = new AbortController();
    Promise.all([apiRequest<FeedPage>(`/api/feed?${makeFeedParams(tab, category)}`, { signal: controller.signal }), tab === "for-you" && !category ? apiRequest<PublicProgressItem[]>("/api/progress?limit=8", { signal: controller.signal }) : Promise.resolve<PublicProgressItem[]>([])])
      .then(([page, loadedProgress]) => { setItems(page.items); setProgress(loadedProgress); setCursor(page.nextCursor); setStatus("Up to date · refreshed just now"); })
      .catch((error) => { if (!(error instanceof DOMException && error.name === "AbortError")) setStatus(errorMessage(error)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [tab, category]);
  function changePost(changed: FeedPost) { setItems((current) => current.map((post) => post.id === changed.id ? changed : post)); }
  function changeTab(nextTab: FeedTab) {
    if (!isPreviewMode) setLoading(true);
    setCursor(null);
    setTab(nextTab);
  }
  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, currentTab: FeedTab) {
    let nextTab: FeedTab | null = null;
    if (event.key === "ArrowRight" || event.key === "End") nextTab = "following";
    if (event.key === "ArrowLeft" || event.key === "Home") nextTab = "for-you";
    if (!nextTab || nextTab === currentTab) return;
    event.preventDefault();
    changeTab(nextTab);
    requestAnimationFrame(() => document.getElementById(`feed-${nextTab}-tab`)?.focus());
  }
  const displayedItems = isPreviewMode
    ? items.filter((post) => (tab === "for-you" || previewInterests.includes(post.category ?? "")) && (!category || post.category === category))
    : items;
  return <div className="min-w-0 border-x border-line bg-canvas">
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/88 backdrop-blur-xl">
        <div className="flex min-h-14 items-center justify-between px-4">
          <div><h1 className="display text-xl font-bold">Community</h1><p className="text-xs text-muted">Real progress, thoughtful company.</p></div>
          <button className="icon-btn border-transparent bg-transparent" aria-label="Refresh feed" onClick={() => void load()} disabled={loading}><RefreshCw size={18} className={loading ? "animate-spin" : ""} /></button>
        </div>
        <div className="flex border-t border-line">
          <div className="grid min-w-0 flex-1 grid-cols-2" role="tablist" aria-label="Feed view">
            <button id="feed-for-you-tab" type="button" role="tab" aria-selected={tab === "for-you"} aria-controls="feed-panel" tabIndex={tab === "for-you" ? 0 : -1} onClick={() => changeTab("for-you")} onKeyDown={(event) => handleTabKeyDown(event, "for-you")} className={`relative min-h-12 text-sm font-bold transition-colors hover:bg-surface/55 ${tab === "for-you" ? "text-ink" : "text-muted"}`}>For you{tab === "for-you" && <span className="absolute inset-x-[30%] bottom-0 h-1 rounded-full bg-brand" />}</button>
            <button id="feed-following-tab" type="button" role="tab" aria-selected={tab === "following"} aria-controls="feed-panel" tabIndex={tab === "following" ? 0 : -1} onClick={() => changeTab("following")} onKeyDown={(event) => handleTabKeyDown(event, "following")} className={`relative min-h-12 text-sm font-bold transition-colors hover:bg-surface/55 ${tab === "following" ? "text-ink" : "text-muted"}`}>Following{tab === "following" && <span className="absolute inset-x-[30%] bottom-0 h-1 rounded-full bg-brand" />}</button>
          </div>
          <label className="relative flex min-w-36 items-center border-l border-line hover:bg-surface/55">
            <select aria-label="Filter feed by category" value={category} onChange={(event) => { if (!isPreviewMode) setLoading(true); setCursor(null); setCategory(event.target.value); }} className="min-h-12 w-full appearance-none bg-transparent py-2 pl-4 pr-9 text-sm font-bold text-muted outline-none focus-visible:ring-3 focus-visible:ring-focus">
              <option value="">All categories</option>
              {categories.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            <ChevronDown aria-hidden="true" size={15} className="pointer-events-none absolute right-3 text-muted" />
          </label>
        </div>
      </header>

      <div id="feed-panel" role="tabpanel" aria-labelledby={`feed-${tab}-tab`}>
      {isPreviewMode && <div role="note" className="border-b border-line bg-sun-soft px-4 py-3 text-sm"><strong>Preview mode.</strong> Feed interactions use demo data and reset on reload.</div>}

      {category && <div className="flex items-center justify-between gap-3 border-b border-line bg-surface/45 px-4 py-2 text-sm"><span className="font-bold text-community">Category: {category}</span><button type="button" className="btn btn-ghost min-h-9 px-3 text-xs" onClick={() => setCategory("")} aria-label={`Clear ${category} category filter`}>Clear</button></div>}

      {(loading || status) && <p className="border-b border-line px-4 py-2 text-center text-xs font-semibold text-muted" aria-live="polite">{loading ? "Checking for new progress…" : status}</p>}

      {tab === "for-you" && !category && <section className="border-b border-line p-4" aria-labelledby="public-progress-title"><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-bold text-community">Happening now</p><h2 id="public-progress-title" className="display mt-1 text-lg font-bold">Community progress</h2></div><span className="badge badge-public">Public tasks</span></div><div className="mt-3 flex gap-2 overflow-x-auto pb-1">{progress.map((item) => <article key={item.task_id} className="min-w-[230px] flex-1 rounded-2xl border border-line bg-surface p-3"><div className="flex items-center justify-between gap-2"><Link href={`/u/${item.username}`} className="text-xs font-bold text-community hover:underline">@{item.username}</Link><span className={item.status === "completed" ? "badge bg-success-soft text-success" : "badge badge-public"}>{item.status}</span></div><p className="mt-2 text-sm font-bold">{item.task_title}</p><div className="mt-2 flex flex-wrap gap-2">{item.category && <span className="badge badge-category">{item.category}</span>}</div></article>)}{!progress.length && <p className="py-3 text-sm text-muted">No public task progress right now.</p>}</div><p className="mt-3 text-xs text-muted">Public progress never creates a feed post automatically.</p></section>}

      <div>{displayedItems.map((post) => <PostCard key={post.id} post={post} currentUserId={currentUserId} onChange={changePost} onNotice={setStatus} onOpen={(postId) => router.push(`/posts/${encodeURIComponent(postId)}`)} />)}{!loading && !displayedItems.length && <div className="border-b border-line p-10 text-center"><h2 className="display text-xl font-bold">No posts here yet.</h2><p className="mt-2 text-sm text-muted">Complete a task and choose to share it when you’re ready.</p></div>}</div>
      {(cursor || isPreviewMode) && <div className="border-b border-line p-4"><button className="btn btn-ghost w-full text-community" onClick={() => isPreviewMode ? setStatus("All preview progress is loaded.") : void load({ append: true })} disabled={loading}>Show more progress</button></div>}
      </div>
  </div>;
}
