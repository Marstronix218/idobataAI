import type { Metadata } from "next";
import { CompanionDirectory } from "@/components/companions/companion-directory";
import { AppTabLayout } from "@/components/layout/app-tab-layout";
export const metadata: Metadata = { title: "AI followers" };
export default function CompanionsPage() { return <AppTabLayout padded><CompanionDirectory /></AppTabLayout>; }
