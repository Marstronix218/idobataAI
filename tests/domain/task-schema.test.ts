import { describe, expect, it } from "vitest";

import { taskCreateSchema, taskUpdateSchema } from "@/lib/server/schemas";

describe("task priority schemas", () => {
  it.each([1, 2, 3, 4])("accepts priority %i", (priority) => {
    expect(taskCreateSchema.parse({ title: "Plan the next step", priority }).priority).toBe(priority);
    expect(taskUpdateSchema.parse({ priority }).priority).toBe(priority);
  });

  it("accepts an explicitly unset priority", () => {
    expect(taskCreateSchema.parse({ title: "Plan the next step", priority: null }).priority).toBeNull();
    expect(taskUpdateSchema.parse({ priority: null }).priority).toBeNull();
  });

  it.each([0, 5, 1.5, "1"])("rejects invalid priority %s", (priority) => {
    expect(taskCreateSchema.safeParse({ title: "Plan the next step", priority }).success).toBe(false);
    expect(taskUpdateSchema.safeParse({ priority }).success).toBe(false);
  });
});

describe("task deadline time schemas", () => {
  const deadline = "2026-08-21T21:30:00.000Z";
  const dueTimezone = "America/Los_Angeles";

  it("accepts a dated task with or without an exact deadline time", () => {
    expect(taskCreateSchema.parse({ title: "Plan the next step", dueAt: deadline, dueHasTime: true, dueTimezone }).dueHasTime).toBe(true);
    expect(taskCreateSchema.parse({ title: "Plan the next step", dueAt: deadline, dueHasTime: false }).dueHasTime).toBe(false);
    expect(taskUpdateSchema.parse({ dueAt: deadline, dueHasTime: true, dueTimezone }).dueTimezone).toBe(dueTimezone);
  });

  it("keeps deadline precision optional", () => {
    expect(taskCreateSchema.parse({ title: "Plan the next step", dueAt: deadline }).dueHasTime).toBeUndefined();
    expect(taskUpdateSchema.parse({ dueHasTime: false }).dueHasTime).toBe(false);
  });

  it("rejects an exact time without a due date on creation", () => {
    expect(taskCreateSchema.safeParse({ title: "Plan the next step", dueHasTime: true, dueTimezone }).success).toBe(false);
    expect(taskCreateSchema.safeParse({ title: "Plan the next step", dueAt: null, dueHasTime: true, dueTimezone }).success).toBe(false);
  });

  it("requires a valid IANA time zone for exact deadlines", () => {
    expect(taskCreateSchema.safeParse({ title: "Plan the next step", dueAt: deadline, dueHasTime: true }).success).toBe(false);
    expect(taskCreateSchema.safeParse({ title: "Plan the next step", dueAt: deadline, dueHasTime: true, dueTimezone: "Mars/Olympus" }).success).toBe(false);
    expect(taskUpdateSchema.safeParse({ dueAt: deadline, dueHasTime: true, dueTimezone: "not-a-zone" }).success).toBe(false);
  });

  it("rejects adding or retaining exact-time metadata without a due date in the same update", () => {
    expect(taskUpdateSchema.safeParse({ dueHasTime: true }).success).toBe(false);
    expect(taskUpdateSchema.safeParse({ dueAt: null, dueHasTime: true, dueTimezone }).success).toBe(false);
    expect(taskUpdateSchema.safeParse({ dueHasTime: false, dueTimezone }).success).toBe(false);
    expect(taskUpdateSchema.safeParse({ dueTimezone: null }).success).toBe(false);
  });
});
