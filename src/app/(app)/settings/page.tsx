import type { Metadata } from "next";
import { AppTabLayout } from "@/components/layout/app-tab-layout";
import { SettingsPanel } from "@/components/settings/settings-panel";
export const metadata: Metadata = { title: "Settings" };
export default function SettingsPage() { return <AppTabLayout padded contextRail={false}><SettingsPanel /></AppTabLayout>; }
