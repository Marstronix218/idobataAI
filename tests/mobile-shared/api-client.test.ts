import { describe, expect, it, vi } from "vitest";

import { ApiClientError, createApiClient } from "../../packages/api-client/src";

function success(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fetchReturning(response: Response) {
  return vi.fn(async (input: string, init?: RequestInit) => {
    void input;
    void init;
    return response;
  });
}

const task = {
  id: "11111111-1111-4111-8111-111111111111",
  owner_id: "22222222-2222-4222-8222-222222222222",
  title: "Ship mobile",
  description: null,
  category: null,
  due_at: null,
  recurrence_rule: null,
  recurrence_instance_id: null,
  priority: 4 as const,
  visibility: "private" as const,
  status: "pending" as const,
  xp_earned: 0,
  completed_at: null,
  created_at: "2026-08-20T12:00:00.000Z",
  updated_at: "2026-08-20T12:00:00.000Z",
};

describe("mobile API client", () => {
  it("normalizes URLs and sends bearer authentication", async () => {
    const fetch = fetchReturning(success([task]));
    const client = createApiClient({
      baseUrl: "https://example.com///",
      getAccessToken: () => "access-token",
      fetch,
    });

    await client.listTasks({ status: "pending", category: "Home chores" });

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("https://example.com/api/tasks?status=pending&category=Home+chores");
    expect((init?.headers as Headers | undefined)?.get("Authorization")).toBe("Bearer access-token");
  });

  it("serializes task mutations as JSON", async () => {
    const fetch = fetchReturning(success(task, 201));
    const client = createApiClient({ baseUrl: "https://example.com", getAccessToken: () => "token", fetch });

    await client.createTask({ title: "Ship mobile" });

    const [, init] = fetch.mock.calls[0] ?? [];
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ title: "Ship mobile" }));
    expect((init?.headers as Headers).get("Content-Type")).toBe("application/json");
  });

  it("surfaces the structured API error envelope", async () => {
    const issues = [{ path: ["title"], message: "Required" }];
    const fetch = fetchReturning(new Response(JSON.stringify({
      error: { code: "validation_error", message: "Request validation failed.", issues, requestId: "req-1" },
    }), { status: 422 }));
    const client = createApiClient({ baseUrl: "https://example.com", getAccessToken: () => "token", fetch });

    const error = await client.createTask({ title: "Task" }).catch((caught) => caught);

    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({
      status: 422,
      code: "validation_error",
      issues,
      requestId: "req-1",
      message: "Request validation failed.",
    });
  });

  it("returns undefined for a 204 response without parsing JSON", async () => {
    const fetch = fetchReturning(new Response(null, { status: 204 }));
    const client = createApiClient({ baseUrl: "https://example.com", getAccessToken: () => "token", fetch });

    await expect(client.request<void>("/api/account", { method: "DELETE" })).resolves.toBeUndefined();
  });

  it("refreshes a rejected access token exactly once", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { code: "unauthorized", message: "Access token expired." },
      }), { status: 401 }))
      .mockResolvedValueOnce(success([task]));
    const refreshAccessToken = vi.fn(async () => "fresh-token");
    const client = createApiClient({
      baseUrl: "https://example.com",
      getAccessToken: () => "expired-token",
      refreshAccessToken,
      fetch,
    });

    await expect(client.listTasks()).resolves.toEqual([task]);
    expect(refreshAccessToken).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledTimes(2);
    const [, retryInit] = fetch.mock.calls[1] ?? [];
    expect((retryInit?.headers as Headers | undefined)?.get("Authorization")).toBe("Bearer fresh-token");
  });

  it("reports a rejected session after refresh cannot recover it", async () => {
    const fetch = fetchReturning(new Response(JSON.stringify({
      error: { code: "unauthorized", message: "Access token expired." },
    }), { status: 401 }));
    const onUnauthorized = vi.fn();
    const client = createApiClient({
      baseUrl: "https://example.com",
      getAccessToken: () => "expired-token",
      refreshAccessToken: async () => null,
      onUnauthorized,
      fetch,
    });

    await expect(client.listTasks()).rejects.toMatchObject({ status: 401, code: "unauthorized" });
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("aborts and reports requests that exceed the timeout", async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        void _url;
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      }));
      const client = createApiClient({
        baseUrl: "https://example.com",
        getAccessToken: () => "token",
        fetch,
        timeoutMs: 25,
      });

      const rejection = expect(client.listTasks()).rejects.toMatchObject({ status: 408, code: "timeout" });
      await vi.advanceTimersByTimeAsync(25);

      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });
});
