import { affinityFor, classifyTask, type CategoryAffinity, type TaskCategory } from "./task-affinity";

/**
 * Deciding which personas notice a completed task is a ranking problem, not a
 * generation problem: asking a model "should each of 27 characters react?" is
 * slow, expensive, and produces universal attention, which is the exact feeling
 * the feed must avoid. Candidates are narrowed here first, and only the few that
 * survive ever reach the provider.
 */
export type SocialActivity = "high" | "medium" | "selective";
export type EngagementAction = "like" | "reply" | "quote";

export interface PersonaEngagementProfile {
  id: string;
  slug?: string;
  active: boolean;
  muted?: boolean;
  /** User-selected preference. It raises weight but never bypasses a roll. */
  isFavorite?: boolean;
  socialActivity: SocialActivity;
  likeAffinity: number;
  replyAffinity: number;
  quoteAffinity: number;
  categoryAffinity?: CategoryAffinity | null;
}

/** Recent behaviour that suppresses a persona regardless of how well it fits. */
export interface PersonaRecentActivity {
  /** Replies this persona has already left on this author's recent posts. */
  repliesToAuthorRecently?: number;
  /** Quote reposts this persona has published in the trailing window. */
  quotesRecently?: number;
  /** Any engagement this persona already has planned or stored on this post. */
  engagedThisPost?: boolean;
}

export interface EngagementPost {
  id: string;
  authorId?: string | null;
  taskTitle?: string | null;
  category?: string | null;
  content?: string | null;
  streak?: number | null;
  xpEarned?: number | null;
  focusMinutes?: number | null;
}

export interface EngagementLimits {
  maxLikes: number;
  maxReplies: number;
  maxQuotes: number;
  /** How many ranked personas are even considered for an action. */
  candidatePool: number;
}

export interface EngagementFlags {
  likes: boolean;
  replies: boolean;
  quotes: boolean;
}

export interface PlannedPersonaEngagement {
  postId: string;
  companionId: string;
  action: EngagementAction;
  /** Seconds after publication before the action should become visible. */
  delaySeconds: number;
  /** Debug metadata; never rendered to a user. */
  reason: {
    taskCategory: TaskCategory;
    affinity: number;
    score: number;
    isFavorite: boolean;
    probability: number;
    roll: number;
  };
}

export interface PlanPersonaEngagementInput {
  post: EngagementPost;
  companions: PersonaEngagementProfile[];
  activity?: Record<string, PersonaRecentActivity>;
  limits?: Partial<EngagementLimits>;
  flags?: Partial<EngagementFlags>;
  /** Personas already handled elsewhere, such as the guaranteed first reply. */
  excludeCompanionIds?: string[];
}

export const DEFAULT_ENGAGEMENT_LIMITS: EngagementLimits = {
  maxLikes: 5,
  maxReplies: 2,
  maxQuotes: 1,
  candidatePool: 8,
};

const ACTIVITY_WEIGHT: Record<SocialActivity, number> = {
  high: 1,
  medium: 0.78,
  selective: 0.48,
};

/**
 * Selective characters are meant to feel present without being talkative, so
 * their attention is redistributed toward the cheapest signal rather than
 * removed. A like from Ren should stay more likely than a reply from Ren.
 */
const LIKE_ACTIVITY_WEIGHT: Record<SocialActivity, number> = {
  high: 1,
  medium: 0.88,
  selective: 0.78,
};

/**
 * Quote reposts move a user's completion into the persona's own public feed, so
 * they must stay scarce enough to still mean something. Every quote probability
 * is scaled by this on top of an already-low per-persona affinity.
 */
const QUOTE_SCARCITY = 0.22;
/**
 * A feed that is too quiet reads as broken rather than restrained, so both
 * conversational channels are lifted uniformly here. Quotes are deliberately
 * left out: scarcity is what makes them mean something. This is the dial to
 * turn when the world should feel busier, in preference to editing per-persona
 * affinities, which encode character rather than feed density.
 */
const ENGAGEMENT_LIFT = 1.2;
const FAVORITE_RANK_BOOST = 0.18;
const FAVORITE_PROBABILITY_MULTIPLIER = 1.25;

/** Consecutive replies to one author read as a bot following them around. */
const MAX_CONSECUTIVE_REPLIES_TO_AUTHOR = 2;
const MAX_RECENT_QUOTES_PER_PERSONA = 1;

function hash(...parts: string[]) {
  let value = 2166136261;
  const source = parts.join(":");
  for (let index = 0; index < source.length; index += 1) {
    value ^= source.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

/**
 * Randomness has to survive a retry: publication is idempotent, the planner can
 * run twice for the same post, and a second run that reached a different verdict
 * would double-engage. Every roll is therefore a pure function of the post, the
 * persona, and the channel being rolled for.
 */
function roll(postId: string, companionId: string, channel: string) {
  return hash(postId, companionId, channel) / 0xffffffff;
}

function clamp01(value: number) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/**
 * A quote repost needs a stronger hook than a reply, so the post itself has to
 * earn one. Length, streak, effort, and the phrasing people reach for on a
 * genuinely hard finish all raise the bar a persona has to clear.
 */
export function postSignificance(post: EngagementPost) {
  const content = (post.content ?? "").trim();
  const title = (post.taskTitle ?? "").trim();
  let significance = 0.15;
  if (content.length >= 80) significance += 0.15;
  if ((post.streak ?? 0) >= 5) significance += 0.2;
  if ((post.xpEarned ?? 0) >= 50) significance += 0.15;
  if ((post.focusMinutes ?? 0) >= 60) significance += 0.15;
  if (/\b(final(ly)?|at last|whole|entire|all of|every|submitted|first|done with)\b/i.test(`${title} ${content}`)) significance += 0.2;
  if (/\b(four|five|six|\d{2,})\b/.test(`${title} ${content}`)) significance += 0.1;
  return clamp01(significance);
}

function eligible(
  companion: PersonaEngagementProfile,
  history: PersonaRecentActivity,
  excluded: Set<string>,
) {
  return companion.active
    && !companion.muted
    && !excluded.has(companion.id)
    && !history.engagedThisPost;
}

/**
 * Ranks every eligible persona, then walks the shortlist deciding one action
 * each. Ordering matters: the best-matched persona gets first refusal on the
 * scarce channels, and the caps are consumed as the walk proceeds, so a post
 * cannot accumulate a crowd of textual reactions no matter how many personas fit.
 */
export function planPersonaEngagement({
  post,
  companions,
  activity = {},
  limits,
  flags,
  excludeCompanionIds = [],
}: PlanPersonaEngagementInput): PlannedPersonaEngagement[] {
  const caps = { ...DEFAULT_ENGAGEMENT_LIMITS, ...limits };
  const enabled: EngagementFlags = { likes: true, replies: true, quotes: true, ...flags };
  const excluded = new Set(excludeCompanionIds);
  const taskCategory = classifyTask(post);
  const significance = postSignificance(post);

  const ranked = companions
    .map((companion) => {
      const history = activity[companion.id] ?? {};
      const affinity = affinityFor(companion.categoryAffinity, taskCategory);
      const activityWeight = ACTIVITY_WEIGHT[companion.socialActivity] ?? ACTIVITY_WEIGHT.medium;
      // Controlled randomness keeps the same persona from owning a category
      // forever, while affinity keeps the shortlist recognisably relevant.
      const jitter = roll(post.id, companion.id, "rank");
      const favoriteBoost = companion.isFavorite ? FAVORITE_RANK_BOOST : 0;
      return {
        companion,
        history,
        affinity,
        activityWeight,
        // Weighted so a persona the task actually suits normally outranks a
        // chattier one, without the shortlist becoming the same faces forever.
        score: affinity * 0.6 + activityWeight * 0.26 + jitter * 0.14 + favoriteBoost,
      };
    })
    .filter(({ companion, history }) => eligible(companion, history, excluded))
    .sort((left, right) => right.score - left.score || (left.companion.id < right.companion.id ? -1 : 1))
    .slice(0, Math.max(0, caps.candidatePool));

  const planned: PlannedPersonaEngagement[] = [];
  let likes = 0;
  let replies = 0;
  let quotes = 0;

  for (const candidate of ranked) {
    const { companion, history, affinity, activityWeight, score } = candidate;
    const isFavorite = Boolean(companion.isFavorite);
    const favoriteMultiplier = isFavorite ? FAVORITE_PROBABILITY_MULTIPLIER : 1;
    const base = { taskCategory, affinity, score, isFavorite };

    const quoteRoll = roll(post.id, companion.id, "quote");
    const quoteProbability = enabled.quotes
      && quotes < caps.maxQuotes
      && (history.quotesRecently ?? 0) < MAX_RECENT_QUOTES_PER_PERSONA
      // Squaring the affinity is what makes a quote require a real angle rather
      // than mere tolerance for the category.
      ? clamp01(companion.quoteAffinity * affinity * affinity * activityWeight * significance * favoriteMultiplier) * QUOTE_SCARCITY
      : 0;
    if (quoteProbability > 0 && quoteRoll < quoteProbability) {
      quotes += 1;
      planned.push({
        postId: post.id,
        companionId: companion.id,
        action: "quote",
        delaySeconds: 900 + Math.floor(roll(post.id, companion.id, "quote-delay") * 1800),
        reason: { ...base, probability: quoteProbability, roll: quoteRoll },
      });
      continue;
    }

    const replyRoll = roll(post.id, companion.id, "reply");
    const replyProbability = enabled.replies && replies < caps.maxReplies
      && (history.repliesToAuthorRecently ?? 0) < MAX_CONSECUTIVE_REPLIES_TO_AUTHOR
      ? clamp01(companion.replyAffinity * affinity * activityWeight * favoriteMultiplier * ENGAGEMENT_LIFT)
      : 0;
    if (replyProbability > 0 && replyRoll < replyProbability) {
      replies += 1;
      planned.push({
        postId: post.id,
        companionId: companion.id,
        action: "reply",
        delaySeconds: 120 + Math.floor(roll(post.id, companion.id, "reply-delay") * 600),
        reason: { ...base, probability: replyProbability, roll: replyRoll },
      });
      continue;
    }

    const likeRoll = roll(post.id, companion.id, "like");
    const likeProbability = enabled.likes && likes < caps.maxLikes
      ? clamp01(companion.likeAffinity * affinity * (LIKE_ACTIVITY_WEIGHT[companion.socialActivity] ?? LIKE_ACTIVITY_WEIGHT.medium) * favoriteMultiplier * ENGAGEMENT_LIFT)
      : 0;
    if (likeProbability > 0 && likeRoll < likeProbability) {
      likes += 1;
      planned.push({
        postId: post.id,
        companionId: companion.id,
        action: "like",
        delaySeconds: Math.floor(roll(post.id, companion.id, "like-delay") * 180),
        reason: { ...base, probability: likeProbability, roll: likeRoll },
      });
    }
  }

  return planned;
}
