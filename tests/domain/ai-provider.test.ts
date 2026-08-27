import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  DisabledAIProvider,
  OpenAICompatibleProvider,
  getAIProvider,
  type GenerateChatReplyInput,
  type GenerateReplyInput,
} from "@/lib/ai/provider";

const replyInput: GenerateReplyInput = {
  companionName: "Momo",
  personality: "warm and practical",
  writingStyle: "brief and conversational",
  safetyInstructions: "Never pressure the user.",
  postContent: "I finished the first draft.",
  taskTitle: "Write the draft",
  category: "writing",
};

const chatInput: GenerateChatReplyInput = {
  companionName: "Momo",
  personality: "warm and practical",
  writingStyle: "brief and conversational",
  safetyInstructions: "Never pressure the user.",
  history: Array.from({ length: 14 }, (_, index) => ({
    role: index % 2 === 0 ? "user" as const : "assistant" as const,
    content: `message-${index}`,
  })),
};

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

function requestBody(fetchMock: ReturnType<typeof vi.fn>, index = 0) {
  const init = fetchMock.mock.calls[index]?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("OpenAICompatibleProvider routing", () => {
  it("uses GPT-4o mini without reasoning for short utility replies", async () => {
    const fetchMock = vi.fn().mockResolvedValue(completion("That draft is real progress."));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createProvider().generateReply(replyInput)).resolves.toBe("That draft is real progress.");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/chat/completions");
    expect(requestBody(fetchMock)).toMatchObject({
      model: "gpt-4o-mini",
      temperature: 0.7,
      max_completion_tokens: 100,
    });
    expect(requestBody(fetchMock)).not.toHaveProperty("reasoning_effort");
  });

  it("escalates a failed utility request to Luna", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(completion("unavailable", 503))
      .mockResolvedValueOnce(completion("You kept the promise you made to yourself."));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createProvider().generateReply(replyInput)).resolves.toBe(
      "You kept the promise you made to yourself.",
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestBody(fetchMock, 0)).toMatchObject({ model: "gpt-4o-mini" });
    expect(requestBody(fetchMock, 1)).toMatchObject({
      model: "gpt-5.6-luna",
      reasoning_effort: "low",
    });
  });

  it("uses Luna with low reasoning for private chat and keeps only the latest 12 messages", async () => {
    const fetchMock = vi.fn().mockResolvedValue(completion("You sound relieved. What helped most?"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createProvider().generateChatReply(chatInput)).resolves.toBe(
      "You sound relieved. What helped most?",
    );

    const body = requestBody(fetchMock);
    expect(body).toMatchObject({
      model: "gpt-5.6-luna",
      reasoning_effort: "low",
      temperature: 0.7,
      max_completion_tokens: 220,
    });
    expect(body.messages).toHaveLength(13);
    expect(body.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ content: "message-2" }),
      expect.objectContaining({ content: "message-13" }),
    ]));
  });

  it("removes em dashes from persona output and forbids them in persona prompts", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(completion("You finished the draft\u2014and kept it focused."))
      .mockResolvedValueOnce(completion("That sounds useful\u2014what comes next?"));
    vi.stubGlobal("fetch", fetchMock);

    const provider = createProvider();
    await expect(provider.generateReply(replyInput)).resolves.toBe(
      "You finished the draft, and kept it focused.",
    );
    await expect(provider.generateChatReply(chatInput)).resolves.toBe(
      "That sounds useful, what comes next?",
    );

    expect(JSON.stringify(requestBody(fetchMock, 0))).toContain("Never use em dashes.");
    expect(JSON.stringify(requestBody(fetchMock, 1))).toContain("Never use em dashes.");
  });
});

describe("getAIProvider", () => {
  it("defaults to split utility and chat models", async () => {
    vi.stubEnv("AI_API_KEY", "test-key");
    vi.stubEnv("AI_CHAT_MODEL", "");
    vi.stubEnv("AI_UTILITY_MODEL", "");
    vi.stubEnv("AI_CHAT_REASONING_EFFORT", "");
    vi.stubEnv("AI_MODEL", "");

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(completion("Utility reply"))
      .mockResolvedValueOnce(completion("Chat reply"));
    vi.stubGlobal("fetch", fetchMock);

    const provider = getAIProvider();
    await provider.generateReply(replyInput);
    await provider.generateChatReply(chatInput);

    expect(requestBody(fetchMock, 0)).toMatchObject({ model: "gpt-4o-mini" });
    expect(requestBody(fetchMock, 0)).not.toHaveProperty("reasoning_effort");
    expect(requestBody(fetchMock, 1)).toMatchObject({
      model: "gpt-5.6-luna",
      reasoning_effort: "low",
    });
  });

  it("uses purpose-specific environment overrides", async () => {
    vi.stubEnv("AI_API_KEY", "test-key");
    vi.stubEnv("AI_MODEL_ALLOWLIST", "chat-model,utility-model,legacy-model");
    vi.stubEnv("AI_CHAT_MODEL", "chat-model");
    vi.stubEnv("AI_UTILITY_MODEL", "utility-model");
    vi.stubEnv("AI_CHAT_REASONING_EFFORT", "high");
    vi.stubEnv("AI_MODEL", "legacy-model");

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(completion("Utility reply"))
      .mockResolvedValueOnce(completion("Chat reply"));
    vi.stubGlobal("fetch", fetchMock);

    const provider = getAIProvider();
    await provider.generateReply(replyInput);
    await provider.generateChatReply(chatInput);

    expect(requestBody(fetchMock, 0)).toMatchObject({ model: "utility-model" });
    expect(requestBody(fetchMock, 1)).toMatchObject({
      model: "chat-model",
      reasoning_effort: "high",
    });
  });

  it("stays disabled without an API key", () => {
    vi.stubEnv("AI_API_KEY", "");
    expect(getAIProvider()).toBeInstanceOf(DisabledAIProvider);
  });

  it("stays disabled when AI is switched off", () => {
    vi.stubEnv("AI_API_KEY", "test-key");
    vi.stubEnv("AI_ENABLED", "false");
    expect(getAIProvider()).toBeInstanceOf(DisabledAIProvider);
  });

  // An unvalidated model id was previously accepted and only surfaced on the
  // bill, so a typo or an expensive paste failed silently at runtime.
  it("refuses a model outside the allowlist", () => {
    vi.stubEnv("AI_API_KEY", "test-key");
    vi.stubEnv("AI_MODEL_ALLOWLIST", "gpt-4o-mini");
    vi.stubEnv("AI_CHAT_MODEL", "expensive-model-typo");
    expect(() => getAIProvider()).toThrow(/unsupported model/i);
  });
});
