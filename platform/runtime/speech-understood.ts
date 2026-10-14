/**
 * "What it understood": a deterministic reading of a spoken question before anything runs.
 *
 * No model and no AI arithmetic: a fixed lexicon and an Indian number grammar. It finds the two
 * Hindi traps a person must see before confirming:
 *  - negations ("nahi", "mat", "नहीं", "don't" …) flip the meaning;
 *  - Indian number words ("do lakh" → 2,00,000, "dhai hazaar" → 2,500, "paune do lakh" → 1,75,000).
 * Values are exact: hundredths in BigInt, shown in Indian grouping and as an exact integer string.
 * When a word could be a number or something else ("do" = two, or "do"/"give"), it is flagged, not guessed.
 * Unclear parts stay as words, never zero. Every reading requires a person's confirmation.
 */
import { check, hash } from './contracts.ts';

type Entry =
  | { kind: 'number'; h: bigint; tens?: boolean; ambiguous?: string }
  | { kind: 'mult'; m: bigint } | { kind: 'mod'; d: bigint }
  | { kind: 'currency' } | { kind: 'paise' } | { kind: 'negation' } | { kind: 'exclusion' } | { kind: 'and' };

/** Matching key: NFC, lower case, nukta dropped, chandrabindu read as anusvara, curly apostrophe straightened. */
const key = (word: string) => word.normalize('NFC').toLowerCase().replace(/़/g, '').replace(/ँ/g, 'ं').replace(/’/g, "'");

// n | romanised spellings | Devanagari spellings
const HINDI_NUMBERS = `0|shunya,shoonya,sunya|शून्य
1|ek|एक
2|do|दो
3|teen,tin|तीन
4|chaar,char|चार
5|paanch,panch,paanc|पांच,पाँच
6|chhah,chhe,chhah,che,chheh|छह,छः,छे
7|saat,sat|सात
8|aath,ath|आठ
9|nau|नौ
10|das,dus|दस
11|gyarah,gyara,gyaarah|ग्यारह
12|barah,bara,baarah|बारह
13|terah,tera|तेरह
14|chaudah,chauda|चौदह
15|pandrah,pandra,pundrah|पंद्रह,पन्द्रह
16|solah,sola|सोलह
17|satrah,satra|सत्रह
18|atharah,athara,attharah|अठारह
19|unnees,unnis|उन्नीस
20|bees,bis|बीस
21|ikkees,ikkis|इक्कीस
22|baees,bais,baais|बाईस
23|teis,teees,teyis|तेईस
24|chaubees,chaubis|चौबीस
25|pachchees,pachees,pachis,pachchis|पच्चीस
26|chhabbees,chhabbis|छब्बीस
27|sattaees,sattais|सत्ताईस
28|atthaees,athais,atthais|अट्ठाईस
29|untees,untis|उनतीस
30|tees,tis|तीस
31|ikattees,iktis,ikatis|इकतीस
32|battees,battis|बत्तीस
33|taintees,taintis,tetis|तैंतीस
34|chautees,chautis,chaunthis|चौंतीस
35|paintees,paintis|पैंतीस
36|chhattees,chhattis|छत्तीस
37|saintees,saintis|सैंतीस
38|artees,adtis,artis|अड़तीस
39|untaalees,untalis|उनतालीस
40|chaalees,chalis,chaalis|चालीस
41|iktaalees,iktalis|इकतालीस
42|bayaalees,bayalis|बयालीस
43|taintaalees,taintalis|तैंतालीस
44|chavaalees,chavalis,chauvalis|चवालीस,चौवालीस
45|paintaalees,paintalis|पैंतालीस
46|chhiyaalees,chhiyalis|छियालीस
47|saintaalees,saintalis|सैंतालीस
48|artaalees,artalis,adtalis|अड़तालीस
49|unchaas,unchas|उनचास
50|pachaas,pachas|पचास
51|ikyaavan,ikyavan|इक्यावन
52|baavan,bavan|बावन
53|tirpan,tirepan|तिरपन
54|chauvan,chauvan|चौवन
55|pachpan|पचपन
56|chhappan|छप्पन
57|sattaavan,sattavan|सत्तावन
58|atthaavan,atthavan|अट्ठावन
59|unsath,unsaath|उनसठ
60|saath,sath|साठ
61|iksath,iksaath|इकसठ
62|baasath,basath|बासठ
63|tirsath,tirsaath|तिरसठ
64|chaunsath,chausath|चौंसठ
65|painsath,painsaath|पैंसठ
66|chhiyasath,chhiyasaath|छियासठ
67|sadsath,sarsath|सड़सठ
68|adsath,arsath|अड़सठ
69|unhattar|उनहत्तर
70|sattar|सत्तर
71|ikhattar|इकहत्तर
72|bahattar|बहत्तर
73|tihattar|तिहत्तर
74|chauhattar|चौहत्तर
75|pachhattar,pachattar|पचहत्तर
76|chhihattar|छिहत्तर
77|satattar,sathattar|सतहत्तर
78|athattar|अठहत्तर
79|unaasi,unasi|उन्यासी,उनासी
80|assi|अस्सी
81|ikyaasi,ikyasi|इक्यासी
82|bayaasi,bayasi|बयासी
83|tiraasi,tirasi|तिरासी
84|chauraasi,chaurasi|चौरासी
85|pachaasi,pachasi|पचासी
86|chhiyaasi,chhiyasi|छियासी
87|sattaasi,sattasi|सत्तासी
88|athaasi,athasi,atthasi|अट्ठासी
89|navaasi,navasi|नवासी
90|nabbe,nabbe|नब्बे
91|ikyaanave,ikyanve|इक्यानवे
92|baanave,banve|बानवे
93|tiraanave,tiranve|तिरानवे
94|chauraanave,chauranve|चौरानवे
95|pachaanave,pachanve|पचानवे
96|chhiyaanave,chhiyanve|छियानवे
97|sattaanave,sattanve|सत्तानवे
98|atthaanave,atthanve|अट्ठानवे
99|ninyaanave,ninyanve|निन्यानवे`;
const ENGLISH_NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const ENGLISH_TENS = ['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
/** Romanised words that are also ordinary English or Hindi words; converted only inside a clear number phrase. */
const AMBIGUOUS: Record<string, string> = { do: 'DO_TWO_OR_VERB', saath: 'SAATH_SIXTY_OR_WITH', sath: 'SAATH_SIXTY_OR_WITH', sat: 'NUMBER_WORD_OR_ENGLISH', bees: 'NUMBER_WORD_OR_ENGLISH', tees: 'NUMBER_WORD_OR_ENGLISH', char: 'NUMBER_WORD_OR_ENGLISH', teen: 'NUMBER_WORD_OR_ENGLISH', tin: 'NUMBER_WORD_OR_ENGLISH', bis: 'NUMBER_WORD_OR_ENGLISH', ath: 'NUMBER_WORD_OR_ENGLISH', tis: 'NUMBER_WORD_OR_ENGLISH', das: 'NUMBER_WORD_OR_ENGLISH', ek: 'NUMBER_WORD_OR_ARTICLE' };
const AMBIGUITY_NOTES: Record<string, string> = {
  DO_TWO_OR_VERB: '"do" can mean two, or "do"/"give". Not read as a number.',
  SAATH_SIXTY_OR_WITH: '"saath" can mean sixty or "with". Not read as a number.',
  NUMBER_WORD_OR_ENGLISH: 'This word can be a Hindi number or an ordinary word. Not read as a number.',
  NUMBER_WORD_OR_ARTICLE: '"ek" can mean one, or just "a". Not read as a number.',
  NA_TAG_OR_NEGATION: '"na" can say no, or just ask softly ("karo na" means "please do"). Check which you meant.',
  NO_NUMBER_ABBREVIATION: '"no" before a number usually means "number", not a refusal.',
  FRACTION_WITHOUT_UNIT: 'This is not a whole number. Check the amount.',
  MULTIPLIER_WITHOUT_COUNT: 'How many lakh, crore or thousand was not heard. Not read as a number.',
  TOO_PRECISE:'This number has more than two decimal places and was not read.',
};

const LEXICON = new Map<string, Entry>();
/** Romanised words that only Hindi uses; their presence marks a Latin-script transcript as Hinglish. */
const HINDI_ROMAN = new Set(['dedh', 'derh', 'dhai', 'dhaai', 'adhai', 'aadha', 'adha', 'sau', 'hazaar', 'hazar', 'hajaar', 'hajar', 'karod', 'karor', 'sava', 'sawa', 'saadhe', 'sadhe', 'paune', 'rupaye', 'rupaiye', 'rupaya', 'rupiya', 'paise', 'paisa',
  'nahi', 'nahin', 'nahee', 'nhi', 'mat', 'bina', 'sivay', 'sivaay', 'chhodkar', 'hai', 'hain', 'ka', 'ki', 'ke', 'kitna', 'kitne', 'kitni', 'mujhe', 'dikhao', 'batao', 'karo', 'kya', 'aur', 'se', 'mein', 'wala', 'wale', 'kaun', 'kab', 'kahan', 'kyun', 'bhejo', 'chahiye', 'tha', 'thi', 'abhi', 'pichhle', 'mahine', 'saal', 'hafte']);
const put = (words: string[], entry: Entry) => { for (const word of words) LEXICON.set(key(word), entry); };
for (const line of HINDI_NUMBERS.split('\n')) {
  const [n, roman, deva] = line.split('|'); const h = BigInt(n) * 100n;
  for (const word of roman.split(',')) { LEXICON.set(key(word), { kind: 'number', h, ...(AMBIGUOUS[word] ? { ambiguous: AMBIGUOUS[word] } : {}) }); if (!AMBIGUOUS[word]) HINDI_ROMAN.add(word); }
  put(deva.split(','), { kind: 'number', h });
}
ENGLISH_NUMBERS.forEach((word, n) => { if (!LEXICON.has(word)) LEXICON.set(word, { kind: 'number', h: BigInt(n) * 100n }); });
ENGLISH_TENS.forEach((word, n) => LEXICON.set(word, { kind: 'number', h: BigInt(n + 2) * 1000n, tens: true }));
put(['dedh', 'derh', 'dedha', 'डेढ़', 'डेढ'], { kind: 'number', h: 150n });
put(['dhai', 'dhaai', 'adhai', 'adhaai', 'ढाई', 'अढ़ाई'], { kind: 'number', h: 250n });
put(['aadha', 'adha', 'aadhe', 'आधा', 'आधे'], { kind: 'number', h: 50n });
put(['sau', 'सौ', 'hundred', 'hundreds'], { kind: 'mult', m: 100n });
put(['hazaar', 'hazar', 'hajaar', 'hajar', 'hazaar', 'हज़ार', 'हजार', 'thousand', 'thousands'], { kind: 'mult', m: 1000n });
put(['lakh', 'lakhs', 'lac', 'lacs', 'laakh', 'लाख'], { kind: 'mult', m: 100000n });
put(['million', 'millions'], { kind: 'mult', m: 1000000n });
put(['crore', 'crores', 'karod', 'karor', 'karoD', 'करोड़', 'करोड'], { kind: 'mult', m: 10000000n });
put(['arab', 'अरब', 'billion', 'billions'], { kind: 'mult', m: 1000000000n });
put(['sava', 'savaa', 'sawa', 'सवा'], { kind: 'mod', d: 25n });
put(['saadhe', 'sadhe', 'saade', 'sade', 'साढ़े', 'साढे'], { kind: 'mod', d: 50n });
put(['paune', 'paun', 'पौने'], { kind: 'mod', d: -25n });
put(['rupaye', 'rupaiye', 'rupay', 'rupaya', 'rupiya', 'rupya', 'rupee', 'rupees', 'rs', 'inr', '₹', 'रुपये', 'रुपए', 'रुपया', 'रूपये', 'रूपए'], { kind: 'currency' });
put(['paise', 'paisa', 'paisay', 'पैसे', 'पैसा'], { kind: 'paise' });
put(['nahi', 'nahin', 'nahee', 'nahiin', 'nhi', 'nahi̇', 'mat', 'na', 'naa', 'नहीं', 'नही', 'नहिं', 'मत', 'ना', 'न', 'not', 'no', 'never', 'none', 'nothing', 'nobody', 'neither', 'nor', 'cannot', 'dont', 'doesnt', 'didnt', 'isnt', 'arent', 'wasnt', 'werent', 'wont', 'cant', 'shouldnt', 'wouldnt', 'couldnt', 'havent', 'hasnt', 'hadnt', 'mustnt', 'kabhi-nahi'], { kind: 'negation' });
put(['without', 'except', 'excluding', 'bina', 'binaa', 'sivay', 'sivaay', 'siwa', 'chhodkar', 'chodkar', 'बिना', 'सिवाय', 'सिवा', 'छोड़कर', 'छोडकर'], { kind: 'exclusion' });
put(['and'], { kind: 'and' });
const TAG_NA = new Set([key('na'), key('naa'), key('ना')]);

export type Span = { text: string; start: number; end: number };
export type UnderstoodNumber = Span & { value: string; integer: string | null; indian: string; unit: 'rupees' | 'paise' | null; paise: string | null; display: string };
export type UnderstoodMark = Span & { kind: 'negation' | 'exclusion'; note: string; ambiguous: boolean };
export type Ambiguity = Span & { code: string; note: string };
export type Unclear = Span & { state: 'unknown' | 'absent'; note: string };
export type Segment = { kind: 'text' | 'number' | 'negation' | 'exclusion' | 'ambiguous' | 'unclear'; text: string };
export type Understood = {
  version: 1; normalised: string; understood: string; language: 'hi-Deva' | 'hi-Latn' | 'en' | 'mixed' | 'unknown';
  segments: Segment[]; negations: UnderstoodMark[]; numbers: UnderstoodNumber[]; ambiguities: Ambiguity[]; unclear: Unclear[];
  flipsMeaning: boolean; requiresConfirmation: true; digest: string;
};

/** Indian digit grouping of a non-negative integer string: 200000 → 2,00,000. */
export function indianGrouping(integer: string): string {
  check(/^\d+$/.test(integer), 'INVALID_NUMBER', 'Group whole numbers only.');
  const digits = integer.replace(/^0+(?=\d)/, ''); if (digits.length <= 3) return digits;
  const head = digits.slice(0, -3); const tail = digits.slice(-3);
  return `${head.replace(/\B(?=(\d{2})+$)/g, ',')},${tail}`;
}
function decimal(h: bigint): { value: string; integer: string | null; indian: string } {
  const whole = h / 100n; const fraction = h % 100n;
  if (fraction === 0n) return { value: String(whole), integer: String(whole), indian: indianGrouping(String(whole)) };
  const cents = String(fraction).padStart(2, '0').replace(/0$/, '');
  return { value: `${whole}.${cents}`, integer: null, indian: `${indianGrouping(String(whole))}.${cents}` };
}

type Token = Span & { key: string; entry?: Entry; digits?: bigint | 'too-precise' };
const TOKEN = /₹|[\p{L}\p{M}]+(?:'[\p{L}]+)?|\d[\d,]*(?:\.\d+)?/gu;
const UNCLEAR = /\[(?:inaudible|unclear|unk|noise|crosstalk|music)[^\]]{0,40}\]|\((?:inaudible|unclear)\)|<unk>|\?{2,}|…|\.{3,}/giu;

function tokens(text: string): Token[] {
  const out: Token[] = [];
  for (const match of text.matchAll(TOKEN)) {
    const word = match[0]; const start = match.index!; const token: Token = { text: word, start, end: start + word.length, key: key(word) };
    if (/^\d/.test(word)) { const plain = word.replace(/,/g, ''); const [whole, fraction = ''] = plain.split('.'); token.digits = fraction.length > 2 ? 'too-precise' : BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0') || '0'); }
    else token.entry = LEXICON.get(token.key) ?? (/n't$/.test(token.key) ? { kind: 'negation' } : LEXICON.get(token.key.replace(/'/g, '')));
    out.push(token);
  }
  return out;
}
const numeric = (t?: Token) => t?.digits !== undefined && t.digits !== 'too-precise' || t?.entry?.kind === 'number';
/** An ambiguous word is read as a number only when a multiplier or a money word follows it ("do lakh", "do rupaye"). */
const continues = (t?: Token) => t?.entry?.kind === 'mult' || t?.entry?.kind === 'currency' || t?.entry?.kind === 'paise';

/** Reads one number phrase starting at `i`; returns the index after it, or `i` when there is none. */
function phrase(list: Token[], i: number): { end: number; h: bigint } {
  let total = 0n, group = 0n, mod: bigint | null = null, lastBig = 0n, end = i, prevTens = false, prevNumber = false;
  for (let j = i; j < list.length; j++) {
    const t = list[j]; const e = t.entry;
    if (e?.kind === 'mod') { if (mod !== null || prevNumber) break; if (!(numeric(list[j + 1]) || list[j + 1]?.entry?.kind === 'mult')) break; mod = e.d; continue; }
    // Only "hundred and five": an "and" after any other word ends the phrase, so "2 lakh and 5 invoices" stays two numbers.
    if (e?.kind === 'and' && list[j - 1]?.key === 'hundred' && end === j && list[j + 1]?.entry?.kind === 'number' && list[j + 2]?.entry?.kind !== 'mult') continue;
    if (numeric(t)) {
      const v = t.digits !== undefined ? t.digits as bigint : (e as { h: bigint }).h;
      if (e?.kind === 'number' && e.ambiguous && mod === null && !(j > i) && !continues(list[j + 1])) break;
      if (prevNumber && !(prevTens && v < 1000n && t.digits === undefined)) break;
      group += mod !== null ? v + mod : v; mod = null; prevTens = e?.kind === 'number' && Boolean(e.tens); prevNumber = true; end = j + 1; continue;
    }
    if (e?.kind === 'mult') {
      const bigger = lastBig !== 0n && e.m > lastBig && e.m >= 1000n;
      // A bare multiplier counts as one only at the start of a phrase or after sava/saadhe/paune ("lakh", "sava lakh").
      if (group === 0n && mod === null && (end !== i ? !bigger : e.m !== 100n)) break;
      const base = group === 0n ? 100n + (mod ?? 0n) : group; mod = null;
      if (e.m < 1000n) group = base * e.m;
      else { if (bigger) total = (total + group) * e.m; else total += base * e.m; lastBig = e.m; group = 0n; }
      prevNumber = false; prevTens = false; end = j + 1; continue;
    }
    break;
  }
  return { end, h: total + group };
}

export function interpretSpeech(input: string): Understood {
  check(typeof input === 'string' && input.length <= 10000, 'INVALID_TRANSCRIPT', 'Supply a transcript under ten thousand characters.');
  const normalised = input.normalize('NFC').replace(/[०-९]/g, d => String(d.charCodeAt(0) - 0x966)).replace(/’/g, "'").replace(/\s+/g, ' ').trim();
  const list = tokens(normalised); check(list.length <= 2000, 'INVALID_TRANSCRIPT', 'The transcript has too many words.');
  const numbers: UnderstoodNumber[] = [], negations: UnderstoodMark[] = [], ambiguities: Ambiguity[] = [], unclear: Unclear[] = [];
  const span = (from: Token, to: Token): Span => ({ text: normalised.slice(from.start, to.end), start: from.start, end: to.end });
  for (const match of normalised.matchAll(UNCLEAR)) unclear.push({ text: match[0], start: match.index!, end: match.index! + match[0].length, state: 'unknown', note: 'Not heard clearly.' });
  if (!normalised) unclear.push({ text: '', start: 0, end: 0, state: 'absent', note: 'Nothing was heard.' });
  for (let i = 0; i < list.length;) {
    const t = list[i]; const e = t.entry;
    if (t.digits === 'too-precise') { ambiguities.push({ ...span(t, t), code: 'TOO_PRECISE', note: AMBIGUITY_NOTES.TOO_PRECISE }); i++; continue; }
    if (e?.kind === 'negation' || e?.kind === 'exclusion') {
      if (t.key === 'no' && numeric(list[i + 1]) && list[i + 1].digits !== undefined) { ambiguities.push({ ...span(t, t), code: 'NO_NUMBER_ABBREVIATION', note: AMBIGUITY_NOTES.NO_NUMBER_ABBREVIATION }); i++; continue; }
      const tag = TAG_NA.has(t.key);
      negations.push({ ...span(t, t), kind: e.kind, ambiguous: tag, note: e.kind === 'negation' ? 'This flips the meaning.' : 'This leaves something out.' });
      if (tag) ambiguities.push({ ...span(t, t), code: 'NA_TAG_OR_NEGATION', note: AMBIGUITY_NOTES.NA_TAG_OR_NEGATION });
      i++; continue;
    }
    const before = list[i - 1]; const { end, h } = phrase(list, i);
    if (end === i) {
      if (e?.kind === 'mult') ambiguities.push({ ...span(t, t), code: 'MULTIPLIER_WITHOUT_COUNT', note: AMBIGUITY_NOTES.MULTIPLIER_WITHOUT_COUNT });
      if (e?.kind === 'number' && e.ambiguous && !(e.ambiguous === 'DO_TWO_OR_VERB' && ['not', "n't", 'you', 'we', 'i', 'it', 'this', 'that'].includes(list[i + 1]?.key ?? ''))) ambiguities.push({ ...span(t, t), code: e.ambiguous, note: AMBIGUITY_NOTES[e.ambiguous] });
      i++; continue;
    }
    const after = list[end]; const value = decimal(h);
    const rupees = after?.entry?.kind === 'currency' || before?.entry?.kind === 'currency';
    const paiseUnit = !rupees && after?.entry?.kind === 'paise';
    const paise = rupees ? String(h) : paiseUnit && value.integer !== null ? value.integer : null;
    const display = paiseUnit ? `${value.indian} paise` : rupees ? `₹${value.indian}` : value.indian;
    numbers.push({ ...span(list[i], list[end - 1]), ...value, unit: rupees ? 'rupees' : paiseUnit ? 'paise' : null, paise, display });
    if (value.integer === null && !(rupees && paise !== null)) ambiguities.push({ ...span(list[i], list[end - 1]), code: 'FRACTION_WITHOUT_UNIT', note: AMBIGUITY_NOTES.FRACTION_WITHOUT_UNIT });
    i = end;
  }
  const marks: { start: number; end: number; kind: Segment['kind']; text: string }[] = [
    ...numbers.map(n => ({ start: n.start, end: n.end, kind: 'number' as const, text: n.indian })),
    ...negations.map(n => ({ start: n.start, end: n.end, kind: n.kind, text: n.text })),
    ...ambiguities.filter(a => !negations.some(n => n.start === a.start) && !numbers.some(n => n.start <= a.start && a.end <= n.end)).map(a => ({ start: a.start, end: a.end, kind: 'ambiguous' as const, text: a.text })),
    ...unclear.filter(u => u.end > u.start).map(u => ({ start: u.start, end: u.end, kind: 'unclear' as const, text: u.text })),
  ].sort((a, b) => a.start - b.start);
  const segments: Segment[] = []; let cursor = 0;
  for (const mark of marks) { if (mark.start < cursor) continue; if (mark.start > cursor) segments.push({ kind: 'text', text: normalised.slice(cursor, mark.start) }); segments.push({ kind: mark.kind, text: mark.text }); cursor = mark.end; }
  if (cursor < normalised.length) segments.push({ kind: 'text', text: normalised.slice(cursor) });
  const understood = segments.map(s => s.text).join('');
  const deva = (normalised.match(/[ऀ-ॿ]/g) ?? []).length; const latin = (normalised.match(/[A-Za-z]/g) ?? []).length;
  const language = !deva && !latin ? 'unknown' : deva && latin ? 'mixed' : deva ? 'hi-Deva' : list.some(t => HINDI_ROMAN.has(t.key)) ? 'hi-Latn' : 'en';
  return { version: 1, normalised, understood, language, segments, negations, numbers, ambiguities, unclear, flipsMeaning: negations.length > 0, requiresConfirmation: true, digest: hash(JSON.stringify({ v: 1, normalised, understood })) };
}
