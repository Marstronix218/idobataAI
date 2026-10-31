import { Bot } from "lucide-react";
import { AI_DISCLOSURE } from "@/lib/domain/ai-disclosure";

/** The required AI disclosure, exactly as the spec words it. */
export function AiDisclosure({ className = "" }: { className?: string }) {
  return <p role="note" aria-label="AI disclosure" className={`flex items-start gap-1.5 text-xs font-bold leading-5 text-muted ${className}`}>
    <Bot aria-hidden="true" size={15} className="mt-0.5 shrink-0" />
    {AI_DISCLOSURE}
  </p>;
}
