"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { TASK_SPLIT_ERROR_CODES, type ReactionCharacter, type TaskSplitResult } from "@idobata/contracts";
import { CharacterAvatar } from "@/components/coach/character-picker";
import { TypingIndicator } from "@/components/coach/reaction-bubble";
import { CrisisCard } from "@/components/safety/crisis-card";
import { recordPaywallView } from "@/lib/client/analytics";

type Outcome =
  | { kind: "split"; result: Extract<TaskSplitResult, { kind: "split" }> }
  | { kind: "crisis" }
  | { kind: "plan_required" }
  | { kind: "cap_reached" }
  | { kind: "unavailable" };

function resultOutcome(result: TaskSplitResult): Outcome {
  if (result.kind === "split") return { kind: "split", result };
  if (result.kind === "crisis") return { kind: "crisis" };
  return { kind: "unavailable" };
}

function failureOutcome(error: unknown): Outcome {
  // Read the code off the error rather than checking ClientApiError, so any
  // failure, including an unexpected one, lands on a calm message.
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
  if (code === TASK_SPLIT_ERROR_CODES.planRequired) return { kind: "plan_required" };
  if (code === TASK_SPLIT_ERROR_CODES.capReached) return { kind: "cap_reached" };
  return { kind: "unavailable" };
}

/**
 * A stuck task split into three steps, introduced in the character's voice.
 * Crisis shows the crisis card instead; every failure shows a short neutral
 * line, never the raw error.
 */
export function SplitSteps({ request, character = null, onDismiss, id, className = "" }: {
  request: Promise<TaskSplitResult>;
  /** Named while the steps are on their way. */
  character?: ReactionCharacter | null;
  onDismiss: () => void;
  id?: string;
  className?: string;
}) {
  const [settled, setSettled] = useState<{ request: Promise<TaskSplitResult>; outcome: Outcome } | null>(null);

  useEffect(() => {
    let latest = true;
    request.then(
      (result) => { if (latest) setSettled({ request, outcome: resultOutcome(result) }); },
      (error: unknown) => {
        if (!latest) return;
        const outcome = failureOutcome(error);
        setSettled({ request, outcome });
        // The Plus notice is about to show (SPEC Phase 7 paywall_viewed).
        if (outcome.kind === "plan_required") recordPaywallView("split");
      },
    );
    return () => { latest = false; };
  }, [request]);

  const outcome = settled?.request === request ? settled.outcome : null;
  if (outcome?.kind === "crisis") return <div id={id} className={className}><CrisisCard onDismiss={onDismiss} /></div>;

  const result = outcome?.kind === "split" ? outcome.result : null;
  const speaker = result?.character ?? character;
  const close = <button type="button" className="icon-btn h-9 w-9 shrink-0 border-0 bg-transparent" onClick={onDismiss} aria-label="Close steps"><X aria-hidden="true" size={16} /></button>;

  return <div id={id} aria-live="polite" className={className}>
    {outcome?.kind === "plan_required" ? (
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface-raised px-4 py-3">
        {/* TODO(founder): copy. Phase 6 replaces this notice with the real paywall. */}
        <p className="min-w-0 flex-1 text-sm font-bold">Splitting a task into steps comes with Plus.</p>
        <button type="button" className="btn btn-ghost" onClick={onDismiss}>Not now</button>
      </div>
    ) : outcome?.kind === "cap_reached" || outcome?.kind === "unavailable" ? (
      <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface-raised px-4 py-3">
        {/* TODO(founder): copy. */}
        <p className="min-w-0 flex-1 text-sm text-muted">{outcome.kind === "cap_reached" ? "No more splits today." : "Splitting isn’t available right now."}</p>
        {close}
      </div>
    ) : (
      <div className="flex items-start gap-3 rounded-2xl border border-brand/30 bg-brand-soft/50 p-4">
        {speaker && <CharacterAvatar character={{ name: speaker.name, art_url: speaker.artUrl }} size="md" />}
        <div className="min-w-0 flex-1">
          {speaker && <p className="text-sm font-bold">{speaker.name}</p>}
          {result ? <>
            <p className="mt-0.5 leading-6 break-words">{result.intro}</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-6">
              {result.steps.map((step, index) => <li key={index} className="break-words">{step}</li>)}
            </ol>
          </> : <TypingIndicator name={speaker?.name ?? null} />}
        </div>
        {close}
      </div>
    )}
  </div>;
}
