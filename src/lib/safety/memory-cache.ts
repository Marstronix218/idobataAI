import "server-only";

import { createHmac, randomBytes } from "node:crypto";

// Small in-memory helpers for the distress-verdict cache and the crisis-counter
// dedupe. Nothing here is ever persisted or logged.
//
// Keys are HMACs, so the process never holds task text as a map key. The HMAC
// key is random per server instance: the caches are per-instance anyway, so a
// key that survives restarts or is shared between instances would add nothing,
// and a random one cannot be guessed or leaked through config.

const HMAC_KEY = randomBytes(32);

/** An opaque, per-instance key for `parts`. */
export function opaqueKey(...parts: string[]): string {
  const hmac = createHmac("sha256", HMAC_KEY);
  for (const part of parts) hmac.update(part).update("\u0000");
  return hmac.digest("base64url");
}

/**
 * A map with a size bound (oldest entries go first) and a time-to-live. Reads
 * refresh recency, so it behaves as an LRU.
 */
export class BoundedCache<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();

  constructor(private readonly maxEntries: number, private readonly ttlMs: number) {}

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    if (entry.expiresAt <= Date.now()) return undefined;
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  get size() {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}
