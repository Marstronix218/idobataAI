import type { Metadata } from "next";
import { AppTabLayout } from "@/components/layout/app-tab-layout";
import { Feed } from "@/components/social/feed";
import { requirePageGate } from "@/lib/flags/route-gates";
export const metadata: Metadata = { title: "Community feed" };
export default async function FeedPage() {
  const flags = await requirePageGate("wins");
  // D10: with the full feed off, this is the people-only Wins view.
  return <AppTabLayout><Feed winsOnly={!flags.socialFeed} /></AppTabLayout>;
}
