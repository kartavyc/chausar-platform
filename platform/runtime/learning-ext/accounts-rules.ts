/**
 * The deterministic evidence proposer for chart-of-accounts sorting. Account names and parent
 * groups are outside text: they are only matched against fixed keyword tables, never followed.
 * Evidence details are built from the tables' own words, so an outside string never becomes one.
 */
import type { AccountClass, Confidence } from './vocabulary.ts';

export type Evidence = { kind: 'name-keyword' | 'parent-group' | 'model'; detail: string; accountClass: AccountClass };
export type Proposed = { accountClass: AccountClass | null; confidence: Confidence; needsQuestion: boolean; evidence: Evidence[] };
export type ModelProposal = { id: string; accountClass: AccountClass; confidence: Confidence; evidence: string };

/** Lower-case word tokens in any script; punctuation and spacing are separators. */
export const tokens = (text: string) => text.normalize('NFKC').toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);

/** Tally's reserved groups. `true` marks a specific group; a broad group is weaker evidence. */
const GROUP_LIST: [string, AccountClass, boolean][] = [
  ['Sales Accounts', 'sales', true], ['Purchase Accounts', 'purchases', true], ['Duties & Taxes', 'duties-taxes', true],
  ['Bank Accounts', 'bank', true], ['Bank OD A/c', 'bank', true], ['Bank OCC A/c', 'bank', true], ['Cash-in-Hand', 'cash', true],
  ['Sundry Debtors', 'sundry-debtors', true], ['Sundry Creditors', 'sundry-creditors', true], ['Loans (Liability)', 'loans', true],
  ['Secured Loans', 'loans', true], ['Unsecured Loans', 'loans', true], ['Capital Account', 'capital', true], ['Reserves & Surplus', 'capital', true],
  ['Fixed Assets', 'fixed-assets', true], ['Direct Expenses', 'direct-expenses', true], ['Indirect Expenses', 'indirect-expenses', true],
  ['Indirect Incomes', 'indirect-income', true], ['Stock-in-Hand', 'stock', true], ['Suspense A/c', 'suspense', true],
  ['Direct Incomes', 'sales', false], ['Investments', 'fixed-assets', false], ['Current Assets', 'current-assets', false],
  ['Current Liabilities', 'current-liabilities', false], ['Provisions', 'current-liabilities', false],
  ['Loans & Advances (Asset)', 'current-assets', false], ['Deposits (Asset)', 'current-assets', false],
];
const GROUPS = new Map(GROUP_LIST.map(([label, accountClass, specific]) => [tokens(label).join(' '), { label, accountClass, specific }]));

/** Name words in English, Hindi and Hinglish. A phrase (two words) weighs twice a single word. */
const WORDS: Record<AccountClass, string[]> = {
  'sales': ['sales', 'sale', 'bikri', 'bikree', 'vikray', 'revenue', 'turnover', 'बिक्री', 'export sales', 'local sales'],
  'purchases': ['purchase', 'purchases', 'kharid', 'khareed', 'kharidi', 'खरीद', 'local purchase'],
  'duties-taxes': ['gst', 'cgst', 'sgst', 'igst', 'utgst', 'cess', 'tds', 'tcs', 'vat', 'tax', 'kar', 'कर', 'input credit', 'output tax'],
  'bank': ['bank', 'overdraft', 'od', 'बैंक'],
  'cash': ['cash', 'nakad', 'nakdi', 'petty', 'नकद', 'rokad', 'galla'],
  'loans': ['loan', 'loans', 'karza', 'karz', 'karj', 'कर्ज', 'कर्ज़', 'emi', 'borrowing', 'borrowings'],
  'capital': ['capital', 'drawings', 'drawing', 'poonji', 'punji', 'पूंजी', 'reserve', 'reserves', 'surplus'],
  'fixed-assets': ['furniture', 'fixtures', 'machinery', 'machine', 'computer', 'computers', 'laptop', 'vehicle', 'vehicles', 'building', 'land', 'plant', 'equipment', 'printer'],
  'current-assets': ['deposit', 'deposits', 'advance', 'advances', 'prepaid', 'receivable', 'receivables', 'security deposit'],
  'current-liabilities': ['payable', 'payables', 'outstanding', 'provision', 'provisions'],
  'sundry-debtors': ['debtor', 'debtors', 'customer', 'customers', 'grahak'],
  'sundry-creditors': ['creditor', 'creditors', 'supplier', 'suppliers', 'vendor', 'vendors'],
  'direct-expenses': ['freight', 'bhada', 'bhaada', 'भाड़ा', 'cartage', 'carriage', 'wages', 'majdoori', 'mazdoori', 'labour', 'packing', 'loading', 'freight inward', 'carriage inward'],
  'indirect-expenses': ['rent', 'kiraya', 'किराया', 'salary', 'salaries', 'vetan', 'वेतन', 'electricity', 'bijli', 'telephone', 'mobile', 'internet', 'stationery', 'printing',
    'advertisement', 'advertising', 'repairs', 'insurance', 'depreciation', 'conveyance', 'travel', 'travelling', 'audit', 'office', 'kharcha', 'kharch', 'expenses',
    'bank charges', 'discount allowed', 'interest paid', 'courier', 'postage'],
  'indirect-income': ['income', 'aay', 'आय', 'discount received', 'interest received', 'commission received', 'rent received', 'interest income'],
  'stock': ['stock', 'inventory', 'maal', 'closing stock', 'opening stock'],
  'suspense': ['suspense'],
};
const WORD_TABLE = new Map<string, AccountClass>(), PHRASE_TABLE = new Map<string, AccountClass>();
for (const [accountClass, words] of Object.entries(WORDS) as [AccountClass, string[]][]) for (const raw of words) { const word = tokens(raw).join(' '); (word.includes(' ') ? PHRASE_TABLE : WORD_TABLE).set(word, accountClass); }

function keywordEvidence(text: string, kind: Evidence['kind'], label: string): { evidence: Evidence[]; scores: Map<AccountClass, number> } {
  const words = tokens(text), joined = ` ${words.join(' ')} `, evidence: Evidence[] = [], scores = new Map<AccountClass, number>();
  const add = (word: string, accountClass: AccountClass, weight: number) => {
    evidence.push({ kind, detail: `${label} "${word}"`, accountClass }); scores.set(accountClass, (scores.get(accountClass) ?? 0) + weight);
  };
  for (const [phrase, accountClass] of PHRASE_TABLE) if (joined.includes(` ${phrase} `)) add(phrase, accountClass, 2);
  for (const word of new Set(words)) { const accountClass = WORD_TABLE.get(word); if (accountClass) add(word, accountClass, 1); }
  return { evidence, scores };
}
/** The single best-scoring class, or null when nothing matched or two classes tie. */
function top(scores: Map<AccountClass, number>): AccountClass | null {
  const ranked = [...scores].sort((a, b) => b[1] - a[1]);
  return ranked.length && (ranked.length === 1 || ranked[0][1] > ranked[1][1]) ? ranked[0][0] : null;
}

export function propose(name: string, parentGroup: string | undefined, model?: ModelProposal): Proposed {
  const named = keywordEvidence(name, 'name-keyword', 'Name word'), nameTop = top(named.scores);
  const evidence: Evidence[] = [];
  let accountClass: AccountClass | null = null, confidence: Confidence = 'low';
  const group = parentGroup === undefined ? undefined : GROUPS.get(tokens(parentGroup).join(' '));
  if (group) {
    const { label, accountClass: groupClass, specific } = group;
    evidence.push({ kind: 'parent-group', detail: `Tally group ${label}`, accountClass: groupClass });
    accountClass = groupClass;
    // The parent group outweighs name words; a disagreeing name lowers confidence. A broad group needs a name that agrees.
    confidence = specific ? (named.scores.size === 0 || nameTop === groupClass ? 'high' : 'medium') : (nameTop === groupClass ? 'medium' : 'low');
  } else {
    const grouped = parentGroup === undefined ? undefined : keywordEvidence(parentGroup, 'parent-group', 'Group word');
    const groupTop = grouped ? top(grouped.scores) : null;
    evidence.push(...(grouped?.evidence ?? []));
    if (groupTop) { accountClass = groupTop; confidence = named.scores.size === 0 || nameTop === groupTop ? 'medium' : 'low'; }
    else if (nameTop && named.scores.size === 1 && !grouped?.scores.size) { accountClass = nameTop; confidence = 'medium'; }
    else accountClass = nameTop ?? groupTop;
  }
  evidence.push(...named.evidence);
  if (model) {
    evidence.push({ kind: 'model', detail: model.evidence, accountClass: model.accountClass });
    // A model alone, or a model that disagrees with the rules, always asks a person.
    if (accountClass !== model.accountClass) confidence = 'low';
    if (accountClass === null) accountClass = model.accountClass;
  }
  if (accountClass === null || evidence.length === 0) confidence = 'low';
  return { accountClass, confidence, needsQuestion: confidence === 'low', evidence };
}

/** Word tokens of outside text for the local label dataset: no digits, identifiers or one-letter words. */
export function datasetWords(text: string, identifierPatterns: RegExp[]): string[] {
  const words: string[] = [];
  for (const raw of text.normalize('NFKC').split(/\s+/).filter(Boolean)) {
    if (/\d/.test(raw) || raw.includes('@') || identifierPatterns.some(pattern => pattern.test(raw))) continue;
    for (const word of raw.toLowerCase().split(/[^\p{L}\p{M}]+/u)) if ([...word.replace(/\p{M}/gu, '')].length >= 2) words.push(word);
  }
  return words;
}
