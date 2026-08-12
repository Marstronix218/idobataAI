import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/auth-form";
export const metadata: Metadata = { title: "Sign up" };
export default function SignUpPage() { return <section className="card p-6 sm:p-9"><p className="eyebrow">A quieter kind of productivity</p><h1 className="display balance mt-3 text-4xl font-bold">Make room for your next win.</h1><p className="mt-3 text-muted">Start with a private list. Share only what feels good.</p><AuthForm mode="signup" /></section>; }
