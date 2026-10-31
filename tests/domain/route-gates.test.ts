import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveFlags, type PivotFlags } from "@/lib/domain/feature-flags";

const { getFlags, notFound } = vi.hoisted(() => ({
  getFlags: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NEXT_HTTP_ERROR_FALLBACK;404"); }),
}));
vi.mock("@/lib/flags", () => ({ getFlags }));
vi.mock("next/navigation", () => ({ notFound }));

import { ApiError } from "@/lib/server/http";
import { ROUTE_GATES, gateForRoute, isGateOpen, requireApiGate, requirePageGate, type RouteGate } from "@/lib/flags/route-gates";

const APP_DIR = join(process.cwd(), "src", "app");
const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

function routeFiles(root: string, fileName: string) {
  return (readdirSync(join(APP_DIR, root), { recursive: true }) as string[])
    .filter((path) => path.split(sep).at(-1) === fileName)
    .map((path) => join(APP_DIR, root, path));
}

/** The route folder relative to src/app, with `/` separators. */
const folderOf = (file: string) => relative(APP_DIR, dirname(file)).split(sep).join("/");

const apiRoutes = routeFiles("api", "route.ts");
const appPages = routeFiles("(app)", "page.tsx");

const parse = (file: string) => ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const isExported = (node: ts.Node) => (ts.canHaveModifiers(node) ? ts.getModifiers(node) ?? [] : []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
const isDefault = (node: ts.Node) => (ts.canHaveModifiers(node) ? ts.getModifiers(node) ?? [] : []).some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword);

/** String literals a gate argument can evaluate to: `"x"` or `cond ? "x" : "y"`. */
function gateLiterals(argument: ts.Expression | undefined): string[] {
  if (!argument) return [];
  if (ts.isStringLiteral(argument)) return [argument.text];
  if (ts.isConditionalExpression(argument)) return [...gateLiterals(argument.whenTrue), ...gateLiterals(argument.whenFalse)];
  return ["<dynamic>"];
}

type GateCall = { callee: "requireApiGate" | "isGateOpen" | "requirePageGate"; gates: string[] };

/** Gate calls in source order, following calls into the file's own top-level functions. */
function gateCalls(body: ts.Node, localFunctions: Map<string, ts.Node>, seen = new Set<string>()): GateCall[] {
  const calls: GateCall[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const name = node.expression.text;
      if (name === "requireApiGate" || name === "requirePageGate") calls.push({ callee: name, gates: gateLiterals(node.arguments[0]) });
      else if (name === "isGateOpen") calls.push({ callee: name, gates: gateLiterals(node.arguments[1]) });
      else if (localFunctions.has(name) && !seen.has(name)) calls.push(...gateCalls(localFunctions.get(name)!, localFunctions, new Set([...seen, name])));
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return calls;
}

function topLevelFunctions(source: ts.SourceFile) {
  const functions = new Map<string, ts.Node>();
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) functions.set(statement.name.text, statement.body);
  }
  return functions;
}

/** Every exported HTTP handler: `export async function GET` or `export const GET = run`. */
function apiHandlers(file: string) {
  const source = parse(file);
  const functions = topLevelFunctions(source);
  const handlers: Array<{ method: string; body: ts.Node; text: string }> = [];
  for (const statement of source.statements) {
    if (!isExported(statement)) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name && HTTP_METHODS.has(statement.name.text) && statement.body) {
      handlers.push({ method: statement.name.text, body: statement.body, text: statement.body.getText(source) });
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !HTTP_METHODS.has(declaration.name.text) || !declaration.initializer) continue;
        const body = ts.isIdentifier(declaration.initializer) ? functions.get(declaration.initializer.text) : declaration.initializer;
        if (body) handlers.push({ method: declaration.name.text, body, text: body.getText(source) });
      }
    }
  }
  return { handlers, functions };
}

function defaultExportBody(file: string) {
  const source = parse(file);
  const page = source.statements.find((statement): statement is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(statement) && isExported(statement) && isDefault(statement));
  return page?.body ? { body: page.body, functions: topLevelFunctions(source) } : null;
}

const gatedApiHandlers = apiRoutes.flatMap((file) => {
  const folder = folderOf(file);
  const gate = gateForRoute(folder);
  if (!gate || gate === "always") return [];
  const { handlers, functions } = apiHandlers(file);
  return handlers.map(({ method, body, text }) => ({ name: `${method} ${folder}`, gate, calls: gateCalls(body, functions), text }));
});

describe("ROUTE_GATES coverage", () => {
  it("finds the routes it is meant to cover", () => {
    expect(apiRoutes.length).toBeGreaterThan(40);
    expect(appPages.length).toBeGreaterThan(15);
    expect(gatedApiHandlers.length).toBeGreaterThan(40);
  });

  it.each([...apiRoutes, ...appPages].map((file) => [folderOf(file)]))("assigns %s to a gate", (folder) => {
    expect(gateForRoute(folder), `${folder} has no entry in ROUTE_GATES`).not.toBeNull();
  });

  it("has no catch-all or stale keys", () => {
    const folders = [...apiRoutes, ...appPages].map(folderOf);
    for (const key of Object.keys(ROUTE_GATES)) {
      expect(["api", "(app)"]).not.toContain(key);
      expect(existsSync(join(APP_DIR, key)), `${key} does not exist`).toBe(true);
      expect(folders.some((folder) => folder === key || folder.startsWith(`${key}/`)), `${key} covers no route`).toBe(true);
    }
  });

  it("finds an exported handler in every API route", () => {
    for (const file of apiRoutes) expect(apiHandlers(file).handlers.length, folderOf(file)).toBeGreaterThan(0);
  });

  // A gate in the map does nothing unless every handler asks for that gate first.
  it.each(gatedApiHandlers.map((handler) => [handler.name, handler]))("%s checks its mapped gate first", (name, { gate, calls, text }) => {
    expect(calls.length, `${name} never checks a gate`).toBeGreaterThan(0);
    expect(calls[0].gates, `${name} checks ${calls[0].gates.join("/")} before ${gate}`).toEqual([gate]);
    if (gate === "chat") {
      // Each thread kind follows its own flag: persona threads need
      // persona_chat and human DM threads need social_feed.
      const perKindGate = calls.slice(1).some((call) => call.gates.includes("persona_chat") && call.gates.includes("social_feed"));
      const perKindFilter = text.includes("flags.personaChat") && text.includes("flags.socialFeed");
      expect(perKindGate || perKindFilter, `${name} has no per-kind check`).toBe(true);
    }
  });

  // A layout does not stop a page from running, so each page checks itself.
  it.each(appPages.map((file) => [folderOf(file), file]))("%s/page.tsx checks its mapped gate itself", (folder, file) => {
    const gate = gateForRoute(folder);
    if (gate === "always") return;
    const page = defaultExportBody(file);
    expect(page, `${folder}/page.tsx has no default export function`).not.toBeNull();
    const calls = gateCalls(page!.body, page!.functions).filter((call) => call.callee === "requirePageGate");
    expect(calls.length, `${folder}/page.tsx never calls requirePageGate`).toBeGreaterThan(0);
    expect(calls[0].gates).toEqual([gate]);
  });
});

describe("gateForRoute", () => {
  it.each([
    ["api/feed", "wins"],
    ["api/chat", "chat"],
    ["api/chat/[id]/messages", "chat"],
    ["api/chat/[id]/messages/retry", "persona_chat"],
    ["api/chat/contacts", "chat"],
    ["api/companions/[id]/relationship", "persona_chat"],
    ["api/companion-mutes/[companionId]", "always"],
    ["api/cron/companions", "persona_autopost"],
    ["api/cron/rollover", "always"],
    ["api/workers/ai", "persona_engagement"],
    ["api/posts", "social_feed"],
    ["api/posts/[id]", "wins"],
    ["api/posts/[id]/replies", "social_feed"],
    ["api/tasks", "always"],
    ["api/tasks/[id]", "always"],
    ["api/tasks/[id]/publish", "share_win"],
    ["api/uploads/completion-images", "share_win"],
    ["api/blocks/[userId]", "always"],
    ["api/reports", "always"],
    ["api/notification-preferences", "always"],
    ["api/notifications/unread-count", "social_feed"],
    ["(app)/feed", "wins"],
    ["(app)/tasks", "always"],
    ["(app)/tasks/[taskId]/share", "share_win"],
    ["(app)/ai-personas/[companionId]", "persona_chat"],
    ["(app)/u/[username]/edit", "social_feed"],
    ["(app)/settings", "always"],
    ["api/characters", "pivot_a"],
    ["api/coach/profile", "pivot_a"],
    ["api/tasks/[id]/start", "pivot_a"],
    ["api/tasks/[id]/finish", "pivot_a"],
    ["api/tasks/[id]/split", "pivot_a"],
    ["(app)/characters/[slug]", "pivot_a"],
  ] satisfies Array<[string, RouteGate]>)("maps %s to %s", (folder, gate) => {
    expect(gateForRoute(folder)).toBe(gate);
  });

  it("matches whole segments only", () => {
    expect(gateForRoute("api/feedback")).toBe("always");
    expect(gateForRoute("api/feeds")).toBeNull();
    expect(gateForRoute("api/tasks-archive")).toBeNull();
  });
});

describe("isGateOpen", () => {
  const flags = (overrides: Partial<PivotFlags>): PivotFlags => ({ ...resolveFlags({}), ...overrides });

  it.each([
    // [socialFeed, shareWin, wins]
    [true, true, true],
    [true, false, true],
    [false, true, true],
    [false, false, false],
  ])("wins: social_feed %s, share_win %s -> %s", (socialFeed, shareWin, open) => {
    expect(isGateOpen(flags({ socialFeed, shareWin }), "wins")).toBe(open);
  });

  it.each([
    // [socialFeed, personaChat, chat]
    [true, true, true],
    [true, false, true],
    [false, true, true],
    [false, false, false],
  ])("chat: social_feed %s, persona_chat %s -> %s", (socialFeed, personaChat, open) => {
    expect(isGateOpen(flags({ socialFeed, personaChat }), "chat")).toBe(open);
  });

  it("closes persona engagement only under Pivot A", () => {
    expect(isGateOpen(flags({ pivotA: false, personaChat: false, personaAutopost: false }), "persona_engagement")).toBe(true);
    expect(isGateOpen(flags({ pivotA: true }), "persona_engagement")).toBe(false);
  });

  it("follows the single flag behind each simple gate", () => {
    const closed = flags({ socialFeed: false, personaChat: false, personaAutopost: false, shareWin: false });
    for (const gate of ["social_feed", "persona_chat", "persona_autopost", "share_win"] as const) {
      expect(isGateOpen(closed, gate)).toBe(false);
      expect(isGateOpen(resolveFlags({}), gate)).toBe(true);
    }
    expect(isGateOpen(closed, "always")).toBe(true);
  });

  it("opens every gate but pivot_a with today's flags, and pivot_a, share_win and wins under a default Pivot A", () => {
    const gates: RouteGate[] = ["pivot_a", "social_feed", "persona_chat", "persona_autopost", "persona_engagement", "share_win", "wins", "chat", "always"];
    expect(gates.filter((gate) => isGateOpen(resolveFlags({}), gate))).toEqual(gates.filter((gate) => gate !== "pivot_a"));
    expect(gates.filter((gate) => isGateOpen(resolveFlags({ "pivot_a.enabled": true }), gate))).toEqual(["pivot_a", "share_win", "wins", "always"]);
  });

  it("opens pivot_a only while Pivot A is on, whatever the other flags say", () => {
    expect(isGateOpen(flags({ pivotA: false, socialFeed: false, shareWin: false }), "pivot_a")).toBe(false);
    expect(isGateOpen(flags({ pivotA: true, socialFeed: true, shareWin: false }), "pivot_a")).toBe(true);
  });
});

describe("requireApiGate and requirePageGate", () => {
  beforeEach(() => {
    getFlags.mockReset();
    notFound.mockClear();
  });

  it("returns the flags when the gate is open", async () => {
    const pivot = resolveFlags({ "pivot_a.enabled": true });
    getFlags.mockResolvedValue(pivot);
    await expect(requireApiGate("wins")).resolves.toBe(pivot);
    await expect(requirePageGate("share_win")).resolves.toBe(pivot);
    expect(notFound).not.toHaveBeenCalled();
  });

  it("throws the API's standard not-found error when the gate is closed", async () => {
    getFlags.mockResolvedValue(resolveFlags({ "pivot_a.enabled": true }));
    const error = await requireApiGate("persona_chat").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, code: "not_found", message: "Resource not found." });
  });

  it("renders the not-found page when a page gate is closed", async () => {
    getFlags.mockResolvedValue(resolveFlags({ "pivot_a.enabled": true }));
    await expect(requirePageGate("social_feed")).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(notFound).toHaveBeenCalledTimes(1);
  });
});
