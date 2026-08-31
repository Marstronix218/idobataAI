/**
 * A persona's first reply reacts to a finished task. Everything after that is a
 * conversation, and a conversation needs to know what was just said rather than
 * what was once completed. These helpers turn one branch of a reply tree into
 * the turns a generator can answer, and decide when a branch has become a
 * conversation at all.
 *
 * Only the ancestor chain of the reply being answered is ever used. Two
 * personas replying to the same post own separate branches, so neither can read
 * the other's exchange no matter how busy the post gets.
 */

export interface ThreadContextPost {
  id: string;
  author_id: string | null;
  author_label: string | null;
  kind: string;
  task_title: string | null;
  category: string | null;
  content: string;
  streak: number | null;
  xp_earned: number | null;
  created_at: string;
}

export interface ThreadContextMessage {
  reply_id: string;
  depth: number;
  speaker: "persona" | "user";
  companion_id: string | null;
  companion_name: string | null;
  author_id: string | null;
  author_label: string | null;
  content: string;
  created_at: string;
}

/** The shape `get_reply_thread_context` returns, oldest turn first. */
export interface ThreadConversationContext {
  post: ThreadContextPost;
  target_reply_id: string;
  root_reply_id: string | null;
  depth: number;
  messages: ThreadContextMessage[];
}

export interface ThreadConversationLimits {
  /** Turns of this branch handed to the model, newest kept. */
  contextMessages: number;
  /** Per-turn character cap, so one long comment cannot crowd out the rest. */
  maxMessageCharacters: number;
  /** Character cap on the completed-task note carried as background. */
  maxPostCharacters: number;
}

export const THREAD_CONVERSATION_LIMITS: ThreadConversationLimits = {
  contextMessages: 8,
  maxMessageCharacters: 400,
  maxPostCharacters: 600,
};

function boundedNumber(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

/**
 * Context size is the one cost control that lives in the application rather than
 * the database, because it is measured in tokens rather than in rows.
 */
export function resolveThreadConversationLimits(
  // Defaulted lazily so the module stays importable from a browser bundle,
  // where the UI uses `awaitsPersonaThreadReply` and never reads the limits.
  env: Record<string, string | undefined> = typeof process === "undefined" ? {} : process.env,
): ThreadConversationLimits {
  return {
    contextMessages: boundedNumber(env.AI_THREAD_CONTEXT_MESSAGES, THREAD_CONVERSATION_LIMITS.contextMessages, 2, 20),
    maxMessageCharacters: boundedNumber(env.AI_THREAD_CONTEXT_MESSAGE_CHARACTERS, THREAD_CONVERSATION_LIMITS.maxMessageCharacters, 80, 1000),
    maxPostCharacters: boundedNumber(env.AI_THREAD_CONTEXT_POST_CHARACTERS, THREAD_CONVERSATION_LIMITS.maxPostCharacters, 80, 1200),
  };
}

export interface ThreadTurn {
  role: "assistant" | "user";
  content: string;
}

export interface ThreadConversation {
  /** Chronological turns, this persona's own words as `assistant`. */
  turns: ThreadTurn[];
  /** How often this persona has already spoken in this branch. */
  personaTurns: number;
  /** The message being answered. */
  latestMessage: ThreadContextMessage | null;
  /**
   * Whether this branch is a conversation rather than a first reaction. False
   * means the persona has never spoken here and should react to the task.
   */
  conversational: boolean;
}

function speakerLabel(message: ThreadContextMessage) {
  return message.companion_name ?? message.author_label ?? (message.speaker === "persona" ? "Another character" : "Someone");
}

/**
 * Turns the ancestor chain into alternating turns for one persona.
 *
 * Anyone who is not this character speaks as `user`, because everything the
 * model did not write is input it must treat as untrusted. When more than one
 * such voice appears -- a second human, or another persona further up the
 * branch -- each turn is prefixed with a name so the character can tell who it
 * is answering instead of hearing one merged voice.
 */
export function buildThreadConversation(
  context: ThreadConversationContext,
  companionId: string,
  limits: ThreadConversationLimits = THREAD_CONVERSATION_LIMITS,
): ThreadConversation {
  const ordered = [...(context.messages ?? [])].sort((left, right) => left.depth - right.depth);
  const window = ordered.slice(-Math.max(2, limits.contextMessages));

  const otherSpeakers = new Set(
    window.filter((message) => message.companion_id !== companionId).map((message) => speakerLabel(message)),
  );
  const labelTurns = otherSpeakers.size > 1;

  const turns = window.map((message) => {
    const own = message.companion_id === companionId;
    const content = message.content.slice(0, limits.maxMessageCharacters).trim();
    return {
      role: own ? "assistant" as const : "user" as const,
      content: !own && labelTurns ? `${speakerLabel(message)}: ${content}` : content,
    };
  }).filter((turn) => turn.content.length > 0);

  const personaTurns = window.filter((message) => message.companion_id === companionId).length;

  return {
    turns,
    personaTurns,
    latestMessage: ordered.at(-1) ?? null,
    conversational: personaTurns > 0,
  };
}

/** The completed task, trimmed to the background a follow-up may refer back to. */
export function threadPostSummary(
  context: ThreadConversationContext,
  limits: ThreadConversationLimits = THREAD_CONVERSATION_LIMITS,
) {
  const post = context.post;
  return {
    completed_task: post.task_title?.slice(0, 160) ?? undefined,
    user_category_label: post.category?.slice(0, 48) ?? undefined,
    completion_note: post.content.slice(0, limits.maxPostCharacters),
    streak_days: post.streak ?? undefined,
    author_label: post.author_label?.slice(0, 80) ?? undefined,
  };
}

/**
 * Whether the reply just posted should show a "replying" indicator.
 *
 * The client predicts what the database trigger decides so the thread can show
 * that something is coming without waiting for it. It is only ever a hint: the
 * indicator times out on its own, and a persona that declines to answer -- the
 * response probability, a spent budget -- simply never arrives.
 */
export function awaitsPersonaThreadReply({ parentIsPersona, parentCompanionMuted = false, authoredByViewer }: {
  parentIsPersona: boolean;
  parentCompanionMuted?: boolean;
  authoredByViewer: boolean;
}) {
  return parentIsPersona && authoredByViewer && !parentCompanionMuted;
}
