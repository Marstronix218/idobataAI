"use client";

import Link from "next/link";
import { Check, RefreshCw, Search, UserPlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { AIBadge } from "@/components/ui/status";
import { apiRequest, errorMessage, isPreviewMode } from "@/lib/client/api";
import type { DirectoryPersona, DirectoryUser } from "@/types";

const SEARCH_DEBOUNCE_MS = 300;
const MAX_QUERY_LENGTH = 50;

type DirectoryResults = { people: DirectoryUser[]; personas: DirectoryPersona[] };

const previewResults: DirectoryResults = {
  people: [
    { id: "preview-jonah", username: "jonah", display_name: "Jonah Reed", avatar_url: null, bio: "Shipping one small thing a day.", follower_count: 12, viewer_follows: false },
    { id: "preview-amara", username: "amara", display_name: "Amara Osei", avatar_url: null, bio: "Marathon training and slow mornings.", follower_count: 34, viewer_follows: true },
  ],
  personas: [
    { id: "preview-moss", slug: "moss", name: "Moss", avatar_url: null, personality: "An ancient tree observing the city.", viewer_follows: false },
  ],
};

function initials(name: string) {
  return name.slice(0, 2).toUpperCase();
}

function personName(person: DirectoryUser) {
  return person.display_name?.trim() || person.username;
}

function matchesPreview(haystack: string, needle: string) {
  return haystack.toLowerCase().includes(needle.replace(/^@+/, "").toLowerCase());
}

/**
 * Handle search, sized to sit beside the feed's own heading. It covers both
 * halves of the community -- people and AI personas -- because a reader
 * searching a name has no reason to know, or care, which kind they are looking
 * for. Results drop over the timeline rather than pushing it down, so an idle
 * search box costs the feed no vertical space; it dismisses on blur and Escape,
 * the same way the post menus in this file do.
 */
export function DirectorySearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DirectoryResults>(isPreviewMode ? previewResults : { people: [], personas: [] });
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [failure, setFailure] = useState("");
  // A stale search must never overwrite a newer one: keystrokes are debounced,
  // but two requests can still be in flight when the network is slow.
  const requestId = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const trimmedQuery = query.trim();
  // Preview mode has no API to call, so it filters the seed lists at render
  // rather than round-tripping them through state.
  const people = isPreviewMode
    ? results.people.filter((person) => matchesPreview(`${person.username} ${person.display_name ?? ""}`, trimmedQuery))
    : results.people;
  const personas = isPreviewMode
    ? results.personas.filter((persona) => matchesPreview(`${persona.slug} ${persona.name}`, trimmedQuery))
    : results.personas;
  const total = people.length + personas.length;
  const showResults = open && trimmedQuery.length > 0;

  // Clearing lives in the change handler rather than the effect: emptying the
  // box is an event, and a synchronous setState in an effect body cascades a
  // render per keystroke.
  function updateQuery(next: string) {
    setQuery(next);
    setOpen(true);
    if (!next.trim() && !isPreviewMode) {
      setResults({ people: [], personas: [] });
      setLoading(false);
      setFailure("");
    }
  }

  useEffect(() => {
    const id = ++requestId.current;
    const trimmed = query.trim();
    // Searches on demand only: an empty box means the reader wants the feed,
    // not a list of strangers over it.
    if (!trimmed || isPreviewMode) return;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      apiRequest<DirectoryResults>(
        `/api/directory/search?query=${encodeURIComponent(trimmed)}`,
        { signal: controller.signal },
      )
        .then((result) => {
          if (id !== requestId.current) return;
          setResults(result);
          setFailure("");
          const found = result.people.length + result.personas.length;
          setStatus(found
            ? `${found} ${found === 1 ? "result" : "results"} found.`
            : `Nothing matches “${trimmed}”.`);
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          if (id !== requestId.current) return;
          setFailure(errorMessage(error));
        })
        .finally(() => { if (id === requestId.current && !controller.signal.aborted) setLoading(false); });
    }, SEARCH_DEBOUNCE_MS);

    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);

  async function followPerson(person: DirectoryUser) {
    const nextFollowing = !person.viewer_follows;
    // Optimistic, and reverted below on failure: a follow that takes a round
    // trip to visibly land reads as a button that did nothing.
    const apply = (following: boolean) => setResults((current) => ({ ...current, people: current.people.map((item) =>
      item.id === person.id
        ? { ...item, viewer_follows: following, follower_count: person.follower_count + (following ? 1 : 0) - (person.viewer_follows ? 1 : 0) }
        : item) }));
    apply(nextFollowing);
    try {
      if (!isPreviewMode) {
        await apiRequest(`/api/users/${person.id}/follow`, { method: nextFollowing ? "PUT" : "DELETE" });
      }
      return nextFollowing;
    } catch (error) {
      apply(person.viewer_follows);
      throw error;
    }
  }

  async function followPersona(persona: DirectoryPersona) {
    const nextFollowing = !persona.viewer_follows;
    const apply = (following: boolean) => setResults((current) => ({ ...current, personas: current.personas.map((item) =>
      item.id === persona.id ? { ...item, viewer_follows: following } : item) }));
    apply(nextFollowing);
    try {
      if (!isPreviewMode) {
        // Personas use the relationship endpoint rather than the human follow
        // route: following one is half of a two-way relationship that also
        // carries the persona's own follow state and DM opt-in.
        if (nextFollowing) {
          await apiRequest(`/api/companions/${persona.id}/relationship`, {
            method: "PUT",
            body: JSON.stringify({ action: "follow", following: true }),
          });
        } else {
          await apiRequest(`/api/companions/${persona.id}/relationship`, { method: "DELETE" });
        }
      }
      return nextFollowing;
    } catch (error) {
      apply(persona.viewer_follows);
      throw error;
    }
  }

  async function toggleFollow(id: string, name: string, run: () => Promise<boolean>) {
    if (busyId) return;
    setBusyId(id);
    setFailure("");
    try {
      const nowFollowing = await run();
      setStatus(`${nowFollowing ? "Now following" : "No longer following"} ${name}.${isPreviewMode ? " Preview only." : ""}`);
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setBusyId(null);
    }
  }

  function followButton(id: string, name: string, following: boolean, run: () => Promise<boolean>) {
    return <button
      type="button"
      aria-label={`${following ? "Unfollow" : "Follow"} ${name}`}
      aria-pressed={following}
      className={`btn min-h-10 shrink-0 px-3 text-sm ${following ? "btn-secondary" : "btn-community"}`}
      disabled={busyId === id}
      onClick={() => void toggleFollow(id, name, run)}
    >
      {busyId === id
        ? <RefreshCw size={16} className="animate-spin" aria-hidden="true" />
        : following ? <Check size={16} aria-hidden="true" /> : <UserPlus size={16} aria-hidden="true" />}
      {following ? "Following" : "Follow"}
    </button>;
  }

  return <div
    className="relative ml-auto min-w-0 w-full max-w-[min(100%,42rem)] sm:max-w-[42rem]"
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
    onKeyDown={(event) => {
      if (event.key !== "Escape") return;
      // Refocus first: focusing re-fires onFocus, so closing afterwards is what
      // makes the dismissal stick regardless of where focus started.
      inputRef.current?.focus();
      // First Escape dismisses the results, a second clears the box, matching
      // how a search field behaves everywhere else.
      if (showResults) setOpen(false); else updateQuery("");
    }}
  >
    <label htmlFor="directory-search" className="sr-only">Search account</label>
    {/* `.field` is unlayered CSS, so it outranks Tailwind utilities: the input's
        height and padding come from that class, and `field-prefixed` reserves
        the 2.5rem gutter this icon sits in. */}
    <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={16} aria-hidden="true" />
    <input
      ref={inputRef}
      id="directory-search"
      type="search"
      className="field field-prefixed rounded-full text-sm"
      placeholder="Search account"
      maxLength={MAX_QUERY_LENGTH}
      value={query}
      onChange={(event) => updateQuery(event.target.value)}
      onFocus={() => setOpen(true)}
    />
    <p aria-live="polite" className="sr-only">{status}</p>

    {showResults && <div className="absolute right-0 top-full z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-line bg-surface-raised shadow-lg">
      {failure && <p role="alert" className="border-b border-line px-4 py-3 text-sm font-semibold text-danger">{failure}</p>}

      {loading && !total && <p className="flex items-center gap-2 px-4 py-4 text-sm text-muted">
        <RefreshCw size={16} className="animate-spin" aria-hidden="true" /> Searching…
      </p>}

      {!loading && !total && <div className="px-4 py-5 text-center">
        <p className="font-bold">No matches</p>
        <p className="mt-1 text-sm leading-6 text-muted">
          Check the user ID or persona name. Private accounts do not appear here.
        </p>
      </div>}

      <div className="max-h-80 overflow-y-auto">
        {people.length > 0 && <section aria-labelledby="directory-people-heading">
          <h2 id="directory-people-heading" className="border-b border-line bg-canvas px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-muted">People</h2>
          <ul className="divide-y divide-line">
            {people.map((person) => {
              const name = personName(person);
              return <li key={person.id} className="flex items-center gap-3 px-3 py-3">
                <Link href={`/u/${person.username}`} className="shrink-0" tabIndex={-1} aria-hidden="true">
                  <Avatar initials={initials(name)} avatarUrl={person.avatar_url} />
                </Link>
                <div className="min-w-0 flex-1">
                  <Link href={`/u/${person.username}`} className="block truncate font-bold hover:underline">{name}</Link>
                  <p className="truncate text-sm text-muted">@{person.username}</p>
                  <p className="text-xs text-muted">
                    {person.follower_count} {person.follower_count === 1 ? "follower" : "followers"}
                  </p>
                </div>
                {followButton(person.id, name, person.viewer_follows, () => followPerson(person))}
              </li>;
            })}
          </ul>
        </section>}

        {personas.length > 0 && <section aria-labelledby="directory-personas-heading">
          <h2 id="directory-personas-heading" className="border-y border-line bg-canvas px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-muted">AI personas</h2>
          <ul className="divide-y divide-line">
            {personas.map((persona) => <li key={persona.id} className="flex items-center gap-3 px-3 py-3">
              <Link href={`/ai-personas/${persona.slug}`} className="shrink-0" tabIndex={-1} aria-hidden="true">
                <Avatar initials={initials(persona.name)} avatarUrl={persona.avatar_url} ai />
              </Link>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <Link href={`/ai-personas/${persona.slug}`} className="truncate font-bold hover:underline">{persona.name}</Link>
                  <AIBadge />
                </div>
                <p className="truncate text-sm text-muted">@{persona.slug}</p>
                <p className="truncate text-xs text-muted">{persona.personality}</p>
              </div>
              {followButton(persona.id, persona.name, persona.viewer_follows, () => followPersona(persona))}
            </li>)}
          </ul>
        </section>}
      </div>
    </div>}
  </div>;
}
