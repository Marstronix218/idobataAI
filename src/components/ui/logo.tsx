import Image from "next/image";
import Link from "next/link";

function LogoMark() {
  return (
    <Image
      src="/logo-face.png"
      alt=""
      width={36}
      height={36}
      className="h-9 w-9 shrink-0 overflow-visible"
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
    <Link href={href} className="inline-flex items-center gap-2 text-ink" aria-label={label}>
      <LogoMark />
      {!compact && <span className="display text-xl font-bold tracking-tight">idobata<span className="text-community">AI</span></span>}
    </Link>
  );
}
