"use client";

import { ArrowLeft, Bot, MailPlus, Search, Send, Sparkles, UserRound, X } from "lucide-react";
import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { AIBadge } from "@/components/ui/status";
import { apiRequest, errorMessage, isPreviewMode } from "@/lib/client/api";
import type { ChatContact, ChatMessage, ChatPeer, ChatThread, ChatThreadDetail, ChatThreadSummary } from "@/types";

type ThreadPage = { items: ChatThreadSummary[] };
type ContactPage = { items: ChatContact[] };
type SendResult = { message: ChatMessage; aiMessage: ChatMessage | null; aiReplyPending?: boolean };

const previewNow = "2026-08-14T17:15:00.000Z";

function previewThread(id: string, peer: ChatPeer, message: string, minutesAgo: number): ChatThreadSummary {
  return {
    peer,
    thread: {
      id,
      user_one_id: "preview-user",
      user_two_id: peer.kind === "user" ? peer.id : null,
      companion_id: peer.kind === "companion" ? peer.id : null,
      created_by: "preview-user",
      last_message_preview: message,
      last_sender_user_id: peer.kind === "user" ? peer.id : null,
      last_sender_companion_id: peer.kind === "companion" ? peer.id : null,
      last_message_at: new Date(new Date(previewNow).getTime() - minutesAgo * 60_000).toISOString(),
      created_at: previewNow,
      updated_at: previewNow,
    },
  };
}

function previewMessage(
  id: string,
  threadId: string,
  content: string,
  sender: "me" | "user" | "companion",
  minutesAgo: number,
): ChatMessage {
  return {
    id,
    thread_id: threadId,
    sender_user_id: sender === "me" ? "preview-user" : sender === "user" ? "preview-peer" : null,
    sender_companion_id: sender === "companion" ? "moss" : null,
    content,
    content_status: "active",
    is_ai_generated: sender === "companion",
    created_at: new Date(new Date(previewNow).getTime() - minutesAgo * 60_000).toISOString(),
    updated_at: previewNow,
  };
}

const moss: ChatPeer = {
  id: "moss",
  kind: "companion",
  name: "Moss",
  handle: "moss",
  avatarUrl: null,
  description: "A patient student balancing coursework and a tiny balcony garden.",
};
const jonah: ChatPeer = {
  id: "preview-peer",
  kind: "user",
  name: "Jonah Lee",
  handle: "jonahlee",
  avatarUrl: null,
  description: "Product lead, habitual list maker, occasional trail runner.",
};
const tempo: ChatPeer = {
  id: "tempo",
  kind: "companion",
  name: "Tempo",
  handle: "tempo",
  avatarUrl: null,
  description: "An office operations coordinator who loves a clean checklist.",
};
const aya: ChatPeer = {
  id: "preview-aya",
  kind: "user",
  name: "Aya Chen",
  handle: "ayachen",
  avatarUrl: null,
  description: "Learning in public and cheering on small wins.",
};

const previewThreads: ChatThreadSummary[] = [
  previewThread("preview-moss", moss, "A ten-minute outline sounds like a gentle place to start.", 3),
  previewThread("preview-jonah", jonah, "Want me to look at the kickoff notes tomorrow?", 24),
  previewThread("preview-tempo", tempo, "Your checklist has enough breathing room now.", 78),
];

const previewDetails: Record<string, ChatThreadDetail> = {
  "preview-moss": {
    ...previewThreads[0],
    messages: [
      previewMessage("m1", "preview-moss", "I keep putting off the outline because it feels bigger than it is.", "me", 18),
      previewMessage("m2", "preview-moss", "That makes sense. Big, fuzzy tasks can take up more room than the work itself.", "companion", 16),
      previewMessage("m3", "preview-moss", "Maybe I can just sketch the three main sections.", "me", 5),
      previewMessage("m4", "preview-moss", "A ten-minute outline sounds like a gentle place to start.", "companion", 3),
    ],
  },
  "preview-jonah": {
    ...previewThreads[1],
    messages: [
      previewMessage("j1", "preview-jonah", "The first draft is finally done.", "me", 31),
      previewMessage("j2", "preview-jonah", "Nice. Want me to look at the kickoff notes tomorrow?", "user", 24),
    ],
  },
  "preview-tempo": {
    ...previewThreads[2],
    messages: [
      previewMessage("t1", "preview-tempo", "I trimmed the plan down to the three things that matter.", "me", 84),
      previewMessage("t2", "preview-tempo", "Your checklist has enough breathing room now.", "companion", 78),
    ],
  },
};

const previewContacts: ChatContact[] = [jonah, aya, moss, tempo];

function initials(name: string) {
  return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function shortTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const today = isPreviewMode ? new Date(previewNow) : new Date();
  if (date.toDateString() === today.toDateString()) {
    return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(date);
  }
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(date);
}

function updateThreadPreview(items: ChatThreadSummary[], threadId: string, message: ChatMessage) {
  return items.map((item) => item.thread.id === threadId ? {
    ...item,
    thread: {
      ...item.thread,
      last_message_preview: message.content.slice(0, 240),
      last_message_at: message.created_at,
      last_sender_user_id: message.sender_user_id,
      last_sender_companion_id: message.sender_companion_id,
    },
  } : item).sort((a, b) => (b.thread.last_message_at ?? b.thread.created_at).localeCompare(a.thread.last_message_at ?? a.thread.created_at));
}

export function ChatPanel() {
  const [threads, setThreads] = useState<ChatThreadSummary[]>(isPreviewMode ? previewThreads : []);
  const [details, setDetails] = useState<Record<string, ChatThreadDetail>>(isPreviewMode ? previewDetails : {});
  const [selectedId, setSelectedId] = useState<string | null>(isPreviewMode ? previewThreads[0].thread.id : null);
  const [mobileConversationOpen, setMobileConversationOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState(isPreviewMode ? "Preview messages stay on this device." : "");
  const [loading, setLoading] = useState(!isPreviewMode);
  const [sending, setSending] = useState(false);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [contactQuery, setContactQuery] = useState("");
  const [contacts, setContacts] = useState<ChatContact[]>(isPreviewMode ? previewContacts : []);
  const [contactsLoading, setContactsLoading] = useState(false);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const previewIdRef = useRef(0);

  const visibleThreads = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return threads;
    return threads.filter(({ peer, thread }) => `${peer.name} ${peer.handle} ${thread.last_message_preview ?? ""}`.toLowerCase().includes(needle));
  }, [query, threads]);
  const selectedSummary = threads.find((item) => item.thread.id === selectedId) ?? null;
  const selectedDetail = selectedId ? details[selectedId] ?? null : null;
  const visibleContacts = useMemo(() => {
    const needle = contactQuery.trim().toLowerCase();
    return needle ? contacts.filter((contact) => `${contact.name} ${contact.handle} ${contact.description ?? ""}`.toLowerCase().includes(needle)) : contacts;
  }, [contactQuery, contacts]);

  useEffect(() => {
    if (isPreviewMode) return;
    const controller = new AbortController();
    apiRequest<ThreadPage>("/api/chat", { signal: controller.signal })
      .then(({ items }) => {
        setThreads(items);
        if (items[0]) setSelectedId((current) => current ?? items[0].thread.id);
        else setLoading(false);
      })
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setStatus(errorMessage(error));
        setLoading(false);
      })
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!selectedId || details[selectedId] || isPreviewMode) return;
    const controller = new AbortController();
    apiRequest<ChatThreadDetail>(`/api/chat/${selectedId}`, { signal: controller.signal })
      .then((detail) => setDetails((current) => ({ ...current, [selectedId]: detail })))
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setStatus(errorMessage(error));
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [details, selectedId]);

  useEffect(() => {
    if (!selectedId || isPreviewMode) return;
    const controller = new AbortController();
    const refresh = () => {
      void Promise.all([
        apiRequest<ThreadPage>("/api/chat", { signal: controller.signal }),
        apiRequest<ChatThreadDetail>(`/api/chat/${selectedId}`, { signal: controller.signal }),
      ]).then(([threadPage, detail]) => {
        setThreads(threadPage.items);
        setDetails((current) => ({ ...current, [selectedId]: detail }));
      }).catch((error) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setStatus(errorMessage(error));
      });
    };
    const interval = window.setInterval(refresh, 12_000);
    window.addEventListener("focus", refresh);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, [selectedId]);

  useEffect(() => {
    if (!newChatOpen || isPreviewMode) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setContactsLoading(true);
      apiRequest<ContactPage>(`/api/chat/contacts?query=${encodeURIComponent(contactQuery)}`, { signal: controller.signal })
        .then(({ items }) => setContacts(items))
        .catch((error) => {
          if (!(error instanceof DOMException && error.name === "AbortError")) setStatus(errorMessage(error));
        })
        .finally(() => { if (!controller.signal.aborted) setContactsLoading(false); });
    }, 180);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [contactQuery, newChatOpen]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView?.({ block: "end" });
  }, [selectedDetail?.messages.length, sending]);

  async function selectThread(id: string) {
    if (!details[id] && !isPreviewMode) setLoading(true);
    setSelectedId(id);
    setMobileConversationOpen(true);
    setDraft("");
    setStatus("");
  }

  async function startConversation(contact: ChatContact) {
    setStatus("");
    let existing = threads.find((item) => item.peer.kind === contact.kind && item.peer.id === contact.id);
    if (!existing) {
      try {
        let thread: ChatThread;
        if (isPreviewMode) {
          const id = `preview-${contact.kind}-${contact.id}`;
          thread = {
            id,
            user_one_id: "preview-user",
            user_two_id: contact.kind === "user" ? contact.id : null,
            companion_id: contact.kind === "companion" ? contact.id : null,
            created_by: "preview-user",
            last_message_preview: null,
            last_sender_user_id: null,
            last_sender_companion_id: null,
            last_message_at: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
        } else {
          thread = await apiRequest<ChatThread>("/api/chat", {
            method: "POST",
            body: JSON.stringify(contact.kind === "user" ? { userId: contact.id } : { companionId: contact.id }),
          });
        }
        existing = { thread, peer: contact };
        setThreads((current) => [existing!, ...current]);
        setDetails((current) => ({ ...current, [thread.id]: { ...existing!, messages: [] } }));
      } catch (error) {
        setStatus(errorMessage(error));
        return;
      }
    }
    setNewChatOpen(false);
    setContactQuery("");
    await selectThread(existing.thread.id);
  }

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    if (!selectedSummary || !draft.trim() || sending) return;
    const content = draft.trim();
    const threadId = selectedSummary.thread.id;
    setDraft("");
    setSending(true);
    setStatus(selectedSummary.peer.kind === "companion" ? `${selectedSummary.peer.name} is thinking…` : "Sending…");

    try {
      if (isPreviewMode) {
        const now = new Date().toISOString();
        const message: ChatMessage = {
          id: `preview-message-${++previewIdRef.current}`,
          thread_id: threadId,
          sender_user_id: "preview-user",
          sender_companion_id: null,
          content,
          content_status: "active",
          is_ai_generated: false,
          created_at: now,
          updated_at: now,
        };
        let messages = [...(details[threadId]?.messages ?? []), message];
        let latest = message;
        if (selectedSummary.peer.kind === "companion") {
          const aiMessage: ChatMessage = {
            ...message,
            id: `preview-ai-${++previewIdRef.current}`,
            sender_user_id: null,
            sender_companion_id: selectedSummary.peer.id,
            content: `That sounds worth making a little room for. What would a kind, workable next step look like for you?`,
            is_ai_generated: true,
          };
          messages = [...messages, aiMessage];
          latest = aiMessage;
        }
        setDetails((current) => ({ ...current, [threadId]: { ...(current[threadId] ?? { ...selectedSummary, messages: [] }), messages } }));
        setThreads((current) => updateThreadPreview(current, threadId, latest));
        setStatus(selectedSummary.peer.kind === "companion" ? `${selectedSummary.peer.name} replied. Preview only.` : "Message sent. Preview only.");
      } else {
        const result = await apiRequest<SendResult>(`/api/chat/${threadId}/messages`, {
          method: "POST",
          body: JSON.stringify({ content }),
        });
        const added = [result.message, result.aiMessage].filter((message): message is ChatMessage => Boolean(message));
        const latest = added[added.length - 1];
        setDetails((current) => ({
          ...current,
          [threadId]: {
            ...(current[threadId] ?? { ...selectedSummary, messages: [] }),
            messages: [...(current[threadId]?.messages ?? []), ...added],
          },
        }));
        if (latest) setThreads((current) => updateThreadPreview(current, threadId, latest));
        setStatus(result.aiMessage
          ? `${selectedSummary.peer.name} replied.`
          : result.aiReplyPending
            ? "Message sent. The AI reply is taking longer than usual."
            : "Message sent.");
      }
    } catch (error) {
      setDraft(content);
      setStatus(errorMessage(error));
    } finally {
      setSending(false);
    }
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  return <div className="relative flex h-[calc(100dvh-4.2rem)] min-h-[36rem] overflow-hidden border-x border-line bg-canvas lg:h-dvh">
    <section aria-label="Chat inbox" className={`${mobileConversationOpen ? "hidden md:flex" : "flex"} min-w-0 flex-1 flex-col border-r border-line md:max-w-[360px]`}>
      <header className="flex min-h-16 items-center justify-between gap-3 border-b border-line px-4">
        <div><h1 className="display text-2xl font-bold">Chat</h1><p className="text-xs text-muted">Private conversations</p></div>
        <button type="button" className="icon-btn" aria-label="Start a new conversation" onClick={() => setNewChatOpen(true)}><MailPlus size={19} /></button>
      </header>
      {isPreviewMode && <div role="note" className="border-b border-line bg-sun-soft px-4 py-3 text-xs leading-5"><strong>Preview mode.</strong> Messages are interactive demo data and do not persist.</div>}
      <div className="p-3">
        <label htmlFor="conversation-search" className="sr-only">Search conversations</label>
        <div className="relative"><Search className="pointer-events-none absolute left-3 top-3 text-muted" size={18} /><input id="conversation-search" className="field min-h-11 rounded-full pl-10" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search conversations" /></div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {visibleThreads.map(({ thread, peer }) => {
          const active = thread.id === selectedId;
          return <button type="button" key={thread.id} onClick={() => void selectThread(thread.id)} className={`flex w-full items-start gap-3 border-t border-line px-4 py-4 text-left transition-colors first:border-t-0 hover:bg-surface/45 ${active ? "bg-surface/70" : ""}`}>
            <Avatar initials={initials(peer.name)} avatarUrl={peer.avatarUrl} name={peer.name} ai={peer.kind === "companion"} />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-1.5"><strong className="truncate">{peer.name}</strong>{peer.kind === "companion" && <span className="shrink-0 text-xs font-extrabold text-community">AI</span>}<time className="ml-auto shrink-0 text-xs text-muted">{shortTime(thread.last_message_at)}</time></span>
              <span className="mt-1 block truncate text-sm text-muted">{thread.last_message_preview ?? "Start the conversation"}</span>
            </span>
          </button>;
        })}
        {!visibleThreads.length && !loading && <div className="px-6 py-12 text-center"><Sparkles className="mx-auto text-brand" size={24} /><h2 className="display mt-4 text-lg font-bold">{query ? "No conversations found" : "Your inbox is quiet"}</h2><p className="mt-2 text-sm leading-6 text-muted">{query ? "Try another name or message." : "Start a private chat with a person or a clearly labeled AI profile."}</p><button type="button" className="btn btn-primary mt-5" onClick={() => setNewChatOpen(true)}>New conversation</button></div>}
      </div>
    </section>

    <section aria-label={selectedSummary ? `Conversation with ${selectedSummary.peer.name}` : "Conversation"} className={`${mobileConversationOpen ? "flex" : "hidden md:flex"} min-w-0 flex-1 flex-col bg-canvas`}>
      {selectedSummary ? <>
        <header className="flex min-h-16 items-center gap-3 border-b border-line px-3 sm:px-4">
          <button type="button" className="icon-btn border-transparent bg-transparent md:hidden" aria-label="Back to conversations" onClick={() => setMobileConversationOpen(false)}><ArrowLeft size={20} /></button>
          <Avatar initials={initials(selectedSummary.peer.name)} avatarUrl={selectedSummary.peer.avatarUrl} name={selectedSummary.peer.name} ai={selectedSummary.peer.kind === "companion"} />
          <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h2 className="truncate font-bold">{selectedSummary.peer.name}</h2>{selectedSummary.peer.kind === "companion" && <AIBadge />}</div><p className="truncate text-xs text-muted">@{selectedSummary.peer.handle}{selectedSummary.peer.kind === "companion" ? " · AI profile" : ""}</p></div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6" aria-live="polite">
          {selectedDetail?.messages.length ? <div className="space-y-3">{selectedDetail.messages.map((message) => {
            const mine = Boolean(message.sender_user_id && message.sender_user_id !== selectedSummary.peer.id);
            return <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[82%] rounded-[1.35rem] px-4 py-2.5 text-sm leading-6 sm:max-w-[68%] ${mine ? "rounded-br-md bg-brand text-white" : "rounded-bl-md border border-line bg-surface text-ink"}`}>
                {message.is_ai_generated && <p className="mb-1 text-xs font-extrabold uppercase tracking-[.08em] text-community">AI · {selectedSummary.peer.name}</p>}
                <p className="whitespace-pre-wrap break-words">{message.content}</p>
                <time className={`mt-1 block text-right text-xs ${mine ? "text-white/70" : "text-muted"}`}>{shortTime(message.created_at)}</time>
              </div>
            </div>;
          })}</div> : !loading && <div className="mx-auto flex max-w-md flex-col items-center py-12 text-center"><Avatar initials={initials(selectedSummary.peer.name)} avatarUrl={selectedSummary.peer.avatarUrl} name={selectedSummary.peer.name} ai={selectedSummary.peer.kind === "companion"} size="xl" /><div className="mt-4 flex items-center gap-2"><h3 className="display text-xl font-bold">{selectedSummary.peer.name}</h3>{selectedSummary.peer.kind === "companion" && <AIBadge />}</div><p className="mt-2 text-sm text-muted">@{selectedSummary.peer.handle}</p>{selectedSummary.peer.description && <p className="mt-4 text-sm leading-6 text-muted">{selectedSummary.peer.description}</p>}<p className="mt-5 rounded-2xl bg-surface px-4 py-3 text-sm leading-6 text-muted">{selectedSummary.peer.kind === "companion" ? "This is a private chat with an AI profile. It will always be clearly labeled as AI." : "Send a message to start this private conversation."}</p></div>}
          {sending && selectedSummary.peer.kind === "companion" && <div className="mt-3 flex justify-start"><div className="rounded-[1.35rem] rounded-bl-md border border-line bg-surface px-4 py-3 text-sm text-muted"><span className="inline-flex items-center gap-2"><Bot size={15} className="text-community" /> {selectedSummary.peer.name} is thinking…</span></div></div>}
          <div ref={messageEndRef} />
        </div>
        <form onSubmit={(event) => void sendMessage(event)} className="border-t border-line bg-canvas p-3 sm:p-4">
          <div className="flex items-end gap-2 rounded-[1.4rem] border border-line bg-surface p-2 pl-4 focus-within:border-line-strong">
            <label htmlFor="chat-message" className="sr-only">Message {selectedSummary.peer.name}</label>
            <textarea id="chat-message" rows={1} value={draft} maxLength={2000} disabled={sending} onChange={(event) => setDraft(event.target.value)} onKeyDown={onComposerKeyDown} placeholder={`Message ${selectedSummary.peer.name}`} className="max-h-32 min-h-10 flex-1 resize-none bg-transparent py-2 text-sm outline-none placeholder:text-muted" />
            <button type="submit" className="icon-btn border-transparent bg-brand text-white disabled:cursor-not-allowed disabled:opacity-45" disabled={sending || !draft.trim()} aria-label="Send message"><Send size={18} /></button>
          </div>
          <p className="mt-2 min-h-4 px-2 text-xs text-muted" role="status">{status}</p>
        </form>
      </> : <div className="grid h-full place-items-center px-8 text-center"><div><MailPlus className="mx-auto text-brand" size={30} /><h2 className="display mt-4 text-2xl font-bold">Choose a conversation</h2><p className="mt-2 max-w-sm text-sm leading-6 text-muted">Chat privately with people in the community or with a clearly labeled AI profile.</p><button type="button" className="btn btn-primary mt-5" onClick={() => setNewChatOpen(true)}>New conversation</button></div></div>}
    </section>

    {newChatOpen && <div className="fixed inset-0 z-50 grid place-items-center bg-overlay/70 p-4" onMouseDown={(event) => { if (event.currentTarget === event.target) setNewChatOpen(false); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="new-chat-title" className="flex max-h-[82dvh] w-full max-w-lg flex-col overflow-hidden rounded-[1.4rem] border border-line bg-canvas shadow-2xl">
        <header className="flex min-h-16 items-center gap-3 border-b border-line px-4"><button type="button" className="icon-btn border-transparent bg-transparent" aria-label="Close new conversation" onClick={() => setNewChatOpen(false)}><X size={20} /></button><h2 id="new-chat-title" className="display text-xl font-bold">New conversation</h2></header>
        <div className="p-4"><label htmlFor="contact-search" className="sr-only">Search people and AI profiles</label><div className="relative"><Search className="pointer-events-none absolute left-3 top-3 text-muted" size={18} /><input autoFocus id="contact-search" className="field rounded-full pl-10" placeholder="Search people and AI profiles" value={contactQuery} onChange={(event) => setContactQuery(event.target.value)} /></div></div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-4">
          {(["user", "companion"] as const).map((kind) => {
            const group = visibleContacts.filter((contact) => contact.kind === kind);
            if (!group.length) return null;
            return <div key={kind}><h3 className="flex items-center gap-2 px-4 py-2 text-xs font-extrabold uppercase tracking-[.09em] text-muted">{kind === "user" ? <UserRound size={14} /> : <Bot size={14} className="text-community" />}{kind === "user" ? "People" : "AI profiles"}</h3>{group.map((contact) => <button type="button" key={`${contact.kind}-${contact.id}`} onClick={() => void startConversation(contact)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface/55"><Avatar initials={initials(contact.name)} avatarUrl={contact.avatarUrl} name={contact.name} ai={contact.kind === "companion"} /><span className="min-w-0 flex-1"><span className="flex items-center gap-2"><strong className="truncate">{contact.name}</strong>{contact.kind === "companion" && <AIBadge />}</span><span className="block truncate text-sm text-muted">@{contact.handle}{contact.description ? ` · ${contact.description}` : ""}</span></span></button>)}</div>;
          })}
          {!visibleContacts.length && !contactsLoading && <div className="px-6 py-10 text-center text-sm text-muted">No people or AI profiles match that search.</div>}
          {contactsLoading && <div className="px-6 py-10 text-center text-sm text-muted">Searching…</div>}
        </div>
      </section>
    </div>}
  </div>;
}
