"use client";

import Link from "next/link";
import { Sparkles } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import type { CharacterList, CharacterSummary, CoachProfile } from "@idobata/contracts";
import { AiDisclosure } from "@/components/coach/ai-disclosure";
import { TimeZoneSelect } from "@/components/coach/time-zone-select";
import { apiRequest, errorMessage } from "@/lib/client/api";
import { CHARACTER_ROLE_LABELS } from "@/lib/domain/character-roles";
import { detectTimeZone } from "@/lib/domain/time-zones";

/** Pivot A only: change the character and time zone chosen during onboarding. */
export function CoachSettings() {
  const [characters, setCharacters] = useState<CharacterSummary[] | null>(null);
  const [saved, setSaved] = useState<CoachProfile | null>(null);
  const [characterId, setCharacterId] = useState("");
  const [timezone, setTimezone] = useState("");
  const [busy, setBusy] = useState(true);
  const [status, setStatus] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      apiRequest<CoachProfile>("/api/coach/profile", { signal: controller.signal }),
      apiRequest<CharacterList>("/api/characters", { signal: controller.signal }),
    ]).then(([profile, list]) => {
      setSaved(profile);
      setCharacters(list.items);
      setCharacterId(profile.selected_character_id ?? "");
      setTimezone(profile.timezone ?? detectTimeZone());
    }).catch((error) => {
      if (!(error instanceof DOMException && error.name === "AbortError")) setStatus(errorMessage(error));
    }).finally(() => {
      if (!controller.signal.aborted) setBusy(false);
    });
    return () => controller.abort();
  }, []);

  // Only changed fields are sent, so an unchanged character the user can no
  // longer select (a lapsed pack) never blocks a time zone change.
  const changes = saved ? {
    ...(characterId && characterId !== saved.selected_character_id && { characterId }),
    ...(timezone && timezone !== saved.timezone && { timezone }),
  } : {};
  const dirty = Object.keys(changes).length > 0;
  const savedCharacter = characters?.find((character) => character.id === saved?.selected_character_id);
  // A saved character missing from the list (a lapsed pack, or retired) is
  // shown as unavailable instead of the select silently showing another one.
  const savedUnavailable = Boolean(saved?.selected_character_id && characters && !savedCharacter);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dirty) return;
    setBusy(true);
    setStatus("");
    try {
      setSaved(await apiRequest<CoachProfile>("/api/coach/profile", { method: "PUT", body: JSON.stringify(changes) }));
      setStatus("Saved.");
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return <section id="character" className="card p-5 sm:p-6">
    <div className="flex items-center gap-2"><Sparkles size={19} className="text-brand" /><h2 className="display text-xl font-bold">Your character</h2></div>
    {characters && saved ? <form onSubmit={save} className="mt-5 space-y-5">
      <div>
        <label className="block"><span className="field-label">Character</span><select className="field" value={characterId} onChange={(event) => setCharacterId(event.target.value)} disabled={busy}>
          {!characterId && <option value="">Choose a character</option>}
          {/* TODO(founder): copy (label for a saved character that can no longer be chosen). */}
          {savedUnavailable && <option value={saved!.selected_character_id!} disabled>No longer available</option>}
          {characters.map((character) => <option key={character.id} value={character.id}>{character.name} · {CHARACTER_ROLE_LABELS[character.role]}</option>)}
        </select></label>
        {/* Choosing someone new here is a first meeting too (SPEC "Disclosures"). */}
        <AiDisclosure className="mt-2" />
        {savedCharacter && <Link href={`/characters/${savedCharacter.slug}`} className="mt-2 inline-block text-sm font-bold text-brand hover:underline">View {savedCharacter.name}’s profile</Link>}
      </div>
      <div><label className="field-label" htmlFor="settings-timezone">Time zone</label><TimeZoneSelect id="settings-timezone" value={timezone} onChange={setTimezone} disabled={busy} /></div>
      <button className="btn btn-primary" disabled={busy || !dirty}>{busy ? "Saving…" : "Save character and time zone"}</button>
    </form> : <p className="soft-card mt-4 p-5 text-center text-sm text-muted">{busy ? "Loading your character…" : "Your character settings could not be loaded."}</p>}
    <p className="mt-3 min-h-5 text-sm font-bold text-muted" aria-live="polite">{status}</p>
  </section>;
}
