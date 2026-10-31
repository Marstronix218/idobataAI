import type { Metadata } from "next";
import { ActivityList } from "@/components/activity/activity-list";
import { AppTabLayout } from "@/components/layout/app-tab-layout";
import { requirePageGate } from "@/lib/flags/route-gates";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  await requirePageGate("social_feed");
  return <AppTabLayout><ActivityList /></AppTabLayout>;
}
