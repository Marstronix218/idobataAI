import type { Metadata } from "next";
import { AppTabLayout } from "@/components/layout/app-tab-layout";
import { Feed } from "@/components/social/feed";
export const metadata: Metadata = { title: "Community feed" };
export default function FeedPage() { return <AppTabLayout><Feed /></AppTabLayout>; }
