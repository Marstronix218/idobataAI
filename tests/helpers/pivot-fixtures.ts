import { readFileSync } from "node:fs";
import { join } from "node:path";
import { addDays } from "@/lib/domain/local-day";
import type { DbError, FakeSupabase, Row } from "./fake-supabase";

// Shared rows for the Pivot A reaction and split tests. The character is the
// real sample-coach content, so the tests exercise the copy that gets seeded.

export const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const OTHER_USER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const CHARACTER_ID = "c1000000-0000-4000-8000-000000000001";
export const TASK_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
export const EVENT_ID = "f1000000-0000-4000-8000-000000000001";

/** 10:00 on Saturday 2026-10-31 in America/Chicago (CDT, UTC-5). */
export const NOW = new Date("2026-10-31T15:00:00.000Z");
export const TODAY = "2026-10-31";
export const TIME_ZONE = "America/Chicago";

const contentDir = join(process.cwd(), "content", "characters", "sample-coach");
export const sampleSheet = JSON.parse(readFileSync(join(contentDir, "sheet.json"), "utf8")) as Record<string, unknown>;
const linesFile = JSON.parse(readFileSync(join(contentDir, "lines.json"), "utf8")) as { lines: Array<Record<string, unknown>> };

export const sampleLines: Row[] = linesFile.lines.map((line) => ({
  id: line.id,
  character_id: CHARACTER_ID,
  event: line.event,
  text: line.text,
  min_streak: line.min_streak ?? null,
  max_streak: line.max_streak ?? null,
  task_age_bucket: line.task_age_bucket ?? null,
  tags: line.tags ?? [],
  active: line.active ?? true,
}));

export const lineText = (id: string) => String(sampleLines.find((line) => line.id === id)?.text);
export const linesFor = (event: string) => sampleLines.filter((line) => line.event === event).map((line) => String(line.id));

export const character: Row = {
  id: CHARACTER_ID,
  slug: "sample-coach",
  name: "Sample Coach (placeholder)",
  role: "coach",
  art_url: null,
  is_launch: true,
  pack_sku: null,
  sheet: sampleSheet,
  active: true,
};

export const PLUS: Row = { user_id: USER_ID, product: "plus", status: "active", source: "stripe", trial_ends_at: null, current_period_end: null };

/** A plus user in the AI arm who has started "Water the plants" (3 days old) and has no reactions yet. */
export function baseTables(overrides: Partial<Record<string, Row[]>> = {}): Record<string, Row[]> {
  return {
    task_events: [{ id: EVENT_ID, user_id: USER_ID, task_id: TASK_ID, type: "started", occurred_at: NOW.toISOString(), local_date: TODAY, occurrence_key: null }],
    user_coach_profiles: [{ user_id: USER_ID, selected_character_id: CHARACTER_ID, timezone: TIME_ZONE, ai_arm: "ai" }],
    character_reactions: [],
    entitlements: [PLUS],
    tasks: [{ id: TASK_ID, owner_id: USER_ID, title: "Water the plants", description: null, status: "pending", recurrence_instance_id: null, completed_at: null, created_at: "2026-10-28T15:00:00.000Z" }],
    characters: [character],
    character_lines: sampleLines,
    ai_usage_daily: [],
    ...overrides,
  };
}

/** A Messages API reply as the SDK returns it. */
export function message(text: string, overrides: Record<string, unknown> = {}) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    content: [{ type: "text", text, citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    usage: {
      input_tokens: 400,
      output_tokens: 30,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation: null,
      inference_geo: null,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: null,
    },
    ...overrides,
  };
}

/** True for the distress check's request (structured output), false for a reaction or split. */
export const isDistressRequest = (params: { output_config?: { format?: { schema?: { properties?: Record<string, unknown> } } } }) =>
  Boolean(params.output_config?.format?.schema?.properties?.risk);
export const isSplitRequest = (params: { output_config?: { format?: { schema?: { properties?: Record<string, unknown> } } } }) =>
  Boolean(params.output_config?.format?.schema?.properties?.steps);

const USAGE_COLUMNS = {
  reaction: { delivered: "reactions", attempts: "reaction_attempts" },
  split: { delivered: "splits", attempts: "split_attempts" },
} as const;

/**
 * reserve_ai_usage / release_ai_usage as migration 20261031150000 specifies
 * them, over the fake ai_usage_daily rows: reserve succeeds while delivered
 * results in the window stay under the cap and attempts under the ceiling,
 * and counts one of each on p_date; release takes one delivered back.
 */
export function pivotRpc(name: string, args: Record<string, unknown>, db: FakeSupabase): { data: unknown; error: DbError | null } | undefined {
  if (name !== "reserve_ai_usage" && name !== "release_ai_usage") return undefined;
  const columns = USAGE_COLUMNS[args.p_kind as "reaction" | "split"];
  const usage = (db.tables.ai_usage_daily ??= []);
  const date = String(args.p_date);
  let today = usage.find((row) => row.user_id === args.p_user_id && row.date === date);
  if (name === "release_ai_usage") {
    if (today) today[columns.delivered] = Math.max(0, Number(today[columns.delivered] ?? 0) - 1);
    return { data: null, error: null };
  }
  const from = addDays(date, -(Number(args.p_window_days) - 1));
  const inWindow = usage.filter((row) => row.user_id === args.p_user_id && String(row.date) >= from && String(row.date) <= date);
  const sum = (column: string) => inWindow.reduce((total, row) => total + Number(row[column] ?? 0), 0);
  if (sum(columns.delivered) >= Number(args.p_cap) || sum(columns.attempts) >= Number(args.p_attempt_ceiling)) return { data: false, error: null };
  if (!today) {
    today = { user_id: args.p_user_id, date, reactions: 0, splits: 0, reaction_attempts: 0, split_attempts: 0 };
    usage.push(today);
  }
  today[columns.delivered] = Number(today[columns.delivered] ?? 0) + 1;
  today[columns.attempts] = Number(today[columns.attempts] ?? 0) + 1;
  return { data: true, error: null };
}

/** Today's ai_usage_daily row for the test user, if any. */
export const usageRow = (db: FakeSupabase, date = TODAY) => db.tables.ai_usage_daily?.find((row) => row.user_id === USER_ID && row.date === date);
