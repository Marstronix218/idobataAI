import type { Metadata } from "next";
import { Feed } from "@/components/social/feed";
export const metadata: Metadata = { title: "Community feed" };
export default function FeedPage() { return <div className="app-page xl:max-w-[1040px]"><Feed /></div>; }
