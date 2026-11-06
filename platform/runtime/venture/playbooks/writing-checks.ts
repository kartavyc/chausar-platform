// Chausar flagship playbooks (Ink v2 wave 4, package 4J16, catalogue Q20): writing checks as code, in English and Hindi.
// Code only, no model, and a check never rewrites the draft: it says what it found and the owner edits.
// - writing-bans: hard bans, each a failure: the long dash, "not X but Y" contrasts, summary phrases ("in conclusion",
//   "निष्कर्ष में") and invisible characters (zero-width spaces, bidi marks, soft hyphens, tag characters).
// - writing-tells: AI-tell words and stock phrases from fixed lists in both languages, as a rate per 1,000 characters
//   against the language's fixed baseline; two or more above the baseline fail.
// - writing-quotes: the share of the draft inside quotation marks, which must stay inside a band.
// - writing-bait: bait phrases ("tag 3 friends", "comment YES below", "दोस्तों को टैग करें") and stacked asks (three or
//   more of like, comment, share, subscribe ... in one post).
// Every result carries its rate per 1,000 characters. The copy the checks read has invisible characters taken out, so
// one cannot split a banned word; the joiners Indian scripts and emoji need (U+200C, U+200D) are kept. Devanagari is
// read in one form (NFC) with the nukta folded away, so तेज़ and तेज match. The draft's language is read from its
// script. The Hindi lists are machine-drafted and need a native reviewer (HINDI_REVIEW).
// Ideas taken, code written here: podcast-to-article scripts/check_style.py (rates per 1,000 characters and a quote
// share band), instagram-agent-skill humanize.py and slop.json, content-skills bait-check.md, loamwright
// ai_tells_detector.py.

export const HINDI_REVIEW = 'machine-drafted, needs a native reviewer';
export const WRITING_CHECK_IDS = ['writing-bans', 'writing-tells', 'writing-quotes', 'writing-bait'] as const;
export type WritingCheckId = typeof WRITING_CHECK_IDS[number];
export type WritingLanguage = 'en' | 'hi';
/** One writing check: its outcome, the owner's words, its rate per 1,000 characters, and what it found. */
export type WritingResult = { check: WritingCheckId; outcome: 'pass' | 'fail'; detail: string; rate: number | null; matches: string[] };
export type WritingOptions = {
  /** The draft's language; read from its script when left out. */
  language?: WritingLanguage;
  /** The posts the draft holds, each read on its own for stacked asks; the whole text is one post when left out. */
  posts?: readonly string[];
  /** false leaves out the English bait phrases, for a social draft whose word check already reads them. */
  englishBait?: boolean;
};

/** The fixed baselines: at most this many AI-tell or stock phrases per 1,000 characters, and the quoted-text band. */
export const WRITING_BASELINES: Readonly<Record<WritingLanguage, { tellsPer1000: number }>> = Object.freeze({ en: { tellsPer1000: 2 }, hi: { tellsPer1000: 2 } });
/** At most this much of a draft, per 1,000 characters, is inside quotation marks. */
export const QUOTE_BAND = Object.freeze({ maxPer1000: 350 });
/** A post with this many different asks stacks them. */
export const STACKED_ASKS = 3;
/** A draft shorter than this many characters needs three AI tells, not two, to fail. */
export const SHORT_DRAFT = 1000;

/** AI-tell words, as people read them. An English word matches its forms (delve, delves, delving). */
export const AI_TELLS: Readonly<Record<WritingLanguage, readonly string[]>> = Object.freeze({
  en: [
    'delve', 'tapestry', 'leverage', 'robust', 'underscore', 'testament', 'seamless', 'elevate', 'unleash', 'embark', 'realm',
    'pivotal', 'paramount', 'meticulous', 'vibrant', 'bustling', 'synergy', 'revolutionize', 'holistic', 'empower',
    'cutting-edge', 'game-changer', 'ever-evolving',
  ],
  hi: ['अद्वितीय', 'अविश्वसनीय', 'क्रांतिकारी', 'परिदृश्य', 'सशक्त', 'अत्याधुनिक', 'निःसंदेह', 'उल्लेखनीय', 'अभूतपूर्व', 'बेजोड़'],
});
/** Stock phrases, matched as written (case and the apostrophe's shape aside). */
export const STOCK_PHRASES: Readonly<Record<WritingLanguage, readonly string[]>> = Object.freeze({
  en: [
    "it's important to note", 'it is important to note', "it's worth noting", 'it is worth noting', "let's dive in", 'dive into',
    "in today's fast-paced", "in today's world", 'at the end of the day', 'look no further', 'take it to the next level', "whether you're a",
  ],
  hi: ['आज की तेज़-रफ़्तार दुनिया में', 'आज की दुनिया में', 'यह ध्यान देने योग्य है', 'आइए जानते हैं', 'अगले स्तर पर', 'इसमें कोई संदेह नहीं'],
});
/** Phrases that sum up instead of saying the thing: a hard ban. */
export const SUMMARY_PHRASES: Readonly<Record<WritingLanguage, readonly string[]>> = Object.freeze({
  en: ['in conclusion', 'to sum up', 'in summary', 'to summarize', 'to summarise', 'all in all', 'in a nutshell'],
  // कुल मिलाकर ("all in all") is everyday Hindi, so it is not banned.
  hi: ['निष्कर्ष में', 'निष्कर्षतः', 'संक्षेप में', 'सार यह है'],
});

/** "not X but Y" contrasts, in English and Hindi (न केवल ... बल्कि; ... नहीं, बल्कि), within one sentence. */
const CONTRAST: Readonly<Record<WritingLanguage, readonly RegExp[]>> = Object.freeze({
  en: [
    /\bnot\s+(?:just|only|merely|simply)\s+[^.!?;]{1,80}?,?\s*but\b/iu,
    /\b(?:it|this|that)(?:'s|\s+is)\s+not\s+[^.!?;,]{1,50},\s*(?:it|this|that)(?:'s|\s+is)\b/iu,
    // Only "not a NOUN, but a ...": "I'm not sure, but" and "Not yet, but soon" are ordinary English.
    /\bnot\s+(?:a|an|the)\s+[\p{L}\p{N}'-]+(?:\s+[\p{L}\p{N}'-]+){0,3},\s*but\s+(?:a|an|the)\b/iu,
  ],
  hi: [
    /(?<![\p{L}\p{M}])(?:न\s+केवल|न\s+सिर्फ|सिर्फ|केवल)\s+[^।.!?]{1,80}?\s+(?:नहीं\s*,?\s*)?बल्कि/u,
    /[^।.!?\s][^।.!?]{0,50}\s+नहीं\s*,\s*बल्कि/u,
  ],
});
/** Bait phrases (platforms demote them). The English ones are also in the social word check (social/checks.ts). */
const BAIT: Readonly<Record<WritingLanguage, readonly RegExp[]>> = Object.freeze({
  en: [
    /(?<![\p{L}\p{N}])tag\s+(?:a|your|that|\d+|one|two|three|four|five)\s+(?:friends?|bestie|buddy|someone|people)(?![\p{L}\p{N}])/iu,
    /(?<![\p{L}\p{N}])(?:like|share)\s+if(?![\p{L}\p{N}])/iu,
    /(?<![\p{L}\p{N}])double\s+tap\s+if(?![\p{L}\p{N}])/iu,
    /(?<![\p{L}\p{N}])smash\s+(?:that|the)\s+like(?![\p{L}\p{N}])/iu,
    /(?<![\p{L}\p{N}])share\s+(?:this\s+)?with\s+\d+\s+friends(?![\p{L}\p{N}])/iu,
    /(?<![\p{L}\p{N}])(?:follow\s*(?:for|4)\s*follow|f4f|like\s*(?:for|4)\s*like|l4l)(?![\p{L}\p{N}])/iu,
  ],
  hi: [/दोस्तों\s+को\s+टैग/u, /टैग\s+करो\s+उस/u, /कमेंट\s+में\s+(?:लिखें|लिखो)\s+["'\u201C\u2018]?[\p{L}\p{N}]+/u, /अगर\s+(?:आप\s+)?सहमत\s+हैं\s+तो\s+(?:लाइक|शेयर)/u],
});
/** Quote marks that open and close a quoted word, straight and curly. */
const OPEN_QUOTES = `"'${String.fromCharCode(0x201c, 0x2018)}`, CLOSE_QUOTES = `"'${String.fromCharCode(0x201d, 0x2019)}`;
/**
 * "comment" is bait only with "below", a quoted word or a word in capitals ("comment YES"): read on the words as written,
 * so the capitals count. "Comment for the client" is no bait.
 */
const COMMENT_BAIT = new RegExp(String.raw`(?<![\p{L}\p{N}])[Cc]omment\s+(?:below(?![\p{L}])|[${OPEN_QUOTES}][^${CLOSE_QUOTES}\n]{1,30}[${CLOSE_QUOTES}]|\p{Lu}{2,}(?![\p{L}]))`, 'u');
/** Asks in Hinglish, written in Latin letters: "like karo", "share karein", "subscribe kar do". */
const ASK_HINGLISH = /(?<![\p{L}])(like|comment|share|subscribe|follow|save|tag)\s+(?:karo|karein|karen|kijiye|kar\s+do|kar\s+dein|karna)(?![\p{L}])/giu;
/**
 * Asks that stack: an English one at the start of a clause and used as an ask (followed by a stop, "this", "it", "us",
 * "below", "and" ...), so "Like many founders" or "follows her plan" is no ask; a Hindi one with its verb (करें, करो, कीजिए).
 */
const ASK_EN = /(?:^|[.!?,;:\n]\s*|\band\s+|\bor\s+|\bthen\s+)(like|comment|share|subscribe|follow|save|tag|repost|retweet)(?=\s*[,.!?;:]|\s*$|\s+(?:this|it|us|me|now|below|and|or|if|for|with|to\s+(?:my|our|the)\s+channel|your\s+(?:thoughts|friends?))\b)/giu;
const ASK_HI = /(लाइक|कमेंट|शेयर|सब्सक्राइब|फॉलो|सेव|टैग)\s+(?:करें|करो|कीजिए|कर\s+दें|करना)/gu;

/** Characters that hide in text. The joiners Devanagari and emoji need (U+200C, U+200D) are not among them. */
const INVISIBLE = /[\u00AD\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\u{E0000}-\u{E007F}]/gu;

/** The text with its invisible characters taken out, and how many there were. */
export function stripInvisible(text: string): { text: string; removed: number } {
  let removed = 0;
  const out = text.replace(INVISIBLE, () => { removed += 1; return ''; });
  return { text: out, removed };
}

/** Text as the lists read it: one Unicode form, the nukta folded away, curly apostrophes straight, lower case. */
function fold(text: string): string {
  return text.normalize('NFC').replace(/\u093C/g, '').replace(/[\u2018\u2019]/g, "'").toLowerCase();
}

/** Hindi when the draft has at least as many Devanagari letters as Latin ones. */
export function writingLanguage(text: string): WritingLanguage {
  const devanagari = (text.match(/[ऀ-ॿ]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  return devanagari > 0 && devanagari >= latin ? 'hi' : 'en';
}

/** count per 1,000 characters, to one decimal place; 0 for an empty text. */
export function ratePer1000(count: number, characters: number): number {
  return characters > 0 ? Math.round((count * 1000 / characters) * 10) / 10 : 0;
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** An English word with its forms: a final e or y is dropped, so delve finds delving and tapestry finds tapestries. */
function englishWord(word: string): RegExp {
  const stem = /[ey]$/.test(word) && !word.includes('-') ? word.slice(0, -1) : word;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escape(fold(stem))}(?:s|es|d|ed|ing|ly|ies|ied|e|y|ment)?(?![\\p{L}\\p{N}])`, 'gu');
}
/** A phrase or a Hindi word, from a word start; a Hindi word may take its endings. */
function phrase(value: string, language: WritingLanguage): RegExp {
  const tail = language === 'en' ? '(?![\\p{L}\\p{N}])' : '';
  return new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${escape(fold(value))}${tail}`, 'gu');
}

/** Each entry of a list found in the text, once per time it occurs; phrases are blanked once found, so words inside them are not counted twice. */
function findAll(text: string, entries: readonly { label: string; pattern: RegExp }[]): { found: string[]; rest: string } {
  const found: string[] = [];
  let rest = text;
  for (const entry of entries) {
    rest = rest.replace(entry.pattern, match => { found.push(entry.label); return ' '.repeat(match.length); });
  }
  return { found, rest };
}

const TELL_PATTERNS: Readonly<Record<WritingLanguage, readonly { label: string; pattern: RegExp }[]>> = Object.freeze({
  en: [...STOCK_PHRASES.en.map(label => ({ label, pattern: phrase(label, 'en') })), ...AI_TELLS.en.map(label => ({ label, pattern: englishWord(label) }))],
  hi: [...STOCK_PHRASES.hi.map(label => ({ label, pattern: phrase(label, 'hi') })), ...AI_TELLS.hi.map(label => ({ label, pattern: phrase(label, 'hi') }))],
});
const SUMMARY_PATTERNS: Readonly<Record<WritingLanguage, readonly { label: string; pattern: RegExp }[]>> = Object.freeze({
  en: SUMMARY_PHRASES.en.map(label => ({ label, pattern: phrase(label, 'en') })),
  hi: SUMMARY_PHRASES.hi.map(label => ({ label, pattern: phrase(label, 'hi') })),
});

const LANGUAGE_WORDS: Readonly<Record<WritingLanguage, string>> = { en: 'English', hi: 'Hindi' };
const plural = (count: number, one: string, many: string) => `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;
const listed = (items: readonly string[]) => [...new Set(items)].slice(0, 6).join(', ');

function bans(text: string, copy: string, removed: number, language: WritingLanguage, characters: number): WritingResult {
  const found: string[] = [];
  const dashes = (text.match(/\u2014/g) ?? []).length;
  if (dashes) found.push(dashes === 1 ? 'a long dash' : `${dashes} long dashes`);
  // Each contrast once: a span two patterns both match counts one time.
  const spans: { from: number; to: number; text: string }[] = [];
  for (const pattern of [...CONTRAST.en, ...(language === 'hi' ? CONTRAST.hi : [])]) {
    const match = pattern.exec(copy);
    if (!match) continue;
    const from = match.index, to = match.index + match[0].length;
    if (!spans.some(span => from < span.to && to > span.from)) spans.push({ from, to, text: match[0].trim().slice(0, 60) });
  }
  const contrasts = spans.map(span => span.text);
  for (const match of contrasts) found.push(`"not X but Y" (${match})`);
  const summaries = findAll(copy, [...SUMMARY_PATTERNS.en, ...(language === 'hi' ? SUMMARY_PATTERNS.hi : [])]).found;
  for (const match of [...new Set(summaries)]) found.push(`a summary phrase (${match})`);
  if (removed) found.push(plural(removed, 'invisible character', 'invisible characters'));
  const count = dashes + contrasts.length + summaries.length + (removed ? 1 : 0);
  return {
    check: 'writing-bans', outcome: found.length ? 'fail' : 'pass', rate: ratePer1000(count, characters), matches: found,
    detail: found.length
      ? `Hard bans: ${found.join('; ')}. Rewrite those words.`
      : 'No long dash, no "not X but Y", no summary phrase and no invisible character.',
  };
}

function tells(copy: string, language: WritingLanguage, characters: number): WritingResult {
  // A Hindi draft is read with both lists: English tells creep into Hindi drafts too.
  const { found } = findAll(copy, language === 'hi' ? [...TELL_PATTERNS.hi, ...TELL_PATTERNS.en] : TELL_PATTERNS.en);
  const rate = ratePer1000(found.length, characters);
  const ceiling = WRITING_BASELINES[language].tellsPer1000;
  const baseline = `the ${LANGUAGE_WORDS[language]} baseline of ${ceiling} per 1,000`;
  // A short draft (under 1,000 characters) needs three tells to fail: one or two words there are often just words.
  const over = found.length >= (characters < SHORT_DRAFT ? 3 : 2) && rate > ceiling;
  const detail = over
    ? `${plural(found.length, 'AI-tell or stock phrase', 'AI-tell or stock phrases')}, ${rate} per 1,000 characters, above ${baseline}: ${listed(found)}. Say it in plain words.`
    : found.length
      ? `AI-tell and stock phrases: ${rate} per 1,000 characters (${listed(found)}), within ${baseline}.`
      : `No AI-tell or stock phrases: 0 per 1,000 characters, within ${baseline}.`;
  return { check: 'writing-tells', outcome: over ? 'fail' : 'pass', rate, matches: found, detail };
}

/** Quotation marks that open and close a quote: straight, curly and angle. */
const QUOTED = /"([^"\n]{1,2000})"|\u201C([^\u201D\n]{1,2000})\u201D|\u00AB([^\u00BB\n]{1,2000})\u00BB/gu;

function quotes(copy: string, characters: number): WritingResult {
  let inside = 0;
  const matches: string[] = [];
  for (const match of copy.matchAll(QUOTED)) {
    const words = match[1] ?? match[2] ?? match[3] ?? '';
    inside += [...words].length;
    matches.push(words.slice(0, 60));
  }
  const rate = ratePer1000(inside, characters);
  const share = Math.round(rate / 10);
  const band = `the band of at most ${QUOTE_BAND.maxPer1000 / 10}%`;
  const over = rate > QUOTE_BAND.maxPer1000;
  return {
    check: 'writing-quotes', outcome: over ? 'fail' : 'pass', rate, matches,
    detail: over
      ? `The quoted text is ${share}% of the draft (${rate} per 1,000 characters), above ${band}. Say more in your own words.`
      : `The quoted text is ${share}% of the draft (${rate} per 1,000 characters), inside ${band}.`,
  };
}

/** The different asks in one post, in order: English at a clause start, Hindi with its verb. */
function asksIn(post: string): string[] {
  const asks = [...post.matchAll(ASK_EN)].map(match => match[1].toLowerCase());
  for (const match of post.matchAll(ASK_HI)) asks.push(match[1]);
  for (const match of post.matchAll(ASK_HINGLISH)) asks.push(match[1].toLowerCase());
  return [...new Set(asks)];
}

function bait(visible: string, copy: string, posts: readonly string[], englishBait: boolean, characters: number): WritingResult {
  const found: string[] = [];
  // English bait is read on the words as written (capitals count), Hindi on the folded copy.
  for (const [pattern, text] of [...(englishBait ? [...BAIT.en, COMMENT_BAIT].map(item => [item, visible] as const) : []), ...BAIT.hi.map(item => [item, copy] as const)]) {
    const match = pattern.exec(text);
    if (match) found.push(`"${match[0].trim()}"`);
  }
  for (const post of posts) {
    const asks = asksIn(fold(stripInvisible(post).text));
    if (asks.length >= STACKED_ASKS) found.push(`${asks.length} asks in one post (${asks.join(', ')})`);
  }
  return {
    check: 'writing-bait', outcome: found.length ? 'fail' : 'pass', rate: ratePer1000(found.length, characters), matches: found,
    detail: found.length
      ? `Bait: ${found.join('; ')}. Ask for one thing, in plain words.`
      : `No bait phrases and no stacked asks (at most ${STACKED_ASKS - 1} asks in a post).`,
  };
}

/** The AI-tell words and stock phrases in a text, as listed (each once), English and Hindi. */
export function tellsIn(text: string): string[] {
  const copy = fold(stripInvisible(text).text);
  return [...new Set(findAll(copy, [...TELL_PATTERNS.hi, ...TELL_PATTERNS.en]).found)];
}

/**
 * The four writing checks on a draft's words, in order (WRITING_CHECK_IDS), each with its rate per 1,000 characters.
 * The checks read a copy with invisible characters taken out (named by writing-bans); the draft is never changed.
 */
export function writingChecks(text: string, options: WritingOptions = {}): WritingResult[] {
  // A byte order mark at the very start is how some files begin: taken out, never counted as hidden.
  const { text: visible, removed } = stripInvisible(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  const copy = fold(visible);
  const language = options.language ?? writingLanguage(visible);
  const characters = [...visible.trim()].length;
  const posts = options.posts?.length ? options.posts : [visible];
  return [
    bans(visible, copy, removed, language, characters),
    tells(copy, language, characters),
    quotes(visible, characters),
    bait(visible, copy, posts, options.englishBait !== false, characters),
  ];
}
