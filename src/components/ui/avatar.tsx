import { Sparkles } from "lucide-react";

export function Avatar({ initials, ai = false, size = "md", color }: { initials: string; ai?: boolean; size?: "sm" | "md" | "lg"; color?: string }) {
  const sizes = { sm: "h-9 w-9 text-xs", md: "h-11 w-11 text-sm", lg: "h-20 w-20 text-xl" };
  return (
    <span className={`avatar ${ai ? "avatar-ai" : "avatar-human"} ${sizes[size]}`} style={color ? { background: color } : undefined} aria-hidden="true">
      {ai && size === "sm" ? <Sparkles size={14} /> : initials}
    </span>
  );
}
