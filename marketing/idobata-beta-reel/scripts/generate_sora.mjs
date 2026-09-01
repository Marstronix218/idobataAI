#!/usr/bin/env node

import { readFile, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(scriptDir, "..");
const repoDir = resolve(projectDir, "../..");
const config = JSON.parse(await readFile(join(projectDir, "sora_jobs.json"), "utf8"));
const args = new Set(process.argv.slice(2));
const execute = args.has("--execute");
const force = args.has("--force");
const variantsArg = process.argv.find((arg) => arg.startsWith("--variants="));
const shotsArg = process.argv.find((arg) => arg.startsWith("--shots="));
const variants = variantsArg ? Number(variantsArg.split("=")[1]) : config.defaults.variants;
const requestedShots = shotsArg
  ? new Set(shotsArg.split("=")[1].split(",").map((value) => value.trim()).filter(Boolean))
  : null;

if (!Number.isInteger(variants) || variants < 1 || variants > 2) {
  throw new Error("--variants must be 1 or 2");
}

const jobs = config.jobs.filter((job) => !requestedShots || requestedShots.has(job.id));
if (requestedShots && jobs.length !== requestedShots.size) {
  const known = new Set(config.jobs.map((job) => job.id));
  const unknown = [...requestedShots].filter((id) => !known.has(id));
  throw new Error(`Unknown shot id(s): ${unknown.join(", ")}`);
}

const plannedClips = jobs.length * variants;
const plannedSeconds = plannedClips * Number(config.defaults.seconds);
const plannedProCost = plannedSeconds * 0.5;

console.log(JSON.stringify({
  execute,
  shots: jobs.map((job) => job.id),
  variants,
  planned_clips: plannedClips,
  planned_generated_seconds: plannedSeconds,
  planned_sora_2_pro_cost_usd: plannedProCost,
}, null, 2));

if (!execute) {
  console.log("Dry run only. Add --execute to submit Sora jobs.");
  process.exit(0);
}

if (!process.env.OPENAI_API_KEY && typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(join(repoDir, ".env.local"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
const apiKey = process.env.OPENAI_API_KEY || process.env.AI_API_KEY;
if (!apiKey) {
  throw new Error("OPENAI_API_KEY is missing. Set it locally; never paste or commit it.");
}

const rawDir = join(projectDir, "generated", "sora", "raw");
await mkdir(rawDir, { recursive: true });

for (const job of jobs) {
  const shotDir = join(rawDir, job.id);
  await mkdir(shotDir, { recursive: true });

  for (let variant = 1; variant <= variants; variant += 1) {
    const variantName = `variant-${String(variant).padStart(2, "0")}`;
    const outputBase = join(shotDir, variantName);
    try {
      await readFile(`${outputBase}.mp4`);
      if (!force) {
        console.log(`${job.id}/${variantName}: already exists; skipping`);
        continue;
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const prompt = `${job.prompt}\n\n${config.universal_negative}`;
    const referencePath = resolve(projectDir, job.reference);
    const models = [config.defaults.model, config.defaults.fallback_model];
    let created = force ? null : await readJsonIfPresent(`${outputBase}.create.json`);
    let usedModel = created?.model;

    if (created?.id) {
      console.log(`${job.id}/${variantName}: resuming existing job ${created.id}`);
    } else {
      created = null;
    }

    if (!created) {
      for (const model of models) {
        try {
          created = await createVideo({ model, prompt, referencePath });
          usedModel = model;
          break;
        } catch (error) {
          if (model === models.at(-1)) throw error;
          console.warn(`${job.id}/${variantName}: ${model} unavailable; retrying ${models.at(-1)}.`);
        }
      }
      await writeFile(`${outputBase}.create.json`, JSON.stringify(created, null, 2));
    }

    const completed = await waitForVideo(created.id);
    await writeFile(`${outputBase}.final.json`, JSON.stringify(completed, null, 2));
    await downloadVideo(created.id, `${outputBase}.mp4`);
    await writeFile(`${outputBase}.prompt.txt`, `${prompt}\n`);
    console.log(`${job.id}/${variantName}: completed with ${usedModel}`);
  }
}

async function createVideo({ model, prompt, referencePath }) {
  const bytes = await readFile(referencePath);
  const form = new FormData();
  form.append("model", model);
  form.append("prompt", prompt);
  form.append("seconds", config.defaults.seconds);
  form.append("size", config.defaults.size);
  form.append("input_reference", new Blob([bytes], { type: mediaType(referencePath) }), basename(referencePath));

  return requestJson("https://api.openai.com/v1/videos", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
}

async function waitForVideo(videoId) {
  const deadline = Date.now() + 20 * 60 * 1000;
  while (Date.now() < deadline) {
    const video = await requestJson(`https://api.openai.com/v1/videos/${videoId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    console.log(`${videoId}: ${video.status} ${video.progress ?? 0}%`);
    if (video.status === "completed") return video;
    if (video.status === "failed") {
      throw new Error(`${videoId} failed: ${video.error?.message ?? "unknown error"}`);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10_000));
  }
  throw new Error(`${videoId} did not complete within 20 minutes`);
}

async function downloadVideo(videoId, destination) {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      const response = await fetch(`https://api.openai.com/v1/videos/${videoId}/content`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (response.ok) {
        await writeFile(destination, Buffer.from(await response.arrayBuffer()));
        return;
      }
      const message = `Download failed (${response.status}): ${await response.text()}`;
      if (!isTransientStatus(response.status) || attempt === 6) throw new Error(message);
      console.warn(`${videoId}: transient download error; retrying (${attempt}/6)`);
    } catch (error) {
      if (attempt === 6 || !isTransientNetworkError(error)) throw error;
      console.warn(`${videoId}: transient download connection error; retrying (${attempt}/6)`);
    }
    await retryDelay(attempt);
  }
}

async function requestJson(url, init) {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (response.ok) return response.json();
      const message = `OpenAI API ${response.status}: ${await response.text()}`;
      if (!isTransientStatus(response.status) || attempt === 6) throw new Error(message);
      console.warn(`Transient OpenAI API ${response.status}; retrying (${attempt}/6)`);
    } catch (error) {
      if (attempt === 6 || !isTransientNetworkError(error)) throw error;
      console.warn(`Transient OpenAI connection error; retrying (${attempt}/6)`);
    }
    await retryDelay(attempt);
  }
}

async function readJsonIfPresent(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function isTransientStatus(status) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function isTransientNetworkError(error) {
  return error instanceof TypeError || /(?:network|connect|socket|reset|timeout|503)/i.test(error?.message ?? "");
}

function retryDelay(attempt) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, Math.min(2 ** attempt * 1_000, 15_000)));
}

function mediaType(path) {
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  throw new Error(`Unsupported input reference format: ${path}`);
}
