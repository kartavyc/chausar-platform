// Chausar venture launcher, policy (Ink v2 wave 1, H9): the untrusted inbound screen.
// Client files, mail, posts and web pages pass through it before an agent reads them. It strips script, iframe and
// style; removes hidden characters; redacts secrets and the ids the work does not need; and flags words aimed at the
// agent ("ignore previous instructions") or at a checker ("mark this as safe"). Observe mode only reports and changes
// nothing; enforce cleans the text and holds a flagged item until the owner releases that exact content. Anything the
// screen cannot check (an error, a broken rule, an item too big, an unknown mode) is held in both modes: it fails closed.
// Words are looked for in the text as it came, in the cleaned text, and in the cleaned text with every tag taken out,
// so words split by a tag or by an invisible character are still found and enforce never hands back the joined phrase.
// Findings say what kind of thing was found and where, never the words themselves, and a path never names a client's
// own field. Secrets and ids go through the shared rule set (core/secrets.ts screenReadback), once per string.
// The screen follows recruitops-agent recruitment_mail/sanitization.py and the observe-then-enforce rollout of
// yc-software/qm security-posture.ts; this is a rewrite, not a copy.
import {check,hash,isAppChannel} from '../../portable.ts';
import type {Json,ScreenNote} from '../../portable.ts';

import { screenReadback, type ReadbackKind } from '../core/secrets.ts';

export const SCREEN_MODES = ['observe', 'enforce'] as const;
export type ScreenMode = typeof SCREEN_MODES[number];
/** Where untrusted content comes from. client-answer: a client's answer the owner relays into a run. */
export const UNTRUSTED_SOURCES = ['client-file', 'mail', 'post', 'web-page', 'tool-output', 'client-answer'] as const;
export type UntrustedSource = typeof UNTRUSTED_SOURCES[number];
/** Ids the screen can redact. The work names the ones it needs (a CA firm keeps the PAN); the rest are redacted. */
export const ID_KINDS = ['card', 'aadhaar', 'bank-account', 'otp', 'pan'] as const satisfies readonly Exclude<ReadbackKind, 'secret'>[];
export type IdKind = typeof ID_KINDS[number];

export type FindingKind = 'active-content' | 'hidden' | 'secret' | 'id' | 'injection' | 'checker' | 'error';
/** What was found and, in a JSON value, where. Never the words found. */
export type ScreenFinding = { kind: FindingKind; what: string; at?: string };
export type ScreenStatus = 'clean' | 'flagged' | 'quarantined' | 'released';
/** checks: extra rules for this business (a client's banned words); a rule that throws holds the item. */
export type ScreenOptions = {
  mode: ScreenMode;
  keep?: readonly IdKind[];
  released?: readonly string[];
  checks?: readonly ((text: string) => readonly ScreenFinding[])[];
};
/** digest: of what came in, so a release binds to that exact content. text: what the agent may read, or null when held. */
export type ScreenResult = { source: UntrustedSource; mode: ScreenMode; digest: string; status: ScreenStatus; text: string | null; findings: ScreenFinding[] };
export type JsonScreenResult = Omit<ScreenResult, 'text'> & { value: Json | null };

/** What the agent reads in place of a result held for words aimed at it or at a checker. */
export const HELD_WORDS = 'This content had words aimed at the agent or a checker, so it is held for the owner to check. Nothing from it was read.';
/** What the agent reads in place of a result the screen could not check. */
export const HELD_ERROR_WORDS = 'The screen could not check this content, so it is held for the owner. Nothing from it was read.';
/** The owner's question on Today when a run's result is held. Words only. */
export const HELD_QUESTION = 'Something a tool read had words aimed at the agent or a checker, so it is held for you. Look at it in the run, release it if it is fine, then answer to let the agent go on.';
export const HELD_ERROR_QUESTION = 'The screen could not check something a tool read, so it is held for you. Look at it in the run, then answer to let the agent go on.';
/** The screen a business runs with: observe by default, enforce when the owner turns it on. released: digests the owner let through. */
export type ScreenSetting = { mode: ScreenMode; keep?: readonly IdKind[]; released?: readonly string[] };
/** Larger than any one tool result; anything bigger is held rather than checked in part. */
export const MAX_SCREEN_CHARS = 2_000_000;
const FLAGS: readonly FindingKind[] = ['injection', 'checker', 'hidden', 'error'];
const MAX_FINDINGS = 40;

const WHAT = Object.freeze({
  active: 'Script, frame or style code. The agent never runs it.',
  hidden: 'Hidden characters that can hide words from you.',
  secret: 'Something that looks like a key or a password.',
  injection: 'Words telling the agent to ignore its instructions or act differently.',
  checker: 'Words aimed at a checker, such as asking to mark this as safe.',
  error: 'The screen could not check this, so it is held.',
});
const ID_WHAT: Readonly<Record<IdKind, string>> = Object.freeze({
  card: 'A card number.', aadhaar: 'An Aadhaar number.', 'bank-account': 'A bank account number.', otp: 'A one-time code.', pan: 'A PAN.',
});

const ACTIVE_BLOCKS = [/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, /<iframe\b[^>]*>[\s\S]*?<\/iframe\s*>/gi, /<style\b[^>]*>[\s\S]*?<\/style\s*>/gi];
const ACTIVE_TAGS = /<\/?(?:script|iframe|style)\b[^>]*>/gi;
// Zero-width space, bidi embeddings and overrides, invisible operators, isolates, a byte order mark after the start
// and the Unicode tag block. ZWJ and ZWNJ stay in the text: Indian scripts use them.
const HIDDEN = /[\u200B\u202A-\u202E\u2060-\u2064\u2066-\u2069]|(?<!^)\uFEFF|[\u{E0000}-\u{E007F}]/gu;
/** Taken out only of the copies words are looked for in: joiners, the soft hyphen and variation selectors. */
const DETECT_ONLY = /[\u200C\u200D\u00AD\uFE00-\uFE0F]/g;
/**
 * Taken out of the cleaned text too, with no finding (they hide nothing worth holding an item for, but can split a
 * number or a word): every soft hyphen, and a joiner (ZWJ, ZWNJ) unless it sits between characters of an Indian script.
 */
const STRAY = /\u00AD|(?<![\u0900-\u0DFF])[\u200C\u200D]|[\u200C\u200D](?![\u0900-\u0DFF])/gu;
const ANY_TAG = /<\/?[A-Za-z][^>]*>/g;
const INJECTION: readonly RegExp[] = [
  /\b(?:ignore|disregard|forget|override|bypass)\s+(?:(?:all|any|the|your|my|these|those|of)\s+)*(?:previous|prior|above|earlier|preceding|system|original|existing|other)\s+(?:instructions?|prompts?|rules?|directions?|messages?|guidelines?|directives?)/i,
  /\b(?:ignore|disregard|forget|override|bypass)\s+(?:(?:all|any|the|your|my|these|those|of)\s+)*(?:instructions?|prompts?|directives?)\b/i,
  /\bnew\s+(?:instructions?|rules?|system\s+prompt)\s*:/i,
  /\byou\s+are\s+now\b[^.\n]{0,40}?\b(?:mode|assistant|agent|ai|model|admin|administrator|developer|unrestricted|jailbroken|dan|root|operator|in\s+charge)\b/i,
  /\b(?:reveal|print|show|repeat|leak|send)\s+(?:me\s+)?(?:your|the)\s+(?:system\s+prompt|instructions|prompt|api\s*keys?|passwords?|secrets?)/i,
  /\b(?:do\s+not|don['’]?t)\s+(?:tell|inform|mention|alert)\b[^.\n]{0,40}?\b(?:owner|user|human|admin|operator)s?\b/i,
  // Chat-template tokens, role tags and a line that starts as a role would.
  /<\|[a-z_ ]{2,24}\|>/i,
  /<\/?(?:system|assistant|instructions?)>|\[\s*\/?(?:system|inst)\s*\]|\bsystem\s+prompt\s*:/i,
  /(?:^|\n)[^\S\n]*(?:system|assistant|developer)[^\S\n]*:/i,
  // Hindi, normalised the way the text is, so a nukta written either way still matches; and Hindi in Latin letters.
  new RegExp('पिछले\\s+(?:सभी\\s+)?निर्देश'.normalize('NFKC'), 'u'),
  new RegExp('निर्देशों\\s+को\\s+(?:अनदेखा|नज़रअंदाज़|नजरअंदाज)'.normalize('NFKC'), 'u'),
  /\b(?:pichh?le|purane|upar\s+(?:ke|wale|likhe)|pehle\s+(?:ke|wale))\s+(?:(?:saare|sare|sabhi|sab)\s+)?(?:instructions?|nirdesh|niyam|rules?)\s+(?:ko\s+)?(?:ignore|bh[ou]o?l|nazar\s*anda+z|chh?od)/i,
];
const CHECKER: readonly RegExp[] = [
  /\bmark\s+(?:(?:this|it|them|everything|all|the\s+\w+)\s+)?as\s+(?:safe|clean|approved|verified|passed|compliant|trusted|correct|legitimate|valid|harmless)\b/i,
  /\bnote\s+to\s+(?:the\s+)?(?:ai|assistant|model|agent|reviewer|checker|auditor|judge|grader|evaluator|moderator)\b/i,
  /\b(?:ai|llm|model|automated)\s+(?:reviewers?|checkers?|graders?|judges?|auditors?|evaluators?|moderators?)\b[^.]{0,40}\b(?:should|must|will|please)\b/i,
  /\b(?:give|rate|score|grade)\s+(?:this|it)\s+(?:a\s+)?(?:10|ten|full\s+marks|five\s+stars|a\s+pass|pass|passing)\b/i,
  /\b(?:approve|pass)\s+(?:this|it)\s+(?:without|automatically)\b/i,
  /\bskip\s+(?:the\s+|any\s+)?(?:checks?|review|verification)\b/i,
  /\bdo\s+not\s+flag\b/i,
];

/** Replaces every match; says whether anything matched. */
function sweep(text: string, pattern: RegExp, label: string): { text: string; found: boolean } {
  let found = false;
  const out = text.replace(pattern, () => { found = true; return label; });
  return { text: out, found };
}

/** A copy to look for words in: no hidden or joining characters, one compatibility form, spaces tidied, lines kept. */
function detectable(text: string): string {
  return text.replace(HIDDEN, '').replace(DETECT_ONLY, '').normalize('NFKC').replace(/[^\S\n]+/g, ' ');
}

/** One string, checked: what was found, and the text with active content, hidden characters, secrets and ids gone. */
function screenText(input: string, keep: readonly IdKind[], checks: ScreenOptions['checks']): { cleaned: string; findings: ScreenFinding[] } {
  const findings: ScreenFinding[] = [];
  let text = input;
  let active = false;
  for (const block of ACTIVE_BLOCKS) { const swept = sweep(text, block, ''); text = swept.text; active ||= swept.found; }
  const tags = sweep(text, ACTIVE_TAGS, '');
  text = tags.text;
  if (active || tags.found) findings.push({ kind: 'active-content', what: WHAT.active });
  const hidden = sweep(text, HIDDEN, '');
  text = hidden.text.replace(STRAY, '');
  if (hidden.found) findings.push({ kind: 'hidden', what: WHAT.hidden });
  // Keys, tokens, secret parts of web addresses and ids, in one pass of the shared rule set.
  const read = screenReadback(text, { keep });
  if (read.found.includes('secret')) findings.push({ kind: 'secret', what: WHAT.secret });
  for (const kind of ID_KINDS) if (read.found.includes(kind)) findings.push({ kind: 'id', what: ID_WHAT[kind] });
  text = read.text;
  // Words: in the text as it came, the cleaned text, and the cleaned text with every tag taken out or turned to a space;
  // then each of those with - _ + / . turned to spaces, so words joined into an address or a file name are found too.
  const shapes = [input, text, text.replace(ANY_TAG, ''), text.replace(ANY_TAG, ' ')].map(detectable);
  const copies = [...new Set([...shapes, ...shapes.map(copy => copy.replace(/[-_+/.]+/g, ' '))])];
  if (copies.some(copy => INJECTION.some(pattern => pattern.test(copy)))) findings.push({ kind: 'injection', what: WHAT.injection });
  if (copies.some(copy => CHECKER.some(pattern => pattern.test(copy)))) findings.push({ kind: 'checker', what: WHAT.checker });
  for (const rule of checks ?? []) {
    for (const finding of rule(copies[0]!)) {
      check(finding && typeof finding.what === 'string' && (FLAGS as readonly string[]).concat('active-content', 'secret', 'id').includes(finding.kind), 'SCREEN_FAILED', 'A screen rule answered something unknown.');
      findings.push({ kind: finding.kind, what: finding.what.slice(0, 200) });
    }
  }
  return { cleaned: text, findings };
}

function checkOptions(source: unknown, options: ScreenOptions): void {
  check((UNTRUSTED_SOURCES as readonly unknown[]).includes(source), 'SCREEN_FAILED', 'That is not a source the screen knows.');
  check((SCREEN_MODES as readonly unknown[]).includes(options?.mode), 'SCREEN_FAILED', 'That is not a screen mode.');
  for (const kind of options.keep ?? []) check((ID_KINDS as readonly string[]).includes(kind), 'SCREEN_FAILED', 'That is not an id kind.');
}

function settle(findings: ScreenFinding[], mode: ScreenMode, digest: string, released: readonly string[] | undefined): ScreenStatus {
  const flagged = findings.some(finding => FLAGS.includes(finding.kind));
  if (!flagged) return 'clean';
  if (mode === 'observe') return 'flagged';
  return (released ?? []).includes(digest) ? 'released' : 'quarantined';
}

function held(source: unknown, mode: unknown, digest: string): ScreenResult {
  return {
    source: source as UntrustedSource, mode: mode as ScreenMode, digest, status: 'quarantined', text: null,
    findings: [{ kind: 'error', what: WHAT.error }],
  };
}

function digestOf(value: unknown): string {
  try { return hash(typeof value === 'string' ? value : JSON.stringify(value) ?? ''); } catch { return ''; }
}

/** What the agent reads in place of a held item: why it was held, without the words. */
export function heldWords(result: { findings: readonly { kind: string }[] }): string {
  return result.findings.some(finding => finding.kind === 'error') ? HELD_ERROR_WORDS : HELD_WORDS;
}

/** The note a record keeps of what the screen found or held, or null when it found nothing. */
export function screenNote(result: Pick<ScreenResult, 'mode' | 'status' | 'digest' | 'findings'>): ScreenNote | null {
  if (result.findings.length === 0 && result.status === 'clean') return null;
  return { mode: result.mode, status: result.status, digest: result.digest, findings: result.findings.map(finding => ({ ...finding })) };
}

/** How the runs view names each kind of finding. Never the words found. */
const KIND_WORDS: Readonly<Record<FindingKind, string>> = Object.freeze({
  injection: 'words aimed at the agent', checker: 'words aimed at a checker', hidden: 'hidden characters', 'active-content': 'script or style code',
  secret: 'a key or password', id: 'an id number', error: 'something it could not check',
});

/**
 * One line for the runs view: how many things the screen noted in a run's outside content and what kinds, such as
 * "Screen noted 3 things in outside content: words aimed at the agent, an id number." Null when it noted nothing.
 */
export function screenSummary(notes: readonly Pick<ScreenNote, 'findings'>[]): string | null {
  const findings = notes.flatMap(note => note.findings);
  if (!findings.length) return null;
  const kinds = [...new Set(findings.map(finding => KIND_WORDS[finding.kind as FindingKind] ?? 'something else'))];
  return `Screen noted ${findings.length} ${findings.length === 1 ? 'thing' : 'things'} in outside content: ${kinds.join(', ')}.`;
}

/** The owner's question for a held result: why it was held, without the words. */
export function heldQuestion(result: { findings: readonly { kind: string }[] }): string {
  return result.findings.some(finding => finding.kind === 'error') ? HELD_ERROR_QUESTION : HELD_QUESTION;
}

/**
 * Screens one item of untrusted text. Observe: the text is unchanged and the findings say what enforce would do.
 * Enforce: the text is cleaned, and an item with words aimed at the agent or a checker, or with hidden characters, is
 * held (text null) unless the owner released this exact content. Anything the screen cannot check is held in both modes.
 */
export function screenUntrusted(item: { source: UntrustedSource; text: string }, options: ScreenOptions): ScreenResult {
  const digest = digestOf(item?.text);
  try {
    checkOptions(item.source, options);
    check(typeof item.text === 'string', 'SCREEN_FAILED', 'Only text can be screened.');
    check(item.text.length <= MAX_SCREEN_CHARS, 'SCREEN_FAILED', 'This is too big to screen.');
    const { cleaned, findings } = screenText(item.text, options.keep ?? [], options.checks);
    const status = settle(findings, options.mode, digest, options.released);
    const text = status === 'quarantined' ? null : options.mode === 'observe' ? item.text : cleaned;
    return { source: item.source, mode: options.mode, digest, status, text, findings: findings.slice(0, MAX_FINDINGS) };
  } catch {
    return held(item?.source, options?.mode, digest);
  }
}

/** Field names of Chausar's own tool results. Any other name, such as a client's column, is shown by its place: #2. */
const OWN_FIELDS: ReadonlySet<string> = new Set([
  'file', 'files', 'name', 'format', 'tables', 'tablesMade', 'segments', 'note', 'table', 'columns', 'rows', 'sample', 'next', 'pages', 'page',
  'text', 'amounts', 'dates', 'id', 'line', 'coverage', 'entries', 'kind', 'meaning', 'more', 'resolved', 'mention', 'entry', 'receipt', 'figures',
  'ref', 'label', 'value', 'balanced', 'closingChecked', 'matched', 'paymentsWithNoBill', 'billsNotPaid', 'row', 'from', 'tier', 'asked', 'to',
  'recorded', 'sent', 'shadow', 'wouldHappen', 'couldNotSimulate', 'waiting', 'tool', 'at', 'code', 'message', 'outputs', 'summary', 'error', 'result',
]);
/** Lists whose items are a client's rows: inside an item only the row id is named. */
const ROW_LISTS: ReadonlySet<string> = new Set(['rows', 'sample', 'paymentsWithNoBill', 'billsNotPaid']);

/**
 * Screens every string in a JSON value (an agent tool's result), names and values both, and says where each finding
 * was, as a path such as rows[1].#2 that names only Chausar's own fields. Held as a whole: one flagged string holds it.
 */
export function screenJson(item: { source: UntrustedSource; value: Json }, options: ScreenOptions): JsonScreenResult {
  const digest = digestOf(item?.value);
  try {
    checkOptions(item.source, options);
    check(digest.length > 0 && JSON.stringify(item.value).length <= MAX_SCREEN_CHARS, 'SCREEN_FAILED', 'This is too big to screen.');
    const findings: ScreenFinding[] = [];
    const seen = new Set<string>();
    const note = (found: ScreenFinding[], at: string) => {
      for (const finding of found) {
        const key = `${finding.kind}:${finding.what}`;
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push({ ...finding, ...(at ? { at } : {}) });
      }
    };
    const one = (text: string, at: string): string => {
      const { cleaned, findings: found } = screenText(text, options.keep ?? [], options.checks);
      note(found, at);
      return cleaned;
    };
    const walk = (value: Json, at: string, field: string | null, inRow: boolean): Json => {
      if (typeof value === 'string') return one(value, at);
      if (Array.isArray(value)) return value.map((entry, index) => walk(entry, `${at}[${index}]`, null, field !== null && ROW_LISTS.has(field)));
      if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, entry], index) => {
          const named = inRow ? key === 'id' : OWN_FIELDS.has(key);
          const part = named ? key : `#${index + 1}`;
          const path = at ? `${at}.${part}` : part;
          return [one(key, path), walk(entry as Json, path, named ? key : null, false)];
        }));
      }
      return value;
    };
    const cleaned = walk(item.value, '', null, false);
    const status = settle(findings, options.mode, digest, options.released);
    const value = status === 'quarantined' ? null : options.mode === 'observe' ? item.value : cleaned;
    return { source: item.source, mode: options.mode, digest, status, value, findings: findings.slice(0, MAX_FINDINGS) };
  } catch {
    const { text: _text, ...rest } = held(item?.source, options?.mode, digest);
    return { ...rest, value: null };
  }
}

/**
 * The owner releases one held item, inside the app: the release binds to that exact content's digest, so changed
 * content is held again. What was released stays untrusted; the taint latch still applies to the run that reads it.
 */
export function releaseItem(result: Pick<ScreenResult, 'status' | 'digest'>, ctx: {channel?:string;sourceTainted?:boolean;role:string;memberId:string}): { digest: string; by: string } {
  check(isAppChannel(ctx) && (ctx.role === 'owner' || ctx.role === 'cofounder'), 'APP_APPROVAL_REQUIRED', 'Only you release held content, inside the Chausar app.');
  check(result.status === 'quarantined' && result.digest.length > 0, 'UNTRUSTED_NOT_HELD', 'This content is not held.');
  return { digest: result.digest, by: ctx.memberId };
}
