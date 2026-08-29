import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/auth-form";
export const metadata: Metadata = { title: "Log in" };
export default async function LoginPage({ searchParams }: { searchParams?: Promise<{ error?: string }> }) {
	const error = (await searchParams)?.error;
	return <section className="card p-6 sm:p-9"><p className="eyebrow">Pick up where you left off</p><h1 className="display balance mt-3 text-4xl font-bold">Welcome back. What’s moving today?</h1><p className="mt-3 text-muted">Your list and your people are right where you left them.</p>{error === "configuration" && <div role="alert" className="mt-5 rounded-2xl border border-warning/30 bg-warning-soft p-4 text-sm leading-6 text-warning-ink"><strong>This workspace is not connected yet.</strong> Set the Supabase environment variables in <span className="font-semibold">.env.local</span> to load live profile stats, followers, and completions instead of demo-only state.</div>}<AuthForm mode="login" /></section>;
}
