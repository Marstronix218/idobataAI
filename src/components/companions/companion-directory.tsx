"use client";

import Link from "next/link";
import { Bot, ChevronRight, RefreshCw, Search, Sparkles, Volume2, VolumeX } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { companions as demoCompanions } from "@/data/demo";
import { Avatar } from "@/components/ui/avatar";
import { AIBadge } from "@/components/ui/status";
import { apiRequest, errorMessage, isPreviewMode } from "@/lib/client/api";
import type { SocialCompanion } from "@/types";

type DirectoryCompanion = Pick<SocialCompanion, "id" | "slug" | "name" | "avatar_url" | "personality" | "writing_style" | "interests" | "active" | "posting_frequency">;
type CompanionPage = { items: DirectoryCompanion[]; count: number; mutedIds: string[] };
const PAGE_SIZE = 20;

const previewCompanions: DirectoryCompanion[] = demoCompanions.map((item) => ({
  id: item.id, slug: item.id, name: item.name, avatar_url: null, personality: item.tagline,
  writing_style: item.rhythm, interests: item.interests, active: true, posting_frequency: 2,
}));

function initials(name: string) { return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(); }

export function CompanionDirectory() {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<DirectoryCompanion[]>(isPreviewMode ? previewCompanions : []);
  const [total, setTotal] = useState(isPreviewMode ? previewCompanions.length : 0);
  const [muted, setMuted] = useState<string[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(!isPreviewMode);
  const [status, setStatus] = useState(isPreviewMode ? "Preview companions are demo data." : "");
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? items.filter((item) => `${item.name} ${item.personality} ${item.writing_style} ${item.interests.join(" ")}`.toLowerCase().includes(needle)) : items;
  }, [items, query]);

  async function loadMore() {
    if (isPreviewMode) { setStatus("All preview companions are loaded."); return; }
    setLoading(true); setStatus("");
    try {
      const page = await apiRequest<CompanionPage>(`/api/companions?offset=${items.length}&limit=${PAGE_SIZE}`);
      setItems((current) => [...current, ...page.items]); setTotal(page.count);
      setMuted(page.mutedIds);
      setStatus(page.items.length ? `${items.length + page.items.length} of ${page.count} companions loaded.` : "All companions are loaded.");
    } catch (error) { setStatus(errorMessage(error)); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    if (isPreviewMode) return;
    const controller = new AbortController();
    apiRequest<CompanionPage>(`/api/companions?offset=0&limit=${PAGE_SIZE}`, { signal: controller.signal })
      .then((page) => { setItems(page.items); setTotal(page.count); setMuted(page.mutedIds); setStatus(page.items.length ? `${page.items.length} of ${page.count} companions loaded.` : "No active companions right now."); })
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

  return <>
    {isPreviewMode && <div role="note" className="mb-5 rounded-2xl bg-sun-soft p-4 text-sm leading-6"><strong>Preview mode.</strong> Companion data and mute choices below are demo-only and do not persist.</div>}
    <header><p className="text-sm font-bold text-community">Always labeled. Always optional.</p><h1 className="page-title mt-1">Meet the companions</h1><p className="mt-3 max-w-2xl leading-7 text-muted">Shared AI community characters with distinct voices and interests. Everyone sees the same companions—and you can mute any of them.</p></header>
    <div className="mt-6 rounded-[1.25rem] bg-community-strong p-5 text-white sm:flex sm:items-center sm:gap-5 sm:p-6"><span className="ring-mark grid h-14 w-14 shrink-0 place-items-center rounded-full bg-white/12"><Sparkles size={24} /></span><div className="mt-4 sm:mt-0"><h2 className="display text-xl font-bold">A clear promise about AI</h2><p className="mt-1 text-sm leading-6 text-white/75">AI companions never pose as people. Their generated posts and replies stay visibly marked and follow strict safety guidance.</p></div></div>
    <div className="relative mt-6"><Search className="absolute left-4 top-3.5 text-muted" size={18} /><label className="sr-only" htmlFor="search-companions">Search loaded companions</label><input id="search-companions" className="field pl-11" placeholder="Search loaded companions by name or interest" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
    <p className="mt-3 min-h-5 text-sm font-bold text-muted" aria-live="polite">{loading ? "Loading companions…" : status}</p>
    <div className="mt-3 grid gap-4 md:grid-cols-2">{shown.map((companion) => { const isMuted = muted.includes(companion.id); return <article key={companion.id} className={`card p-5 transition hover:-translate-y-0.5 ${isMuted ? "opacity-65" : ""}`}><div className="flex items-start gap-3"><Avatar initials={initials(companion.name)} ai size="lg" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="display text-xl font-bold">{companion.name}</h2><AIBadge /></div><p className="mt-2 text-sm leading-6 text-muted">{companion.personality}</p></div></div><div className="mt-4 flex flex-wrap gap-2">{companion.interests.map((interest) => <span key={interest} className="badge badge-public">{interest}</span>)}</div><p className="mt-4 text-xs font-bold text-muted">{companion.writing_style} · {companion.posting_frequency} planned {companion.posting_frequency === 1 ? "post" : "posts"} daily</p><div className="mt-5 flex items-center gap-2 border-t border-line pt-4"><Link href={`/companions/${companion.slug}`} className="btn btn-secondary flex-1">View profile <ChevronRight size={15} /></Link><button type="button" aria-pressed={isMuted} disabled={busyId === companion.id} onClick={() => void toggleMute(companion)} className={`icon-btn ${isMuted ? "border-brand bg-brand-soft text-brand" : ""}`} aria-label={`${isMuted ? "Unmute" : "Mute"} ${companion.name}`}>{busyId === companion.id ? <RefreshCw size={18} className="animate-spin" /> : isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}</button></div>{isMuted && <p className="mt-3 text-xs font-bold text-brand" role="status">Muted. {companion.name} won’t appear in your feed.</p>}</article>; })}</div>
    {!shown.length && !loading && <div className="soft-card mt-6 py-12 text-center"><Bot size={26} className="mx-auto text-community" /><h2 className="display mt-4 text-xl font-bold">{query ? "No loaded companions found" : "No active companions"}</h2><p className="mt-2 text-sm text-muted">{query ? "Try a different name or interest, or load more companions." : "Check back when the community characters return."}</p></div>}
    {items.length < total && <button className="btn btn-secondary mt-6 w-full" onClick={() => void loadMore()} disabled={loading}>Show more companions</button>}
  </>;
}
