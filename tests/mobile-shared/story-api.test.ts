import { describe, expect, it, vi } from "vitest";

import { ApiClientError, createApiClient } from "../../packages/api-client/src";
import {
  sessionNudgeSchema,
  storyChapterContentSchema,
  storyOverviewSchema,
} from "../../packages/contracts/src";

const character = { id: "c1000000-0000-4000-8000-000000000001", slug: "sample-coach", name: "Sample Coach", artUrl: null };
const overview = {
  character,
  consistencyDays: 2,
  chapters: [
    { number: 1, title: "One", unlocked: true, lock: null },
    { number: 3, title: "Three", unlocked: false, lock: { reason: "days", daysNeeded: 1 } },
    { number: 4, title: "Four", unlocked: false, lock: { reason: "plan" } },
  ],
};

function clientAnswering(status: number, body: unknown) {
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    void input;
    void init;
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  });
  return { fetch, client: createApiClient({ baseUrl: "https://example.com", getAccessToken: () => "token", fetch }) };
}

describe("story and nudge contracts", () => {
  it("accepts the story overview, including no character", () => {
    expect(storyOverviewSchema.parse(overview)).toEqual(overview);
    expect(storyOverviewSchema.parse({ character: null, consistencyDays: 0, chapters: [] }).character).toBeNull();
  });

  it("rejects a lock it does not know, negative days, and a body in the list", () => {
    expect(storyOverviewSchema.safeParse({ ...overview, chapters: [{ number: 2, title: "Two", unlocked: false, lock: { reason: "minutes" } }] }).success).toBe(false);
    expect(storyOverviewSchema.safeParse({ ...overview, consistencyDays: -1 }).success).toBe(false);
    const parsed = storyOverviewSchema.parse({ ...overview, chapters: [{ number: 1, title: "One", unlocked: true, lock: null, body: "secret" }] });
    expect(parsed.chapters[0]).not.toHaveProperty("body");
  });

  it("accepts a chapter and a nudge or null", () => {
    expect(storyChapterContentSchema.parse({ number: 1, title: "One", body: "Text." })).toEqual({ number: 1, title: "One", body: "Text." });
    expect(sessionNudgeSchema.parse(null)).toBeNull();
    const withReminder = { text: "Close the app.", character, disclosure: "AI character · not a person · not a therapist, doctor or lawyer" };
    expect(sessionNudgeSchema.parse(withReminder)).toEqual(withReminder);
    expect(sessionNudgeSchema.parse({ ...withReminder, disclosure: null })).toEqual({ ...withReminder, disclosure: null });
    expect(sessionNudgeSchema.safeParse({ text: "Close the app.", character }).success).toBe(false);
    expect(sessionNudgeSchema.safeParse({ ...withReminder, text: "" }).success).toBe(false);
  });
});

describe("story and nudge API methods", () => {
  it("gets the story", async () => {
    const { client, fetch } = clientAnswering(200, { data: overview });

    await expect(client.getStory()).resolves.toEqual(overview);
    expect(fetch.mock.calls[0]?.[0]).toBe("https://example.com/api/story");
  });

  it("gets one chapter, and surfaces a locked one as 404 not_found", async () => {
    const chapter = { number: 2, title: "Two", body: "Text." };
    const { client, fetch } = clientAnswering(200, { data: chapter });
    await expect(client.getStoryChapter(2)).resolves.toEqual(chapter);
    expect(fetch.mock.calls[0]?.[0]).toBe("https://example.com/api/story/2");

    const locked = clientAnswering(404, { error: { code: "not_found", message: "Resource not found." } });
    await expect(locked.client.getStoryChapter(4)).rejects.toMatchObject({ status: 404, code: "not_found" });
  });

  it("gets a nudge or null, and surfaces the rate limit", async () => {
    const nudge = { text: "Close the app.", character, disclosure: null };
    const { client, fetch } = clientAnswering(200, { data: nudge });
    await expect(client.getSessionNudge()).resolves.toEqual(nudge);
    expect(fetch.mock.calls[0]?.[0]).toBe("https://example.com/api/coach/nudge");

    await expect(clientAnswering(200, { data: null }).client.getSessionNudge()).resolves.toBeNull();
    await expect(clientAnswering(429, { error: { code: "rate_limited", message: "Slow down." } }).client.getSessionNudge())
      .rejects.toMatchObject({ status: 429, code: "rate_limited" });
  });

  it("rejects a malformed story", async () => {
    const { client } = clientAnswering(200, { data: { character: null, chapters: [] } });

    const error = await client.getStory().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({ code: "invalid_response" });
  });
});
