import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveFlags } from "@/lib/domain/feature-flags";
import { createFakeSupabase, type FakeSupabase, type Row } from "../helpers/fake-supabase";
import { NOW, TASK_ID, TODAY, USER_ID, baseTables, isDistressRequest, message, pivotRpc } from "../helpers/pivot-fixtures";

const { authed, createAdminClient, enforceRateLimit, getFlags, messagesCreate } = vi.hoisted(() => ({
  authed: vi.fn(),
  createAdminClient: vi.fn(),
  enforceRateLimit: vi.fn(),
  getFlags: vi.fn(),
  messagesCreate: vi.fn(),
}));

// The real withApi, parseJson, detector, counters and metering: only the
// session, flags, rate limiter, database and SDK are stand-ins.
vi.mock("@/lib/server/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/http")>()),
  authed,
}));
vi.mock("@/lib/flags", () => ({ getFlags }));
vi.mock("@/lib/server/rate-limit", () => ({ enforceRateLimit }));
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

import Anthropic from "@anthropic-ai/sdk";
import { PATCH } from "@/app/api/tasks/[id]/route";
import { POST } from "@/app/api/tasks/route";
import { ApiError } from "@/lib/server/http";
import { resetCrisisDedupeForTests } from "@/lib/safety/counters";
import { resetDistressCacheForTests } from "@/lib/safety/distress";

const KEYWORD_TEXT = "Write the note, I want to end it all";
const QUIET_TEXT = "Call my sister about the weekend";

let db: FakeSupabase;
let distressReply: () => unknown;
let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

function useDatabase(overrides: Partial<Record<string, Row[]>> = {}) {
  db = createFakeSupabase(baseTables(overrides), { rpc: pivotRpc });
  createAdminClient.mockReturnValue(db);
  authed.mockResolvedValue({ user: { id: USER_ID }, supabase: db });
}

const pivot = (enabled: boolean) => getFlags.mockResolvedValue(resolveFlags({ "pivot_a.enabled": enabled }));
const distressCalls = () => messagesCreate.mock.calls.filter(([params]) => isDistressRequest(params));
const rpcCalls = (name: string) => db.rpc.mock.calls.filter(([called]) => called === name).map(([, args]) => args as Record<string, unknown>);
const counters = () => rpcCalls("increment_safety_counter").map((args) => args.p_kind);

function create(body: Record<string, unknown>) {
  return POST(new Request("http://localhost/api/tasks", {
    method: "POST",
    headers: { authorization: "Bearer token" },
    body: JSON.stringify({ visibility: "private", ...body }),
  }));
}

function edit(body: Record<string, unknown>, id = TASK_ID) {
  return PATCH(new Request(`http://localhost/api/tasks/${id}`, {
    method: "PATCH",
    headers: { authorization: "Bearer token" },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ id }) });
}

async function data(response: Response) {
  return (await response.json() as { data: Row }).data;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("ANTHROPIC_API_KEY", "test-placeholder");
  vi.stubEnv("AI_ENABLED", "true");
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  resetDistressCacheForTests();
  resetCrisisDedupeForTests();
  distressReply = () => message('{"risk":"none"}', { usage: { ...message("").usage, input_tokens: 150, output_tokens: 8 } });
  messagesCreate.mockImplementation((params: Parameters<typeof isDistressRequest>[0]) =>
    isDistressRequest(params) ? Promise.resolve(distressReply()) : Promise.reject(new Error("unexpected model call")));
  enforceRateLimit.mockResolvedValue(undefined);
  pivot(true);
  useDatabase();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("POST /api/tasks under Pivot A", () => {
  it("saves a task whose text hits a keyword and asks for the crisis card, with no model call", async () => {
    const response = await create({ title: "Tidy the desk", description: KEYWORD_TEXT });

    expect(response.status).toBe(201);
    const body = await data(response);
    expect(body).toMatchObject({ title: "Tidy the desk", description: KEYWORD_TEXT, safety: { crisisCard: true } });
    // The user's text is saved as typed, and nothing else is.
    expect(db.inserted.tasks).toEqual([expect.objectContaining({ owner_id: USER_ID, title: "Tidy the desk", description: KEYWORD_TEXT })]);
    expect(db.inserted.tasks[0]).not.toHaveProperty("safety");
    expect(Object.keys(db.inserted)).toEqual(["tasks"]);
    expect(counters()).toEqual(["crisis_card_shown"]);
    expect(rpcCalls("increment_safety_counter")).toEqual([{ p_kind: "crisis_card_shown" }]);
    expect(messagesCreate).not.toHaveBeenCalled();
  });

  it.each(["possible", "high"])("asks for the crisis card when the model check answers %s", async (risk) => {
    distressReply = () => message(JSON.stringify({ risk }), { usage: { ...message("").usage, input_tokens: 150, output_tokens: 8 } });

    const response = await create({ title: QUIET_TEXT });

    expect(response.status).toBe(201);
    expect(await data(response)).toMatchObject({ title: QUIET_TEXT, safety: { crisisCard: true } });
    expect(distressCalls()).toHaveLength(1);
    expect(counters()).toEqual(["crisis_card_shown"]);
    // Metered as a safety check on the user's local day, through the same limiter as reactions.
    expect(rpcCalls("check_rate_limit")).toEqual([expect.objectContaining({ p_actor_key: USER_ID, p_bucket: "ai:distress", p_limit: 300 })]);
    expect(rpcCalls("record_ai_usage")).toEqual([expect.objectContaining({
      p_user_id: USER_ID, p_date: TODAY, p_reactions: 0, p_splits: 0, p_safety_checks: 1, p_input_tokens: 150, p_output_tokens: 8,
    })]);
    expect(Object.keys(db.inserted)).toEqual(["tasks"]);
  });

  it("keeps the keyword result and counts the check as unavailable when the model fails", async () => {
    messagesCreate.mockRejectedValue(new Anthropic.APIConnectionError({ message: "connection reset" }));

    const response = await create({ title: QUIET_TEXT });

    expect(response.status).toBe(201);
    const body = await data(response);
    expect(body).not.toHaveProperty("safety");
    expect(body.title).toBe(QUIET_TEXT);
    expect(counters()).toEqual(["distress_check_unavailable"]);
  });

  it("gives the model check at most 2.5 s, then answers without the card", async () => {
    messagesCreate.mockReturnValue(new Promise(() => undefined));

    const pending = create({ title: QUIET_TEXT });
    await vi.advanceTimersByTimeAsync(2500);
    const response = await pending;

    expect(response.status).toBe(201);
    expect(await data(response)).not.toHaveProperty("safety");
    expect(counters()).toEqual(["distress_check_unavailable"]);
    // The aborted call is still metered, with estimated tokens.
    expect(rpcCalls("record_ai_usage")).toEqual([expect.objectContaining({ p_safety_checks: 1, p_aborted_calls: 1 })]);
  });

  it("returns the saved task unchanged for benign text", async () => {
    const response = await create({ title: QUIET_TEXT });

    expect(response.status).toBe(201);
    const body = await data(response);
    expect(body).toEqual(db.inserted.tasks[0]);
    expect(body).not.toHaveProperty("safety");
    expect(counters()).toEqual([]);
    expect(distressCalls()).toHaveLength(1);
  });

  it("never stores or logs the task text outside the task itself", async () => {
    distressReply = () => message('{"risk":"high"}');
    await create({ title: QUIET_TEXT, description: "a private note" });
    messagesCreate.mockRejectedValue(new Error("boom"));
    await create({ title: "Another private title" });
    await create({ title: "Third", description: KEYWORD_TEXT });

    const outsideTasks = JSON.stringify([db.rpc.mock.calls, warn.mock.calls, error.mock.calls]);
    for (const text of [QUIET_TEXT, "a private note", "Another private title", KEYWORD_TEXT, "end it all"]) {
      expect(outsideTasks).not.toContain(text);
    }
    expect(Object.keys(db.inserted)).toEqual(["tasks"]);
    expect(db.updated).toEqual({});
  });
});

describe("POST /api/tasks with Pivot A off", () => {
  it("runs no check at all and answers exactly as before, even for keyword text", async () => {
    pivot(false);

    const response = await create({ title: "Tidy the desk", description: KEYWORD_TEXT });

    expect(response.status).toBe(201);
    expect(await data(response)).toEqual(db.inserted.tasks[0]);
    expect(messagesCreate).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/tasks/[id] under Pivot A", () => {
  it("saves an edited title that hits a keyword and asks for the crisis card, with no model call", async () => {
    const response = await edit({ title: KEYWORD_TEXT });

    expect(response.status).toBe(200);
    expect(await data(response)).toMatchObject({ id: TASK_ID, title: KEYWORD_TEXT, safety: { crisisCard: true } });
    expect(db.tables.tasks.find((row) => row.id === TASK_ID)?.title).toBe(KEYWORD_TEXT);
    expect(db.updated.tasks.map(({ patch }) => patch)).toEqual([{ title: KEYWORD_TEXT }]);
    expect(counters()).toEqual(["crisis_card_shown"]);
    expect(messagesCreate).not.toHaveBeenCalled();
    expect(db.inserted).toEqual({});
  });

  it("checks an edited note with the model and asks for the crisis card on a high answer", async () => {
    distressReply = () => message('{"risk":"high"}');

    const response = await edit({ description: "nobody would notice" });

    expect(await data(response)).toMatchObject({ description: "nobody would notice", safety: { crisisCard: true } });
    expect(distressCalls()).toHaveLength(1);
    // Title and note are checked together, as for reactions.
    expect((distressCalls()[0][0] as { messages: Array<{ content: string }> }).messages[0].content)
      .toBe(`To-do entry: ${JSON.stringify("Water the plants\nnobody would notice")}`);
    expect(counters()).toEqual(["crisis_card_shown"]);
  });

  it("does not check an edit that leaves the title and note alone", async () => {
    useDatabase({ tasks: [{ id: TASK_ID, owner_id: USER_ID, title: KEYWORD_TEXT, description: null, status: "pending", priority: null }] });

    const priority = await data(await edit({ priority: 2 }));
    const sameTitle = await data(await edit({ title: KEYWORD_TEXT, priority: 3 }));

    expect(priority).toMatchObject({ priority: 2 });
    expect(priority).not.toHaveProperty("safety");
    expect(sameTitle).toMatchObject({ priority: 3 });
    expect(sameTitle).not.toHaveProperty("safety");
    expect(messagesCreate).not.toHaveBeenCalled();
    expect(counters()).toEqual([]);
  });

  it("returns the saved task unchanged for a benign edit", async () => {
    const response = await edit({ title: QUIET_TEXT });

    const body = await data(response);
    expect(body).toEqual(db.tables.tasks.find((row) => row.id === TASK_ID));
    expect(body).not.toHaveProperty("safety");
    expect(distressCalls()).toHaveLength(1);
  });

  it("keeps the keyword result and counts the check as unavailable when the model fails", async () => {
    messagesCreate.mockResolvedValue(message("not json"));

    const body = await data(await edit({ title: QUIET_TEXT }));

    expect(body).not.toHaveProperty("safety");
    expect(counters()).toEqual(["distress_check_unavailable"]);
  });

  it("reuses a none verdict for the same task and text the same day, as reactions do", async () => {
    await edit({ title: QUIET_TEXT });
    await edit({ title: "Water the plants" });
    await edit({ title: QUIET_TEXT });

    expect(distressCalls()).toHaveLength(2);
  });

  it("counts one crisis card per task within the dedupe window, but shows it every time", async () => {
    const first = await data(await edit({ title: KEYWORD_TEXT }));
    const second = await data(await edit({ title: "I want to die" }));

    expect(first.safety).toEqual({ crisisCard: true });
    expect(second.safety).toEqual({ crisisCard: true });
    expect(counters()).toEqual(["crisis_card_shown"]);
  });

  it("still answers 404 for a task that isn't the caller's, with no check", async () => {
    const response = await edit({ title: KEYWORD_TEXT }, "dddddddd-dddd-4ddd-8ddd-dddddddddddd");

    expect(response.status).toBe(404);
    expect(counters()).toEqual([]);
  });
});

describe("PATCH /api/tasks/[id] limits", () => {
  it("rate limits title and note edits with the same budget as creating tasks", async () => {
    await edit({ title: "Water the plants" });
    expect(enforceRateLimit).toHaveBeenCalledWith(USER_ID, "task:update", 120, 3600);

    enforceRateLimit.mockClear();
    await edit({ description: "Front window first" });
    expect(enforceRateLimit).toHaveBeenCalledWith(USER_ID, "task:update", 120, 3600);
  });

  it("leaves edits without text, such as completion toggles, unlimited", async () => {
    await edit({ priority: 2 });
    await edit({ status: "completed" });

    expect(enforceRateLimit).not.toHaveBeenCalled();
  });

  it("saves nothing and runs no check past the rate limit", async () => {
    enforceRateLimit.mockRejectedValueOnce(new ApiError(429, "You are doing that a little too quickly. Try again shortly.", "rate_limited"));

    const response = await edit({ title: KEYWORD_TEXT });

    expect(response.status).toBe(429);
    expect(db.updated).toEqual({});
    expect(counters()).toEqual([]);
    expect(messagesCreate).not.toHaveBeenCalled();
  });

  it("counts distress_check_unavailable at most five times per user per UTC day", async () => {
    messagesCreate.mockRejectedValue(new Anthropic.APIConnectionError({ message: "connection reset" }));

    for (let edits = 1; edits <= 7; edits += 1) {
      const body = await data(await edit({ title: `Errand ${edits}` }));
      expect(body).not.toHaveProperty("safety");
    }
    expect(distressCalls()).toHaveLength(7);
    expect(counters()).toEqual(Array(5).fill("distress_check_unavailable"));

    // A new UTC day counts again.
    vi.setSystemTime(new Date(NOW.getTime() + 86_400_000));
    await edit({ title: "Errand 8" });
    expect(counters()).toHaveLength(6);
  });
});

describe("PATCH /api/tasks/[id] with Pivot A off", () => {
  it("runs no check at all and answers exactly as before, even for keyword text", async () => {
    pivot(false);

    const response = await edit({ title: KEYWORD_TEXT });

    expect(response.status).toBe(200);
    expect(await data(response)).toEqual(db.tables.tasks.find((row) => row.id === TASK_ID));
    expect(messagesCreate).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
