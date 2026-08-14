import type { Metadata } from "next";
import { ChatPanel } from "@/components/chat/chat-panel";
import { AppTabLayout } from "@/components/layout/app-tab-layout";

export const metadata: Metadata = { title: "Chat" };

export default function ChatPage() {
  return <AppTabLayout contextRail={false}><ChatPanel /></AppTabLayout>;
}
