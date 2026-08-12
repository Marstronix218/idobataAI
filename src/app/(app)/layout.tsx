import { AppShell } from "@/components/layout/app-shell";
import { redirect } from "next/navigation";
import { hasPublicSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  if (hasPublicSupabaseEnv()) {
    const { data: { user } } = await (await createClient()).auth.getUser();
    if (!user) redirect("/login");
  }
  return <AppShell>{children}</AppShell>;
}
