import { Globe2, LockKeyhole } from "lucide-react";
import { LogoMark } from "@/components/ui/logo";

export function AIBadge({ generated = false }: { generated?: boolean }) {
  return <span className="badge badge-ai">{generated && <LogoMark size={16} />}{generated ? "AI-generated" : "AI"}</span>;
}

// The terms and privacy notice are still starter copy and AI chat runs under a
// server-enforced daily cap, so the beta state has to be visible wherever a
// person decides to sign up or goes looking for why something is limited.
export function BetaBadge() {
  return <span className="badge badge-beta">Beta</span>;
}

export function PrivacyBadge({ isPublic }: { isPublic: boolean }) {
  return <span className={`badge ${isPublic ? "badge-public" : "badge-private"}`}>{isPublic ? <Globe2 size={12} /> : <LockKeyhole size={12} />}{isPublic ? "Public" : "Private"}</span>;
}
