"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";
import type { SessionNudge as SessionNudgeResult } from "@idobata/contracts";
import { AiDisclosure } from "@/components/coach/ai-disclosure";
import { CharacterAvatar } from "@/components/coach/character-picker";
import { apiRequest } from "@/lib/client/api";

/**
 * GET /api/coach/nudge: a prewritten `session_nudge` line, or null.
 * `disclosure` is the AI reminder when this is the character's first line of the local day.
 */
type SessionNudgeLine = NonNullable<SessionNudgeResult>;

/** Foreground time in one session before the character suggests closing the app. */
export const NUDGE_AFTER_MS = 10 * 60_000;
/** Hidden for at least this long, the next visible moment starts a new session. */
export const SESSION_GAP_MS = 30 * 60_000;
export const SESSION_STORAGE_KEY = "idobata:session-nudge";

/** `savedAt` is when the state was last written; a gap of SESSION_GAP_MS since then starts a new session. */
type Session = { foregroundMs: number; fetched: boolean; savedAt: number };

const freshSession = (now: number): Session => ({ foregroundMs: 0, fetched: false, savedAt: now });

/**
 * sessionStorage only carries the timer across a reload in the same tab. It is
 * optional: without it, each page load is its own session.
 */
function readSession(now: number): Session {
  try {
    const stored: unknown = JSON.parse(window.sessionStorage.getItem(SESSION_STORAGE_KEY) ?? "null");
    if (
      stored && typeof stored === "object"
      && "foregroundMs" in stored && typeof stored.foregroundMs === "number" && stored.foregroundMs >= 0
      && "fetched" in stored && typeof stored.fetched === "boolean"
      && "savedAt" in stored && typeof stored.savedAt === "number"
      && stored.savedAt <= now && now - stored.savedAt < SESSION_GAP_MS
    ) return { foregroundMs: stored.foregroundMs, fetched: stored.fetched, savedAt: stored.savedAt };
  } catch {
    // Storage blocked or malformed: start a fresh in-memory session.
  }
  return freshSession(now);
}

function writeSession(session: Session) {
  try {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // The in-memory session keeps working.
  }
}

/**
 * Pivot A: after 10 minutes of foreground time in one session, the character
 * suggests closing the app, once. Time counts only while the page is visible;
 * a session ends after 30 minutes hidden. A failed or empty fetch shows nothing,
 * and the line never comes back that session. No sound, no modal, no focus grab.
 */
export function SessionNudge() {
  const [nudge, setNudge] = useState<SessionNudgeLine | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let session = readSession(Date.now());
    let visibleSince: number | null = null;
    let hiddenAt: number | null = null;
    let timer: number | undefined;

    const save = (now: number) => {
      session = { ...session, savedAt: now };
      writeSession(session);
    };

    const fetchNudge = () => {
      // Marked first, so whatever the outcome there is no second request this session.
      session = { ...session, fetched: true };
      save(Date.now());
      apiRequest<SessionNudgeResult>("/api/coach/nudge", { signal: controller.signal })
        .then((line) => { if (line?.text && line.character) setNudge(line); }, () => undefined);
    };

    const startCounting = (now: number) => {
      visibleSince = now;
      if (session.fetched) return;
      timer = window.setTimeout(fetchNudge, Math.max(0, NUDGE_AFTER_MS - session.foregroundMs));
    };

    const stopCounting = (now: number) => {
      window.clearTimeout(timer);
      if (visibleSince === null) return;
      session = { ...session, foregroundMs: session.foregroundMs + (now - visibleSince) };
      visibleSince = null;
    };

    const onVisibilityChange = () => {
      const now = Date.now();
      if (document.visibilityState === "hidden") {
        if (hiddenAt !== null) return;
        stopCounting(now);
        hiddenAt = now;
        save(now);
        return;
      }
      if (visibleSince !== null) return;
      if (hiddenAt !== null && now - hiddenAt >= SESSION_GAP_MS) {
        session = freshSession(now);
        setNudge(null);
      }
      hiddenAt = null;
      save(now);
      startCounting(now);
    };

    // A reload or tab close: bank the running stretch so the next page load
    // carries it. Counting carries on, in case the page is restored from the back/forward cache.
    const onPageHide = () => {
      const now = Date.now();
      if (visibleSince !== null) {
        session = { ...session, foregroundMs: session.foregroundMs + (now - visibleSince) };
        visibleSince = now;
      }
      if (hiddenAt === null) save(now);
    };

    if (document.visibilityState === "hidden") hiddenAt = Date.now();
    else startCounting(Date.now());
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
      const now = Date.now();
      stopCounting(now);
      // While hidden, keep the save from the moment it was hidden, so the gap still counts.
      if (hiddenAt === null) save(now);
      controller.abort();
    };
  }, []);

  return <div aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-24 z-50 flex justify-center lg:inset-x-auto lg:bottom-6 lg:right-6 lg:w-96">
    {nudge && <div className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-[1.25rem] border border-brand/30 bg-surface p-4 shadow-sm">
      <CharacterAvatar character={{ name: nudge.character.name, art_url: nudge.character.artUrl }} size="md" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold">{nudge.character.name}</p>
        <p className="mt-0.5 leading-6 break-words">{nudge.text}</p>
        {nudge.disclosure !== null && <AiDisclosure className="mt-2" />}
      </div>
      <button type="button" className="icon-btn h-11 w-11 shrink-0 border-0 bg-transparent" onClick={() => setNudge(null)} aria-label="Dismiss"><X aria-hidden="true" size={16} /></button>
    </div>}
  </div>;
}
