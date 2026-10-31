import { describe, expect, it } from "vitest";
import { CHARACTER_EVENTS, type CharacterLinesFile, type CharacterSheet, type StoryChaptersFile } from "@/lib/characters/content-schema";
import { countWords, findUnknownTokens, formatLintIssue, lintCharacter, type LintIssue } from "@/lib/characters/lint";

interface Fixture {
  folder: string;
  sheet: CharacterSheet;
  lines: CharacterLinesFile;
  chapters: StoryChaptersFile;
}

/** A small character that passes every rule; each test breaks one thing. */
function fixture(): Fixture {
  return {
    folder: "test-coach",
    sheet: {
      slug: "test-coach",
      name: "Test Coach",
      role: "coach",
      placeholder: false,
      voice_notes: "Warm and brief.",
      do: ["Name the task"],
      dont: ["Guilt the user"],
      sample_lines: ["{task} is done. Nice."],
      art_url: null,
      is_launch: false,
      pack_sku: null,
      companion_slug: null,
    },
    lines: {
      placeholder: false,
      lines: CHARACTER_EVENTS.map((event) => ({ id: `test-coach.${event}.001`, event, text: "Ready for {task}? One small step." })),
    },
    chapters: {
      placeholder: false,
      chapters: [1, 2, 3].map((number) => ({ number, title: `Chapter ${number}`, body: "A short page.", unlock_rule: { consistency_days: number } })),
    },
  };
}

function rules(issues: LintIssue[]) {
  return issues.map((issue) => issue.rule);
}

function withLine(text: string) {
  const character = fixture();
  character.lines.lines[0].text = text;
  return lintCharacter(character);
}

describe("lintCharacter", () => {
  it("passes a valid character", () => {
    expect(lintCharacter(fixture())).toEqual([]);
  });

  it("reports schema errors with the file and path", () => {
    const character = fixture();
    (character.lines.lines[1] as Record<string, unknown>).min_streek = 3;
    character.lines.lines[2].min_streak = 5;
    character.lines.lines[2].max_streak = 2;
    const issues = lintCharacter({ ...character, chapters: undefined });

    expect(issues).toContainEqual(expect.objectContaining({ rule: "schema", file: "lines.json", path: "lines.1" }));
    expect(issues).toContainEqual(expect.objectContaining({ rule: "schema", file: "lines.json", path: "lines.2.max_streak" }));
    expect(issues).toContainEqual({ rule: "schema", file: "chapters.json", path: "", message: "file is missing" });
  });

  it("accepts an optional active flag on the sheet", () => {
    const retired = fixture();
    retired.sheet.active = false;
    expect(lintCharacter(retired)).toEqual([]);

    const wrong = fixture();
    (wrong.sheet as Record<string, unknown>).active = "no";
    expect(lintCharacter(wrong)).toContainEqual(expect.objectContaining({ rule: "schema", file: "sheet.json", path: "active" }));
  });

  it("rejects a bad slug and a slug that does not match its folder", () => {
    const bad = fixture();
    bad.sheet.slug = "Test_Coach";
    expect(lintCharacter(bad)).toContainEqual(expect.objectContaining({ rule: "schema", file: "sheet.json", path: "slug" }));

    const moved = fixture();
    moved.folder = "other-coach";
    expect(rules(lintCharacter(moved))).toContain("slug_folder");
  });

  it("requires an active line for every event", () => {
    const missing = fixture();
    missing.lines.lines = missing.lines.lines.filter((line) => line.event !== "comeback");
    expect(lintCharacter(missing)).toEqual([
      { rule: "missing_event", file: "lines.json", path: "lines", message: 'no active line for required event "comeback"' },
    ]);

    const retired = fixture();
    retired.lines.lines.find((line) => line.event === "session_nudge")!.active = false;
    expect(lintCharacter(retired)).toEqual([
      { rule: "missing_event", file: "lines.json", path: "lines", message: 'no active line for required event "session_nudge"' },
    ]);
  });

  it("keeps every line under 40 words, counting {task} as one", () => {
    const words = (count: number) => Array.from({ length: count }, (_, index) => (index === 0 ? "{task}" : "word")).join(" ");
    expect(countWords(words(39))).toBe(39);
    expect(withLine(words(39))).toEqual([]);
    expect(withLine(words(40))).toEqual([
      { rule: "word_count", file: "lines.json", path: "lines.0.text", message: "40 words; lines must be under 40" },
    ]);
  });

  it("applies the 40-word rule to sample lines", () => {
    const character = fixture();
    character.sheet.sample_lines.push(Array.from({ length: 40 }, () => "word").join(" "));
    expect(lintCharacter(character)).toEqual([
      { rule: "word_count", file: "sheet.json", path: "sample_lines.1", message: "40 words; lines must be under 40" },
    ]);
  });

  const BANNED_LINES: Record<string, string> = {
    human_claim: "I'm human too, so {task} is easy.",
    credential: "As your therapist, I say start {task}.",
    romance: "Nice work on {task}, sweetheart.",
    guilt: "You lost your streak, but {task} is waiting.",
    professional_advice: "Sounds like you have ADHD. Try {task}.",
  };

  for (const [category, text] of Object.entries(BANNED_LINES)) {
    it(`rejects ${category} content in a line`, () => {
      const issues = withLine(text);
      expect(rules(issues)).toEqual(["banned_content"]);
      expect(issues[0].message).toContain(`banned ${category} phrase`);
    });
  }

  it("checks sample lines and chapter titles and bodies for banned content too", () => {
    const character = fixture();
    character.sheet.sample_lines.push("I'm a real person.");
    character.chapters.chapters[0].title = "I love you";
    character.chapters.chapters[1].body = "Where were you? I was so lonely.";
    expect(lintCharacter(character).map((issue) => `${issue.file} ${issue.path} ${issue.rule}`)).toEqual([
      "sheet.json sample_lines.1 banned_content",
      "chapters.json chapters.0.title banned_content",
      "chapters.json chapters.1.body banned_content",
      "chapters.json chapters.1.body banned_content",
    ]);
  });

  it("checks voice notes and the do list, but not the dont list, which names banned things", () => {
    const character = fixture();
    character.sheet.voice_notes = "Warm. Says things like: I'm a licensed therapist.";
    character.sheet.do.push("Call the user sweetheart");
    character.sheet.dont.push("Say you are human or a doctor", "Flirt", "Mention a lost streak");
    expect(lintCharacter(character).map((issue) => `${issue.file} ${issue.path} ${issue.rule}`)).toEqual([
      "sheet.json voice_notes banned_content",
      "sheet.json do.1 banned_content",
    ]);
  });

  it("allows only {task} in lines and sample lines, and no tokens in chapters", () => {
    expect(findUnknownTokens("Go do {task} now, {task}!", ["{task}"])).toEqual([]);
    expect(findUnknownTokens("Hi {name}, {Task} and {task", ["{task}"])).toEqual(["{name}", "{Task}", "{"]);

    expect(withLine("Hi {name}, ready for {task}?")).toEqual([
      { rule: "unknown_token", file: "lines.json", path: "lines.0.text", message: 'unknown token "{name}"; only {task} is allowed' },
    ]);

    const chapter = fixture();
    chapter.chapters.chapters[2].body = "You finished {task}.";
    expect(lintCharacter(chapter)).toEqual([
      { rule: "unknown_token", file: "chapters.json", path: "chapters.2.body", message: 'unknown token "{task}"; no tokens are allowed here' },
    ]);
  });

  it("rejects duplicate ids and ids that do not match the slug or event", () => {
    const duplicate = fixture();
    duplicate.lines.lines.push({ ...duplicate.lines.lines[0], text: "Another start." });
    expect(lintCharacter(duplicate)).toEqual([
      { rule: "duplicate_id", file: "lines.json", path: "lines.8.id", message: 'duplicate line id "test-coach.task_started.001"' },
    ]);

    const mismatched = fixture();
    mismatched.lines.lines.push({ id: "other-coach.task_started.002", event: "task_started", text: "Go." });
    mismatched.lines.lines.push({ id: "test-coach.streak.002", event: "comeback", text: "Welcome back." });
    expect(lintCharacter(mismatched).map((issue) => issue.message)).toEqual([
      'line id "other-coach.task_started.002" must start with "test-coach."',
      'line id "test-coach.streak.002" names event "streak" but the line\'s event is "comeback"',
    ]);
  });

  it("requires chapters numbered 1..n without gaps", () => {
    const gap = fixture();
    gap.chapters.chapters[2] = { ...gap.chapters.chapters[2], number: 4, unlock_rule: { consistency_days: 4 } };
    expect(lintCharacter(gap)).toEqual([
      {
        rule: "chapter_numbering",
        file: "chapters.json",
        path: "chapters.2.number",
        message: "chapters must be numbered 1..n in order: expected 3, found 4",
      },
    ]);
  });

  it("requires chapter n to unlock at n consistency days", () => {
    const character = fixture();
    character.chapters.chapters[1].unlock_rule = { consistency_days: 5 };
    expect(lintCharacter(character)).toEqual([
      {
        rule: "unlock_rule",
        file: "chapters.json",
        path: "chapters.1.unlock_rule.consistency_days",
        message: "chapter 2 must unlock at 2 consistency days, not 5",
      },
    ]);
  });

  it("requires the same placeholder flag in all three files", () => {
    const character = fixture();
    character.lines.placeholder = true;
    expect(rules(lintCharacter(character))).toEqual(["placeholder_mismatch"]);
  });

  it("flags placeholder markers left in copy once placeholder is false", () => {
    const character = fixture();
    character.sheet.name = "Test Coach (placeholder)";
    character.sheet.voice_notes = "[placeholder] Warm.";
    character.sheet.do[0] = "[placeholder] Name the task";
    character.lines.lines[0].text = "[placeholder] Starting {task}.";
    expect(lintCharacter(character).map((issue) => `${issue.file} ${issue.path} ${issue.rule}`)).toEqual([
      "sheet.json name placeholder_marker",
      "sheet.json voice_notes placeholder_marker",
      "sheet.json do.0 placeholder_marker",
      "lines.json lines.0.text placeholder_marker",
    ]);

    const draft = fixture();
    for (const file of [draft.sheet, draft.lines, draft.chapters]) file.placeholder = true;
    draft.lines.lines[0].text = "[placeholder] Starting {task}.";
    expect(lintCharacter(draft)).toEqual([]);
  });

  it("formats an issue for the console", () => {
    expect(formatLintIssue("test-coach", { rule: "word_count", file: "lines.json", path: "lines.0.text", message: "too long" })).toBe(
      "test-coach/lines.json lines.0.text: too long [word_count]",
    );
  });
});
