import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReactionCharacter } from "@idobata/contracts";
import { AppTabLayout } from "@/components/layout/app-tab-layout";
import { TaskBoard } from "@/components/tasks/task-board";
import { needsCoachOnboarding, readCoachProfile } from "@/lib/coach/profile";
import { getFlags } from "@/lib/flags";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types";
export const metadata: Metadata = { title: "Your Tasks" };

/** The user's character for the coach panel: public columns only, never the sheet. */
async function selectedCharacter(supabase: SupabaseClient<Database>, userId: string): Promise<ReactionCharacter | null> {
  const { selected_character_id: id } = await readCoachProfile(supabase, userId);
  if (!id) return null;
  const { data } = await supabase.from("characters").select("id, slug, name, art_url").eq("id", id).maybeSingle();
  return data ? { id: data.id, slug: data.slug, name: data.name, artUrl: data.art_url } : null;
}

export default async function TasksPage() {
  const flags = await getFlags();
  let coach: { character: ReactionCharacter | null } | undefined;
  // The (app) layout's onboarding check does not re-run on client navigation,
  // but pages do: without this, entering via /settings and tapping Tasks would
  // skip onboarding. A failed read lets the user in, as in the layout.
  if (flags.pivotA) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const [needsOnboarding, character] = user
      ? await Promise.all([
          needsCoachOnboarding(supabase, user.id).catch(() => false),
          // The board works without it: the panel then names the character once a reaction arrives.
          selectedCharacter(supabase, user.id).catch(() => null),
        ])
      : [false, null];
    if (needsOnboarding) redirect("/onboarding");
    coach = { character };
  }
  return <AppTabLayout padded contextRail={false}><TaskBoard shareWin={flags.shareWin} pivotA={flags.pivotA} coach={coach} /></AppTabLayout>;
}
