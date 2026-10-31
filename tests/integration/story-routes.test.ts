import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveFlags } from "@/lib/domain/feature-flags";
import { createFakeSupabase, type FakeSupabase, type Row } from "../helpers/fake-supabase";
import { CHARACTER_ID, NOW, OTHER_USER_ID, PLUS, USER_ID, character } from "../helpers/pivot-fixtures";

const { authed, createAdminClient, enforceRateLimit, getFlags } = vi.hoisted(() => ({
  authed: vi.fn(),
  createAdminClient: vi.fn(),
  enforceRateLimit: vi.fn(),
  getFlags: vi.fn(),
}));

// The real withApi, assertDatabase and story module: only the session, flags,
// rate limiter and database are stand-ins.
vi.mock("@/lib/server/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/http")>()),
  authed,
}));
vi.mock("@/lib/flags", () => ({ getFlags }));
// Age verified; the guard itself is covered by tests/integration/coach-age-guard.test.ts.
vi.mock("@/lib/coach/age", () => ({ isAgeVerified: vi.fn(async () => true), requireAgeVerified: vi.fn(async () => undefined) }));
vi.mock("@/lib/server/rate-limit", () => ({ enforceRateLimit }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));

import { GET as getChapter } from "@/app/api/story/[number]/route";
import { GET as getStory } from "@/app/api/story/route";
import { ApiError } from "@/lib/server/http";

const NOT_FOUND = { error: { code: "not_found", message: "Resource not found." } };
const OTHER_CHARACTER_ID = "c2000000-0000-4000-8000-000000000002";

let db: FakeSupabase;

const chapter = (number: number, overrides: Row = {}): Row => ({
  id: `ch-${number}`,
  character_id: CHARACTER_ID,
  number,
  title: `Title ${number}`,
  body: `Body text of chapter ${number}`,
  unlock_rule: { consistency_days: number },
  active: true,
  ...overrides,
});
const arc = (count: number) => Array.from({ length: count }, (_, index) => chapter(index + 1));
const progress = (consistencyDays: number, unlockedThrough = 0, userId = USER_ID, characterId = CHARACTER_ID): Row =>
  ({ user_id: userId, character_id: characterId, consistency_days: consistencyDays, unlocked_through: unlockedThrough, last_consistency_date: "2026-10-30" });

function useDatabase(overrides: Partial<Record<string, Row[]>> = {}, errors?: Record<string, { message: string; code?: string }>) {
  db = createFakeSupabase({
    user_coach_profiles: [{ user_id: USER_ID, selected_character_id: CHARACTER_ID, timezone: "America/Chicago", ai_arm: "ai" }],
    characters: [character],
    entitlements: [],
    story_progress: [progress(2, 1)],
    story_chapters: arc(5),
    ...overrides,
  }, { errors });
  createAdminClient.mockReturnValue(db);
  authed.mockResolvedValue({ user: { id: USER_ID }, supabase: db });
}

const get = (path: string) => new Request(`http://localhost${path}`, { headers: { authorization: "Bearer token" } });
const chapterContext = (number: string) => ({ params: Promise.resolve({ number }) });
const readChapter = (number: string) => getChapter(get(`/api/story/${number}`), chapterContext(number));

/** Every column list asked of story_chapters, in order. */
const chapterSelects = () => db.from.mock.calls.flatMap(([table], index) =>
  table === "story_chapters" ? db.from.mock.results[index].value.select.mock.calls.map(([columns]: [string]) => columns) : []);

beforeEach(() => {
  vi.setSystemTime(NOW);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  getFlags.mockResolvedValue(resolveFlags({ "pivot_a.enabled": true }));
  enforceRateLimit.mockResolvedValue(undefined);
  useDatabase();
});

describe("GET /api/story", () => {
  it("answers 404 before authenticating while Pivot A is off", async () => {
    getFlags.mockResolvedValue(resolveFlags({ "pivot_a.enabled": false }));

    const response = await getStory(get("/api/story"));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual(NOT_FOUND);
    expect(authed).not.toHaveBeenCalled();
  });

  it("lists every chapter with its lock for a free user: days, then plan past chapter 3", async () => {
    const response = await getStory(get("/api/story"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      character: { id: CHARACTER_ID, slug: "sample-coach", name: "Sample Coach (placeholder)", artUrl: null },
      consistencyDays: 2,
      chapters: [
        { number: 1, title: "Title 1", unlocked: true, lock: null },
        { number: 2, title: "Title 2", unlocked: true, lock: null },
        { number: 3, title: "Title 3", unlocked: false, lock: { reason: "days", daysNeeded: 1 } },
        { number: 4, title: "Title 4", unlocked: false, lock: { reason: "plan" } },
        { number: 5, title: "Title 5", unlocked: false, lock: { reason: "plan" } },
      ],
    });
    expect(enforceRateLimit).toHaveBeenCalledWith(USER_ID, "story:read", 240, 3600);
  });

  it("never returns a body, and never asks for one", async () => {
    const body = JSON.stringify(await (await getStory(get("/api/story"))).json());

    expect(body).not.toContain("Body text");
    expect(chapterSelects()).toEqual(["number, title, unlock_rule"]);
  });

  it("opens every chapter the days allow for Plus and records the highest as unlocked_through", async () => {
    useDatabase({ entitlements: [PLUS], story_progress: [progress(4, 1)] });

    const body = await (await getStory(get("/api/story"))).json();

    expect(body.data.chapters.map((row: { unlocked: boolean }) => row.unlocked)).toEqual([true, true, true, true, false]);
    expect(body.data.chapters[4].lock).toEqual({ reason: "days", daysNeeded: 1 });
    expect(db.tables.story_progress[0]).toMatchObject({ unlocked_through: 4 });
  });

  it("never lowers unlocked_through, e.g. after a trial ends", async () => {
    useDatabase({ story_progress: [progress(5, 5)] });

    const body = await (await getStory(get("/api/story"))).json();

    expect(body.data.chapters.filter((row: { unlocked: boolean }) => row.unlocked)).toHaveLength(3);
    expect(db.tables.story_progress[0]).toMatchObject({ unlocked_through: 5 });
    expect(db.updated.story_progress ?? []).toEqual([]);
  });

  it("returns no character and no chapters without a selected character", async () => {
    useDatabase({ user_coach_profiles: [{ user_id: USER_ID, selected_character_id: null, timezone: null, ai_arm: null }] });

    const body = await (await getStory(get("/api/story"))).json();

    expect(body.data).toEqual({ character: null, consistencyDays: 0, chapters: [] });
  });

  it("returns no character when the selected one was retired", async () => {
    useDatabase({ characters: [{ ...character, active: false }] });

    expect((await (await getStory(get("/api/story"))).json()).data).toEqual({ character: null, consistencyDays: 0, chapters: [] });
  });

  it("starts at zero days before the character's first consistency day", async () => {
    useDatabase({ story_progress: [] });

    const body = await (await getStory(get("/api/story"))).json();

    expect(body.data.consistencyDays).toBe(0);
    expect(body.data.chapters[0]).toEqual({ number: 1, title: "Title 1", unlocked: false, lock: { reason: "days", daysNeeded: 1 } });
  });

  it("uses only the caller's progress on the selected character, never another user's or another character's", async () => {
    useDatabase({
      entitlements: [PLUS],
      story_progress: [progress(30, 30, OTHER_USER_ID), progress(30, 30, USER_ID, OTHER_CHARACTER_ID), progress(1, 0)],
    });

    const body = await (await getStory(get("/api/story"))).json();

    expect(body.data.consistencyDays).toBe(1);
    expect(body.data.chapters.filter((row: { unlocked: boolean }) => row.unlocked).map((row: { number: number }) => row.number)).toEqual([1]);
    expect(db.tables.story_progress.find((row) => row.user_id === OTHER_USER_ID)).toMatchObject({ unlocked_through: 30 });
  });

  it("leaves retired chapters out", async () => {
    useDatabase({ story_chapters: [chapter(1), chapter(2, { active: false }), chapter(3)] });

    const body = await (await getStory(get("/api/story"))).json();

    expect(body.data.chapters.map((row: { number: number }) => row.number)).toEqual([1, 3]);
  });

  it("answers 429 when rate limited", async () => {
    enforceRateLimit.mockRejectedValue(new ApiError(429, "Slow down.", "rate_limited"));

    const response = await getStory(get("/api/story"));

    expect(response.status).toBe(429);
    expect(db.from).not.toHaveBeenCalled();
  });

  it("still answers when unlocked_through cannot be stored", async () => {
    useDatabase({ entitlements: [PLUS], story_progress: [progress(4, 1)] });
    const original = db.from.getMockImplementation() as (table: string) => { update: ReturnType<typeof vi.fn> };
    db.from.mockImplementation((table: string) => {
      const builder = original(table);
      if (table === "story_progress") builder.update.mockImplementation(() => { throw new Error("write failed"); });
      return builder;
    });

    const response = await getStory(get("/api/story"));

    expect(response.status).toBe(200);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("unlocked_through not stored"));
  });
});

describe("GET /api/story/[number]", () => {
  it("answers 404 before authenticating while Pivot A is off", async () => {
    getFlags.mockResolvedValue(resolveFlags({ "pivot_a.enabled": false }));

    const response = await readChapter("1");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual(NOT_FOUND);
    expect(authed).not.toHaveBeenCalled();
  });

  it("returns an unlocked chapter's body", async () => {
    const response = await readChapter("2");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { number: 2, title: "Title 2", body: "Body text of chapter 2" } });
    expect(enforceRateLimit).toHaveBeenCalledWith(USER_ID, "story:read", 240, 3600);
  });

  it("records the chapter read as unlocked_through, never lowering it", async () => {
    await readChapter("2");
    expect(db.tables.story_progress[0]).toMatchObject({ unlocked_through: 2 });

    await readChapter("1");
    expect(db.tables.story_progress[0]).toMatchObject({ unlocked_through: 2 });
  });

  it.each([
    ["locked by days", "3"],
    ["locked by the plan", "4"],
    ["missing", "9"],
  ])("answers 404 for a chapter %s, without reading its body", async (_name, number) => {
    const response = await readChapter(number);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual(NOT_FOUND);
    expect(chapterSelects()).not.toContainEqual(expect.stringContaining("body"));
  });

  it("answers 404 for a retired chapter", async () => {
    useDatabase({ story_chapters: [chapter(1), chapter(2, { active: false })] });

    expect((await readChapter("2")).status).toBe(404);
  });

  it("answers 404 without a selected character", async () => {
    useDatabase({ user_coach_profiles: [] });

    expect((await readChapter("1")).status).toBe(404);
  });

  it("answers 404 for another character's chapter, even an unlocked number", async () => {
    useDatabase({ story_chapters: [chapter(1, { character_id: OTHER_CHARACTER_ID })] });

    expect((await readChapter("1")).status).toBe(404);
  });

  it("does not open a chapter with another user's progress", async () => {
    useDatabase({ entitlements: [PLUS], story_progress: [progress(30, 30, OTHER_USER_ID)] });

    expect((await readChapter("1")).status).toBe(404);
  });

  it("opens the character's whole arc for the pack owner on the free plan", async () => {
    useDatabase({
      entitlements: [{ user_id: USER_ID, product: "pack:sample-coach", status: "active", source: "stripe", trial_ends_at: null, current_period_end: null }],
      story_progress: [progress(5, 3)],
    });

    expect(await (await readChapter("5")).json()).toEqual({ data: { number: 5, title: "Title 5", body: "Body text of chapter 5" } });
  });

  it.each(["0", "-1", "1.5", "01", "abc", "1e3", "9999999999"])("rejects the malformed number %s", async (number) => {
    const response = await readChapter(number);

    expect(response.status).toBe(422);
    expect(chapterSelects()).toEqual([]);
  });

  it("answers 503 rather than a body when the database is unavailable", async () => {
    useDatabase({}, { story_chapters: { message: "down", code: "57P01" } });

    const response = await readChapter("1");

    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("Body text");
  });
});
