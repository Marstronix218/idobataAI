import Link from "next/link";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="inline-flex items-center gap-2 text-ink" aria-label="idobataAI home">
      <span className="ring-mark grid h-8 w-8 place-items-center rounded-full bg-brand text-xs font-black text-white">i</span>
      {!compact && <span className="display text-xl font-bold tracking-tight">idobata<span className="text-community">AI</span></span>}
    </Link>
  );
}
