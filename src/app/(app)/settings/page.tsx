import type { Metadata } from "next";
import { SettingsPanel } from "@/components/settings/settings-panel";
export const metadata: Metadata = { title: "Settings" };
export default function SettingsPage() { return <div className="app-page max-w-[980px]"><SettingsPanel /></div>; }
