import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { OpenAICompatibleProvider } from "@/lib/ai/provider";

function completion(content: string, status = 200) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createProvider() {
  return new OpenAICompatibleProvider({
    apiKey: "test-key",
    baseUrl: "https://api.openai.com/v1/",
    chatModel: "gpt-5.6-luna",
    utilityModel: "gpt-4o-mini",
    chatReasoningEffort: "low",
    tokenParameter: "max_completion_tokens",
  });
}

function sentBody(fetchMock: ReturnType<typeof vi.fn>, index = 0) {
  const init = fetchMock.mock.calls[index]?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body)) as { model: string; messages: Array<{ role: string; content: string }> };
}

const voice = {
  companionName: "Kage",
  personality: "A modern ninja treating chores as classified missions.",
  writingStyle: "Extremely serious operation reports.",
  safetyInstructions: "Stay clearly fictional and age-appropriate.",
  replyStyle: "Two clauses at most, mission vocabulary.",
  quoteStyle: "Files the completion as an objective cleared before extraction.",
  toneRules: ["Mission vocabulary", "Never wink at the reader"],
  avoidRules: ["Emoji", "Explaining the bit"],
};

const task = {
  postContent: "Cleaned my entire apartment.",
  taskTitle: "Clean the apartment",
  category: "Home",
  taskCategory: "cleaning",
  streak: 4,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("generateReply prompt", () => {
  it("carries the persona's engagement style and rules into the system prompt", async () => {
    const fetchMock = vi.fn().mockResolvedValue(completion("Area cleared. Maintain operational readiness."));
    vi.stubGlobal("fetch", fetchMock);

    await createProvider().generateReply({ ...voice, ...task });

    const system = sentBody(fetchMock).messages[0].content;
    expect(system).toContain("Kage");
    expect(system).toContain("Two clauses at most, mission vocabulary.");
    expect(system).toContain("Mission vocabulary; Never wink at the reader");
    expect(system).toContain("Emoji; Explaining the bit");
    expect(system).toContain("Stay clearly fictional and age-appropriate.");
  });

  it("forbids the generic praise the diversity filter would reject anyway", async () => {
    const fetchMock = vi.fn().mockResolvedValue(completion("Area cleared."));
    vi.stubGlobal("fetch", fetchMock);

    await createProvider().generateReply({ ...voice, ...task });

    const system = sentBody(fetchMock).messages[0].content;
    expect(system).toMatch(/great job/i);
    expect(system).toMatch(/keep it up/i);
    expect(system).toContain("Never use em dashes.");
  });

  it("passes the completed task, and the replies to write around, as data", async () => {
    const fetchMock = vi.fn().mockResolvedValue(completion("Area cleared."));
    vi.stubGlobal("fetch", fetchMock);

    await createProvider().generateReply({
      ...voice,
      ...task,
      siblingReplies: ["DUNGEON PURIFIED. Loot quality: improved floor visibility."],
      recentReplies: ["Objective completed. Good work."],
    });

    const user = JSON.parse(sentBody(fetchMock).messages[1].content) as Record<string, unknown>;
    expect(user).toMatchObject({
      completed_task: "Clean the apartment",
      task_category: "cleaning",
      completion_note: "Cleaned my entire apartment.",
      streak_days: 4,
      other_ai_replies_already_posted: ["DUNGEON PURIFIED. Loot quality: improved floor visibility."],
      your_recent_replies_do_not_repeat_these: ["Objective completed. Good work."],
    });
  });

  it("omits the repetition lists entirely when there is no history", async () => {
    const fetchMock = vi.fn().mockResolvedValue(completion("Area cleared."));
    vi.stubGlobal("fetch", fetchMock);

    await createProvider().generateReply({ ...voice, ...task });

    const user = JSON.parse(sentBody(fetchMock).messages[1].content) as Record<string, unknown>;
    expect(user).not.toHaveProperty("other_ai_replies_already_posted");
    expect(user).not.toHaveProperty("your_recent_replies_do_not_repeat_these");
  });
});

describe("generateQuoteRepost prompt", () => {
  it("asks for standalone feed commentary rather than a reply", async () => {
    const fetchMock = vi.fn().mockResolvedValue(completion("Full territory secured. I acknowledge this operation."));
    vi.stubGlobal("fetch", fetchMock);

    await createProvider().generateQuoteRepost({ ...voice, ...task, authorLabel: "@mina" });

    const body = sentBody(fetchMock);
    const system = body.messages[0].content;
    expect(system).toContain("Files the completion as an objective cleared before extraction.");
    expect(system).toContain("Write commentary, not a reply.");
    expect(system).toMatch(/stand alone/i);
    expect(JSON.parse(body.messages[1].content)).toMatchObject({
      original_author: "@mina",
      completed_task: "Clean the apartment",
    });
  });

  it("reaches for the stronger model first, since a quote is rare and public", async () => {
    const fetchMock = vi.fn().mockResolvedValue(completion("Full territory secured."));
    vi.stubGlobal("fetch", fetchMock);

    await createProvider().generateQuoteRepost({ ...voice, ...task });

    expect(sentBody(fetchMock).model).toBe("gpt-5.6-luna");
  });

  it("falls back to the utility model when the stronger one fails", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(completion("unavailable", 503))
      .mockResolvedValueOnce(completion("Full territory secured."));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createProvider().generateQuoteRepost({ ...voice, ...task }))
      .resolves.toBe("Full territory secured.");
    expect(sentBody(fetchMock, 1).model).toBe("gpt-4o-mini");
  });
});
