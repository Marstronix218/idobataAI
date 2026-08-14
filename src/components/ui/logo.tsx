import Image from "next/image";
import Link from "next/link";

function LogoMark() {
  return (
    <Image
      src="/brand/idobata-logo.png"
      alt=""
      width={48}
      height={48}
      className="h-12 w-12 shrink-0 overflow-visible"
    />
  );
}

export function Logo({
  compact = false,
  href = "/",
  label = "idobataAI home",
}: {
  compact?: boolean;
  href?: string;
  label?: string;
}) {
  return (
    <Link href={href} className="inline-flex items-center gap-3 text-ink" aria-label={label}>
      <LogoMark />
      {!compact && <span className="display text-2xl font-bold tracking-tight">idobata<span className="text-community">AI</span></span>}
    </Link>
  );
}
