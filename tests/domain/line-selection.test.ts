import { describe, expect, it } from "vitest";
import {
  RECENT_LINE_WINDOW,
  fillTaskToken,
  selectLine,
  selectLineWithFallback,
  taskAgeBucket,
  taskAgeDays,
  truncateTitle,
  type LineSelectionContext,
  type SelectableLine,
} from "@/lib/domain/line-selection";

const line = (id: string, overrides: Partial<SelectableLine> = {}): SelectableLine => ({
  id,
  event: "task_started",
  text: `${id} {task}`,
  min_streak: null,
  max_streak: null,
  task_age_bucket: null,
  ...overrides,
});
const context = (overrides: Partial<LineSelectionContext> = {}): LineSelectionContext => ({
  event: "task_started",
  streak: 0,
  ageBucket: "days",
  recentLineIds: [],
  seed: "event-1",
  ...overrides,
});

describe("selectLine: matching", () => {
  it("matches the event", () => {
    const lines = [line("a", { event: "task_finished" }), line("b")];
    expect(selectLine(lines, context())?.id).toBe("b");
    expect(selectLine(lines, context({ event: "comeback" }))).toBeNull();
  });

  it("matches the streak range, with null meaning unbounded", () => {
    const lines = [
      line("low", { min_streak: 2, max_streak: 4 }),
      line("mid", { min_streak: 5, max_streak: 13 }),
      line("high", { min_streak: 14 }),
      line("upTo1", { max_streak: 1 }),
    ];
    expect(selectLine(lines, context({ streak: 3 }))?.id).toBe("low");
    expect(selectLine(lines, context({ streak: 5 }))?.id).toBe("mid");
    expect(selectLine(lines, context({ streak: 13 }))?.id).toBe("mid");
    expect(selectLine(lines, context({ streak: 400 }))?.id).toBe("high");
    expect(selectLine(lines, context({ streak: 0 }))?.id).toBe("upTo1");
  });

  it("matches the age bucket, preferring an exact bucket over any-age lines", () => {
    const lines = [line("any1"), line("any2"), line("fresh", { task_age_bucket: "fresh" }), line("stale", { task_age_bucket: "stale" })];
    expect(selectLine(lines, context({ ageBucket: "fresh" }))?.id).toBe("fresh");
    expect(selectLine(lines, context({ ageBucket: "stale" }))?.id).toBe("stale");
    expect(["any1", "any2"]).toContain(selectLine(lines, context({ ageBucket: "weeks" }))?.id);
  });
});

describe("selectLine: no repeats", () => {
  it("avoids the user's last 20 lines while anything else matches", () => {
    const lines = Array.from({ length: 22 }, (_, index) => line(`l${String(index).padStart(2, "0")}`));
    const recent = lines.slice(0, 20).map((candidate) => candidate.id);

    for (const seed of ["a", "b", "c", "d", "e", "f"]) {
      expect(["l20", "l21"]).toContain(selectLine(lines, context({ recentLineIds: recent, seed }))?.id);
    }
  });

  it("only counts the last 20: an older use does not block a line", () => {
    const lines = [line("old"), line("recent")];
    const recent = ["recent", ...Array.from({ length: RECENT_LINE_WINDOW - 1 }, (_, index) => `other${index}`), "old"];
    expect(selectLine(lines, context({ recentLineIds: recent }))?.id).toBe("old");
  });

  it("falls back to the least recently used line when every match is recent", () => {
    const lines = [line("a"), line("b"), line("c")];
    // Most recent first: c was shown longest ago.
    expect(selectLine(lines, context({ recentLineIds: ["a", "b", "c"] }))?.id).toBe("c");
    expect(selectLine(lines, context({ recentLineIds: ["c", "a", "b"] }))?.id).toBe("b");
  });

  it("prefers an any-age line not shown recently over an exact-bucket line that was", () => {
    const lines = [line("exact", { task_age_bucket: "days" }), line("any")];
    expect(selectLine(lines, context({ recentLineIds: ["exact"] }))?.id).toBe("any");
  });
});

describe("selectLine: determinism", () => {
  const lines = Array.from({ length: 10 }, (_, index) => line(`l${index}`));

  it("gives the same line for the same seed, whatever order the lines arrive in", () => {
    const first = selectLine(lines, context({ seed: "event-42" }));
    expect(selectLine([...lines].reverse(), context({ seed: "event-42" }))).toEqual(first);
  });

  it("spreads different seeds across the lines", () => {
    const chosen = new Set(Array.from({ length: 50 }, (_, index) => selectLine(lines, context({ seed: `event-${index}` }))?.id));
    expect(chosen.size).toBeGreaterThan(5);
  });
});

describe("selectLineWithFallback", () => {
  it("falls back to the plain event when the chosen one has no matching line", () => {
    const lines = [line("start"), line("streak-long", { event: "streak", min_streak: 14 })];
    expect(selectLineWithFallback(lines, ["streak", "task_started"], { streak: 3, ageBucket: "days", recentLineIds: [], seed: "x" }))
      .toEqual({ line: lines[0], event: "task_started" });
    expect(selectLineWithFallback([], ["streak", "task_started"], { streak: 3, ageBucket: "days", recentLineIds: [], seed: "x" })).toBeNull();
  });
});

describe("task age", () => {
  const now = new Date("2026-10-31T12:00:00Z");

  it("counts whole days and buckets them as the schema documents", () => {
    expect(taskAgeDays("2026-10-31T00:00:00Z", now)).toBe(0);
    expect(taskAgeDays("2026-10-30T12:00:00Z", now)).toBe(1);
    expect(taskAgeDays("2026-11-01T00:00:00Z", now)).toBe(0);
    expect(taskAgeDays("garbage", now)).toBe(0);
    expect([0, 1, 6, 7, 29, 30, 400].map(taskAgeBucket)).toEqual(["fresh", "days", "days", "weeks", "weeks", "stale", "stale"]);
  });
});

describe("fillTaskToken", () => {
  it("replaces every {task} with the title", () => {
    expect(fillTaskToken("{task} is on. Go {task}!", "Water the plants")).toBe("Water the plants is on. Go Water the plants!");
    expect(fillTaskToken("No token here.", "Water the plants")).toBe("No token here.");
  });

  it("collapses whitespace and shortens long titles at a word boundary", () => {
    expect(fillTaskToken("Starting {task}.", "  Water\n the   plants ")).toBe("Starting Water the plants.");
    const long = "Sort every single receipt from the last three years into labelled folders for the accountant";
    const filled = truncateTitle(long);
    expect(filled.length).toBeLessThanOrEqual(61);
    expect(filled.endsWith("…")).toBe(true);
    expect(long.startsWith(filled.slice(0, -1))).toBe(true);
    expect(filled).not.toMatch(/\s…$/);
  });

  it("cuts a title with no spaces at the limit", () => {
    expect(truncateTitle("x".repeat(100))).toBe(`${"x".repeat(60)}…`);
  });
});
