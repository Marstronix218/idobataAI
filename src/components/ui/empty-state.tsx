import type { LucideIcon } from "lucide-react";

export function EmptyState({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
  return (
    <div className="soft-card flex flex-col items-center px-6 py-12 text-center">
      <span className="ring-mark mb-5 grid h-14 w-14 place-items-center rounded-full bg-brand-soft text-brand"><Icon size={24} /></span>
      <h2 className="display text-xl font-bold">{title}</h2>
      <p className="mt-2 max-w-sm text-sm leading-6 text-muted">{description}</p>
    </div>
  );
}
