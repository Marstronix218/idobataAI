import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CharacterSummary } from "@idobata/contracts";
import { resolvePlan, type EntitlementRow } from "@/lib/domain/plan";
import { assertDatabase } from "@/lib/server/http";
import type { Database } from "@/types";

/**
 * The character columns signed-in users may read. `characters.sheet` is
 * server-only prompt material with no client grant, so `select("*")` fails:
 * always name these columns.
 */
export const CHARACTER_SUMMARY_COLUMNS = "id, slug, name, role, art_url, is_launch, pack_sku";

/** Mirrors `public.set_coach_profile`: a launch character, or one whose pack the user owns. */
function isSelectable(character: CharacterSummary, ownedPacks: ReadonlySet<string>) {
  return character.is_launch || ownedPacks.has(character.slug);
}

/**
 * Slugs of the characters whose pack the user owns, by the one rule the story
 * and the reaction engine use too (resolvePlan: an `active` pack entitlement).
 */
async function ownedPacks(supabase: SupabaseClient<Database>, userId: string) {
  const rows = assertDatabase(await supabase
    .from("entitlements")
    .select("product, status, trial_ends_at, current_period_end")
    .eq("user_id", userId)
    .like("product", "pack:%")) ?? [];
  return new Set<string>(resolvePlan(rows as EntitlementRow[], new Date()).packs);
}

/**
 * Active characters the user may choose, launch characters first. RLS already
 * limits `characters` to active rows and `entitlements` to the user's own.
 */
export async function listSelectableCharacters(supabase: SupabaseClient<Database>, userId: string): Promise<CharacterSummary[]> {
  const [characters, packs] = await Promise.all([
    supabase
      .from("characters")
      .select(CHARACTER_SUMMARY_COLUMNS)
      .eq("active", true)
      .order("is_launch", { ascending: false })
      .order("name"),
    ownedPacks(supabase, userId),
  ]);
  return (assertDatabase(characters) ?? []).filter((character) => isSelectable(character, packs));
}

/** The character with this slug, or null when it is unknown, inactive or not the user's to choose. */
export async function findSelectableCharacter(supabase: SupabaseClient<Database>, userId: string, slug: string): Promise<CharacterSummary | null> {
  const [character, packs] = await Promise.all([
    supabase
      .from("characters")
      .select(CHARACTER_SUMMARY_COLUMNS)
      .eq("slug", slug)
      .eq("active", true)
      .maybeSingle(),
    ownedPacks(supabase, userId),
  ]);
  const row = assertDatabase(character);
  return row && isSelectable(row, packs) ? row : null;
}
