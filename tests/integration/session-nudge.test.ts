import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveFlags } from "@/lib/domain/feature-flags";
import { createFakeSupabase, type FakeSupabase, type Row } from "../helpers/fake-supabase";
import { CHARACTER_ID, OTHER_USER_ID, USER_ID, character, lineText, linesFor, sampleLines } from "../helpers/pivot-fixtures";

const { authed, createAdminClient, enforceRateLimit, getFlags, messagesCreate } = vi.hoisted(() => ({
  authed: vi.fn(),
  createAdminClient: vi.fn(),
  enforceRateLimit: vi.fn(),
  getFlags: vi.fn(),
  messagesCreate: vi.fn(),
}));

vi.mock("@/lib/server/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/http")>()),
  authed,
}));
vi.mock("@/lib/flags", () => ({ getFlags }));
vi.mock("@/lib/server/rate-limit", () => ({ enforceRateLimit }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
// No AI: if anything tried to call the model, the test would see it.
vi.mock("@anthropic-ai/sdk", () => {
  const FakeAnthropic = vi.fn(function FakeAnthropic() { return { messages: { create: messagesCreate } }; });
  return { default: FakeAnthropic, Anthropic: FakeAnthropic };
});

import { GET as getNudge } from "@/app/api/coach/nudge/route";
import { AI_DISCLOSURE } from "@/lib/domain/ai-disclosure";
import { ApiError } from "@/lib/server/http";

const NOT_FOUND = { error: { code: "not_found", message: "Resource not found." } };
const NUDGE_IDS = linesFor("session_nudge");

let db: FakeSupabase;

function seedDatabase(overrides: Partial<Record<string, Row[]>> = {}, insertErrors?: Record<string, { message: string; code?: string }>) {
  db = createFakeSupabase({
    user_coach_profiles: [{ user_id: USER_ID, selected_character_id: CHARACTER_ID, timezone: "America/Chicago", ai_arm: "ai" }],
    characters: [character],
    character_lines: sampleLines,
    character_reactions: [],
    ...overrides,
  }, { insertErrors });
  createAdminClient.mockReturnValue(db);
  authed.mockResolvedValue({ user: { id: USER_ID }, supabase: db });
}

/** A stored reaction showing `lineId`, `minutesAgo` minutes before 2026-10-31T15:00Z. */
const shown = (lineId: string | null, minutesAgo: number, userId = USER_ID): Row => ({
  id: `r-${lineId}-${minutesAgo}-${userId}`,
  user_id: userId,
  task_event_id: null,
  character_id: CHARACTER_ID,
  event: lineId?.split(".")[1] ?? "task_finished",
  source: lineId ? "prewritten" : "ai",
  line_id: lineId,
  text: "earlier",
  disclosure_shown: false,
  created_at: new Date(Date.parse("2026-10-31T15:00:00.000Z") - minutesAgo * 60_000).toISOString(),
});

const request = () => new Request("http://localhost/api/coach/nudge", { headers: { authorization: "Bearer token" } });

beforeEach(() => {
  vi.stubEnv("AI_DISCLOSURE_MAX_GAP_HOURS", "");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  getFlags.mockResolvedValue(resolveFlags({ "pivot_a.enabled": true }));
  enforceRateLimit.mockResolvedValue(undefined);
  messagesCreate.mockReset();
  seedDatabase();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("GET /api/coach/nudge", () => {
  it("answers 404 before authenticating while Pivot A is off", async () => {
    getFlags.mockResolvedValue(resolveFlags({ "pivot_a.enabled": false }));

    const response = await getNudge(request());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual(NOT_FOUND);
    expect(authed).not.toHaveBeenCalled();
  });

  it("returns a prewritten session_nudge line in the selected character's voice, with no AI", async () => {
    const response = await getNudge(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.character).toEqual({ id: CHARACTER_ID, slug: "sample-coach", name: "Sample Coach (placeholder)", artUrl: null });
    expect(NUDGE_IDS.map(lineText)).toContain(body.data.text);
    expect(messagesCreate).not.toHaveBeenCalled();
  });

  it("stores the nudge as a session_nudge reaction with no task event, so it is not repeated", async () => {
    const body = await (await getNudge(request())).json();

    expect(body.data.disclosure).toBe(AI_DISCLOSURE);
    expect(db.inserted.character_reactions).toEqual([expect.objectContaining({
      user_id: USER_ID,
      task_event_id: null,
      character_id: CHARACTER_ID,
      event: "session_nudge",
      source: "prewritten",
      line_id: expect.stringMatching(/^sample-coach\.session_nudge\.\d{3}$/),
      text: body.data.text,
      disclosure_shown: true,
    })]);
  });

  it("does not repeat a line among the user's last 20", async () => {
    const [first, second] = NUDGE_IDS;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      seedDatabase({ character_reactions: [shown(first, 5)] });
      const body = await (await getNudge(request())).json();
      expect(body.data.text).toBe(lineText(second));
    }
  });

  it("alternates between lines over successive nudges", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-31T15:00:00.000Z"));
    const seen = [];
    for (let index = 0; index < 4; index += 1) {
      seen.push((await (await getNudge(request())).json()).data.text);
      // Ten minutes between nudges, so the stored ones have distinct times.
      vi.setSystemTime(new Date(Date.now() + 10 * 60_000));
    }
    vi.useRealTimers();

    expect(seen[0]).not.toBe(seen[1]);
    expect(seen[1]).not.toBe(seen[2]);
    expect(seen[2]).not.toBe(seen[3]);
  });

  it("counts only the last 20 lines: an older nudge may come round again", async () => {
    const [first, second] = NUDGE_IDS;
    // `second` was shown recently; `first` is older than the 20 most recent lines.
    const recentReactionLines = Array.from({ length: 19 }, (_, index) => shown(`sample-coach.task_started.00${(index % 4) + 1}`, index + 10));
    seedDatabase({ character_reactions: [shown(second, 1), ...recentReactionLines, shown(first, 500)] });

    expect((await (await getNudge(request())).json()).data.text).toBe(lineText(first));
  });

  it("ignores another user's history", async () => {
    const [first] = NUDGE_IDS;
    // The caller saw every other nudge; another user saw `first`, which stays available.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      seedDatabase({ character_reactions: [shown(first, 1, OTHER_USER_ID), ...NUDGE_IDS.slice(1).map((id, index) => shown(id, index + 2))] });
      expect((await (await getNudge(request())).json()).data.text).toBe(lineText(first));
    }
  });

  it("returns null with no selected character, and stores nothing", async () => {
    seedDatabase({ user_coach_profiles: [{ user_id: USER_ID, selected_character_id: null, timezone: null, ai_arm: null }] });

    expect(await (await getNudge(request())).json()).toEqual({ data: null });
    expect(db.inserted.character_reactions ?? []).toEqual([]);
  });

  it("returns null without a coach profile or for a retired character", async () => {
    seedDatabase({ user_coach_profiles: [] });
    expect(await (await getNudge(request())).json()).toEqual({ data: null });

    seedDatabase({ characters: [{ ...character, active: false }] });
    expect(await (await getNudge(request())).json()).toEqual({ data: null });
  });

  it("returns null when the character has no usable nudge line", async () => {
    seedDatabase({ character_lines: sampleLines.filter((line) => line.event !== "session_nudge") });
    expect(await (await getNudge(request())).json()).toEqual({ data: null });

    // A nudge line that needs a task title cannot be used: there is no task.
    seedDatabase({ character_lines: [{ ...sampleLines.find((line) => line.event === "session_nudge"), text: "Go finish {task}." }] });
    expect(await (await getNudge(request())).json()).toEqual({ data: null });
  });

  it("ignores retired lines", async () => {
    const [first, second] = NUDGE_IDS;
    seedDatabase({ character_lines: sampleLines.map((line) => (line.id === first ? { ...line, active: false } : line)) });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await (await getNudge(request())).json()).data.text).toBe(lineText(second));
      db.tables.character_reactions = [];
    }
  });

  it("is rate limited to 6 an hour", async () => {
    await getNudge(request());
    expect(enforceRateLimit).toHaveBeenCalledWith(USER_ID, "coach:nudge", 6, 3600);

    enforceRateLimit.mockRejectedValue(new ApiError(429, "You are doing that a little too quickly. Try again shortly.", "rate_limited"));
    const response = await getNudge(request());

    expect(response.status).toBe(429);
    expect((await response.json()).error.code).toBe("rate_limited");
    expect(db.inserted.character_reactions).toHaveLength(1);
  });

  it("still shows the nudge when storing it fails", async () => {
    seedDatabase({}, { character_reactions: { message: "insert failed", code: "XX000" } });

    const response = await getNudge(request());

    expect(response.status).toBe(200);
    expect(NUDGE_IDS.map(lineText)).toContain((await response.json()).data.text);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("session nudge not stored"));
  });

  describe("the daily AI reminder", () => {
    /** 10:00 on 2026-10-31 in America/Chicago (CDT). */
    const NOW = new Date("2026-10-31T15:00:00.000Z");
    const disclosed = (createdAt: string, userId = USER_ID): Row =>
      ({ ...shown("sample-coach.task_started.001", 0, userId), id: `d-${createdAt}-${userId}`, disclosure_shown: true, created_at: createdAt });

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
    });

    it("carries the reminder on the first character line of the local day, and stores that it did", async () => {
      const body = await (await getNudge(request())).json();

      expect(body.data.disclosure).toBe(AI_DISCLOSURE);
      expect(db.inserted.character_reactions[0]).toMatchObject({ event: "session_nudge", disclosure_shown: true });
    });

    it("leaves it off once a reaction or nudge showed it earlier the same local day", async () => {
      seedDatabase({ character_reactions: [disclosed("2026-10-31T13:00:00.000Z")] });

      const body = await (await getNudge(request())).json();

      expect(body.data.disclosure).toBeNull();
      expect(db.inserted.character_reactions[0]).toMatchObject({ disclosure_shown: false });

      // The nudge that carried it counts too: the next one today has none.
      seedDatabase();
      expect((await (await getNudge(request())).json()).data.disclosure).toBe(AI_DISCLOSURE);
      vi.setSystemTime(new Date(NOW.getTime() + 10 * 60_000));
      expect((await (await getNudge(request())).json()).data.disclosure).toBeNull();
    });

    it("measures the day in the user's time zone, not UTC", async () => {
      // 18:00 and 22:00 on 30 October in Chicago, on two different UTC dates.
      vi.setSystemTime(new Date("2026-10-31T03:00:00.000Z"));
      seedDatabase({ character_reactions: [disclosed("2026-10-30T23:00:00.000Z")] });
      expect((await (await getNudge(request())).json()).data.disclosure).toBeNull();

      // 23:00 on 30 October, then 10:00 on 31 October, in Chicago.
      vi.setSystemTime(NOW);
      seedDatabase({ character_reactions: [disclosed("2026-10-31T04:00:00.000Z")] });
      expect((await (await getNudge(request())).json()).data.disclosure).toBe(AI_DISCLOSURE);
    });

    it("re-shows it after AI_DISCLOSURE_MAX_GAP_HOURS when set", async () => {
      vi.stubEnv("AI_DISCLOSURE_MAX_GAP_HOURS", "3");
      seedDatabase({ character_reactions: [disclosed("2026-10-31T11:30:00.000Z")] });

      expect((await (await getNudge(request())).json()).data.disclosure).toBe(AI_DISCLOSURE);
    });

    it("ignores another user's reminder", async () => {
      seedDatabase({ character_reactions: [disclosed("2026-10-31T14:00:00.000Z", OTHER_USER_ID)] });

      expect((await (await getNudge(request())).json()).data.disclosure).toBe(AI_DISCLOSURE);
    });
  });
});
