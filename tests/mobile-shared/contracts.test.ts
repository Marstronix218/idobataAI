import { describe, expect, it } from "vitest";

import { taskCreateSchema, taskSchema, taskUpdateSchema } from "../../packages/contracts/src";

describe("mobile task contracts", () => {
  it("normalizes valid task creation input", () => {
    expect(taskCreateSchema.parse({ title: "  Focus  ", description: null })).toEqual({
      title: "Focus",
      description: null,
    });
  });

  it("matches the server's strict update constraints", () => {
    expect(taskUpdateSchema.safeParse({}).success).toBe(false);
    expect(taskUpdateSchema.safeParse({ status: "completed" }).success).toBe(true);
    expect(taskUpdateSchema.safeParse({ status: "unknown" }).success).toBe(false);
    expect(taskUpdateSchema.safeParse({ title: "Task", extra: true }).success).toBe(false);
  });

  it("validates required task response fields while allowing additive fields", () => {
    const result = taskSchema.safeParse({
      id: "11111111-1111-4111-8111-111111111111",
      owner_id: "22222222-2222-4222-8222-222222222222",
      title: "Task",
      description: null,
      category: null,
      due_at: null,
      recurrence_rule: null,
      recurrence_instance_id: null,
      priority: null,
      visibility: "private",
      status: "pending",
      xp_earned: 0,
      completed_at: null,
      created_at: "2026-08-20T12:00:00.000Z",
      updated_at: "2026-08-20T12:00:00.000Z",
      additive_field: true,
    });

    expect(result.success).toBe(true);
    if (result.success) expect("additive_field" in result.data).toBe(false);
  });
});
