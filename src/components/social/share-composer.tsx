"use client";

import Link from "next/link";
import { ArrowLeft, Check, Eye, Globe2, ImagePlus, LockKeyhole, Send, ShieldCheck, X } from "lucide-react";
import { ChangeEvent, useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { PostMediaGrid } from "@/components/social/post-media-grid";
import { PrivacyBadge } from "@/components/ui/status";
import { apiRequest, errorMessage, isPreviewMode } from "@/lib/client/api";
import { POST_MEDIA_MAX_BYTES, POST_MEDIA_MAX_FILES, isPostMediaType } from "@/lib/domain/post-media";
import { createClient } from "@/lib/supabase/client";
import type { SocialPost, Task, UserProfile } from "@/types";

type Attachment = { id: string; file: File; previewUrl: string };
type UploadTicket = { path: string; token: string };

const previewTask = (taskId: string): Task => ({
  id: taskId,
  owner_id: "preview",
  title: "Draft the project kickoff outline",
  description: null,
  category: "Work",
  due_at: null,
  recurrence_rule: null,
  recurrence_instance_id: null,
  visibility: "public",
  status: "completed",
  xp_earned: 25,
  completed_at: "2026-08-12T12:14:00.000Z",
  created_at: "2026-08-12T12:14:00.000Z",
  updated_at: "2026-08-12T12:14:00.000Z",
});

export function ShareComposer({ taskId }: { taskId: string }) {
  const [message, setMessage] = useState("");
  const [task, setTask] = useState<Task | null>(() => isPreviewMode ? previewTask(taskId) : null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [audience, setAudience] = useState<"public" | "private">("private");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [posted, setPosted] = useState(false);
  const [busy, setBusy] = useState(!isPreviewMode);
  const [status, setStatus] = useState("");
  const objectUrls = useRef(new Set<string>());

  useEffect(() => () => {
    objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrls.current.clear();
  }, []);

  useEffect(() => {
    if (isPreviewMode) return;
    const controller = new AbortController();
    Promise.all([
      apiRequest<Task[]>("/api/tasks", { signal: controller.signal }),
      apiRequest<UserProfile>("/api/profile", { signal: controller.signal }),
    ])
      .then(([tasks, loadedProfile]) => {
        setTask(tasks.find((item) => item.id === taskId) ?? null);
        setProfile(loadedProfile);
        setAudience(loadedProfile.completion_visibility);
      })
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setStatus(errorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [taskId]);

  function chooseImages(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = "";
    const room = POST_MEDIA_MAX_FILES - attachments.length;
    if (room <= 0) {
      setStatus(`You can add up to ${POST_MEDIA_MAX_FILES} images.`);
      return;
    }

    const accepted: Attachment[] = [];
    let rejected = false;
    for (const file of selected.slice(0, room)) {
      if (!isPostMediaType(file.type) || file.size <= 0 || file.size > POST_MEDIA_MAX_BYTES) {
        rejected = true;
        continue;
      }
      const previewUrl = URL.createObjectURL(file);
      objectUrls.current.add(previewUrl);
      accepted.push({ id: `${file.name}-${file.lastModified}-${previewUrl}`, file, previewUrl });
    }
    setAttachments((current) => [...current, ...accepted]);
    if (selected.length > room) setStatus(`Only the first ${room} image${room === 1 ? "" : "s"} fit. The limit is ${POST_MEDIA_MAX_FILES}.`);
    else if (rejected) setStatus("Some images were skipped. Use JPEG, PNG, or WebP files up to 5MB.");
    else setStatus(accepted.length ? `${accepted.length} image${accepted.length === 1 ? "" : "s"} added. Nothing is posted yet.` : "");
  }

  function removeImage(id: string) {
    setAttachments((current) => {
      const removed = current.find((item) => item.id === id);
      if (removed) {
        URL.revokeObjectURL(removed.previewUrl);
        objectUrls.current.delete(removed.previewUrl);
      }
      return current.filter((item) => item.id !== id);
    });
  }

  async function cleanupUploads(paths: string[]) {
    if (!paths.length || isPreviewMode) return;
    try {
      await apiRequest<void>("/api/uploads/completion-images", { method: "DELETE", body: JSON.stringify({ paths }) });
    } catch {
      // The private pending path remains inaccessible and can be removed by periodic storage cleanup.
    }
  }

  async function publish() {
    if (!task || task.status !== "completed" || posted) return;
    setBusy(true);
    setStatus(attachments.length ? "Uploading your images…" : "Posting your win…");
    const uploadedPaths: string[] = [];
    try {
      if (!isPreviewMode && attachments.length) {
        const tickets = await apiRequest<UploadTicket[]>("/api/uploads/completion-images", {
          method: "POST",
          body: JSON.stringify({ files: attachments.map(({ file }) => ({ type: file.type, size: file.size })) }),
        });
        const supabase = createClient();
        for (let index = 0; index < attachments.length; index += 1) {
          const ticket = tickets[index];
          const file = attachments[index].file;
          const { error } = await supabase.storage
            .from("completion-post-media")
            .uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: file.type, upsert: false });
          if (error) throw error;
          uploadedPaths.push(ticket.path);
        }
      }

      if (!isPreviewMode) {
        await apiRequest<SocialPost>(`/api/tasks/${encodeURIComponent(task.id)}/publish`, {
          method: "POST",
          body: JSON.stringify({
            message: message.trim() || null,
            visibility: audience,
            recurrenceInstanceId: task.recurrence_instance_id,
            ...(uploadedPaths.length ? { imagePaths: uploadedPaths } : {}),
          }),
        });
      }
      setPosted(true);
      setStatus(`Your win is posted ${audience === "public" ? "to the community" : "privately"}${attachments.length ? ` with ${attachments.length} image${attachments.length === 1 ? "" : "s"}` : ""}.${isPreviewMode ? " Preview only." : ""}`);
    } catch (error) {
      await cleanupUploads(uploadedPaths);
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const name = profile?.username ?? "You";
  const userInitials = name.slice(0, 2).toUpperCase();
  const previewUrls = attachments.map((item) => item.previewUrl);

  return <div className="app-page share-page">
    {isPreviewMode && <div role="note" className="mb-5 rounded-2xl bg-sun-soft p-4 text-sm"><strong>Preview mode.</strong> Publishing is simulated and nothing is persisted.</div>}
    <header className="flex items-center gap-3"><Link href="/tasks" className="icon-btn" aria-label="Back to Your Tasks"><ArrowLeft size={18} /></Link><div><p className="text-xs font-bold uppercase tracking-[.1em] text-brand">Completed task</p><h1 className="page-title">Post a win</h1></div></header>

    {busy && !task ? <div className="soft-card mt-7 p-10 text-center text-muted">Loading your completed task…</div> : !task ? <div className="soft-card mt-7 p-10 text-center"><h2 className="display text-xl font-bold">Task not found.</h2><p className="mt-2 text-muted">Return to Your Tasks and choose a completed item.</p></div> : task.status !== "completed" ? <div className="soft-card mt-7 p-10 text-center"><h2 className="display text-xl font-bold">Complete this task before sharing.</h2><Link href="/tasks" className="btn btn-primary mt-5">Back to Your Tasks</Link></div> : <div className="mt-7 grid gap-6 lg:grid-cols-[minmax(0,1fr)_390px]">
      <section className="card p-5 sm:p-7">
        <h2 className="display text-xl font-bold">Tell the story</h2>
        <p className="mt-2 text-sm leading-6 text-muted">A note and photos are optional. Nothing is posted until you press the final button.</p>

        <div className="mt-6"><label className="field-label" htmlFor="task-title">Completed task</label><input id="task-title" className="field font-bold" value={task.title} readOnly /></div>
        <div className="mt-5"><div className="flex items-center justify-between"><label className="field-label" htmlFor="post-message">Personal note <span className="font-normal text-muted">optional</span></label><span className="text-xs font-bold text-muted">{message.length}/500</span></div><textarea id="post-message" className="field min-h-32 resize-y leading-6" maxLength={500} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="What made this win meaningful?" /></div>

        <div className="mt-5">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="field-label mb-1">Photos <span className="font-normal text-muted">optional</span></p><p className="text-xs text-muted">Up to 4 JPEG, PNG, or WebP images · 5MB each</p></div><label htmlFor="post-images" className={`btn btn-secondary ${attachments.length >= POST_MEDIA_MAX_FILES ? "pointer-events-none opacity-50" : ""}`}><ImagePlus size={17} /> Add photos</label></div>
          <input id="post-images" type="file" className="sr-only" accept="image/jpeg,image/png,image/webp" multiple onChange={chooseImages} disabled={attachments.length >= POST_MEDIA_MAX_FILES || busy || posted} />
          {attachments.length > 0 && <div className="mt-4 grid grid-cols-2 gap-2" aria-label="Selected photos">{attachments.map((item, index) => <div key={item.id} className="relative min-h-36 overflow-hidden rounded-2xl border border-line bg-canvas">
            {/* Local object URLs are intentionally rendered without the remote image optimizer. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.previewUrl} alt={`Selected completion photo ${index + 1}`} className="absolute inset-0 h-full w-full object-cover" />
            <button type="button" className="icon-btn absolute right-2 top-2 h-9 w-9 border-white/25 bg-overlay/75 text-white" onClick={() => removeImage(item.id)} aria-label={`Remove photo ${index + 1}`}><X size={16} /></button>
          </div>)}</div>}
        </div>

        <fieldset className="mt-6"><legend className="field-label">Who can see this post?</legend><div className="grid gap-3 sm:grid-cols-2"><button type="button" aria-pressed={audience === "public"} onClick={() => setAudience("public")} className={`flex items-start gap-3 rounded-2xl border p-4 text-left transition-colors ${audience === "public" ? "border-community bg-community-soft" : "border-line hover:bg-[var(--hover)]"}`}><Globe2 size={20} className="shrink-0 text-community" /><span><strong>Community</strong><small className="mt-1 block leading-5 text-muted">Signed-in members can see the post and photos.</small></span></button><button type="button" aria-pressed={audience === "private"} onClick={() => setAudience("private")} className={`flex items-start gap-3 rounded-2xl border p-4 text-left transition-colors ${audience === "private" ? "border-brand bg-brand-soft" : "border-line hover:bg-[var(--hover)]"}`}><LockKeyhole size={20} className="shrink-0 text-brand" /><span><strong>Only me</strong><small className="mt-1 block leading-5 text-muted">Keep the accomplishment and photos private.</small></span></button></div><p className="mt-3 text-xs leading-5 text-muted">This choice applies to this post only. <Link href="/settings#privacy" className="font-bold text-brand hover:underline">Change your default in Settings</Link>.</p></fieldset>
        <div className="mt-5 flex items-start gap-2 rounded-2xl bg-community-soft p-4 text-sm leading-6 text-community"><ShieldCheck size={18} className="mt-0.5 shrink-0" /><p>Photos use private storage. The app creates short-lived links only after confirming who can see the post.</p></div>
      </section>

      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="mb-3 flex items-center gap-2 text-sm font-bold text-muted"><Eye size={16} /> Post preview</div>
        <article className="card overflow-hidden"><div className="p-5"><header className="flex items-center gap-3"><Avatar initials={userInitials} avatarUrl={profile?.avatar_url} name={name} /><div><div className="flex items-center gap-2"><p className="font-bold">{name}</p><PrivacyBadge isPublic={audience === "public"} /></div><p className="text-xs text-muted">Just now · Completed a task</p></div></header>{message && <p className="mt-4 leading-7">{message}</p>}<div className="mt-4 rounded-2xl border border-line bg-canvas/65 p-4"><p className="text-xs font-bold uppercase tracking-[.1em] text-muted">Completed</p><p className="mt-1 font-bold">{task.title}</p><div className="mt-3 flex flex-wrap gap-2">{task.category && <span className="badge badge-category">{task.category}</span>}{profile && <span className="badge badge-streak">🔥 {profile.current_streak}-day streak</span>}<span className="badge badge-private">{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(task.completed_at!))}</span></div></div></div><PostMediaGrid urls={previewUrls} alt={`Photo attached to ${task.title}`} className="rounded-none border-x-0 border-b-0" /></article>
        {posted ? <div className="animate-rise mt-4 rounded-2xl bg-success-soft p-5 text-success" role="status"><div className="flex items-center gap-2 font-bold"><Check size={18} /> Your win is posted.</div><Link href="/feed" className="btn btn-community mt-4 w-full">View in feed</Link></div> : <button className="btn btn-primary mt-4 w-full py-3" onClick={() => void publish()} disabled={busy}><Send size={17} /> {busy ? attachments.length ? "Uploading & posting…" : "Posting…" : `Post ${audience === "public" ? "to Community" : "privately"}`}</button>}
        <Link href="/tasks" className="btn btn-ghost mt-2 w-full">Keep private for now</Link>
      </aside>
    </div>}
    <p className="mt-4 text-sm font-bold text-muted" aria-live="polite">{status}</p>
  </div>;
}
