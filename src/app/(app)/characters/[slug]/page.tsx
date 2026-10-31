import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AiDisclosure } from "@/components/coach/ai-disclosure";
import { CharacterAvatar, ChooseCharacterButton } from "@/components/coach/character-picker";
import { AppTabLayout } from "@/components/layout/app-tab-layout";
import { findSelectableCharacter } from "@/lib/coach/characters";
import { readCoachProfile } from "@/lib/coach/profile";
import { CHARACTER_ROLE_LABELS } from "@/lib/domain/character-roles";
import { requirePageGate } from "@/lib/flags/route-gates";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Character" };

// Same shape as the characters.slug check constraint.
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * A character's profile. It shows only the public columns: the character sheet
 * is server-only prompt material, so no bio or tagline comes from it.
 */
export default async function CharacterProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  await requirePageGate("pivot_a");
  const slug = decodeURIComponent((await params).slug);
  if (slug.length > 48 || !SLUG.test(slug)) notFound();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();
  const [character, profile] = await Promise.all([
    findSelectableCharacter(supabase, user.id, slug),
    readCoachProfile(supabase, user.id),
  ]);
  if (!character) notFound();

  return <AppTabLayout padded contextRail={false}>
    <article className="card mx-auto max-w-xl p-6 sm:p-9" aria-labelledby="character-name">
      <div className="flex items-center gap-5">
        <CharacterAvatar character={character} size="xl" />
        <div className="min-w-0">
          <p className="eyebrow">{CHARACTER_ROLE_LABELS[character.role]}</p>
          <h1 id="character-name" className="display mt-2 text-4xl font-bold">{character.name}</h1>
        </div>
      </div>
      <AiDisclosure className="mt-6" />
      <div className="mt-6"><ChooseCharacterButton character={character} selected={profile.selected_character_id === character.id} /></div>
    </article>
  </AppTabLayout>;
}
