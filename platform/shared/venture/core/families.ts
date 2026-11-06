// Chausar venture launcher, core (wave 6, 6C2): the eleven profession families of the beta (DECISIONS D2), the tiles of
// About you, and the code-owned plan sentence each family starts from. The AI picks a family from the owner's words; the
// tiles are the fallback and the correction path; the keyword guesser runs only when no AI is connected (D16).
//
// The whole business keys on its idea sentence (classifyIdea and pickPlaybook read venture.idea), so a family reaches the
// plan through a sentence: the owner's own words when they already plan as the family's service type, else the family's
// plan sentence first. Every plan sentence is checked by test to classify as its family's service type.
//
// W6 6E1: teaching, local services and licensed work plan as their own service types (core/service-types.ts). Documents
// and people still plan as consulting: D2 adds only those three types. The 57 professions in each family are in
// core/professions.ts (6E6), and every profession's own name finds its family through the keywords below.
// Template words only: no digits, no prices, no done claims.

import type { FamilyId, FamilyOffer } from '../../../contract/venture/core/first-run-types.ts';

/** The service types of contracts.ts SERVICE_TYPES, named here so this file needs no engine import. */
type ServiceType = 'agency' | 'studio' | 'consulting' | 'bookkeeping' | 'research' | 'content' | 'support' | 'teaching' | 'local-services' | 'licensed' | 'other';

export type { FamilyId, FamilyOffer } from '../../../contract/venture/core/first-run-types.ts';
export const FAMILY_IDS: readonly FamilyId[] = Object.freeze([
  'money-tax', 'teaching', 'creative', 'writing', 'local-services', 'documents', 'research', 'people', 'shop-office', 'tech', 'licensed',
]);

export type Family = {
  id: FamilyId;
  label: string;
  /** The tile's second line: who belongs here. */
  line: string;
  /** The service type the family plans as. */
  serviceType: ServiceType;
  /** The sentence a tile pick starts the plan from, and the lead put before owner words that plan as another type. */
  planIdea: string;
  /** Code-owned offers shown when no AI read the owner's words (a tile pick, or no AI connected). */
  offers: readonly FamilyOffer[];
  /** Lower-case words that point at this family, for the no-AI guesser only. */
  keywords: readonly string[];
};

const f = (family: Family) => Object.freeze({ ...family, offers: Object.freeze(family.offers.map(offer => Object.freeze(offer))), keywords: Object.freeze([...family.keywords]) });

export const FAMILIES: readonly Family[] = Object.freeze([
  f({
    id: 'money-tax', label: 'Money and tax', line: 'CA, accountant, payroll, company secretary', serviceType: 'bookkeeping',
    planIdea: 'Monthly bookkeeping, GST and tax filing for small businesses',
    offers: [
      { name: 'Monthly books', line: 'Bank matching, bills and a short report' },
      { name: 'GST returns', line: 'A filing pack for each return' },
      { name: 'Income tax returns', line: 'Papers gathered and the return prepared for your review' },
    ],
    keywords: ['chartered accountant', ' ca ', 'accountant', 'accounting', 'bookkeep', 'gst', 'income tax', 'itr', 'payroll', 'company secretary', 'audit'],
  }),
  f({
    id: 'teaching', label: 'Teaching and coaching', line: 'Teacher, tutor, trainer, yoga, music, mentor', serviceType: 'teaching',
    planIdea: 'Tuition classes and lessons for students and adult learners',
    offers: [
      { name: 'Weekly classes', line: 'Small batches with notes and practice work' },
      { name: 'One to one sessions', line: 'Focused help on what the learner needs' },
      { name: 'Progress reports', line: 'A short update for learners or parents' },
    ],
    keywords: ['teacher', 'teach', 'tutor', 'tuition', 'trainer', 'training', 'coach', 'yoga', 'fitness', 'music', 'dance', 'mentor', 'spoken english', 'dietitian', 'language'],
  }),
  f({
    id: 'creative', label: 'Creative work', line: 'Designer, photographer, video editor, voice artist', serviceType: 'studio',
    planIdea: 'Photo, video and design work for small brands and creators',
    offers: [
      { name: 'Video edits', line: 'Raw footage cut into clean, ready videos' },
      { name: 'Design work', line: 'Posters, posts and brand pieces to a brief' },
      { name: 'Monthly creative plan', line: 'Regular edits and designs, planned with the client' },
    ],
    keywords: ['video edit', 'editor', 'photographer', 'photo', 'graphic design', 'designer', 'voice artist', 'voice over', 'interior', 'architect', 'tailor', 'fashion', 'animation'],
  }),
  f({
    id: 'writing', label: 'Writing and content', line: 'Copywriter, journalist, translator, ghostwriter', serviceType: 'content',
    planIdea: 'Blog articles, newsletters and copywriting for small brands',
    offers: [
      { name: 'Blog articles', line: 'Researched posts written for search' },
      { name: 'Newsletter issues', line: 'A regular issue drafted for review' },
      { name: 'Translation', line: 'Documents translated and checked' },
    ],
    keywords: ['copywrit', 'journalist', 'writer', 'writing', 'blog', 'newsletter', 'translator', 'translation', 'ghostwrit', 'podcast', 'seo', 'content'],
  }),
  f({
    id: 'local-services', label: 'Local services', line: 'Salon, electrician, home chef, travel, events', serviceType: 'local-services',
    planIdea: 'Home visits, repairs and salon bookings for families nearby',
    offers: [
      { name: 'Booked visits', line: 'Slots, reminders and a quote before each visit' },
      { name: 'Packages', line: 'A set of visits or services sold together' },
      { name: 'Event planning', line: 'A plan, vendors and a checklist for the day' },
    ],
    keywords: ['salon', 'beautician', 'electrician', 'plumber', ' ac ', 'technician', 'home chef', 'tiffin', 'real estate', 'broker', 'travel agent', 'wedding', 'event planner', 'physiotherap'],
  }),
  f({
    id: 'documents', label: 'Documents and reports', line: 'Tenders, SOPs, loan reports, HR handbooks', serviceType: 'consulting',
    planIdea: 'Writing tender documents, handbooks and SOP copy for small firms',
    offers: [
      { name: 'Tender responses', line: 'Questions answered from the source papers' },
      { name: 'SOPs and handbooks', line: 'Clear written steps for a team' },
      { name: 'Project reports', line: 'Loan or project reports put together for review' },
    ],
    keywords: ['tender', 'gem bid', 'bid writ', 'sop', 'handbook', 'dpr', 'cma report', 'technical writ', 'technical', 'thesis', 'estimate'],
  }),
  f({
    id: 'research', label: 'Research and analysis', line: 'Market research, MIS, sales, procurement', serviceType: 'research',
    planIdea: 'Market research and data analysis reports for small companies',
    offers: [
      { name: 'Research reports', line: 'A question answered with sources' },
      { name: 'Monthly MIS', line: 'The numbers a business watches, put in one pack' },
      { name: 'Lead lists', line: 'Companies that fit, found from public sources' },
    ],
    keywords: ['market research', 'research', 'analyst', 'analysis', 'mis', 'data analys', 'procurement', 'sales executive', 'lead list'],
  }),
  f({
    id: 'people', label: 'People and careers', line: 'Recruiter, placement, resume help', serviceType: 'consulting',
    planIdea: 'Career coaching and resume advice for job seekers',
    offers: [
      { name: 'Resume rewrite', line: 'A clear resume aimed at one kind of role' },
      { name: 'Job search help', line: 'Roles found and applications prepared' },
      { name: 'Hiring support', line: 'Candidates found and screened for a role' },
    ],
    keywords: ['recruit', 'hiring', 'placement', 'resume', 'career', 'job seeker', 'hr executive', 'talent'],
  }),
  f({
    id: 'shop-office', label: 'Shop and back office', line: 'Online selling, support desk, assistant', serviceType: 'support',
    planIdea: 'Customer support and inbox help for online shops',
    offers: [
      { name: 'Support desk', line: 'Customer questions answered from your rules' },
      { name: 'Marketplace listings', line: 'Products listed and kept up to date' },
      { name: 'Assistant hours', line: 'Inbox, calendar and data entry help' },
    ],
    keywords: ['customer service', 'customer support', 'support desk', 'online shop', 'seller', 'marketplace', 'amazon', 'flipkart', 'data entry', 'executive assistant', 'virtual assistant', 'retail'],
  }),
  f({
    id: 'tech', label: 'Tech services', line: 'Websites, app testing, IT support', serviceType: 'studio',
    planIdea: 'Website design and app testing for small businesses',
    offers: [
      { name: 'Small websites', line: 'A site built, checked and handed over' },
      { name: 'App testing', line: 'Test runs with a clear report of what broke' },
      { name: 'IT help', line: 'Problems sorted and written up' },
    ],
    keywords: ['software', 'developer', 'website', 'web design', 'app test', 'qa tester', 'tester', 'it support', 'call centre', 'receptionist', 'programmer'],
  }),
  f({
    id: 'licensed', label: 'Licensed work', line: 'Advocate, doctor, financial planner', serviceType: 'licensed',
    planIdea: 'Client follow ups and review packs for a licensed professional to sign off',
    offers: [
      { name: 'Consultations', line: 'Booked sessions with notes for the client' },
      { name: 'Follow ups', line: 'Reminders and next steps after each session' },
      { name: 'Review packs', line: 'Papers put in order for you to sign off' },
    ],
    keywords: ['advocate', 'lawyer', 'legal', 'doctor', 'clinic', 'physician', 'financial planner', 'mutual fund', ' mfd ', 'sebi'],
  }),
]);

const BY_ID: ReadonlyMap<string, Family> = new Map(FAMILIES.map(family => [family.id, family]));

export function isFamilyId(value: unknown): value is FamilyId {
  return typeof value === 'string' && BY_ID.has(value);
}

export function familyOf(id: FamilyId): Family {
  const family = BY_ID.get(id);
  if (!family) throw new Error(`Unknown family ${id}`);
  return family;
}

/** The tiles as the screen shows them: id, label and line. */
export function familyTiles(): { id: FamilyId; label: string; line: string }[] {
  return FAMILIES.map(({ id, label, line }) => ({ id, label, line }));
}

/** The idea classifier the plan uses (core/service-types.ts classifyIdea); passed in so this file stays import-free. */
export type Classify = (idea: string) => string;

/**
 * The no-AI guess: the family whose words appear most in the text (padded so ' ca ' finds a lone "CA"), a tie to the
 * family listed first; with no family word, the family of the classifier's service type when exactly one family plans as
 * it; else null, and the owner picks a tile. family-plan.ts binds the engine's classifier.
 */
export function keywordFamilyWith(text: string, classify?: Classify): FamilyId | null {
  const padded = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
  let best: FamilyId | null = null;
  let bestHits = 0;
  for (const family of FAMILIES) {
    const hits = family.keywords.filter(word => padded.includes(word)).length;
    if (hits > bestHits) { best = family.id; bestHits = hits; }
  }
  if (best || !classify) return best;
  const type = classify(text);
  if (type === 'other') return null;
  const matching = FAMILIES.filter(family => family.serviceType === type);
  return matching.length === 1 ? matching[0]!.id : null;
}

/** venture.preview and venture.create take ideas of 10 to 2000 characters. */
const IDEA_MAX = 2000;

/**
 * The idea sentence the plan starts from for this family: the owner's words when they already plan as the family's
 * service type; else the family's plan sentence followed by the owner's words, when that plans as the family; else the
 * plan sentence alone. Owner words are never rewritten, only placed after the family's lead.
 */
export function familyIdeaWith(id: FamilyId, ownerWords: string, classify: Classify): string {
  const family = familyOf(id);
  const words = ownerWords.replace(/\s+/g, ' ').trim();
  if (words.length >= 10 && words.length <= IDEA_MAX && classify(words) === family.serviceType) return words;
  if (words.length > 0) {
    const joined = `${family.planIdea}. ${words}`.slice(0, IDEA_MAX).trim();
    if (classify(joined) === family.serviceType) return joined;
  }
  return family.planIdea;
}
