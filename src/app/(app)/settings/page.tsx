import type { Metadata } from "next";
import { AppTabLayout } from "@/components/layout/app-tab-layout";
import { SettingsPanel } from "@/components/settings/settings-panel";
import { getFlags } from "@/lib/flags";
export const metadata: Metadata = { title: "Settings" };
export default async function SettingsPage() {
  const flags = await getFlags();
  return <AppTabLayout padded contextRail={false}><SettingsPanel flags={flags} /></AppTabLayout>;
}
