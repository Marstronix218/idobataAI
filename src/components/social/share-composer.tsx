"use client";

import Link from "next/link";
import { Check, Globe2, ImagePlus, LockKeyhole, ShieldCheck, X } from "lucide-react";
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { apiRequest, errorMessage, isPreviewMode } from "@/lib/client/api";
import { POST_MEDIA_MAX_BYTES, POST_MEDIA_MAX_FILES, isPostMediaType } from "@/lib/domain/post-media";
import { createClient } from "@/lib/supabase/client";
import type { SocialPost, Task, UserProfile } from "@/types";

type Attachment = { id: string; file: File; previewUrl: string };
type UploadTicket = { path: string; token: string };

const DEFAULT_COMPLETION_NOTE = "Glad to have this one wrapped up.";

const previewTask = (taskId: string): Task => ({
  id: taskId,
  owner_id: "preview",
  title: "Draft the project kickoff outline",
  description: null,
  category: "Work",
  due_at: null,
  recurrence_rule: null,
  recurrence_instance_id: null,
  priority: 4,
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

  const name = profile?.display_name?.trim() || profile?.username || "You";
  const handle = profile?.username ? `@${profile.username}` : "@you";
  const userInitials = name.slice(0, 2).toUpperCase();
  const postButtonLabel = busy
    ? attachments.length ? "Uploading & posting…" : "Posting…"
    : audience === "public" ? "Post to Community" : "Post privately";

  function submit(event: FormEvent) {
    event.preventDefault();
    void publish();
  }

  return <div className="app-page">
    {isPreviewMode && <div role="note" className="mx-auto mb-4 max-w-[640px] rounded-2xl bg-sun-soft p-4 text-sm"><strong>Preview mode.</strong> Publishing is simulated and nothing is persisted.</div>}

    <section aria-label="Post your completed task" className="mx-auto max-w-[640px] overflow-hidden rounded-[1.25rem] border border-line bg-surface shadow-[var(--shadow-card)]">
      <header className="flex min-h-16 items-center gap-3 border-b border-line px-3 sm:px-4">
        <Link href="/tasks" className="icon-btn border-transparent bg-transparent" aria-label="Back to Your Tasks"><X size={20} /></Link>
        <h1 className="display text-xl font-bold">Post a win</h1>
        {task?.status === "completed" && !posted && <button type="submit" form="completion-post-form" className="btn btn-primary ml-auto px-5 py-2" disabled={busy}>{postButtonLabel}</button>}
      </header>

      {busy && !task ? <div className="p-10 text-center text-muted">Loading your completed task…</div> : !task ? <div className="p-10 text-center"><h2 className="display text-xl font-bold">Task not found.</h2><p className="mt-2 text-muted">Return to Your Tasks and choose a completed item.</p></div> : task.status !== "completed" ? <div className="p-10 text-center"><h2 className="display text-xl font-bold">Complete this task before sharing.</h2><Link href="/tasks" className="btn btn-primary mt-5">Back to Your Tasks</Link></div> : posted ? <div className="animate-rise p-8 text-center" role="status"><span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-success-soft text-success"><Check size={23} /></span><h2 className="display mt-4 text-xl font-bold">Your win is posted.</h2><p className="mt-2 text-sm leading-6 text-muted">It was shared {audience === "public" ? "with the community" : "privately"}.</p><Link href="/feed" className="btn btn-community mt-5">View in feed</Link></div> : <form id="completion-post-form" onSubmit={submit}>
        <div className="flex items-start gap-3 p-4 sm:p-5">
          <span className="mt-1"><Avatar initials={userInitials} avatarUrl={profile?.avatar_url} name={name} /></span>
          <div className="min-w-0 flex-1">
            <fieldset>
              <legend className="sr-only">Who can see this post?</legend>
              <div className="segmented mb-3 w-full sm:w-fit">
                <button type="button" aria-pressed={audience === "public"} onClick={() => setAudience("public")} disabled={busy}><Globe2 size={16} /> Community</button>
                <button type="button" aria-pressed={audience === "private"} onClick={() => setAudience("private")} disabled={busy}><LockKeyhole size={16} /> Only me</button>
              </div>
            </fieldset>

            <label className="sr-only" htmlFor="post-message">Comment on your completed task</label>
            <textarea id="post-message" className="min-h-28 w-full resize-none bg-transparent py-2 text-[1.08rem] leading-7 text-ink outline-none placeholder:text-muted focus-visible:ring-3 focus-visible:ring-focus" maxLength={500} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Add a comment about this win" disabled={busy} />
            {!message.trim() && <p className="mt-1 text-xs leading-5 text-muted">Leave it blank and we’ll use “{DEFAULT_COMPLETION_NOTE}”</p>}

            {attachments.length > 0 && <div className="mt-4 grid grid-cols-2 gap-2" aria-label="Selected photos">{attachments.map((item, index) => <div key={item.id} className="relative min-h-36 overflow-hidden rounded-2xl border border-line bg-canvas">
              {/* Local object URLs are intentionally rendered without the remote image optimizer. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.previewUrl} alt={`Selected completion photo ${index + 1}`} className="absolute inset-0 h-full w-full object-cover" />
              <button type="button" className="icon-btn absolute right-2 top-2 h-9 w-9 border-white/25 bg-overlay/75 text-white" onClick={() => removeImage(item.id)} aria-label={`Remove photo ${index + 1}`}><X size={16} /></button>
            </div>)}</div>}

            <article aria-label={`Quoted completed task: ${task.title}`} className="mt-4 overflow-hidden rounded-2xl border border-line bg-canvas/65">
              <div className="p-4">
                <div className="flex items-center gap-2.5">
                  <Avatar initials={userInitials} avatarUrl={profile?.avatar_url} name={name} size="sm" />
                  <div className="min-w-0"><p className="truncate text-sm font-bold">{name} <span className="font-normal text-muted">{handle}</span></p><p className="text-xs text-muted">Your completed task</p></div>
                </div>
                <p className="mt-3 text-[.98rem] font-bold leading-6">{task.title}</p>
                <div className="mt-3 flex flex-wrap gap-2">{task.category && <span className="badge badge-category">{task.category}</span>}{profile && <span className="badge badge-streak">🔥 {profile.current_streak}-day streak</span>}<span className="badge badge-private">{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(task.completed_at!))}</span></div>
              </div>
            </article>

            <p className="mt-3 text-xs leading-5 text-muted">{audience === "public" ? "Signed-in members can see this post and its photos." : "Only you can see this post and its photos."} <Link href="/settings#privacy" className="font-bold text-brand hover:underline">Change your default in Settings</Link>.</p>
          </div>
        </div>

        <div className="flex items-center gap-3 border-t border-line px-4 py-2.5 sm:px-5">
          <label htmlFor="post-images" className={`icon-btn border-transparent bg-transparent text-community ${attachments.length >= POST_MEDIA_MAX_FILES ? "pointer-events-none opacity-50" : ""}`} aria-disabled={attachments.length >= POST_MEDIA_MAX_FILES || busy}>
            <ImagePlus size={19} />
            <span className="sr-only">Add photos</span>
          </label>
          <input id="post-images" type="file" className="sr-only" accept="image/jpeg,image/png,image/webp" multiple onChange={chooseImages} disabled={attachments.length >= POST_MEDIA_MAX_FILES || busy} />
          <span className="text-xs text-muted">{attachments.length}/{POST_MEDIA_MAX_FILES} photos</span>
          <span className="ml-auto text-xs font-bold text-muted">{message.length}/500</span>
        </div>
        {attachments.length > 0 && <div className="flex items-start gap-2 border-t border-line px-4 py-3 text-xs leading-5 text-community sm:px-5"><ShieldCheck size={16} className="mt-0.5 shrink-0" /><p>Photos use private storage and short-lived links after visibility is checked.</p></div>}
      </form>}

      {status && <p className="border-t border-line px-4 py-3 text-sm font-bold text-muted sm:px-5" aria-live="polite">{status}</p>}
    </section>

    <div className="mx-auto mt-3 flex max-w-[640px] justify-center"><Link href="/tasks" className="btn btn-ghost">Keep private for now</Link></div>
  </div>;
}
