import type { Metadata } from "next";
import { FollowRequestInbox } from "@/components/profile/follow-request-inbox";
import { AppTabLayout } from "@/components/layout/app-tab-layout";
import { requirePageGate } from "@/lib/flags/route-gates";
export const metadata: Metadata = { title: "Follower requests" };
export default async function FollowRequestsPage() {
  await requirePageGate("social_feed");
  return <AppTabLayout><FollowRequestInbox /></AppTabLayout>;
}
