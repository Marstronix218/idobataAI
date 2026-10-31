import type { Metadata } from "next";
import { ShareComposer } from "@/components/social/share-composer";
import { requirePageGate } from "@/lib/flags/route-gates";
export const metadata: Metadata = { title: "Share a win" };
export default async function ShareTaskPage({ params }: PageProps<"/tasks/[taskId]/share">) {
  const flags = await requirePageGate("share_win");
  const { taskId } = await params;
  return <ShareComposer taskId={taskId} peopleOnly={flags.sharePeopleOnly} />;
}
