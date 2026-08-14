import { AppShell } from "@/components/layout/app-shell";
import { redirect } from "next/navigation";
import { hasPublicSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const previewMode = process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE === "true" && process.env.NODE_ENV !== "production";
  if (!previewMode && hasPublicSupabaseEnv()) {
    const { data: { user } } = await (await createClient()).auth.getUser();
    if (!user) redirect("/login");
  }
  return <AppShell>{children}</AppShell>;
}
