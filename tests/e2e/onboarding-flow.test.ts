// The end-to-end onboarding flow (SPEC "Tests (required)", PLAN D8): the age
// gate, character pick, first task, first reaction and the paywall, against
// the local Supabase stack. The route handlers are called directly with real
// Requests; the database, RLS, triggers and the before_user_created hook are
// all real. No model is configured (tests/e2e/setup.ts), so every reaction is
// a prewritten sample-coach line, and the "paywall" is the Plus notice the
// split route answers with while beta_full_access is off (Phase 6 was skipped).

import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { reactionPayloadSchema, taskStartResultSchema, type ReactionPayload } from "@idobata/contracts";
import { POST as recordAnalyticsEvent } from "@/app/api/analytics/event/route";
import { POST as ageCheck } from "@/app/api/auth/age-check/route";
import { GET as listCharacters } from "@/app/api/characters/route";
import { PUT as saveCoachProfile } from "@/app/api/coach/profile/route";
import { POST as finishTask } from "@/app/api/tasks/[id]/finish/route";
import { POST as splitTask } from "@/app/api/tasks/[id]/split/route";
import { POST as startTask } from "@/app/api/tasks/[id]/start/route";
import { POST as createTask } from "@/app/api/tasks/route";
import { AI_DISCLOSURE } from "@/lib/domain/ai-disclosure";
import { resetFlagCacheForTests } from "@/lib/flags";
import sampleLines from "../../content/characters/sample-coach/lines.json";
import { createServiceClient, setFlags, type E2eFlagKey } from "./local-stack";

const stack = inject("localSupabase");
const admin = createServiceClient(stack);

/**
 * Of a few zones spread around the clock, the one where it is now closest to
 * noon (never more than about three hours off), so a start, its finish, the
 * day's AI reminder and the consistency day all fall on one local day.
 */
function zoneNearestNoon(now: Date) {
  const zones = ["Pacific/Kiritimati", "Asia/Tokyo", "Asia/Kolkata", "Europe/London", "America/New_York", "Pacific/Honolulu"];
  const minutesFromNoon = (timeZone: string) => {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
    const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    return Math.abs(value("hour") * 60 + value("minute") - 12 * 60);
  };
  return zones.reduce((best, zone) => (minutesFromNoon(zone) < minutesFromNoon(best) ? zone : best));
}

const TIME_ZONE = zoneNearestNoon(new Date());
const ADULT_DATE_OF_BIRTH = "1990-05-17";
// Always ten years old, so the date never ages into adulthood.
const MINOR_DATE_OF_BIRTH = `${new Date().getUTCFullYear() - 10}-01-01`;
const SAMPLE_CHARACTER = "sample-coach";

const createdUserIds = new Set<string>();

type ApiBody<T> = { data?: T; error?: { code: string; message: string } };

function request(path: string, { method = "GET", token, body }: { method?: string; token?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request(`http://localhost:3000${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function read<T>(response: Response) {
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : {}) as ApiBody<T> };
}

const idContext = (id: string) => ({ params: Promise.resolve({ id }) });

const anonClient = () => createClient(stack.url, stack.anonKey, { auth: { autoRefreshToken: false, persistSession: false } });

/** The user's local date in TIME_ZONE, as task_events.local_date records it. */
const localToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

/** The sample coach's lines for one event, with {task} filled in as a reaction shows them. */
function sampleLinesFor(event: string, taskTitle = "") {
  return sampleLines.lines
    .filter((line) => line.event === event)
    .map((line) => ({ id: line.id, text: line.text.replaceAll("{task}", taskTitle) }));
}

async function useFlags(flags: Partial<Record<E2eFlagKey, boolean>>) {
  await setFlags(admin, flags);
  // getFlags() caches for 30 s per server instance, and this worker is that instance.
  resetFlagCacheForTests();
}

async function checkAge(dateOfBirth: string) {
  return read<{ token: string; expiresAt: string }>(
    await ageCheck(request("/api/auth/age-check", { method: "POST", body: { dateOfBirth, timeZone: TIME_ZONE } })),
  );
}

interface TestUser {
  id: string;
  accessToken: string;
  ageToken: string;
}

/** Age check, then a real GoTrue sign-up carrying the token, as the web and mobile sign-up forms do. */
async function signUpAdult(): Promise<TestUser> {
  const age = await checkAge(ADULT_DATE_OF_BIRTH);
  expect(age.status, JSON.stringify(age.body)).toBe(200);
  const ageToken = age.body.data?.token ?? "";
  expect(ageToken.length).toBeGreaterThanOrEqual(16);

  const email = `e2e-${randomUUID()}@example.com`;
  const password = `e2e-${randomUUID()}`;
  const auth = anonClient();
  const { data, error } = await auth.auth.signUp({ email, password, options: { data: { age_token: ageToken } } });
  expect(error).toBeNull();
  const userId = data.user?.id;
  if (!userId) throw new Error("sign-up returned no user");
  createdUserIds.add(userId);

  // supabase/config.toml has enable_confirmations = false, so sign-up returns
  // a session. Should that change, confirm through the admin API and sign in.
  let session = data.session;
  if (!session) {
    const confirmed = await admin.auth.admin.updateUserById(userId, { email_confirm: true });
    expect(confirmed.error).toBeNull();
    session = (await auth.auth.signInWithPassword({ email, password })).data.session;
  }
  if (!session) throw new Error("no session after sign-up");
  return { id: userId, accessToken: session.access_token, ageToken };
}

async function pickSampleCharacter(user: TestUser) {
  const characters = await read<{ items: Array<{ id: string; slug: string }> }>(
    await listCharacters(request("/api/characters", { token: user.accessToken })),
  );
  expect(characters.status, JSON.stringify(characters.body)).toBe(200);
  const character = characters.body.data?.items.find((item) => item.slug === SAMPLE_CHARACTER);
  if (!character) throw new Error(`${SAMPLE_CHARACTER} is not selectable; was it seeded?`);

  const profile = await read<{ selected_character_id: string | null; timezone: string | null; age_verified_at: string | null }>(
    await saveCoachProfile(request("/api/coach/profile", { method: "PUT", token: user.accessToken, body: { characterId: character.id, timezone: TIME_ZONE } })),
  );
  expect(profile.status, JSON.stringify(profile.body)).toBe(200);
  expect(profile.body.data).toMatchObject({ selected_character_id: character.id, timezone: TIME_ZONE });
  expect(profile.body.data?.age_verified_at).toBeTruthy();
  return character;
}

async function addTask(user: TestUser, title: string) {
  const created = await read<{ id: string; title: string; status: string }>(
    await createTask(request("/api/tasks", { method: "POST", token: user.accessToken, body: { title } })),
  );
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  expect(created.body.data).toMatchObject({ title, status: "pending" });
  expect(created.body.data).not.toHaveProperty("safety");
  return created.body.data!.id;
}

async function start(user: TestUser, taskId: string) {
  const response = await read<unknown>(await startTask(request(`/api/tasks/${taskId}/start`, { method: "POST", token: user.accessToken }), idContext(taskId)));
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return taskStartResultSchema.parse(response.body.data);
}

async function finish(user: TestUser, taskId: string) {
  const response = await read<{ task: { status: string }; reaction: unknown }>(
    await finishTask(request(`/api/tasks/${taskId}/finish`, { method: "POST", token: user.accessToken }), idContext(taskId)),
  );
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  expect(response.body.data?.task.status).toBe("completed");
  return { reaction: reactionPayloadSchema.nullable().parse(response.body.data?.reaction) };
}

async function split(user: TestUser, taskId: string) {
  return read<unknown>(await splitTask(request(`/api/tasks/${taskId}/split`, { method: "POST", token: user.accessToken }), idContext(taskId)));
}

function expectLine(reaction: ReactionPayload | null): Extract<ReactionPayload, { kind: "reaction" }> {
  expect(reaction?.kind).toBe("reaction");
  if (reaction?.kind !== "reaction") throw new Error("expected a character reaction");
  expect(reaction.source).toBe("prewritten");
  expect(reaction.character.slug).toBe(SAMPLE_CHARACTER);
  return reaction;
}

async function countAgeTokens() {
  const { count, error } = await admin.from("age_verification_tokens").select("token_hash", { count: "exact", head: true });
  expect(error).toBeNull();
  return count ?? 0;
}

beforeAll(async () => {
  // The global setup set these already; setting them here keeps the file
  // self-contained if the local database was reset in between.
  await useFlags({ "pivot_a.enabled": true, "beta_full_access.enabled": false });
});

afterAll(async () => {
  await useFlags({ "beta_full_access.enabled": false });
  for (const id of createdUserIds) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.warn(`test:e2e: could not delete user ${id}: ${error.message}`);
  }
});

describe("Scenario A: an adult on the free tier", () => {
  const FIRST_TASK = "Water the plants";
  const SECOND_TASK = "Fold the laundry";
  let user: TestUser;
  let characterId: string;
  let firstTaskId: string;
  let runDay: string;

  beforeAll(async () => {
    runDay = localToday();
    await useFlags({ "pivot_a.enabled": true, "beta_full_access.enabled": false });
  });

  it("passes the age gate and signs up with the age token", async () => {
    user = await signUpAdult();

    // handle_new_user copied the verification and spent the token.
    const { data: profile, error } = await admin
      .from("user_coach_profiles")
      .select("age_verified_at, age_verification_method")
      .eq("user_id", user.id)
      .single();
    expect(error).toBeNull();
    expect(profile?.age_verified_at).toBeTruthy();
    expect(profile?.age_verification_method).toBe("self_attested");

    const tokenHash = createHash("sha256").update(user.ageToken, "utf8").digest("hex");
    const tokens = await admin.from("age_verification_tokens").select("token_hash").eq("token_hash", tokenHash);
    expect(tokens.error).toBeNull();
    expect(tokens.data).toEqual([]);

    // The token never stays in the user's metadata.
    const stored = await admin.auth.admin.getUserById(user.id);
    expect(stored.error).toBeNull();
    expect(stored.data.user?.user_metadata).not.toHaveProperty("age_token");
  });

  it("lists the sample character and saves it with the time zone", async () => {
    characterId = (await pickSampleCharacter(user)).id;
  });

  it("starts and finishes the first task, with the day's AI reminder shown once", async () => {
    firstTaskId = await addTask(user, FIRST_TASK);

    // The first reaction of the local day is a first_of_day line (only one of
    // the two sample lines names the task, chosen by the event id) and carries
    // the AI reminder.
    const started = await start(user, firstTaskId);
    expect(started.event.type).toBe("started");
    const startLine = expectLine(started.reaction);
    expect(sampleLinesFor("first_of_day", FIRST_TASK).map((line) => line.text)).toContain(startLine.text);
    expect(startLine.disclosure).toBe(AI_DISCLOSURE);

    // The first finish is the first consistency day, which opens chapter 1 on
    // the free plan, so the line is a chapter_unlocked one. The reminder was
    // already shown today.
    const finished = await finish(user, firstTaskId);
    const finishLine = expectLine(finished.reaction);
    expect(sampleLinesFor("chapter_unlocked").map((line) => line.text)).toContain(finishLine.text);
    expect(finishLine.disclosure).toBeNull();
  });

  it("shows a reaction that names the task", async () => {
    // With the day's first reaction and first finish behind them, the plain
    // task_started and task_finished lines apply, and every sample line for
    // them names the task. A fresh task prefers the one line written for
    // fresh tasks, so the start line is exact.
    const taskId = await addTask(user, SECOND_TASK);

    const startLine = expectLine((await start(user, taskId)).reaction);
    const freshStart = sampleLinesFor("task_started", SECOND_TASK).find((line) => line.id === "sample-coach.task_started.003");
    expect(startLine.text).toBe(freshStart?.text);
    expect(startLine.disclosure).toBeNull();

    const finishLine = expectLine((await finish(user, taskId)).reaction);
    const anyAgeFinishes = sampleLinesFor("task_finished", SECOND_TASK)
      .filter((line) => line.id !== "sample-coach.task_finished.003")
      .map((line) => line.text);
    expect(anyAgeFinishes).toContain(finishLine.text);
    expect(finishLine.text).toContain(SECOND_TASK);
    expect(finishLine.disclosure).toBeNull();
  });

  it("shows the Plus notice: split answers 402 plan_required and paywall_viewed is recorded", async () => {
    const splitResponse = await split(user, firstTaskId);
    expect(splitResponse.status).toBe(402);
    expect(splitResponse.body.error?.code).toBe("plan_required");

    // The client reports the notice it showed. The route answers 204 No Content.
    const event = await recordAnalyticsEvent(request("/api/analytics/event", {
      method: "POST",
      token: user.accessToken,
      body: { name: "paywall_viewed", detail: "split" },
    }));
    expect(event.status).toBe(204);

    const { data, error } = await admin
      .from("beta_product_events")
      .select("event_name, detail")
      .eq("user_id", user.id)
      .eq("event_name", "paywall_viewed");
    expect(error).toBeNull();
    expect(data).toEqual([{ event_name: "paywall_viewed", detail: "split" }]);
  });

  it("leaves the expected rows: task events, reactions, the consistency day and product events", async () => {
    // TIME_ZONE was chosen near local noon, so the whole scenario ran on one local day.
    const today = localToday();
    expect(today).toBe(runDay);

    const events = await admin.from("task_events").select("type, local_date").eq("task_id", firstTaskId).order("type");
    expect(events.error).toBeNull();
    expect(events.data).toEqual([
      { type: "finished", local_date: today },
      { type: "started", local_date: today },
    ]);

    const reactions = await admin
      .from("character_reactions")
      .select("event, source, line_id, character_id, disclosure_shown")
      .eq("user_id", user.id)
      .order("created_at");
    expect(reactions.error).toBeNull();
    const rows = reactions.data ?? [];
    expect(rows.map((row) => row.event)).toEqual(["first_of_day", "chapter_unlocked", "task_started", "task_finished"]);
    expect(rows.map((row) => row.disclosure_shown)).toEqual([true, false, false, false]);
    expect(rows.every((row) => row.source === "prewritten" && row.character_id === characterId)).toBe(true);
    expect(sampleLinesFor("first_of_day").map((line) => line.id)).toContain(rows[0].line_id);
    expect(sampleLinesFor("chapter_unlocked").map((line) => line.id)).toContain(rows[1].line_id);
    expect(rows[2].line_id).toBe("sample-coach.task_started.003");
    expect(["sample-coach.task_finished.001", "sample-coach.task_finished.002"]).toContain(rows[3].line_id);

    // One consistency day, counted once toward the character's story, which opened chapter 1.
    const days = await admin.from("coach_consistency_dates").select("local_date").eq("user_id", user.id);
    expect(days.error).toBeNull();
    expect(days.data).toEqual([{ local_date: today }]);
    const story = await admin
      .from("story_progress")
      .select("consistency_days, unlocked_through, last_consistency_date")
      .eq("user_id", user.id)
      .eq("character_id", characterId)
      .single();
    expect(story.error).toBeNull();
    expect(story.data).toEqual({ consistency_days: 1, unlocked_through: 1, last_consistency_date: today });

    // The metrics written by triggers (the legacy beta task events and the
    // Phase 7 coach events), plus the paywall view.
    const product = await admin.from("beta_product_events").select("event_name").eq("user_id", user.id);
    expect(product.error).toBeNull();
    const counts: Record<string, number> = {};
    for (const row of product.data ?? []) counts[row.event_name] = (counts[row.event_name] ?? 0) + 1;
    expect(counts).toEqual({
      task_created: 2,
      task_completed: 2,
      task_started: 2,
      task_finished: 2,
      reaction_shown: 4,
      chapter_unlocked: 1,
      paywall_viewed: 1,
    });
  });
});

describe("Scenario B: under 18", () => {
  beforeAll(async () => {
    await useFlags({ "pivot_a.enabled": true });
  });

  it("refuses the age check with 403 and stores nothing", async () => {
    const before = await countAgeTokens();
    const age = await checkAge(MINOR_DATE_OF_BIRTH);
    expect(age.status).toBe(403);
    expect(age.body.error?.code).toBe("age_requirement");
    expect(age.body.data).toBeUndefined();
    expect(await countAgeTokens()).toBe(before);
  });

  it("refuses a sign-up without an age token", async () => {
    const email = `e2e-${randomUUID()}@example.com`;
    const password = `e2e-${randomUUID()}`;
    const auth = anonClient();

    const signUp = await auth.auth.signUp({ email, password });
    if (signUp.data.user) createdUserIds.add(signUp.data.user.id);
    // The before_user_created hook (enabled in supabase/config.toml) answers
    // 403; without it, the auth.users backstop trigger fails the insert.
    expect(signUp.error?.message).toMatch(/age verification required/i);
    expect(signUp.data.user).toBeNull();
    expect(signUp.data.session).toBeNull();

    const signIn = await auth.auth.signInWithPassword({ email, password });
    expect(signIn.error).not.toBeNull();
    expect(signIn.data.session).toBeNull();

    // The admin API is no way around it either (PLAN Phase 5).
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.data.user) createdUserIds.add(created.data.user.id);
    expect(created.error).not.toBeNull();
    expect(created.data.user).toBeNull();
  });
});

describe("Scenario C: beta_full_access on", () => {
  beforeAll(async () => {
    await useFlags({ "pivot_a.enabled": true, "beta_full_access.enabled": false });
  });

  afterAll(async () => {
    await useFlags({ "beta_full_access.enabled": false });
  });

  it("lifts the plan gate: with no AI key, split answers 503 split_unavailable, not 402 plan_required", async () => {
    const user = await signUpAdult();
    await pickSampleCharacter(user);
    const taskId = await addTask(user, "Plan the week");

    // The same user and task, first on the free tier. split_unavailable is
    // also the answer when the task can't be read, so the plan gate is shown
    // to hold first and then to lift.
    const free = await split(user, taskId);
    expect(free.status).toBe(402);
    expect(free.body.error?.code).toBe("plan_required");

    await useFlags({ "beta_full_access.enabled": true });
    const beta = await split(user, taskId);
    expect(beta.status).toBe(503);
    expect(beta.body.error?.code).toBe("split_unavailable");
  });
});
