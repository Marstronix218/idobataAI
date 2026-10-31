import type { Metadata } from "next";
import { ChatPanel } from "@/components/chat/chat-panel";
import { AppTabLayout } from "@/components/layout/app-tab-layout";
import { requirePageGate } from "@/lib/flags/route-gates";

export const metadata: Metadata = { title: "Chat" };

export default async function ChatPage() {
  await requirePageGate("chat");
  return <AppTabLayout contextRail={false}><ChatPanel /></AppTabLayout>;
}
