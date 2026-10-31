"use client";

import { useEffect, useState } from "react";
import type { ReactionCharacter, ReactionPayload } from "@idobata/contracts";
import { AiDisclosure } from "@/components/coach/ai-disclosure";
import { CharacterAvatar } from "@/components/coach/character-picker";
import { CrisisCard } from "@/components/safety/crisis-card";

type Banter = Extract<ReactionPayload, { kind: "reaction" }>;

/**
 * The bubble shows "typing" for at most this long. The server falls back to a
 * prewritten line within 2.5 s, so this only runs out on a slow network; a
 * reaction that lands later still shows.
 */
const TYPING_MAX_MS = 3_000;

/** Three still dots: the typing state lasts seconds, and DESIGN.md allows no endless animation. */
export function TypingIndicator({ name }: { name: string | null }) {
  return <p className="mt-1 flex items-center gap-1">
    <span className="sr-only">{name ? `${name} is typing` : "Typing"}</span>
    {[0, 1, 2].map((dot) => <span key={dot} aria-hidden="true" className="h-2 w-2 rounded-full bg-muted" />)}
  </p>;
}

/**
 * The coach panel's single bubble: the latest request's reaction, with the
 * character's name and art. A crisis payload replaces the banter with the
 * crisis card, and later banter never covers a card the user has not dismissed.
 *
 * It never shows an error. A failed request, or one that returns no reaction,
 * quietly shows nothing: an older line may be about a different task.
 */
export function ReactionBubble({ request, character = null, className = "" }: {
  /** The latest reaction request; a new promise starts a new "typing" state. */
  request: Promise<ReactionPayload | null> | null;
  /** The user's character, named while typing before any reaction has arrived. */
  character?: ReactionCharacter | null;
  /** Applied to the visible bubble or card, so an empty bubble takes no space. */
  className?: string;
}) {
  const [banter, setBanter] = useState<{ request: Promise<ReactionPayload | null>; payload: Banter } | null>(null);
  const [crisis, setCrisis] = useState(false);
  const [settled, setSettled] = useState<Promise<ReactionPayload | null> | null>(null);

  useEffect(() => {
    if (!request) return;
    let latest = true;
    const stopTyping = () => { if (latest) setSettled(request); };
    const timer = window.setTimeout(stopTyping, TYPING_MAX_MS);
    request
      .then((payload) => {
        // A crisis result shows even when a newer request has replaced this one.
        if (payload?.kind === "crisis") setCrisis(true);
        else if (payload && latest) setBanter({ request, payload });
      }, () => undefined)
      .finally(stopTyping);
    return () => {
      latest = false;
      window.clearTimeout(timer);
    };
  }, [request]);

  const reaction = !crisis && banter?.request === request ? banter.payload : null;
  const typing = request !== null && settled !== request && !crisis && !reaction;
  const speaker = typing ? character ?? null : reaction?.character ?? null;

  return <div>
    {crisis && <div className={className}><CrisisCard onDismiss={() => setCrisis(false)} /></div>}
    <div aria-live="polite">
      {(typing || reaction) && <div className={`flex items-start gap-3 rounded-[1.25rem] border border-brand/30 bg-brand-soft/50 p-4 ${className}`}>
        {speaker && <CharacterAvatar character={{ name: speaker.name, art_url: speaker.artUrl }} size="md" />}
        <div className="min-w-0 flex-1">
          {speaker && <p className="text-sm font-bold">{speaker.name}</p>}
          {typing || !reaction ? <TypingIndicator name={speaker?.name ?? null} /> : <>
            <p className="mt-0.5 leading-6 break-words">{reaction.text}</p>
            {reaction.disclosure !== null && <AiDisclosure className="mt-2" />}
          </>}
        </div>
      </div>}
    </div>
  </div>;
}
