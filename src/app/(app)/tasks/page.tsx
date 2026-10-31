import type { Metadata } from "next";
import { AppTabLayout } from "@/components/layout/app-tab-layout";
import { TaskBoard } from "@/components/tasks/task-board";
import { getFlags } from "@/lib/flags";
export const metadata: Metadata = { title: "Your Tasks" };
export default async function TasksPage() {
  const flags = await getFlags();
  return <AppTabLayout padded contextRail={false}><TaskBoard shareWin={flags.shareWin} /></AppTabLayout>;
}
