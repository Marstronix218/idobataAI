import { permanentRedirect } from "next/navigation";
import { requirePageGate } from "@/lib/flags/route-gates";

export default async function LegacyCompanionsPage() {
  await requirePageGate("persona_chat");
  permanentRedirect("/ai-personas");
}
