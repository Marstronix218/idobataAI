import Link from "next/link";
import { Logo } from "@/components/ui/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <main id="main-content" className="app-theme paper-grid relative grid min-h-screen place-items-center overflow-hidden bg-canvas px-4 py-10 text-ink"><div className="absolute -left-24 -top-24 h-72 w-72 rounded-full border border-brand/15" /><div className="absolute -right-20 bottom-0 h-64 w-64 rounded-full border border-community/15" /><div className="relative w-full max-w-[460px]"><div className="mb-8 flex items-center justify-between"><Logo /><Link href="/" className="text-sm font-bold text-muted hover:text-ink">Back home</Link></div>{children}</div></main>;
}
