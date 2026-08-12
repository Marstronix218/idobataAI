import type { Metadata } from "next";
import { ActivityList } from "@/components/activity/activity-list";
export const metadata: Metadata = { title: "Activity" };
export default function ActivityPage() { return <div className="app-page"><ActivityList /></div>; }
