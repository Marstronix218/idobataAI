import "server-only";

import type { ReactionCharacter, ReactionPayload } from "@idobata/contracts";
import {
  createMessageWithin,
  isReactionAiConfigured,
  logAiEvent,
  messageText,
  reactionTimeoutMs,
  type AiCallMeter,
  type AiMessageResult,
} from "@/lib/ai/anthropic";
import { CHARACTER_EVENTS, type CharacterEvent } from "@/lib/characters/content-schema";
import { assignAiArm, type AiArm } from "@/lib/domain/ai-arm";
import { AI_DISCLOSURE } from "@/lib/domain/ai-disclosure";
import { readDisclosureMaxGapHours, shouldShowDisclosure } from "@/lib/domain/disclosure-cadence";
import { chooseLineEvent, consecutiveDayStreak, daysSinceLatest, plainLineEvent } from "@/lib/domain/line-event";
import { fillTaskToken, selectLineWithFallback, taskAgeBucket, taskAgeDays, RECENT_LINE_WINDOW, type SelectableLine } from "@/lib/domain/line-selection";
import { localDate, resolveTimeZone, timeOfDay } from "@/lib/domain/local-day";
import { resolvePlan, type EntitlementRow } from "@/lib/domain/plan";
import { reactionReservation, readAiCaps } from "@/lib/domain/reaction-caps";
import { validateAiReaction } from "@/lib/domain/reaction-validator";
import { recordCrisisShown } from "@/lib/safety/counters";
import {
  DISTRESS_MAX_SLICE_MS,
  DISTRESS_MIN_SLICE_MS,
  createDistressDetector,
  isCrisisRisk,
  type DistressCheckResult,
} from "@/lib/safety/distress";
import { hasDistressKeyword } from "@/lib/safety/keywords";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAiUsage, releaseAiUsage, reserveAiUsage } from "./metering";
import { PROMPT_RECENT_TEXTS, buildReactionRequest, buildReactionSystemPrompt, parsePromptSheet, promptTaskTitle } from "./prompt";

// getReaction (SPEC Phase 3): the character's line when a task is started or
// finished. It never blocks the UI and never throws.
//
// 1. Load everything in two parallel rounds, using the service role but
//    scoping every query to the user.
// 2. Safety first, before anything that depends on the character: a keyword
//    hit in the title or note returns the crisis card at once; otherwise the
//    model distress check starts (D3: every reaction, nothing stored).
// 3. Pick the prewritten line, so falling back is instant.
// 4. If the arm, plan and config allow AI, reserve a slot atomically
//    (reserve_ai_usage) and make the AI call, in parallel with the distress
//    check, inside AI_REACTION_TIMEOUT_MS from the start of the request.
// 5. Crisis (distress possible/high, or the model answering SAFETY_ESCALATE):
//    count it once, store nothing, return { kind: "crisis" }.
// 6. Otherwise a valid AI line, else the prewritten one. The first reaction of
//    the local day carries the AI reminder.
// 7. Store the reaction (one per event; a lost race returns null), meter every
//    model call, and give back the reserved slot unless the AI line was delivered.

/** Starting an AI call with less time left than this would only ever be aborted. */
const MIN_AI_WINDOW_MS = 300;
/**
 * Nothing in a reaction may run past this, from the start of the request, so a
 * start or finish answers in under 3 s (SPEC acceptance criteria) even when
 * loading was slow and the distress check has to be cut short.
 */
const HARD_CEILING_MS = 2900;
/** Finished events read to work out the streak. */
const FINISH_HISTORY_LIMIT = 400;
const REACTION_EVENTS = CHARACTER_EVENTS.filter((event) =>
  ["task_started", "task_finished", "first_of_day", "streak", "comeback"].includes(event));
const UNIQUE_VIOLATION = "23505";

const detector = createDistressDetector();

export interface GetReactionOptions {
  /** When the request began (ms since epoch); the AI deadline counts from here. Defaults to now. */
  startedAt?: number;
  /**
   * Run only the safety checks: return { kind: "crisis" } when the task text
   * suggests distress, otherwise null, with no banter, AI call or stored
   * reaction. Used when the reaction rate limit is reached, because the crisis
   * card must never depend on it.
   */
  safetyOnly?: boolean;
}

type QueryResult<T> = { data: T; error: { message: string; code?: string } | null };

class EngineDataError extends Error {}

function rows<T>(result: QueryResult<T>, what: string): T {
  if (result.error) throw new EngineDataError(`${what}: ${result.error.code ?? ""} ${result.error.message}`.trim());
  return result.data;
}

function logEngine(level: "warn" | "error", message: string, fields: Record<string, unknown> = {}) {
  logAiEvent(level, "reactions", { message, ...fields });
}

const uniqueEvents = (events: CharacterEvent[]) => [...new Set(events)];
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const none = <T>(data: T) => Promise.resolve({ data, error: null });

/**
 * The reaction for one of the user's task events, or null when there is
 * nothing to show: the event is not the user's or already has a reaction, no
 * character is selected, no line matches, or anything failed. Distress text
 * returns { kind: "crisis" } whether or not a character is selected.
 */
export async function getReaction(userId: string, taskEventId: string, options: GetReactionOptions = {}): Promise<ReactionPayload | null> {
  const startedAt = options.startedAt ?? Date.now();
  try {
    return await react(userId, taskEventId, startedAt, options.safetyOnly ?? false);
  } catch (error) {
    logEngine("error", "reaction failed", { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

async function react(userId: string, taskEventId: string, startedAt: number, safetyOnly: boolean): Promise<ReactionPayload | null> {
  const admin = createAdminClient();
  const now = new Date();

  // Round 1: everything keyed by the user or the event alone.
  const [eventResult, profileResult, existingResult, entitlementResult, recentResult, lineIdResult, disclosureResult] = await Promise.all([
    admin.from("task_events").select("id, task_id, type, local_date").eq("id", taskEventId).eq("user_id", userId).maybeSingle(),
    admin.from("user_coach_profiles").select("selected_character_id, timezone, ai_arm").eq("user_id", userId).maybeSingle(),
    admin.from("character_reactions").select("id").eq("task_event_id", taskEventId).eq("user_id", userId).limit(1),
    admin.from("entitlements").select("product, status, trial_ends_at, current_period_end").eq("user_id", userId),
    admin.from("character_reactions").select("text, created_at").eq("user_id", userId)
      .order("created_at", { ascending: false }).limit(PROMPT_RECENT_TEXTS),
    // The last 20 prewritten lines shown; AI reactions have no line id.
    admin.from("character_reactions").select("line_id").eq("user_id", userId).not("line_id", "is", null)
      .order("created_at", { ascending: false }).limit(RECENT_LINE_WINDOW),
    admin.from("character_reactions").select("created_at").eq("user_id", userId).eq("disclosure_shown", true)
      .order("created_at", { ascending: false }).limit(1),
  ]);

  const event = rows(eventResult, "task event");
  if (!event) return null;
  if ((rows(existingResult, "existing reaction") ?? []).length > 0) return null;
  // Every round-1 read is checked here, before any model call, so a failure
  // can't throw away a paid-for reaction later.
  const profile = rows(profileResult, "coach profile");
  const entitlements = (rows(entitlementResult, "entitlements") ?? []) as EntitlementRow[];
  const recent = rows(recentResult, "recent reactions") ?? [];
  const recentLineIds = (rows(lineIdResult, "recent lines") ?? []).flatMap((row) => (row.line_id ? [row.line_id] : []));
  const lastDisclosure = (rows(disclosureResult, "disclosure") ?? [])[0];

  const timeZone = resolveTimeZone(profile?.timezone);
  const today = localDate(now, timeZone);
  const characterId = profile?.selected_character_id ?? null;
  const arm: AiArm = profile?.ai_arm ?? assignAiArm(userId);

  // Round 2: what depends on the event or the profile.
  const [taskResult, characterResult, linesResult, finishResult, activityResult] = await Promise.all([
    admin.from("tasks").select("id, title, description, created_at").eq("id", event.task_id).eq("owner_id", userId).maybeSingle(),
    characterId
      ? admin.from("characters").select("id, slug, name, role, art_url, sheet, active").eq("id", characterId).maybeSingle()
      : none(null),
    characterId
      ? admin.from("character_lines").select("id, event, text, min_streak, max_streak, task_age_bucket")
        .eq("character_id", characterId).eq("active", true).in("event", REACTION_EVENTS)
      : none([]),
    admin.from("task_events").select("id, local_date").eq("user_id", userId).eq("type", "finished")
      .order("local_date", { ascending: false }).limit(FINISH_HISTORY_LIMIT),
    // The user's last activity before this event, for the comeback gap.
    admin.from("task_events").select("local_date").eq("user_id", userId).neq("id", event.id)
      .order("occurred_at", { ascending: false }).limit(1),
    // D1: the arm is sticky; store it the first time it is needed.
    profile && !profile.ai_arm ? persistArm(admin, userId, arm) : null,
  ]);

  const task = rows(taskResult, "task");
  if (!task) return null;
  const character = rows(characterResult, "character");
  const lines = (rows(linesResult, "lines") ?? []) as SelectableLine[];
  const finishes = rows(finishResult, "finishes") ?? [];
  const lastActivity = (rows(activityResult, "last activity") ?? [])[0];

  // Safety first, on the title and the note, whether or not there is a
  // character to react with (D3).
  const crisisScope = `event:${event.id}`;
  const taskText = task.description ? `${task.title}\n${task.description}` : task.title;
  if (hasDistressKeyword(taskText)) {
    await recordCrisisShown(crisisScope, userId);
    return { kind: "crisis" };
  }
  const deadline = startedAt + reactionTimeoutMs();
  const remaining = () => Math.max(0, deadline - Date.now());
  // The model check gets its own slice, at least 1.2 s and at most 2.5 s from
  // now, but never past the hard ceiling. With under 300 ms left the detector
  // skips the model and the keyword result stands (counted as unavailable).
  const distressSlice = Math.min(
    clamp(remaining(), DISTRESS_MIN_SLICE_MS, DISTRESS_MAX_SLICE_MS),
    Math.max(0, startedAt + HARD_CEILING_MS - Date.now()),
  );
  const distressPromise: Promise<DistressCheckResult> = detector
    .check(taskText, { userId, timeoutMs: distressSlice, cacheScope: `${task.id}:${today}` })
    .catch((): DistressCheckResult => ({ risk: "none", source: "unavailable" }));

  let reserved = false;
  let delivered = false;
  let released = false;
  /** Gives the reserved slot back unless the AI line was delivered. Idempotent. */
  const release = async () => {
    if (!reserved || delivered || released) return;
    released = true;
    await releaseAiUsage(admin, userId, today, "reaction");
  };

  try {
    const isFinish = event.type === "finished";
    const priorFinishDates = finishes.filter((finish) => finish.id !== event.id).map((finish) => finish.local_date);
    const streak = consecutiveDayStreak(isFinish ? [...priorFinishDates, today] : priorFinishDates, today);
    const lastReactionDate = recent[0] ? localDate(new Date(recent[0].created_at), timeZone) : null;
    const ageDays = taskAgeDays(task.created_at, now);
    const ageBucket = taskAgeBucket(ageDays);
    const lineEvent = chooseLineEvent({
      eventType: event.type,
      isFirstReactionOfLocalDay: lastReactionDate !== today,
      isFirstFinishOfLocalDay: isFinish && !priorFinishDates.includes(today),
      currentStreak: streak,
      daysSinceLastActivity: daysSinceLatest([lastActivity?.local_date, lastReactionDate], today),
    });

    const canReact = !safetyOnly && Boolean(character?.active);
    // The prewritten line comes first, so a slow or failed AI call costs nothing.
    const prewritten = canReact
      ? selectLineWithFallback(lines, uniqueEvents([lineEvent, plainLineEvent(event.type)]), { streak, ageBucket, recentLineIds, seed: event.id })
      : null;

    const aiController = new AbortController();
    const promptTitle = promptTaskTitle(task.title);
    const sheet = character ? parsePromptSheet(character.sheet) : null;
    const promptCharacter = character && sheet ? { name: character.name, role: character.role, sheet } : null;
    let aiPromise: Promise<AiMessageResult> | null = null;
    const reservation = canReact
      ? reactionReservation({ arm, tier: resolvePlan(entitlements, now).tier, aiConfigured: isReactionAiConfigured() && sheet !== null, caps: readAiCaps() })
      : null;
    // Reserve only when the call will be made, so every reservation (and the
    // attempt it counts) corresponds to a real model call.
    if (reservation && promptCharacter && remaining() >= MIN_AI_WINDOW_MS) {
      reserved = (await reserveAiUsage(admin, userId, today, reservation)) === true;
      if (reserved) {
        aiPromise = createMessageWithin(
          buildReactionRequest(promptCharacter, {
            taskTitle: promptTitle,
            taskAgeDays: ageDays,
            taskAgeBucket: ageBucket,
            streak,
            eventType: event.type,
            moment: lineEvent,
            timeOfDay: timeOfDay(now, timeZone),
            recentTexts: recent.map((reaction) => reaction.text),
          }),
          { timeoutMs: remaining(), signal: aiController.signal },
        );
      }
    }

    const distress = await distressPromise;
    // A crisis makes the reaction moot: stop paying for it.
    if (isCrisisRisk(distress.risk)) aiController.abort();
    const ai = aiPromise ? await aiPromise : null;
    const safetyChecks = distress.meter ? 1 : 0;

    let crisis = isCrisisRisk(distress.risk);
    let aiText: string | null = null;
    if (!crisis && ai?.ok && promptCharacter) {
      const stop = ai.message.stop_reason;
      if (stop === "refusal" || stop === "max_tokens") {
        logEngine("warn", "ai reaction fell back", { reason: stop });
      } else {
        const validation = validateAiReaction(messageText(ai.message), promptTitle, {
          leakSources: [buildReactionSystemPrompt(promptCharacter)],
        });
        if (validation.ok) aiText = validation.text;
        else if (validation.reason === "safety_escalate") crisis = true;
        else logEngine("warn", "ai reaction fell back", { reason: validation.reason });
      }
      if (ai.meter.usage.cacheReadInputTokens > 0) {
        logAiEvent("debug", "reactions", { cacheReadInputTokens: ai.meter.usage.cacheReadInputTokens });
      }
    } else if (ai && !ai.ok && !crisis) {
      logEngine("warn", "ai reaction fell back", { reason: ai.reason, status: ai.status ?? null });
    }

    if (crisis) {
      // Nothing about the task or the result is stored; only the counter
      // moves. Calls are metered as ordinary ones (a cancelled call keeps its
      // estimate) so aborted_calls never marks a crisis.
      const calls = [distress.meter, ai?.meter].map((meter) => (meter ? { ...meter, aborted: false } : meter));
      await Promise.all([
        recordCrisisShown(crisisScope, userId),
        recordAiUsage(admin, userId, today, { safetyChecks, calls }),
        distress.pendingWrites,
        release(),
      ]);
      return { kind: "crisis" };
    }

    const meterCalls: Array<AiCallMeter | undefined> = [distress.meter, ai?.meter];
    const chosen = aiText !== null
      ? { source: "ai" as const, text: aiText, event: lineEvent, lineId: null }
      : prewritten
        ? { source: "prewritten" as const, text: fillTaskToken(prewritten.line.text, task.title), event: prewritten.event, lineId: prewritten.line.id }
        : null;
    if (!canReact || !character || !chosen) {
      await Promise.all([recordAiUsage(admin, userId, today, { safetyChecks, calls: meterCalls }), distress.pendingWrites, release()]);
      if (canReact) logEngine("warn", "no line matched", { event: lineEvent });
      return null;
    }

    // D11: the AI reminder rides on the first reaction shown each local day.
    // TODO(founder): confirm AI reminder wording and cadence with counsel (NY)
    const disclosure = shouldShowDisclosure({
      lastShownAt: lastDisclosure ? new Date(lastDisclosure.created_at) : null,
      now,
      timeZone,
      maxGapHours: readDisclosureMaxGapHours(),
    }) ? AI_DISCLOSURE : null;

    const [insert] = await Promise.all([
      admin.from("character_reactions").insert({
        user_id: userId,
        task_event_id: event.id,
        character_id: character.id,
        event: chosen.event,
        source: chosen.source,
        line_id: chosen.lineId,
        text: chosen.text,
        disclosure_shown: disclosure !== null,
      }),
      recordAiUsage(admin, userId, today, { safetyChecks, calls: meterCalls }),
      distress.pendingWrites,
      // A prewritten line means the reserved AI slot was not used.
      chosen.source === "ai" ? null : release(),
    ]);
    // Another request reacted to this event first (one reaction per event).
    if (insert.error?.code === UNIQUE_VIOLATION) return null;
    if (insert.error) logEngine("error", "reaction not stored", { code: insert.error.code ?? null });
    if (chosen.source === "ai") delivered = true;

    const reactionCharacter: ReactionCharacter = { id: character.id, slug: character.slug, name: character.name, artUrl: character.art_url };
    return { kind: "reaction", text: chosen.text, source: chosen.source, character: reactionCharacter, disclosure };
  } finally {
    await release();
  }
}

async function persistArm(admin: ReturnType<typeof createAdminClient>, userId: string, arm: AiArm) {
  const { error } = await admin
    .from("user_coach_profiles")
    .update({ ai_arm: arm })
    .eq("user_id", userId)
    .is("ai_arm", null);
  if (error) logEngine("error", "ai_arm not stored", { code: error.code ?? null });
  return null;
}
