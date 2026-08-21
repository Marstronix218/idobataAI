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
