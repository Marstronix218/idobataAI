import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveFlags, type PivotFlagKey } from "@/lib/domain/feature-flags";
import { createFakeSupabase, type FakeSupabase, type Row } from "../helpers/fake-supabase";
import { CHARACTER_ID, EVENT_ID, NOW, TASK_ID, TODAY, USER_ID, baseTables, isDistressRequest, isSplitRequest, message, pivotRpc } from "../helpers/pivot-fixtures";

// The free beta (founder decision 2026-10-31): with beta_full_access.enabled
// and Pivot A on, every user gets Plus-level access through
// resolveEffectivePlan (src/lib/coach/plan.ts): Plus reaction caps, the
// splitter, every chapter by consistency days. The ai_arm experiment is
// unchanged, and packs are not granted.

const { createAdminClient, getFlags, messagesCreate } = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  getFlags: vi.fn(),
  messagesCreate: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
vi.mock("@/lib/flags", () => ({ getFlags }));
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

import { resolveEffectivePlan } from "@/lib/coach/plan";
import { readStoryChapter, readStoryOverview } from "@/lib/coach/story";
import { ApiError } from "@/lib/server/http";
import { getReaction } from "@/lib/reactions/engine";
import { splitTask } from "@/lib/reactions/splitter";
import { resetCrisisDedupeForTests } from "@/lib/safety/counters";
import { resetDistressCacheForTests } from "@/lib/safety/distress";
import { resetSpendBreakerForTests } from "@/lib/reactions/spend-breaker";

type Params = Parameters<typeof isDistressRequest>[0];

const PIVOT_BETA = { "pivot_a.enabled": true, "beta_full_access.enabled": true } as const;
const PIVOT_ONLY = { "pivot_a.enabled": true } as const;
const PACK: Row = { user_id: USER_ID, product: "pack:night-owl", status: "active", source: "app_store", trial_ends_at: null, current_period_end: null };

let db: FakeSupabase;

const useFlags = (rows: Partial<Record<PivotFlagKey, boolean>>) => getFlags.mockResolvedValue(resolveFlags(rows));
const rpcCalls = (name: string) => db.rpc.mock.calls.filter(([called]) => called === name).map(([, args]) => args as Record<string, unknown>);
const splitCalls = () => messagesCreate.mock.calls.filter(([params]) => isSplitRequest(params));

/** A free user (no entitlements) unless the overrides say otherwise. */
function seedDatabase(overrides: Partial<Record<string, Row[]>> = {}) {
  db = createFakeSupabase(baseTables({ entitlements: [], ...overrides }), { rpc: pivotRpc });
  createAdminClient.mockReturnValue(db);
  return db;
}

async function apiError(promise: Promise<unknown>) {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("ANTHROPIC_API_KEY", "test-placeholder");
  vi.stubEnv("AI_ENABLED", "true");
  vi.stubEnv("AI_REACTION_TIMEOUT_MS", "");
  vi.stubEnv("AI_DISCLOSURE_MAX_GAP_HOURS", "");
  vi.stubEnv("AI_DAILY_SPEND_LIMIT_USD", "");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "debug").mockImplementation(() => undefined);
  resetDistressCacheForTests();
  resetCrisisDedupeForTests();
  resetSpendBreakerForTests();
  messagesCreate.mockImplementation((params: Params) => Promise.resolve(
    isDistressRequest(params)
      ? message('{"risk":"none"}')
      : isSplitRequest(params)
        ? message(JSON.stringify({ steps: ["Fill the can", "Water the window plants", "Water the fern"] }))
        : message("Water the plants is underway. Start with the ones by the window, then take a breather."),
  ));
  useFlags(PIVOT_BETA);
  seedDatabase();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("resolveEffectivePlan", () => {
  it("makes a free user Plus, marked beta, keeping owned packs and granting none", async () => {
    expect(await resolveEffectivePlan([], NOW)).toEqual({ tier: "plus", packs: [], beta: true });
    expect(await resolveEffectivePlan([PACK as never], NOW)).toEqual({ tier: "plus", packs: ["night-owl"], beta: true });
  });

  it("leaves entitlements alone with the flag off, or with Pivot A off", async () => {
    useFlags(PIVOT_ONLY);
    expect(await resolveEffectivePlan([], NOW)).toEqual({ tier: "free", packs: [] });
    useFlags({ "beta_full_access.enabled": true });
    expect(await resolveEffectivePlan([], NOW)).toEqual({ tier: "free", packs: [] });
  });
});

describe("reactions under beta full access", () => {
  it("give a free user in the AI arm the Plus cap: 30 a local day", async () => {
    expect(await getReaction(USER_ID, EVENT_ID)).toMatchObject({ kind: "reaction", source: "ai" });
    expect(rpcCalls("reserve_ai_usage")).toEqual([{ p_user_id: USER_ID, p_kind: "reaction", p_date: TODAY, p_window_days: 1, p_cap: 30, p_attempt_ceiling: 60 }]);
  });

  it("stop at the Plus daily cap, not the free weekly one", async () => {
    seedDatabase({ ai_usage_daily: [{ user_id: USER_ID, date: TODAY, reactions: 30, splits: 0, reaction_attempts: 30, split_attempts: 0 }] });
    expect(await getReaction(USER_ID, EVENT_ID)).toMatchObject({ kind: "reaction", source: "prewritten" });

    // 3 yesterday would end a free user's week; under the beta it does not.
    seedDatabase({ ai_usage_daily: [{ user_id: USER_ID, date: "2026-10-30", reactions: 3, splits: 0, reaction_attempts: 3, split_attempts: 0 }] });
    expect(await getReaction(USER_ID, EVENT_ID)).toMatchObject({ kind: "reaction", source: "ai" });
  });

  it("keep the experiment: the prewritten arm stays prewritten (D1)", async () => {
    seedDatabase({ user_coach_profiles: [{ user_id: USER_ID, selected_character_id: CHARACTER_ID, timezone: "America/Chicago", ai_arm: "prewritten" }] });

    expect(await getReaction(USER_ID, EVENT_ID)).toMatchObject({ kind: "reaction", source: "prewritten" });
    expect(rpcCalls("reserve_ai_usage")).toEqual([]);
  });

  it("use the free weekly cap again with the flag off", async () => {
    useFlags(PIVOT_ONLY);

    await getReaction(USER_ID, EVENT_ID);

    expect(rpcCalls("reserve_ai_usage")).toEqual([expect.objectContaining({ p_window_days: 7, p_cap: 3 })]);
  });
});

describe("the splitter under beta full access", () => {
  it("lets a free user split, counted against the Plus cap of 10 a day", async () => {
    expect((await splitTask(USER_ID, TASK_ID)).kind).toBe("split");
    expect(rpcCalls("reserve_ai_usage")).toEqual([expect.objectContaining({ p_kind: "split", p_window_days: 1, p_cap: 10 })]);
  });

  it("still stops at 10 splits a day", async () => {
    seedDatabase({ ai_usage_daily: [{ user_id: USER_ID, date: TODAY, reactions: 0, splits: 10 }] });

    expect((await apiError(splitTask(USER_ID, TASK_ID))).code).toBe("split_cap_reached");
    expect(splitCalls()).toHaveLength(0);
  });

  it("answers plan_required again with the flag off", async () => {
    useFlags(PIVOT_ONLY);

    expect((await apiError(splitTask(USER_ID, TASK_ID))).code).toBe("plan_required");
  });
});

describe("the story under beta full access", () => {
  const chapters = Array.from({ length: 5 }, (_, index) => ({
    id: `ch-${index + 1}`, character_id: CHARACTER_ID, number: index + 1, title: `Title ${index + 1}`,
    body: `Body ${index + 1}`, unlock_rule: { consistency_days: index + 1 }, active: true,
  }));
  const seedStory = (consistencyDays: number) => seedDatabase({
    story_chapters: chapters,
    story_progress: [{ user_id: USER_ID, character_id: CHARACTER_ID, consistency_days: consistencyDays, unlocked_through: 0, last_consistency_date: "2026-10-30" }],
  });
  const locks = (overview: Awaited<ReturnType<typeof readStoryOverview>>) => overview.chapters.map((chapter) => chapter.lock?.reason ?? "open");

  it("opens every chapter past 3 by consistency days, with no Plus lock", async () => {
    seedStory(4);
    const client = db as unknown as Parameters<typeof readStoryOverview>[0];

    expect(locks(await readStoryOverview(client, USER_ID, NOW))).toEqual(["open", "open", "open", "open", "days"]);
    expect(await readStoryChapter(client, USER_ID, 4, NOW)).toMatchObject({ number: 4, body: "Body 4" });
    // Still never by time in the app: chapter 5 waits for its fifth day.
    expect(await readStoryChapter(client, USER_ID, 5, NOW)).toBeNull();
  });

  it("shows the Plus lock past chapter 3 again with the flag off", async () => {
    useFlags(PIVOT_ONLY);
    seedStory(4);
    const client = db as unknown as Parameters<typeof readStoryOverview>[0];

    expect(locks(await readStoryOverview(client, USER_ID, NOW))).toEqual(["open", "open", "open", "plan", "plan"]);
    expect(await readStoryChapter(client, USER_ID, 4, NOW)).toBeNull();
  });
});
