import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeSupabase, type Row } from "../helpers/fake-supabase";
import { EVENT_ID, NOW, TASK_ID, USER_ID, baseTables, isDistressRequest, isSplitRequest, message, pivotRpc } from "../helpers/pivot-fixtures";

const { createAdminClient, messagesCreate } = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  messagesCreate: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  const FakeAnthropic = Object.assign(
    vi.fn(function FakeAnthropic() { return { messages: { create: messagesCreate } }; }),
    {
      APIError: actual.APIError,
      APIConnectionError: actual.APIConnectionError,
      APIConnectionTimeoutError: actual.APIConnectionTimeoutError,
      APIUserAbortError: actual.APIUserAbortError,
    },
  );
  return { ...actual, default: FakeAnthropic, Anthropic: FakeAnthropic };
});

import { ApiError } from "@/lib/server/http";
import { getReaction } from "@/lib/reactions/engine";
import { SPEND_CACHE_MS, isAiSpendLimitReached, resetSpendBreakerForTests } from "@/lib/reactions/spend-breaker";
import { splitTask } from "@/lib/reactions/splitter";
import { resetCrisisDedupeForTests } from "@/lib/safety/counters";
import { resetDistressCacheForTests } from "@/lib/safety/distress";

type Params = Parameters<typeof isDistressRequest>[0];

// NOW is 2026-10-31T15:00Z, so "today" for the breaker is the UTC date 2026-10-31.
const TODAY_UTC = "2026-10-31";

let db: FakeSupabase;
let distressReply: () => unknown;

/** The breaker against the fake database (it takes a Supabase client). */
const limitReached = (fake: FakeSupabase = db) => isAiSpendLimitReached(fake as unknown as Parameters<typeof isAiSpendLimitReached>[0]);
const spend = (usd: number, date = TODAY_UTC): Row => ({ date, est_cost_usd: usd, updated_at: NOW.toISOString() });
const spendReads = () => db.from.mock.calls.filter(([table]) => table === "ai_spend_daily").length;
const rpcCalls = (name: string) => db.rpc.mock.calls.filter(([called]) => called === name).map(([, args]) => args as Record<string, unknown>);
const distressCalls = () => messagesCreate.mock.calls.filter(([params]) => isDistressRequest(params));
const reactionCalls = () => messagesCreate.mock.calls.filter(([params]) => !isDistressRequest(params) && !isSplitRequest(params));
const splitCalls = () => messagesCreate.mock.calls.filter(([params]) => isSplitRequest(params));
const spendWarnings = () => vi.mocked(console.warn).mock.calls.map(([line]) => String(line)).filter((line) => line.includes('"scope":"ai_spend"'));

function useDatabase(overrides: Partial<Record<string, Row[]>> = {}, errors?: Record<string, { message: string; code?: string }>) {
  db = createFakeSupabase(baseTables(overrides), { rpc: pivotRpc, errors });
  createAdminClient.mockReturnValue(db);
  return db;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("ANTHROPIC_API_KEY", "test-placeholder");
  vi.stubEnv("AI_ENABLED", "true");
  vi.stubEnv("AI_REACTION_TIMEOUT_MS", "");
  vi.stubEnv("AI_DISCLOSURE_MAX_GAP_HOURS", "");
  vi.stubEnv("AI_DAILY_SPEND_LIMIT_USD", "5");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "debug").mockImplementation(() => undefined);
  resetSpendBreakerForTests();
  resetDistressCacheForTests();
  resetCrisisDedupeForTests();
  distressReply = () => message('{"risk":"none"}');
  messagesCreate.mockImplementation((params: Params) => Promise.resolve(
    isDistressRequest(params)
      ? distressReply()
      : isSplitRequest(params)
        ? message(JSON.stringify({ steps: ["Fill the can", "Water the window plants", "Water the fern"] }))
        : message("Water the plants is underway. Start with the ones by the window, then take a breather."),
  ));
  useDatabase();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("isAiSpendLimitReached", () => {
  it("never stops AI, or reads the spend, without AI_DAILY_SPEND_LIMIT_USD", async () => {
    vi.stubEnv("AI_DAILY_SPEND_LIMIT_USD", "");
    useDatabase({ ai_spend_daily: [spend(1_000)] });

    expect(await limitReached()).toBe(false);
    expect(spendReads()).toBe(0);
  });

  it.each([
    [0, false],
    [4.99, false],
    [5, true],
    [12, true],
  ])("with $%s spent today against a $5 limit -> %s", async (usd, reached) => {
    useDatabase({ ai_spend_daily: [spend(usd), spend(100, "2026-10-30")] });

    expect(await limitReached()).toBe(reached);
  });

  it("treats a day with no spend row as $0, and a limit of 0 as AI off", async () => {
    expect(await limitReached()).toBe(false);
    resetSpendBreakerForTests();
    vi.stubEnv("AI_DAILY_SPEND_LIMIT_USD", "0");
    expect(await limitReached()).toBe(true);
  });

  it("caches the day's total for 60 seconds per instance, then reads it again", async () => {
    useDatabase({ ai_spend_daily: [spend(4)] });
    expect(await limitReached()).toBe(false);
    db.tables.ai_spend_daily[0].est_cost_usd = 6;

    vi.setSystemTime(NOW.getTime() + SPEND_CACHE_MS - 1);
    expect(await limitReached()).toBe(false);
    expect(spendReads()).toBe(1);

    vi.setSystemTime(NOW.getTime() + SPEND_CACHE_MS);
    expect(await limitReached()).toBe(true);
    expect(spendReads()).toBe(2);
  });

  it("starts each UTC day afresh, whatever the cache holds", async () => {
    vi.setSystemTime(new Date("2026-10-31T23:59:50.000Z"));
    useDatabase({ ai_spend_daily: [spend(9), spend(0.5, "2026-11-01")] });
    expect(await limitReached()).toBe(true);

    vi.setSystemTime(new Date("2026-11-01T00:00:10.000Z"));
    expect(await limitReached()).toBe(false);
    expect(spendReads()).toBe(2);
  });

  it("fails closed when the spend can't be read, and tries again on the next request", async () => {
    useDatabase({ ai_spend_daily: [spend(1)] }, { ai_spend_daily: { message: "boom", code: "57014" } });
    expect(await limitReached()).toBe(true);

    const healthy = useDatabase({ ai_spend_daily: [spend(1)] });
    expect(await limitReached(healthy)).toBe(false);
  });

  it("logs the limit once per read, with amounts only", async () => {
    useDatabase({ ai_spend_daily: [spend(7)] });
    await limitReached();
    await limitReached();

    expect(spendWarnings()).toHaveLength(1);
    expect(JSON.parse(spendWarnings()[0])).toMatchObject({ spendUsd: 7, limitUsd: 5 });
    expect(spendWarnings()[0]).not.toContain(USER_ID);
  });
});

describe("getReaction once the daily spend limit is reached", () => {
  it("shows the prewritten line with no reservation or AI call, but still runs the distress check", async () => {
    useDatabase({ ai_spend_daily: [spend(5)] });

    const result = await getReaction(USER_ID, EVENT_ID);

    expect(result).toMatchObject({ kind: "reaction", source: "prewritten" });
    expect(rpcCalls("reserve_ai_usage")).toEqual([]);
    expect(reactionCalls()).toHaveLength(0);
    expect(distressCalls()).toHaveLength(1);
  });

  it("still shows the crisis card when the distress model flags the task", async () => {
    useDatabase({ ai_spend_daily: [spend(50)] });
    distressReply = () => message('{"risk":"high"}');

    expect(await getReaction(USER_ID, EVENT_ID)).toEqual({ kind: "crisis" });
    expect(rpcCalls("increment_safety_counter")).toEqual([{ p_kind: "crisis_card_shown" }]);
  });

  it("uses AI as usual below the limit", async () => {
    useDatabase({ ai_spend_daily: [spend(1)] });

    expect(await getReaction(USER_ID, EVENT_ID)).toMatchObject({ kind: "reaction", source: "ai" });
    expect(reactionCalls()).toHaveLength(1);
  });
});

describe("splitTask once the daily spend limit is reached", () => {
  it("answers split_unavailable after the distress check, with no reservation or split call", async () => {
    useDatabase({ ai_spend_daily: [spend(5)] });

    const error = await splitTask(USER_ID, TASK_ID).then(() => null, (caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 503, code: "split_unavailable" });
    expect(distressCalls()).toHaveLength(1);
    expect(rpcCalls("reserve_ai_usage")).toEqual([]);
    expect(splitCalls()).toHaveLength(0);
    expect(rpcCalls("record_coach_product_event")).toEqual([]);
  });

  it("still shows the crisis card", async () => {
    useDatabase({ ai_spend_daily: [spend(5)] });
    distressReply = () => message('{"risk":"possible"}');

    expect(await splitTask(USER_ID, TASK_ID)).toEqual({ kind: "crisis" });
  });

  it("splits as usual below the limit", async () => {
    useDatabase({ ai_spend_daily: [spend(4.5)] });

    expect((await splitTask(USER_ID, TASK_ID)).kind).toBe("split");
  });
});
