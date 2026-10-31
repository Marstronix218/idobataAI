"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useState } from "react";
import type { CharacterSummary } from "@idobata/contracts";
import { CharacterPicker } from "@/components/coach/character-picker";
import { TimeZoneSelect } from "@/components/coach/time-zone-select";
import { apiRequest, errorMessage } from "@/lib/client/api";
import { detectTimeZone } from "@/lib/domain/time-zones";

// Pivot A onboarding, in order. Extension points:
// - Phase 5 puts the age step first (before anything is saved).
// - Phase 6 puts the paywall step last, after the time zone is saved.
// Each step is an entry here plus its panel in the render below.
const STEPS = [
  { id: "character", label: "Meet your character" },
  { id: "timezone", label: "Your time zone" },
] as const;

export function PivotOnboarding({ characters, selectedCharacterId = null, savedTimezone = null }: {
  characters: CharacterSummary[];
  selectedCharacterId?: string | null;
  savedTimezone?: string | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [characterId, setCharacterId] = useState(selectedCharacterId);
  // Only rendered on the time zone step, which never renders on the server, so
  // the server's own zone cannot leak into the page or break hydration.
  const [timezone, setTimezone] = useState(() => savedTimezone ?? detectTimeZone());
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const current = STEPS[step];

  function next() {
    setStatus("");
    setStep((value) => Math.min(STEPS.length - 1, value + 1));
  }

  async function saveTimezone() {
    setBusy(true);
    setStatus("");
    try {
      await apiRequest("/api/coach/profile", { method: "PUT", body: JSON.stringify({ timezone }) });
    } catch (error) {
      setStatus(errorMessage(error));
      setBusy(false);
      return;
    }
    // Onboarding is complete once the character and time zone are saved, so
    // the app stops sending the user back here. Stay busy while leaving.
    if (step === STEPS.length - 1) {
      router.replace("/tasks");
      router.refresh();
      return;
    }
    setBusy(false);
    next();
  }

  return (
    <div className="app-theme min-h-screen bg-canvas px-4 py-7 text-ink sm:py-12">
      <main id="main-content" className="mx-auto max-w-[720px]">
        <div className="mb-8 flex items-center justify-between"><Link href="/" className="display text-xl font-bold">idobata<span className="text-community">AI</span></Link><span className="text-sm font-bold text-muted">{step + 1} of {STEPS.length}</span></div>
        <div className="mb-8 grid gap-2" style={{ gridTemplateColumns: `repeat(${STEPS.length}, minmax(0, 1fr))` }} aria-label={`Step ${step + 1} of ${STEPS.length}: ${current.label}`}>{STEPS.map((item, index) => <div key={item.id}><div className={`h-1.5 rounded-full ${index <= step ? "bg-brand" : "bg-line"}`} /><span className={`mt-2 hidden text-xs font-bold sm:block ${index === step ? "text-ink" : "text-muted"}`}>{item.label}</span></div>)}</div>
        <section className="card p-6 sm:p-10">
          {/* The first meeting: every card carries the AI disclosure (SPEC "Disclosures"). */}
          {current.id === "character" && <div className="animate-rise">
            <p className="eyebrow">{current.label}</p>
            <h1 className="display mt-3 text-4xl font-bold">Pick your character</h1>
            {/* TODO(founder): copy (an introduction to the cast, if any). */}
            <div className="mt-8"><CharacterPicker characters={characters} selectedId={characterId} onChosen={(character) => { setCharacterId(character.id); next(); }} /></div>
          </div>}
          {current.id === "timezone" && <div className="animate-rise">
            <p className="eyebrow">{current.label}</p>
            <h1 className="display mt-3 text-4xl font-bold">Confirm your time zone</h1>
            {/* TODO(founder): copy (why the time zone matters: the day resets at local midnight). */}
            <div className="mt-8"><label className="field-label" htmlFor="coach-timezone">Time zone</label><TimeZoneSelect id="coach-timezone" value={timezone} onChange={setTimezone} disabled={busy} /></div>
          </div>}
        </section>
        <p className="mt-4 min-h-5 text-sm font-bold text-muted" aria-live="polite">{status}</p>
        <div className="mt-2 flex items-center justify-between">
          <button type="button" className="btn btn-ghost" disabled={step === 0 || busy} onClick={() => { setStatus(""); setStep((value) => Math.max(0, value - 1)); }}><ArrowLeft size={16} /> Back</button>
          {current.id === "timezone"
            ? <button type="button" className="btn btn-primary" onClick={() => void saveTimezone()} disabled={busy}>{busy ? "Saving…" : "Save and continue"} <ArrowRight size={16} /></button>
            : <button type="button" className="btn btn-primary" onClick={next} disabled={busy || (current.id === "character" && !characterId)}>Continue <ArrowRight size={16} /></button>}
        </div>
      </main>
    </div>
  );
}
