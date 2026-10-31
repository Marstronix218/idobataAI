// Checks an AI reaction before anyone sees it (SPEC Phase 3 step 4): at most 60
// words, names the task, and none of the banned content. The model is told to
// answer exactly SAFETY_ESCALATE when the task suggests distress; that is not a
// validation failure but a route to the crisis card, so it is reported first.
// It also refuses replies that repeat the prompt (a prompt leak): any run of 8
// words shared with the system prompt or the character sheet.

import { findBannedContent, maskTaskTitle, normalizeForBannedContent } from "@/lib/characters/banned-content";
import { TASK_TOKEN } from "@/lib/characters/content-schema";

export const AI_REACTION_MAX_WORDS = 60;
/** character_reactions.text allows at most 600 characters. */
export const AI_REACTION_MAX_CHARS = 600;
export const SAFETY_ESCALATE_TOKEN = "SAFETY_ESCALATE";
/** A reply sharing a run of this many words with the prompt counts as a leak. */
export const PROMPT_LEAK_NGRAM = 8;

export type ReactionRejection =
  | "empty"
  | "safety_escalate"
  | "too_long"
  | "template_token"
  | "prompt_leak"
  | "banned_content"
  | "missing_task";

export type ReactionValidation = { ok: true; text: string } | { ok: false; reason: ReactionRejection };

/** Title words too common to show the task was named. */
const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "into", "onto", "out", "off", "about", "over", "under", "after", "before",
  "then", "than", "this", "that", "these", "those", "your", "you", "our", "ours", "its", "his", "her", "hers",
  "their", "them", "they", "she", "him", "has", "have", "had", "are", "was", "were", "will", "can", "not", "but",
  "too", "very", "just", "also", "more", "less", "some", "any", "all", "each", "get", "got", "make", "made",
  "new", "one", "two", "again", "today", "tomorrow", "tonight", "task", "tasks", "todo", "thing", "things", "stuff",
]);

const SAFETY_ESCALATE = /SAFETY[\s_-]*ESCALATE/i;
const WRAPPING_QUOTES: ReadonlyArray<[string, string]> = [['"', '"'], ["“", "”"], ["'", "'"], ["‘", "’"]];

/** Trimmed, on one line, without a pair of quotes wrapped around the whole reply. */
function clean(text: string): string {
  let result = text.replace(/\s+/g, " ").trim();
  for (const [open, close] of WRAPPING_QUOTES) {
    if (result.length >= 2 && result.startsWith(open) && result.endsWith(close)) {
      result = result.slice(open.length, -close.length).trim();
      break;
    }
  }
  return result;
}

const countWords = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** Lowercase, drop a possessive and a plain plural, so "plant", "plants" and "plant's" compare equal. */
function stem(word: string): string {
  let result = word.replace(/'s$/, "").replace(/'$/, "");
  if (result.length > 3 && result.endsWith("s") && !result.endsWith("ss")) result = result.slice(0, -1);
  return result;
}

const words = (normalized: string) => normalized.split(/[^\p{L}\p{N}']+/u).map((word) => word.replace(/^'+|'+$/g, "")).filter(Boolean);

function containsPhrase(haystack: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(String.raw`(?<![\p{L}\p{N}])${escaped}(?![\p{L}\p{N}])`, "u").test(haystack);
}

/**
 * Whether `text` names the task: the whole title, or at least one significant
 * title word (3+ characters, not a stopword). A title with no significant word,
 * such as "Do it", must appear whole. A title with no letters or digits cannot
 * be checked and passes.
 */
export function mentionsTask(text: string, taskTitle: string): boolean {
  const normalizedText = normalizeForBannedContent(text);
  const normalizedTitle = normalizeForBannedContent(taskTitle);
  if (!/[\p{L}\p{N}]/u.test(normalizedTitle)) return true;
  if (containsPhrase(normalizedText, normalizedTitle)) return true;

  const significant = words(normalizedTitle).map(stem).filter((word) => word.length >= 3 && !STOPWORDS.has(word));
  if (significant.length === 0) return false;
  const textStems = new Set(words(normalizedText).map(stem));
  return significant.some((word) => textStems.has(word));
}

const leakWords = (text: string) => normalizeForBannedContent(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

function ngrams(tokens: readonly string[], size: number): string[] {
  const result: string[] = [];
  for (let index = 0; index + size <= tokens.length; index += 1) result.push(tokens.slice(index, index + size).join(" "));
  return result;
}

/** Whether `text` shares any run of PROMPT_LEAK_NGRAM words with one of `sources`. */
export function repeatsPrompt(text: string, sources: readonly string[]): boolean {
  const output = ngrams(leakWords(text), PROMPT_LEAK_NGRAM);
  if (output.length === 0) return false;
  const known = new Set(sources.flatMap((source) => ngrams(leakWords(source), PROMPT_LEAK_NGRAM)));
  return output.some((gram) => known.has(gram));
}

export interface ValidationOptions {
  /** The system prompt and character sheet text the reply must not repeat. */
  leakSources?: readonly string[];
}

export function validateAiReaction(text: string, taskTitle: string, options: ValidationOptions = {}): ReactionValidation {
  const cleaned = clean(text);
  if (!cleaned) return { ok: false, reason: "empty" };
  if (SAFETY_ESCALATE.test(cleaned)) return { ok: false, reason: "safety_escalate" };
  if (countWords(cleaned) > AI_REACTION_MAX_WORDS || cleaned.length > AI_REACTION_MAX_CHARS) return { ok: false, reason: "too_long" };
  // Copied from a sample line instead of naming the task.
  if (cleaned.includes(TASK_TOKEN)) return { ok: false, reason: "template_token" };
  if (options.leakSources && repeatsPrompt(cleaned, options.leakSources)) return { ok: false, reason: "prompt_leak" };
  // Mask the user's own title first, so a title such as "Water the plants, love"
  // is not mistaken for the character using a pet name (see banned-content.ts).
  if (findBannedContent(maskTaskTitle(cleaned, taskTitle)).length > 0) return { ok: false, reason: "banned_content" };
  if (!mentionsTask(cleaned, taskTitle)) return { ok: false, reason: "missing_task" };
  return { ok: true, text: cleaned };
}
