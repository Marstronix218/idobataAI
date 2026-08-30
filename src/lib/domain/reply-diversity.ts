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
  "congratulations on completing",
];

export function isGenericPraise(content: string) {
  const normalized = normalize(content);
  return GENERIC_PHRASES.some((phrase) => normalized.includes(phrase));
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
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
  reason?: "generic_praise" | "duplicate_of_sibling" | "repeats_persona";
  similarity?: number;
}

export interface DiversityCheckInput {
  content: string;
  /** Text other personas have already published on the same post. */
  siblingReplies?: string[];
  /** This persona's own recent replies, which must not become a catchphrase. */
  personaRecentReplies?: string[];
  siblingThreshold?: number;
  personaThreshold?: number;
}

export function checkReplyDiversity({
  content,
  siblingReplies = [],
  personaRecentReplies = [],
  // A sibling reply on the same post is read side by side, so it is held to a
  // stricter standard than one of this persona's replies from another thread.
  siblingThreshold = 0.4,
  personaThreshold = 0.55,
}: DiversityCheckInput): DiversityVerdict {
  if (isGenericPraise(content)) return { ok: false, reason: "generic_praise" };

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

  return { ok: true, similarity: Math.max(siblingSimilarity, personaSimilarity) };
}
