import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeSupabase, type Row } from "../helpers/fake-supabase";
import { CHARACTER_ID, NOW, PLUS, TASK_ID, TODAY, USER_ID, baseTables, isDistressRequest, isSplitRequest, lineText, message, pivotRpc, usageRow } from "../helpers/pivot-fixtures";

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
import { parseSplitSteps, splitTask } from "@/lib/reactions/splitter";
import { resetCrisisDedupeForTests } from "@/lib/safety/counters";
import { resetDistressCacheForTests } from "@/lib/safety/distress";

type Params = Parameters<typeof isDistressRequest>[0] & { messages: Array<{ content: string }> };

let db: FakeSupabase;
let distressReply: () => unknown;
let splitReply: () => unknown;

const STEPS = ["Fill the watering can at the sink", "Water the plants by the window", "Water the hanging fern last"];
const rpcCalls = (name: string) => db.rpc.mock.calls.filter(([called]) => called === name).map(([, args]) => args as Record<string, unknown>);
const splitCalls = () => messagesCreate.mock.calls.filter(([params]) => isSplitRequest(params));

function useDatabase(overrides: Partial<Record<string, Row[]>> = {}) {
  db = createFakeSupabase(baseTables(overrides), { rpc: pivotRpc });
  createAdminClient.mockReturnValue(db);
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
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  resetDistressCacheForTests();
  resetCrisisDedupeForTests();
  distressReply = () => message('{"risk":"none"}', { usage: { ...message("").usage, input_tokens: 150, output_tokens: 8 } });
  splitReply = () => message(JSON.stringify({ steps: STEPS }), { usage: { ...message("").usage, input_tokens: 200, output_tokens: 40 } });
  messagesCreate.mockImplementation((params: Params) => Promise.resolve(isDistressRequest(params) ? distressReply() : splitReply()));
  useDatabase();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("splitTask", () => {
  it("returns three steps with a split_intro line in the character's voice, and counts one split", async () => {
    const result = await splitTask(USER_ID, TASK_ID);

    expect(result.kind).toBe("split");
    if (result.kind !== "split") return;
    expect(result.steps).toEqual(STEPS);
    expect(result.character).toEqual({ id: CHARACTER_ID, slug: "sample-coach", name: "Sample Coach (placeholder)", artUrl: null });
    expect([lineText("sample-coach.split_intro.001"), lineText("sample-coach.split_intro.002")].map((text) => text.replace("{task}", "Water the plants")))
      .toContain(result.intro);
    // The split slot is reserved atomically before the call and kept once delivered.
    expect(rpcCalls("reserve_ai_usage")).toEqual([{ p_user_id: USER_ID, p_kind: "split", p_date: TODAY, p_window_days: 1, p_cap: 10, p_attempt_ceiling: 20 }]);
    expect(rpcCalls("release_ai_usage")).toEqual([]);
    expect(usageRow(db)).toMatchObject({ splits: 1, split_attempts: 1 });
    expect(rpcCalls("record_ai_usage")).toEqual([expect.objectContaining({
      p_user_id: USER_ID,
      p_date: TODAY,
      p_reactions: 0,
      p_splits: 0,
      p_safety_checks: 1,
      p_aborted_calls: 0,
      p_input_tokens: 350,
      p_output_tokens: 48,
    })]);
  });

  it("asks for structured JSON with Haiku, thinking off, no sampling parameters and the 5 s deadline", async () => {
    await splitTask(USER_ID, TASK_ID);

    const [params, options] = splitCalls()[0] as [Record<string, unknown> & { output_config: { format: { type: string } } }, { timeout: number }];
    expect(params).toMatchObject({ model: "claude-haiku-5-5", max_tokens: 200, thinking: { type: "disabled" } });
    expect(params.output_config.format.type).toBe("json_schema");
    expect(params).not.toHaveProperty("temperature");
    expect(options.timeout).toBe(5000);
  });

  it("refuses a free user with plan_required after the safety check, with no split call", async () => {
    useDatabase({ entitlements: [] });

    const error = await apiError(splitTask(USER_ID, TASK_ID));

    expect(error.status).toBe(402);
    expect(error.code).toBe("plan_required");
    expect(splitCalls()).toHaveLength(0);
    // The safety check that did run is metered, but no split is counted.
    expect(rpcCalls("record_ai_usage")).toEqual([expect.objectContaining({ p_splits: 0, p_safety_checks: 1 })]);
  });

  it("shows a free user the crisis card, not the paywall, when the task suggests distress", async () => {
    useDatabase({
      entitlements: [],
      tasks: [{ id: TASK_ID, owner_id: USER_ID, title: "Clean up", description: "want to end it all", created_at: "2026-10-28T15:00:00.000Z" }],
    });

    expect(await splitTask(USER_ID, TASK_ID)).toEqual({ kind: "crisis" });
    expect(rpcCalls("increment_safety_counter")).toEqual([{ p_kind: "crisis_card_shown" }]);
  });

  it("shows the crisis card from the model check to a free user too", async () => {
    useDatabase({ entitlements: [] });
    distressReply = () => message('{"risk":"high"}');

    expect(await splitTask(USER_ID, TASK_ID)).toEqual({ kind: "crisis" });
  });

  it("lets a trial user split, whatever their experiment arm", async () => {
    useDatabase({
      entitlements: [{ ...PLUS, status: "trialing", trial_ends_at: "2026-11-10T00:00:00.000Z" }],
      user_coach_profiles: [{ user_id: USER_ID, selected_character_id: CHARACTER_ID, timezone: "America/Chicago", ai_arm: "prewritten" }],
    });

    expect((await splitTask(USER_ID, TASK_ID)).kind).toBe("split");
  });

  it("stops at 10 splits per local day with split_cap_reached", async () => {
    useDatabase({ ai_usage_daily: [{ user_id: USER_ID, date: TODAY, reactions: 0, splits: 10 }] });

    const error = await apiError(splitTask(USER_ID, TASK_ID));

    expect(error.status).toBe(429);
    expect(error.code).toBe("split_cap_reached");
    expect(splitCalls()).toHaveLength(0);
    expect(rpcCalls("record_ai_usage")[0]).toMatchObject({ p_safety_checks: 1 });
  });

  it("stops at the attempt ceiling of 20 failed or delivered splits a day", async () => {
    useDatabase({ ai_usage_daily: [{ user_id: USER_ID, date: TODAY, reactions: 0, splits: 2, reaction_attempts: 0, split_attempts: 20 }] });

    expect((await apiError(splitTask(USER_ID, TASK_ID))).code).toBe("split_cap_reached");
    expect(splitCalls()).toHaveLength(0);
  });

  it("shows the crisis card even when the split cap is used up", async () => {
    useDatabase({
      ai_usage_daily: [{ user_id: USER_ID, date: TODAY, reactions: 0, splits: 10 }],
      tasks: [{ id: TASK_ID, owner_id: USER_ID, title: "I can't go on", description: null, created_at: "2026-10-28T15:00:00.000Z" }],
    });

    expect(await splitTask(USER_ID, TASK_ID)).toEqual({ kind: "crisis" });
  });

  it("counts yesterday's splits toward yesterday only", async () => {
    useDatabase({ ai_usage_daily: [{ user_id: USER_ID, date: "2026-10-30", reactions: 0, splits: 10 }] });

    expect((await splitTask(USER_ID, TASK_ID)).kind).toBe("split");
  });

  it("returns the crisis card on a distress keyword, with no model call and no split counted", async () => {
    useDatabase({ tasks: [{ id: TASK_ID, owner_id: USER_ID, title: "Write my suicide note", description: null, created_at: "2026-10-28T15:00:00.000Z" }] });

    expect(await splitTask(USER_ID, TASK_ID)).toEqual({ kind: "crisis" });
    expect(messagesCreate).not.toHaveBeenCalled();
    expect(rpcCalls("increment_safety_counter")).toEqual([{ p_kind: "crisis_card_shown" }]);
    expect(rpcCalls("record_ai_usage")).toEqual([]);
  });

  it("returns the crisis card when the model check flags the task, before asking for a split", async () => {
    distressReply = () => message('{"risk":"possible"}');

    expect(await splitTask(USER_ID, TASK_ID)).toEqual({ kind: "crisis" });
    expect(splitCalls()).toHaveLength(0);
    expect(rpcCalls("increment_safety_counter")).toEqual([{ p_kind: "crisis_card_shown" }]);
    expect(rpcCalls("record_ai_usage")[0]).toMatchObject({ p_splits: 0, p_safety_checks: 1 });
  });

  it.each([
    ["two steps", () => message(JSON.stringify({ steps: STEPS.slice(0, 2) }))],
    ["a step over 12 words", () => message(JSON.stringify({ steps: [STEPS[0], "one two three four five six seven eight nine ten eleven twelve thirteen", STEPS[2]] }))],
    ["an empty step", () => message(JSON.stringify({ steps: [STEPS[0], "  ", STEPS[2]] }))],
    ["banned content", () => message(JSON.stringify({ steps: [STEPS[0], "As your therapist, I say water them", STEPS[2]] }))],
    ["text that is not JSON", () => message("Sure! Step one: fill the can.")],
    ["a refusal", () => message("", { stop_reason: "refusal" })],
    ["a reply cut off at max_tokens", () => message('{"steps":["Fill', { stop_reason: "max_tokens" })],
  ])("answers 503 split_unavailable for %s, metering the call but counting no split", async (_name, reply) => {
    splitReply = reply;

    const error = await apiError(splitTask(USER_ID, TASK_ID));

    expect(error.status).toBe(503);
    expect(error.code).toBe("split_unavailable");
    expect(error.message).not.toMatch(/json|refus|token|schema/i);
    expect(rpcCalls("record_ai_usage")[0]).toMatchObject({ p_splits: 0, p_safety_checks: 1 });
    // The undelivered split goes back to the allowance; the attempt stays counted.
    expect(rpcCalls("release_ai_usage")).toEqual([{ p_user_id: USER_ID, p_kind: "split", p_date: TODAY }]);
    expect(usageRow(db)).toMatchObject({ splits: 0, split_attempts: 1 });
  });

  it("answers 503 split_unavailable when the model never answers, and meters the aborted call", async () => {
    splitReply = () => new Promise(() => undefined);

    const pending = apiError(splitTask(USER_ID, TASK_ID));
    await vi.advanceTimersByTimeAsync(5000);
    const error = await pending;

    expect(error.code).toBe("split_unavailable");
    expect(rpcCalls("record_ai_usage")[0]).toMatchObject({ p_splits: 0, p_aborted_calls: 1, p_output_tokens: 200 + 8 });
    expect(rpcCalls("release_ai_usage")).toHaveLength(1);
  });

  it("answers 503 split_unavailable without a model configured", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");

    expect((await apiError(splitTask(USER_ID, TASK_ID))).code).toBe("split_unavailable");
    expect(messagesCreate).not.toHaveBeenCalled();
    expect(rpcCalls("reserve_ai_usage")).toEqual([]);
  });

  it("answers 503 split_unavailable, with no call, when the reservation cannot be made", async () => {
    db = createFakeSupabase(baseTables(), {
      rpc: (name, args, fake) => (name === "reserve_ai_usage" ? { data: null, error: { message: "boom", code: "XX000" } } : pivotRpc(name, args, fake)),
    });
    createAdminClient.mockReturnValue(db);

    expect((await apiError(splitTask(USER_ID, TASK_ID))).code).toBe("split_unavailable");
    expect(splitCalls()).toHaveLength(0);
    expect(rpcCalls("release_ai_usage")).toEqual([]);
  });

  it("fails closed when the distress classifier refuses", async () => {
    distressReply = () => message("", { stop_reason: "refusal" });

    expect(await splitTask(USER_ID, TASK_ID)).toEqual({ kind: "crisis" });
    expect(splitCalls()).toHaveLength(0);
  });

  it("counts a crisis card once per task per local day within 30 minutes", async () => {
    useDatabase({ tasks: [{ id: TASK_ID, owner_id: USER_ID, title: "I want to die", description: null, created_at: "2026-10-28T15:00:00.000Z" }] });

    await splitTask(USER_ID, TASK_ID);
    await splitTask(USER_ID, TASK_ID);

    expect(rpcCalls("increment_safety_counter")).toEqual([{ p_kind: "crisis_card_shown" }]);
  });

  it("does not consult the experiment arm", async () => {
    useDatabase({ user_coach_profiles: [{ user_id: USER_ID, selected_character_id: CHARACTER_ID, timezone: "America/Chicago", ai_arm: "prewritten" }] });

    expect((await splitTask(USER_ID, TASK_ID)).kind).toBe("split");
  });

  it("answers 404 for another user's task and 409 without a character", async () => {
    expect((await apiError(splitTask("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", TASK_ID))).status).toBe(404);

    useDatabase({ user_coach_profiles: [{ user_id: USER_ID, selected_character_id: null, timezone: null, ai_arm: null }] });
    const error = await apiError(splitTask(USER_ID, TASK_ID));
    expect(error.status).toBe(409);
    expect(error.code).toBe("character_required");
  });
});

describe("splitTask: the split_used event", () => {
  const splitUsed = () => rpcCalls("record_coach_product_event");

  it("records one content-free split_used for each delivered split", async () => {
    await splitTask(USER_ID, TASK_ID);
    await splitTask(USER_ID, TASK_ID);

    expect(splitUsed()).toEqual([
      { p_user_id: USER_ID, p_event_name: "split_used", p_detail: null, p_duration_seconds: null },
      { p_user_id: USER_ID, p_event_name: "split_used", p_detail: null, p_duration_seconds: null },
    ]);
    expect(JSON.stringify(splitUsed())).not.toMatch(/Water|plants|Fill/);
  });

  it.each([
    ["invalid model output", () => { splitReply = () => message("Sure! Step one: fill the can."); }],
    ["a free user (plan_required)", () => useDatabase({ entitlements: [] })],
    ["the daily split cap", () => useDatabase({ ai_usage_daily: [{ user_id: USER_ID, date: TODAY, reactions: 0, splits: 10 }] })],
    ["a crisis", () => { distressReply = () => message('{"risk":"high"}'); }],
  ])("records nothing for %s", async (_name, arrange) => {
    arrange();

    await splitTask(USER_ID, TASK_ID).catch((error: unknown) => expect(error).toBeInstanceOf(ApiError));

    expect(rpcCalls("record_ai_usage").length).toBeGreaterThan(0);
    expect(splitUsed()).toEqual([]);
  });

  it("still returns the split when the event cannot be written", async () => {
    db = createFakeSupabase(baseTables(), {
      rpc: (name, args, fake) => (name === "record_coach_product_event" ? { data: null, error: { message: "boom", code: "XX000" } } : pivotRpc(name, args, fake)),
    });
    createAdminClient.mockReturnValue(db);

    expect((await splitTask(USER_ID, TASK_ID)).kind).toBe("split");
  });
});

describe("parseSplitSteps", () => {
  it("masks the user's own title before checking for banned content", () => {
    const title = "Call lawyer about lease";
    const steps = ["Find the number to call lawyer about lease", "Write down three questions", "Call lawyer about lease"];

    expect(parseSplitSteps(JSON.stringify({ steps }), title)).toEqual(steps);
  });

  it("rejects a fourth step", () => {
    expect(parseSplitSteps(JSON.stringify({ steps: [...STEPS, "Rest"] }), "Water the plants")).toBeNull();
  });
});
