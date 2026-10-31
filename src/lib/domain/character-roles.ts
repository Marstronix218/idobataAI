import type { CharacterSummary } from "@idobata/contracts";

export const CHARACTER_ROLE_LABELS: Record<CharacterSummary["role"], string> = {
  coach: "Coach",
  rival: "Rival",
  cheerleader: "Cheerleader",
  deadpan: "Deadpan",
};

/** The letter shown when a character has no art. */
export const characterInitial = (name: string) => name.trim().charAt(0).toUpperCase() || "?";
