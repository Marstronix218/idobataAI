import Image from "next/image";
import Link from "next/link";
import idobataLogo from "../../../public/brand/idobata-logo.png";

type LogoSize = "default" | "large";

function LogoMark({ size }: { size: LogoSize }) {
  const large = size === "large";

  return (
    <Image
      src={idobataLogo}
      alt=""
      width={large ? 64 : 48}
      height={large ? 64 : 48}
      sizes={large ? "(min-width: 640px) 64px, 56px" : "48px"}
      className={large ? "h-14 w-14 shrink-0 overflow-visible sm:h-16 sm:w-16" : "h-12 w-12 shrink-0 overflow-visible"}
    />
  );
}

export function Logo({
  compact = false,
  href = "/",
  label = "idobataAI home",
  size = "default",
}: {
  compact?: boolean;
  href?: string;
  label?: string;
  size?: LogoSize;
}) {
  const large = size === "large";

  return (
    <Link href={href} className={`inline-flex items-center text-ink ${large ? "gap-2.5 sm:gap-3" : "gap-3"}`} aria-label={label}>
      <LogoMark size={size} />
      {!compact && <span className={`display font-bold tracking-tight ${large ? "text-[1.75rem] leading-none sm:text-[2rem]" : "text-2xl"}`}>idobata<span className="text-community">AI</span></span>}
    </Link>
  );
}
