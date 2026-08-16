import type { Metadata } from "next";
import { RecoveryForm } from "@/components/auth/recovery-form";

export const metadata: Metadata = { title: "Choose a new password" };

export default function UpdatePasswordPage() {
  return <section className="card p-6 sm:p-9"><p className="eyebrow">Secure your account</p><h1 className="display balance mt-3 text-4xl font-bold">Choose a new password.</h1><p className="mt-3 text-muted">Use at least eight characters that you don’t use somewhere else.</p><RecoveryForm mode="update-password" /></section>;
}
