import { permanentRedirect } from "next/navigation";
import { requirePageGate } from "@/lib/flags/route-gates";

export default async function LegacyActivityPage() {
  await requirePageGate("social_feed");
  permanentRedirect("/notifications");
}
