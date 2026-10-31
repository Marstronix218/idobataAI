import { ApiError } from "./http";

/** 415 unless the body is declared as JSON (`application/json`, any parameters). */
export function assertJsonContentType(request: Request) {
  const type = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (type !== "application/json") throw new ApiError(415, "Send the request body as JSON.", "unsupported_media_type");
}

/**
 * 403 for a browser request from another site, judged by the headers browsers
 * set and pages cannot: `Sec-Fetch-Site: cross-site`, or an `Origin` that is
 * not this app's. Requests without them (the mobile app, server-side callers)
 * pass; for public routes the rate limit covers those.
 */
export function assertNotCrossSite(request: Request, appUrl: string | undefined = process.env.APP_URL) {
  const forbidden = () => new ApiError(403, "Cross-site requests are not allowed.", "cross_site_request");
  if (request.headers.get("sec-fetch-site")?.trim().toLowerCase() === "cross-site") throw forbidden();
  const origin = request.headers.get("origin");
  if (origin === null) return;
  const allowed = new Set([new URL(request.url).origin]);
  if (appUrl) {
    try { allowed.add(new URL(appUrl).origin); } catch { /* an invalid APP_URL adds nothing */ }
  }
  if (!allowed.has(origin.trim())) throw forbidden();
}
