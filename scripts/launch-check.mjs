#!/usr/bin/env node

// `npm run launch-check` lists everything that still has to change before
// Pivot A launches publicly (SPEC Phase 8), as a numbered list grouped by
// check, and exits 1 while anything is left; it prints "Launch check passed"
// and exits 0 once nothing is. The checks are in scripts/lib/launch-check.mjs.
//
// It reads the repository and the current environment only: no network and no
// database. To judge a deployment's variables too, load them first, e.g.
// `vercel env pull .env.production.local` and then
// `node --env-file=.env.production.local scripts/launch-check.mjs`.
// An optional argument checks another tree instead (used by the tests).

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatLaunchCheck, runLaunchCheck } from "./lib/launch-check.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = process.argv[2] ? resolve(process.argv[2]) : projectRoot;

const result = runLaunchCheck(rootDir, { env: process.env });
console.log(formatLaunchCheck(result));
process.exitCode = result.ok ? 0 : 1;
