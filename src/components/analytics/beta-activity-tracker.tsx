"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { apiRequest, isPreviewMode } from "@/lib/client/api";

/**
 * Sends no page name or user content. Navigation only provides a convenient
 * activity pulse; the server deduplicates it into a daily active user and one
 * session window per 30 minutes.
 */
export function BetaActivityTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (isPreviewMode) return;
    void apiRequest<void>("/api/analytics/activity", { method: "POST" })
      .catch(() => undefined);
  }, [pathname]);

  return null;
}
