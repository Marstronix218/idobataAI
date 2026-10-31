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

// The real withApi, assertDatabase, engine and splitter: only the session,
// flags, rate limiter, database and SDK are stand-ins.
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

import { POST as finishTask } from "@/app/api/tasks/[id]/finish/route";
import { POST as splitTask } from "@/app/api/tasks/[id]/split/route";
import { POST as startTask } from "@/app/api/tasks/[id]/start/route";
import { ApiError } from "@/lib/server/http";
import { resetCrisisDedupeForTests } from "@/lib/safety/counters";
import { resetDistressCacheForTests } from "@/lib/safety/distress";

const NOT_FOUND = { error: { code: "not_found", message: "Resource not found." } };
let db: FakeSupabase;

/** start_task and the finish trigger, as the migrations define them, for the caller's rows. */
function useDatabase(overrides: Partial<Record<string, Row[]>> = {}, errors?: Record<string, { message: string; code?: string }>) {
  db = createFakeSupabase(baseTables({ task_events: [], ...overrides }), {
    errors,
    rpc(name, args, fake) {
      if (name !== "start_task") return pivotRpc(name, args, fake);
      const task = fake.tables.tasks.find((row) => row.id === args.p_task_id && row.owner_id === USER_ID);
      if (!task) return { data: null, error: { code: "P0002", message: "task not found" } };
      if (task.status !== "pending") return { data: null, error: { code: "22023", message: "task is not pending" } };
      let event = fake.tables.task_events.find((row) => row.task_id === task.id && row.type === "started" && row.local_date === TODAY);
      if (!event) {
        event = { id: `started-${fake.tables.task_events.length + 1}`, user_id: USER_ID, task_id: task.id, type: "started", occurred_at: new Date().toISOString(), local_date: TODAY, occurrence_key: null };
        fake.tables.task_events.push(event);
      }
      return { data: { ...event }, error: null };
    },
    afterUpdate(table, rows, fake) {
      if (table !== "tasks") return;
      for (const task of rows) {
        if (task.status !== "completed") { task.completed_at = null; continue; }
        task.completed_at = new Date().toISOString();
        const key = task.recurrence_instance_id ?? "single";
        if (!fake.tables.task_events.some((row) => row.task_id === task.id && row.type === "finished" && row.occurrence_key === key)) {
          fake.tables.task_events.push({ id: `finished-${fake.tables.task_events.length + 1}`, user_id: USER_ID, task_id: task.id, type: "finished", occurred_at: task.completed_at, local_date: TODAY, occurrence_key: key });
        }
      }
    },
  });
  createAdminClient.mockReturnValue(db);
  authed.mockResolvedValue({ user: { id: USER_ID }, supabase: db });
}

const post = (action: string, id = TASK_ID) => new Request(`http://localhost/api/tasks/${id}/${action}`, { method: "POST", headers: { authorization: "Bearer token" } });
const context = (id = TASK_ID) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(NOW);
  // Prewritten only, so start and finish make no model call.
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  resetDistressCacheForTests();
  resetCrisisDedupeForTests();
  getFlags.mockResolvedValue(resolveFlags({ "pivot_a.enabled": true }));
  enforceRateLimit.mockResolvedValue(undefined);
  useDatabase();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("POST /api/tasks/[id]/start", () => {
  it("answers 404 before authenticating while Pivot A is off", async () => {
    getFlags.mockResolvedValue(resolveFlags({ "pivot_a.enabled": false }));

    const response = await startTask(post("start"), context());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual(NOT_FOUND);
    expect(authed).not.toHaveBeenCalled();
  });

  it("records the start and returns the event with the character's reaction", async () => {
    const response = await startTask(post("start"), context());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.event).toEqual({ id: "started-1", type: "started", occurredAt: NOW.toISOString() });
    expect(body.data.reaction).toMatchObject({ kind: "reaction", source: "prewritten", character: { slug: "sample-coach" } });
    expect(body.data.reaction.text).toContain("Water the plants");
    expect(enforceRateLimit).toHaveBeenCalledWith(USER_ID, "tasks:reaction", 120, 3600);
    expect(db.rpc).toHaveBeenCalledWith("start_task", { p_task_id: TASK_ID });
  });

  it("returns the same event with no reaction on a repeat start the same day", async () => {
    const first = await (await startTask(post("start"), context())).json();
    const second = await (await startTask(post("start"), context())).json();

    expect(second.data.event.id).toBe(first.data.event.id);
    expect(first.data.reaction).not.toBeNull();
    expect(second.data.reaction).toBeNull();
    expect(db.inserted.character_reactions).toHaveLength(1);
  });

  it("still starts the task, with no banter, once the reaction rate limit is reached", async () => {
    enforceRateLimit.mockRejectedValue(new ApiError(429, "slow down", "rate_limited"));

    const response = await startTask(post("start"), context());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.event).toMatchObject({ type: "started" });
    expect(body.data.reaction).toBeNull();
    expect(db.tables.task_events).toHaveLength(1);
    // Only the safety checks ran: nothing was stored.
    expect(db.inserted.character_reactions ?? []).toEqual([]);
  });

  it("still starts the task, with no banter, when the rate limiter is down", async () => {
    enforceRateLimit.mockRejectedValue(new ApiError(503, "limiter down", "rate_limit_unavailable"));

    const response = await startTask(post("start"), context());

    expect(response.status).toBe(200);
    expect((await response.json()).data.reaction).toBeNull();
    expect(db.inserted.character_reactions ?? []).toEqual([]);
  });

  it.each([
    ["reached", new ApiError(429, "slow down", "rate_limited")],
    ["down", new ApiError(503, "limiter down", "rate_limit_unavailable")],
  ])("still shows the crisis card on start when the reaction rate limiter is %s", async (_name, error) => {
    enforceRateLimit.mockRejectedValue(error);
    db.tables.tasks[0].title = "I want to die";

    const body = await (await startTask(post("start"), context())).json();

    expect(body.data.reaction).toEqual({ kind: "crisis" });
    expect(db.rpc).toHaveBeenCalledWith("increment_safety_counter", { p_kind: "crisis_card_shown" });
  });

  it("answers 409 for a task that is already done", async () => {
    db.tables.tasks[0].status = "completed";

    const response = await startTask(post("start"), context());

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("task_not_pending");
  });

  it("answers 404 for a task that is not the caller's, and 422 for a malformed id", async () => {
    const other = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    expect((await startTask(post("start", other), context(other))).status).toBe(404);
    expect((await startTask(post("start", "nope"), context("nope"))).status).toBe(422);
  });
});

describe("POST /api/tasks/[id]/finish", () => {
  it("completes the task through the shared update path and returns the reaction", async () => {
    const response = await finishTask(post("finish"), context());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.task).toMatchObject({ id: TASK_ID, status: "completed", completed_at: NOW.toISOString() });
    expect(body.data.reaction).toMatchObject({ kind: "reaction", source: "prewritten" });
    expect(db.updated.tasks).toEqual([expect.objectContaining({ patch: { status: "completed" } })]);
    expect(db.inserted.character_reactions[0]).toMatchObject({ task_event_id: "finished-1" });
    expect(enforceRateLimit).toHaveBeenCalledWith(USER_ID, "tasks:reaction", 120, 3600);
  });

  it("returns the task with no reaction, and changes nothing, when it was already completed", async () => {
    await finishTask(post("finish"), context());
    const response = await finishTask(post("finish"), context());
    const body = await response.json();

    expect(body.data.task.status).toBe("completed");
    expect(body.data.reaction).toBeNull();
    expect(db.updated.tasks).toHaveLength(1);
    expect(db.inserted.character_reactions).toHaveLength(1);
  });

  it("gives no new reaction when a reopened task is finished again for the same occurrence", async () => {
    await finishTask(post("finish"), context());
    vi.setSystemTime(new Date(NOW.getTime() + 60_000));
    db.tables.tasks[0].status = "pending";
    db.tables.tasks[0].completed_at = null;

    const body = await (await finishTask(post("finish"), context())).json();

    expect(body.data.task.status).toBe("completed");
    expect(body.data.reaction).toBeNull();
    expect(db.inserted.character_reactions).toHaveLength(1);
  });

  it("completes the task first and skips the banter once the reaction rate limit is reached", async () => {
    enforceRateLimit.mockRejectedValue(new ApiError(429, "slow down", "rate_limited"));

    const response = await finishTask(post("finish"), context());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.task.status).toBe("completed");
    expect(body.data.reaction).toBeNull();
    expect(db.updated.tasks).toHaveLength(1);
    expect(db.inserted.character_reactions ?? []).toEqual([]);
  });

  it("still shows the crisis card on finish under the reaction rate limit", async () => {
    enforceRateLimit.mockRejectedValue(new ApiError(429, "slow down", "rate_limited"));
    db.tables.tasks[0].description = "honestly I want to hurt myself";

    const body = await (await finishTask(post("finish"), context())).json();

    expect(body.data.task.status).toBe("completed");
    expect(body.data.reaction).toEqual({ kind: "crisis" });
  });

  it("answers 200 with the completed task and no reaction when the finished-event lookup fails", async () => {
    useDatabase({}, { task_events: { message: "connection reset", code: "08006" } });

    const response = await finishTask(post("finish"), context());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.task).toMatchObject({ id: TASK_ID, status: "completed" });
    expect(body.data.reaction).toBeNull();
  });

  it("answers 200 with the completed task and no reaction when the lookup throws", async () => {
    const from = db.from.getMockImplementation() as (table: string) => unknown;
    db.from.mockImplementation((table: string) => {
      if (table === "task_events") throw new Error("socket closed");
      return from(table);
    });

    const response = await finishTask(post("finish"), context());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.task.status).toBe("completed");
    expect(body.data.reaction).toBeNull();
  });

  it("answers 404 for a task that is not the caller's", async () => {
    const other = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

    const response = await finishTask(post("finish", other), context(other));

    expect(response.status).toBe(404);
    expect(db.updated.tasks).toBeUndefined();
  });

  it("answers 404 before authenticating while Pivot A is off", async () => {
    getFlags.mockResolvedValue(resolveFlags({ "pivot_a.enabled": false }));

    const response = await finishTask(post("finish"), context());

    expect(response.status).toBe(404);
    expect(authed).not.toHaveBeenCalled();
  });
});

describe("POST /api/tasks/[id]/split", () => {
  beforeEach(() => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-placeholder");
    messagesCreate.mockImplementation((params: Parameters<typeof isDistressRequest>[0]) => Promise.resolve(isDistressRequest(params)
      ? message('{"risk":"none"}')
      : message(JSON.stringify({ steps: ["Fill the watering can", "Water the window plants", "Water the fern"] }))));
  });

  it("answers 404 before authenticating while Pivot A is off", async () => {
    getFlags.mockResolvedValue(resolveFlags({ "pivot_a.enabled": false }));

    const response = await splitTask(post("split"), context());

    expect(response.status).toBe(404);
    expect(authed).not.toHaveBeenCalled();
  });

  it("returns the split in the contract shape, rate limited at 30 an hour", async () => {
    const response = await splitTask(post("split"), context());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      kind: "split",
      steps: ["Fill the watering can", "Water the window plants", "Water the fern"],
      character: { slug: "sample-coach", artUrl: null },
    });
    expect(typeof body.data.intro).toBe("string");
    expect(enforceRateLimit).toHaveBeenCalledWith(USER_ID, "tasks:split", 30, 3600);
  });

  it("answers 402 plan_required for a free user", async () => {
    db.tables.entitlements = [];

    const response = await splitTask(post("split"), context());

    expect(response.status).toBe(402);
    expect((await response.json()).error.code).toBe("plan_required");
  });

  it("answers 503 split_unavailable with a friendly message when the AI fails", async () => {
    messagesCreate.mockImplementation((params: Parameters<typeof isDistressRequest>[0]) => Promise.resolve(isDistressRequest(params)
      ? message('{"risk":"none"}')
      : message("not json at all")));

    const response = await splitTask(post("split"), context());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error.code).toBe("split_unavailable");
    expect(body.error.message).not.toMatch(/json|anthropic|error/i);
  });
});

// PLAN D6: an account whose age is not verified gets no character banter. The
// task action itself is never held back, and the crisis card still shows.
describe("start, finish and split for an account whose age is not verified", () => {
  beforeEach(() => {
    db.tables.user_coach_profiles[0].age_verified_at = null;
  });

  it("finishes the task with no banter", async () => {
    const response = await finishTask(post("finish"), context());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.task.status).toBe("completed");
    expect(body.data.reaction).toBeNull();
    expect(db.updated.tasks).toHaveLength(1);
    expect(db.inserted.character_reactions ?? []).toEqual([]);
    // The reaction rate limit is not spent on a reaction that cannot show.
    expect(enforceRateLimit).not.toHaveBeenCalled();
  });

  it("still shows the crisis card on finish", async () => {
    db.tables.tasks[0].description = "honestly I want to hurt myself";

    const body = await (await finishTask(post("finish"), context())).json();

    expect(body.data.task.status).toBe("completed");
    expect(body.data.reaction).toEqual({ kind: "crisis" });
    expect(db.rpc).toHaveBeenCalledWith("increment_safety_counter", { p_kind: "crisis_card_shown" });
  });

  it("treats an unreadable age as unverified, and still finishes the task", async () => {
    useDatabase({}, { user_coach_profiles: { message: "boom", code: "XX999" } });

    const body = await (await finishTask(post("finish"), context())).json();

    expect(body.data.task.status).toBe("completed");
    expect(body.data.reaction).toBeNull();
  });

  // start_task itself refuses an unverified caller in SQL (20261031190000);
  // if it ever records the start, the route still adds no banter.
  it("adds no banter to a start, but keeps the crisis card", async () => {
    const plain = await (await startTask(post("start"), context())).json();
    expect(plain.data.reaction).toBeNull();

    db.tables.tasks[0].description = "honestly I want to hurt myself";
    db.tables.task_events = [];
    const crisis = await (await startTask(post("start"), context())).json();
    expect(crisis.data.reaction).toEqual({ kind: "crisis" });
  });

  it("answers 403 age_requirement when start_task refuses the caller", async () => {
    useDatabase();
    db.rpc.mockImplementation(async (name: string) => name === "start_task"
      ? { data: null, error: { code: "P0001", message: "age verification required" } }
      : { data: null, error: null });

    const response = await startTask(post("start"), context());

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("age_requirement");
  });

  it("refuses to split the task with 403 age_requirement", async () => {
    const response = await splitTask(post("split"), context());

    expect(response.status).toBe(403);
    expect((await response.json()).error).toEqual({ code: "age_requirement", message: "Confirm your age to continue." });
    expect(messagesCreate).not.toHaveBeenCalled();
    expect(enforceRateLimit).not.toHaveBeenCalled();
  });
});
