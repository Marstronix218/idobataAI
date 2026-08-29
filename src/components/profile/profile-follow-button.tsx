"use client";

import { Check, Clock3, RefreshCw, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiRequest, errorMessage } from "@/lib/client/api";
import type { HumanFollowState } from "@/types";

const LABELS: Record<HumanFollowState, string> = {
  none: "Follow",
  requested: "Requested",
  following: "Following",
};

// A protected account cannot be followed outright, so the same control means
// three different things depending on where the viewer stands with it.
function actionLabel(state: HumanFollowState, profileName: string) {
  if (state === "following") return `Unfollow ${profileName}`;
  if (state === "requested") return `Cancel follow request to ${profileName}`;
  return `Follow ${profileName}`;
}

export function ProfileFollowButton({
  userId,
  profileName,
  initialState = "none",
  isPrivate = false,
}: {
  userId: string;
  profileName: string;
  initialState?: HumanFollowState;
  isPrivate?: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<HumanFollowState>(initialState);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [failure, setFailure] = useState("");

  async function toggleFollow() {
    if (busy) return;
    // The page already knows whether the profile is protected, so the optimistic
    // state can be the right one rather than a guess corrected on response.
    const nextState: HumanFollowState = state === "none" ? (isPrivate ? "requested" : "following") : "none";
    setState(nextState);
    setBusy(true);
    setStatus("");
    setFailure("");
    try {
      if (nextState === "none") {
        await apiRequest<void>(`/api/users/${userId}/follow`, { method: "DELETE" });
        setStatus(state === "requested" ? `Follow request to ${profileName} withdrawn.` : `No longer following ${profileName}.`);
      } else {
        const result = await apiRequest<{ state: HumanFollowState }>(`/api/users/${userId}/follow`, { method: "PUT" });
        const confirmed = result.state ?? nextState;
        setState(confirmed);
        setStatus(confirmed === "requested" ? `Follow request sent to ${profileName}.` : `Now following ${profileName}.`);
      }
      router.refresh();
    } catch (error) {
      setState(state);
      setFailure(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return <div className="mb-1 flex flex-col items-end gap-1">
    <button
      type="button"
      aria-label={actionLabel(state, profileName)}
      aria-pressed={state !== "none"}
      className={`btn min-h-11 ${state === "none" ? "btn-community" : "btn-secondary"}`}
      disabled={busy}
      onClick={() => void toggleFollow()}
    >
      {busy ? <RefreshCw size={16} className="animate-spin" /> : state === "following" ? <Check size={16} /> : state === "requested" ? <Clock3 size={16} /> : <UserPlus size={16} />}
      {LABELS[state]}
    </button>
    {failure && <p role="alert" className="max-w-56 text-right text-xs font-semibold text-danger">{failure}</p>}
    <span className="sr-only" aria-live="polite">{status}</span>
  </div>;
}
