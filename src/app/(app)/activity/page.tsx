import { permanentRedirect } from "next/navigation";

export default function LegacyActivityPage() {
  permanentRedirect("/notifications");
}
