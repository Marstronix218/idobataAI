"use client";

import { createClient } from "@/lib/supabase/client";

type ApiErrorBody = { code?: string; message?: string; issues?: unknown };

export class ClientApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code = "request_error",
    public readonly issues?: unknown,
  ) {
    super(message);
    this.name = "ClientApiError";
  }
}

export const isPreviewMode = process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE === "true"
  && process.env.NODE_ENV !== "production";

export async function apiRequest<T>(
  path: string,
  init: RequestInit & { signal?: AbortSignal } = {},
): Promise<T> {
  if (isPreviewMode) throw new ClientApiError("Persistence is unavailable in Preview mode.", 503, "preview_mode");

  const supabase = createClient();
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw new ClientApiError(sessionError.message, 401, "session_error");
  if (!session) throw new ClientApiError("Please log in to continue.", 401, "unauthorized");

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${session.access_token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const response = await fetch(path, { ...init, headers });
  if (response.status === 204) return undefined as T;

  let payload: { data?: T; error?: ApiErrorBody } | null = null;
  try { payload = await response.json(); } catch { /* handled below */ }
  if (!response.ok || payload?.error) {
    const error = payload?.error;
    throw new ClientApiError(error?.message ?? `Request failed (${response.status}).`, response.status, error?.code, error?.issues);
  }
  if (!payload || !("data" in payload)) throw new ClientApiError("The server returned an invalid response.", response.status, "invalid_response");
  return payload.data as T;
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}
