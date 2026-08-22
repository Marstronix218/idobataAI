import type { Metadata } from "next";
import { CompanionDirectory } from "@/components/companions/companion-directory";
import { AppTabLayout } from "@/components/layout/app-tab-layout";
export const metadata: Metadata = { title: "AI Personas" };
export default function AIPersonasPage() {
  return <AppTabLayout padded contextRail={false}><CompanionDirectory /></AppTabLayout>;
}
