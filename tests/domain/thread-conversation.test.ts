import { describe, expect, it } from "vitest";

import {
  THREAD_CONVERSATION_LIMITS,
  awaitsPersonaThreadReply,
  buildThreadConversation,
  resolveThreadConversationLimits,
  threadPostSummary,
  type ThreadContextMessage,
  type ThreadConversationContext,
} from "@/lib/domain/thread-conversation";

const RIKA = "companion-rika";
const VEX = "companion-vex";

function personaTurn(depth: number, content: string, companionId = RIKA, companionName = "Rika"): ThreadContextMessage {
  return {
    reply_id: `reply-${depth}`,
    depth,
    speaker: "persona",
    companion_id: companionId,
    companion_name: companionName,
    author_id: null,
    author_label: null,
    content,
    created_at: `2026-08-30T00:0${depth}:00.000Z`,
  };
}

function humanTurn(depth: number, content: string, authorLabel = "Mina"): ThreadContextMessage {
  return {
    reply_id: `reply-${depth}`,
    depth,
    speaker: "user",
    companion_id: null,
    companion_name: null,
    author_id: `author-${authorLabel}`,
    author_label: authorLabel,
    content,
    created_at: `2026-08-30T00:0${depth}:00.000Z`,
  };
}

function context(messages: ThreadContextMessage[]): ThreadConversationContext {
  return {
    post: {
      id: "post-1",
      author_id: "author-Mina",
      author_label: "Mina",
      kind: "human_completion",
      task_title: "Economics assignment",
      category: "Study",
      content: "Finished economics assignment",
      streak: 4,
      xp_earned: 30,
      created_at: "2026-08-30T00:00:00.000Z",
    },
    target_reply_id: messages.at(-1)?.reply_id ?? "reply-0",
    root_reply_id: messages[0]?.reply_id ?? null,
    depth: messages.at(-1)?.depth ?? 0,
    messages,
  };
}

describe("buildThreadConversation", () => {
  it("reads the branch as a dialogue, with this persona's own words as its own turns", () => {
    const conversation = buildThreadConversation(context([
      personaTurn(0, "finally, thought that assignment was gonna outlive you"),
      humanTurn(1, "it almost did lol"),
    ]), RIKA);

    expect(conversation.turns).toEqual([
      { role: "assistant", content: "finally, thought that assignment was gonna outlive you" },
      { role: "user", content: "it almost did lol" },
    ]);
    expect(conversation.personaTurns).toBe(1);
    expect(conversation.conversational).toBe(true);
    expect(conversation.latestMessage?.content).toBe("it almost did lol");
  });

  it("orders turns by thread position rather than by the order rows arrived", () => {
    const conversation = buildThreadConversation(context([
      humanTurn(3, "what did you even do today"),
      personaTurn(0, "finally"),
      humanTurn(1, "it almost did"),
      personaTurn(2, "skill issue"),
    ]), RIKA);

    expect(conversation.turns.map((turn) => turn.content))
      .toEqual(["finally", "it almost did", "skill issue", "what did you even do today"]);
  });

  it("stays a task reaction when this persona has never spoken in the branch", () => {
    // Vex's job must not inherit Rika's conversation just because both replies
    // hang off the same post.
    const conversation = buildThreadConversation(context([
      personaTurn(0, "finally", RIKA, "Rika"),
      humanTurn(1, "it almost did"),
    ]), VEX);

    expect(conversation.conversational).toBe(false);
    expect(conversation.personaTurns).toBe(0);
  });

  it("keeps only the most recent turns, and always the one being answered", () => {
    const messages = Array.from({ length: 12 }, (_, index) => index % 2 === 0
      ? personaTurn(index, `persona ${index}`)
      : humanTurn(index, `human ${index}`));

    const conversation = buildThreadConversation(context(messages), RIKA, {
      ...THREAD_CONVERSATION_LIMITS,
      contextMessages: 4,
    });

    expect(conversation.turns).toHaveLength(4);
    expect(conversation.turns.at(-1)).toEqual({ role: "user", content: "human 11" });
  });

  it("trims a long turn instead of letting it crowd out the rest of the exchange", () => {
    const conversation = buildThreadConversation(context([
      personaTurn(0, "finally"),
      humanTurn(1, "x".repeat(900)),
    ]), RIKA, { ...THREAD_CONVERSATION_LIMITS, maxMessageCharacters: 100 });

    expect(conversation.turns.at(-1)?.content).toHaveLength(100);
  });

  it("names the speakers once more than one other voice is in the branch", () => {
    const conversation = buildThreadConversation(context([
      personaTurn(0, "finally"),
      humanTurn(1, "it almost did", "Mina"),
      humanTurn(2, "same honestly", "Kenji"),
    ]), RIKA);

    expect(conversation.turns).toEqual([
      { role: "assistant", content: "finally" },
      { role: "user", content: "Mina: it almost did" },
      { role: "user", content: "Kenji: same honestly" },
    ]);
  });

  it("leaves a one-to-one exchange unlabelled", () => {
    const conversation = buildThreadConversation(context([
      personaTurn(0, "finally"),
      humanTurn(1, "it almost did"),
      personaTurn(2, "skill issue"),
      humanTurn(3, "rude"),
    ]), RIKA);

    expect(conversation.turns.every((turn) => !turn.content.includes(":"))).toBe(true);
  });
});

describe("threadPostSummary", () => {
  it("carries the completed task as background, trimmed", () => {
    const summary = threadPostSummary(context([personaTurn(0, "finally")]), {
      ...THREAD_CONVERSATION_LIMITS,
      maxPostCharacters: 10,
    });

    expect(summary).toEqual({
      completed_task: "Economics assignment",
      user_category_label: "Study",
      completion_note: "Finished e",
      streak_days: 4,
      author_label: "Mina",
    });
  });
});

describe("resolveThreadConversationLimits", () => {
  it("defaults to a focused window", () => {
    expect(resolveThreadConversationLimits({})).toEqual(THREAD_CONVERSATION_LIMITS);
  });

  it("is configurable, within bounds that keep one reply from costing a chat's worth of context", () => {
    expect(resolveThreadConversationLimits({ AI_THREAD_CONTEXT_MESSAGES: "6" }).contextMessages).toBe(6);
    expect(resolveThreadConversationLimits({ AI_THREAD_CONTEXT_MESSAGES: "500" }).contextMessages).toBe(20);
    expect(resolveThreadConversationLimits({ AI_THREAD_CONTEXT_MESSAGES: "0" }).contextMessages).toBe(2);
    expect(resolveThreadConversationLimits({ AI_THREAD_CONTEXT_MESSAGES: "not a number" }).contextMessages)
      .toBe(THREAD_CONVERSATION_LIMITS.contextMessages);
  });
});

describe("awaitsPersonaThreadReply", () => {
  it("expects an answer only when a human answers a persona directly", () => {
    expect(awaitsPersonaThreadReply({ parentIsPersona: true, authoredByViewer: true })).toBe(true);
    expect(awaitsPersonaThreadReply({ parentIsPersona: false, authoredByViewer: true })).toBe(false);
    expect(awaitsPersonaThreadReply({ parentIsPersona: true, authoredByViewer: false })).toBe(false);
    expect(awaitsPersonaThreadReply({ parentIsPersona: true, authoredByViewer: true, parentCompanionMuted: true })).toBe(false);
  });
});
