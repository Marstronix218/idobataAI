import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { requirePageGate } from "@/lib/flags/route-gates";
import { AI_DISCLOSURE } from "@/lib/domain/ai-disclosure";
import { SAFETY_PLACEHOLDER_BANNER, SAFETY_PLACEHOLDER_MARKER } from "./placeholder";

export const metadata: Metadata = { title: "Safety" };

const link = "font-bold text-ink underline";

/**
 * The public safety page (SPEC Phase 5). It needs no sign-in, but it describes
 * Pivot A's protocols, so it exists only while Pivot A is on (404 otherwise).
 * It states, in plain terms, only what the app implements, and makes no legal
 * or clinical claims. It is placeholder copy until counsel reviews it (see
 * ./placeholder.ts).
 */
export default async function SafetyPage() {
  // Render per request so the build cannot freeze the flag.
  await connection();
  await requirePageGate("pivot_a");
  return <main id="main-content" data-placeholder={SAFETY_PLACEHOLDER_MARKER} className="app-theme paper-grid min-h-screen bg-canvas text-ink">
    {/* TODO(founder): counsel-reviewed safety page copy (SPEC Phase 5) */}
    <div className="app-page">
      <Link href="/" className="text-sm font-bold text-muted hover:text-ink">← Back to home</Link>
      <p className="mt-6 rounded-[1.25rem] border-2 border-ink bg-sun-soft p-4 font-bold text-ink">{SAFETY_PLACEHOLDER_BANNER}</p>
      <h1 className="page-title mt-6">Safety</h1>
      <div className="card mt-6 space-y-6 p-6 leading-7 text-muted">
        <section aria-labelledby="safety-ai" className="space-y-2">
          <h2 id="safety-ai" className="display text-lg font-bold text-ink">AI characters are labeled</h2>
          <p>The characters are AI characters, not people. Every character profile, and the first meeting with a character, shows this line:</p>
          <p className="font-bold text-ink">{AI_DISCLOSURE}</p>
          <p>The first character reaction each day repeats it.</p>
        </section>
        <section aria-labelledby="safety-adults" className="space-y-2">
          <h2 id="safety-adults" className="display text-lg font-bold text-ink">Adults only</h2>
          <p>The app asks for your date of birth at sign-up; you must be 18 or older to create an account.</p>
        </section>
        <section aria-labelledby="safety-chat" className="space-y-2">
          <h2 id="safety-chat" className="display text-lg font-bold text-ink">No open-ended chat</h2>
          <p>You can’t chat with a character. A character reacts in a sentence or two when you start or finish a task, and can split a task you’re stuck on into three steps.</p>
        </section>
        <section aria-labelledby="safety-distress" className="space-y-2">
          <h2 id="safety-distress" className="display text-lg font-bold text-ink">When task text suggests distress</h2>
          <p>An automated check reads a task’s title and note when the task is added or edited, and again when it is started, finished or split. If the text suggests distress or self-harm, no character banter is shown for it. A card is shown instead, offering the 988 Suicide &amp; Crisis Lifeline (call or text 988) and 911 for immediate danger.</p>
        </section>
        <section aria-labelledby="safety-kept" className="space-y-2">
          <h2 id="safety-kept" className="display text-lg font-bold text-ink">What is kept</h2>
          <p>Only an aggregate daily count of crisis cards shown is kept, with no task text and no user id. Nothing about the check’s result is stored with your tasks.</p>
          {/* The daily retention purge (purge_pivot_a_expired, run by /api/cron/pivot-a-daily) deletes reactions older than 30 days. */}
          <p>Character reactions, including their text, are deleted once they are 30 days old. A job removes them once a day.</p>
        </section>
        <section aria-labelledby="safety-help" className="space-y-2">
          <h2 id="safety-help" className="display text-lg font-bold text-ink">Getting help</h2>
          <p>988 Suicide &amp; Crisis Lifeline: <a href="tel:988" className={link}>call 988</a> or <a href="sms:988" className={link}>text 988</a>.</p>
          <p>For immediate danger: <a href="tel:911" className={link}>call 911</a>.</p>
          {/* TODO(founder): safety contact details for this page */}
          <p>Contact: TODO(founder)</p>
        </section>
      </div>
    </div>
  </main>;
}
