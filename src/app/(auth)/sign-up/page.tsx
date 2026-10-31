import type { Metadata } from "next";
import { connection } from "next/server";
import { AuthForm } from "@/components/auth/auth-form";
import { BetaBadge } from "@/components/ui/status";
import { getFlags } from "@/lib/flags";
export const metadata: Metadata = { title: "Sign up" };
export default async function SignUpPage() {
	// Under Pivot A sign-up asks for a date of birth. Render per request so the
	// build cannot freeze whichever form the flags picked at build time.
	await connection();
	const flags = await getFlags();
	return <section className="card p-6 sm:p-9"><p className="eyebrow">A quieter kind of productivity</p><h1 className="display balance mt-3 text-4xl font-bold">Make room for your next win.</h1><p className="mt-3 text-muted">Start with a private list. Share only what feels good.</p><p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm leading-6 text-muted"><BetaBadge /> Idobata is in beta. Features, copy, and limits still change, AI chat runs under a daily cap, and you can delete your account and data at any time from Settings.</p><AuthForm mode="signup" pivot={flags.pivotA} /></section>;
}
