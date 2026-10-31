import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHARACTER_EVENTS } from "@/lib/characters/content-schema";
import { formatLintIssue, lintCharacter } from "@/lib/characters/lint";
import { listCharacterFolders, readCharacterFolder } from "../../scripts/lib/character-seed.mjs";

// Reads the folders exactly as `npm run content:seed` does.
const CONTENT_ROOT = join(process.cwd(), "content", "characters");
const folders = listCharacterFolders(CONTENT_ROOT);

describe("content/characters", () => {
  it("has at least the sample character", () => {
    expect(folders).toContain("sample-coach");
  });

  for (const folder of folders) {
    it(`${folder} passes the content linter`, () => {
      const issues = lintCharacter(readCharacterFolder(CONTENT_ROOT, folder));
      expect(issues.map((issue) => formatLintIssue(folder, issue))).toEqual([]);
    });
  }

  it("keeps the sample character clearly marked as placeholder copy", () => {
    const { sheet, lines, chapters } = readCharacterFolder(CONTENT_ROOT, "sample-coach") as {
      sheet: { name: string; role: string; placeholder: boolean; sample_lines: string[] };
      lines: { placeholder: boolean; lines: Array<{ event: string; text: string; min_streak?: number }> };
      chapters: { placeholder: boolean; chapters: Array<{ title: string; body: string }> };
    };

    expect([sheet.placeholder, lines.placeholder, chapters.placeholder]).toEqual([true, true, true]);
    expect(sheet.role).toBe("coach");
    expect(sheet.name).toMatch(/\(placeholder\)/);
    expect(lines.lines.length).toBeGreaterThanOrEqual(18);
    expect(lines.lines.length).toBeLessThanOrEqual(24);
    expect(chapters.chapters).toHaveLength(3);
    expect(new Set(lines.lines.map((line) => line.event))).toEqual(new Set(CHARACTER_EVENTS));
    expect(lines.lines.filter((line) => line.text.includes("{task}")).length).toBeGreaterThanOrEqual(5);
    expect(lines.lines.filter((line) => line.event === "streak" && line.min_streak !== undefined).length).toBeGreaterThanOrEqual(2);

    const copy = [
      ...sheet.sample_lines,
      ...lines.lines.map((line) => line.text),
      ...chapters.chapters.flatMap((chapter) => [chapter.title, chapter.body]),
    ];
    for (const text of copy) expect(text, text).toMatch(/^\[placeholder\] /);
  });
});
