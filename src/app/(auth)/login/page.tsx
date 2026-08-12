import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/auth-form";
export const metadata: Metadata = { title: "Log in" };
export default function LoginPage() { return <section className="card p-6 sm:p-9"><p className="eyebrow">Pick up where you left off</p><h1 className="display balance mt-3 text-4xl font-bold">Welcome back. What’s moving today?</h1><p className="mt-3 text-muted">Your list and your people are right where you left them.</p><AuthForm mode="login" /></section>; }
