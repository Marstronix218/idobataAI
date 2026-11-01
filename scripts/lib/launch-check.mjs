// `npm run launch-check` (scripts/launch-check.mjs): everything that still has
// to change before Pivot A can launch publicly (SPEC Phase 8). It only reads
// files under the root it is given, plus the environment passed in. No
// network calls and no database access.
// tests/integration/launch-check.test.ts runs it against the fixture trees in
// tests/fixtures/launch-check/{failing,passing}.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { isProductionEnvironment, isSelfAttestedAgeAllowed } from "./age-environment.mjs";

/**
 * @typedef {{ location: string | null, message: string }} LaunchCheckItem
 * @typedef {{ id: string, title: string, items: LaunchCheckItem[] }} LaunchCheckGroup
 * @typedef {{ ok: boolean, total: number, groups: LaunchCheckGroup[] }} LaunchCheckResult
 * @typedef {Record<string, string | undefined>} Environment
 */

export const LAUNCH_CONFIRMATIONS_FILE = "docs/pivot-a/LAUNCH_CONFIRMATIONS.md";

/**
 * The manual confirmations the launch needs. LAUNCH_CONFIRMATIONS.md lists
 * each one as `- [ ] \`id\` ...`; every id here must be present and ticked.
 */
export const REQUIRED_CONFIRMATIONS = [
  { id: "before-user-created-hook", title: "the Before User Created hook is enabled in every hosted Supabase project" },
  { id: "app-env", title: "APP_ENV is set correctly on every deployment, and ALLOW_SELF_ATTESTED_AGE is unset in production" },
  { id: "age-verification-provider", title: "a real age-verification provider is configured (AGE_VERIFIER)" },
  { id: "daily-spend-limit", title: "AI_DAILY_SPEND_LIMIT_USD is set before beta_full_access is turned on" },
  { id: "anthropic-spend-limit", title: "the Anthropic workspace spend limit is set" },
  { id: "legacy-chat-transcripts", title: "the decision on legacy persona chat transcripts is made (D14)" },
  { id: "safety-copy-review", title: "the crisis card and /safety copy are reviewed (clinical and counsel)" },
  { id: "billing-disabled", title: "billing stays disabled (no STRIPE_* or BILLING_PROVIDER) until a cancellation-aware integration exists" },
];

// (a) Starter wording in the legal pages and in the settings About copy.
const LEGAL_DIRS = ["src/app/privacy", "src/app/terms", "src/components/settings"];
const TEMPLATE_PATTERNS = [
  /before (?:a )?public launch/i,
  /replace (?:this|these) starter/i,
  /starter (?:policy|terms)/i,
  /pre-deployment mvp/i,
  /still being reviewed/i,
];

// (b) The age verifier factory.
const VERIFIER_FILE = "src/lib/age/verifier.ts";
const SELF_ATTESTED = "self_attested";

// (c) The /safety placeholder marker.
const SAFETY_DIR = "src/app/safety";
const SAFETY_PLACEHOLDER_FILE = "src/app/safety/placeholder.ts";

// (d) Every TODO(founder) in the app, the mobile app, character content and
// the Pivot A migrations (docs/pivot-a/HANDOFF.md §8 lists them), so a passing
// check means all of them are resolved. Tests and fixtures are skipped.
const TODO_MARKER = "TODO(founder)";
const TODO_DIRS = ["src", "apps/mobile/src", "content/characters"];
const TEST_DIRS = new Set(["__tests__", "__mocks__", "__fixtures__", "fixtures", "tests", "test"]);
const isTestFile = (path) => path.split("/").some((part) => TEST_DIRS.has(part)) || /\.(?:test|spec)\.[^/]+$/.test(path);
const MIGRATIONS_DIR = "supabase/migrations";

// (e) Character content.
const CHARACTERS_DIR = "content/characters";

// Billing: the account route's guard and the variables it reads.
const ACCOUNT_ROUTE_FILE = "src/app/api/account/route.ts";

// The committed env templates. .gitignore ignores every other `.env*` file,
// so a developer's `.env` or `.env.local` is never read and the output is the
// same on every machine.
const ENV_TEMPLATE_NAME = ".env.example";

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

function readText(root, path) {
  const absolute = join(root, path);
  return existsSync(absolute) ? readFileSync(absolute, "utf8") : null;
}

function isDirectory(root, path) {
  try {
    return statSync(join(root, path)).isDirectory();
  } catch {
    return false;
  }
}

/** Every file under `dir` (relative to root, `/`-separated), sorted. Skips node_modules and dot folders. */
function listFiles(root, dir) {
  if (!isDirectory(root, dir)) return [];
  const files = [];
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && !entry.name.startsWith(".")) files.push(...listFiles(root, path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

const lineNumberAt = (text, index) => text.slice(0, index).split("\n").length;
const location = (path, line) => (line ? `${path}:${line}` : path);
const truncate = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** `.env.example` at the root, in apps/* and packages/*, and in supabase/. */
function envFiles(root) {
  const dirs = ["."];
  for (const parent of ["apps", "packages"]) {
    if (!isDirectory(root, parent)) continue;
    for (const entry of readdirSync(join(root, parent), { withFileTypes: true })) {
      if (entry.isDirectory()) dirs.push(`${parent}/${entry.name}`);
    }
  }
  dirs.push("supabase");
  const files = [];
  for (const dir of dirs.sort()) {
    if (!isDirectory(root, dir)) continue;
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      if (entry.isFile() && entry.name === ENV_TEMPLATE_NAME) {
        files.push(dir === "." ? entry.name : `${dir}/${entry.name}`);
      }
    }
  }
  return files.sort();
}

/** `KEY=value` lines with their line numbers; quotes and unquoted trailing comments removed. */
function parseEnvFile(text) {
  const entries = new Map();
  text.split(/\r?\n/).forEach((line, index) => {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) return;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "");
    }
    entries.set(match[1], { value, line: index + 1 });
  });
  return entries;
}

/** Plain values of a parsed env file, for the production rule. */
const envValues = (entries) => Object.fromEntries([...entries].map(([key, entry]) => [key, entry.value]));

// The same opt-in test as isSelfAttestedAgeAllowed (src/lib/age/environment.ts).
const optsIntoSelfAttestation = (value) => value?.trim() === "true";

// ---------------------------------------------------------------------------
// (a) Template text in privacy, terms and the settings About copy
// ---------------------------------------------------------------------------

/** Text segments of a line of markup: tags split it, then sentences. */
function sentencesOf(line) {
  return line
    .split(/<[^>]*>/)
    .flatMap((segment) => segment.split(/(?<=[.!?])\s+/))
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/** The whole words around the first match, so a long sentence still shows its template wording. */
function excerpt(sentence, match) {
  if (sentence.length <= 140) return sentence;
  let start = Math.max(0, match.index - 60);
  let end = Math.min(sentence.length, match.index + match[0].length + 60);
  if (start > 0) start = sentence.indexOf(" ", start) + 1 || start;
  if (end < sentence.length) end = sentence.lastIndexOf(" ", end) > match.index ? sentence.lastIndexOf(" ", end) : end;
  return `${start > 0 ? "…" : ""}${sentence.slice(start, end).trim()}${end < sentence.length ? "…" : ""}`;
}

function checkLegal(root) {
  const items = [];
  for (const path of LEGAL_DIRS.flatMap((dir) => listFiles(root, dir))) {
    readText(root, path).split(/\r?\n/).forEach((line, index) => {
      for (const sentence of sentencesOf(line)) {
        const matches = TEMPLATE_PATTERNS.map((pattern) => sentence.match(pattern)).filter(Boolean);
        if (matches.length === 0) continue;
        const phrases = [...new Set(matches.map((match) => `"${match[0]}"`))].join(", ");
        items.push({
          location: location(path, index + 1),
          message: `Template text ${phrases}: "${excerpt(sentence, matches[0])}"`,
        });
      }
    });
  }
  return items;
}

// ---------------------------------------------------------------------------
// (b) Age verification
// ---------------------------------------------------------------------------

function checkAge(root, env, files) {
  const items = [];
  const verifier = readText(root, VERIFIER_FILE);
  if (verifier === null) {
    items.push({ location: VERIFIER_FILE, message: "is missing, so the launch check cannot confirm a real age-verification provider exists." });
  } else {
    const registry = verifier.match(/AGE_VERIFIERS\s*=\s*\[([^\]]*)\]/);
    if (!registry) {
      items.push({ location: VERIFIER_FILE, message: "has no AGE_VERIFIERS list, so the launch check cannot confirm a real age-verification provider is registered." });
    } else {
      const names = [...registry[1].matchAll(/["'`]([^"'`]+)["'`]/g)].map((match) => match[1]);
      if (!names.some((name) => name !== SELF_ATTESTED)) {
        items.push({
          location: location(VERIFIER_FILE, lineNumberAt(verifier, registry.index)),
          message: `Only the self_attested verifier is implemented (AGE_VERIFIERS = [${names.map((name) => `"${name}"`).join(", ")}]). Implement a real age-verification provider and register it here; production refuses self-attestation, so Pivot A sign-up stays closed there until one exists.`,
        });
      }
      if (names.includes(SELF_ATTESTED) && !/isSelfAttestedAgeAllowed\s*\(/.test(verifier)) {
        items.push({
          location: VERIFIER_FILE,
          message: "getAgeVerifier() no longer checks isSelfAttestedAgeAllowed() before returning SelfAttestedVerifier, so production could trust typed dates of birth.",
        });
      }
    }
    const fallback = verifier.match(/AGE_VERIFIER\??\.trim\(\)\s*\|\|\s*["'`]([^"'`]+)["'`]/);
    if (fallback?.[1] === SELF_ATTESTED) {
      items.push({
        location: location(VERIFIER_FILE, lineNumberAt(verifier, fallback.index)),
        message: "getAgeVerifier() falls back to self_attested when AGE_VERIFIER is unset. Make the real provider the default.",
      });
    }
  }

  for (const { path, entries } of files) {
    const fileItems = [];
    const allow = entries.get("ALLOW_SELF_ATTESTED_AGE");
    if (allow && optsIntoSelfAttestation(allow.value)) {
      const values = envValues(entries);
      fileItems.push({
        line: allow.line,
        location: location(path, allow.line),
        message: isSelfAttestedAgeAllowed(values)
          ? `enables ALLOW_SELF_ATTESTED_AGE, and its APP_ENV (${values.APP_ENV?.trim() || "unset"}) counts as non-production: a deployment set up from it trusts typed dates of birth. Leave it empty in .env.example.`
          : "enables ALLOW_SELF_ATTESTED_AGE. Production ignores it, but any deployment copied from this file with a non-production APP_ENV would trust typed dates of birth. Leave it empty in .env.example.",
      });
    }
    const name = entries.get("AGE_VERIFIER");
    if (name?.value.trim() === SELF_ATTESTED) {
      fileItems.push({
        line: name.line,
        location: location(path, name.line),
        message: "sets AGE_VERIFIER=self_attested, so deployments set up from it default to self-attestation. Set it to the real provider.",
      });
    }
    items.push(...fileItems.sort((a, b) => a.line - b.line).map(({ location: where, message }) => ({ location: where, message })));
  }

  // The environment the check runs in (the CLI passes process.env, e.g. after
  // `vercel env pull`): judged by the app's own production rule.
  if (isProductionEnvironment(env)) {
    const where = `APP_ENV=${env.APP_ENV?.trim() || "unset"}, VERCEL_ENV=${env.VERCEL_ENV?.trim() || "unset"}`;
    if (optsIntoSelfAttestation(env.ALLOW_SELF_ATTESTED_AGE)) {
      items.push({ location: null, message: `This environment counts as production (${where}) and sets ALLOW_SELF_ATTESTED_AGE=true. The app ignores it there; unset it.` });
    }
    if (env.AGE_VERIFIER?.trim() === SELF_ATTESTED) {
      items.push({ location: null, message: `This environment counts as production (${where}) and sets AGE_VERIFIER=self_attested: every age check would answer 503 and Pivot A sign-up would be closed.` });
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// (c) /safety placeholder
// ---------------------------------------------------------------------------

function checkSafety(root) {
  const items = [];
  let marker = "counsel-review";
  const placeholderSource = readText(root, SAFETY_PLACEHOLDER_FILE);
  if (placeholderSource !== null) {
    const declaration = placeholderSource.match(/SAFETY_PLACEHOLDER_MARKER\s*=\s*["'`]([^"'`]+)["'`]/);
    if (declaration) marker = declaration[1];
    items.push({
      location: location(SAFETY_PLACEHOLDER_FILE, declaration ? lineNumberAt(placeholderSource, declaration.index) : null),
      message: `The placeholder module still exists (SAFETY_PLACEHOLDER_MARKER = "${marker}"). Delete it, with the page's marker and banner, once counsel approves the /safety copy.`,
    });
  }
  const literal = new RegExp(`data-placeholder=["']${marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`);
  for (const path of listFiles(root, SAFETY_DIR)) {
    if (path === SAFETY_PLACEHOLDER_FILE) continue;
    readText(root, path).split(/\r?\n/).forEach((line, index) => {
      if (/^\s*import\b/.test(line)) return;
      if (line.includes("SAFETY_PLACEHOLDER_MARKER") || literal.test(line)) {
        items.push({ location: location(path, index + 1), message: `The page still carries the placeholder marker (data-placeholder="${marker}").` });
      } else if (line.includes("SAFETY_PLACEHOLDER_BANNER")) {
        items.push({ location: location(path, index + 1), message: "The page still shows the placeholder banner (SAFETY_PLACEHOLDER_BANNER)." });
      }
    });
  }
  return items;
}

// ---------------------------------------------------------------------------
// (d) TODO(founder)
// ---------------------------------------------------------------------------

const stripMarkup = (text) => text.replace(/<\/?[a-zA-Z][^>]*>/g, " ").replace(/\{\/\*|\*\/\}/g, " ").replace(/\s+/g, " ").trim();

/** The marker and what follows it on the line, without comment syntax; the whole line when the marker stands alone. */
function todoText(line) {
  let text = stripMarkup(line.slice(line.indexOf(TODO_MARKER)).replace(/\s*(?:\*\/\s*\}?|-->)\s*$/, ""));
  if (/^TODO\(founder\):?$/.test(text)) text = stripMarkup(line.replace(/^\s*(?:\/\/|--|#|\*)\s*/, ""));
  return truncate(text, 180);
}

function checkTodos(root) {
  const migrations = listFiles(root, MIGRATIONS_DIR).filter((path) => path.split("/").pop().includes("pivot_a"));
  const items = [];
  for (const path of [...TODO_DIRS.flatMap((dir) => listFiles(root, dir)).filter((path) => !isTestFile(path)), ...migrations]) {
    readText(root, path).split(/\r?\n/).forEach((line, index) => {
      if (line.includes(TODO_MARKER)) items.push({ location: location(path, index + 1), message: todoText(line) });
    });
  }
  return items;
}

// ---------------------------------------------------------------------------
// (e) Placeholder characters
// ---------------------------------------------------------------------------

function checkCharacters(root) {
  if (!isDirectory(root, CHARACTERS_DIR)) return [];
  const items = [];
  const folders = readdirSync(join(root, CHARACTERS_DIR), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "schema" && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
  for (const folder of folders) {
    const path = `${CHARACTERS_DIR}/${folder}/sheet.json`;
    const text = readText(root, path);
    if (text === null) continue;
    let sheet;
    try {
      sheet = JSON.parse(text);
    } catch (error) {
      items.push({ location: path, message: `is not valid JSON (${error.message}), so the launch check cannot tell whether it is placeholder copy.` });
      continue;
    }
    if (sheet?.placeholder === true && sheet.active !== false) {
      const flag = text.search(/"placeholder"\s*:\s*true/);
      items.push({
        location: location(path, flag >= 0 ? lineNumberAt(text, flag) : null),
        message: `${sheet.name ?? folder} is placeholder copy and active. Replace it with final copy ("placeholder": false in all three files) or retire it with "active": false.`,
      });
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// (f) Manual confirmations
// ---------------------------------------------------------------------------

function checkConfirmations(root) {
  const text = readText(root, LAUNCH_CONFIRMATIONS_FILE);
  if (text === null) {
    return [{
      location: LAUNCH_CONFIRMATIONS_FILE,
      message: `is missing. It lists the ${REQUIRED_CONFIRMATIONS.length} manual confirmations the launch needs: ${REQUIRED_CONFIRMATIONS.map((item) => item.id).join(", ")}.`,
    }];
  }
  const found = new Map();
  text.split(/\r?\n/).forEach((line, index) => {
    const match = line.match(/^\s*[-*]\s+\[([ xX])\]\s+`([a-z0-9-]+)`/);
    if (match && !found.has(match[2])) found.set(match[2], { ticked: match[1] !== " ", line: index + 1 });
  });
  const items = [];
  for (const { id, title } of REQUIRED_CONFIRMATIONS) {
    const entry = found.get(id);
    if (!entry) {
      items.push({ location: LAUNCH_CONFIRMATIONS_FILE, message: `\`${id}\` is missing: confirm that ${title}, then add it back ticked.` });
    } else if (!entry.ticked) {
      items.push({ location: location(LAUNCH_CONFIRMATIONS_FILE, entry.line), message: `Not ticked: confirm that ${title}.` });
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// Billing variables (billing is skipped for the free beta)
// ---------------------------------------------------------------------------

/** Set billing variables: those the account route's guard reads, then any other STRIPE_*. */
function billingVariables(values) {
  const set = [];
  // The route's guard: BILLING_PROVIDER other than "none", or either Stripe key.
  if (values.BILLING_PROVIDER && values.BILLING_PROVIDER !== "none") set.push({ name: "BILLING_PROVIDER", guarded: true });
  for (const name of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]) {
    if (values[name]) set.push({ name, guarded: true });
  }
  for (const name of Object.keys(values).filter((key) => key.startsWith("STRIPE_")).sort()) {
    if (values[name]?.trim() && !set.some((variable) => variable.name === name)) set.push({ name, guarded: false });
  }
  return set;
}

function checkBilling(root, env, files) {
  const route = readText(root, ACCOUNT_ROUTE_FILE);
  const guardAt = route?.indexOf("billingConfigured") ?? -1;
  const guard = guardAt >= 0 ? ` (${location(ACCOUNT_ROUTE_FILE, lineNumberAt(route, guardAt))})` : "";
  const explain = ({ name, guarded }) => guarded
    ? `${name} is set. Billing is disabled for the free beta, and DELETE /api/account refuses with 409 billing_cancellation_required while it is set${guard}. Unset it until a cancellation-aware integration exists.`
    : `${name} is set. Billing is disabled for the free beta and no Stripe integration exists; unset it until a cancellation-aware integration exists.`;

  const items = [];
  for (const { path, entries } of files) {
    for (const variable of billingVariables(envValues(entries))) {
      items.push({ location: location(path, entries.get(variable.name).line), message: explain(variable) });
    }
  }
  for (const variable of billingVariables(env)) {
    items.push({ location: null, message: `In this environment: ${explain(variable)}` });
  }
  return items;
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

const GROUPS = [
  { id: "legal", title: "Privacy and terms still contain template text", summary: "legal template text", run: checkLegal },
  { id: "age", title: "Age verification still relies on self-attestation", summary: "age verification", run: checkAge },
  { id: "safety", title: "/safety is still placeholder copy", summary: "/safety placeholder", run: checkSafety },
  { id: "todo", title: "TODO(founder) left in the app, mobile app, character content and Pivot A migrations", summary: "TODO(founder)", run: checkTodos },
  { id: "characters", title: "Placeholder characters are still active", summary: "placeholder characters", run: checkCharacters },
  { id: "confirmations", title: `Manual confirmations not ticked in ${LAUNCH_CONFIRMATIONS_FILE}`, summary: "manual confirmations", run: checkConfirmations },
  { id: "billing", title: "Billing variables are set while billing is disabled", summary: "billing variables", run: checkBilling },
];

/**
 * Runs every check against the tree at `rootDir`.
 * @param {string} rootDir
 * @param {{ env?: Environment }} [options] env: the deployment environment to
 *   judge as well (the CLI passes process.env). Defaults to none.
 * @returns {LaunchCheckResult}
 */
export function runLaunchCheck(rootDir, options = {}) {
  const env = options.env ?? {};
  const files = envFiles(rootDir).map((path) => ({ path, entries: parseEnvFile(readText(rootDir, path)) }));
  const groups = GROUPS.map(({ id, title, run }) => ({ id, title, items: run(rootDir, env, files) }));
  const total = groups.reduce((sum, group) => sum + group.items.length, 0);
  return { ok: total === 0, total, groups };
}

/**
 * The report: the groups with their items numbered 1..n, then a summary.
 * @param {LaunchCheckResult} result
 */
export function formatLaunchCheck(result) {
  if (result.ok) return "Launch check passed: nothing left to fix.";
  const lines = [`Launch check: ${result.total} ${result.total === 1 ? "item" : "items"} to fix before launch.`];
  let number = 0;
  for (const group of result.groups) {
    if (group.items.length === 0) continue;
    lines.push("", `${group.title} (${group.items.length})`);
    for (const item of group.items) {
      number += 1;
      lines.push(`  ${number}. ${item.location ? `${item.location} — ` : ""}${item.message}`);
    }
  }
  const counts = result.groups
    .filter((group) => group.items.length > 0)
    .map((group) => `${GROUPS.find((candidate) => candidate.id === group.id).summary} ${group.items.length}`);
  lines.push("", `Summary: ${result.total} to fix (${counts.join(", ")}).`, "Launch check failed.");
  return lines.join("\n");
}
