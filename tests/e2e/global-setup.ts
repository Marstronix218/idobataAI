// Global setup for `npm run test:e2e` (PLAN D8). Runs once, in the main
// process, before the flow test:
// 1. finds the LOCAL Supabase stack (env vars, else `supabase status`) and
//    refuses anything that is not localhost or 127.0.0.1;
// 2. checks that the API gateway, auth and rest answer;
// 3. seeds the sample character with the real content seeder;
// 4. turns pivot_a.enabled on and beta_full_access.enabled off.
// Any failure throws, so the suite fails (never skips) without a local stack.
// The teardown puts the two flags back as they were.

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TestProject } from "vitest/node";
import { E2E_FLAG_KEYS, assertLocalSupabaseUrl, createServiceClient, setFlags, type E2eFlagKey, type LocalSupabase } from "./local-stack";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
// The CLI version CI installs (.github/workflows/ci.yml).
const SUPABASE_CLI = ["--yes", "supabase@2.115.0"];
const SEED_CHARACTER = "sample-coach";
const PROBE_WINDOW_MS = 30_000;
const NOT_RUNNING = "The end-to-end tests need the local Supabase stack. Start it with `npx --yes supabase@2.115.0 start` (Docker must be running), then run `npm run test:e2e` again.";

function fail(message: string, detail?: string): never {
  // Without the CLI's ANSI colours.
  const plain = detail?.replace(/\x1b\[[0-9;]*m/g, "").trim();
  throw new Error(`test:e2e: ${message}${plain ? `\n${plain}` : ""}`);
}

/** KEY="value" lines from `supabase status -o env`. */
function parseEnvLines(output: string) {
  const values = new Map<string, string>();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)="?(.*?)"?$/);
    if (match) values.set(match[1], match[2]);
  }
  return values;
}

function readLocalStack(): LocalSupabase {
  const { NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey, SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey } = process.env;
  if (url && anonKey && serviceRoleKey) return { url, anonKey, serviceRoleKey };

  // The CLI on PATH (CI installs 2.115.0 with supabase/setup-cli), else the same version through npx.
  const run = (command: string, args: string[]) => spawnSync(command, [...args, "status", "-o", "env"], { cwd: projectRoot, encoding: "utf8", timeout: 120_000 });
  let status = run("supabase", []);
  if ((status.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") status = run("npx", SUPABASE_CLI);
  if (status.error) fail(`could not run the Supabase CLI (${status.error.message}). ${NOT_RUNNING}`);
  if (status.status !== 0) fail(`the local Supabase stack is not running. ${NOT_RUNNING}`, `supabase status said:\n${status.stderr || status.stdout}`);
  const values = parseEnvLines(`${status.stdout}\n${status.stderr}`);
  const stack = { url: values.get("API_URL"), anonKey: values.get("ANON_KEY"), serviceRoleKey: values.get("SERVICE_ROLE_KEY") };
  if (!stack.url || !stack.anonKey || !stack.serviceRoleKey) {
    fail(`\`supabase status -o env\` did not report API_URL, ANON_KEY and SERVICE_ROLE_KEY. ${NOT_RUNNING}`);
  }
  return { url: stack.url, anonKey: stack.anonKey, serviceRoleKey: stack.serviceRoleKey };
}

/**
 * Waits up to PROBE_WINDOW_MS, backing off, for a service to answer 2xx: auth
 * and rest can still be coming up right after `supabase start` or a reset.
 */
async function probe(service: string, url: string, headers: Record<string, string>) {
  const deadline = Date.now() + PROBE_WINDOW_MS;
  for (let delay = 1_000; ; delay = Math.min(delay * 2, 8_000)) {
    let problem: string;
    let detail = "";
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(5_000) });
      if (response.ok) return;
      problem = `answered ${response.status}`;
      detail = await response.text().catch(() => "");
    } catch (error) {
      problem = `did not answer (${error instanceof Error ? error.message : String(error)})`;
    }
    const left = deadline - Date.now();
    if (left <= 0) {
      fail(`${service} on the local stack ${problem} for ${PROBE_WINDOW_MS / 1000} s. Auth, rest and the API gateway must be running. ${NOT_RUNNING}`, detail);
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(delay, left)));
  }
}

/** `npm run content:seed -- --only sample-coach` against the local stack: lints, then upserts the character, lines and chapters. */
function seedSampleCharacter(stack: LocalSupabase) {
  const seed = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/seed-characters.mjs", "--only", SEED_CHARACTER], {
    cwd: projectRoot,
    encoding: "utf8",
    timeout: 120_000,
    // Explicit values win over .env.local, which may point at a hosted project.
    env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: stack.url, SUPABASE_SERVICE_ROLE_KEY: stack.serviceRoleKey },
  });
  if (seed.error || seed.status !== 0) {
    fail(`seeding ${SEED_CHARACTER} failed.`, `${seed.error?.message ?? ""}\n${seed.stdout}\n${seed.stderr}`);
  }
}

export default async function setup(project: TestProject) {
  const stack = readLocalStack();
  assertLocalSupabaseUrl(stack.url);

  await probe("Auth", `${stack.url}/auth/v1/health`, { apikey: stack.anonKey });
  await probe("Rest", `${stack.url}/rest/v1/app_feature_flags?select=key&limit=1`, {
    apikey: stack.serviceRoleKey,
    authorization: `Bearer ${stack.serviceRoleKey}`,
  });

  seedSampleCharacter(stack);

  const admin = createServiceClient(stack);
  const { data, error } = await admin.from("app_feature_flags").select("key, enabled").in("key", [...E2E_FLAG_KEYS]);
  if (error) fail(`could not read feature flags: ${error.message}`);
  const previous = new Map((data ?? []).map((row) => [row.key as E2eFlagKey, row.enabled as boolean]));
  await setFlags(admin, { "pivot_a.enabled": true, "beta_full_access.enabled": false });

  project.provide("localSupabase", stack);

  return async () => {
    // Back to how the developer had them; a missing row means "off" again.
    const restore: Partial<Record<E2eFlagKey, boolean>> = {};
    for (const [key, enabled] of previous) restore[key] = enabled;
    await setFlags(admin, restore);
    const unset = E2E_FLAG_KEYS.filter((key) => !previous.has(key));
    if (unset.length) {
      const { error: deleteError } = await admin.from("app_feature_flags").delete().in("key", unset);
      if (deleteError) console.warn(`test:e2e: could not unset ${unset.join(", ")}: ${deleteError.message}`);
    }
  };
}
