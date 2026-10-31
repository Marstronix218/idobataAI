import { NextResponse, type NextRequest } from "next/server";
import { needsCoachOnboarding } from "@/lib/coach/profile";
import { getFlags } from "@/lib/flags";
import { createClient } from "@/lib/supabase/server";

function privateRedirect(request: NextRequest, destination: string) {
  const response = NextResponse.redirect(new URL(destination, request.nextUrl.origin));
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

/**
 * Where a signed-in user lands after login, the auth callback and the
 * installed app icon. Today's product goes to the feed. Under Pivot A the feed
 * may be switched off, so users go to onboarding until they have a character
 * and a time zone, and to their tasks after that (or straight away when there
 * is no character to choose).
 */
export async function GET(request: NextRequest) {
  const flags = await getFlags();
  if (!flags.pivotA) return privateRedirect(request, "/feed");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return privateRedirect(request, "/login?next=%2Fhome");
  // A failed read goes to tasks; the app layout checks onboarding again there.
  const onboarding = await needsCoachOnboarding(supabase, user.id).catch(() => false);
  return privateRedirect(request, onboarding ? "/onboarding" : "/tasks");
}
