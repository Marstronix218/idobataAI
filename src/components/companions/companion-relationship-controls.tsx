"use client";

import { useRouter } from "next/navigation";
import { Check, MessageCircle, RefreshCw, Trash2, UserPlus, X } from "lucide-react";
import { useState } from "react";
import { apiRequest, errorMessage, isPreviewMode } from "@/lib/client/api";

export type CompanionRelationshipState = {
  user_followed_at: string | null;
  companion_follow_state: string | null;
  dm_opt_in: boolean;
  is_favorite?: boolean;
  favorited_at?: string | null;
};

const emptyRelationship: CompanionRelationshipState = {
  user_followed_at: null,
  companion_follow_state: null,
  dm_opt_in: false,
  is_favorite: false,
  favorited_at: null,
};

function isMutualRelationship(relationship: CompanionRelationshipState) {
  return Boolean(relationship.user_followed_at) && ["accepted", "following", "mutual"].includes(relationship.companion_follow_state ?? "");
}

export function CompanionRelationshipControls({
  companionId,
  companionName,
  initialRelationship,
  initialFavoriteCount = 0,
}: {
  companionId: string;
  companionName: string;
  initialRelationship?: CompanionRelationshipState | null;
  initialFavoriteCount?: number;
}) {
  const router = useRouter();
  const [relationship, setRelationship] = useState(initialRelationship ?? emptyRelationship);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [favoriteCount, setFavoriteCount] = useState(initialFavoriteCount);
  const [status, setStatus] = useState("");
  const isFollowing = Boolean(relationship.user_followed_at);
  const inboundPending = relationship.companion_follow_state === "pending";
  const isMutual = isMutualRelationship(relationship);

  async function changeRelationship(action: "follow" | "unfollow" | "accept" | "decline") {
    const prior = relationship;
    const optimistic: CompanionRelationshipState = action === "follow"
      ? { ...prior, user_followed_at: new Date().toISOString() }
      : action === "unfollow"
        ? { ...prior, user_followed_at: null, dm_opt_in: false, is_favorite: false, favorited_at: null }
        : action === "accept"
          ? { ...prior, companion_follow_state: "following" }
          : { ...prior, companion_follow_state: "none", dm_opt_in: false };
    setBusyAction(action);
    setStatus("");
    setRelationship(optimistic);
    if (action === "unfollow" && prior.is_favorite) setFavoriteCount((count) => Math.max(0, count - 1));
    try {
      if (!isPreviewMode) {
        if (action === "unfollow") {
          await apiRequest<void>(`/api/companions/${companionId}/relationship`, { method: "DELETE" });
        } else {
          const body = action === "follow"
            ? { action: "follow", following: true }
            : { action: "respond", accept: action === "accept" };
          const saved = await apiRequest<{ relationship: CompanionRelationshipState }>(`/api/companions/${companionId}/relationship`, {
            method: "PUT",
            body: JSON.stringify(body),
          });
          setRelationship(saved.relationship);
        }
      }
      setStatus(`${action === "follow" ? "Now following" : action === "unfollow" ? "No longer following" : action === "accept" ? "Follow request accepted" : "Follow request declined"}.${isPreviewMode ? " Preview only." : ""}`);
    } catch (error) {
      setRelationship(prior);
      if (action === "unfollow" && prior.is_favorite) setFavoriteCount((count) => count + 1);
      setStatus(errorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function toggleFavorite() {
    if (!isFollowing) return;
    const prior = relationship;
    const favorite = !Boolean(relationship.is_favorite);
    if (favorite && favoriteCount >= 3) {
      setStatus("You can favorite up to 3 AI personas.");
      return;
    }
    setBusyAction("favorite");
    setStatus("");
    setRelationship({ ...relationship, is_favorite: favorite, favorited_at: favorite ? new Date().toISOString() : null });
    setFavoriteCount((count) => count + (favorite ? 1 : -1));
    try {
      if (!isPreviewMode) {
        const saved = await apiRequest<{ relationship: CompanionRelationshipState }>(`/api/companions/${companionId}/relationship`, {
          method: "PUT",
          body: JSON.stringify({ action: "favorite", favorite }),
        });
        setRelationship(saved.relationship);
      }
      setStatus(`${favorite ? `${companionName} added to Favorites` : `${companionName} removed from Favorites`}.${isPreviewMode ? " Preview only." : ""}`);
    } catch (error) {
      setRelationship(prior);
      setFavoriteCount((count) => count + (favorite ? -1 : 1));
      setStatus(errorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function toggleDmOptIn() {
    if (!isMutual) return;
    const prior = relationship;
    const enabled = !relationship.dm_opt_in;
    setBusyAction("dm");
    setStatus("");
    setRelationship({ ...relationship, dm_opt_in: enabled });
    try {
      if (!isPreviewMode) {
        const saved = await apiRequest<{ relationship: CompanionRelationshipState }>(`/api/companions/${companionId}/relationship`, {
          method: "PUT",
          body: JSON.stringify({ action: "dm-opt-in", enabled }),
        });
        setRelationship(saved.relationship);
      }
      setStatus(`${enabled ? `${companionName} opened a direct message` : "Persona-started messages disabled"}.${isPreviewMode ? " Preview only." : ""}`);
    } catch (error) {
      setRelationship(prior);
      setStatus(errorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function openMessages() {
    setBusyAction("message");
    setStatus("");
    try {
      if (!isPreviewMode) {
        await apiRequest("/api/chat", { method: "POST", body: JSON.stringify({ companionId }) });
      }
      router.push("/chat");
    } catch (error) {
      setStatus(errorMessage(error));
      setBusyAction(null);
    }
  }

  async function clearMemory() {
    if (!window.confirm(`Clear what ${companionName} remembers about your conversations? Your chat history will remain.`)) return;
    setBusyAction("memory");
    setStatus("");
    try {
      if (!isPreviewMode) await apiRequest<void>(`/api/companions/${companionId}/memory`, { method: "DELETE" });
      setStatus(`Conversation memory cleared.${isPreviewMode ? " Preview only." : ""}`);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  return <div className="mt-4 border-t border-line pt-4">
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" aria-pressed={isFollowing} className={`btn min-h-11 ${isFollowing ? "btn-secondary" : "btn-community"}`} disabled={Boolean(busyAction)} onClick={() => void changeRelationship(isFollowing ? "unfollow" : "follow")}>
        {busyAction === "follow" || busyAction === "unfollow" ? <RefreshCw size={16} className="animate-spin" /> : isFollowing ? <Check size={16} /> : <UserPlus size={16} />}
        {isFollowing ? "Following" : "Follow"}
      </button>
      <button type="button" className="btn btn-secondary min-h-11" disabled={Boolean(busyAction)} onClick={() => void openMessages()}>
        {busyAction === "message" ? <RefreshCw size={16} className="animate-spin" /> : <MessageCircle size={16} />}
        Message
      </button>
      <button type="button" aria-pressed={Boolean(relationship.is_favorite)} className={`btn min-h-11 ${relationship.is_favorite ? "border-sun bg-sun-soft text-ink" : "btn-secondary"}`} disabled={Boolean(busyAction) || !isFollowing || (!relationship.is_favorite && favoriteCount >= 3)} onClick={() => void toggleFavorite()}>
        {relationship.is_favorite ? "★ Favorited" : "☆ Favorite"}
      </button>
      <span className={`badge ${isMutual ? "badge-public" : "badge-category"}`}>{isMutual ? "Mutual connection" : inboundPending ? "Follow request pending" : isFollowing ? "You follow this persona" : "Not connected"}</span>
    </div>
    <p className="mt-3 text-xs font-extrabold text-brand">{favoriteCount} / 3 Favorites</p>
    {!isFollowing && <p className="mt-1 text-xs text-muted">Follow this persona to add them to Favorites.</p>}

    {inboundPending && <div className="mt-4 rounded-xl border border-community/30 bg-community-soft p-3">
      <p className="text-sm font-bold">{companionName} wants to follow you.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn btn-community min-h-10 text-sm" disabled={Boolean(busyAction)} onClick={() => void changeRelationship("accept")}><Check size={16} /> Accept</button>
        <button type="button" className="btn btn-secondary min-h-10 text-sm" disabled={Boolean(busyAction)} onClick={() => void changeRelationship("decline")}><X size={16} /> Decline</button>
      </div>
    </div>}

    {isMutual && <label className="mt-4 flex min-h-11 cursor-pointer items-center justify-between gap-4 rounded-xl border border-line px-3 py-2">
      <span><span className="block text-sm font-bold">Allow direct messages</span><span className="block text-xs leading-5 text-muted">On first opt-in, this AI persona opens one private conversation with you.</span></span>
      <input type="checkbox" className="h-5 w-5 accent-brand" checked={relationship.dm_opt_in} disabled={Boolean(busyAction)} onChange={() => void toggleDmOptIn()} />
    </label>}

    <div className="mt-4 rounded-xl bg-surface/60 p-3 text-xs leading-5 text-muted">
      <p>This AI persona may retain limited conversation memory to keep chats coherent. Memory is private to your interactions and can be cleared at any time.</p>
      <button type="button" className="btn btn-ghost mt-2 min-h-10 px-2 text-danger" disabled={Boolean(busyAction)} onClick={() => void clearMemory()}>
        {busyAction === "memory" ? <RefreshCw size={15} className="animate-spin" /> : <Trash2 size={15} />} Clear memory
      </button>
    </div>
    <p className="mt-3 min-h-5 text-sm font-bold text-muted" aria-live="polite">{status}</p>
  </div>;
}
