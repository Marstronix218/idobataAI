"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { AvatarPicker } from "@/components/profile/avatar-picker";
import { apiRequest, errorMessage, isPreviewMode } from "@/lib/client/api";
import { AVATAR_ACCEPTED_TYPES, avatarFileError, avatarObjectPath, storedAvatarObjectPath } from "@/lib/domain/avatar-upload";
import { createClient } from "@/lib/supabase/client";
import type { UserProfile } from "@/types";

const previewProfile: UserProfile = {
  id: "preview",
  username: "mina",
  display_name: "Mina Mori",
  bio: "Building calmer routines, one honest win at a time.",
  avatar_url: null,
  profile_visibility: "private",
  daily_goal: 3,
  interests: ["Work", "Learning", "Wellbeing"],
  default_task_visibility: "private",
  completion_visibility: "private",
  xp: 2840,
  current_streak: 6,
  last_completion_date: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

export function ProfileEditor({ routeUsername = "mina" }: { routeUsername?: string }) {
  const [profile, setProfile] = useState<UserProfile | null>(isPreviewMode ? previewProfile : null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(isPreviewMode ? previewProfile.avatar_url : null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(!isPreviewMode);
  const router = useRouter();

  useEffect(() => {
    if (isPreviewMode) return;
    const controller = new AbortController();
    apiRequest<UserProfile>("/api/profile", { signal: controller.signal })
      .then((loadedProfile) => {
        setProfile(loadedProfile);
        setAvatarUrl(loadedProfile.avatar_url);
      })
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setStatus(errorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, []);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile) return;
    const data = new FormData(event.currentTarget);
    const patch = {
      username: String(data.get("username")),
      displayName: String(data.get("displayName")).trim() || null,
      bio: String(data.get("bio")).trim() || null,
      avatarUrl,
      interests: String(data.get("interests")).split(",").map((item) => item.trim()).filter(Boolean).slice(0, 20),
    };
    setBusy(true);
    setStatus("");
    try {
      const updated = isPreviewMode
        ? { ...profile, username: patch.username, display_name: patch.displayName, bio: patch.bio, avatar_url: patch.avatarUrl, interests: patch.interests }
        : await apiRequest<UserProfile>("/api/profile", { method: "PATCH", body: JSON.stringify(patch) });
      setProfile(updated);
      router.replace(`/u/${updated.username}`);
      router.refresh();
    } catch (error) {
      setStatus(errorMessage(error));
      setBusy(false);
    }
  }

  async function uploadAvatar(file: File) {
    if (!profile) return;
    const validationError = avatarFileError(file);
    if (validationError) {
      setStatus(validationError);
      return;
    }
    setAvatarUploading(true);
    setStatus("");
    try {
      if (isPreviewMode) {
        const previewUrl = URL.createObjectURL(file);
        setAvatarUrl(previewUrl);
        setProfile((current) => current ? { ...current, avatar_url: previewUrl } : current);
        setStatus("Photo selected. Preview only; it will reset when you reload.");
        return;
      }
      const supabase = createClient();
      const objectPath = avatarObjectPath(profile.id, file.type as (typeof AVATAR_ACCEPTED_TYPES)[number], crypto.randomUUID());
      const { error: uploadError } = await supabase.storage.from("avatars").upload(objectPath, file, {
        cacheControl: "3600",
        contentType: file.type,
        upsert: false,
      });
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from("avatars").getPublicUrl(objectPath);
      const oldObjectPath = storedAvatarObjectPath(profile.avatar_url, profile.id);
      let updated: UserProfile;
      try {
        updated = await apiRequest<UserProfile>("/api/profile", { method: "PATCH", body: JSON.stringify({ avatarUrl: data.publicUrl }) });
      } catch (error) {
        await supabase.storage.from("avatars").remove([objectPath]);
        throw error;
      }
      setAvatarUrl(updated.avatar_url);
      setProfile(updated);
      if (oldObjectPath) await supabase.storage.from("avatars").remove([oldObjectPath]);
      setStatus("Profile photo updated. Save separately if you changed other profile fields.");
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setAvatarUploading(false);
    }
  }

  const profileHref = `/u/${profile?.username ?? routeUsername}`;

  return <div className="mx-auto w-full max-w-[620px] border-x border-line bg-canvas">
    <header className="sticky top-0 z-20 flex min-h-16 items-center justify-between gap-3 border-b border-line bg-canvas/88 px-4 backdrop-blur-xl">
      <div className="flex min-w-0 items-center gap-3">
        <Link href={profileHref} className="icon-btn border-transparent bg-transparent" aria-label="Cancel profile editing"><ArrowLeft size={19} /></Link>
        <h1 className="truncate text-xl font-bold">Edit profile</h1>
      </div>
      <button form="profile-edit-form" className="btn btn-primary min-w-20" disabled={busy || avatarUploading || !profile}>{busy ? "Saving…" : "Save"}</button>
    </header>

    {isPreviewMode && <div role="note" className="border-b border-line bg-sun-soft px-4 py-3 text-sm"><strong>Preview mode.</strong> Profile changes will not persist.</div>}

    {profile ? <form id="profile-edit-form" onSubmit={saveProfile} className="space-y-6 p-4 sm:p-6">
      <section className="card p-5 sm:p-6" aria-labelledby="profile-identity-heading">
        <h2 id="profile-identity-heading" className="display text-xl font-bold">Profile identity</h2>
        <p className="mt-2 text-sm leading-6 text-muted">These details appear on your profile and beside progress you choose to share.</p>
        <div className="mt-5 space-y-5">
          <AvatarPicker value={avatarUrl} onChange={setAvatarUrl} onUpload={uploadAvatar} uploading={avatarUploading} initials={profile.username.slice(0, 2).toUpperCase()} disabled={busy} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label className="field-label" htmlFor="profile-display-name">Display name</label><input className="field" id="profile-display-name" name="displayName" defaultValue={profile.display_name ?? ""} maxLength={50} placeholder={profile.username} /></div>
            <div><label className="field-label" htmlFor="profile-username">Username</label><input className="field" id="profile-username" name="username" defaultValue={profile.username} pattern="[A-Za-z0-9_]{3,24}" required /></div>
            <div className="sm:col-span-2"><label className="field-label" htmlFor="profile-bio">Bio</label><textarea className="field min-h-28 resize-y" id="profile-bio" name="bio" defaultValue={profile.bio ?? ""} maxLength={160} placeholder="What are you working toward?" /></div>
            <div className="sm:col-span-2"><label className="field-label" htmlFor="profile-interests">Interests</label><input className="field" id="profile-interests" name="interests" defaultValue={profile.interests.join(", ")} placeholder="Work, Learning" /><p className="mt-2 text-xs leading-5 text-muted">Separate interests with commas. They appear on your profile and help shape your feed.</p></div>
          </div>
        </div>
      </section>
    </form> : <section className="m-4 soft-card p-8 text-center text-muted">Loading your profile…</section>}
    <p className="min-h-10 px-4 pb-5 text-sm font-bold text-muted sm:px-6" aria-live="polite">{status}</p>
  </div>;
}
