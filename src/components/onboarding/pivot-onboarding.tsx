"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useState } from "react";
import { AGE_CHECK_ERROR_CODES, type CharacterSummary } from "@idobata/contracts";
import { CharacterPicker } from "@/components/coach/character-picker";
import { TimeZoneSelect } from "@/components/coach/time-zone-select";
import { apiRequest, errorMessage } from "@/lib/client/api";
import { detectTimeZone } from "@/lib/domain/time-zones";
import { createClient } from "@/lib/supabase/client";

// Pivot A onboarding, in order. Extension points:
// - The age step comes first, before anything is saved, and only for an
//   account whose age is not verified yet (one created before the age gate,
//   PLAN D6; new sign-ups are verified before the account exists).
// - Phase 6 puts the paywall step last, after the time zone is saved.
// Each step is an entry here plus its panel in the render below.
const AGE_STEP = { id: "age", label: "Confirm your age" } as const;
const PROFILE_STEPS = [
  { id: "character", label: "Meet your character" },
  { id: "timezone", label: "Your time zone" },
] as const;

/**
 * The ways out of a closed app: sign out, or Settings (where the account can
 * be deleted). Shown on every onboarding step and on the under-18 notice, so
 * nobody is stuck there, even while age verification is unavailable or the
 * cast cannot be read.
 */
function AccountExits({ settingsLabel, primary = false }: { settingsLabel: string; primary?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  async function signOut() {
    setBusy(true);
    setStatus("");
    const { error } = await createClient().auth.signOut();
    if (error) {
      setStatus(error.message);
      setBusy(false);
      return;
    }
    router.replace("/login");
    router.refresh();
  }

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <button type="button" className={`btn ${primary ? "btn-primary" : "btn-ghost"}`} onClick={() => void signOut()} disabled={busy}>{busy ? "Signing out…" : "Sign out"}</button>
        <Link className={`btn ${primary ? "btn-secondary" : "btn-ghost"}`} href="/settings#safety">{settingsLabel}</Link>
      </div>
      <p className="mt-2 min-h-5 text-sm font-bold text-muted" aria-live="polite">{status}</p>
    </div>
  );
}

/**
 * Shown when the age step finds the user is under 18. The app stays closed;
 * settings (sign-out, account deletion) stay reachable.
 */
function UnderAgeNotice() {
  // TODO(founder): policy for existing accounts that turn out to be under 18
  // (keep, suspend or delete the account; nothing is recorded today, so a
  // reload offers the age step again), and this copy (counsel).
  return (
    <div role="alert" className="animate-rise">
      <h1 className="display text-3xl font-bold">You need to be 18 or older to use idobata.</h1>
      <p className="mt-4 leading-7 text-muted">You can sign out, or delete your account and its data in Settings.</p>
      <div className="mt-8"><AccountExits settingsLabel="Delete my account" primary /></div>
    </div>
  );
}

export function PivotOnboarding({ characters, ageVerified, selectedCharacterId = null, savedTimezone = null }: {
  characters: CharacterSummary[];
  /** False for an account from before the age gate: the age step comes first. */
  ageVerified: boolean;
  selectedCharacterId?: string | null;
  savedTimezone?: string | null;
}) {
  const router = useRouter();
  // Fixed for the visit, so the step count does not jump once the age passes.
  const [steps] = useState(() => (ageVerified ? [...PROFILE_STEPS] : [AGE_STEP, ...PROFILE_STEPS]));
  const [step, setStep] = useState(0);
  const [ageDone, setAgeDone] = useState(ageVerified);
  const [underAge, setUnderAge] = useState(false);
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [characterId, setCharacterId] = useState(selectedCharacterId);
  // Only rendered on the time zone step, which never renders on the server, so
  // the server's own zone cannot leak into the page or break hydration.
  const [timezone, setTimezone] = useState(() => savedTimezone ?? detectTimeZone());
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const current = steps[step];
  // Once verified, the age step is never offered again.
  const firstStep = ageDone && steps[0].id === "age" ? 1 : 0;

  function next() {
    setStatus("");
    setStep((value) => Math.min(steps.length - 1, value + 1));
  }

  function finish() {
    router.replace("/tasks");
    router.refresh();
  }

  async function confirmAge() {
    if (!dateOfBirth) {
      setStatus("Enter your date of birth.");
      return;
    }
    setBusy(true);
    setStatus("");
    try {
      await apiRequest("/api/coach/age", { method: "POST", body: JSON.stringify({ dateOfBirth, timeZone: detectTimeZone() }) });
    } catch (error) {
      if ((error as { code?: string }).code === AGE_CHECK_ERROR_CODES.ageRequirement) setUnderAge(true);
      else setStatus(errorMessage(error));
      setBusy(false);
      return;
    }
    setAgeDone(true);
    setDateOfBirth("");
    // An account that finished onboarding before the age gate, or one with no
    // character to choose, has nothing left to do here. Stay busy while leaving.
    if ((selectedCharacterId && savedTimezone) || characters.length === 0) {
      finish();
      return;
    }
    setBusy(false);
    next();
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
    if (step === steps.length - 1) {
      finish();
      return;
    }
    setBusy(false);
    next();
  }

  if (underAge) {
    return (
      <div className="app-theme min-h-screen bg-canvas px-4 py-7 text-ink sm:py-12">
        <main id="main-content" className="mx-auto max-w-[720px]">
          <div className="mb-8"><Link href="/" className="display text-xl font-bold">idobata<span className="text-community">AI</span></Link></div>
          <section className="card p-6 sm:p-10"><UnderAgeNotice /></section>
        </main>
      </div>
    );
  }

  return (
    <div className="app-theme min-h-screen bg-canvas px-4 py-7 text-ink sm:py-12">
      <main id="main-content" className="mx-auto max-w-[720px]">
        <div className="mb-8 flex items-center justify-between"><Link href="/" className="display text-xl font-bold">idobata<span className="text-community">AI</span></Link><span className="text-sm font-bold text-muted">{step + 1} of {steps.length}</span></div>
        <div className="mb-8 grid gap-2" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }} aria-label={`Step ${step + 1} of ${steps.length}: ${current.label}`}>{steps.map((item, index) => <div key={item.id}><div className={`h-1.5 rounded-full ${index <= step ? "bg-brand" : "bg-line"}`} /><span className={`mt-2 hidden text-xs font-bold sm:block ${index === step ? "text-ink" : "text-muted"}`}>{item.label}</span></div>)}</div>
        <section className="card p-6 sm:p-10">
          {current.id === "age" && <div className="animate-rise">
            <p className="eyebrow">{current.label}</p>
            <h1 className="display mt-3 text-4xl font-bold">What’s your date of birth?</h1>
            {/* TODO(founder): copy (why we ask: idobata is for adults 18 and over; counsel review). */}
            <p className="mt-3 text-muted">idobata is for adults 18 and over.</p>
            <div className="mt-8"><label className="field-label" htmlFor="coach-date-of-birth">Date of birth</label><input className="field" id="coach-date-of-birth" type="date" autoComplete="bday" required value={dateOfBirth} onChange={(event) => setDateOfBirth(event.target.value)} disabled={busy} /></div>
          </div>}
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
          <button type="button" className="btn btn-ghost" disabled={step <= firstStep || busy} onClick={() => { setStatus(""); setStep((value) => Math.max(firstStep, value - 1)); }}><ArrowLeft size={16} /> Back</button>
          {current.id === "age"
            ? <button type="button" className="btn btn-primary" onClick={() => void confirmAge()} disabled={busy}>{busy ? "Checking…" : "Continue"} <ArrowRight size={16} /></button>
            : current.id === "timezone"
              ? <button type="button" className="btn btn-primary" onClick={() => void saveTimezone()} disabled={busy}>{busy ? "Saving…" : "Save and continue"} <ArrowRight size={16} /></button>
              : <button type="button" className="btn btn-primary" onClick={next} disabled={busy || (current.id === "character" && !characterId)}>Continue <ArrowRight size={16} /></button>}
        </div>
        {/* Onboarding blocks the app (and a failed profile read sends users here), so every step offers the exits Settings would. */}
        <nav aria-label="Account" className="mt-8 border-t border-line pt-6"><p className="mb-3 text-sm text-muted">Not now? You can sign out, or manage or delete your account in Settings.</p><AccountExits settingsLabel="Settings" /></nav>
      </main>
    </div>
  );
}
