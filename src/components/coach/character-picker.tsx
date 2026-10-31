"use client";

import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { useState } from "react";
import type { CharacterSummary, CoachProfile } from "@idobata/contracts";
import { AiDisclosure } from "@/components/coach/ai-disclosure";
import { Avatar } from "@/components/ui/avatar";
import { apiRequest, errorMessage } from "@/lib/client/api";
import { CHARACTER_ROLE_LABELS, characterInitial } from "@/lib/domain/character-roles";

function saveCharacter(characterId: string) {
  return apiRequest<CoachProfile>("/api/coach/profile", { method: "PUT", body: JSON.stringify({ characterId }) });
}

/** The character's art, or a plain initial when it has none. Decorative: the name is always shown beside it. */
export function CharacterAvatar({ character, size = "lg" }: { character: Pick<CharacterSummary, "name" | "art_url">; size?: "md" | "lg" | "xl" }) {
  return <Avatar initials={characterInitial(character.name)} avatarUrl={character.art_url} ai size={size} />;
}

/** One card per selectable character, each carrying the AI disclosure. Choosing saves it straight away. */
export function CharacterPicker({ characters, selectedId = null, onChosen }: {
  characters: CharacterSummary[];
  selectedId?: string | null;
  onChosen?: (character: CharacterSummary) => void;
}) {
  const [chosenId, setChosenId] = useState(selectedId);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  async function choose(character: CharacterSummary) {
    setBusyId(character.id);
    setStatus("");
    try {
      await saveCharacter(character.id);
      setChosenId(character.id);
      onChosen?.(character);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusyId(null);
    }
  }

  // TODO(founder): copy (no characters available).
  if (!characters.length) return <p className="soft-card p-6 text-center text-sm text-muted">No characters are available yet.</p>;

  return <div>
    <ul className="grid gap-4 sm:grid-cols-2" aria-label="Characters">
      {characters.map((character) => {
        const chosen = character.id === chosenId;
        return <li key={character.id} className={`rounded-2xl border p-5 ${chosen ? "border-brand bg-brand-soft shadow-[0_0_0_2px_var(--brand)]" : "border-line bg-surface"}`}>
          <div className="flex items-center gap-4">
            <CharacterAvatar character={character} />
            <div className="min-w-0">
              <h2 className="display truncate text-xl font-bold">{character.name}</h2>
              <p className="text-sm font-bold text-muted">{CHARACTER_ROLE_LABELS[character.role]}</p>
              {chosen && <p className="mt-1 flex items-center gap-1 text-xs font-bold text-brand"><Check aria-hidden="true" size={13} /> Your character</p>}
            </div>
          </div>
          <AiDisclosure className="mt-4" />
          <button type="button" className={`btn mt-4 w-full ${chosen ? "btn-secondary" : "btn-primary"}`} aria-label={`Choose ${character.name}`} disabled={busyId !== null} onClick={() => void choose(character)}>
            {busyId === character.id ? "Saving…" : "Choose"}
          </button>
        </li>;
      })}
    </ul>
    <p aria-live="polite" className="mt-4 min-h-5 text-sm font-bold text-muted">{status}</p>
  </div>;
}

/** The profile page's choose action. Once chosen, the page re-renders with this character selected. */
export function ChooseCharacterButton({ character, selected }: { character: Pick<CharacterSummary, "id" | "name">; selected: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  async function choose() {
    setBusy(true);
    setStatus("");
    try {
      await saveCharacter(character.id);
      router.refresh();
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  if (selected) return <p className="flex items-center gap-1.5 text-sm font-bold text-brand"><Check aria-hidden="true" size={16} /> Your character</p>;
  return <div>
    <button type="button" className="btn btn-primary" aria-label={`Choose ${character.name}`} disabled={busy} onClick={() => void choose()}>{busy ? "Saving…" : "Choose"}</button>
    <p aria-live="polite" className="mt-3 min-h-5 text-sm font-bold text-muted">{status}</p>
  </div>;
}
