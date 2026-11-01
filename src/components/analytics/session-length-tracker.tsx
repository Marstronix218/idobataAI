"use client";

import { useEffect } from "react";
import { isPreviewMode } from "@/lib/client/api";
import { createClient } from "@/lib/supabase/client";

export const SESSION_LENGTH_PATH = "/api/analytics/session";
/** The server clamps to this too. */
const MAX_SESSION_SECONDS = 86_400;

/**
 * Pivot A's session_length metric (SPEC Phase 7: the median session should
 * stay under 3 minutes). Counts foreground time only, like the session nudge:
 * from the moment the page is visible until it is hidden or closed. Each
 * foreground stretch is sent once, when it ends (hidden, pagehide, or leaving
 * the app shell); the server folds stretches less than 30 minutes apart into
 * one session. The request carries a number of seconds and nothing else.
 *
 * fetch with `keepalive`, not navigator.sendBeacon: a beacon cannot set
 * headers, and every API route authenticates with a bearer token, never
 * cookies (so they have no CSRF surface). keepalive gives the same promise that
 * the request outlives the page, and carries the token. The token is cached
 * from the auth client ahead of time, because reading the session is async and
 * a closing page does not wait for it.
 */
export function SessionLengthTracker() {
  useEffect(() => {
    if (isPreviewMode) return;

    let token: string | null = null;
    let listenerSpoke = false;
    let foregroundMs = 0;
    let visibleSince: number | null = document.visibilityState === "visible" ? Date.now() : null;

    const supabase = createClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      listenerSpoke = true;
      token = session?.access_token ?? null;
    });
    void supabase.auth.getSession().then(
      ({ data }) => { if (!listenerSpoke) token = data.session?.access_token ?? null; },
      () => undefined,
    );

    /** Ends the running stretch and sends it, once; a second call finds nothing to send. */
    const flush = () => {
      const now = Date.now();
      if (visibleSince !== null) {
        foregroundMs += now - visibleSince;
        visibleSince = null;
      }
      const durationSeconds = Math.min(MAX_SESSION_SECONDS, Math.round(foregroundMs / 1000));
      foregroundMs = 0;
      if (durationSeconds < 1 || !token) return;
      void fetch(SESSION_LENGTH_PATH, {
        method: "POST",
        keepalive: true,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ durationSeconds }),
      }).catch(() => undefined);
    };

    const resume = () => {
      if (document.visibilityState === "visible" && visibleSince === null) visibleSince = Date.now();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush();
      else resume();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", flush);
    // A page restored from the back/forward cache starts a new stretch.
    window.addEventListener("pageshow", resume);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("pageshow", resume);
      flush();
      subscription.unsubscribe();
    };
  }, []);

  return null;
}
