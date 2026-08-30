/**
 * Task categories are free text the user types, so a persona cannot be matched
 * to a completion by category name alone. This narrows any completion post to a
 * small, stable taxonomy that persona affinity tables can be written against,
 * without spending a model call on every post.
 */
export const TASK_CATEGORIES = [
  "study",
  "work",
  "coding",
  "exercise",
  "cleaning",
  "cooking",
  "creative",
  "reading",
  "admin",
  "social",
  "self-care",
  "travel",
  "gaming",
  "other",
] as const;

export type TaskCategory = (typeof TASK_CATEGORIES)[number];

export interface ClassifiableTask {
  taskTitle?: string | null;
  category?: string | null;
  content?: string | null;
}

/**
 * Ordered because a completion mentioning both "study" and "read" should land on
 * the more specific signal. Earlier entries win ties, and the title is weighted
 * over the free-form caption so "Finished the essay. Watched a film after" stays
 * a study completion.
 */
const KEYWORDS: Array<[TaskCategory, RegExp]> = [
  ["coding", /\b(cod(e|ed|ing)|program(m(ed|ing))?|debug(g(ed|ing))?|refactor\w*|deploy(ed|ment)?|merge|pull request|\bpr\b|commit(ted)?|bug ?fix\w*|\bbugs?\b|api|typescript|javascript|python|rust|golang|sql|database|migration|compile\w*|unit tests?|regression|authentication|auth\b|frontend|backend|repo(sitory)?|leetcode|algorithm)/],
  ["gaming", /\b(gam(e|es|ing)|ranked|raid|boss|speedrun|valorant|league|apex|minecraft|elden|queue|matchmaking|esports?|console|playthrough|grind(ed|ing)?\s+(xp|levels?))/],
  ["study", /\b(stud(y|ied|ying)|homework|assignment|essay|thesis|dissertation|revis(e|ed|ing|ion)|exam|midterm|finals\b|final exam|quiz|lecture|problem set|flashcards?|anki|econometrics|calculus|chemistry|biology|physics|coursework|class(es)?|semester|kanji|vocab(ulary)?|practice tests?)/],
  ["exercise", /\b(run|ran|running|\d+\s?k(m|ilometers?)\b|jog(ged|ging)?|gym|workout|worked out|lift(ed|ing)?|squats?|deadlift|bench|yoga|pilates|swim(ming|s)?|cycl(e|ed|ing)|bike ride|cardio|stretch(ed|ing)?|steps|hike[ds]?|hiking|training session|push[- ]?ups?)/],
  ["cleaning", /\b(clean(ed|ing)?|tid(y|ied|ying)|declutter\w*|vacuum(ed|ing)?|laundry|dish(es|washer)?|mop(ped|ping)?|organiz(e|ed|ing)\s+(the\s+)?(room|closet|desk|kitchen|apartment|garage)|scrub(bed)?|trash|garbage|dust(ed|ing)?|chores?)/],
  ["cooking", /\b(cook(ed|ing)?|bak(e|ed|ing)|meal ?prep\w*|recipe|dinner|breakfast|lunch|groceries|grocery|kitchen|roast(ed)?|soup|bread|pasta|curry)/],
  ["creative", /\b(draw|drew|drawing|paint(ed|ing)?|sketch(ed|ing)?|illustrat\w+|design(ed|ing)?|piano|guitar|violin|sing(ing)?|vocal|rehears(e|ed|al)|choreograph\w*|danc(e|ed|ing)|compos(e|ed|ing)|record(ed|ing)?\s+(a|the)?\s?(song|track|demo)|edit(ed|ing)?\s+(the\s+)?(video|photo)|写|craft(ed|ing)?|knit(ted|ting)?|sew(ed|ing|n)?|photograph\w*|portfolio|logo|mockup|wrote\s+(a|the)?\s?(poem|story|chapter|novel|song))/],
  ["reading", /\b(read|reading|book|novel|chapter|manga|article|papers?\b|newsletter|audiobook|pages?\b)/],
  ["admin", /\b(tax(es)?|paperwork|invoice|bill(s|ed)?|insurance|appointment|form(s)?|renew(ed|al)?|passport|visa|bank(ing)?|budget|email(s|ed)?|inbox|schedul(e|ed|ing)|filed?|admin(istrative)?|dmv|registration|receipts?)/],
  ["work", /\b(work(ed)?|shift|meeting|standup|client|deck|slides?|presentation|report|deadline|proposal|interview|resume|cv\b|application|shipped|project|sprint|onboarding|spreadsheet)/],
  ["social", /\b(call(ed)?|friend|famil(y|ies)|dinner with|party|meet ?up|coffee with|text(ed)?|catch up|caught up|birthday|visit(ed)?|hang(ing)? out|date night)/],
  ["self-care", /\b(sleep|slept|nap(ped)?|rest(ed|ing)?|meditat\w+|journal(ed|ing)?|therap(y|ist)|skincare|shower|bath|hydrat\w+|water|breath(e|ing)|screen break|touch(ed)? grass|self[- ]?care|mental health|dentist|doctor)/],
  ["travel", /\b(trip|travel(l?ed|l?ing)?|flight|flew|airport|pack(ed|ing)?|train ride|commut(e|ed|ing)|hotel|itinerary|drove|driving|road trip|explor(e|ed|ing)|map(ped|ping)?)/],
];

/**
 * User-typed category names are matched with the same keyword table, which is
 * why an explicit "Esports" or "Chaos coding" resolves without any special case.
 */
function match(value: string): TaskCategory | null {
  for (const [category, pattern] of KEYWORDS) {
    if (pattern.test(value)) return category;
  }
  return null;
}

export function classifyTask({ taskTitle, category, content }: ClassifiableTask): TaskCategory {
  const normalized = (value?: string | null) => (value ?? "").toLowerCase().slice(0, 400);
  return match(normalized(category))
    ?? match(normalized(taskTitle))
    ?? match(normalized(content))
    ?? "other";
}

export type CategoryAffinity = Partial<Record<TaskCategory, number>>;

/**
 * A persona with no entry for the category is not disqualified, only quieter.
 * `other` doubles as the persona's baseline interest in anything unlisted, which
 * is how a deliberately broad character (Vex reframes every task as a quest)
 * stays plausible across the whole taxonomy without enumerating it.
 */
export function affinityFor(affinity: CategoryAffinity | null | undefined, category: TaskCategory) {
  if (!affinity) return 0.3;
  const direct = affinity[category];
  if (typeof direct === "number") return clampAffinity(direct);
  const baseline = affinity.other;
  return typeof baseline === "number" ? clampAffinity(baseline) : 0.3;
}

function clampAffinity(value: number) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.3;
}
