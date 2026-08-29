import type { Metadata } from "next";
import { FollowRequestInbox } from "@/components/profile/follow-request-inbox";
import { AppTabLayout } from "@/components/layout/app-tab-layout";
export const metadata: Metadata = { title: "Follower requests" };
export default function FollowRequestsPage() { return <AppTabLayout><FollowRequestInbox /></AppTabLayout>; }
