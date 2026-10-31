import type { Metadata } from "next";
import { CompanionDirectory } from "@/components/companions/companion-directory";
import { AppTabLayout } from "@/components/layout/app-tab-layout";
import { requirePageGate } from "@/lib/flags/route-gates";
export const metadata: Metadata = { title: "AI Personas" };
export default async function AIPersonasPage() {
  await requirePageGate("persona_chat");
  return <AppTabLayout padded contextRail={false}><CompanionDirectory /></AppTabLayout>;
}
