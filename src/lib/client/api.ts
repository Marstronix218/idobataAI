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

const REQUEST_TIMEOUT_MS = 20_000;

/**
 * An expired session used to surface as the string "Please log in to continue."
 * rendered as one line of grey body text on a fully-working-looking app where
 * every action silently failed. Send the user somewhere they can recover from
 * instead, preserving where they were, and only once per page.
 */
let redirectingToLogin = false;

function recoverSession(): never {
  if (typeof window !== "undefined" && !redirectingToLogin && !window.location.pathname.startsWith("/login")) {
    redirectingToLogin = true;
    const next = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
    // A full document load rather than a client navigation, deliberately: the
    // session is gone, so every cached client component holds stale
    // authenticated state that a soft navigation would preserve. This module is
    // also not a component, so no router is available here.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`/login?next=${next}`);
  }
  throw new ClientApiError("Your session has expired. Redirecting you to sign in…", 401, "unauthorized");
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit & { signal?: AbortSignal } = {},
): Promise<T> {
  if (isPreviewMode) throw new ClientApiError("Persistence is unavailable in Preview mode.", 503, "preview_mode");

  const supabase = createClient();
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw new ClientApiError(sessionError.message, 401, "session_error");
  if (!session) recoverSession();

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${session.access_token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  // Without a timeout a hung request left the calling component's busy flag set
  // forever: buttons disabled, no message, and no way to cancel.
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;

  let response: Response;
  try {
    response = await fetch(path, { ...init, headers, signal });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new ClientApiError("That took longer than expected. Please try again.", 408, "timeout");
    }
    throw new ClientApiError("You appear to be offline. Check your connection and try again.", 0, "network_error");
  }
  if (response.status === 204) return undefined as T;

  let payload: { data?: T; error?: ApiErrorBody } | null = null;
  try { payload = await response.json(); } catch { /* handled below */ }
  if (response.status === 401) recoverSession();
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
