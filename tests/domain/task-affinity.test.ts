import { describe, expect, it } from "vitest";

import { affinityFor, classifyTask } from "@/lib/domain/task-affinity";

describe("classifyTask", () => {
  it("reads the manual QA completions the way the roster expects", () => {
    expect(classifyTask({ taskTitle: "Finished economics essay" })).toBe("study");
    expect(classifyTask({ taskTitle: "Cleaned my room" })).toBe("cleaning");
    expect(classifyTask({ taskTitle: "Finished a 5 km run" })).toBe("exercise");
    expect(classifyTask({ taskTitle: "Fixed the authentication bug" })).toBe("coding");
    expect(classifyTask({ taskTitle: "Practiced piano for 60 minutes" })).toBe("creative");
  });

  it("prefers the user's own category label over the title", () => {
    expect(classifyTask({ category: "Esports", taskTitle: "Review the replay" })).toBe("gaming");
  });

  it("falls back to the completion note when the title says nothing", () => {
    expect(classifyTask({ taskTitle: "Session 4", content: "Finally finished my tax paperwork." })).toBe("admin");
  });

  it("returns other rather than guessing", () => {
    expect(classifyTask({ taskTitle: "Did the thing" })).toBe("other");
    expect(classifyTask({})).toBe("other");
  });
});

describe("affinityFor", () => {
  it("uses the persona's weight for a category it cares about", () => {
    expect(affinityFor({ coding: 0.9, other: 0.3 }, "coding")).toBe(0.9);
  });

  it("treats the other key as the baseline for unlisted categories", () => {
    expect(affinityFor({ coding: 0.9, other: 0.65 }, "cooking")).toBe(0.65);
  });

  it("keeps a persona with no table quiet rather than absent", () => {
    expect(affinityFor(null, "study")).toBeGreaterThan(0);
    expect(affinityFor({}, "study")).toBeLessThan(0.5);
  });

  it("clamps a malformed weight into range", () => {
    expect(affinityFor({ study: 4 }, "study")).toBe(1);
    expect(affinityFor({ study: -2 }, "study")).toBe(0);
  });
});
