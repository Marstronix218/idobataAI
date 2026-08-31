import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { createAdminClient, rpc, getAIProvider } = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  rpc: vi.fn(),
  getAIProvider: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
vi.mock("@/lib/ai/provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/provider")>()),
  getAIProvider,
}));

import { drainAIJobs } from "@/lib/ai/worker";

const RIKA = "11111111-1111-4111-8111-111111111111";
const VEX = "22222222-2222-4222-8222-222222222222";
const POST = "33333333-3333-4333-8333-333333333333";
const USER_REPLY = "44444444-4444-4444-8444-444444444444";
const ENGAGEMENT = "55555555-5555-4555-8555-555555555555";
const JOB = "66666666-6666-4666-8666-666666666666";
const LEASE = "77777777-7777-4777-8777-777777777777";

/** A supabase query builder that answers one queued result per `from()` call. */
function handler(data: unknown): ProxyHandler<Record<string | symbol, unknown>> {
  return {
    get(_target, property) {
      if (property === "then") return (resolve: (value: unknown) => void) => resolve({ data, error: null });
      if (property === "single" || property === "maybeSingle") return () => Promise.resolve({ data, error: null });
      return () => new Proxy({}, handler(data));
    },
  };
}

const persona = {
  id: RIKA,
  name: "Rika",
  personality: "Competitive gamer who teases the people she likes.",
  writing_style: "lowercase, clipped",
  safety_instructions: "Stay clearly fictional and age-appropriate.",
  fallback_replies: ["noted"],
  active: true,
  reply_style: "Teases first.",
  quote_style: "",
  tone_rules: ["Fond insults"],
  avoid_rules: ["Motivational speeches"],
};

const post = {
  id: POST,
  author_id: "author-1",
  content: "Finished economics assignment",
  content_status: "active",
  task_title: "Economics assignment",
  category: "Study",
  streak: 4,
  xp_earned: 30,
};

function threadContext(companionId = RIKA, companionName = "Rika") {
  return {
    post: {
      id: POST,
      author_id: "author-1",
      author_label: "Mina",
      kind: "human_completion",
      task_title: "Economics assignment",
      category: "Study",
      content: "Finished economics assignment",
      streak: 4,
      xp_earned: 30,
      created_at: "2026-08-30T00:00:00.000Z",
    },
    target_reply_id: USER_REPLY,
    root_reply_id: "root-reply",
    depth: 1,
    messages: [
      {
        reply_id: "root-reply", depth: 0, speaker: "persona", companion_id: companionId,
        companion_name: companionName, author_id: null, author_label: null,
        content: "finally, thought that assignment was gonna outlive you",
        created_at: "2026-08-30T00:00:00.000Z",
      },
      {
        reply_id: USER_REPLY, depth: 1, speaker: "user", companion_id: null,
        companion_name: null, author_id: "author-1", author_label: "Mina",
        content: "it almost did lol", created_at: "2026-08-30T00:01:00.000Z",
      },
    ],
  };
}

function engagement(overrides: Record<string, unknown> = {}) {
  return {
    id: ENGAGEMENT,
    post_id: POST,
    companion_id: RIKA,
    target_reply_id: USER_REPLY,
    kind: "reply",
    state: "processing",
    source: "human_reply_response",
    fallback_content: null,
    ...overrides,
  };
}

/**
 * Queues one result per table, in the order `performSocialAction` reads them:
 * the engagement, then the post/companion/target reply, then the generation
 * context (siblings, this persona's recent replies, its recent quotes).
 */
function stubDatabase({ action = engagement(), targetReply = { id: USER_REPLY, author_id: "author-1", content: "it almost did lol", content_status: "active" } } = {}) {
  const queues: Record<string, unknown[]> = {
    social_ai_engagements: [action],
    social_posts: [post, []],
    social_companions: [persona],
    social_replies: [targetReply, [], []],
  };
  const from = vi.fn((table: string) => new Proxy({}, handler(queues[table]?.shift() ?? null)));
  createAdminClient.mockReturnValue({ from, rpc });
  return { from };
}

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: JOB,
    job_type: "perform_social_action",
    lease_token: LEASE,
    attempts: 1,
    payload: { engagementId: ENGAGEMENT },
    ...overrides,
  };
}

let provider: {
  generateReply: ReturnType<typeof vi.fn>;
  generateThreadReply: ReturnType<typeof vi.fn>;
  generateQuoteRepost: ReturnType<typeof vi.fn>;
  generateChatReply: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
  provider = {
    generateReply: vi.fn().mockResolvedValue("area cleared"),
    generateThreadReply: vi.fn().mockResolvedValue("skill issue. but fine, you won."),
    generateQuoteRepost: vi.fn(),
    generateChatReply: vi.fn(),
  };
  getAIProvider.mockReturnValue(provider);
  rpc.mockImplementation((name: string, args: Record<string, unknown>) => {
    if (name === "claim_ai_jobs") return Promise.resolve({ data: [job()], error: null });
    if (name === "get_reply_thread_context") return Promise.resolve({ data: threadContext(), error: null });
    if (name === "finalize_social_action") return Promise.resolve({ data: true, error: null });
    if (name === "cancel_social_action") return Promise.resolve({ data: true, error: null });
    if (name === "fail_ai_job") return Promise.resolve({ data: true, error: null });
    return Promise.resolve({ data: null, error: new Error(`unexpected rpc ${name} ${JSON.stringify(args)}`) });
  });
});

describe("persona thread follow-up", () => {
  it("answers the conversation instead of reacting to the task again", async () => {
    stubDatabase();

    const results = await drainAIJobs(1);

    expect(provider.generateReply).not.toHaveBeenCalled();
    expect(provider.generateThreadReply).toHaveBeenCalledTimes(1);
    const input = provider.generateThreadReply.mock.calls[0][0];
    expect(input.companionName).toBe("Rika");
    expect(input.turns).toEqual([
      { role: "assistant", content: "finally, thought that assignment was gonna outlive you" },
      { role: "user", content: "it almost did lol" },
    ]);
    expect(input.post.completed_task).toBe("Economics assignment");
    expect(results).toEqual([{ id: JOB, status: "replied" }]);
  });

  it("loads only the branch it is answering", async () => {
    stubDatabase();

    await drainAIJobs(1);

    expect(rpc).toHaveBeenCalledWith("get_reply_thread_context", expect.objectContaining({
      p_reply_id: USER_REPLY,
    }));
  });

  it("publishes the follow-up under the reply that prompted it", async () => {
    stubDatabase();

    await drainAIJobs(1);

    expect(rpc).toHaveBeenCalledWith("finalize_social_action", {
      p_job_id: JOB,
      p_lease_token: LEASE,
      p_content: "skill issue. but fine, you won.",
    });
  });

  it("reacts to the task when the persona has never spoken in this branch", async () => {
    // Vex replying under Rika's thread must not inherit Rika's conversation.
    stubDatabase({ action: engagement({ companion_id: RIKA }) });
    rpc.mockImplementation((name: string) => {
      if (name === "claim_ai_jobs") return Promise.resolve({ data: [job()], error: null });
      if (name === "get_reply_thread_context") return Promise.resolve({ data: threadContext(VEX, "Vex"), error: null });
      if (name === "finalize_social_action") return Promise.resolve({ data: true, error: null });
      return Promise.resolve({ data: null, error: null });
    });

    await drainAIJobs(1);

    expect(provider.generateThreadReply).not.toHaveBeenCalled();
    expect(provider.generateReply).toHaveBeenCalledTimes(1);
  });

  it("stays silent rather than publishing a canned line when generation fails", async () => {
    stubDatabase();
    provider.generateThreadReply.mockRejectedValue(new Error("provider exploded"));

    const results = await drainAIJobs(1);

    expect(rpc).not.toHaveBeenCalledWith("finalize_social_action", expect.anything());
    expect(rpc).toHaveBeenCalledWith("cancel_social_action", expect.objectContaining({
      p_job_id: JOB,
      p_lease_token: LEASE,
      p_reason: expect.stringContaining("provider exploded"),
    }));
    expect(results).toEqual([{ id: JOB, status: "reply_cancelled" }]);
  });

  it("never publishes twice when the lease has already moved on", async () => {
    stubDatabase();
    rpc.mockImplementation((name: string) => {
      if (name === "claim_ai_jobs") return Promise.resolve({ data: [job()], error: null });
      if (name === "get_reply_thread_context") return Promise.resolve({ data: threadContext(), error: null });
      if (name === "finalize_social_action") return Promise.resolve({ data: false, error: null });
      if (name === "fail_ai_job") return Promise.resolve({ data: true, error: null });
      return Promise.resolve({ data: null, error: null });
    });

    const results = await drainAIJobs(1);

    expect(results).toEqual([{ id: JOB, status: "failed" }]);
    expect(rpc).toHaveBeenCalledWith("fail_ai_job", expect.objectContaining({ p_job_id: JOB }));
  });
});
