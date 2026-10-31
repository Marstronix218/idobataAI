import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeSupabase, type Row } from "../helpers/fake-supabase";
import {
  CHARACTER_ID,
  EVENT_ID,
  NOW,
  OTHER_USER_ID,
  PLUS,
  TASK_ID,
  TODAY,
  USER_ID,
  baseTables,
  isDistressRequest,
  lineText,
  linesFor,
  message,
  pivotRpc,
  usageRow,
} from "../helpers/pivot-fixtures";

const { createAdminClient, messagesCreate } = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  messagesCreate: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
// The SDK itself is mocked: no request ever leaves the test. The real error
// classes stay, so the client's error handling is exercised as written.
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

import Anthropic from "@anthropic-ai/sdk";
import { AI_DISCLOSURE } from "@/lib/domain/ai-disclosure";
import { getReaction } from "@/lib/reactions/engine";
import { resetCrisisDedupeForTests } from "@/lib/safety/counters";
import { resetDistressCacheForTests } from "@/lib/safety/distress";

type Params = Parameters<typeof isDistressRequest>[0] & { system?: Array<{ text: string; cache_control?: unknown }>; messages: Array<{ content: string }> };
type Reply = (params: Params, options: { signal?: AbortSignal; timeout?: number }) => unknown;

let db: FakeSupabase;
let distressReply: Reply;
let reactionReply: Reply;

const never = () => new Promise(() => undefined);
const rpcCalls = (name: string) => db.rpc.mock.calls.filter(([called]) => called === name).map(([, args]) => args as Record<string, unknown>);
const distressCalls = () => messagesCreate.mock.calls.filter(([params]) => isDistressRequest(params));
const reactionCalls = () => messagesCreate.mock.calls.filter(([params]) => !isDistressRequest(params));

type FakeOptions = Parameters<typeof createFakeSupabase>[1];

function useDatabase(tables: Record<string, Row[]> = baseTables(), errors?: Record<string, { message: string; code?: string }>, options: FakeOptions = {}) {
  db = createFakeSupabase(tables, { errors, rpc: pivotRpc, ...options });
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
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "debug").mockImplementation(() => undefined);
  resetDistressCacheForTests();
  resetCrisisDedupeForTests();
  distressReply = () => message('{"risk":"none"}', { usage: { ...message("").usage, input_tokens: 150, output_tokens: 8 } });
  reactionReply = () => message("Water the plants is underway. Start with the ones by the window, then take a breather.");
  messagesCreate.mockImplementation((params: Params, options: { signal?: AbortSignal; timeout?: number }) =>
    Promise.resolve(isDistressRequest(params) ? distressReply(params, options) : reactionReply(params, options)));
  useDatabase();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("getReaction: sources", () => {
  it("delivers a valid AI reaction to a plus user in the AI arm, stores it and meters the calls", async () => {
    const result = await getReaction(USER_ID, EVENT_ID);

    expect(result).toEqual({
      kind: "reaction",
      text: "Water the plants is underway. Start with the ones by the window, then take a breather.",
      source: "ai",
      character: { id: CHARACTER_ID, slug: "sample-coach", name: "Sample Coach (placeholder)", artUrl: null },
      disclosure: AI_DISCLOSURE,
    });
    expect(db.inserted.character_reactions).toEqual([expect.objectContaining({
      user_id: USER_ID,
      task_event_id: EVENT_ID,
      character_id: CHARACTER_ID,
      source: "ai",
      line_id: null,
      event: "first_of_day",
      disclosure_shown: true,
    })]);
    // The slot was reserved atomically before the call and kept, since the line was delivered.
    expect(rpcCalls("reserve_ai_usage")).toEqual([{ p_user_id: USER_ID, p_kind: "reaction", p_date: TODAY, p_window_days: 1, p_cap: 30, p_attempt_ceiling: 60 }]);
    expect(rpcCalls("release_ai_usage")).toEqual([]);
    expect(usageRow(db)).toMatchObject({ reactions: 1, reaction_attempts: 1 });
    // Tokens and the safety check are metered separately; delivered counts come from the reservation.
    expect(rpcCalls("record_ai_usage")).toEqual([expect.objectContaining({
      p_user_id: USER_ID,
      p_date: TODAY,
      p_reactions: 0,
      p_splits: 0,
      p_safety_checks: 1,
      p_aborted_calls: 0,
      p_input_tokens: 550,
      p_output_tokens: 38,
      p_cost: 0.000074,
    })]);
  });

  it("sends a cached system block, the quoted title, and never the task note", async () => {
    useDatabase(baseTables({
      tasks: [{ id: TASK_ID, owner_id: USER_ID, title: "Water the plants", description: "private note about the balcony", created_at: "2026-10-28T15:00:00.000Z" }],
    }));

    await getReaction(USER_ID, EVENT_ID);

    const [params, options] = reactionCalls()[0] as [Params & Record<string, unknown>, { signal?: AbortSignal; timeout?: number }];
    expect(params).toMatchObject({ model: "claude-haiku-5-5", max_tokens: 120, thinking: { type: "disabled" } });
    expect(params).not.toHaveProperty("temperature");
    expect(params).not.toHaveProperty("top_p");
    expect(params.system).toHaveLength(1);
    expect(params.system?.[0].cache_control).toEqual({ type: "ephemeral" });
    expect(params.messages).toHaveLength(1);
    expect(params.messages[0].content).toContain('Task title: "Water the plants"');
    expect(JSON.stringify(params)).not.toContain("balcony");
    expect(options.timeout).toBeLessThanOrEqual(2500);
    expect(options.signal).toBeInstanceOf(AbortSignal);
    // The distress check does see the note.
    expect(JSON.stringify(distressCalls()[0][0])).toContain("balcony");
  });

  it("uses prewritten lines for every plan in the prewritten arm, with no AI reaction call", async () => {
    useDatabase(baseTables({ user_coach_profiles: [{ user_id: USER_ID, selected_character_id: CHARACTER_ID, timezone: "America/Chicago", ai_arm: "prewritten" }] }));

    const result = await getReaction(USER_ID, EVENT_ID);

    expect(result).toMatchObject({ kind: "reaction", source: "prewritten", disclosure: AI_DISCLOSURE });
    expect(reactionCalls()).toHaveLength(0);
    expect(distressCalls()).toHaveLength(1);
    const stored = db.inserted.character_reactions[0];
    expect(linesFor("first_of_day")).toContain(stored.line_id);
    expect(stored.text).toBe(lineText(String(stored.line_id)).replace("{task}", "Water the plants"));
    expect(rpcCalls("record_ai_usage")[0]).toMatchObject({ p_reactions: 0, p_safety_checks: 1 });
    expect(rpcCalls("reserve_ai_usage")).toEqual([]);
  });

  it("assigns and stores the experiment arm the first time, without overwriting one set meanwhile", async () => {
    useDatabase(baseTables({ user_coach_profiles: [{ user_id: USER_ID, selected_character_id: CHARACTER_ID, timezone: "America/Chicago", ai_arm: null }] }));

    await getReaction(USER_ID, EVENT_ID);

    const update = db.updated.user_coach_profiles?.[0];
    expect(["ai", "prewritten"]).toContain(update?.patch.ai_arm);
    const builder = db.from.mock.results.find((result, index) => db.from.mock.calls[index][0] === "user_coach_profiles" && result.value.update.mock.calls.length > 0)?.value;
    expect(builder.is).toHaveBeenCalledWith("ai_arm", null);
  });

  it("gives a free user no AI once 3 AI reactions were delivered in the last 7 local days", async () => {
    useDatabase(baseTables({
      entitlements: [],
      ai_usage_daily: [
        { user_id: USER_ID, date: "2026-10-25", reactions: 2, splits: 0 },
        { user_id: USER_ID, date: "2026-10-31", reactions: 1, splits: 0 },
      ],
    }));

    const result = await getReaction(USER_ID, EVENT_ID);

    expect(result).toMatchObject({ source: "prewritten" });
    expect(reactionCalls()).toHaveLength(0);
    expect(rpcCalls("reserve_ai_usage")).toEqual([expect.objectContaining({ p_window_days: 7, p_cap: 3, p_attempt_ceiling: 10 })]);
  });

  it("stops AI once the attempt ceiling is reached, even with delivered reactions under the cap", async () => {
    useDatabase(baseTables({ ai_usage_daily: [{ user_id: USER_ID, date: TODAY, reactions: 5, splits: 0, reaction_attempts: 60, split_attempts: 0 }] }));

    expect(await getReaction(USER_ID, EVENT_ID)).toMatchObject({ source: "prewritten" });
    expect(reactionCalls()).toHaveLength(0);
  });

  it("uses prewritten, with no AI call, when the reservation cannot be made", async () => {
    useDatabase(baseTables(), undefined, {
      rpc: (name, args, fake) => (name === "reserve_ai_usage" ? { data: null, error: { message: "boom", code: "XX000" } } : pivotRpc(name, args, fake)),
    });

    expect(await getReaction(USER_ID, EVENT_ID)).toMatchObject({ source: "prewritten" });
    expect(reactionCalls()).toHaveLength(0);
    expect(rpcCalls("release_ai_usage")).toEqual([]);
  });

  it("gives a free user AI again once the oldest reaction leaves the 7-day window", async () => {
    useDatabase(baseTables({
      entitlements: [],
      ai_usage_daily: [
        { user_id: USER_ID, date: "2026-10-24", reactions: 2, splits: 0 },
        { user_id: USER_ID, date: "2026-10-31", reactions: 1, splits: 0 },
      ],
    }));

    expect(await getReaction(USER_ID, EVENT_ID)).toMatchObject({ source: "ai" });
  });

  it("falls back to prewritten, instantly, when no API key is configured", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");

    const result = await getReaction(USER_ID, EVENT_ID);

    expect(result).toMatchObject({ source: "prewritten" });
    expect(messagesCreate).not.toHaveBeenCalled();
    expect(rpcCalls("record_ai_usage")).toEqual([]);
    expect(rpcCalls("reserve_ai_usage")).toEqual([]);
  });
});

describe("getReaction: AI failures fall back to the prewritten line", () => {
  it("returns the prewritten line in under 3 s when the SDK never answers, and meters the aborted call", async () => {
    reactionReply = () => never();
    const started = Date.now();

    const pending = getReaction(USER_ID, EVENT_ID);
    await vi.advanceTimersByTimeAsync(2500);
    const result = await pending;

    expect(Date.now() - started).toBeLessThan(3000);
    expect(result).toMatchObject({ kind: "reaction", source: "prewritten" });
    expect(db.inserted.character_reactions[0]).toMatchObject({ source: "prewritten" });
    const [usage] = rpcCalls("record_ai_usage");
    expect(usage).toMatchObject({ p_reactions: 0, p_safety_checks: 1, p_aborted_calls: 1 });
    // The undelivered slot goes back; the attempt stays counted.
    expect(rpcCalls("release_ai_usage")).toEqual([{ p_user_id: USER_ID, p_kind: "reaction", p_date: TODAY }]);
    expect(usageRow(db)).toMatchObject({ reactions: 0, reaction_attempts: 1 });
    // Estimated: prompt characters / 4 as input, max_tokens as output (plus the safety check's real usage).
    expect(usage.p_output_tokens).toBe(120 + 8);
    expect(Number(usage.p_input_tokens)).toBeGreaterThan(150);
    expect(Number(usage.p_cost)).toBeGreaterThan(0);
  });

  it("aborts the request at the deadline", async () => {
    let signal: AbortSignal | undefined;
    reactionReply = (_params, options) => { signal = options.signal; return never(); };

    const pending = getReaction(USER_ID, EVENT_ID);
    await vi.advanceTimersByTimeAsync(2500);
    await pending;

    expect(signal?.aborted).toBe(true);
  });

  it("counts the deadline from the start of the request", async () => {
    reactionReply = () => never();
    const startedAt = Date.now() - 2000;

    const pending = getReaction(USER_ID, EVENT_ID, { startedAt });
    await vi.advanceTimersByTimeAsync(500);

    await expect(pending).resolves.toMatchObject({ source: "prewritten" });
  });

  it.each([
    ["a refusal", () => message("", { stop_reason: "refusal", stop_details: { type: "refusal", category: null, explanation: null } })],
    ["a reply cut off at max_tokens", () => message("Water the plants is", { stop_reason: "max_tokens" })],
    ["a reply that never names the task", () => message("Nice start. Keep going, one small step at a time.")],
    ["a reply over 60 words", () => message(`Water the plants ${"now ".repeat(60)}`)],
    ["a reply with banned content", () => message("Water the plants, sweetheart. I'm a real person cheering you on.")],
    ["a reply that copies the {task} token", () => message("{task} is underway. Nice.")],
    ["a reply that leaks the character sheet", () => message("Water the plants. Notices the specific task, celebrates effort without fuss, and moves on.")],
    ["a timeout error from the SDK", () => Promise.reject(new Anthropic.APIConnectionTimeoutError())],
    ["an overloaded API", () => Promise.reject(new Anthropic.APIError(529, { type: "error" }, "Overloaded", new Headers()))],
    ["a connection error", () => Promise.reject(new Anthropic.APIConnectionError({ message: "socket hang up" }))],
  ])("falls back on %s, without telling the user", async (_name, reply) => {
    reactionReply = reply;

    const result = await getReaction(USER_ID, EVENT_ID);

    expect(result).toMatchObject({ kind: "reaction", source: "prewritten" });
    expect(JSON.stringify(result)).not.toMatch(/error|overloaded|refus/i);
    expect(rpcCalls("record_ai_usage")[0]).toMatchObject({ p_reactions: 0 });
    expect(rpcCalls("release_ai_usage")).toHaveLength(1);
    expect(usageRow(db)).toMatchObject({ reactions: 0 });
  });

  it("meters a refused reply's real token usage", async () => {
    reactionReply = () => message("", { stop_reason: "refusal" });

    await getReaction(USER_ID, EVENT_ID);

    expect(rpcCalls("record_ai_usage")[0]).toMatchObject({ p_aborted_calls: 0, p_input_tokens: 550, p_output_tokens: 38 });
  });
});

describe("getReaction: crisis routing", () => {
  function expectCrisisWithoutTrace(result: unknown) {
    expect(result).toEqual({ kind: "crisis" });
    expect(rpcCalls("increment_safety_counter")).toEqual([{ p_kind: "crisis_card_shown" }]);
    // No reaction row and no text anywhere.
    expect(db.inserted.character_reactions ?? []).toEqual([]);
    for (const [name, args] of db.rpc.mock.calls) expect(JSON.stringify([name, args])).not.toMatch(/plants|hopeless|myself/i);
  }

  it("routes SAFETY_ESCALATE to the crisis card, counts it and stores no reaction", async () => {
    reactionReply = () => message("SAFETY_ESCALATE");

    const result = await getReaction(USER_ID, EVENT_ID);

    expectCrisisWithoutTrace(result);
    // The call is still metered, but no reaction is counted.
    expect(rpcCalls("record_ai_usage")[0]).toMatchObject({ p_reactions: 0, p_safety_checks: 1, p_aborted_calls: 0 });
    expect(rpcCalls("release_ai_usage")).toHaveLength(1);
    expect(usageRow(db)).toMatchObject({ reactions: 0 });
  });

  it("shows the crisis card on a distress keyword in the note, without any model call", async () => {
    useDatabase(baseTables({
      tasks: [{ id: TASK_ID, owner_id: USER_ID, title: "Clean the kitchen", description: "honestly I want to hurt myself", created_at: "2026-10-28T15:00:00.000Z" }],
    }));

    const result = await getReaction(USER_ID, EVENT_ID);

    expectCrisisWithoutTrace(result);
    expect(messagesCreate).not.toHaveBeenCalled();
    expect(rpcCalls("record_ai_usage")).toEqual([]);
  });

  it("shows the crisis card when the model check answers possible, and stops the reaction call", async () => {
    useDatabase(baseTables({
      tasks: [{ id: TASK_ID, owner_id: USER_ID, title: "Feeling hopeless, sort laundry", description: null, created_at: "2026-10-28T15:00:00.000Z" }],
    }));
    distressReply = () => message('{"risk":"possible"}');
    let reactionSignal: AbortSignal | undefined;
    reactionReply = (_params, options) => { reactionSignal = options.signal; return never(); };

    const result = await getReaction(USER_ID, EVENT_ID);

    expectCrisisWithoutTrace(result);
    expect(reactionSignal?.aborted).toBe(true);
    // The cancelled call is metered as an ordinary one (estimated), so aborted_calls never marks a crisis.
    const [usage] = rpcCalls("record_ai_usage");
    expect(usage).toMatchObject({ p_reactions: 0, p_safety_checks: 1, p_aborted_calls: 0 });
    expect(usage.p_output_tokens).toBe(120 + 30);
    expect(rpcCalls("release_ai_usage")).toHaveLength(1);
  });

  it("treats a high model risk the same way, for a prewritten-arm user too", async () => {
    useDatabase(baseTables({ user_coach_profiles: [{ user_id: USER_ID, selected_character_id: CHARACTER_ID, timezone: "America/Chicago", ai_arm: "prewritten" }] }));
    distressReply = () => message('{"risk":"high"}');

    expect(await getReaction(USER_ID, EVENT_ID)).toEqual({ kind: "crisis" });
    expect(db.inserted.character_reactions ?? []).toEqual([]);
  });

  it("fails closed when the distress classifier refuses: crisis card, no banter", async () => {
    distressReply = () => message("", { stop_reason: "refusal" });

    expectCrisisWithoutTrace(await getReaction(USER_ID, EVENT_ID));
  });

  it.each([
    ["fails", () => Promise.reject(new Anthropic.APIError(500, { type: "error" }, "boom", new Headers()))],
    ["returns unreadable output", () => message("not json")],
  ])("still shows the reaction when the model check %s, and counts it as unavailable", async (_name, reply) => {
    distressReply = reply;

    const result = await getReaction(USER_ID, EVENT_ID);

    expect(result).toMatchObject({ kind: "reaction" });
    expect(rpcCalls("increment_safety_counter")).toEqual([{ p_kind: "distress_check_unavailable" }]);
  });

  it("still shows the reaction when the model check times out", async () => {
    distressReply = () => never();
    reactionReply = () => never();

    const pending = getReaction(USER_ID, EVENT_ID);
    await vi.advanceTimersByTimeAsync(2500);

    await expect(pending).resolves.toMatchObject({ kind: "reaction", source: "prewritten" });
    expect(rpcCalls("increment_safety_counter")).toEqual([{ p_kind: "distress_check_unavailable" }]);
  });
});

describe("getReaction: when there is nothing to show", () => {
  it("returns null for an event that already has a reaction, with no model call", async () => {
    useDatabase(baseTables({ character_reactions: [{ id: "r1", user_id: USER_ID, task_event_id: EVENT_ID, line_id: null, text: "x", created_at: NOW.toISOString(), disclosure_shown: false }] }));

    expect(await getReaction(USER_ID, EVENT_ID)).toBeNull();
    expect(messagesCreate).not.toHaveBeenCalled();
    expect(db.inserted.character_reactions ?? []).toEqual([]);
  });

  it("returns null without a selected character, after the safety check and with no reaction call", async () => {
    useDatabase(baseTables({ user_coach_profiles: [{ user_id: USER_ID, selected_character_id: null, timezone: null, ai_arm: "ai" }] }));

    expect(await getReaction(USER_ID, EVENT_ID)).toBeNull();
    expect(reactionCalls()).toHaveLength(0);
    expect(distressCalls()).toHaveLength(1);
  });

  it("returns null for another user's event", async () => {
    expect(await getReaction(OTHER_USER_ID, EVENT_ID)).toBeNull();
    expect(messagesCreate).not.toHaveBeenCalled();
  });

  it("returns null instead of throwing when the database fails", async () => {
    useDatabase(baseTables(), { task_events: { message: "connection reset", code: "08006" } });

    await expect(getReaction(USER_ID, EVENT_ID)).resolves.toBeNull();
  });

  it("fails before any model call when a first-round read fails, so no paid reaction is thrown away", async () => {
    db = createFakeSupabase(baseTables(), { errors: { entitlements: { message: "timeout", code: "57014" } } });
    createAdminClient.mockReturnValue(db);

    await expect(getReaction(USER_ID, EVENT_ID)).resolves.toBeNull();
    expect(messagesCreate).not.toHaveBeenCalled();
  });

  it("returns null when it cannot tell whether the event already has a reaction", async () => {
    useDatabase(baseTables(), { character_reactions: { message: "nope", code: "XX000" } });

    await expect(getReaction(USER_ID, EVENT_ID)).resolves.toBeNull();
  });

  it("still returns the reaction when storing it fails", async () => {
    useDatabase(baseTables(), undefined, { insertErrors: { character_reactions: { message: "nope", code: "XX000" } } });

    await expect(getReaction(USER_ID, EVENT_ID)).resolves.toMatchObject({ kind: "reaction", source: "ai" });
    // It was shown, so it counts as delivered.
    expect(rpcCalls("release_ai_usage")).toEqual([]);
  });
});

describe("getReaction: line choice and the daily AI reminder", () => {
  const earlierToday = (overrides: Row = {}) => ({ id: "r0", user_id: USER_ID, task_event_id: "other", line_id: "sample-coach.task_started.001", text: "earlier", created_at: "2026-10-31T13:00:00.000Z", disclosure_shown: true, ...overrides });

  beforeEach(() => {
    useDatabase(baseTables({ user_coach_profiles: [{ user_id: USER_ID, selected_character_id: CHARACTER_ID, timezone: "America/Chicago", ai_arm: "prewritten" }] }));
  });

  it("leaves the reminder off after one was shown earlier today, and avoids the line shown then", async () => {
    db.tables.character_reactions.push(earlierToday());

    const result = await getReaction(USER_ID, EVENT_ID);

    expect(result).toMatchObject({ disclosure: null });
    expect(db.inserted.character_reactions[0]).toMatchObject({ line_id: "sample-coach.task_started.002", event: "task_started", disclosure_shown: false });
  });

  it("shows the reminder again on the first reaction of a new local day", async () => {
    // 2026-10-31 03:00Z is still 2026-10-30 in Chicago.
    db.tables.character_reactions.push(earlierToday({ created_at: "2026-10-31T03:00:00.000Z" }));

    expect(await getReaction(USER_ID, EVENT_ID)).toMatchObject({ disclosure: AI_DISCLOSURE });
  });

  it("re-shows the reminder after AI_DISCLOSURE_MAX_GAP_HOURS when set", async () => {
    vi.stubEnv("AI_DISCLOSURE_MAX_GAP_HOURS", "1");
    db.tables.character_reactions.push(earlierToday({ created_at: "2026-10-31T13:30:00.000Z" }));

    expect(await getReaction(USER_ID, EVENT_ID)).toMatchObject({ disclosure: AI_DISCLOSURE });
  });

  it("welcomes the user back with a comeback line after a gap, with no guilt", async () => {
    db.tables.task_events.push({ id: "old-finish", user_id: USER_ID, task_id: "t-old", type: "finished", occurred_at: "2026-10-27T15:00:00.000Z", local_date: "2026-10-27", occurrence_key: "single" });

    await getReaction(USER_ID, EVENT_ID);

    const stored = db.inserted.character_reactions[0];
    expect(stored.event).toBe("comeback");
    expect(linesFor("comeback")).toContain(stored.line_id);
    expect(String(stored.text)).not.toMatch(/streak|missed|lost/i);
  });

  it("celebrates a running streak on the first finish of the day", async () => {
    db.tables.task_events = [
      { id: EVENT_ID, user_id: USER_ID, task_id: TASK_ID, type: "finished", occurred_at: NOW.toISOString(), local_date: TODAY, occurrence_key: "single" },
      { id: "f-1", user_id: USER_ID, task_id: "t1", type: "finished", occurred_at: "2026-10-30T15:00:00.000Z", local_date: "2026-10-30", occurrence_key: "single" },
      { id: "f-2", user_id: USER_ID, task_id: "t2", type: "finished", occurred_at: "2026-10-29T15:00:00.000Z", local_date: "2026-10-29", occurrence_key: "single" },
    ];

    await getReaction(USER_ID, EVENT_ID);

    // A 3-day streak matches sample-coach.streak.001 (2-4 days).
    expect(db.inserted.character_reactions[0]).toMatchObject({ event: "streak", line_id: "sample-coach.streak.001" });
  });

  it("works for a user whose time zone is unset (UTC)", async () => {
    db.tables.user_coach_profiles = [{ user_id: USER_ID, selected_character_id: CHARACTER_ID, timezone: null, ai_arm: "prewritten" }];
    db.tables.entitlements = [PLUS];

    expect(await getReaction(USER_ID, EVENT_ID)).toMatchObject({ kind: "reaction" });
  });
});

describe("getReaction: review fixes", () => {
  const prewrittenProfile = (overrides: Row = {}) => [{ user_id: USER_ID, selected_character_id: CHARACTER_ID, timezone: "America/Chicago", ai_arm: "prewritten", ...overrides }];
  const distressTask = (title: string) => [{ id: TASK_ID, owner_id: USER_ID, title, description: null, created_at: "2026-10-28T15:00:00.000Z" }];

  it("treats a lost insert race (23505) as already reacted: null, no error log, slot released", async () => {
    useDatabase(baseTables(), undefined, { insertErrors: { character_reactions: { message: "duplicate key", code: "23505" } } });

    expect(await getReaction(USER_ID, EVENT_ID)).toBeNull();
    expect(rpcCalls("release_ai_usage")).toHaveLength(1);
    expect(usageRow(db)).toMatchObject({ reactions: 0 });
    expect(console.error).not.toHaveBeenCalled();
  });

  it.each([
    ["no character selected", { user_coach_profiles: [{ user_id: USER_ID, selected_character_id: null, timezone: null, ai_arm: "ai" }] }],
    ["no coach profile at all", { user_coach_profiles: [] }],
    ["a deactivated character", { characters: [{ ...baseTables().characters[0], active: false }] }],
    ["a missing character", { characters: [] }],
  ])("routes a distress keyword to the crisis card with %s", async (_name, overrides) => {
    useDatabase(baseTables({ ...overrides, tasks: distressTask("I want to die") }));

    expect(await getReaction(USER_ID, EVENT_ID)).toEqual({ kind: "crisis" });
    expect(rpcCalls("increment_safety_counter")).toEqual([{ p_kind: "crisis_card_shown" }]);
    expect(db.inserted.character_reactions ?? []).toEqual([]);
  });

  it("runs the model check without a character too, and shows the card when it flags", async () => {
    useDatabase(baseTables({ characters: [{ ...baseTables().characters[0], active: false }], tasks: distressTask("Feeling hopeless") }));
    distressReply = () => message('{"risk":"possible"}');

    expect(await getReaction(USER_ID, EVENT_ID)).toEqual({ kind: "crisis" });
    expect(reactionCalls()).toHaveLength(0);
    expect(rpcCalls("reserve_ai_usage")).toEqual([]);
  });

  it("returns null after a clean model check when there is no character, metering the check", async () => {
    useDatabase(baseTables({ user_coach_profiles: [{ user_id: USER_ID, selected_character_id: null, timezone: null, ai_arm: "ai" }] }));

    expect(await getReaction(USER_ID, EVENT_ID)).toBeNull();
    expect(distressCalls()).toHaveLength(1);
    expect(rpcCalls("record_ai_usage")[0]).toMatchObject({ p_safety_checks: 1 });
  });

  it("counts a crisis card for the same event only once within 30 minutes", async () => {
    useDatabase(baseTables({ tasks: distressTask("I want to die") }));

    await getReaction(USER_ID, EVENT_ID);
    await getReaction(USER_ID, EVENT_ID);
    vi.setSystemTime(new Date(NOW.getTime() + 31 * 60_000));
    await getReaction(USER_ID, EVENT_ID);

    expect(rpcCalls("increment_safety_counter")).toEqual([{ p_kind: "crisis_card_shown" }, { p_kind: "crisis_card_shown" }]);
  });

  it("reuses a none verdict for the same task text later the same day, with no second model check", async () => {
    useDatabase(baseTables({ user_coach_profiles: prewrittenProfile() }));
    await getReaction(USER_ID, EVENT_ID);
    db.tables.task_events.push({ id: "finish-1", user_id: USER_ID, task_id: TASK_ID, type: "finished", occurred_at: NOW.toISOString(), local_date: TODAY, occurrence_key: "single" });

    expect(await getReaction(USER_ID, "finish-1")).toMatchObject({ kind: "reaction" });
    expect(distressCalls()).toHaveLength(1);
  });

  it("falls back to keywords once the user's daily model checks are used up, and still reacts", async () => {
    useDatabase(baseTables({ user_coach_profiles: prewrittenProfile() }), undefined, {
      rpc: (name, args, fake) => (name === "check_rate_limit" && args.p_bucket === "ai:distress" ? { data: false, error: null } : pivotRpc(name, args, fake)),
    });

    expect(await getReaction(USER_ID, EVENT_ID)).toMatchObject({ kind: "reaction" });
    expect(distressCalls()).toHaveLength(0);
    expect(rpcCalls("check_rate_limit")).toEqual([{ p_actor_key: USER_ID, p_bucket: "ai:distress", p_limit: 300, p_window_seconds: 86_400 }]);
    expect(rpcCalls("increment_safety_counter")).toEqual([{ p_kind: "distress_check_unavailable" }]);
  });

  it("gives the distress check a slice of its own when loading was slow, but still answers within 3 s", async () => {
    // 1.5 s already spent: the AI deadline leaves 1 s, the distress slice gets 1.2 s.
    const startedAt = Date.now() - 1500;
    distressReply = () => never();
    reactionReply = () => never();

    const pending = getReaction(USER_ID, EVENT_ID, { startedAt });
    await vi.advanceTimersByTimeAsync(1200);
    const result = await pending;

    expect(distressCalls()[0][1].timeout).toBe(1200);
    expect(Date.now() - startedAt).toBeLessThan(3000);
    expect(result).toMatchObject({ source: "prewritten" });
  });

  it("cuts the distress slice at the 2.9 s ceiling, keeping the whole request under 3 s", async () => {
    // 2.4 s already spent: clamp(100, 1200, 2500) would allow 1.2 s and finish at 3.6 s.
    const startedAt = Date.now() - 2400;
    distressReply = () => never();

    const pending = getReaction(USER_ID, EVENT_ID, { startedAt });
    await vi.advanceTimersByTimeAsync(500);
    const result = await pending;

    expect(distressCalls()[0][1].timeout).toBe(500);
    expect(Date.now() - startedAt).toBeLessThan(3000);
    // Too little time left for an AI reaction: the prewritten line, with no reservation.
    expect(reactionCalls()).toHaveLength(0);
    expect(rpcCalls("reserve_ai_usage")).toEqual([]);
    expect(result).toMatchObject({ source: "prewritten" });
  });

  it("skips the model check with under 300 ms to the ceiling: the keyword result stands, counted as unavailable", async () => {
    const startedAt = Date.now() - 2700;

    const result = await getReaction(USER_ID, EVENT_ID, { startedAt });

    expect(distressCalls()).toHaveLength(0);
    expect(rpcCalls("increment_safety_counter")).toEqual([{ p_kind: "distress_check_unavailable" }]);
    expect(result).toMatchObject({ kind: "reaction", source: "prewritten" });
  });

  it("never gives the distress check more than 2.5 s", async () => {
    vi.stubEnv("AI_REACTION_TIMEOUT_MS", "6000");

    await getReaction(USER_ID, EVENT_ID);

    expect(distressCalls()[0][1].timeout).toBeLessThanOrEqual(2500);
  });

  it("measures the comeback gap from any activity: a start yesterday means no welcome back", async () => {
    useDatabase(baseTables({ user_coach_profiles: prewrittenProfile() }));
    db.tables.task_events.push(
      { id: "old-finish", user_id: USER_ID, task_id: "t-old", type: "finished", occurred_at: "2026-10-26T15:00:00.000Z", local_date: "2026-10-26", occurrence_key: "single" },
      { id: "yesterday-start", user_id: USER_ID, task_id: "t-y", type: "started", occurred_at: "2026-10-30T15:00:00.000Z", local_date: "2026-10-30", occurrence_key: null },
    );

    await getReaction(USER_ID, EVENT_ID);

    expect(db.inserted.character_reactions[0].event).toBe("first_of_day");
  });

  it("avoids the last 20 prewritten lines even when newer AI reactions have no line id", async () => {
    useDatabase(baseTables({ user_coach_profiles: prewrittenProfile() }));
    const aiReactions = Array.from({ length: 20 }, (_, index) => ({
      id: `ai-${index}`, user_id: USER_ID, task_event_id: `e-${index}`, line_id: null, text: "ai line",
      created_at: new Date(Date.parse("2026-10-30T20:00:00.000Z") + index * 60_000).toISOString(), disclosure_shown: false,
    }));
    // Older than all 20 AI reactions, but still among the last 20 prewritten lines.
    const older = { id: "pw-1", user_id: USER_ID, task_event_id: "e-old", line_id: "sample-coach.first_of_day.001", text: "old", created_at: "2026-10-29T15:00:00.000Z", disclosure_shown: false };
    db.tables.character_reactions.push(older, ...aiReactions);

    await getReaction(USER_ID, EVENT_ID);

    expect(db.inserted.character_reactions[0]).toMatchObject({ event: "first_of_day", line_id: "sample-coach.first_of_day.002" });
  });
});

describe("getReaction: final review batch", () => {
  const distressTitle = (title: string) => [{ id: TASK_ID, owner_id: USER_ID, title, description: null, created_at: "2026-10-28T15:00:00.000Z" }];

  it("in safety-only mode returns the crisis card for distress text", async () => {
    useDatabase(baseTables({ tasks: distressTitle("I want to die") }));

    expect(await getReaction(USER_ID, EVENT_ID, { safetyOnly: true })).toEqual({ kind: "crisis" });
    expect(rpcCalls("increment_safety_counter")).toEqual([{ p_kind: "crisis_card_shown" }]);
  });

  it("in safety-only mode runs the model check but no banter: no reservation, AI call or stored reaction", async () => {
    expect(await getReaction(USER_ID, EVENT_ID, { safetyOnly: true })).toBeNull();
    expect(distressCalls()).toHaveLength(1);
    expect(reactionCalls()).toHaveLength(0);
    expect(rpcCalls("reserve_ai_usage")).toEqual([]);
    expect(db.inserted.character_reactions ?? []).toEqual([]);

    distressReply = () => message('{"risk":"possible"}');
    db.tables.tasks[0].title = "Feeling hopeless";
    expect(await getReaction(USER_ID, EVENT_ID, { safetyOnly: true })).toEqual({ kind: "crisis" });
  });

  it("counts at most 5 crisis cards per user per UTC day, while always showing the card", async () => {
    useDatabase(baseTables({ tasks: distressTitle("I want to die") }));
    for (let index = 0; index < 7; index += 1) {
      const id = `crisis-event-${index}`;
      db.tables.task_events.push({ id, user_id: USER_ID, task_id: TASK_ID, type: "started", occurred_at: NOW.toISOString(), local_date: TODAY, occurrence_key: null });
      expect(await getReaction(USER_ID, id)).toEqual({ kind: "crisis" });
    }
    expect(rpcCalls("increment_safety_counter")).toHaveLength(5);

    // A new UTC day counts again.
    vi.setSystemTime(new Date("2026-11-01T15:00:00.000Z"));
    db.tables.task_events.push({ id: "next-day", user_id: USER_ID, task_id: TASK_ID, type: "started", occurred_at: new Date().toISOString(), local_date: "2026-11-01", occurrence_key: null });
    await getReaction(USER_ID, "next-day");
    expect(rpcCalls("increment_safety_counter")).toHaveLength(6);
  });

  it("gives a free user an attempt ceiling of 10, so a short outage cannot end their week of AI", async () => {
    useDatabase(baseTables({
      entitlements: [],
      ai_usage_daily: [{ user_id: USER_ID, date: "2026-10-30", reactions: 0, splits: 0, reaction_attempts: 9, split_attempts: 0 }],
    }));

    expect(await getReaction(USER_ID, EVENT_ID)).toMatchObject({ source: "ai" });
    expect(rpcCalls("reserve_ai_usage")).toEqual([expect.objectContaining({ p_window_days: 7, p_cap: 3, p_attempt_ceiling: 10 })]);
  });

  it("reserves only when the call is made: no reservation when too little time is left", async () => {
    await getReaction(USER_ID, EVENT_ID, { startedAt: Date.now() - 2300 });

    expect(rpcCalls("reserve_ai_usage")).toEqual([]);
    expect(reactionCalls()).toHaveLength(0);
    expect(usageRow(db)).toBeUndefined();
  });

  it("makes the call once reserved, even if the reservation itself was slow", async () => {
    reactionReply = () => never();
    useDatabase(baseTables(), undefined, {
      rpc: (name, args, fake) => {
        // The reservation takes 300 ms, leaving less than the 300 ms an AI call would need to start.
        if (name === "reserve_ai_usage") vi.setSystemTime(new Date(Date.now() + 300));
        return pivotRpc(name, args, fake);
      },
    });

    const pending = getReaction(USER_ID, EVENT_ID, { startedAt: Date.now() - 2000 });
    await vi.advanceTimersByTimeAsync(500);
    await pending;

    expect(rpcCalls("reserve_ai_usage")).toHaveLength(1);
    expect(reactionCalls()).toHaveLength(1);
    expect(usageRow(db)).toMatchObject({ reaction_attempts: 1, reactions: 0 });
  });
});
