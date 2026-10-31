import { AppShell } from "@/components/layout/app-shell";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { needsCoachOnboarding } from "@/lib/coach/profile";
import { getFlags } from "@/lib/flags";
import { PATHNAME_HEADER, isSettingsPath } from "@/lib/request-path";
import { hasPublicSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const previewMode = process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE === "true" && process.env.NODE_ENV !== "production";
  const flags = await getFlags();
  if (!previewMode && hasPublicSupabaseEnv()) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect("/login");
    // Under Pivot A the app needs a character and a time zone first.
    // - /onboarding sits outside this layout, so this cannot loop.
    // - Settings (sign-out, account deletion) is never redirected.
    // - With no character to choose, or a failed read, the user gets in rather
    //   than being locked out.
    if (flags.pivotA && !isSettingsPath((await headers()).get(PATHNAME_HEADER) ?? "")) {
      const onboarding = await needsCoachOnboarding(supabase, user.id).catch(() => false);
      if (onboarding) redirect("/onboarding");
    }
  }
  return <AppShell flags={flags}>{children}</AppShell>;
}
