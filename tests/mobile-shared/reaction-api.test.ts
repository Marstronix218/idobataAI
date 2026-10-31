import { describe, expect, it, vi } from "vitest";

import { ApiClientError, createApiClient } from "../../packages/api-client/src";
import {
  TASK_SPLIT_ERROR_CODES,
  reactionPayloadSchema,
  taskFinishResultSchema,
  taskSplitResultSchema,
  taskSchema,
  taskStartResultSchema,
  taskWriteResultSchema,
} from "../../packages/contracts/src";

const taskId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const character = { id: "c1000000-0000-4000-8000-000000000001", slug: "sample-coach", name: "Sample Coach", artUrl: null };
const reaction = { kind: "reaction", text: "Water the plants is on.", source: "ai", character, disclosure: "AI character · not a person · not a therapist, doctor or lawyer" };
const task = {
  id: taskId,
  owner_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  title: "Water the plants",
  description: null,
  category: null,
  due_at: null,
  due_has_time: false,
  due_timezone: null,
  recurrence_rule: null,
  recurrence_instance_id: null,
  priority: null,
  visibility: "private",
  status: "completed",
  xp_earned: 10,
  completed_at: "2026-10-31T15:00:00.000Z",
  created_at: "2026-10-28T15:00:00.000Z",
  updated_at: "2026-10-31T15:00:00.000Z",
};

function clientAnswering(status: number, body: unknown) {
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    void input;
    void init;
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  });
  return { fetch, client: createApiClient({ baseUrl: "https://example.com", getAccessToken: () => "token", fetch }) };
}

describe("reaction contracts", () => {
  it("accepts a reaction or a crisis card, and nothing else", () => {
    expect(reactionPayloadSchema.parse(reaction)).toEqual(reaction);
    expect(reactionPayloadSchema.parse({ kind: "crisis" })).toEqual({ kind: "crisis" });
    expect(reactionPayloadSchema.safeParse({ ...reaction, source: "human" }).success).toBe(false);
    expect(reactionPayloadSchema.safeParse({ ...reaction, text: "" }).success).toBe(false);
    expect(reactionPayloadSchema.safeParse({ kind: "banter" }).success).toBe(false);
  });

  it("allows a null reaction on start and finish", () => {
    expect(taskStartResultSchema.parse({ event: { id: taskId, type: "started", occurredAt: "2026-10-31T15:00:00.000Z" }, reaction: null }).reaction).toBeNull();
    expect(taskFinishResultSchema.parse({ task, reaction: null }).reaction).toBeNull();
  });

  it("requires exactly three steps in a split", () => {
    const split = { kind: "split", intro: "Here it is in three steps.", steps: ["a", "b", "c"], character };
    expect(taskSplitResultSchema.parse(split)).toEqual(split);
    expect(taskSplitResultSchema.safeParse({ ...split, steps: ["a", "b"] }).success).toBe(false);
    expect(taskSplitResultSchema.safeParse({ ...split, steps: ["a", "b", "c", "d"] }).success).toBe(false);
    expect(taskSplitResultSchema.parse({ kind: "crisis" })).toEqual({ kind: "crisis" });
  });

  it("adds an optional crisis-card flag to the create and update response, which older clients drop", () => {
    const flagged = { ...task, safety: { crisisCard: true } };
    expect(taskWriteResultSchema.parse(flagged)).toEqual(flagged);
    expect(taskWriteResultSchema.parse(task)).toEqual(task);
    expect(taskWriteResultSchema.safeParse({ ...task, safety: { crisisCard: false } }).success).toBe(false);
    // The task rules still apply.
    expect(taskWriteResultSchema.safeParse({ ...task, due_has_time: true }).success).toBe(false);
    // A client that only knows taskSchema keeps working and simply ignores the flag.
    expect(taskSchema.parse(flagged)).toEqual(task);
  });

  it("names the split error codes", () => {
    expect(TASK_SPLIT_ERROR_CODES).toEqual({ planRequired: "plan_required", capReached: "split_cap_reached", unavailable: "split_unavailable" });
  });
});

describe("reaction API client", () => {
  it("starts a task with a POST and validates the result", async () => {
    const data = { event: { id: "f1000000-0000-4000-8000-000000000001", type: "started", occurredAt: "2026-10-31T15:00:00.000Z" }, reaction };
    const { client, fetch } = clientAnswering(200, { data });

    await expect(client.startTask(taskId)).resolves.toEqual(data);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(`https://example.com/api/tasks/${taskId}/start`);
    expect(init?.method).toBe("POST");
  });

  it("finishes a task and returns the task with the reaction", async () => {
    const { client, fetch } = clientAnswering(200, { data: { task, reaction: { kind: "crisis" } } });

    await expect(client.finishTask(taskId)).resolves.toEqual({ task, reaction: { kind: "crisis" } });
    expect(fetch.mock.calls[0]?.[0]).toBe(`https://example.com/api/tasks/${taskId}/finish`);
  });

  it("splits a task", async () => {
    const data = { kind: "split", intro: "Three steps.", steps: ["a", "b", "c"], character };
    const { client, fetch } = clientAnswering(200, { data });

    await expect(client.splitTask(taskId)).resolves.toEqual(data);
    expect(fetch.mock.calls[0]?.[0]).toBe(`https://example.com/api/tasks/${taskId}/split`);
  });

  it("surfaces the split error codes", async () => {
    const { client } = clientAnswering(402, { error: { code: "plan_required", message: "Splitting tasks is part of Plus." } });

    await expect(client.splitTask(taskId)).rejects.toMatchObject({ status: 402, code: TASK_SPLIT_ERROR_CODES.planRequired });
  });

  it.each([
    ["createTask", 201, (client: ReturnType<typeof createApiClient>) => client.createTask({ title: "Water the plants" })],
    ["updateTask", 200, (client: ReturnType<typeof createApiClient>) => client.updateTask(taskId, { title: "Water the plants" })],
  ] as const)("%s returns the crisis-card flag when the server sets it, and no flag otherwise", async (_name, status, call) => {
    const flagged = clientAnswering(status, { data: { ...task, safety: { crisisCard: true } } });
    await expect(call(flagged.client)).resolves.toEqual({ ...task, safety: { crisisCard: true } });

    const plain = clientAnswering(status, { data: task });
    const result = await call(plain.client);
    expect(result).toEqual(task);
    expect(result).not.toHaveProperty("safety");
  });

  it("rejects a malformed response", async () => {
    const { client } = clientAnswering(200, { data: { event: { id: "x" }, reaction: null } });

    const error = await client.startTask(taskId).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({ code: "invalid_response" });
  });
});
