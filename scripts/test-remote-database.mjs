#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const linkedProjectPath = resolve(projectRoot, "supabase/.temp/project-ref");
const expectedTestProjectRef = process.env.SUPABASE_TEST_PROJECT_REF;

function fail(message) {
  console.error(`Remote database tests refused: ${message}`);
  process.exit(1);
}

if (!expectedTestProjectRef) {
  fail("set SUPABASE_TEST_PROJECT_REF to an explicitly designated non-production remote project.");
}

if (!existsSync(linkedProjectPath)) {
  fail("no linked project was found. Link the designated test project first.");
}

const linkedProjectRef = readFileSync(linkedProjectPath, "utf8").trim();
if (linkedProjectRef !== expectedTestProjectRef) {
  fail(`the CLI is linked to ${linkedProjectRef}, not the designated test project ${expectedTestProjectRef}.`);
}

const result = spawnSync("supabase", ["test", "db", "--linked"], {
  cwd: projectRoot,
  stdio: "inherit",
});

if (result.error?.code === "ENOENT") fail("the Supabase CLI is not installed or not available on PATH.");
if (result.error) fail(result.error.message);
process.exit(result.status ?? 1);
