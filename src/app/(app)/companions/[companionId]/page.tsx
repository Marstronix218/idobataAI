import { permanentRedirect } from "next/navigation";
import { requirePageGate } from "@/lib/flags/route-gates";

export default async function LegacyCompanionProfilePage({
  params,
  searchParams = Promise.resolve({}),
}: {
  params: Promise<{ companionId: string }>;
  searchParams?: Promise<{ tab?: string }>;
}) {
  await requirePageGate("persona_chat");
  const { companionId } = await params;
  const { tab } = await searchParams;
  const tabQuery = tab === "about" ? "?tab=about" : "";

  permanentRedirect(`/ai-personas/${encodeURIComponent(companionId)}${tabQuery}`);
}
