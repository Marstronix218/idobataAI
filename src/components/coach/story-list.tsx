"use client";

import Link from "next/link";
import { ArrowLeft, BookOpen, LockKeyhole } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { StoryChapterContent, StoryChapterLock, StoryChapterSummary, StoryOverview } from "@idobata/contracts";
import { CharacterAvatar } from "@/components/coach/character-picker";
import { apiRequest } from "@/lib/client/api";

type Reader = { number: number; title: string; chapter: StoryChapterContent | null; failed: boolean };

/** Plain-text bodies: a blank line starts a new paragraph. */
function paragraphs(body: string) {
  return body.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
}

function LockNote({ lock }: { lock: StoryChapterLock | null }) {
  if (lock?.reason === "days") {
    // `daysNeeded` counts the days still to come. TODO(founder): copy.
    return <p className="mt-1 text-sm text-muted">Unlocks after {lock.daysNeeded} more {lock.daysNeeded === 1 ? "day" : "days"} with a finished task.</p>;
  }
  if (lock?.reason === "plan") {
    // TODO(founder): copy. Phase 6 replaces this notice with the real paywall.
    return <p className="mt-1 text-sm text-muted">This chapter comes with Plus.</p>;
  }
  return null;
}

/**
 * The selected character's chapters. An unlocked chapter opens a reader that
 * fetches its body; a locked one shows its title and a calm, factual note, and
 * its body is never requested. Unlocks follow consistency days, never time in the app.
 */
export function StoryList() {
  const [overview, setOverview] = useState<StoryOverview | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [reader, setReader] = useState<Reader | null>(null);
  const chapters = useRef(new Map<number, StoryChapterContent>());
  const readerHeading = useRef<HTMLHeadingElement | null>(null);
  // The chapter whose Read button gets focus back when the reader closes.
  const returnTo = useRef<number | null>(null);
  const readingNumber = reader?.number ?? null;

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<StoryOverview>("/api/story", { signal: controller.signal }).then(
      (loaded) => { setOverview(loaded); setFailed(false); },
      () => { if (!controller.signal.aborted) setFailed(true); },
    );
    return () => controller.abort();
  }, [attempt]);

  useEffect(() => {
    if (readingNumber !== null) readerHeading.current?.focus();
    else if (returnTo.current !== null) document.getElementById(`story-read-${returnTo.current}`)?.focus();
  }, [readingNumber]);

  function openChapter({ number, title }: StoryChapterSummary) {
    returnTo.current = number;
    const cached = chapters.current.get(number) ?? null;
    setReader({ number, title, chapter: cached, failed: false });
    if (cached) return;
    apiRequest<StoryChapterContent>(`/api/story/${number}`).then(
      (chapter) => {
        chapters.current.set(number, chapter);
        setReader((current) => current?.number === number ? { ...current, chapter } : current);
      },
      () => setReader((current) => current?.number === number ? { ...current, failed: true } : current),
    );
  }

  if (reader) {
    return <article aria-labelledby="story-chapter-title">
      <button type="button" className="btn btn-ghost" onClick={() => setReader(null)}><ArrowLeft aria-hidden="true" size={16} /> All chapters</button>
      <p className="eyebrow mt-6">Chapter {reader.number}</p>
      <h1 id="story-chapter-title" ref={readerHeading} tabIndex={-1} className="page-title mt-2">{reader.chapter?.title ?? reader.title}</h1>
      <div className="mt-5 max-w-[65ch] space-y-4 text-base leading-7">
        {reader.chapter
          ? paragraphs(reader.chapter.body).map((paragraph, index) => <p key={index}>{paragraph}</p>)
          // TODO(founder): copy.
          : <p role="status" className="text-muted">{reader.failed ? "This chapter couldn’t load right now." : "Loading…"}</p>}
      </div>
    </article>;
  }

  return <section aria-labelledby="story-title">
    <h1 id="story-title" className="page-title">Story</h1>
    {failed ? (
      <div className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3">
        {/* TODO(founder): copy. */}
        <p role="status" className="min-w-0 flex-1 text-sm text-muted">The story couldn’t load right now.</p>
        <button type="button" className="btn btn-ghost" onClick={() => { setFailed(false); setAttempt((value) => value + 1); }}>Try again</button>
      </div>
    ) : !overview ? (
      <p role="status" className="mt-6 text-sm text-muted">Loading…</p>
    ) : !overview.character ? (
      // TODO(founder): copy.
      <p className="mt-6 text-sm text-muted">Choose a character to read their story. <Link href="/settings#character" className="font-bold text-brand hover:underline">Open Settings</Link></p>
    ) : <>
      <div className="mt-4 flex items-center gap-3">
        <CharacterAvatar character={{ name: overview.character.name, art_url: overview.character.artUrl }} size="md" />
        <p className="font-bold">{overview.character.name}</p>
      </div>
      {overview.chapters.length ? (
        <ol className="card mt-6 divide-y divide-line overflow-hidden" aria-label="Chapters">
          {overview.chapters.map((chapter) => <li key={chapter.number} className="flex items-start gap-3 px-4 py-4 sm:px-5">
            <span aria-hidden="true" className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full ${chapter.unlocked ? "bg-brand-soft text-brand" : "bg-surface-raised text-muted"}`}>
              {chapter.unlocked ? <BookOpen size={17} /> : <LockKeyhole size={17} />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-muted">Chapter {chapter.number}{chapter.unlocked ? "" : " · Locked"}</p>
              <h2 className="display mt-0.5 text-lg font-bold break-words">{chapter.title}</h2>
              {!chapter.unlocked && <LockNote lock={chapter.lock} />}
            </div>
            {chapter.unlocked && <button id={`story-read-${chapter.number}`} type="button" className="btn btn-primary shrink-0" aria-label={`Read chapter ${chapter.number}: ${chapter.title}`} onClick={() => openChapter(chapter)}>Read</button>}
          </li>)}
        </ol>
      ) : (
        // TODO(founder): copy.
        <p className="mt-6 text-sm text-muted">No chapters yet.</p>
      )}
    </>}
  </section>;
}
