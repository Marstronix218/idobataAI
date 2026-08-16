import type { Metadata } from "next";
import { RecoveryForm } from "@/components/auth/recovery-form";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return <section className="card p-6 sm:p-9"><p className="eyebrow">Password recovery</p><h1 className="display balance mt-3 text-4xl font-bold">Find your way back in.</h1><p className="mt-3 text-muted">Enter your email and we’ll send instructions for choosing a new password.</p><RecoveryForm mode="forgot-password" /></section>;
}
