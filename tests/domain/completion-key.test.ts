import { describe, expect, it } from "vitest";

import { completionPostKey } from "@/lib/domain/completion-key";

type CompletionKeyInput = Parameters<typeof completionPostKey>[0];

const completion = {
  authorId: "user-1",
  taskId: "task-1",
} as CompletionKeyInput;

describe("completionPostKey", () => {
  it("returns the same key when the same completion is retried", () => {
    expect(completionPostKey(completion)).toBe(completionPostKey({ ...completion }));
  });

  it("returns different keys for different authors", () => {
    const otherAuthor = { ...completion, authorId: "user-2" };

    expect(completionPostKey(completion)).not.toBe(completionPostKey(otherAuthor));
  });

  it("returns different keys for different recurrence instances", () => {
    const first = { ...completion, recurrenceInstanceId: "2026-08-12" };
    const second = { ...completion, recurrenceInstanceId: "2026-08-13" };

    expect(completionPostKey(first)).not.toBe(completionPostKey(second));
  });

  it("returns the same recurring key when an instance is retried", () => {
    const recurring = { ...completion, recurrenceInstanceId: "2026-08-12" };

    expect(completionPostKey(recurring)).toBe(completionPostKey({ ...recurring }));
  });

  it("treats a blank recurrence instance as a non-recurring completion", () => {
    const blankInstance = { ...completion, recurrenceInstanceId: "   " };

    expect(completionPostKey(blankInstance)).toBe(completionPostKey(completion));
  });
});
