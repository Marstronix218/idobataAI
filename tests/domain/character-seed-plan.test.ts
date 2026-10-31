import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  blockedPlaceholderSlugs,
  chapterRow,
  characterRow,
  describePlan,
  isLocalSupabaseUrl,
  lineRow,
  listCharacterFolders,
  parseSeedArgs,
  planCharacterRetirements,
  planCharacterSeed,
  planHasWrites,
  readCharacterFolder,
} from "../../scripts/lib/character-seed.mjs";

const sheet = {
  $schema: "../schema/sheet.schema.json",
  slug: "test-coach",
  name: "Test Coach",
  role: "coach",
  placeholder: false,
  voice_notes: "Warm.",
  do: ["Name the task"],
  dont: ["Guilt"],
  sample_lines: ["{task} done."],
  art_url: null,
  is_launch: true,
  pack_sku: null,
  companion_slug: "nova",
};
const lines = {
  placeholder: false,
  lines: [
    { id: "test-coach.task_started.001", event: "task_started", text: "Starting {task}." },
    { id: "test-coach.streak.001", event: "streak", text: "A few days.", min_streak: 2, max_streak: 4, tags: ["calm"] },
    { id: "test-coach.comeback.001", event: "comeback", text: "Welcome back.", task_age_bucket: "stale", active: false },
  ],
};
const chapters = {
  placeholder: false,
  chapters: [
    { number: 1, title: "One", body: "Page one.", unlock_rule: { consistency_days: 1 } },
    { number: 2, title: "Two", body: "Page two.", unlock_rule: { consistency_days: 2 } },
  ],
};
const content = { sheet, lines, chapters };

/** What the database holds after seeding `content`, with jsonb keys in another order. */
function seededRows() {
  const character = characterRow(sheet, "companion-1");
  return {
    character: { id: "character-1", ...character, sheet: Object.fromEntries(Object.entries(character.sheet).reverse()) },
    lines: lines.lines.map((line) => ({ ...lineRow(line) })),
    chapters: chapters.chapters.map((chapter) => ({ ...chapterRow(chapter) })),
  };
}

describe("planCharacterSeed", () => {
  it("inserts everything for a new character", () => {
    const plan = planCharacterSeed(content, { character: null, lines: [], chapters: [] }, "companion-1");

    expect(plan.characterId).toBeNull();
    expect(plan.character).toEqual({
      action: "insert",
      row: {
        slug: "test-coach",
        name: "Test Coach",
        role: "coach",
        art_url: null,
        is_launch: true,
        pack_sku: null,
        companion_id: "companion-1",
        sheet: Object.fromEntries(Object.entries(sheet).filter(([key]) => key !== "$schema")),
        active: true,
      },
    });
    expect(plan.lines.insert).toEqual([
      { id: "test-coach.task_started.001", event: "task_started", text: "Starting {task}.", min_streak: null, max_streak: null, task_age_bucket: null, tags: [], active: true },
      { id: "test-coach.streak.001", event: "streak", text: "A few days.", min_streak: 2, max_streak: 4, task_age_bucket: null, tags: ["calm"], active: true },
      { id: "test-coach.comeback.001", event: "comeback", text: "Welcome back.", min_streak: null, max_streak: null, task_age_bucket: "stale", tags: [], active: false },
    ]);
    expect(plan.chapters.insert).toEqual([
      { number: 1, title: "One", body: "Page one.", unlock_rule: { consistency_days: 1 }, active: true },
      { number: 2, title: "Two", body: "Page two.", unlock_rule: { consistency_days: 2 }, active: true },
    ]);
    expect(plan.lines.deactivate).toEqual([]);
    expect(planHasWrites(plan)).toBe(true);
  });

  it("writes nothing when the database already matches the files", () => {
    const plan = planCharacterSeed(content, seededRows(), "companion-1");

    expect(plan.characterId).toBe("character-1");
    expect(plan.character.action).toBe("unchanged");
    expect(plan.lines).toEqual({ insert: [], update: [], unchanged: 3, deactivate: [] });
    expect(plan.chapters).toEqual({ insert: [], update: [], unchanged: 2, deactivate: [] });
    expect(planHasWrites(plan)).toBe(false);
  });

  it("updates only the rows that changed", () => {
    const existing = seededRows();
    existing.lines[1].text = "Old copy.";
    existing.chapters[0].unlock_rule = { consistency_days: 7 };
    existing.character.sheet = { ...existing.character.sheet, voice_notes: "Old notes." };

    const plan = planCharacterSeed(content, existing, "companion-1");
    expect(plan.character.action).toBe("update");
    expect(plan.lines.update.map((row) => row.id)).toEqual(["test-coach.streak.001"]);
    expect(plan.lines.unchanged).toBe(2);
    expect(plan.chapters.update.map((row) => row.number)).toEqual([1]);
  });

  it("updates the character when its companion link changes", () => {
    expect(planCharacterSeed(content, seededRows(), null).character.action).toBe("update");
  });

  it("retires a character whose sheet says active: false, keeping its rows", () => {
    const plan = planCharacterSeed({ ...content, sheet: { ...sheet, active: false } }, seededRows(), "companion-1");
    expect(plan.character.action).toBe("update");
    expect(plan.character.row.active).toBe(false);
    expect(plan.lines.deactivate).toEqual([]);
    expect(plan.chapters.deactivate).toEqual([]);
  });

  it("reactivates a retired character whose folder is back", () => {
    const existing = seededRows();
    existing.character.active = false;
    const plan = planCharacterSeed(content, existing, "companion-1");
    expect(plan.character.action).toBe("update");
    expect(plan.character.row.active).toBe(true);
  });

  it("deactivates rows that left the files, and never deletes", () => {
    const existing = seededRows();
    existing.lines.push(
      { ...lineRow({ id: "test-coach.task_finished.009", event: "task_finished", text: "Removed." }) },
      { ...lineRow({ id: "test-coach.task_finished.010", event: "task_finished", text: "Already off.", active: false }) },
    );
    existing.chapters.push({ ...chapterRow({ number: 3, title: "Three", body: "Removed.", unlock_rule: { consistency_days: 3 } }) });

    const plan = planCharacterSeed(content, existing, "companion-1");
    expect(plan.lines.deactivate).toEqual(["test-coach.task_finished.009"]);
    expect(plan.chapters.deactivate).toEqual([3]);
    expect(plan.lines.insert).toEqual([]);
    expect(plan.lines.update).toEqual([]);
    expect(planHasWrites(plan)).toBe(true);
  });

  it("reactivates a row that comes back to the files", () => {
    const existing = seededRows();
    existing.lines[0].active = false;
    existing.chapters[1].active = false;

    const plan = planCharacterSeed(content, existing, "companion-1");
    expect(plan.lines.update).toEqual([expect.objectContaining({ id: "test-coach.task_started.001", active: true })]);
    expect(plan.chapters.update).toEqual([expect.objectContaining({ number: 2, active: true })]);
  });

  it("describes the plan, listing changed ids in detail mode", () => {
    const existing = seededRows();
    existing.lines[0].text = "Old.";
    existing.lines.push({ ...lineRow({ id: "test-coach.task_finished.009", event: "task_finished", text: "Removed." }) });
    const plan = planCharacterSeed(content, existing, "companion-1");

    expect(describePlan(plan)).toEqual([
      "test-coach: character unchanged",
      "  lines: 0 new, 1 changed, 2 unchanged, 1 to deactivate",
      "  chapters: 0 new, 0 changed, 2 unchanged, 0 to deactivate",
      "    deactivate lines: test-coach.task_finished.009",
    ]);
    expect(describePlan(plan, { detailed: true })).toContain("    changed lines: test-coach.task_started.001");
  });
});

describe("planCharacterRetirements", () => {
  it("retires active characters whose folder is gone, and never touches the rest", () => {
    const rows = [
      { slug: "sample-coach", active: true },
      { slug: "old-rival", active: true },
      { slug: "already-retired", active: false },
      { slug: "another-gone", active: true },
    ];
    expect(planCharacterRetirements(["sample-coach"], rows)).toEqual(["another-gone", "old-rival"]);
    expect(planCharacterRetirements(["sample-coach", "old-rival", "another-gone"], rows)).toEqual([]);
    expect(planCharacterRetirements(["sample-coach"], [])).toEqual([]);
  });
});

describe("seed options and guards", () => {
  it("parses --dry-run, --only and --allow-placeholder", () => {
    expect(parseSeedArgs([])).toEqual({ dryRun: false, only: null, allowPlaceholder: false });
    expect(parseSeedArgs(["--dry-run", "--only", "sample-coach", "--allow-placeholder"])).toEqual({
      dryRun: true,
      only: "sample-coach",
      allowPlaceholder: true,
    });
    expect(parseSeedArgs(["--only=sample-coach"]).only).toBe("sample-coach");
    expect(() => parseSeedArgs(["--only"])).toThrow(/needs a character slug/);
    expect(() => parseSeedArgs(["--only", "--dry-run"])).toThrow(/needs a character slug/);
    expect(() => parseSeedArgs(["--only", "a", "--only", "b"])).toThrow(/single slug/);
    expect(() => parseSeedArgs(["--force"])).toThrow(/Unknown option/);
  });

  it("treats only loopback hosts as local", () => {
    expect(isLocalSupabaseUrl("http://127.0.0.1:54321")).toBe(true);
    expect(isLocalSupabaseUrl("http://localhost:54321")).toBe(true);
    expect(isLocalSupabaseUrl("http://[::1]:54321")).toBe(true);
    expect(isLocalSupabaseUrl("https://abcdefgh.supabase.co")).toBe(false);
    expect(isLocalSupabaseUrl("https://localhost.example.com")).toBe(false);
  });

  it("blocks placeholder characters on a non-local project unless allowed", () => {
    const sheets = [
      { slug: "sample-coach", placeholder: true },
      { slug: "real-coach", placeholder: false },
    ];
    expect(blockedPlaceholderSlugs(sheets, "https://abcdefgh.supabase.co", false)).toEqual(["sample-coach"]);
    expect(blockedPlaceholderSlugs(sheets, "https://abcdefgh.supabase.co", true)).toEqual([]);
    expect(blockedPlaceholderSlugs(sheets, "http://127.0.0.1:54321", false)).toEqual([]);
  });
});

describe("reading content folders", () => {
  let root: string | undefined;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  it("lists character folders only, and reads each file or reports it missing", () => {
    root = mkdtempSync(join(tmpdir(), "characters-"));
    for (const folder of ["b-coach", "a-coach", "schema", ".hidden"]) mkdirSync(join(root, folder));
    writeFileSync(join(root, "README.md"), "# Characters\n");
    writeFileSync(join(root, "a-coach", "sheet.json"), '{ "slug": "a-coach" }');
    writeFileSync(join(root, "b-coach", "lines.json"), "{ not json");

    expect(listCharacterFolders(root)).toEqual(["a-coach", "b-coach"]);
    expect(readCharacterFolder(root, "a-coach")).toEqual({ folder: "a-coach", sheet: { slug: "a-coach" }, lines: undefined, chapters: undefined });
    expect(() => readCharacterFolder(root!, "b-coach")).toThrow(/b-coach\/lines\.json is not valid JSON/);
  });
});
