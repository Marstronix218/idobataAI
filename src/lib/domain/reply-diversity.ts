/**
 * Two personas landing on "Great job, keep it up!" costs more than one bad
 * reply: it tells the reader that the characters are a single voice wearing
 * different avatars. Generated text is screened here before it is stored, so a
 * near-duplicate can be regenerated while the post is still fresh.
 */

/** Praise that could have come from any character, which is the whole problem. */
const GENERIC_PHRASES = [
  "great job",
  "good job",
  "great work",
  "amazing work",
  "well done",
  "proud of you",
  "so proud",
  "keep it up",
  "keep up the good work",
  "you got this",
  "you should be proud",
  "way to go",
  "nice work",
  "awesome job",
  "excellent work",
  "fantastic job",
  "you ve got this",
  "congratulations on completing",
  "congratulations on finishing",
];

const MODEL_ARTIFACT_PATTERNS = [
  /^(?:reply|response|assistant|ai)\s*:/i,
  /^(?:sure|certainly)[,!:.\s]/i,
  /^here(?:'s| is) (?:a|the|your) /i,
  /\bas an ai\b/i,
  /\b(?:system|developer|user) prompt\b/i,
];

const TASK_SUMMARY_PATTERNS = [
  /\byou successfully (?:completed|finished)\b/i,
  /\byou (?:completed|finished) (?:the|your) task\b/i,
  /\b(?:completed|finished) the task of\b/i,
  /\bthe task (?:has been|is now) (?:completed|finished)\b/i,
];

const UNFINISHED_ENDING = /(?:\b(?:a|an|and|because|but|for|of|or|so|the|then|to|with)|\b(?:is|are|was|were) (?:actually|finally|now)|[,/:;\\-])\s*$/i;
const MARKDOWN = /```|^\s{0,3}(?:#{1,6}\s|>\s|[-*+]\s|\d+\.\s)|\[[^\]]+\]\([^)]+\)|\*\*|__|~~/m;
const INVALID_UNICODE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069\uFFFD]/;

function hasUnpairedSurrogate(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function isTrailingArtifactLine(value: string, preceding: string) {
  if (!value || value.length > 16 || !/\p{Script=Latin}/u.test(preceding)) return false;
  if (/^[♪♫♡♥☆★✨]+$/u.test(value) || /\p{Extended_Pictographic}/u.test(value)) return false;
  if (/\p{Letter}/u.test(value)) return !/\p{Script=Latin}/u.test(value);
  return !/[\p{Number}]/u.test(value);
}

/**
 * Removes transport corruption without flattening legitimate persona styling.
 * A short non-Latin line dangling after an otherwise Latin reply is the shape
 * of the artifact seen in production, while emoji and common decorative marks
 * remain valid character voice.
 */
export function sanitizePersonaReply(value: string) {
  let sanitized = value
    .normalize("NFC")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069\uFFFD]/g, "")
    .replace(/\r\n?/g, "\n")
    .trim();

  const lines = sanitized.split("\n").map((line) => line.trimEnd());
  while (lines.length > 1 && isTrailingArtifactLine(lines.at(-1)?.trim() ?? "", lines.slice(0, -1).join(" "))) {
    lines.pop();
  }

  sanitized = lines.join("\n");
  return sanitized
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/[ \t]*\n[ \t]*/g, " ").trim())
    .filter(Boolean)
    .join("\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function isGenericPraise(content: string) {
  const normalized = normalize(content);
  return GENERIC_PHRASES.some((phrase) => normalized.includes(phrase));
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function wordCount(value: string) {
  return value.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

function sentenceCount(value: string) {
  return value
    .split(/(?:[.!?]+["')\]]*\s+|\n+)/u)
    .map((part) => part.trim())
    .filter(Boolean)
    .length;
}

function significantOpening(value: string) {
  return normalize(value).split(" ").filter((word) => word.length > 2 && !STOPWORDS.has(word)).slice(0, 2).join(" ");
}

function repeatsSource(content: string, source: string) {
  const sourceWords = tokens(source);
  if (sourceWords.size < 4) return false;
  return contentSimilarity(content, source) >= 0.72;
}

function hasUnclosedPair(value: string, opening: string, closing: string) {
  if (opening === closing) return value.split(opening).length % 2 === 0;
  return value.split(opening).length !== value.split(closing).length;
}

/**
 * Stopwords are dropped before comparison because "that is done and" overlaps
 * between every pair of short replies and would swamp the signal that actually
 * matters: whether two characters reached for the same content words.
 */
const STOPWORDS = new Set([
  "a", "an", "and", "the", "is", "it", "its", "was", "you", "your", "youre", "i", "im", "to", "of",
  "that", "this", "for", "on", "in", "at", "with", "but", "so", "just", "now", "not", "no", "do",
  "did", "done", "be", "been", "have", "has", "had", "one", "up", "out", "then", "than", "as", "we",
]);

function tokens(value: string) {
  return new Set(normalize(value).split(" ").filter((word) => word.length > 2 && !STOPWORDS.has(word)));
}

/** Jaccard overlap of content words, 0 (unrelated) to 1 (identical wording). */
export function contentSimilarity(left: string, right: string) {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / (a.size + b.size - shared);
}

export interface DiversityVerdict {
  ok: boolean;
  reason?:
    | "generic_praise"
    | "duplicate_of_sibling"
    | "repeats_persona"
    | "too_long"
    | "multiple_paragraphs"
    | "too_many_sentences"
    | "task_summary"
    | "malformed_unicode"
    | "unfinished_sentence"
    | "model_artifact"
    | "markdown";
  similarity?: number;
}

export interface DiversityCheckInput {
  content: string;
  /** Text other personas have already published on the same post. */
  siblingReplies?: string[];
  /** This persona's own recent replies, which must not become a catchphrase. */
  personaRecentReplies?: string[];
  /** The task title/note, used only to catch obvious restatements. */
  sourceTexts?: Array<string | null | undefined>;
  siblingThreshold?: number;
  personaThreshold?: number;
  maxWords?: number;
  maxSentences?: number;
  maxCharacters?: number;
}

export function checkReplyDiversity({
  content,
  siblingReplies = [],
  personaRecentReplies = [],
  sourceTexts = [],
  // A sibling reply on the same post is read side by side, so it is held to a
  // stricter standard than one of this persona's replies from another thread.
  siblingThreshold = 0.4,
  personaThreshold = 0.55,
  maxWords = 40,
  maxSentences = 2,
  maxCharacters = 280,
}: DiversityCheckInput): DiversityVerdict {
  if (INVALID_UNICODE.test(content) || hasUnpairedSurrogate(content)) return { ok: false, reason: "malformed_unicode" };
  if (content.split(/\n\s*\n/).filter((part) => part.trim()).length > 1) return { ok: false, reason: "multiple_paragraphs" };
  if (content.length > maxCharacters || wordCount(content) > maxWords) return { ok: false, reason: "too_long" };
  if (sentenceCount(content) > maxSentences) return { ok: false, reason: "too_many_sentences" };
  if (MARKDOWN.test(content)) return { ok: false, reason: "markdown" };
  if (MODEL_ARTIFACT_PATTERNS.some((pattern) => pattern.test(content))) return { ok: false, reason: "model_artifact" };
  if (
    UNFINISHED_ENDING.test(content)
    || hasUnclosedPair(content, "(", ")")
    || hasUnclosedPair(content, "[", "]")
    || hasUnclosedPair(content, '"', '"')
  ) return { ok: false, reason: "unfinished_sentence" };
  if (isGenericPraise(content)) return { ok: false, reason: "generic_praise" };
  if (
    TASK_SUMMARY_PATTERNS.some((pattern) => pattern.test(content))
    || sourceTexts.some((source) => source?.trim() && repeatsSource(content, source))
  ) return { ok: false, reason: "task_summary" };

  const worst = (candidates: string[]) => candidates.reduce(
    (highest, candidate) => Math.max(highest, contentSimilarity(content, candidate)),
    0,
  );

  const siblingSimilarity = worst(siblingReplies);
  if (siblingSimilarity >= siblingThreshold) {
    return { ok: false, reason: "duplicate_of_sibling", similarity: siblingSimilarity };
  }

  const personaSimilarity = worst(personaRecentReplies);
  if (personaSimilarity >= personaThreshold) {
    return { ok: false, reason: "repeats_persona", similarity: personaSimilarity };
  }

  const opening = significantOpening(content);
  if (opening.split(" ").length === 2 && personaRecentReplies.some((reply) => significantOpening(reply) === opening)) {
    return { ok: false, reason: "repeats_persona", similarity: personaSimilarity };
  }

  return { ok: true, similarity: Math.max(siblingSimilarity, personaSimilarity) };
}
