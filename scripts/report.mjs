#!/usr/bin/env node

// `npm run report:experiment` prints the ai_arm experiment (report_ai_arm);
// `npm run report:cost [-- --month YYYY-MM]` prints the AI cost report
// (report_ai_cost). Add `-- --json` for machine-readable output. Both use the
// service role, so they are admin-only by construction; the target host is
// printed, keys never are. Credentials come from the environment, then
// .env.local, like `npm run flags`.

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { PIVOT_FLAG_KEYS, resolvePivotFlags } from "./lib/pivot-flags.mjs";
import { betaFullAccessInEffect, costAlertUsd, costReportParams, formatCostReport, formatExperimentReport, parseReportArgs, readEnvFile } from "./lib/report.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fail(message, code = 1) {
  console.error(`report: ${message}`);
  process.exit(code);
}

let command;
try {
  command = parseReportArgs(process.argv.slice(2));
} catch (error) {
  fail(error.message, 2);
}

const fileEnv = readEnvFile(resolve(projectRoot, ".env.local"));
const env = (key) => process.env[key] || fileEnv.get(key);
const url = env("NEXT_PUBLIC_SUPABASE_URL");
const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
if (!url) fail("NEXT_PUBLIC_SUPABASE_URL is missing from the environment and .env.local.");
if (!serviceRoleKey) fail("SUPABASE_SERVICE_ROLE_KEY is missing from the environment and .env.local.");

let host;
try {
  host = new URL(url).host;
} catch {
  fail("NEXT_PUBLIC_SUPABASE_URL is not a valid URL.");
}

const supabase = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

// Whether the free beta's full access is on, so the numbers are read correctly
// (the reports take tiers from entitlements; beta testers show as free).
const { data: flagRows, error: flagError } = await supabase.from("app_feature_flags").select("key, enabled").in("key", PIVOT_FLAG_KEYS);
const betaFullAccess = betaFullAccessInEffect(flagError ? null : resolvePivotFlags(Object.fromEntries((flagRows ?? []).map((row) => [row.key, row.enabled]))));

if (command.report === "experiment") {
  const { data, error } = await supabase.rpc("report_ai_arm");
  if (error) fail(`report_ai_arm failed on ${host}: ${error.message}`);
  const rows = data ?? [];
  console.log(command.json ? JSON.stringify({ host, report: "experiment", betaFullAccess, rows }, null, 2) : formatExperimentReport(rows, { host, betaFullAccess }));
} else {
  const { data, error } = await supabase.rpc("report_ai_cost", costReportParams(command.month, env));
  if (error) fail(`report_ai_cost failed on ${host}: ${error.message}`);
  const row = (data ?? [])[0];
  if (!row) fail(`report_ai_cost returned nothing on ${host}.`);
  const alertUsd = costAlertUsd(env);
  // The report says whether its cap counts used the beta's Plus caps; prefer that to the separate flag read.
  const costBeta = typeof row.beta_full_access === "boolean" ? row.beta_full_access : betaFullAccess;
  console.log(command.json ? JSON.stringify({ host, report: "cost", alertUsd, betaFullAccess: costBeta, row }, null, 2) : formatCostReport(row, { host, alertUsd, betaFullAccess: costBeta }));
}
