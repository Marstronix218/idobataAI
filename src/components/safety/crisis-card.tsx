"use client";

import { Phone, MessageSquare, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";

/**
 * Shown in place of any character banter when task text suggests distress
 * (SPEC "Crisis routing"). The copy is limited to what the spec gives: the 988
 * Suicide & Crisis Lifeline by call or text, and 911 for immediate danger. It
 * promises nothing about confidentiality and makes no clinical claim.
 *
 * Focus moves to the heading when the card appears, so keyboard and
 * screen-reader users land on it rather than on the control they just used,
 * and goes back to that control when the card closes. An open modal dialog
 * keeps its focus.
 */
export function CrisisCard({ onDismiss }: { onDismiss?: () => void }) {
  const titleId = useId();
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (previous?.closest("[aria-modal='true']")) return;
    headingRef.current?.focus();
    return () => {
      const lost = !document.activeElement || document.activeElement === document.body;
      if (lost && previous?.isConnected) previous.focus();
    };
  }, []);

  return <section aria-labelledby={titleId} className="rounded-[1.25rem] border-2 border-ink bg-surface p-4 text-ink sm:p-5">
    {/* TODO(founder): crisis card copy must be reviewed (clinical + counsel) */}
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <h2 id={titleId} ref={headingRef} tabIndex={-1} className="display text-lg font-bold">988 Suicide &amp; Crisis Lifeline</h2>
        <p className="mt-1 text-sm font-bold leading-6">Call or text 988.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a href="tel:988" className="btn bg-ink text-canvas"><Phone aria-hidden="true" size={16} /> Call 988</a>
          <a href="sms:988" className="btn bg-ink text-canvas"><MessageSquare aria-hidden="true" size={16} /> Text 988</a>
        </div>
        <p className="mt-4 text-sm font-bold leading-6">For immediate danger, call 911.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <a href="tel:911" className="btn bg-ink text-canvas"><Phone aria-hidden="true" size={16} /> Call 911</a>
        </div>
      </div>
      {onDismiss && <button type="button" className="icon-btn h-11 w-11 shrink-0" onClick={onDismiss} aria-label="Dismiss crisis resources"><X aria-hidden="true" size={18} /></button>}
    </div>
  </section>;
}
