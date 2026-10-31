import { AppShell } from "@/components/layout/app-shell";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getConsistencySummary } from "@/lib/coach/consistency";
import { needsCoachOnboarding } from "@/lib/coach/profile";
import { getFlags } from "@/lib/flags";
import { PATHNAME_HEADER, isSettingsPath } from "@/lib/request-path";
import { hasPublicSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const previewMode = process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE === "true" && process.env.NODE_ENV !== "production";
  const flags = await getFlags();
  let consistencyDays: number | null = null;
  if (!previewMode && hasPublicSupabaseEnv()) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect("/login");
    if (flags.pivotA) {
      // Under Pivot A the app needs a verified age, a character and a time zone first.
      // - /onboarding sits outside this layout, so this cannot loop.
      // - Settings (sign-out, account deletion) is never redirected.
      // - With no character to choose the user gets in rather than being locked
      //   out (the age step needs no cast).
      // - A failed read sends the user to onboarding: the age is then unknown,
      //   and the age gate fails closed (PLAN D6).
      // The shell shows consistency days in place of the streak; a failed read shows none.
      const onSettings = isSettingsPath((await headers()).get(PATHNAME_HEADER) ?? "");
      const [onboarding, consistency] = await Promise.all([
        onSettings ? false : needsCoachOnboarding(supabase, user.id).catch(() => true),
        getConsistencySummary(user.id).catch(() => null),
      ]);
      if (onboarding) redirect("/onboarding");
      consistencyDays = consistency?.totalDays ?? null;
    }
  }
  return <AppShell flags={flags} consistencyDays={consistencyDays}>{children}</AppShell>;
}
