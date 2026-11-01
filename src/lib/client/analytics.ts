"use client";

import { apiRequest } from "@/lib/client/api";

/** Where a Plus notice is shown while there is no paywall (Phase 6 was skipped). */
export type PaywallSurface = "split" | "story";

/**
 * Records that a Plus notice was shown (POST /api/analytics/event). Sends the
 * surface only, never the task or chapter. The server keeps one a day per
 * surface. Fire and forget: never throws, never blocks the notice.
 */
export function recordPaywallView(detail: PaywallSurface): void {
  void apiRequest<void>("/api/analytics/event", {
    method: "POST",
    body: JSON.stringify({ name: "paywall_viewed", detail }),
  }).catch(() => undefined);
}
