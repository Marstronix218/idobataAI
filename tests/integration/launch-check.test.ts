import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { REQUIRED_CONFIRMATIONS, formatLaunchCheck, runLaunchCheck } from "../../scripts/lib/launch-check.mjs";

// `npm run launch-check` against two fixture trees. The real repository is
// deliberately not asserted here: it fails today and must start passing once
// the founder's items are done, without a test change.

const FIXTURES = join(process.cwd(), "tests", "fixtures", "launch-check");
const FAILING = join(FIXTURES, "failing");
const PASSING = join(FIXTURES, "passing");
const CLI = join(process.cwd(), "scripts", "launch-check.mjs");

type Result = ReturnType<typeof runLaunchCheck>;
const locations = (result: Result, id: string) => result.groups.find((group) => group.id === id)?.items.map((item) => item.location) ?? [];
const messages = (result: Result, id: string) => result.groups.find((group) => group.id === id)?.items.map((item) => item.message) ?? [];

const temporary: string[] = [];
/** A writable copy of a fixture tree. */
function copyOf(fixture: string) {
  const root = mkdtempSync(join(tmpdir(), "launch-check-"));
  temporary.push(root);
  cpSync(fixture, root, { recursive: true });
  return root;
}

afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("launch check on a tree with everything left to do", () => {
  const result = runLaunchCheck(FAILING);

  it("fails and lists every category", () => {
    expect(result.ok).toBe(false);
    expect(result.groups.map((group) => group.id)).toEqual(["legal", "age", "safety", "todo", "characters", "confirmations", "billing"]);
    for (const group of result.groups) expect(group.items.length, group.id).toBeGreaterThan(0);
    expect(result.total).toBe(result.groups.reduce((sum, group) => sum + group.items.length, 0));
  });

  it("finds template text in privacy, terms and the settings About copy, sentence by sentence", () => {
    expect(locations(result, "legal")).toEqual([
      "src/app/privacy/page.tsx:2",
      "src/app/terms/page.tsx:3",
      "src/components/settings/about.tsx:2",
    ]);
    expect(messages(result, "legal")[0]).toBe('Template text "Before public launch", "replace this starter", "starter policy": "Before public launch, replace this starter policy with the reviewed one."');
    expect(messages(result, "legal")[1]).toContain('"pre-deployment MVP"');
    expect(messages(result, "legal")[2]).toContain('"still being reviewed"');
  });

  it("fails while self_attested is the only verifier and the default, and when an env template opts into it", () => {
    expect(locations(result, "age")).toEqual([
      "src/lib/age/verifier.ts:2",
      "src/lib/age/verifier.ts:9",
      ".env.example:3",
      ".env.example:4",
    ]);
    expect(messages(result, "age")[0]).toContain("Only the self_attested verifier is implemented");
    expect(messages(result, "age")[1]).toContain("falls back to self_attested");
    expect(messages(result, "age")[2]).toContain("AGE_VERIFIER=self_attested");
    // The production rule decides how the template's opt-in reads: APP_ENV=local is non-production.
    expect(messages(result, "age")[3]).toContain("enables ALLOW_SELF_ATTESTED_AGE, and its APP_ENV (local) counts as non-production");
  });

  it("reports the /safety placeholder module, marker and banner, but not their import", () => {
    expect(locations(result, "safety")).toEqual([
      "src/app/safety/placeholder.ts:2",
      "src/app/safety/page.tsx:4",
      "src/app/safety/page.tsx:5",
    ]);
    expect(messages(result, "safety")[1]).toBe('The page still carries the placeholder marker (data-placeholder="counsel-review").');
  });

  it("lists every TODO(founder) in src, the mobile app, content and Pivot A migrations, skipping tests and other migrations", () => {
    expect(result.groups.find((group) => group.id === "todo")?.items).toEqual([
      { location: "src/app/safety/page.tsx:6", message: "Contact: TODO(founder)" },
      { location: "src/components/tasks/board.ts:1", message: "TODO(founder): copy for the board, outside the safety and legal folders." },
      { location: "src/lib/age/verifier.ts:10", message: "TODO(founder): choose provider" },
      { location: "src/lib/safety/keywords.ts:1", message: "TODO(founder): clinical review of the keyword list" },
      { location: "apps/mobile/src/app/(auth)/sign-in.ts:1", message: "TODO(founder): under-18 block message copy (counsel)." },
      { location: "supabase/migrations/20990101000000_pivot_a_fixture.sql:1", message: "TODO(founder): enable the hook in every hosted project." },
    ]);
    // src/lib/age/__tests__/ and *.spec.* files, and the non-Pivot A migration, hold markers that are not listed.
    expect(JSON.stringify(result)).not.toMatch(/__tests__|\.spec\.|legacy_fixture/);
  });

  it("lists active placeholder characters only", () => {
    expect(locations(result, "characters")).toEqual(["content/characters/fixture-coach/sheet.json:4"]);
    expect(messages(result, "characters")[0]).toContain("Fixture Coach is placeholder copy and active");
  });

  it("requires every manual confirmation ticked, and present", () => {
    expect(locations(result, "confirmations")).toEqual([
      "docs/pivot-a/LAUNCH_CONFIRMATIONS.md:6",
      "docs/pivot-a/LAUNCH_CONFIRMATIONS.md:7",
      "docs/pivot-a/LAUNCH_CONFIRMATIONS.md:8",
      "docs/pivot-a/LAUNCH_CONFIRMATIONS.md:9",
      "docs/pivot-a/LAUNCH_CONFIRMATIONS.md:10",
      "docs/pivot-a/LAUNCH_CONFIRMATIONS.md",
    ]);
    expect(messages(result, "confirmations")[0]).toBe("Not ticked: confirm that APP_ENV is set correctly on every deployment, and ALLOW_SELF_ATTESTED_AGE is unset in production.");
    expect(messages(result, "confirmations")[5]).toContain("`billing-disabled` is missing");
  });

  it("reports billing variables in committed env files, pointing at the account route's guard", () => {
    expect(locations(result, "billing")).toEqual([".env.example:5", ".env.example:7"]);
    expect(messages(result, "billing")[0]).toBe(
      "BILLING_PROVIDER is set. Billing is disabled for the free beta, and DELETE /api/account refuses with 409 billing_cancellation_required while it is set (src/app/api/account/route.ts:2). Unset it until a cancellation-aware integration exists.",
    );
    // An empty STRIPE_SECRET_KEY is unset; a trailing comment is not part of the value.
    expect(messages(result, "billing")[1]).toContain("STRIPE_PRICE_PLUS is set");
  });

  it("prints a grouped list numbered 1..n, then a summary", () => {
    const output = formatLaunchCheck(result);
    const numbers = [...output.matchAll(/^ {2}(\d+)\. /gm)].map((match) => Number(match[1]));

    expect(numbers).toEqual(Array.from({ length: result.total }, (_, index) => index + 1));
    expect(output.split("\n")[0]).toBe(`Launch check: ${result.total} items to fix before launch.`);
    for (const group of result.groups) expect(output).toContain(`${group.title} (${group.items.length})`);
    expect(output).toContain("  1. src/app/privacy/page.tsx:2 — Template text");
    expect(output).toMatch(new RegExp(`Summary: ${result.total} to fix \\(legal template text 3, age verification 4, /safety placeholder 3, TODO\\(founder\\) 6, placeholder characters 1, manual confirmations 6, billing variables 2\\)\\.`));
    expect(output.trimEnd().endsWith("Launch check failed.")).toBe(true);
  });
});

describe("launch check on a finished tree", () => {
  it("passes", () => {
    const result = runLaunchCheck(PASSING);

    expect(result).toEqual({ ok: true, total: 0, groups: expect.any(Array) });
    expect(formatLaunchCheck(result)).toBe("Launch check passed: nothing left to fix.");
  });

  it("reads only .env.example, never a developer's ignored env files, so every machine gets the same answer", () => {
    const local = "APP_ENV=local\nALLOW_SELF_ATTESTED_AGE=true\nAGE_VERIFIER=self_attested\nSTRIPE_SECRET_KEY=local-only\nBILLING_PROVIDER=stripe\n";
    const passing = copyOf(PASSING);
    const failing = copyOf(FAILING);
    for (const root of [passing, failing]) {
      for (const name of [".env", ".env.local", ".env.development", ".env.production", ".env.production.local"]) writeFileSync(join(root, name), local);
      mkdirSync(join(root, "apps", "mobile"), { recursive: true });
      writeFileSync(join(root, "apps", "mobile", ".env.local"), local);
    }

    expect(runLaunchCheck(passing).ok).toBe(true);
    expect(runLaunchCheck(failing)).toEqual(runLaunchCheck(FAILING));
  });

  it("checks env files in apps/* too", () => {
    const root = copyOf(PASSING);
    mkdirSync(join(root, "apps", "mobile"), { recursive: true });
    writeFileSync(join(root, "apps", "mobile", ".env.example"), "STRIPE_WEBHOOK_SECRET=whsec_fixture\n");

    const result = runLaunchCheck(root);

    expect(locations(result, "billing")).toEqual(["apps/mobile/.env.example:1"]);
  });

  it("fails when the confirmations file is missing, naming every confirmation", () => {
    const root = copyOf(PASSING);
    rmSync(join(root, "docs", "pivot-a", "LAUNCH_CONFIRMATIONS.md"));

    const result = runLaunchCheck(root);

    expect(result.total).toBe(1);
    expect(locations(result, "confirmations")).toEqual(["docs/pivot-a/LAUNCH_CONFIRMATIONS.md"]);
    for (const { id } of REQUIRED_CONFIRMATIONS) expect(messages(result, "confirmations")[0]).toContain(id);
  });

  it("fails closed when the verifier registry cannot be read", () => {
    const root = copyOf(PASSING);
    writeFileSync(join(root, "src", "lib", "age", "verifier.ts"), "export const verifiers = [];\n");

    expect(messages(runLaunchCheck(root), "age")).toEqual([expect.stringContaining("has no AGE_VERIFIERS list")]);
  });

  it("fails when the factory drops the production guard on self-attestation", () => {
    const root = copyOf(PASSING);
    writeFileSync(join(root, "src", "lib", "age", "verifier.ts"), 'export const AGE_VERIFIERS = ["fixture_provider", "self_attested"] as const;\n');

    expect(messages(runLaunchCheck(root), "age")).toEqual([expect.stringContaining("no longer checks isSelfAttestedAgeAllowed()")]);
  });
});

describe("launch check against a deployment's environment", () => {
  it("applies the app's production rule to ALLOW_SELF_ATTESTED_AGE and AGE_VERIFIER", () => {
    const result = runLaunchCheck(PASSING, { env: { APP_ENV: "production", ALLOW_SELF_ATTESTED_AGE: " true ", AGE_VERIFIER: "self_attested" } });

    expect(result.groups.find((group) => group.id === "age")?.items).toEqual([
      { location: null, message: "This environment counts as production (APP_ENV=production, VERCEL_ENV=unset) and sets ALLOW_SELF_ATTESTED_AGE=true. The app ignores it there; unset it." },
      { location: null, message: "This environment counts as production (APP_ENV=production, VERCEL_ENV=unset) and sets AGE_VERIFIER=self_attested: every age check would answer 503 and Pivot A sign-up would be closed." },
    ]);
  });

  it.each([
    ["a non-production APP_ENV", { APP_ENV: "staging", ALLOW_SELF_ATTESTED_AGE: "true", AGE_VERIFIER: "self_attested" }],
    ["a Vercel preview", { VERCEL_ENV: "preview", ALLOW_SELF_ATTESTED_AGE: "true", AGE_VERIFIER: "self_attested" }],
    ["no environment at all", {}],
  ])("leaves %s alone", (_name, env) => {
    expect(runLaunchCheck(PASSING, { env }).ok).toBe(true);
  });

  it("counts APP_ENV=local on Vercel production as production, like the app", () => {
    const result = runLaunchCheck(PASSING, { env: { APP_ENV: "local", VERCEL_ENV: "production", ALLOW_SELF_ATTESTED_AGE: "true" } });

    expect(messages(result, "age")).toEqual([expect.stringContaining("counts as production (APP_ENV=local, VERCEL_ENV=production)")]);
  });

  it("reports billing variables set in the environment, as the account route's guard reads them", () => {
    const result = runLaunchCheck(PASSING, { env: { BILLING_PROVIDER: "none", STRIPE_SECRET_KEY: "", STRIPE_WEBHOOK_SECRET: "whsec_fixture", STRIPE_PRICE_PLUS: "price_fixture" } });

    expect(result.groups.find((group) => group.id === "billing")?.items).toEqual([
      { location: null, message: expect.stringMatching(/^In this environment: STRIPE_WEBHOOK_SECRET is set\. .*409 billing_cancellation_required .*\(src\/app\/api\/account\/route\.ts:2\)/) },
      { location: null, message: expect.stringMatching(/^In this environment: STRIPE_PRICE_PLUS is set\. Billing is disabled/) },
    ]);
    expect(runLaunchCheck(PASSING, { env: { BILLING_PROVIDER: "none" } }).ok).toBe(true);
  });
});

describe("the npm run launch-check CLI", () => {
  // An empty environment, so no variable on this machine changes the result.
  const cli = (root: string) => spawnSync(process.execPath, [CLI, root], { encoding: "utf8", env: {} as NodeJS.ProcessEnv });

  it("exits 1 and prints the list while anything is left", () => {
    const { status, stdout } = cli(FAILING);

    expect(status).toBe(1);
    expect(stdout).toContain("Launch check: 25 items to fix before launch.");
    expect(stdout).toContain("Launch check failed.");
  });

  it('exits 0 with "Launch check passed" once nothing is', () => {
    const { status, stdout } = cli(PASSING);

    expect(status).toBe(0);
    expect(stdout).toContain("Launch check passed");
  });
});
