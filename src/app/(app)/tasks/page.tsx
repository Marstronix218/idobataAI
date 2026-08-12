import type { Metadata } from "next";
import { TaskBoard } from "@/components/tasks/task-board";
export const metadata: Metadata = { title: "Tasks" };
export default function TasksPage() { return <div className="app-page xl:max-w-[1100px]"><TaskBoard /></div>; }
