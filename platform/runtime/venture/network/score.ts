// Chausar venture launcher, network (Ink v2 wave 4, package 4E1): the lead score (catalogue C12). The owner writes rules
// (field, operator, value, points) over a fixed list of fields; votes on one factor each carry the page that backs them
// or the word "guess". Code adds the points and buckets the card hot, warm or cold; the rules that matched are the
// reasons shown, so a score always says why. A rule that would judge a protected trait (religion, caste, health, age,
// gender, sexual orientation, pregnancy, disability, race, marriage) is refused, in English or Hindi, whatever field it names: Chausar
// never scores people on who they are. The same check serves any feature that reads traits (4D3's search may reuse it).
import { ChausarError, check } from '../../contracts.ts';
import { TIE_BANDS } from '../contracts.ts';
import type { CardVote, PipelineStage, ScoreRule, TieBand } from '../contracts.ts';
import { fold } from './text.ts';

/** The fields a rule may read, and how each is compared. */
export const SCORE_FIELDS = ['title', 'company', 'email-domain', 'band', 'trigger', 'stage', 'meetings', 'client'] as const;
export type ScoreField = typeof SCORE_FIELDS[number];
/** What one card offers the rules: its person's title and company, their email's domain, the tie band, and so on. */
export type ScoreFacts = {
  title: string | null; company: string | null; 'email-domain': string | null; band: TieBand | null; trigger: string; stage: PipelineStage;
  meetings: number; client: boolean;
};
/** One vote on one factor, by an agent's research or the owner: the page that backs it, or the word "guess". */
export type ScoreVote = CardVote;
export type Score = { bucket: 'hot' | 'warm' | 'cold'; points: number; reasons: string[] };

const OPERATORS: Readonly<Record<ScoreField, readonly ScoreRule['operator'][]>> = Object.freeze({
  title: ['is', 'contains'], company: ['is', 'contains'], 'email-domain': ['is', 'contains'], trigger: ['is', 'contains'], stage: ['is', 'contains'],
  band: ['is', 'at-least', 'at-most'], meetings: ['is', 'at-least', 'at-most'], client: ['is'],
});
const FIELD_WORDS: Readonly<Record<ScoreField, string>> = Object.freeze({
  title: 'Title', company: 'Company', 'email-domain': 'Email domain', band: 'Relationship', trigger: 'Source', stage: 'Stage', meetings: 'Meetings', client: 'Client',
});
const BAND_WORDS: Readonly<Record<TieBand, string>> = Object.freeze({ close: 'Close', 'know-well': 'Know well', know: 'Know', 'met-once': 'Met once', cold: 'Cold' });
/** Weakest first, so a higher index is a closer tie. */
const BAND_RANK: readonly TieBand[] = [...TIE_BANDS].reverse();
/** The most rules the owner keeps, and the points one rule or vote may add or take away. */
export const MAX_SCORE_RULES = 30;
export const MAX_POINTS = 100;
/** Points at or above which a card is hot, and warm. */
export const HOT_FROM = 50;
export const WARM_FROM = 20;

/**
 * Protected traits as whole words, singular (plurals are read back to them), in English and romanised Hindi: religion
 * and religions by name, caste and caste names, gender and the words for women and men, sexual orientation, age,
 * health, disability and pregnancy, marriage, race and tribe.
 */
const PROTECTED_WORDS = new Set([
  // religion
  'religion', 'religious', 'faith', 'belief', 'god', 'hindu', 'hindutva', 'hinduism', 'muslim', 'moslem', 'islam', 'islamic', 'islamist', 'christian', 'christianity',
  'catholic', 'protestant', 'sikh', 'sikhism', 'jain', 'jainism', 'buddhist', 'buddhism', 'parsi', 'zoroastrian', 'jew', 'jewish', 'judaism', 'atheist', 'agnostic',
  'dharm', 'dharma', 'dharmik', 'mazhab', 'musalman', 'musalmaan', 'isai',
  // caste
  'caste', 'dalit', 'brahmin', 'brahman', 'kshatriya', 'vaishya', 'shudra', 'obc', 'jati', 'jaati', 'gotra', 'varna', 'savarna', 'avarna', 'untouchable',
  // gender
  'gender', 'sex', 'woman', 'women', 'female', 'male', 'man', 'men', 'mr', 'mrs', 'ms', 'miss', 'madam', 'lady', 'ladies', 'girl', 'boy', 'gentleman',
  'gentlemen', 'wife', 'husband', 'trans', 'transgender', 'nonbinary', 'hijra', 'kinnar', 'mahila', 'purush', 'aurat', 'stri', 'ladki', 'ladka',
  // sexual orientation
  'sexuality', 'sexual', 'orientation', 'gay', 'lesbian', 'bisexual', 'queer', 'lgbt', 'lgbtq', 'lgbtqia', 'homosexual', 'heterosexual',
  // age
  'age', 'aged', 'ageing', 'aging', 'birthday', 'birthdate', 'dob', 'born', 'young', 'elderly', 'teen', 'teenager', 'millennial', 'boomer', 'genz',
  'umar', 'umr', 'aayu', 'buzurg',
  // health, disability, pregnancy
  'health', 'illness', 'ill', 'disease', 'medical', 'diagnosis', 'disabled', 'disability', 'handicap', 'handicapped', 'divyang', 'pregnant', 'pregnancy',
  'maternity', 'cancer', 'diabetes', 'diabetic', 'hiv', 'mental', 'bimar', 'bimari', 'viklang', 'garbhvati',
  // marriage
  'married', 'unmarried', 'marital', 'marriage', 'spouse', 'widow', 'widowed', 'widower', 'divorce', 'divorced', 'divorcee', 'shaadi', 'shadi', 'vivah',
  'vivahit', 'talaq', 'talak', 'vidhwa',
  // race and tribe
  'race', 'racial', 'ethnicity', 'ethnic', 'tribe', 'tribal', 'adivasi',
]);
/** Word starts that name a protected trait whatever ending follows. */
const PROTECTED_STEMS = [
  'religio', 'pregnan', 'disab', 'sexual', 'homosex', 'heterosex', 'transgend', 'ethnic', 'christia', 'muslim', 'hinduis', 'buddhis', 'divorc', 'widow',
  'lesbia', 'bisexu', 'dalit', 'brahmin', 'teenag', 'millenni', 'marital',
];
/** Hindi words, as word starts (inflected forms follow), and a few short ones that must be whole words. */
const HINDI_STEMS = [
  'धर्म', 'मज़हब', 'मजहब', 'जाति', 'उम्र', 'स्वास्थ्य', 'बीमार', 'गर्भ', 'विकलांग', 'दिव्यांग', 'दलित', 'ब्राह्मण', 'हिंदू', 'हिन्दू', 'मुस्लिम', 'मुसलमान', 'इस्लाम',
  'ईसाई', 'बौद्ध', 'महिला', 'पुरुष', 'औरत', 'स्त्री', 'लड़की', 'लड़का', 'शादी', 'विवाह', 'तलाक', 'विधवा', 'किन्नर', 'आदिवासी',
].map(word => word.normalize('NFKC'));
const HINDI_WORDS = new Set(['सिख', 'सिखों', 'जैन', 'जात', 'आयु', 'लिंग'].map(word => word.normalize('NFKC')));

/** Text as the check reads it: compatibility forms folded (NFKC) and invisible format characters (zero-width ones, soft hyphens) removed. */
const readable = (text: string) => text.normalize('NFKC').replace(/\p{Cf}/gu, '');
/** A word and the forms it may be the plural of. */
const singulars = (word: string) => [word, ...(word.endsWith('es') ? [word.slice(0, -2)] : []), ...(word.endsWith('s') ? [word.slice(0, -1)] : [])];

/** Whether words name a protected trait, in English, Hindi or romanised Hindi, plural or not, with hidden characters inside or not. */
export function namesProtectedTrait(text: string): boolean {
  const plain = readable(text);
  const hindi = plain.split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);
  if (hindi.some(word => HINDI_WORDS.has(word) || HINDI_STEMS.some(stem => word.startsWith(stem)))) return true;
  return fold(plain).split(' ').filter(Boolean)
    .some(word => singulars(word).some(form => PROTECTED_WORDS.has(form)) || PROTECTED_STEMS.some(stem => word.startsWith(stem)));
}

const refuseProtected = () => {
  throw new ChausarError('NETWORK_TRAIT_PROTECTED', 'Chausar never scores people on religion, caste, health, age, gender, sexual orientation, pregnancy, disability, race or marriage.');
};

/**
 * The owner's rules, checked: at most 30; each field from the fixed list with an operator that fits it; a value of one
 * line (a band word for band, a whole number for meetings, yes or no for client); points a whole number from -100 to
 * 100. A protected trait in the field or the value is refused (NETWORK_TRAIT_PROTECTED) before anything else.
 */
export function checkScoreRules(value: unknown): ScoreRule[] {
  check(Array.isArray(value) && value.length <= MAX_SCORE_RULES, 'INVALID_VENTURE_REQUEST', `Send the score rules as a list of at most ${MAX_SCORE_RULES}.`);
  return value.map(raw => {
    check(raw !== null && typeof raw === 'object' && !Array.isArray(raw), 'INVALID_VENTURE_REQUEST', 'Each score rule has a field, an operator, a value and points.');
    const { field, operator, value: ruleValue, points, ...rest } = raw as Record<string, unknown>;
    check(Object.keys(rest).length === 0, 'INVALID_VENTURE_REQUEST', 'Each score rule has a field, an operator, a value and points.');
    if ((typeof field === 'string' && namesProtectedTrait(field)) || (typeof ruleValue === 'string' && namesProtectedTrait(ruleValue))) refuseProtected();
    check(typeof field === 'string' && (SCORE_FIELDS as readonly string[]).includes(field), 'INVALID_VENTURE_REQUEST',
      'A score rule reads one of: title, company, email domain, relationship, source, stage, meetings or client.');
    const known = field as ScoreField;
    check(typeof operator === 'string' && (OPERATORS[known] as readonly string[]).includes(operator), 'INVALID_VENTURE_REQUEST', `${FIELD_WORDS[known]} can be compared with: ${OPERATORS[known].join(', ')}.`);
    check(typeof ruleValue === 'string' && ruleValue.trim().length >= 1 && ruleValue.trim().length <= 80 && !/[\u0000-\u001F\u007F]/.test(ruleValue),
      'INVALID_VENTURE_REQUEST', 'A score rule\'s value is one line of up to 80 characters.');
    let text = ruleValue.trim();
    if (known === 'band') {
      const band = TIE_BANDS.find(item => item === text.toLowerCase() || fold(BAND_WORDS[item]) === fold(text));
      check(band, 'INVALID_VENTURE_REQUEST', 'A relationship is one of: close, know-well, know, met-once or cold.');
      text = band;
    }
    if (known === 'meetings') check(/^\d{1,5}$/.test(text), 'INVALID_VENTURE_REQUEST', 'Meetings is compared with a whole number.');
    if (known === 'client') {
      check(text.toLowerCase() === 'yes' || text.toLowerCase() === 'no', 'INVALID_VENTURE_REQUEST', 'Client is yes or no.');
      text = text.toLowerCase();
    }
    check(Number.isInteger(points) && Math.abs(points as number) <= MAX_POINTS, 'INVALID_VENTURE_REQUEST', `Points are a whole number from -${MAX_POINTS} to ${MAX_POINTS}.`);
    return { field: known, operator: operator as ScoreRule['operator'], value: text, points: points as number };
  });
}

function matches(facts: ScoreFacts, rule: ScoreRule): boolean {
  const field = rule.field as ScoreField;
  if (field === 'band') {
    if (!facts.band) return false;
    const have = BAND_RANK.indexOf(facts.band), want = BAND_RANK.indexOf(rule.value as TieBand);
    return rule.operator === 'is' ? have === want : rule.operator === 'at-least' ? have >= want : have <= want;
  }
  if (field === 'meetings') {
    const want = Number(rule.value);
    return rule.operator === 'is' ? facts.meetings === want : rule.operator === 'at-least' ? facts.meetings >= want : facts.meetings <= want;
  }
  if (field === 'client') return facts.client === (rule.value === 'yes');
  const have = fold(facts[field]), want = fold(rule.value);
  if (!have) return false;
  return rule.operator === 'is' ? have === want : have.includes(want);
}

const signed = (points: number) => (points > 0 ? `+${points}` : String(points));

function ruleWords(rule: ScoreRule): string {
  const field = rule.field as ScoreField;
  if (field === 'band') {
    const band = BAND_WORDS[rule.value as TieBand];
    return rule.operator === 'is' ? `Relationship is ${band}` : `Relationship is ${rule.operator === 'at-least' ? 'at least' : 'at most'} ${band}`;
  }
  if (field === 'meetings') return `Meetings ${rule.operator === 'is' ? 'exactly' : rule.operator === 'at-least' ? 'at least' : 'at most'} ${rule.value}`;
  if (field === 'client') return rule.value === 'yes' ? 'Already a client' : 'Not a client yet';
  return `${FIELD_WORDS[field]} ${rule.operator === 'is' ? 'is' : 'contains'} "${rule.value}"`;
}

const VOTE_PAGE = /^https?:\/\/[^\s/]+\.[^\s]+$/i;

/**
 * Scores one card: each rule that matches adds its points, each vote adds its own (a vote names the page that backs it,
 * or says it is a guess; anything else is refused). Hot from 50, warm from 20, cold below. Null when there are no rules
 * and no votes, so a card never shows a score nobody asked for.
 */
/** The most votes one card keeps. */
export const MAX_VOTES = 10;

/** One vote, checked: a protected trait in its factor is refused first; then its factor, points and page or "guess". */
function checkVote(raw: unknown): ScoreVote {
  check(raw !== null && typeof raw === 'object' && !Array.isArray(raw), 'INVALID_VENTURE_REQUEST', 'A vote has a factor, points and evidence.');
  const { factor, points, evidence, ...rest } = raw as Record<string, unknown>;
  if (typeof factor === 'string' && namesProtectedTrait(factor)) refuseProtected();
  check(Object.keys(rest).length === 0 && typeof factor === 'string' && factor.trim().length >= 1 && factor.trim().length <= 80 && !/[\u0000-\u001F\u007F]/.test(factor)
    && Number.isInteger(points) && Math.abs(points as number) <= MAX_POINTS, 'INVALID_VENTURE_REQUEST', 'A vote names its factor and its points.');
  check(typeof evidence === 'string' && (evidence === 'guess' || (evidence.length <= 500 && VOTE_PAGE.test(evidence))), 'INVALID_VENTURE_REQUEST',
    'A vote needs the page that backs it, or the word guess.');
  return { factor: (factor as string).trim(), points: points as number, evidence: evidence as string };
}

/** A card's votes, checked: at most 10, each as checkVote reads it. */
export function checkVotes(value: unknown): ScoreVote[] {
  check(Array.isArray(value) && value.length <= MAX_VOTES, 'INVALID_VENTURE_REQUEST', `Send the votes as a list of at most ${MAX_VOTES}.`);
  return value.map(checkVote);
}

export function scoreCard(facts: ScoreFacts, rules: readonly ScoreRule[], votes: readonly ScoreVote[]): Score | null {
  if (!rules.length && !votes.length) return null;
  let points = 0;
  const reasons: string[] = [];
  for (const rule of rules) {
    if (!matches(facts, rule)) continue;
    points += rule.points;
    reasons.push(`${ruleWords(rule)}: ${signed(rule.points)}`);
  }
  for (const raw of votes) {
    const vote = checkVote(raw);
    points += vote.points;
    reasons.push(`${vote.factor}: ${signed(vote.points)} (${vote.evidence === 'guess' ? 'a guess' : vote.evidence})`);
  }
  return { bucket: points >= HOT_FROM ? 'hot' : points >= WARM_FROM ? 'warm' : 'cold', points, reasons };
}
