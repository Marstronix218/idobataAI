// The instant first stage of the distress check (SPEC Phase 5, PLAN D4): a hit
// shows the crisis card straight away, with no model call. It runs on the task
// title and note.
//
// TODO(founder): clinical review of distress protocol (SB 243 requires evidence-based methods)
//
// This is a starter list, not a clinically validated one. It favours catching
// distress over avoiding false positives: a false positive shows the crisis
// card instead of banter, which is safe; a miss is not. Phrases match whole
// words on normalised text (NFKC, lowercase, straight quotes, single spaces),
// so "self-harm", "self harm" and "selfharm" are all listed explicitly.

const PHRASES = [
  // Suicide and wanting to die.
  "suicide", "suicidal", "kill myself", "killing myself", "end my life", "ending my life", "end it all",
  "take my own life", "taking my own life", "want to die", "wanna die", "wish i was dead", "wish i were dead",
  "better off dead", "better off without me", "don't want to live", "do not want to live", "dont want to live",
  "don't want to be alive", "dont want to be alive", "no reason to live", "nothing to live for", "not worth living",
  "can't go on", "cant go on", "can't do this anymore", "cant do this anymore", "want to disappear forever",
  "suicide note",
  // Means and methods.
  "hang myself", "hanging myself", "jump off a bridge", "jump in front of a train", "overdose", "overdosing",
  "slit my wrists", "shoot myself",
  // Self-harm.
  "self harm", "self-harm", "selfharm", "self harming", "self-harming", "hurt myself", "hurting myself",
  "cut myself", "cutting myself", "burn myself", "burning myself", "punish myself",
  // Immediate danger.
  "he hits me", "she hits me", "afraid for my life", "not safe at home",
] as const;

/** Text normalised the way the phrases are written. */
export function normalizeForDistress(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[­᠎​-‏⁠-⁤﻿]/g, "")
    .replace(/[‘’‚‛′´`]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MATCHER = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?:${[...PHRASES].sort((a, b) => b.length - a.length).map(escape).join("|")})(?![\p{L}\p{N}])`,
  "gu",
);

/** The distress phrases found in `text`, in order, each once. Never log or store the result alongside the text. */
export function findDistressKeywords(text: string): string[] {
  return [...new Set(normalizeForDistress(text).match(MATCHER) ?? [])];
}

export const hasDistressKeyword = (text: string) => findDistressKeywords(text).length > 0;
