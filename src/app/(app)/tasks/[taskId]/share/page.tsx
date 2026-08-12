import type { Metadata } from "next";
import { ShareComposer } from "@/components/social/share-composer";
export const metadata: Metadata = { title: "Share a win" };
export default async function ShareTaskPage({ params }: PageProps<"/tasks/[taskId]/share">) {
  const { taskId } = await params;
  return <ShareComposer taskId={taskId} />;
}
