import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

const DEFAULT_DESTINATION = "/feed";

export function safeDestination(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") && !value.includes("\\")
    ? value
    : DEFAULT_DESTINATION;
}

function privateRedirect(request: NextRequest, destination: string) {
  const configuredOrigin = process.env.APP_URL;
  let origin = request.nextUrl.origin;
  if (configuredOrigin) {
    try { origin = new URL(configuredOrigin).origin; } catch { /* fall back to the request origin outside configured production */ }
  }
  const response = NextResponse.redirect(new URL(destination, origin));
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function GET(request: NextRequest) {
  const previewMode = process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE === "true"
    && process.env.NODE_ENV !== "production";
  if (previewMode) return privateRedirect(request, DEFAULT_DESTINATION);

  const code = request.nextUrl.searchParams.get("code");
  const destination = safeDestination(request.nextUrl.searchParams.get("next"));

  if (code) {
    try {
      const { error } = await (await createClient()).auth.exchangeCodeForSession(code);
      if (!error) return privateRedirect(request, destination);
    } catch {
      // Invalid and expired callbacks share the same non-sensitive failure path.
    }
  }

  return privateRedirect(request, "/login?error=auth_callback");
}
