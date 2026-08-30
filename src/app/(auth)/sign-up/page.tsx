import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/auth-form";
import { BetaBadge } from "@/components/ui/status";
export const metadata: Metadata = { title: "Sign up" };
export default function SignUpPage() { return <section className="card p-6 sm:p-9"><p className="eyebrow">A quieter kind of productivity</p><h1 className="display balance mt-3 text-4xl font-bold">Make room for your next win.</h1><p className="mt-3 text-muted">Start with a private list. Share only what feels good.</p><p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm leading-6 text-muted"><BetaBadge /> Idobata is in beta. Features, copy, and limits still change, AI chat runs under a daily cap, and you can delete your account and data at any time from Settings.</p><AuthForm mode="signup" /></section>; }
