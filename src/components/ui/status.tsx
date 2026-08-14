import { Globe2, LockKeyhole, Sparkles } from "lucide-react";

export function AIBadge({ generated = false }: { generated?: boolean }) {
  return <span className="badge badge-ai">{generated && <Sparkles size={12} />}{generated ? "AI-generated" : "AI"}</span>;
}

export function PrivacyBadge({ isPublic }: { isPublic: boolean }) {
  return <span className={`badge ${isPublic ? "badge-public" : "badge-private"}`}>{isPublic ? <Globe2 size={12} /> : <LockKeyhole size={12} />}{isPublic ? "Public" : "Private"}</span>;
}
