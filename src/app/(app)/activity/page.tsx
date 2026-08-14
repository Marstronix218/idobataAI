import type { Metadata } from "next";
import { ActivityList } from "@/components/activity/activity-list";
import { AppTabLayout } from "@/components/layout/app-tab-layout";
export const metadata: Metadata = { title: "Notifications" };
export default function ActivityPage() { return <AppTabLayout><ActivityList /></AppTabLayout>; }
