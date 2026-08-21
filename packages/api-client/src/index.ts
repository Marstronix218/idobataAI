import {
  taskSchema,
  type ApiEnvelope,
  type ApiErrorBody,
  type TaskCreateInput,
  type TaskStatus,
  type TaskUpdateInput,
} from "@idobata/contracts";

export const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;

export type ApiFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
  baseUrl: string;
  getAccessToken: () => string | null | Promise<string | null>;
  refreshAccessToken?: () => string | null | Promise<string | null>;
  onUnauthorized?: () => void | Promise<void>;
  fetch?: ApiFetch;
  timeoutMs?: number;
}

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  headers?: HeadersInit;
  signal?: AbortSignal;
}

export interface TaskListFilters {
  status?: TaskStatus;
  category?: string;
}

export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code = "request_error",
    public readonly issues?: unknown,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

function normalizeBaseUrl(baseUrl: string) {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  if (!normalized) throw new TypeError("baseUrl is required.");
  return normalized;
}

function isApiFailure<T>(payload: ApiEnvelope<T>): payload is { error: ApiErrorBody } {
  return "error" in payload;
}

export function createApiClient(options: ApiClientOptions) {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

  if (!fetchImplementation) throw new TypeError("A fetch implementation is required.");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError("timeoutMs must be greater than zero.");

  async function requestWithToken<T>(
    path: string,
    requestOptions: ApiRequestOptions,
    tokenOverride: string | null,
    mayRefresh: boolean,
  ): Promise<T> {
    const token = tokenOverride ?? await options.getAccessToken();
    if (!token) throw new ApiClientError("Please log in to continue.", 401, "unauthorized");

    const headers = new Headers(requestOptions.headers);
    headers.set("Authorization", `Bearer ${token}`);
    if (requestOptions.body !== undefined && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const controller = new AbortController();
    let timedOut = false;
    const abortForCaller = () => controller.abort(requestOptions.signal?.reason);
    if (requestOptions.signal?.aborted) abortForCaller();
    else requestOptions.signal?.addEventListener("abort", abortForCaller, { once: true });

    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    let response: Response;
    try {
      response = await fetchImplementation(`${baseUrl}/${path.replace(/^\/+/, "")}`, {
        method: requestOptions.method ?? "GET",
        headers,
        body: requestOptions.body === undefined ? undefined : JSON.stringify(requestOptions.body),
        signal: controller.signal,
      });
    } catch (error) {
      if (timedOut) {
        throw new ApiClientError("That took longer than expected. Please try again.", 408, "timeout");
      }
      if (requestOptions.signal?.aborted) throw error;
      throw new ApiClientError("You appear to be offline. Check your connection and try again.", 0, "network_error");
    } finally {
      clearTimeout(timeout);
      requestOptions.signal?.removeEventListener("abort", abortForCaller);
    }

    if (response.status === 204) return undefined as T;

    const refreshAccessToken = options.refreshAccessToken;
    if (response.status === 401 && mayRefresh && refreshAccessToken) {
      const refreshedToken = await Promise.resolve(refreshAccessToken()).catch(() => null);
      if (refreshedToken) {
        return requestWithToken(path, requestOptions, refreshedToken, false);
      }
    }

    let payload: ApiEnvelope<T> | null = null;
    try {
      payload = await response.json() as ApiEnvelope<T>;
    } catch {
      // Invalid or empty non-204 responses are handled below.
    }

    if (!response.ok || (payload && isApiFailure(payload))) {
      const error = payload && isApiFailure(payload) ? payload.error : undefined;
      if (response.status === 401) await options.onUnauthorized?.();
      throw new ApiClientError(
        error?.message ?? `Request failed (${response.status}).`,
        response.status,
        error?.code,
        error?.issues,
        error?.requestId,
      );
    }

    if (!payload || !("data" in payload)) {
      throw new ApiClientError("The server returned an invalid response.", response.status, "invalid_response");
    }
    return payload.data;
  }

  function request<T>(path: string, requestOptions: ApiRequestOptions = {}) {
    return requestWithToken<T>(path, requestOptions, null, true);
  }

  function validateTask(value: unknown, status: number) {
    const parsed = taskSchema.safeParse(value);
    if (!parsed.success) {
      throw new ApiClientError(
        "The server returned an invalid task.",
        status,
        "invalid_response",
        parsed.error.issues,
      );
    }
    return parsed.data;
  }

  function listTasks(filters: TaskListFilters = {}) {
    const query = new URLSearchParams();
    if (filters.status) query.set("status", filters.status);
    if (filters.category) query.set("category", filters.category);
    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    return request<unknown>(`/api/tasks${suffix}`).then((value) => {
      const parsed = taskSchema.array().safeParse(value);
      if (!parsed.success) {
        throw new ApiClientError(
          "The server returned an invalid task list.",
          200,
          "invalid_response",
          parsed.error.issues,
        );
      }
      return parsed.data;
    });
  }

  function createTask(input: TaskCreateInput) {
    return request<unknown>("/api/tasks", { method: "POST", body: input })
      .then((value) => validateTask(value, 201));
  }

  function updateTask(id: string, input: TaskUpdateInput) {
    return request<unknown>(`/api/tasks/${encodeURIComponent(id)}`, { method: "PATCH", body: input })
      .then((value) => validateTask(value, 200));
  }

  return { request, listTasks, createTask, updateTask };
}

export type ApiClient = ReturnType<typeof createApiClient>;
