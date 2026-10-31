import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppTabLayout } from "@/components/layout/app-tab-layout";
import { TaskBoard } from "@/components/tasks/task-board";
import { needsCoachOnboarding } from "@/lib/coach/profile";
import { getFlags } from "@/lib/flags";
import { createClient } from "@/lib/supabase/server";
export const metadata: Metadata = { title: "Your Tasks" };
export default async function TasksPage() {
  const flags = await getFlags();
  // The (app) layout's onboarding check does not re-run on client navigation,
  // but pages do: without this, entering via /settings and tapping Tasks would
  // skip onboarding. A failed read lets the user in, as in the layout.
  if (flags.pivotA) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user && await needsCoachOnboarding(supabase, user.id).catch(() => false)) redirect("/onboarding");
  }
  return <AppTabLayout padded contextRail={false}><TaskBoard shareWin={flags.shareWin} pivotA={flags.pivotA} /></AppTabLayout>;
}
