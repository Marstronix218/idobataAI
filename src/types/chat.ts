import type { ChatMessage, ChatThread } from "./database";

export type ChatPeer = {
  id: string;
  kind: "user" | "companion";
  name: string;
  handle: string;
  avatarUrl: string | null;
  description: string | null;
};

export type ChatThreadSummary = {
  thread: ChatThread;
  peer: ChatPeer;
};

export type ChatThreadDetail = ChatThreadSummary & {
  messages: ChatMessage[];
};

export type ChatContact = ChatPeer;
