#!/usr/bin/env node

// `npm run flags` lists the Pivot A flags for whichever Supabase project the
// credentials point at; `npm run flags -- set <key> <true|false>` and
// `npm run flags -- unset <key>` write the app_feature_flags row.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { PIVOT_FLAG_KEYS, describePivotFlags, parseFlagCommand } from "./lib/pivot-flags.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readEnvFile(path) {
  if (!existsSync(path)) return new Map();

  const values = new Map();
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values.set(match[1], value);
  }
  return values;
}

function fail(message, code = 1) {
  console.error(`flags: ${message}`);
  process.exit(code);
}

let command;
try {
  command = parseFlagCommand(process.argv.slice(2));
} catch (error) {
  fail(error.message, 2);
}

const fileEnv = readEnvFile(resolve(projectRoot, ".env.local"));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || fileEnv.get("NEXT_PUBLIC_SUPABASE_URL");
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || fileEnv.get("SUPABASE_SERVICE_ROLE_KEY");
if (!url) fail("NEXT_PUBLIC_SUPABASE_URL is missing from the environment and .env.local.");
if (!serviceRoleKey) fail("SUPABASE_SERVICE_ROLE_KEY is missing from the environment and .env.local.");

let host;
try {
  host = new URL(url).host;
} catch {
  fail("NEXT_PUBLIC_SUPABASE_URL is not a valid URL.");
}

const supabase = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

if (command.command === "set") {
  const { error } = await supabase.from("app_feature_flags").upsert({ key: command.key, enabled: command.value }, { onConflict: "key" });
  if (error) fail(`could not set ${command.key}: ${error.message}`);
  console.log(`Set ${command.key} = ${command.value}.`);
}

if (command.command === "unset") {
  const { error } = await supabase.from("app_feature_flags").delete().eq("key", command.key);
  if (error) fail(`could not unset ${command.key}: ${error.message}`);
  console.log(`Unset ${command.key}; it now follows its default.`);
}

const { data, error } = await supabase.from("app_feature_flags").select("key, enabled").in("key", PIVOT_FLAG_KEYS);
if (error) fail(`could not read flags: ${error.message}`);

const rows = Object.fromEntries((data ?? []).map((row) => [row.key, row.enabled]));
const width = Math.max(...PIVOT_FLAG_KEYS.map((key) => key.length));
console.log(`Pivot A flags on ${host} (cached for up to 30 s per server instance):`);
for (const { key, value, source } of describePivotFlags(rows)) {
  console.log(`  ${key.padEnd(width)}  ${String(value).padEnd(5)}  ${source}`);
}
