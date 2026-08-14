import type { Metadata } from "next";
import { AppTabLayout } from "@/components/layout/app-tab-layout";
import { TaskBoard } from "@/components/tasks/task-board";
export const metadata: Metadata = { title: "Your Tasks" };
export default function TasksPage() { return <AppTabLayout padded contextRail={false}><TaskBoard /></AppTabLayout>; }
