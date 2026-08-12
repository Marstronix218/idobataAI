import { describe, expect, it } from "vitest";

import {
  taskVisibilityTransition,
  toPublicProgress,
} from "@/lib/domain/task-visibility";

type TaskInput = Parameters<typeof toPublicProgress>[0];
type ProfileInput = Parameters<typeof toPublicProgress>[1];

const publicTask: TaskInput = {
  id: "task-1",
  ownerId: "user-1",
  title: "Ship the accessibility pass",
  category: "work",
  status: "pending",
  visibility: "public",
  xpEarned: 25,
  updatedAt: "2026-08-12T09:30:00.000Z",
};

const profile: ProfileInput = {
  username: "nori",
};

describe("toPublicProgress", () => {
  it("returns no progress record for a private task", () => {
    const privateTask: TaskInput = {
      ...publicTask,
      visibility: "private",
    };

    expect(toPublicProgress(privateTask, profile)).toBeNull();
  });

  it("maps the allowed fields for a public task", () => {
    expect(toPublicProgress(publicTask, profile)).toEqual({
      taskId: "task-1",
      ownerId: "user-1",
      username: "nori",
      avatarUrl: null,
      taskTitle: "Ship the accessibility pass",
      category: "work",
      status: "pending",
      xpValue: 25,
      updatedAt: "2026-08-12T09:30:00.000Z",
    });
  });
});

describe("taskVisibilityTransition", () => {
  it("deletes public progress when a task becomes private", () => {
    expect(taskVisibilityTransition("public", "private")).toBe("delete");
  });

  it("upserts public progress when a private task becomes public", () => {
    expect(taskVisibilityTransition("private", "public")).toBe("upsert");
  });

  it("does nothing when a private task remains private", () => {
    expect(taskVisibilityTransition("private", "private")).toBe("none");
  });
});
