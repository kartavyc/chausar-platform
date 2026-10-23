// Chausar venture launcher: the script and read-back guard for the posting window (catalogue K4, Ink v2 wave 2 2B2).
// Every page script Chausar runs in the owner's browser passes checkPageScript first, and so will any later browser
// agent's. It runs only in Chausar's own tab, on an http or https page, and is refused when its text reads cookies,
// stored data, saved sign-ins or the clipboard, reads a password, card or typed field, sends data anywhere, moves the
// page, clicks or submits for itself, writes markup, runs hidden code, or hides what it does (escapes, very long lines,
// computed names). It fails closed: a guard that cannot check refuses. Audit lines carry the script's sha256 and its
// counts only, never its text or what it read. What a script reads back is screened by core/secrets.ts before it is
// kept or shown (screenReadback, wave 1 H17).
// What it cannot do, said plainly: it reads the script's text, so a script built to slip past a word list can; the
// scripts Chausar runs are fixed code in build/browser.ts, and this guard is the second line, not the first.
// Idea taken, code written here: AutoCua's run_script guardrails (web/controller/run_script/guardrails_check.rs, MIT).
import { createHash } from 'node:crypto';
import { ChausarError } from '../../contracts.ts';
import { screenReadback } from '../core/secrets.ts';

/** What an audit line keeps of a page script: its sha256 and its size, never its text. sha256 is null when unreadable. */
export type PageScriptAudit = { sha256: string | null; characters: number; lines: number; outcome: 'allowed' | 'refused' };
export type PageScriptCheck = { allowed: true; audit: PageScriptAudit } | { allowed: false; reason: string; audit: PageScriptAudit };
export type PageScriptInput = {
  /** The script: a function (its source is read) or its source text. */
  source: unknown;
  /** The address of the page it would run on. */
  pageUrl: unknown;
  /** True only for the tab Chausar opened in its own browser window. */
  ownTab: boolean;
};

/** The longest line a page script may have. Longer lines are how packed or obfuscated code looks. */
export const MAX_SCRIPT_LINE = 2000;

type Rule = { pattern: RegExp; reason: string };

/** Each refusal and why, in the owner's words. The first rule that matches gives the reason. */
const RULES: readonly Rule[] = Object.freeze([
  { pattern: /\bcookies?\b|\bcookieStore\b/i, reason: 'It reads cookies.' },
  { pattern: /\b(?:localStorage|sessionStorage|indexedDB|caches)\b/, reason: 'It reads data the browser stores.' },
  { pattern: /\bcredentials?\b|\bclipboard\b/i, reason: 'It reads saved sign-ins or the clipboard.' },
  { pattern: /\bpassword\b|\bcc-(?:number|csc|exp|exp-month|exp-year|name|given-name|family-name|type)\b|autocomplete[^\n]{0,24}cc-/i, reason: 'It reads a password or card field.' },
  { pattern: /\.\s*(?:value|selectionStart|selectionEnd)\b/, reason: 'It reads what is typed in a field.' },
  {
    pattern: /\b(?:fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource|postMessage|BroadcastChannel|RTCPeerConnection|importScripts)\b|\bnew\s+Image\b|\bopen\s*\(/,
    reason: 'It sends data elsewhere.',
  },
  { pattern: /\blocation\b\s*(?:\.\s*\w+\s*)?=(?!=)|\blocation\s*\.\s*(?:assign|replace|reload)\b|\bhistory\s*\.\s*(?:pushState|replaceState|go|back|forward)\b/, reason: 'It moves the page elsewhere.' },
  { pattern: /\.\s*(?:click|submit|requestSubmit|dispatchEvent)\s*\(/, reason: 'It clicks or submits by itself.' },
  { pattern: /\b(?:innerHTML|outerHTML|insertAdjacentHTML)\b|\bdocument\s*\.\s*write/, reason: 'It writes markup into the page.' },
  { pattern: /\beval\b|\bFunction\b|\bimport\s*\(|\batob\b|\bbtoa\b|\bWorker\b|\bsetTimeout\s*\(\s*['"`]|\bsetInterval\s*\(\s*['"`]/, reason: 'It runs hidden code.' },
  { pattern: /\\x[0-9a-fA-F]{2}|\\u\{?[0-9a-fA-F]{2,}|\bfromCharCode\b|\bfromCodePoint\b|\bunescape\b|\bdecodeURI/, reason: 'It hides what it does.' },
  { pattern: /\b(?:window|globalThis|self|document|navigator|top|parent|frames)\s*\[|[\w$)\]]\s*\[\s*['"`]/, reason: 'It hides what it does.' },
]);

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function sourceOf(value: unknown): string {
  if (typeof value === 'function') return Function.prototype.toString.call(value);
  if (typeof value === 'string') return value;
  throw new Error('A page script is a function or its text.');
}

/**
 * May this script run on this page? Refused, with the reason in plain words, when the page is not Chausar's own tab or
 * not an http or https page, when the script's text does any of the things RULES lists, or when the guard itself
 * could not check. The audit says only the sha256 and the counts.
 */
export function checkPageScript(input: PageScriptInput): PageScriptCheck {
  let audit: PageScriptAudit = { sha256: null, characters: 0, lines: 0, outcome: 'refused' };
  try {
    const source = sourceOf(input.source);
    const lines = source.split(/\r?\n/);
    audit = { sha256: sha256(source), characters: source.length, lines: lines.length, outcome: 'refused' };
    const refuse = (reason: string): PageScriptCheck => ({ allowed: false, reason, audit });
    let protocol = '';
    try { protocol = new URL(String(input.pageUrl)).protocol; } catch { protocol = ''; }
    if (protocol !== 'http:' && protocol !== 'https:') return refuse('The page is not a web page (http or https).');
    if (input.ownTab !== true) return refuse("The page is not in Chausar's own tab.");
    if (lines.some(line => line.length > MAX_SCRIPT_LINE)) return refuse('It hides what it does.');
    for (const rule of RULES) if (rule.pattern.test(source)) return refuse(rule.reason);
    audit = { ...audit, outcome: 'allowed' };
    return { allowed: true, audit };
  } catch {
    return { allowed: false, reason: 'The guard could not check the script.', audit };
  }
}

/** The guard's answer as a throw: PAGE_SCRIPT_REFUSED with the reason. Returns the audit when allowed. */
export function requirePageScript(input: PageScriptInput): PageScriptAudit {
  const checked = checkPageScript(input);
  if (!checked.allowed) throw new ChausarError('PAGE_SCRIPT_REFUSED', `Chausar refused to run a script on the page. ${checked.reason}`);
  return checked.audit;
}

/** One audit line: the script's sha256 and counts, and whether it ran. Never its text, never what it read. */
export function auditLine(audit: PageScriptAudit): string {
  return `page script ${audit.sha256 ?? 'unreadable'}: ${audit.characters} characters, ${audit.lines} lines, ${audit.outcome}`;
}

/** The most of one read-back Chausar keeps. */
export const MAX_READBACK = 2000;

/**
 * A page read-back (the confirm text, a picked attribute) as Chausar may keep or show it: text only, at most
 * MAX_READBACK characters, through the secret screen. found lists the kinds the screen removed.
 */
export function screenRead(value: unknown, max = MAX_READBACK): { text: string; found: string[] } {
  const text = typeof value === 'string' ? value.slice(0, max) : '';
  return screenReadback(text);
}
