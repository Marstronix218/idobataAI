import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { PivotOnboarding } from "@/components/onboarding/pivot-onboarding";
import { listSelectableCharacters } from "@/lib/coach/characters";
import { EMPTY_COACH_PROFILE, readCoachProfile } from "@/lib/coach/profile";
import { getFlags } from "@/lib/flags";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Set up your space" };

export default async function OnboardingPage() {
  // The flags pick the flow, so render per request: with Pivot A off the page
  // touches no cookies, and the build would otherwise freeze the legacy flow.
  await connection();
  const flags = await getFlags();
  if (!flags.pivotA) return <OnboardingFlow />;

  // src/proxy.ts already sends signed-out visitors to /login; this is the
  // fallback for a session that expired in between.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/onboarding");
  // The app sends users here when their profile cannot be read, so a failed
  // read shows the age step (an unknown age is unverified) rather than an
  // error page; with no cast, a passed age step goes straight to tasks.
  const [characters, profile] = await Promise.all([
    listSelectableCharacters(supabase, user.id).catch(() => []),
    readCoachProfile(supabase, user.id).catch(() => EMPTY_COACH_PROFILE),
  ]);
  return <PivotOnboarding characters={characters} ageVerified={Boolean(profile.age_verified_at)} selectedCharacterId={profile.selected_character_id} savedTimezone={profile.timezone} />;
}
