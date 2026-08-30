import { redirect } from "next/navigation";
import { hasPublicSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

// The Profile tab has no page of its own -- a profile lives at `/u/{username}`.
// Resolving the username here rather than in the shell's client fetch means the
// tab still lands on the profile when that fetch has not resolved yet, or when
// it failed because the account has no `user_profiles` row.
export default async function ProfileRedirectPage() {
  const previewMode = process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE === "true" && process.env.NODE_ENV !== "production";
  if (previewMode || !hasPublicSupabaseEnv()) redirect("/u/mina");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // `maybeSingle` so a missing profile row falls through to Settings, where the
  // editor can create one, instead of throwing on the way to the profile.
  const { data } = await supabase.from("user_profiles").select("username").eq("id", user.id).maybeSingle();
  redirect(data?.username ? `/u/${encodeURIComponent(data.username)}` : "/settings");
}
