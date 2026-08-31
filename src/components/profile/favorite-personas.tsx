import Link from "next/link";
import { Star } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import type { ProfileFollowPersona } from "@/types";

function initials(name: string) {
  return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

/**
 * The three personas an account keeps closest, sitting directly under the
 * card's counts.
 *
 * It is a strip rather than a fourth number because the interesting thing about
 * someone's AI side is *who* they talk to, not how many they follow -- and
 * because the favorite cap of three (enforced by
 * `user_companion_relationships_favorite_requires_follow`) is what makes a set
 * of faces safe to put on a card at all. It can never wrap to a second line's
 * worth of avatars the way an uncapped list would.
 *
 * The whole strip is gated with the timeline, since it is a slice of the social
 * graph: `list_profile_favorite_personas` refuses it for a stranger reading a
 * private profile, and the page simply passes nothing.
 */
export function FavoritePersonas({ username, personas, isOwner }: {
  username: string;
  personas: ProfileFollowPersona[];
  isOwner: boolean;
}) {
  // A visitor learns nothing from an empty strip, so it collapses. The owner
  // sees the prompt instead, because for them the emptiness is an action.
  if (!personas.length && !isOwner) return null;

  return <section aria-labelledby="favorite-personas" className="mt-4 rounded-2xl border border-line bg-surface p-3">
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <h3 id="favorite-personas" className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-muted">
        <Star size={14} className="text-sun" aria-hidden="true" fill="currentColor" />
        Favorite AI personas
      </h3>
      <Link href={`/u/${encodeURIComponent(username)}/following?kind=ai`} className="text-xs font-bold text-brand hover:underline">
        {isOwner ? "Manage favorites" : "View AI following"}
      </Link>
    </div>

    {personas.length
      ? <ul className="mt-3 flex flex-wrap gap-2">
        {personas.map((persona) => <li key={persona.id}>
          <Link
            href={`/ai-personas/${encodeURIComponent(persona.slug)}`}
            className="flex items-center gap-2 rounded-full border border-line bg-canvas py-1 pl-1 pr-3 transition-colors hover:border-brand"
          >
            <Avatar initials={initials(persona.name)} avatarUrl={persona.avatar_url} size="sm" ai />
            <span className="text-sm font-bold">{persona.name}</span>
          </Link>
        </li>)}
      </ul>
      : <p className="mt-2 text-sm leading-6 text-muted">
        Star up to three personas on <Link href="/ai-personas" className="font-bold text-brand hover:underline">their pages</Link> and they will show up here.
      </p>}
  </section>;
}
