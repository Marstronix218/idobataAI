"use client";

import { Check, RefreshCw, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiRequest, errorMessage } from "@/lib/client/api";

export function ProfileFollowButton({
  userId,
  profileName,
  initialFollowing = false,
}: {
  userId: string;
  profileName: string;
  initialFollowing?: boolean;
}) {
  const router = useRouter();
  const [following, setFollowing] = useState(initialFollowing);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [failure, setFailure] = useState("");

  async function toggleFollow() {
    if (busy) return;
    const nextFollowing = !following;
    setFollowing(nextFollowing);
    setBusy(true);
    setStatus("");
    setFailure("");
    try {
      if (nextFollowing) {
        await apiRequest<{ following: true }>(`/api/users/${userId}/follow`, { method: "PUT" });
      } else {
        await apiRequest<void>(`/api/users/${userId}/follow`, { method: "DELETE" });
      }
      setStatus(nextFollowing ? `Now following ${profileName}.` : `No longer following ${profileName}.`);
      router.refresh();
    } catch (error) {
      setFollowing(!nextFollowing);
      setFailure(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return <div className="mb-1 flex flex-col items-end gap-1">
    <button
      type="button"
      aria-label={`${following ? "Unfollow" : "Follow"} ${profileName}`}
      aria-pressed={following}
      className={`btn min-h-11 ${following ? "btn-secondary" : "btn-community"}`}
      disabled={busy}
      onClick={() => void toggleFollow()}
    >
      {busy ? <RefreshCw size={16} className="animate-spin" /> : following ? <Check size={16} /> : <UserPlus size={16} />}
      {following ? "Following" : "Follow"}
    </button>
    {failure && <p role="alert" className="max-w-56 text-right text-xs font-semibold text-danger">{failure}</p>}
    <span className="sr-only" aria-live="polite">{status}</span>
  </div>;
}
