import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeSupabase, type Row } from "../helpers/fake-supabase";
import { CHARACTER_ID, OTHER_USER_ID, USER_ID } from "../helpers/pivot-fixtures";

const { createAdminClient } = vi.hoisted(() => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));

import { getConsistencySummary } from "@/lib/coach/consistency";

const OTHER_CHARACTER_ID = "c2000000-0000-4000-8000-000000000002";
let db: FakeSupabase;

/** A coach_consistency_dates row: the finish trigger writes one per user and local date with a finish. */
const day = (date: string, userId = USER_ID): Row => ({ user_id: userId, local_date: date });
const finishedEvent = (date: string, taskId: string): Row => ({ id: `finish-${taskId}`, user_id: USER_ID, task_id: taskId, type: "finished", local_date: date, occurrence_key: "single" });

/** coach_consistency_total_days as the migration defines it: the user's rows in the ledger. */
function useDatabase(tables: Record<string, Row[]>, options: { rpcError?: boolean; tableErrors?: Record<string, { message: string; code?: string }> } = {}) {
  db = createFakeSupabase(tables, {
    errors: options.tableErrors,
    rpc(name, args, fake) {
      if (name !== "coach_consistency_total_days") return undefined;
      if (options.rpcError) return { data: null, error: { message: "down", code: "57P01" } };
      return { data: (fake.tables.coach_consistency_dates ?? []).filter((row) => row.user_id === args.p_user_id).length, error: null };
    },
  });
  createAdminClient.mockReturnValue(db);
}

const profile = (characterId: string | null = CHARACTER_ID): Row => ({ user_id: USER_ID, selected_character_id: characterId, timezone: "America/Chicago" });
const progress = (days: number, userId = USER_ID, characterId = CHARACTER_ID): Row =>
  ({ user_id: userId, character_id: characterId, consistency_days: days, unlocked_through: 0, last_consistency_date: "2026-10-30" });

beforeEach(() => {
  useDatabase({});
});

describe("getConsistencySummary", () => {
  it("counts the user's local days with a finish, and the selected character's consistency days", async () => {
    useDatabase({
      coach_consistency_dates: [day("2026-10-01"), day("2026-10-02"), day("2026-10-09", OTHER_USER_ID)],
      user_coach_profiles: [profile()],
      story_progress: [progress(2), progress(9, USER_ID, OTHER_CHARACTER_ID), progress(40, OTHER_USER_ID)],
    });

    expect(await getConsistencySummary(USER_ID)).toEqual({ totalDays: 2, characterDays: 2 });
    expect(db.rpc).toHaveBeenCalledWith("coach_consistency_total_days", { p_user_id: USER_ID });
  });

  it("gives null character days with no character selected, or no coach profile", async () => {
    useDatabase({ coach_consistency_dates: [day("2026-10-01")], user_coach_profiles: [profile(null)] });
    expect(await getConsistencySummary(USER_ID)).toEqual({ totalDays: 1, characterDays: null });

    useDatabase({ coach_consistency_dates: [day("2026-10-01")] });
    expect(await getConsistencySummary(USER_ID)).toEqual({ totalDays: 1, characterDays: null });
  });

  it("gives 0 character days before the selected character's first day", async () => {
    useDatabase({ user_coach_profiles: [profile()] });

    expect(await getConsistencySummary(USER_ID)).toEqual({ totalDays: 0, characterDays: 0 });
  });

  it("never goes down after a gap: a missed week keeps every day earned, and the next finish adds one", async () => {
    useDatabase({
      coach_consistency_dates: [day("2026-10-01"), day("2026-10-02"), day("2026-10-03")],
      user_coach_profiles: [profile()],
      story_progress: [progress(3)],
    });
    const before = await getConsistencySummary(USER_ID);

    // A week with nothing finished changes nothing.
    expect(await getConsistencySummary(USER_ID)).toEqual(before);

    // Coming back after the gap adds the new day on top.
    db.tables.coach_consistency_dates.push(day("2026-10-11"));
    db.tables.story_progress[0].consistency_days = 4;
    const after = await getConsistencySummary(USER_ID);

    expect(before).toEqual({ totalDays: 3, characterDays: 3 });
    expect(after).toEqual({ totalDays: 4, characterDays: 4 });
  });

  it("does not go down when the finished tasks are deleted (the ledger outlives their events)", async () => {
    useDatabase({
      task_events: [finishedEvent("2026-10-01", "t1"), finishedEvent("2026-10-02", "t2")],
      coach_consistency_dates: [day("2026-10-01"), day("2026-10-02")],
      user_coach_profiles: [profile()],
      story_progress: [progress(2)],
    });
    const before = await getConsistencySummary(USER_ID);

    // Deleting the tasks cascades their events away.
    db.tables.task_events = [];

    expect(await getConsistencySummary(USER_ID)).toEqual(before);
    expect(before).toEqual({ totalDays: 2, characterDays: 2 });
  });

  it("throws rather than reporting 0 when the database cannot be read", async () => {
    useDatabase({ user_coach_profiles: [profile()] }, { rpcError: true });
    await expect(getConsistencySummary(USER_ID)).rejects.toThrow("consistency total unavailable");

    useDatabase({ user_coach_profiles: [profile()] }, { tableErrors: { story_progress: { message: "down", code: "57P01" } } });
    await expect(getConsistencySummary(USER_ID)).rejects.toThrow("story progress unavailable");

    useDatabase({}, { tableErrors: { user_coach_profiles: { message: "down", code: "57P01" } } });
    await expect(getConsistencySummary(USER_ID)).rejects.toThrow("coach profile unavailable");
  });
});
