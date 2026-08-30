"use client";

import Link from "next/link";
import { Check, Clock3, LockKeyhole, RefreshCw, Star, UserPlus, Users } from "lucide-react";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { AIBadge } from "@/components/ui/status";
import { apiRequest, errorMessage, isPreviewMode } from "@/lib/client/api";
import type { HumanFollowState, ProfileFollowPerson, ProfileFollowPersona } from "@/types";

/**
 * The four quadrants of a profile's graph: two directions crossed with two
 * audiences. The page splits them as tabs (direction) and a filter (audience),
 * but the list body only cares about which single quadrant it is rendering.
 */
export type FollowListKind = "followers" | "following" | "ai-followers" | "ai-following";

/** How many personas one account may favorite, matching the check constraint. */
export const FAVORITE_LIMIT = 3;

type Page<T> = { items: T[]; hasMore: boolean };

function initials(name: string) {
  return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function personName(person: ProfileFollowPerson) {
  return person.display_name?.trim() || person.username;
}

/**
 * The first page is rendered on the server so the list is complete without
 * JavaScript; this only ever appends. `offset` is the current length rather
 * than a page number, which keeps it correct after a row is filtered out.
 */
function useFollowPages<T>(userId: string, kind: FollowListKind, initialItems: T[], initialHasMore: boolean) {
  const [items, setItems] = useState<T[]>(initialItems);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState("");

  async function loadMore() {
    if (loading || isPreviewMode) return;
    setLoading(true);
    setFailure("");
    try {
      const page = await apiRequest<Page<T>>(`/api/users/${userId}/follows?kind=${kind}&offset=${items.length}`);
      setItems((current) => [...current, ...page.items]);
      setHasMore(page.hasMore);
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  return { items, setItems, hasMore, loading, failure, setFailure, loadMore };
}

function FollowMoreButton({ hasMore, loading, failure, onLoadMore }: {
  hasMore: boolean;
  loading: boolean;
  failure: string;
  onLoadMore: () => void;
}) {
  return <>
    {failure && <p role="alert" className="border-b border-line px-4 py-3 text-center text-sm font-semibold text-danger">{failure}</p>}
    {hasMore && <div className="border-b border-line p-4 text-center">
      <button type="button" className="btn btn-secondary min-h-11" disabled={loading} onClick={onLoadMore}>
        {loading ? <RefreshCw size={16} className="animate-spin" aria-hidden="true" /> : null} Show more
      </button>
    </div>}
  </>;
}

function EmptyList({ title, body }: { title: string; body: string }) {
  return <div className="border-b border-line px-6 py-14 text-center">
    <Users size={26} className="mx-auto text-community" aria-hidden="true" />
    <h2 className="display mt-4 text-xl font-bold">{title}</h2>
    <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted">{body}</p>
  </div>;
}

/**
 * The people half. Split from the persona half rather than merged because a
 * human follow and an AI follow are not the same edge: the human one is
 * request-gated and reciprocal, the AI one is a relationship state with no
 * request, and the two carry different controls.
 */
export function PeopleFollowList({ userId, kind, initialItems, initialHasMore, emptyTitle, emptyBody }: {
  userId: string;
  kind: "followers" | "following";
  initialItems: ProfileFollowPerson[];
  initialHasMore: boolean;
  emptyTitle: string;
  emptyBody: string;
}) {
  const paged = useFollowPages<ProfileFollowPerson>(userId, kind, initialItems, initialHasMore);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  function stateOf(person: ProfileFollowPerson): HumanFollowState {
    return person.viewer_follows ? "following" : person.viewer_requested ? "requested" : "none";
  }

  async function toggleFollow(person: ProfileFollowPerson) {
    if (busyId) return;
    const previous = stateOf(person);
    // A protected account files a request instead of a follow, and the row
    // already knows which, so the optimistic state is the right one.
    const next: HumanFollowState = previous === "none"
      ? (person.profile_visibility === "private" ? "requested" : "following")
      : "none";
    const apply = (state: HumanFollowState) => paged.setItems((current) => current.map((item) => item.id === person.id
      ? { ...item, viewer_follows: state === "following", viewer_requested: state === "requested" }
      : item));

    apply(next);
    setBusyId(person.id);
    paged.setFailure("");
    setStatus("");
    try {
      const name = personName(person);
      if (next === "none") {
        if (!isPreviewMode) await apiRequest<void>(`/api/users/${person.id}/follow`, { method: "DELETE" });
        setStatus(previous === "requested" ? `Follow request to ${name} withdrawn.` : `No longer following ${name}.`);
      } else {
        const result = isPreviewMode
          ? { state: next }
          : await apiRequest<{ state: HumanFollowState }>(`/api/users/${person.id}/follow`, { method: "PUT" });
        const confirmed = result.state ?? next;
        apply(confirmed);
        setStatus(confirmed === "requested" ? `Follow request sent to ${name}.` : `Now following ${name}.`);
      }
    } catch (error) {
      apply(previous);
      paged.setFailure(errorMessage(error));
    } finally {
      setBusyId(null);
    }
  }

  if (!paged.items.length) return <EmptyList title={emptyTitle} body={emptyBody} />;

  return <>
    <span className="sr-only" aria-live="polite">{status}</span>
    <ul aria-label={kind === "followers" ? "Followers" : "Accounts followed"} className="divide-y divide-line border-b border-line">
      {paged.items.map((person) => {
        const name = personName(person);
        const state = stateOf(person);
        return <li key={person.id} className="flex items-start gap-3 p-4 sm:p-5">
          <Link href={`/u/${encodeURIComponent(person.username)}`} className="shrink-0" tabIndex={-1} aria-hidden="true">
            <Avatar initials={initials(name)} avatarUrl={person.avatar_url} />
          </Link>
          <div className="min-w-0 flex-1">
            <Link href={`/u/${encodeURIComponent(person.username)}`} className="flex flex-wrap items-center gap-x-1.5 hover:underline">
              <span className="truncate font-bold">{name}</span>
              <span className="truncate text-sm text-muted">@{person.username}</span>
              {person.profile_visibility === "private" && <LockKeyhole size={14} className="shrink-0 text-muted" aria-label="Private profile" />}
            </Link>
            {person.bio && <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted">{person.bio}</p>}
          </div>
          {/* The reader's own row has nothing to act on: nobody follows
              themselves, and `set_user_follow` rejects it outright. */}
          {!person.is_viewer && <button
            type="button"
            aria-label={state === "following" ? `Unfollow ${name}` : state === "requested" ? `Cancel follow request to ${name}` : `Follow ${name}`}
            aria-pressed={state !== "none"}
            className={`btn min-h-10 shrink-0 px-3 text-sm ${state === "none" ? "btn-community" : "btn-secondary"}`}
            disabled={busyId === person.id}
            onClick={() => void toggleFollow(person)}
          >
            {busyId === person.id
              ? <RefreshCw size={16} className="animate-spin" aria-hidden="true" />
              : state === "following" ? <Check size={16} aria-hidden="true" />
              : state === "requested" ? <Clock3 size={16} aria-hidden="true" />
              : <UserPlus size={16} aria-hidden="true" />}
            {state === "following" ? "Following" : state === "requested" ? "Requested" : "Follow"}
          </button>}
        </li>;
      })}
    </ul>
    <FollowMoreButton hasMore={paged.hasMore} loading={paged.loading} failure={paged.failure} onLoadMore={() => void paged.loadMore()} />
  </>;
}

/**
 * The persona half, for both AI quadrants. A row also carries the favorite
 * star that the profile card reads back, which the people list has no analogue
 * for.
 */
export function PersonaFollowList({ userId, kind, canFavorite, initialFavoriteCount, initialItems, initialHasMore, emptyTitle, emptyBody }: {
  userId: string;
  kind: "ai-followers" | "ai-following";
  /** Only the profile's owner can change which personas are favorited. */
  canFavorite: boolean;
  initialFavoriteCount: number;
  initialItems: ProfileFollowPersona[];
  initialHasMore: boolean;
  emptyTitle: string;
  emptyBody: string;
}) {
  const paged = useFollowPages<ProfileFollowPersona>(userId, kind, initialItems, initialHasMore);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [favoriteCount, setFavoriteCount] = useState(initialFavoriteCount);
  const [status, setStatus] = useState("");

  async function toggleFollow(persona: ProfileFollowPersona) {
    if (busyId) return;
    const next = !persona.viewer_follows;
    const apply = (following: boolean) => paged.setItems((current) => current.map((item) =>
      item.id === persona.id ? { ...item, viewer_follows: following } : item));

    apply(next);
    setBusyId(persona.id);
    paged.setFailure("");
    setStatus("");
    try {
      // Personas use the relationship endpoint rather than the human follow
      // route: following one is half of a two-way relationship that also
      // carries the persona's own follow state and DM opt-in.
      if (!isPreviewMode) {
        if (next) {
          await apiRequest(`/api/companions/${persona.id}/relationship`, {
            method: "PUT",
            body: JSON.stringify({ action: "follow", following: true }),
          });
        } else {
          await apiRequest(`/api/companions/${persona.id}/relationship`, { method: "DELETE" });
        }
      }
      setStatus(`${next ? "Now following" : "No longer following"} ${persona.name}.${isPreviewMode ? " Preview only." : ""}`);
    } catch (error) {
      apply(!next);
      paged.setFailure(errorMessage(error));
    } finally {
      setBusyId(null);
    }
  }

  /**
   * Favoriting is a preference layered on an existing follow, so a row can only
   * be starred while it is followed and while the account is under the cap. The
   * server enforces both again under an advisory lock; this only keeps the
   * button from promising something the request will refuse.
   */
  async function toggleFavorite(persona: ProfileFollowPersona) {
    if (busyId) return;
    const next = !persona.is_favorite;
    if (next && favoriteCount >= FAVORITE_LIMIT) {
      setStatus(`You can favorite up to ${FAVORITE_LIMIT} AI personas.`);
      return;
    }
    const apply = (favorite: boolean) => paged.setItems((current) => current.map((item) =>
      item.id === persona.id ? { ...item, is_favorite: favorite } : item));

    apply(next);
    setFavoriteCount((count) => count + (next ? 1 : -1));
    setBusyId(persona.id);
    paged.setFailure("");
    setStatus("");
    try {
      if (!isPreviewMode) {
        await apiRequest(`/api/companions/${persona.id}/relationship`, {
          method: "PUT",
          body: JSON.stringify({ action: "favorite", favorite: next }),
        });
      }
      setStatus(`${persona.name} ${next ? "added to" : "removed from"} your favorites.${isPreviewMode ? " Preview only." : ""}`);
    } catch (error) {
      apply(!next);
      setFavoriteCount((count) => count + (next ? -1 : 1));
      paged.setFailure(errorMessage(error));
    } finally {
      setBusyId(null);
    }
  }

  if (!paged.items.length) return <EmptyList title={emptyTitle} body={emptyBody} />;

  return <>
    <span className="sr-only" aria-live="polite">{status}</span>
    {canFavorite && kind === "ai-following" && <p className="border-b border-line px-4 py-3 text-sm text-muted">
      <span className="font-bold text-ink">{favoriteCount} of {FAVORITE_LIMIT} favorites</span> — starred personas show on your profile.
    </p>}
    <ul aria-label={kind === "ai-followers" ? "AI followers" : "AI personas followed"} className="divide-y divide-line border-b border-line">
      {paged.items.map((persona) => <li key={persona.id} className="flex items-start gap-3 p-4 sm:p-5">
        <Link href={`/ai-personas/${encodeURIComponent(persona.slug)}`} className="shrink-0" tabIndex={-1} aria-hidden="true">
          <Avatar initials={initials(persona.name)} avatarUrl={persona.avatar_url} ai />
        </Link>
        <div className="min-w-0 flex-1">
          <Link href={`/ai-personas/${encodeURIComponent(persona.slug)}`} className="flex flex-wrap items-center gap-x-1.5 hover:underline">
            <span className="truncate font-bold">{persona.name}</span>
            <AIBadge />
            <span className="truncate text-sm text-muted">@{persona.slug}</span>
          </Link>
          {persona.personality && <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted">{persona.personality}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* On someone else's list the star is a fact about them, not a
              control -- only the owner can change their own three. */}
          {canFavorite
            ? <button
              type="button"
              aria-label={persona.is_favorite ? `Remove ${persona.name} from favorites` : `Favorite ${persona.name}`}
              aria-pressed={persona.is_favorite}
              className={`icon-btn ${persona.is_favorite ? "border-sun bg-sun-soft text-ink" : "text-muted"}`}
              disabled={busyId === persona.id || (!persona.is_favorite && favoriteCount >= FAVORITE_LIMIT)}
              onClick={() => void toggleFavorite(persona)}
            >
              <Star size={17} aria-hidden="true" fill={persona.is_favorite ? "currentColor" : "none"} />
            </button>
            : persona.is_favorite && <Star size={17} className="text-sun" aria-label="Favorite persona" fill="currentColor" />}
          <button
            type="button"
            aria-label={`${persona.viewer_follows ? "Unfollow" : "Follow"} ${persona.name}`}
            aria-pressed={persona.viewer_follows}
            className={`btn min-h-10 px-3 text-sm ${persona.viewer_follows ? "btn-secondary" : "btn-community"}`}
            disabled={busyId === persona.id}
            onClick={() => void toggleFollow(persona)}
          >
            {busyId === persona.id
              ? <RefreshCw size={16} className="animate-spin" aria-hidden="true" />
              : persona.viewer_follows ? <Check size={16} aria-hidden="true" /> : <UserPlus size={16} aria-hidden="true" />}
            {persona.viewer_follows ? "Following" : "Follow"}
          </button>
        </div>
      </li>)}
    </ul>
    <FollowMoreButton hasMore={paged.hasMore} loading={paged.loading} failure={paged.failure} onLoadMore={() => void paged.loadMore()} />
  </>;
}
