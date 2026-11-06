// Chausar venture launcher, network (Ink v2 wave 4, package 4D3): what a search of the owner's network never touches.
// People are never searched by religion, caste, health, age, gender, sexual orientation or family role: the owner's
// words, the traits their AI made and the words it chose are checked against one set of rules, in English, Hindi and
// Hindi in Latin letters, and a match refuses the search before any candidate is scored (NETWORK_TRAIT_PROTECTED). The
// same rules mask such words in the fields a search sends, keep a quote holding one from ever becoming a "Why" line, and
// drop such a line from "Before you write". Words are matched whole, and a word with a common other meaning counts only
// where it describes people: "Hindu founders" is refused, "journalists at The Hindu" and "Rahul Jain" are not; "women"
// is refused, "women's clothing" and "ladies tailors" (markets) are not; "age" only in an age phrase ("aged 40", "in
// their 30s", "over 50 who live in Pune"), so "Age of Empires" and "over 50 employees" pass. Personal profile sites
// (LinkedIn and the like) are never opened and never offered as a web result.

/** The refusal's words. */
export const PROTECTED_LINE = 'Chausar does not search people by religion, caste, health, age, gender, sexual orientation or family role. Ask about their work instead: their role, their company, what they sell or how you know them.';
/** What a masked word reads in the fields a search sends. */
export const MASK = '[left out]';

const B = '(?<![\\p{L}\\p{M}\\p{N}])';
const E = '(?![\\p{L}\\p{M}\\p{N}])';
const GAP = '[\\s-]+';
const word = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[.*+?^${}()|[\]\\/]/g, '\\$&').replace(/[\s-]+/g, GAP);
const any = (words: readonly string[]) => `(?:${words.map(word).join('|')})`;

/** Market words after which a protected word names what is sold, not who people are: women's clothing, elderly care. */
const MARKET = [
  'wear', 'clothing', 'clothes', 'apparel', 'fashion', 'tailor', 'tailors', 'salon', 'salons', 'boutique', 'boutiques', 'hostel', 'hostels', 'gym', 'gyms',
  'product', 'products', 'footwear', 'shoes', 'garments', 'kurtis', 'innerwear', 'hygiene', 'grooming', 'care', 'section', 'collection', 'clinic',
  'clinics', 'centre', 'centres', 'center', 'centers', 'services', 'insurance', 'kit', 'kits', 'test', 'tests', 'supplements', 'startup', 'startups',
  'app', 'apps', 'platform', 'platforms', 'brand', 'brands', 'home', 'homes', 'banking', 'finance', 'market', 'day', 'magazine', 'cricket',
];
const notMarket = `(?!['’]s${E}|${GAP}${any(MARKET)}${E})`;
/** People nouns: a descriptor before one (with at most one word between) describes people. */
const PEOPLE = [
  'people', 'persons', 'community', 'communities', 'samaj', 'families', 'family', 'founders', 'founder', 'owners', 'owner', 'traders', 'trader',
  'merchants', 'merchant', 'businessmen', 'businessman', 'businesswomen', 'businesspeople', 'entrepreneurs', 'entrepreneur', 'clients', 'customers',
  'friends', 'contacts', 'professionals', 'folks', 'men', 'women', 'doctors', 'lawyers', 'students', 'investors', 'buyers', 'shopkeepers', 'vendors',
  'sellers', 'leaders', 'members', 'religion', 'faith', 'लोग', 'लोगों', 'समाज', 'परिवार', 'समुदाय', 'व्यापारी', 'व्यापारियों', 'मालिक', 'धर्म',
];

/** Always protected, as whole words (unless a market word follows). */
const STRICT: readonly string[] = [
  // Religion and caste
  'religion', 'religions', 'religious', 'hindus', 'muslim', 'muslims', 'islam', 'christians', 'sikh', 'sikhs', 'buddhist', 'buddhists', 'parsis',
  'jewish', 'jews', 'jains', 'jainism', 'caste', 'castes', 'brahmin', 'brahmins', 'dalit', 'dalits', 'obc', 'kshatriya', 'kshatriyas', 'vaishya',
  'shudra', 'upper caste', 'lower caste', 'scheduled caste', 'scheduled tribe', 'jaati',
  'धर्म', 'धार्मिक', 'मुस्लिम', 'मुसलमान', 'सिख', 'बौद्ध', 'जाति', 'ब्राह्मण', 'दलित',
  // Health
  'disabled', 'disability', 'disabilities', 'handicapped', 'pregnant', 'pregnancy', 'illness', 'ill health', 'sick', 'diabetic', 'diabetics', 'hiv',
  'mental health', 'medical condition', 'medical conditions', 'health condition', 'health conditions', 'health problem', 'health problems',
  'बीमार', 'बीमारी', 'विकलांग', 'गर्भवती',
  // Age
  'years old', 'year old', 'year olds', 'elderly', 'senior citizen', 'senior citizens', 'teenager', 'teenagers', 'millennial', 'millennials', 'gen z',
  'boomer', 'boomers', 'उम्र', 'आयु', 'बुज़ुर्ग', 'बुजुर्ग',
  // Gender
  'woman', 'women', 'female', 'females', 'male', 'males', 'gender', 'girl', 'girls', 'lady', 'ladies', 'gentleman', 'gentlemen', 'transgender',
  'non-binary', 'nonbinary', 'mahila', 'aurat', 'ladki', 'ladka', 'महिला', 'महिलाएं', 'महिलाएँ', 'महिलाओं', 'औरत', 'औरतें', 'औरतों', 'पुरुष', 'पुरुषों',
  'लड़की', 'लड़कियां', 'लड़कियाँ', 'लड़कियों', 'लड़का', 'लड़के', 'लड़कों',
  // Sexual orientation
  'gay', 'lesbian', 'lesbians', 'bisexual', 'queer', 'lgbt', 'lgbtq', 'lgbtqia', 'homosexual', 'heterosexual', 'sexual orientation', 'समलैंगिक',
  // Family role and retirement
  'mothers', 'fathers', 'moms', 'mums', 'dads', 'housewife', 'housewives', 'homemaker', 'homemakers', 'retired', 'retiree', 'retirees', 'pensioner',
  'pensioners', 'गृहिणी', 'गृहिणियां', 'गृहिणियाँ', 'गृहिणियों', 'माताएं', 'माताओं', 'रिटायर', 'रिटायर्ड', 'सेवानिवृत्त',
];
/** Protected only where they describe people: "Jain founders", "who are Hindu"; never "The Hindu" or "Rahul Jain". */
const DESCRIPTORS: readonly string[] = ['hindu', 'christian', 'jain', 'parsi', 'islamic', 'हिंदू', 'हिन्दू', 'जैन', 'पारसी', 'ईसाई'];
const PARENTS = ['mother', 'father', 'mom', 'mum', 'dad', 'parent'];
/** Who an age or a family role describes when it comes right before them: "over 50 founders", "mom bloggers". */
const FOUNDERS = ['founders', 'founder', 'owners', 'owner', 'entrepreneurs', 'entrepreneur', 'people', 'persons', 'folks', 'professionals', 'leaders', 'investors', 'creators', 'influencers', 'bloggers', 'vloggers'];

const RULES: readonly string[] = [
  `${B}${any(STRICT)}${E}${notMarket}`,
  `${B}${any(DESCRIPTORS)}${E}(?:\\s+[\\p{L}\\p{M}]+)?\\s+${any(PEOPLE)}${E}`,
  `${B}(?:are|who\\s+are|who\\s+is|being|fellow)\\s+${any(DESCRIPTORS)}${E}`,
  // Age phrases
  `${B}(?:aged?|ages)\\s+\\d{1,2}${E}`,
  `${B}ages?\\s+(?:group|groups|bracket|range|limit|between|below|above|under|over)${E}`,
  `${B}(?:under|over|above|below)\\s+the\\s+age${E}`,
  `${B}(?:their|his|her|same)\\s+age${E}`,
  `${B}of\\s+(?:a\\s+certain|retirement|working)\\s+age${E}`,
  `${B}in\\s+(?:their|his|her)\\s+(?:early\\s+|mid\\s+|late\\s+)?(?:\\d0['’]?s|twenties|thirties|forties|fifties|sixties|seventies|eighties)${E}`,
  `${B}(?:under|over|above|below|older\\s+than|younger\\s+than)[\\s-]+\\d{2}${E}(?=[\\s-]*(?:${any(FOUNDERS)}${E}|$|[,.;:!?)]|(?:who|and|or|in|at|from|near|living|based|with)${E}|(?:years?|yrs?)(?:\\s+old)?\\s*(?:$|[,.;:!?)]|(?:who|and|or|in|at)${E})))`,
  `\\d{2}\\s*(?:साल|वर्ष)\\s*(?:के|की)${E}`,
  // Family roles in the singular, only as a role
  `${B}(?:single|working|stay${GAP}at${GAP}home|new|young|expecting|first${GAP}time)${GAP}${any(PARENTS)}s?${E}`,
  `${B}(?:mother|father|mom|mum)\\s+of${E}`,
  `${B}${any(PARENTS)}s?\\s+${any(FOUNDERS)}${E}`,
  `${B}(?:are|is|who\\s+are|who\\s+is|being)\\s+(?:a\\s+)?${any(PARENTS)}s?${E}`,
];
const TEST = new RegExp(RULES.join('|'), 'iu');
const SWEEP = RULES.map(rule => new RegExp(rule, 'giu'));
/** A word the AI chose to look for that is, alone, a protected descriptor. */
const TERMS: ReadonlySet<string> = new Set([...DESCRIPTORS, ...PARENTS, 'parents', 'age', 'ages'].map(item => item.normalize('NFKC').toLowerCase()));

/** True when words name a protected trait (religion, caste, health, age, gender, sexual orientation or family role), in English or Hindi. */
export function namesProtectedTrait(text: string): boolean {
  return TEST.test(text.normalize('NFKC'));
}

/** True when one word or short phrase the AI chose to look for is protected, alone or by the rules above. */
export function protectedTerm(term: string): boolean {
  const plain = term.normalize('NFKC').toLowerCase().trim();
  return TERMS.has(plain) || namesProtectedTrait(plain);
}

/** The text with every protected phrase in it replaced by "[left out]", for the fields a search sends. */
export function maskProtected(text: string): string {
  return SWEEP.reduce((out, rule) => out.replace(rule, MASK), text.normalize('NFKC'));
}

const EMAIL = /[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.\p{L}{2,}/gu;
const NUMBER_RUN = /\+?\d[\d\s().\-\u2013]{6,}\d/gu;

/** A run of digits that reads as a phone number: ten digits or more, or eight or more after a plus; a run of years ("2019 - 2023") is not one. */
function phoneRun(run: string): boolean {
  const groups = run.split(/\D+/).filter(Boolean);
  if (groups.every(group => /^(?:19|20)\d{2}$/.test(group))) return false;
  const digits = groups.join('').length;
  return digits >= 10 || (run.startsWith('+') && digits >= 8);
}

/** True when text holds an email address or a phone number. */
export function holdsContact(text: string): boolean {
  return new RegExp(EMAIL.source, 'u').test(text) || [...text.matchAll(NUMBER_RUN)].some(match => phoneRun(match[0]));
}

/** The text with email addresses as "[email]" and phone numbers as "[phone]". */
export function maskContacts(text: string): string {
  return text.replace(EMAIL, '[email]').replace(NUMBER_RUN, run => (phoneRun(run) ? '[phone]' : run));
}

/**
 * Sites whose pages are people's own profiles. Chausar never opens one (LinkedIn's terms forbid reading members' pages
 * by tool, and the rest are personal), and a web search never offers one as a result.
 */
export const PROFILE_HOSTS: readonly string[] = Object.freeze([
  'linkedin.com', 'lnkd.in', 'facebook.com', 'fb.com', 'fb.me', 'instagram.com', 'instagr.am', 'x.com', 'twitter.com', 't.co', 'threads.net',
  'tiktok.com', 'snapchat.com',
]);

/** True when a host name is a profile site or one of its sub-domains (in.linkedin.com, m.facebook.com). */
export function profileHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return PROFILE_HOSTS.some(site => host === site || host.endsWith(`.${site}`));
}
