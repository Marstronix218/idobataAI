import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  CHARACTER_EVENTS,
  CHARACTER_ROLES,
  TASK_AGE_BUCKETS,
  renderCharacterJsonSchemas,
  type CharacterEvent,
  type CharacterRole,
  type TaskAgeBucket,
} from "@/lib/characters/content-schema";
import type {
  CharacterEvent as DatabaseCharacterEvent,
  CharacterRole as DatabaseCharacterRole,
  TaskAgeBucket as DatabaseTaskAgeBucket,
} from "@/types/database";

const SCHEMA_DIR = join(process.cwd(), "content", "characters", "schema");

describe("content/characters/schema", () => {
  for (const [kind, generated] of Object.entries(renderCharacterJsonSchemas())) {
    it(`${kind}.schema.json matches the Zod schema (run npm run content:schema)`, () => {
      expect(readFileSync(join(SCHEMA_DIR, `${kind}.schema.json`), "utf8")).toBe(generated);
    });
  }

  it("uses the same roles, events and age buckets as the database types", () => {
    expectTypeOf<CharacterRole>().toEqualTypeOf<DatabaseCharacterRole>();
    expectTypeOf<CharacterEvent>().toEqualTypeOf<DatabaseCharacterEvent>();
    expectTypeOf<TaskAgeBucket>().toEqualTypeOf<DatabaseTaskAgeBucket>();
    // The CHECK lists in 20261031120100_pivot_a_core_schema.sql, in order.
    expect(CHARACTER_ROLES).toEqual(["coach", "rival", "cheerleader", "deadpan"]);
    expect(CHARACTER_EVENTS).toEqual([
      "task_started", "task_finished", "first_of_day", "streak", "comeback",
      "session_nudge", "split_intro", "chapter_unlocked",
    ]);
    expect(TASK_AGE_BUCKETS).toEqual(["fresh", "days", "weeks", "stale"]);
  });
});
