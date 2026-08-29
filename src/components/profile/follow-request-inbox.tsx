"use client";

import Link from "next/link";
import { ArrowLeft, RefreshCw, UserCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { RelativeTime } from "@/components/ui/relative-time";
import { apiRequest, errorMessage, isPreviewMode } from "@/lib/client/api";
import type { FollowRequest } from "@/types";

const previewRequests: FollowRequest[] = [
  { requester_id: "preview-amara", username: "amara", display_name: "Amara Osei", avatar_url: null, bio: "Marathon training and slow mornings.", created_at: new Date(Date.now() - 3_600_000).toISOString() },
  { requester_id: "preview-jonah", username: "jonah", display_name: "Jonah Reed", avatar_url: null, bio: "Shipping one small thing a day.", created_at: new Date(Date.now() - 86_400_000).toISOString() },
];

function requesterName(request: FollowRequest) {
  return request.display_name?.trim() || request.username;
}

/**
 * The owner's side of a protected account. A private profile shows its card to
 * everyone but its timeline to nobody, so without somewhere to answer requests
 * the restriction would be a wall rather than a door.
 */
export function FollowRequestInbox() {
  const [requests, setRequests] = useState<FollowRequest[]>(isPreviewMode ? previewRequests : []);
  const [loading, setLoading] = useState(!isPreviewMode);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [status, setStatus] = useState(isPreviewMode ? "Preview requests are demo data and reset on reload." : "");
  const [failure, setFailure] = useState("");

  useEffect(() => {
    if (isPreviewMode) return;
    const controller = new AbortController();
    apiRequest<{ requests: FollowRequest[] }>("/api/follow-requests", { signal: controller.signal })
      .then((page) => {
        setRequests(page.requests);
        setStatus(page.requests.length ? "" : "No pending follower requests.");
      })
      .catch((error) => { if (!(error instanceof DOMException && error.name === "AbortError")) setFailure(errorMessage(error)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  async function respond(request: FollowRequest, accept: boolean) {
    if (busyId) return;
    setBusyId(request.requester_id);
    setFailure("");
    try {
      if (!isPreviewMode) {
        await apiRequest<{ state: string }>("/api/follow-requests", {
          method: "PUT",
          body: JSON.stringify({ requesterId: request.requester_id, accept }),
        });
      }
      const remaining = requests.filter((item) => item.requester_id !== request.requester_id);
      setRequests(remaining);
      setStatus(`${accept ? "Accepted" : "Declined"} ${requesterName(request)}.${remaining.length ? "" : " No pending follower requests."}`);
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setBusyId(null);
    }
  }

  return <div className="min-w-0 border-x border-line bg-canvas">
    <header className="sticky top-0 z-20 flex min-h-14 items-center gap-4 border-b border-line bg-canvas/88 px-4 backdrop-blur-xl">
      <Link href="/feed" className="icon-btn border-transparent bg-transparent" aria-label="Back to feed"><ArrowLeft size={19} /></Link>
      <div className="min-w-0">
        <h1 className="truncate font-bold">Follower requests</h1>
        <p className="text-xs text-muted">{requests.length} waiting</p>
      </div>
    </header>

    {isPreviewMode && <div role="note" className="border-b border-line bg-sun-soft px-4 py-3 text-sm"><strong>Preview mode.</strong> Follower requests use demo data.</div>}
    {loading && <p className="border-b border-line px-4 py-2 text-center text-xs font-semibold text-muted" aria-live="polite">Checking for requests…</p>}
    {failure && <p role="alert" className="border-b border-line px-4 py-3 text-center text-sm font-semibold text-danger">{failure}</p>}
    <span className="sr-only" aria-live="polite">{status}</span>

    {requests.length ? <ul aria-label="Pending follower requests">
      {requests.map((request) => {
        const name = requesterName(request);
        return <li key={request.requester_id} className="flex flex-wrap items-start gap-3 border-b border-line p-4 sm:p-5">
          <Avatar initials={name.slice(0, 2).toUpperCase()} avatarUrl={request.avatar_url} name={name} />
          <div className="min-w-0 flex-1">
            <Link href={`/u/${encodeURIComponent(request.username)}`} className="flex flex-wrap items-center gap-x-1.5 hover:underline">
              <span className="truncate font-bold">{name}</span>
              <span className="truncate text-sm text-muted">@{request.username}</span>
            </Link>
            <p className="mt-0.5 text-xs text-muted">Asked <RelativeTime value={request.created_at} /></p>
            {request.bio && <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted">{request.bio}</p>}
          </div>
          <div className="flex shrink-0 gap-2">
            <button type="button" className="btn btn-community min-h-11" disabled={busyId === request.requester_id} aria-label={`Accept follower request from ${name}`} onClick={() => void respond(request, true)}>
              {busyId === request.requester_id ? <RefreshCw size={16} className="animate-spin" /> : <UserCheck size={16} />} Accept
            </button>
            <button type="button" className="btn btn-secondary min-h-11" disabled={busyId === request.requester_id} aria-label={`Decline follower request from ${name}`} onClick={() => void respond(request, false)}>
              Decline
            </button>
          </div>
        </li>;
      })}
    </ul> : !loading && <div className="border-b border-line px-6 py-14 text-center">
      <UserCheck size={26} className="mx-auto text-community" />
      <h2 className="display mt-4 text-xl font-bold">Nobody is waiting</h2>
      <p className="mt-2 text-sm text-muted">When someone asks to follow your protected profile, they will appear here.</p>
    </div>}
  </div>;
}
