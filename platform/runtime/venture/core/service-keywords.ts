// Chausar venture launcher, core (P1; wave 6, 6E1): the substring keywords each service type is guessed from when no
// playbook phrase picks the idea (core/service-types.ts classifyIdea). Pure and import-free so the UI's fake engine
// reads the same list (app/ui/src/engine/fixtures.ts) and both guess alike. Keys follow SERVICE_TYPES order, because a
// tie goes to the type listed first; the wave 6 types (teaching, local services, licensed work) come last for that reason.

/** The service types of contracts.ts SERVICE_TYPES except 'other', named here so this file needs no engine import. */
export type KeywordServiceType = 'agency' | 'studio' | 'consulting' | 'bookkeeping' | 'research' | 'content' | 'support' | 'teaching' | 'local-services' | 'licensed';

/** Substring keywords per type, matched against the lower-cased idea. */
export const SERVICE_KEYWORDS: Readonly<Record<KeywordServiceType, readonly string[]>> = Object.freeze({
  agency: ['marketing', 'ads', 'advert', 'social media', 'agency', 'leads', 'outreach', 'growth', 'campaign'],
  studio: ['podcast', 'video', 'design', 'edit', 'photo', 'logo', 'brand', 'studio', 'animation'],
  consulting: ['consult', 'advis', 'coach', 'strategy', 'audit', 'mentor'],
  bookkeeping: ['bookkeep', 'accounts', 'accounting', 'gst', 'tax', 'ledger', 'payroll', 'invoice', 'books'],
  research: ['research', 'lead list', 'market', 'report', 'analysis', 'data', 'survey'],
  content: ['blog', 'newsletter', 'copy', 'writing', 'seo', 'article', 'content', 'script'],
  support: ['support', 'customer service', 'inbox', 'helpdesk', 'help desk', 'chat', 'tickets'],
  // W6 6E1 (D2).
  teaching: ['tuition', 'tutor', 'teach', 'lesson', 'classes', 'student', 'learner', 'spoken english', 'yoga', 'fitness', 'music', 'dance', 'trainer', 'worksheet', 'dietitian'],
  'local-services': ['salon', 'beauty', 'beautician', 'electrician', 'plumber', 'repair', 'home visit', 'home service', 'tiffin', 'home chef', 'catering', 'wedding', 'event planner', 'travel agent', 'real estate', 'physiotherap', 'technician', 'booking'],
  licensed: ['advocate', 'lawyer', 'legal', 'doctor', 'clinic', 'patient', 'physician', 'licensed', 'sign off', 'financial planner', 'mutual fund', 'sebi'],
});

/** A playbook as the pick reads it: its id, the service type it extends and the phrases that pick it (playbooks/registry.ts). */
export type PlaybookPicks = { id: string; serviceType: KeywordServiceType | 'other'; picks: readonly string[] };

/**
 * Phrases that name a trade: "event planner", "home salon", "chartered accountant", "recruitment agency". Such a phrase
 * picks its playbook where it names the owner's own work, and not where it names who the owner sells to (found in the
 * real app, 16 Nov 2026: a home baker who wanted "regular orders from offices and event planners" was set up as a
 * booking desk, because her customers are event planners). A phrase that names a thing or a service ("tender", "gst
 * filing", "youtube") or the playbook's own client ("stock trader") picks wherever it stands, as before.
 */
const TRADE = /(?:planner|chef|salon|accountant|advocate|coach|secretary|distributor|writer|manager|firm|practice|agency)$/;
/** Words that may stand between "for" and the trade without making it the owner's own: "for a", "from other local". */
const BEFORE_TRADE = 'a|an|the|local|small|big|large|busy|other|many|some|several|more|new|nearby|corporate|independent|top|all|any|each|every|most|few';
const WORD = "[a-z'\\u2019-]+";
/**
 * The words before a trade that make it who the owner sells to: "from", "for", "to", "serving", "supplying" or
 * "clients are", then the trade itself or a list that reaches it ("from offices and", "for schools, hotels and").
 * "for my" and "to be a" are not that: the trade is then the owner's.
 */
const SOLD_TO = new RegExp(`\\b(?:from|for|to|serving|serves?|suppl(?:y|ies|ying)|(?:clients?|customers?|buyers?)(?:\\s+(?:are|is|include|includes|like|such as))?:?)\\s+`
  + `(?:(?:${WORD}\\s+){0,2}${WORD}(?:,\\s*(?:(?:and|or)\\s+)?|\\s+(?:and|or|&)\\s+))*(?:(?:${BEFORE_TRADE})\\s+){0,2}$`);

/**
 * Whether the phrase stands in the words as the owner's work: anywhere for a thing, not as a customer for a trade.
 * text: lower case, spaces single. The no-AI field guess reads its own words the same way (core/families.ts).
 */
export function namesTheWork(text: string, phrase: string): boolean {
  let at = text.indexOf(phrase);
  if (at < 0 || !TRADE.test(phrase)) return at >= 0;
  for (; at >= 0; at = text.indexOf(phrase, at + 1)) if (!SOLD_TO.test(text.slice(Math.max(0, at - 120), at))) return true;
  return false;
}

/**
 * The playbook an idea picks: every playbook with a phrase that names the work in the lower-cased idea is a candidate,
 * the longest phrase found wins, and a tie goes to the playbook listed first. No phrase found gives null, and the plain
 * service type serves the business. Pure, so the engine (playbooks/registry.ts pickPlaybook) and the app's fake engine
 * (its fixture of the registry's phrases) pick alike.
 */
export function pickedBy<T extends Pick<PlaybookPicks, 'picks'>>(idea: string, entries: readonly T[]): T | null {
  const text = idea.toLowerCase().replace(/\s+/g, ' ');
  let best: T | null = null;
  let bestLength = 0;
  for (const entry of entries) {
    for (const phrase of entry.picks) {
      if (phrase.length > bestLength && namesTheWork(text, phrase)) { best = entry; bestLength = phrase.length; }
    }
  }
  return best;
}

/**
 * The service type of an idea. A playbook the idea picks gives the type it extends, whatever other keywords the idea
 * holds. Otherwise each keyword that names the work counts one hit for its type, the highest count wins, a tie goes to
 * the type listed first in SERVICE_KEYWORDS, and no hit is 'other'. Pure: core/service-types.ts classifyIdea and the fake's
 * classifier are both this, so the two place an idea alike (the fake used to skip the playbook, and so put a family's
 * lead sentence before "I run a recruitment agency", which then picked the job seekers' desk).
 */
export function classifiedBy(idea: string, entries: readonly PlaybookPicks[]): KeywordServiceType | 'other' {
  const picked = pickedBy(idea, entries);
  if (picked) return picked.serviceType;
  const text = idea.toLowerCase().replace(/\s+/g, ' ');
  let best: KeywordServiceType | 'other' = 'other';
  let bestHits = 0;
  for (const type of Object.keys(SERVICE_KEYWORDS) as KeywordServiceType[]) {
    // A keyword that names a trade counts as a playbook's phrase does: not where it names who the owner sells to.
    const hits = SERVICE_KEYWORDS[type].filter(keyword => namesTheWork(text, keyword)).length;
    if (hits > bestHits) { best = type; bestHits = hits; }
  }
  return best;
}
