import { ZodError, type ZodType } from "zod";
import { AuthenticationError, authenticateBearer } from "@/lib/supabase/bearer";

export class ApiError extends Error {
  constructor(public status: number, message: string, public code = "request_error") { super(message); }
}

export const ok = (data: unknown, init?: ResponseInit) => Response.json({ data }, init);
export const noContent = () => new Response(null, { status: 204 });

const MAX_BODY_BYTES = 16_384;

export async function parseJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  const header = request.headers.get("content-length");
  const length = Number(header ?? Number.NaN);
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) throw new ApiError(413, "Request body is too large.", "payload_too_large");
  // A chunked request carries no content-length, so the header check alone was
  // bypassable and `request.json()` would buffer an unbounded body. Measure the
  // bytes actually received instead of trusting what was advertised.
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) throw new ApiError(413, "Request body is too large.", "payload_too_large");
  let body: unknown;
  try { body = JSON.parse(raw); } catch { throw new ApiError(400, "Invalid JSON body.", "invalid_json"); }
  return schema.parse(body);
}

/**
 * Structured, single-line failure logging. `console.error(error)` was the only
 * error sink in the codebase, which meant a route that began failing after a
 * deploy failed silently. This emits one JSON line per failure that a log drain
 * or an error reporter can consume without changing any call site, and returns
 * the request id to the client so a support report is traceable.
 *
 * The raw message is deliberately logged rather than returned: Postgres error
 * text names tables, columns, constraints and policies.
 */
function logServerError(requestId: string, error: unknown) {
  const detail = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { message: String(error) };
  console.error(JSON.stringify({ level: "error", scope: "api", requestId, ...detail }));
}

export async function withApi(handler: () => Promise<Response>) {
  try { return await handler(); }
  catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: { code: "unauthorized", message: error.message } }, { status: 401 });
    if (error instanceof ApiError) return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    if (error instanceof ZodError) return Response.json({ error: { code: "validation_error", message: "Request validation failed.", issues: error.issues } }, { status: 422 });
    const requestId = crypto.randomUUID();
    logServerError(requestId, error);
    return Response.json({ error: { code: "internal_error", message: "Unexpected server error.", requestId } }, { status: 500 });
  }
}

export async function authed(request: Request) {
  return authenticateBearer(request);
}

// Postgres/PostgREST messages used to be forwarded to the client verbatim, so
// users saw text like `new row violates row-level security policy for table
// "social_posts"`. That reads as a broken prototype and hands out a map of the
// schema and of which policy refused the request.
const DATABASE_MESSAGES: Record<string, { status: number; code: string; message: string }> = {
  "23505": { status: 409, code: "already_exists", message: "That already exists." },
  "23503": { status: 400, code: "invalid_reference", message: "That refers to something which no longer exists." },
  "23514": { status: 400, code: "invalid_value", message: "That value is not allowed." },
  "23502": { status: 400, code: "missing_value", message: "A required value is missing." },
  "42501": { status: 403, code: "forbidden", message: "You do not have access to that." },
  "22023": { status: 400, code: "invalid_value", message: "That value is not allowed." },
  "P0002": { status: 404, code: "not_found", message: "Resource not found." },
  "PGRST301": { status: 401, code: "unauthorized", message: "Your session has expired. Please sign in again." },
};

// P0001 is the default for a bare `raise exception`, so it covers both the
// rate-limit guards and a handful of terse internal assertions. The guards
// carry meaning worth keeping; everything else stays generic.
const RAISED_MESSAGES: Array<{ match: RegExp; status: number; code: string; message: string }> = [
  { match: /rate limit exceeded/i, status: 429, code: "rate_limited", message: "You are doing that a little too quickly. Try again shortly." },
  { match: /cannot message yourself/i, status: 400, code: "invalid_recipient", message: "You cannot start a chat with yourself." },
  { match: /message must be between/i, status: 400, code: "invalid_message", message: "A message must be between 1 and 2000 characters." },
];

// Connectivity and timeout classes are a server-side outage, not a client
// mistake. Returning 400 for them made an outage indistinguishable from bad
// input in the platform's own error charts.
const UNAVAILABLE_CODES = new Set(["08000", "08003", "08006", "08001", "08004", "53300", "57P01", "57P03", "XX000", "PGRST000"]);

export function assertDatabase<T>(result: { data: T; error: { message: string; code?: string } | null }, notFound = false): T {
  if (result.error) {
    const code = result.error.code ?? "";
    if (notFound && code === "PGRST116") throw new ApiError(404, "Resource not found.", "not_found");
    if (UNAVAILABLE_CODES.has(code) || code.startsWith("57") || code.startsWith("08")) {
      throw new ApiError(503, "The service is temporarily unavailable. Please try again shortly.", "unavailable");
    }
    const raised = RAISED_MESSAGES.find((candidate) => candidate.match.test(result.error?.message ?? ""));
    if (raised) throw new ApiError(raised.status, raised.message, raised.code);
    const mapped = DATABASE_MESSAGES[code];
    if (mapped) throw new ApiError(mapped.status, mapped.message, mapped.code);
    // Unmapped codes keep their detail in the logs, never in the response.
    console.error(JSON.stringify({ level: "error", scope: "database", code, message: result.error.message }));
    throw new ApiError(400, "That request could not be completed.", "database_error");
  }
  return result.data;
}

export function parseCursor(value: string | null) {
  if (!value) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { created_at?: string; id?: string };
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!decoded.created_at || !decoded.id || !uuid.test(decoded.id) || Number.isNaN(Date.parse(decoded.created_at))) throw new Error();
    return { created_at: new Date(decoded.created_at).toISOString(), id: decoded.id.toLowerCase() };
  } catch { throw new ApiError(400, "Invalid pagination cursor.", "invalid_cursor"); }
}

export function makeCursor(row: { created_at: string; id: string }) {
  return Buffer.from(JSON.stringify({ created_at: row.created_at, id: row.id }), "utf8").toString("base64url");
}
