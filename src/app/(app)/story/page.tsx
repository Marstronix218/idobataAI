import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { StoryList } from "@/components/coach/story-list";
import { AppTabLayout } from "@/components/layout/app-tab-layout";
import { needsCoachOnboarding } from "@/lib/coach/profile";
import { requirePageGate } from "@/lib/flags/route-gates";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Story" };

/** The selected character's chapters. They unlock by consistency days, never by time in the app. */
export default async function StoryPage() {
  await requirePageGate("pivot_a");
  // As on /tasks: the (app) layout's onboarding check does not re-run on client
  // navigation, but pages do. A failed read goes to onboarding (the age gate fails closed).
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user && await needsCoachOnboarding(supabase, user.id).catch(() => true)) redirect("/onboarding");
  return <AppTabLayout padded contextRail={false}><StoryList /></AppTabLayout>;
}
