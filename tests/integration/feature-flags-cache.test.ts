import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FAILSAFE_FLAGS, LEGACY_FLAGS, resolveFlags } from "@/lib/domain/feature-flags";

const { createAdminClient } = vi.hoisted(() => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));

import { getFlags, resetFlagCacheForTests } from "@/lib/flags";

type ReadResult = { data: Array<{ key: string; enabled: boolean }> | null; error: { message: string } | null };
type QueuedRead = ReadResult | Error | Promise<ReadResult>;

describe("getFlags", () => {
  const reads: QueuedRead[] = [];
  const select = vi.fn();
  const inKeys = vi.fn();

  beforeEach(() => {
    process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE = "false";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-01T00:00:00.000Z"));
    resetFlagCacheForTests();
    reads.length = 0;
    const query = {
      select: select.mockImplementation(() => query),
      in: inKeys.mockImplementation(() => query),
      abortSignal: vi.fn(() => {
        const next = reads.shift() ?? new Error("no read queued");
        return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
      }),
    };
    createAdminClient.mockReturnValue({ from: vi.fn(() => query) });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE = "true";
  });

  it("returns today's flags in demo mode without touching Supabase", async () => {
    process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE = "true";

    await expect(getFlags()).resolves.toBe(LEGACY_FLAGS);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("reads only the five Pivot A keys and resolves them", async () => {
    reads.push({ data: [{ key: "pivot_a.enabled", enabled: true }, { key: "social_feed.enabled", enabled: true }], error: null });

    await expect(getFlags()).resolves.toEqual(resolveFlags({ "pivot_a.enabled": true, "social_feed.enabled": true }));
    expect(select).toHaveBeenCalledWith("key, enabled");
    expect(inKeys).toHaveBeenCalledWith("key", [
      "pivot_a.enabled",
      "social_feed.enabled",
      "persona_chat.enabled",
      "persona_autopost.enabled",
      "share_win.enabled",
    ]);
  });

  it("serves the cached value for 30 seconds, then reads again", async () => {
    reads.push(
      { data: [{ key: "pivot_a.enabled", enabled: false }], error: null },
      { data: [{ key: "pivot_a.enabled", enabled: true }], error: null },
    );

    expect((await getFlags()).pivotA).toBe(false);
    vi.advanceTimersByTime(29_999);
    expect((await getFlags()).pivotA).toBe(false);
    expect(createAdminClient).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    expect((await getFlags()).pivotA).toBe(true);
    expect(createAdminClient).toHaveBeenCalledTimes(2);
  });

  it("shares one read between concurrent callers", async () => {
    let finish: (value: ReadResult) => void = () => undefined;
    reads.push(new Promise<ReadResult>((resolve) => { finish = resolve; }));

    const callers = [getFlags(), getFlags(), getFlags()];
    finish({ data: [{ key: "pivot_a.enabled", enabled: true }], error: null });
    const results = await Promise.all(callers);

    expect(createAdminClient).toHaveBeenCalledTimes(1);
    expect(results.every((flags) => flags.pivotA)).toBe(true);
  });

  it("keeps the last value read when a later read fails, and retries 5 seconds later", async () => {
    reads.push(
      { data: [{ key: "pivot_a.enabled", enabled: true }], error: null },
      { data: null, error: { message: "connection refused" } },
      { data: [{ key: "pivot_a.enabled", enabled: false }], error: null },
    );

    expect((await getFlags()).pivotA).toBe(true);
    vi.advanceTimersByTime(30_000);
    expect((await getFlags()).pivotA).toBe(true);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("connection refused"));

    vi.advanceTimersByTime(4_999);
    expect((await getFlags()).pivotA).toBe(true);
    expect(createAdminClient).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(1);
    expect((await getFlags()).pivotA).toBe(false);
    expect(createAdminClient).toHaveBeenCalledTimes(3);
  });

  it("fails closed on persona chat and autoposting when nothing has been read yet", async () => {
    reads.push(new Error("SUPABASE_SERVICE_ROLE_KEY is required for this request."), { data: [{ key: "pivot_a.enabled", enabled: true }], error: null });

    await expect(getFlags()).resolves.toBe(FAILSAFE_FLAGS);
    const logged = vi.mocked(console.error).mock.calls[0][0] as string;
    expect(JSON.parse(logged)).toEqual({ level: "error", scope: "feature_flags", message: "SUPABASE_SERVICE_ROLE_KEY is required for this request." });

    // The failure is held for 5 seconds rather than retried on every request.
    vi.advanceTimersByTime(4_999);
    await expect(getFlags()).resolves.toBe(FAILSAFE_FLAGS);
    expect(createAdminClient).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    expect((await getFlags()).pivotA).toBe(true);
  });

  it("does not let the fail-safe value become the last value read", async () => {
    reads.push(new Error("timeout"), new Error("timeout again"));

    await expect(getFlags()).resolves.toBe(FAILSAFE_FLAGS);
    vi.advanceTimersByTime(5_000);
    await expect(getFlags()).resolves.toBe(FAILSAFE_FLAGS);
    expect(createAdminClient).toHaveBeenCalledTimes(2);
  });
});
