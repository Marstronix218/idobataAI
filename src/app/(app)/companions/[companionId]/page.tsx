import { permanentRedirect } from "next/navigation";

export default async function LegacyCompanionProfilePage({
  params,
  searchParams = Promise.resolve({}),
}: {
  params: Promise<{ companionId: string }>;
  searchParams?: Promise<{ tab?: string }>;
}) {
  const { companionId } = await params;
  const { tab } = await searchParams;
  const tabQuery = tab === "about" ? "?tab=about" : "";

  permanentRedirect(`/ai-personas/${encodeURIComponent(companionId)}${tabQuery}`);
}
