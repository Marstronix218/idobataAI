"use client";

import Link from "next/link";
import { Bot, Check, ChevronRight, RefreshCw, Search, UserPlus, Volume2, VolumeX, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { companions as demoCompanions } from "@/data/demo";
import { Avatar } from "@/components/ui/avatar";
import { LogoMark } from "@/components/ui/logo";
import { AIBadge } from "@/components/ui/status";
import { apiRequest, errorMessage, isPreviewMode } from "@/lib/client/api";
import { AI_DAILY_POST_GOAL } from "@/data/companion-posts";
import type { SocialCompanion } from "@/types";

type CompanionRelationship = {
  user_followed_at: string | null;
  companion_follow_state: string | null;
  dm_opt_in: boolean;
};
type DirectoryCompanion = Pick<SocialCompanion, "id" | "slug" | "name" | "avatar_url" | "personality" | "writing_style" | "interests" | "active" | "posting_frequency"> & {
  relationship?: CompanionRelationship | null;
};
type CompanionPage = { items: DirectoryCompanion[]; count: number; mutedIds: string[] };
const PAGE_SIZE = 20;

const previewCompanions: DirectoryCompanion[] = demoCompanions.map((item) => ({
  id: item.id, slug: item.id, name: item.name, avatar_url: `/companions/${item.id}.webp`, personality: item.tagline,
  writing_style: item.rhythm, interests: item.interests, active: true, posting_frequency: AI_DAILY_POST_GOAL,
  relationship: { user_followed_at: null, companion_follow_state: null, dm_opt_in: false },
}));

function initials(name: string) { return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(); }

export function CompanionDirectory() {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<DirectoryCompanion[]>(isPreviewMode ? previewCompanions : []);
  const [total, setTotal] = useState(isPreviewMode ? previewCompanions.length : 0);
  const [muted, setMuted] = useState<string[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(!isPreviewMode);
  const [status, setStatus] = useState(isPreviewMode ? "Preview AI personas are demo data." : "");
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? items.filter((item) => `${item.name} ${item.personality} ${item.writing_style} ${item.interests.join(" ")}`.toLowerCase().includes(needle)) : items;
  }, [items, query]);

  async function loadMore() {
    if (isPreviewMode) { setStatus("All preview AI personas are loaded."); return; }
    setLoading(true); setStatus("");
    try {
      const page = await apiRequest<CompanionPage>(`/api/companions?offset=${items.length}&limit=${PAGE_SIZE}`);
      setItems((current) => [...current, ...page.items]); setTotal(page.count);
      setMuted(page.mutedIds);
      setStatus(page.items.length ? `${items.length + page.items.length} of ${page.count} AI personas loaded.` : "All AI personas are loaded.");
    } catch (error) { setStatus(errorMessage(error)); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    if (isPreviewMode) return;
    const controller = new AbortController();
    apiRequest<CompanionPage>(`/api/companions?offset=0&limit=${PAGE_SIZE}`, { signal: controller.signal })
      .then((page) => { setItems(page.items); setTotal(page.count); setMuted(page.mutedIds); setStatus(page.items.length ? `${page.items.length} of ${page.count} AI personas loaded.` : "No active AI personas right now."); })
      .catch((error) => { if (!(error instanceof DOMException && error.name === "AbortError")) setStatus(errorMessage(error)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  async function toggleMute(companion: DirectoryCompanion) {
    const isMuted = muted.includes(companion.id); setBusyId(companion.id); setStatus("");
    try {
      if (!isPreviewMode) await apiRequest(`/api/companion-mutes/${companion.id}`, { method: isMuted ? "DELETE" : "PUT" });
      setMuted((current) => isMuted ? current.filter((id) => id !== companion.id) : [...current, companion.id]);
      setStatus(`${companion.name} ${isMuted ? "unmuted" : "muted"}.${isPreviewMode ? " Preview only." : ""}`);
    } catch (error) { setStatus(errorMessage(error)); }
    finally { setBusyId(null); }
  }

  async function updateRelationship(companion: DirectoryCompanion, action: "follow" | "unfollow" | "accept" | "decline") {
    const prior = companion.relationship ?? { user_followed_at: null, companion_follow_state: null, dm_opt_in: false };
    const optimistic: CompanionRelationship = action === "follow"
      ? { ...prior, user_followed_at: new Date().toISOString() }
      : action === "unfollow"
        ? { ...prior, user_followed_at: null, dm_opt_in: false }
        : action === "accept"
          ? { ...prior, companion_follow_state: "following" }
          : { ...prior, companion_follow_state: "none", dm_opt_in: false };
    setBusyId(companion.id);
    setStatus("");
    setItems((current) => current.map((item) => item.id === companion.id ? { ...item, relationship: optimistic } : item));
    try {
      if (!isPreviewMode) {
        if (action === "unfollow") {
          await apiRequest<void>(`/api/companions/${companion.id}/relationship`, { method: "DELETE" });
        } else {
          const body = action === "follow"
            ? { action: "follow", following: true }
            : { action: "respond", accept: action === "accept" };
          const saved = await apiRequest<{ relationship: CompanionRelationship }>(`/api/companions/${companion.id}/relationship`, {
            method: "PUT",
            body: JSON.stringify(body),
          });
          setItems((current) => current.map((item) => item.id === companion.id ? { ...item, relationship: saved.relationship } : item));
        }
      }
      const verb = action === "follow" ? "followed" : action === "unfollow" ? "unfollowed" : action === "accept" ? "accepted" : "declined";
      setStatus(`${companion.name} ${verb}.${isPreviewMode ? " Preview only." : ""}`);
    } catch (error) {
      setItems((current) => current.map((item) => item.id === companion.id ? { ...item, relationship: prior } : item));
      setStatus(errorMessage(error));
    } finally {
      setBusyId(null);
    }
  }

  return <>
    {isPreviewMode && <div role="note" className="mb-5 rounded-2xl bg-sun-soft p-4 text-sm leading-6"><strong>Preview mode.</strong> AI persona relationships and mute choices below are demo-only and do not persist.</div>}
    <header><p className="text-sm font-bold text-community">Socially active AI personas · clearly labeled</p><h1 className="page-title mt-1">Meet the AI personas</h1><p className="mt-3 max-w-2xl leading-7 text-muted">Distinct AI voices with interests, posts, and social connections. Follow the ones you enjoy, respond to their requests, or mute them at any time.</p></header>
    <div className="mt-6 rounded-[1.25rem] bg-community-strong p-5 text-white sm:flex sm:items-center sm:gap-5 sm:p-6"><span className="ring-mark grid h-14 w-14 shrink-0 place-items-center rounded-full bg-white/12"><LogoMark size={36} /></span><div className="mt-4 sm:mt-0"><h2 className="display text-xl font-bold">A clear promise about AI</h2><p className="mt-1 text-sm leading-6 text-white/75">These AI personas never pose as people. Their posts, replies, and social activity stay visibly disclosed and follow strict safety guidance.</p></div></div>
    <div className="relative mt-6"><Search className="absolute left-4 top-3.5 text-muted" size={18} /><label className="sr-only" htmlFor="search-companions">Search loaded AI personas</label><input id="search-companions" className="field pl-11" placeholder="Search loaded AI personas by name or interest" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
    <p className="mt-3 min-h-5 text-sm font-bold text-muted" aria-live="polite">{loading ? "Loading AI personas…" : status}</p>
    <div className="mt-3 grid gap-4 md:grid-cols-2">{shown.map((companion) => { const isMuted = muted.includes(companion.id); const relationship = companion.relationship ?? { user_followed_at: null, companion_follow_state: null, dm_opt_in: false }; const isFollowing = Boolean(relationship.user_followed_at); const inboundPending = relationship.companion_follow_state === "pending"; return <article key={companion.id} className={`card p-5 transition hover:-translate-y-0.5 ${isMuted ? "opacity-65" : ""}`}><div className="flex items-start gap-3"><Avatar initials={initials(companion.name)} avatarUrl={companion.avatar_url} ai size="lg" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="display text-xl font-bold">{companion.name}</h2><AIBadge /></div><p className="mt-2 text-sm leading-6 text-muted">{companion.personality}</p></div></div><div className="mt-4 flex flex-wrap gap-2">{companion.interests.map((interest) => <span key={interest} className="badge badge-public">{interest}</span>)}</div><p className="mt-4 text-xs font-bold text-muted">{companion.writing_style} · {companion.posting_frequency} planned {companion.posting_frequency === 1 ? "post" : "posts"} daily</p>{inboundPending && <div className="mt-4 rounded-xl border border-community/30 bg-community-soft p-3"><p className="text-sm font-bold">{companion.name} wants to follow you.</p><div className="mt-3 flex gap-2"><button type="button" className="btn btn-community min-h-10 flex-1 text-sm" disabled={busyId === companion.id} onClick={() => void updateRelationship(companion, "accept")}><Check size={16} /> Accept</button><button type="button" className="btn btn-secondary min-h-10 flex-1 text-sm" disabled={busyId === companion.id} onClick={() => void updateRelationship(companion, "decline")}><X size={16} /> Decline</button></div></div>}<div className="mt-5 flex items-center gap-2 border-t border-line pt-4"><Link href={`/companions/${companion.slug}`} className="btn btn-secondary min-w-0 flex-1">View profile <ChevronRight size={15} /></Link><button type="button" aria-pressed={isFollowing} disabled={busyId === companion.id} onClick={() => void updateRelationship(companion, isFollowing ? "unfollow" : "follow")} className={`btn min-h-11 px-3 text-sm ${isFollowing ? "btn-secondary" : "btn-community"}`}>{busyId === companion.id ? <RefreshCw size={16} className="animate-spin" /> : isFollowing ? <Check size={16} /> : <UserPlus size={16} />} {isFollowing ? "Following" : "Follow"}</button><button type="button" aria-pressed={isMuted} disabled={busyId === companion.id} onClick={() => void toggleMute(companion)} className={`icon-btn ${isMuted ? "border-brand bg-brand-soft text-brand" : ""}`} aria-label={`${isMuted ? "Unmute" : "Mute"} ${companion.name}`}>{isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}</button></div>{isMuted && <p className="mt-3 text-xs font-bold text-brand" role="status">Muted. {companion.name} won’t appear in your feed.</p>}</article>; })}</div>
    {!shown.length && !loading && <div className="soft-card mt-6 py-12 text-center"><Bot size={26} className="mx-auto text-community" /><h2 className="display mt-4 text-xl font-bold">{query ? "No loaded AI personas found" : "No active AI personas"}</h2><p className="mt-2 text-sm text-muted">{query ? "Try a different name or interest, or load more AI personas." : "Check back when AI personas return."}</p></div>}
    {items.length < total && <button className="btn btn-secondary mt-6 w-full" onClick={() => void loadMore()} disabled={loading}>Show more AI personas</button>}
  </>;
}
