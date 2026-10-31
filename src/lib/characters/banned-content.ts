// Things a first-party character must never say (SPEC "Non-negotiable
// guardrails"). Shared by the content linter (./lint.ts) and the Phase 3 AI
// output validator, so it is a pure function over a string.
//
// The patterns target the character's own voice: first-person claims ("I'm a
// doctor", "as your therapist", "I'm human"), pet names, guilt aimed at the
// user, and advice phrasing. Bare nouns are deliberately not banned, so
// "book doctor's appointment" or "call lawyer about lease" pass.
//
// findBannedContent() checks CHARACTER copy. Text that embeds a user's task
// title (an AI reaction must name the task) can repeat words the user chose,
// such as "Water the plants, love." or "Read Babe Ruth biography". The Phase 3
// validator must therefore check findBannedContent(maskTaskTitle(output, title)),
// never the raw output. Masking only removes the user's own words; anything the
// model adds around them is still checked.
//
// This is a starter list for review. The founder may extend it; give every new
// pattern a matching case in tests/domain/banned-content.test.ts.
//
// Matching runs on normalised text (NFKC, curly quotes straightened, soft
// hyphens and zero-width characters removed, lowercase, single spaces). Each
// pattern must start and end on a word boundary, and a trailing apostrophe
// also blocks a match, so "doctor's" never matches "doctor".
//
// Loaded by scripts/seed-characters.mjs with plain Node: relative imports only.

import { TASK_TOKEN } from "./content-schema";

export const BANNED_CONTENT_CATEGORIES = [
  "human_claim",
  "credential",
  "romance",
  "guilt",
  "professional_advice",
] as const;

export type BannedContentCategory = (typeof BANNED_CONTENT_CATEGORIES)[number];

export interface BannedContentMatch {
  category: BannedContentCategory;
  /** The matched text, as it appears in the normalised (lowercase) input. */
  phrase: string;
}

// Building blocks, written as regular-expression source.
const I_AM = String.raw`(?:i am|i'?m)`;
const I_HAVE = String.raw`(?:i have|i'?ve)`;
const YOU_ARE = String.raw`(?:you are|you'?re)`;
/** One optional softening word: "I'm actually human", "I'm basically your therapist". */
const SOFT = String.raw`(?:(?:actually|really|just|only|totally|truly|also|still|definitely|literally|honestly|basically|like) )?`;
const PROFESSION = [
  "therapist", "psychotherapist", "psychologist", "psychiatrist", "psychoanalyst",
  "counsell?or", "doctor", "physician", "surgeon", "nurse", "pharmacist", "dietitian", "nutritionist",
  "clinician", "social worker", "(?:mental health|medical|health ?care) (?:professional|provider)",
  "lawyer", "attorney", "solicitor", "paralegal",
  "(?:financial|investment|tax) advis[eo]r", "financial planner", "accountant", "cpa",
  "(?:life|health|wellness|adhd|executive|career) coach",
].join("|");
const QUALIFIER = String.raw`(?:licensed|certified|board[- ]certified|registered|qualified|trained|practi[cs]ing|professional|real|actual|clinical)`;
const PROFESSIONAL = String.raw`(?:${QUALIFIER} )*(?:${PROFESSION})`;
const FIRST_PERSON = String.raw`(?:i|i'd|i'm|i'll|i've|my)`;
/**
 * The `{task}` that maskTaskTitle() leaves. A claim whose object is the mask
 * ("I'm a {task}" for a task titled "doctor") is still a claim: the model
 * wrote the "I'm a", so masking must not hide it. The category is a best
 * guess, since the title could be anything.
 */
const MASK = String.raw`\{task\}`;
/** Words that only read as a pet name when they address the user directly. */
const VOCATIVE = String.raw`(?:honey|baby|babe|love|dear|sugar|hon|my love|my dear|my sweet)`;
const GREETING = String.raw`(?:hey|hi|hello|hiya|morning|good morning|night|good night|thanks|thank you|nice work|nice job|good job|great job|well done)`;
/** A greeting or praise that, followed straight away by a name, addresses someone by it. */
const ADDRESS_LEAD = String.raw`(?:${GREETING}|great work|good work|nice one|nice going|way to go|congrats|congratulations|bravo|cheers|bye|goodbye|proud of you)`;
const MEDS = String.raw`(?:meds|medications?|medicine|pills|antidepressants?|ssris?|stimulants?|adderall|ritalin|vyvanse|xanax|zoloft|prozac|lexapro|melatonin|ibuprofen|tylenol|advil|insulin|benzos?|sleeping pills|supplements)`;
const CONDITION = String.raw`(?:adhd|clinical depression|depression|an anxiety disorder|anxiety|bipolar(?: disorder)?|ocd|ptsd|autism|burnout|insomnia|executive dysfunction|an? (?:mental|mood|anxiety|eating|personality|sleep) disorder)`;
/** Things a streak can be that are not the streak itself: "reset the streak counter". */
const NOT_STREAK_THING = String.raw`(?! (?:counter|tracker|count|freeze|widget|app|calendar|chart|log|reminder|settings?)\b)`;
const DOSE = String.raw`\d+(?:\.\d+)? ?(?:mg|mcg|milligrams?|micrograms?)`;
const ADVISE = String.raw`(?:you should|you need to|you must|you ought to|you have to|i'd|i would|i recommend|i suggest|i'd suggest|i'd recommend|i advise you to|my advice is to)`;

const PATTERNS: Record<BannedContentCategory, readonly string[]> = {
  // Claims to be human, a real person, or not an AI.
  human_claim: [
    String.raw`${I_AM} ${SOFT}(?:a |an )?(?:real |actual |living |regular |normal )?(?:human(?: being)?|person)`,
    String.raw`${I_AM} ${SOFT}(?:a )?(?:real|actual) (?:man|woman|guy|girl|boy|lady)`,
    String.raw`${I_AM} ${SOFT}(?:not|no) (?:an? )?(?:ai|a\.i\.|artificial intelligence|artificial|bot|robot|chat ?bot|machine|computer(?: program)?|program|language model|llm|algorithm|simulation|virtual (?:assistant|character)|fictional(?: character)?)`,
    String.raw`${I_AM} ${SOFT}flesh(?: and |-and-)blood|${I_AM} ${SOFT}real(?=\s*(?:[,.!?;:]|$))`,
    String.raw`${YOU_ARE} (?:talking|chatting|speaking|texting) (?:to|with) (?:a |an )?(?:real |actual )?(?:human|person)`,
    String.raw`as (?:a fellow|another|a real|one) (?:human|person)`,
    String.raw`as a human(?: being)?,? ${FIRST_PERSON}`,
    String.raw`(?:a )?(?:real|actual) (?:human|person) (?:is|here|behind|writing|typing)`,
    String.raw`${I_AM} ${SOFT}(?:a |an |your )?(?:real |actual )?${MASK}`,
  ],

  // Claims to be a therapist, doctor, lawyer, counselor, licensed, and so on.
  credential: [
    String.raw`${I_AM} ${SOFT}(?:a |an |your )?${PROFESSIONAL}`,
    String.raw`as (?:an?|your|a fellow) ${PROFESSIONAL}`,
    String.raw`${I_AM} ${SOFT}(?:a |an |your )?(?:licensed|certified|board[- ]certified|accredited|registered) coach`,
    String.raw`i (?:work|worked|am working|practi[cs]e|practi[cs]ed) as (?:an? |your )?${PROFESSIONAL}`,
    String.raw`${I_HAVE} (?:been|worked as|trained as|qualified as) (?:an? |your )?${PROFESSIONAL}`,
    String.raw`${I_AM} ${SOFT}(?:licensed|certified|board[- ]certified|accredited|qualified to (?:diagnose|treat|prescribe|practi[cs]e))`,
    String.raw`my (?:medical|law|legal|nursing|therapy|counsell?ing|clinical|psychology|psychiatric) (?:license|licence|degree|practice|training|credentials|background|school)`,
    String.raw`my patients`,
    String.raw`in my (?:professional|clinical|medical|legal|expert) (?:opinion|experience|judge?ment|view)`,
    String.raw`i (?:went to|graduated from|finished) (?:med|medical|law|nursing) school`,
    String.raw`as (?:an?|your|a fellow) (?:${QUALIFIER} )*${MASK}|as ${MASK},? ${FIRST_PERSON}`,
    String.raw`i (?:work|worked|am working|practi[cs]e|practi[cs]ed) as (?:an? |your )?${MASK}|${I_HAVE} (?:been|worked as|trained as|qualified as) (?:an? |your )?${MASK}`,
    String.raw`i (?:practi[cs]e|practi[cs]ed|studied) (?:medicine|law|psychology|psychiatry|therapy)`,
  ],

  // Flirting, romantic or sexual interest, pet names.
  romance: [
    String.raw`sweetheart|sweetie(?: pie)?|sweetums|darling|darlin'|babe(?! ruth)|bae|cutie(?: pie)?|honey ?bun(?:ny)?|hunny|sugar ?pie|snookums|love ?bug|hottie|dearest|my (?:darling|angel|beloved)`,
    String.raw`${GREETING},? ${VOCATIVE}(?! (?:steps?|it|this|that|the|your|yourself|to|how|seeing)\b)`,
    String.raw`oh,? (?:honey|baby|sugar|hon|sweetie)`,
    // The user's title used as a name: with a title such as "honey", masking
    // turns "Nice work, honey!" into "nice work, {task}!", which must still be
    // caught. Only the vocative shape counts: a greeting or praise followed
    // directly by the mask and then a comma, end punctuation or the end, so
    // "Great job on {task}!" and "Nice work, {task} is done." pass.
    String.raw`${ADDRESS_LEAD},? ${MASK}(?=\s*(?:[,!.?]|$))`,
    String.raw`(?<=, )(?:${VOCATIVE}|gorgeous|beautiful|handsome|sexy|my queen|my king)(?= ?[.!?]| ?$)`,
    String.raw`love you(?! (?:to|card|cards|note)\b)|love ya|luv (?:you|ya|u)|i adore you|miss(?:ed)? you(?! (?:to|at|by|on)\b)`,
    String.raw`in love with you|(?:falling|fell|fall) for you|crush on you|(?:have|had|got) a crush`,
    String.raw`${YOU_ARE} (?:so |really |very |looking |super |extra |kind of |kinda )?(?:sexy|gorgeous|cute|beautiful|handsome|attractive|adorable|stunning|irresistible|dreamy)|${YOU_ARE} (?:so |really |very |looking )?hot(?! (?:on|streak)\b)`,
    String.raw`you look (?:so |really |very )?(?:hot|sexy|gorgeous|cute|beautiful|handsome|attractive|stunning)`,
    String.raw`kiss(?:es|ing)? (?:you|me)|(?:sending|send|big|blowing|blow|hugs and) kisses|kisses (?:for|to) you|xoxo|\*(?:winks?|blush(?:es)?|kiss(?:es)?)\*`,
    String.raw`(?:cuddle|snuggle)(?: up)? (?:with )?you|hold you (?:close|tight)|in my arms`,
    String.raw`(?:go out|go on a date) with me|(?:date|marry) me|be my (?:girlfriend|boyfriend|partner|valentine|wife|husband|date|lover)|${I_AM} your (?:girlfriend|boyfriend|wife|husband|lover|date|valentine)`,
    String.raw`turn(?:s|ed|ing)? me on|sexy|sexual(?:ly)? (?:attract(?:ed|ion)|interest(?:ed)?|tension|desire)|sext(?:ing)?|flirt(?:s|ed|ing|y|atious)?|seduc(?:e|es|ed|ing|tive)`,
    String.raw`(?:can't stop|keep) thinking about you|${YOU_ARE} mine|be mine|(?:i have|i've got|i've|i got) (?:feelings|a thing) for you|romantic(?:ally)? (?:interested|feelings|interest)`,
  ],

  // Shaming, lost or broken streaks, disappointment, punishment, a sad character.
  guilt: [
    String.raw`(?:${I_AM}|i was|i feel|i felt) ${SOFT}(?:so |very |a (?:little|bit) )?disappointed`,
    String.raw`disappointed (?:in|with|by) you|you (?:disappointed|failed|let down) (?:me|us|yourself|everyone)|(?:what|such) a (?:disappointment|letdown|shame)`,
    String.raw`${YOU_ARE} (?:such )?a (?:disappointment|failure|letdown|quitter|slacker)`,
    String.raw`let (?:me|us|yourself|everyone) down|shame on you|(?:you should be|feel) ashamed|ashamed of you(?:rself)?|how could you (?:do (?:this|that)|forget|skip)`,
    String.raw`(?:lost|broke|broken|ruined|killed|blew|reset|wasted|snapped) (?:your|the|our|that|a|this) (?:\d+[- ]day |perfect |whole )?streak${NOT_STREAK_THING}`,
    String.raw`streak(?: is| was|'s| has been| got| just got) (?:gone|broken|lost|dead|ruined|reset|toast)|streak(?: is| was|'s) over(?=\s*(?:[,.!?;:]|$)| now\b| for good\b)`,
    String.raw`(?:broken|lost|dead|ruined) streak${NOT_STREAK_THING}|streak (?:has |just |has just )?(?:died|ended|broke|reset)(?! up\b)|streak (?:lost|gone|broken|over|reset|dead|ended)(?=\s*(?:[,.!?;:]|$))`,
    String.raw`you (?:missed|skipped|blew off) (?:a day|yesterday|today|\d+ days|(?:a few|a couple of|several|two|three|some|so many) days|(?:your|a) (?:day|goal|streak|check-in))`,
    String.raw`where (?:were you|have you been|did you go)|(?:you|you've|you have) (?:abandoned|forgotten|forgot|ignored|left|ghosted) (?:me|us)|don't (?:leave|forget|abandon|ignore) me`,
    String.raw`(?:i was|i've been|i have been|i got|i felt|i feel|${I_AM}) ${SOFT}(?:so |very )?(?:lonely|sad|heartbroken|hurt|crushed|devastated|worried sick)`,
    String.raw`(?:made|make|makes|making) me (?:sad|cry|upset|lonely)|i (?:cried|was crying|have been crying)|${I_AM} (?:upset|mad|angry|annoyed|frustrated) (?:with|at) you`,
    String.raw`(?:${YOU_ARE}|you've been|you were) (?:so |being |really |too |just )?(?:lazy|pathetic|useless|hopeless|worthless|a slacker)|(?:stop being|don't be) (?:so )?lazy`,
    String.raw`no (?:more )?excuses|you promised me|you owe me|you don't deserve|(?:you'll|you will) (?:regret (?:it|this)|be sorry)`,
    String.raw`(?:why|how come) (?:didn't|haven't|wouldn't|won't) you|you didn't even|you (?:wasted|blew|threw away) (?:the|your|another|a whole|all) (?:day|week|time|chance|progress)|(?:another|yet another) (?:wasted|lost) day`,
    String.raw`as (?:a |your )?punishment|your punishment|punish(?:es|ed|ing)? you(?:rself)?|(?:you'll|you will|you'd|you) (?:be|get) punished|deserve (?:a |to be )?punish(?:ment|ed)`,
    String.raw`(?:i've|i have) been waiting (?:for you|all day|forever)|look who (?:finally )?(?:showed up|decided to show up)|about time you`,
  ],

  // Diagnosing, prescribing, dosage, and legal or financial advice phrasing.
  professional_advice: [
    String.raw`${ADVISE} (?:try |start |stop |keep )?(?:taking|take|trying|try|upping|increasing|increase|decreasing|decrease|lowering|lower|doubling|double|skipping|skip|stopping|stop|cutting|cut|quitting|quit|switching|switch)(?: to| off| back on)? (?:your |the |more |less |some |a higher |a lower |an extra )?(?:(?:dose|dosage) of )?(?:${MEDS}|dose|dosage)`,
    String.raw`(?:stop|quit) taking your ${MEDS}|(?:increase|decrease|double|halve|lower|raise|adjust) your (?:dose|dosage|meds|medication)`,
    String.raw`(?:i|i'd|i would|i'll|i can) (?:recommend|suggest|prescribe)(?: taking| trying| some| an?| a little)? ${MEDS}`,
    String.raw`${ADVISE} (?:take |taking |try |trying |up to |start (?:at|with) )?${DOSE}|${DOSE} (?:a day|daily|per day|twice a day|three times a day|every \d+ hours)|(?:the right|a safe|a normal|the recommended|a typical|your) (?:dose|dosage) (?:is|would be|should be)`,
    String.raw`i(?:'d| would| will|'ll| can)? prescribe|${I_AM} prescribing|my prescription (?:for you|is)`,
    String.raw`i(?:'d| would| can|'m)? (?:diagnose|diagnosing)|my diagnosis`,
    String.raw`(?:sounds|looks|seems) like (?:you(?:'ve| have)? (?:got )?|you're dealing with |classic )?${CONDITION}`,
    String.raw`you (?:probably|definitely|clearly|might|may|must|could) (?:have|be suffering from) ${CONDITION}|you (?:suffer|are suffering) from ${CONDITION}|${YOU_ARE} (?:clinically |probably |definitely )?(?:depressed|bipolar|autistic|manic)`,
    String.raw`(?:classic|textbook|typical) (?:signs? of |symptoms? of )?${CONDITION}|(?:that's|this is|it's|these are) (?:a |an )?(?:symptoms?|signs?) of ${CONDITION}`,
    String.raw`(?:my|here's(?: my| some)?|this is|take my|some quick|some free|professional|not) (?:medical|legal|financial|investment|tax|mental[- ]health|clinical|health|nutritional|dietary) advice`,
    String.raw`you don't need (?:a doctor|to see a doctor|a therapist|therapy|medication|your meds|a lawyer)`,
    String.raw`you (?:should|could|can|need to|ought to|have grounds to|have every right to) (?:sue|press charges|file a (?:lawsuit|claim|complaint)|take (?:them|him|her|it) to court|break (?:the|your|a) (?:lease|contract))`,
    String.raw`legally(?:,| speaking,?)? you (?:can|can't|cannot|should|shouldn't|must|have to|are allowed|aren't allowed|are entitled|have the right)|${YOU_ARE} legally (?:entitled|required|obligated|allowed)|you have a (?:strong |good |solid |clear )?legal case|(?:that's|that is|this is|it's) (?:totally |completely |clearly )?(?:illegal|against the law|a breach of contract)`,
    String.raw`you should (?:buy|sell|short|hold) (?:some |more |the )?(?:stocks?|shares|crypto|bitcoin|btc|ethereum|bonds|etfs?|index funds|options|gold|real estate)|${ADVISE} (?:invest|investing|put|putting|move|moving) (?:your (?:money|savings|paycheck|401k|ira|retirement)|(?:money )?(?:in|into) (?:stocks?|crypto|bitcoin|index funds|etfs?|bonds|the (?:stock )?market|real estate))`,
    String.raw`you should (?:refinance|consolidate your debt|declare bankruptcy|file for bankruptcy|take out a (?:loan|mortgage))|guaranteed (?:returns?|profits?|gains?)|(?:it's|that's) (?:tax[- ]deductible|a tax write-off)|you can (?:deduct|write off) (?:that|this|it)`,
  ],
};

const COMPILED = BANNED_CONTENT_CATEGORIES.flatMap((category) =>
  PATTERNS[category].map((source) => ({
    category,
    regex: new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${source})(?![\p{L}\p{N}'])`, "gu"),
  })),
);

/** The form `findBannedContent` matches against. */
export function normalizeForBannedContent(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\u00AD\u180E\u200B-\u200F\u2060-\u2064\uFEFF]/g, "")
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u00B4`]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Every banned phrase in `text`, in order of appearance. A phrase inside a
 * longer match of the same category is dropped, and repeats are listed once.
 * An empty array means the text is clean.
 */
export function findBannedContent(text: string): BannedContentMatch[] {
  const normalized = normalizeForBannedContent(text);
  const found: Array<BannedContentMatch & { start: number; end: number }> = [];
  for (const { category, regex } of COMPILED) {
    for (const match of normalized.matchAll(regex)) {
      found.push({ category, phrase: match[0], start: match.index, end: match.index + match[0].length });
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);

  const kept: typeof found = [];
  for (const match of found) {
    const nested = kept.some((other) => other.category === match.category && other.start <= match.start && match.end <= other.end);
    const repeated = kept.some((other) => other.category === match.category && other.phrase === match.phrase);
    if (!nested && !repeated) kept.push(match);
  }
  return kept.map(({ category, phrase }) => ({ category, phrase }));
}

/**
 * Titles with fewer letters and digits than this are left alone, so a task
 * named "I" or "Im" cannot hide "I'm human" from the check.
 */
export const MIN_MASKED_TITLE_CHARS = 4;

/**
 * `text`, normalised, with every whole-word, case-insensitive occurrence of the
 * task title replaced by `{task}`. Call it before findBannedContent() on any
 * text that embeds the user's task title, such as an AI reaction. Claims made
 * about the mask itself ("I'm a {task}", "as your {task}") are still flagged.
 */
export function maskTaskTitle(text: string, taskTitle: string): string {
  const normalizedText = normalizeForBannedContent(text);
  const title = normalizeForBannedContent(taskTitle);
  if (title.replace(/[^\p{L}\p{N}]/gu, "").length < MIN_MASKED_TITLE_CHARS) return normalizedText;
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return normalizedText.replace(new RegExp(String.raw`(?<![\p{L}\p{N}])${escaped}(?![\p{L}\p{N}])`, "gu"), TASK_TOKEN);
}
