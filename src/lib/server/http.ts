import { ZodError, type ZodType } from "zod";
import { AuthenticationError, authenticateBearer } from "@/lib/supabase/bearer";

export class ApiError extends Error {
  constructor(public status: number, message: string, public code = "request_error") { super(message); }
}

export const ok = (data: unknown, init?: ResponseInit) => Response.json({ data }, init);
export const noContent = () => new Response(null, { status: 204 });

export async function parseJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 16_384) throw new ApiError(413, "Request body is too large.", "payload_too_large");
  let body: unknown;
  try { body = await request.json(); } catch { throw new ApiError(400, "Invalid JSON body.", "invalid_json"); }
  return schema.parse(body);
}

export async function withApi(handler: () => Promise<Response>) {
  try { return await handler(); }
  catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: { code: "unauthorized", message: error.message } }, { status: 401 });
    if (error instanceof ApiError) return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    if (error instanceof ZodError) return Response.json({ error: { code: "validation_error", message: "Request validation failed.", issues: error.issues } }, { status: 422 });
    console.error(error);
    return Response.json({ error: { code: "internal_error", message: "Unexpected server error." } }, { status: 500 });
  }
}

export async function authed(request: Request) {
  return authenticateBearer(request);
}

export function assertDatabase<T>(result: { data: T; error: { message: string; code?: string } | null }, notFound = false): T {
  if (result.error) {
    if (notFound && result.error.code === "PGRST116") throw new ApiError(404, "Resource not found.", "not_found");
    throw new ApiError(400, result.error.message, result.error.code ?? "database_error");
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
