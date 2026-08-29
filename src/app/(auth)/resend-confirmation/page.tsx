import type { Metadata } from "next";
import { RecoveryForm } from "@/components/auth/recovery-form";

export const metadata: Metadata = { title: "Resend confirmation" };

export default async function ResendConfirmationPage({ searchParams }: { searchParams?: Promise<{ email?: string }> }) {
  const email = (await searchParams)?.email ?? "";
  return <section className="card p-6 sm:p-9"><p className="eyebrow">Confirm your account</p><h1 className="display balance mt-3 text-4xl font-bold">Need a fresh confirmation link?</h1><p className="mt-3 text-muted">Enter the email you signed up with and we’ll send another link.</p><RecoveryForm mode="resend-confirmation" defaultEmail={email} /></section>;
}
