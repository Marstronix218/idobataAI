import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { storyChapterLockSchema, storyOverviewSchema } from "@idobata/contracts";
import { findBannedContent } from "@/lib/characters/banned-content";
import { chooseLineEvent } from "@/lib/domain/line-event";
import { buildReactionUserMessage } from "@/lib/reactions/prompt";

// SPEC guardrail "No guilt mechanics" and Phase 4 "Streaks: show only positive
// progress": nothing on the server or on a Pivot A screen says a streak was
// lost or broken, the character screens show no streak at all, and no number
// the server hands the client counts down. The comeback rules themselves are
// in tests/domain/line-event.test.ts ("the no-guilt comeback").

const ROOT = process.cwd();
// The banned-phrase list itself, which has to spell out the phrases it bans.
const PHRASE_LIST = "src/lib/characters/banned-content.ts";

/** Pivot A screens and routes. Legacy files that show the old streak only while Pivot A is off are left out on purpose. */
const PIVOT_UI = [
  "src/components/coach",
  "src/components/safety",
  "src/components/onboarding/pivot-onboarding.tsx",
  "src/app/(app)/story",
  "src/app/(app)/characters",
  "src/app/api/story",
  "src/app/api/coach",
  "src/app/api/characters",
  "src/app/api/tasks/[id]/start",
  "src/app/api/tasks/[id]/finish",
  "src/app/api/tasks/[id]/split",
];
/** Character screens: no streak, positive or not; they show consistency days. */
const COACH_COMPONENTS = "src/components/coach";

const toPosix = (path: string) => path.split(sep).join("/");

/** The .ts/.tsx files at `path` (a file or a folder, relative to the repo root), as repo-relative paths. */
function sourceFiles(path: string): string[] {
  const absolute = join(ROOT, path);
  if (!statSync(absolute).isDirectory()) return [toPosix(path)];
  return (readdirSync(absolute, { recursive: true }) as string[])
    .filter((entry) => /\.tsx?$/.test(entry))
    .map((entry) => toPosix(relative(ROOT, join(absolute, entry))));
}

const libFiles = sourceFiles("src/lib").filter((file) => file !== PHRASE_LIST);
const uiFiles = PIVOT_UI.flatMap(sourceFiles);

/** Every string literal, template text and JSX text in a file: what it can show or say, not its comments. */
function stringsIn(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(join(ROOT, file), "utf8"), ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) found.push(node.text);
    else if (ts.isTemplateExpression(node)) found.push([node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(" … "));
    else if (ts.isJsxText(node) && node.text.trim()) found.push(node.text.trim());
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function guiltIn(files: readonly string[]): string[] {
  return files.flatMap((file) =>
    stringsIn(file).flatMap((text) =>
      findBannedContent(text).filter((match) => match.category === "guilt").map((match) => `${file}: "${match.phrase}"`)));
}

describe("no-guilt streaks", () => {
  it("scans the server code and the Pivot A screens", () => {
    expect(libFiles.length).toBeGreaterThan(40);
    expect(libFiles).toContain("src/lib/coach/consistency.ts");
    expect(uiFiles).toEqual(expect.arrayContaining([
      "src/components/coach/reaction-bubble.tsx",
      "src/components/safety/crisis-card.tsx",
      "src/components/onboarding/pivot-onboarding.tsx",
      "src/app/(app)/story/page.tsx",
      "src/app/api/story/route.ts",
    ]));
  });

  it("has no lost-streak, missed-day or shaming text anywhere in src/lib", () => {
    expect(guiltIn(libFiles)).toEqual([]);
  });

  it("has no lost-streak, missed-day or shaming text on any Pivot A screen or route", () => {
    expect(guiltIn(uiFiles)).toEqual([]);
  });

  it("shows no streak at all on the character screens, only consistency days", () => {
    const offenders = sourceFiles(COACH_COMPONENTS).flatMap((file) =>
      stringsIn(file).filter((text) => /streak/i.test(text)).map((text) => `${file}: "${text}"`));
    expect(offenders).toEqual([]);
  });

  it("never tells the model about a streak of zero, so it has no lost streak to mention", () => {
    const afterGap = buildReactionUserMessage({
      taskTitle: "Water the plants",
      taskAgeDays: 3,
      taskAgeBucket: "days",
      streak: 0,
      eventType: "finished",
      moment: chooseLineEvent({ eventType: "finished", isFirstReactionOfLocalDay: true, isFirstFinishOfLocalDay: true, currentStreak: 0, daysSinceLastActivity: 6 }),
      timeOfDay: "morning",
      recentTexts: [],
    });
    expect(afterGap).not.toMatch(/streak:/i);
    expect(afterGap).toMatch(/Moment: they are back/);
  });

  it("only ever hands the client counts that are zero or more", () => {
    expect(storyOverviewSchema.safeParse({ character: null, consistencyDays: -1, chapters: [] }).success).toBe(false);
    expect(storyChapterLockSchema.safeParse({ reason: "days", daysNeeded: 0 }).success).toBe(false);
    expect(storyOverviewSchema.safeParse({ character: null, consistencyDays: 0, chapters: [] }).success).toBe(true);
  });
});
