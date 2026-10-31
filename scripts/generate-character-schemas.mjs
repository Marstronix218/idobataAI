#!/usr/bin/env node

// `npm run content:schema` writes content/characters/schema/*.schema.json from
// the Zod schemas in src/lib/characters/content-schema.ts.
// tests/domain/character-schema-sync.test.ts fails if the committed files drift.

import { mkdirSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

register("./lib/typescript-hooks.mjs", import.meta.url);
const { renderCharacterJsonSchemas } = await import("../src/lib/characters/content-schema.ts");

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schemaDir = resolve(projectRoot, "content/characters/schema");
mkdirSync(schemaDir, { recursive: true });

for (const [kind, text] of Object.entries(renderCharacterJsonSchemas())) {
  const path = resolve(schemaDir, `${kind}.schema.json`);
  writeFileSync(path, text);
  console.log(`Wrote ${relative(projectRoot, path)}`);
}
