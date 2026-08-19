#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(projectRoot, ".env.local");
const linkedProjectPath = resolve(projectRoot, "supabase/.temp/project-ref");
const requestedArgs = process.argv.slice(2);
const checkOnly = requestedArgs.length === 1 && requestedArgs[0] === "--check";

if (requestedArgs.length > 0 && !checkOnly) {
  console.error(`Unknown option: ${requestedArgs.join(" ")}`);
  process.exit(2);
}

function readEnvFile(path) {
  if (!existsSync(path)) return new Map();

  const values = new Map();
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1].startsWith("#")) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values.set(match[1], value);
  }
  return values;
}

function fail(message) {
  console.error(`Remote schema sync refused: ${message}`);
  process.exit(1);
}

function runSupabase(args) {
  const result = spawnSync("supabase", args, {
    cwd: projectRoot,
    encoding: "utf8",
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error?.code === "ENOENT") fail("the Supabase CLI is not installed or not available on PATH.");
  if (result.error) fail(result.error.message);
  return result;
}

const fileEnv = readEnvFile(envPath);
const supabaseUrlValue = process.env.NEXT_PUBLIC_SUPABASE_URL || fileEnv.get("NEXT_PUBLIC_SUPABASE_URL");
if (!supabaseUrlValue) fail("NEXT_PUBLIC_SUPABASE_URL is missing from the environment and .env.local.");

let supabaseUrl;
try {
  supabaseUrl = new URL(supabaseUrlValue);
} catch {
  fail("NEXT_PUBLIC_SUPABASE_URL is not a valid URL.");
}

if (["localhost", "127.0.0.1", "::1"].includes(supabaseUrl.hostname)) {
  fail("local Supabase URLs are disabled; configure the linked remote project instead.");
}

if (!existsSync(linkedProjectPath)) {
  fail("no linked project was found. Run `supabase link --project-ref <remote-project-ref>` first.");
}

const linkedProjectRef = readFileSync(linkedProjectPath, "utf8").trim();
const explicitProjectRef = process.env.SUPABASE_PROJECT_REF || fileEnv.get("SUPABASE_PROJECT_REF");
const standardHostMatch = supabaseUrl.hostname.match(/^([a-z0-9-]+)\.supabase\.co$/i);
const configuredProjectRef = explicitProjectRef || standardHostMatch?.[1];

if (!configuredProjectRef) {
  fail("SUPABASE_PROJECT_REF is required when NEXT_PUBLIC_SUPABASE_URL uses a custom domain.");
}
if (linkedProjectRef !== configuredProjectRef) {
  fail(`the CLI is linked to ${linkedProjectRef}, but the app is configured for ${configuredProjectRef}.`);
}

console.log(`Refreshing the CLI link for remote project ${linkedProjectRef}…`);
const linkResult = runSupabase(["link", "--project-ref", linkedProjectRef, "--yes"]);
if (linkResult.status !== 0) fail("the linked remote project could not be refreshed.");

if (!checkOnly) {
  console.log(`Applying migrations to linked remote project ${linkedProjectRef}…`);
  const pushResult = runSupabase(["db", "push", "--linked", "--yes"]);
  if (pushResult.status !== 0) fail("the remote migration push failed.");
}

console.log(`Checking exact migration parity for remote project ${linkedProjectRef}…`);
const checkResult = runSupabase(["db", "push", "--linked", "--dry-run"]);
const checkOutput = `${checkResult.stdout ?? ""}\n${checkResult.stderr ?? ""}`;

if (checkResult.status !== 0 || !checkOutput.includes("Remote database is up to date.")) {
  fail("local and remote migration histories are not an exact match.");
}

console.log("Remote migration history exactly matches this checkout.");
