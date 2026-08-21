import { Globe2, LockKeyhole } from "lucide-react";
import { LogoMark } from "@/components/ui/logo";

export function AIBadge({ generated = false }: { generated?: boolean }) {
  return <span className="badge badge-ai">{generated && <LogoMark size={16} />}{generated ? "AI-generated" : "AI"}</span>;
}

export function PrivacyBadge({ isPublic }: { isPublic: boolean }) {
  return <span className={`badge ${isPublic ? "badge-public" : "badge-private"}`}>{isPublic ? <Globe2 size={12} /> : <LockKeyhole size={12} />}{isPublic ? "Public" : "Private"}</span>;
}
