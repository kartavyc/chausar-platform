// Chausar venture launcher: the owner's own browser, driven on this computer to post after each approval (P2-connectors).
// It runs only when Playwright and its Chromium are already on this computer. The probe looks and nothing more: it never
// downloads or adds anything. Each platform gets a Chausar profile folder where the owner signs in to their own account
// themselves, once; Chausar reuses that session. Launch options stay Playwright's plain defaults with a visible window:
// no proxy, no changed user agent, no extra arguments, nothing that hides the automation from the platform.
// A post that may have gone out is reported as unknown, never retried here.
//
// Honest steps (Ink v2 wave 2, 2B2; catalogue K2, K3, K4; audit safety item 8):
// - Each step (the text box, the post button, the confirmation) is an ordered list of candidates: a test id, a role
//   with its name per UI language, an aria-label, a DevTools-style xpath. Each candidate has its own checked date, null
//   in the shipped data until a check run dates it (venture.posting.checkSteps, build/posting-steps.ts; a check dates the
//   text box and the post button, the first post that goes out dates the confirmation). The owner's own picks for this
//   computer come first; a pick is kept only for the ways that find the very control the owner clicked. A candidate
//   counts only when it matches exactly one visible element; when none does, the page is checked first (a security
//   check is a hold), then nothing is typed or clicked and the post is not sent, with one plain line.
// - After typing, the text box is read back; if it does not show exactly the approved text, nothing is clicked.
// - Right before the click the post button is found again; if its box or its words changed since the text went in, or
//   the post's click deadline passed (the journal may have closed it as unknown), nothing is clicked.
// - A post is confirmed by the platform: its own confirm element showing its confirm words, or its own answer to the
//   request that makes a post passing that platform's rule (data, unchecked against the live site: X answers 200 with
//   an errors list when it refuses a post, so X needs no errors and a rest_id; LinkedIn needs 201). A 403 or 429 on that
//   request, or X's automation code 226, is a security check: a hold. With no confirmation inside the step time the
//   post is unknown: never "not sent" after the click, and never a second click. The post's address is kept when the
//   confirm element or the response shows it.
// - The page's UI language picks the role names and aria-labels to try (English and Hindi in data).
// - Every page script Chausar runs goes through the script guard first (build/page-guard.ts), with an audit line of its
//   sha256 and counts; read-backs (the address, the confirm words, what the owner picked) go through the secret screen.
// - The model never proposes a selector in this build, so K2's inspection view for a model is not built.
//
// Posting window safety (W1 H19), all code, never a model's say:
// - A gate on the element each action touches. Before typing or clicking, the page tells code what the element is; a
//   submit (also any key ending in Enter in a form, and role="button" in a form), a password or code field, a file
//   input, a download or a link to another site is held for the owner. So is anything code cannot read: a script
//   link, or a form control whose target it cannot see. The one click the owner approved, the post button, passes only
//   as a submit on the same site. The owner picks every file and types every password.
// - A page check after each step, on what the platform owns only: the address, the HTTP status, the page title and
//   the platform's own notice element. Never the feed or the body, where anyone can write "account suspended". A
//   security check, verify, 403 or 429 page is a 'challenge'; a platform block is 'blocked' (posting.ts freezes the
//   channel for 72 hours). A session that ended is neither: the owner signs in again.
// - Holds per computer: a hold is also written beside the profile folders, so every business on this computer stops
//   posting and signing in on that platform until the owner clears the check, or until the 72 hours of a block pass.
//
// Ideas taken, code written here: QwenLM's Qwen-CUA demo (safety.py, computer.py) reads the element under the pointer
// and stops at a password, a file input, a download, a submit or another site; mrlong0129/yominpost (MIT) keeps a
// platform block apart from token expiry and freezes the channel; Selector Forge (elementRegistry.ts, xpath.ts,
// pickerOverlay.ts, MIT) keeps several ways to find one element and lets a person pick it; OpenGCUA's identity.ts
// finds it again before acting; AutoSocial (tiktok-uploader.js, platform-ui-labels.js, MIT) confirms by the platform's
// own response and keeps button words per language.
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ChausarError } from '../../contracts.ts';
import type {
  BrowserPort, BrowserPostJob, BrowserPostResult, BrowserProbe, BrowserSiteHold, BrowserStepsJob, BrowserStepsResult, IsoDate, PostingCandidate,
  PostingStepId, PostingStepPick,
} from '../contracts.ts';
import { screenReadback } from '../core/secrets.ts';
import { auditLine, checkPageScript, screenRead } from './page-guard.ts';

/** One way to find a step's element, with the day it last matched exactly one visible element on the live site. */
export type StepCandidate = PostingCandidate & { checkedOn: IsoDate | null };
/**
 * The platform's own response to the request that makes a post: its method and a pattern on its path, with the day
 * the pattern last matched a post that went out (checkedOn). It confirms a post only when its status is in okStatus
 * and its body passes body: no top-level key in absent (X answers 200 with an errors list when it refuses a post) and
 * a key in present somewhere inside. A 403 or 429 on it, or an error code in challengeCodes (X's 226, "this looks
 * automated"), is the platform's own check: a challenge hold. rulesCheckedOn: the day the status and body rules were
 * last checked against the live site; null in this build.
 */
export type ResponseMatch = {
  method: string;
  path: string;
  checkedOn: IsoDate | null;
  okStatus: readonly number[];
  body: { absent: readonly string[]; present: readonly string[] } | null;
  challengeCodes: readonly number[];
  rulesCheckedOn: IsoDate | null;
};

export type BrowserScript = {
  connectorId: string;
  name: string;
  signInUrl: string;
  composeUrl: string;
  signedOutPaths: readonly string[]; // a page under one of these means the session ended
  challengePaths: readonly string[]; // a page under one of these is the platform's own security check
  noticeSelector: string; // the platform's own error and notice element, the only page text the check reads
  /** Each step's candidates, in the order they are tried. */
  steps: Readonly<Record<PostingStepId, readonly StepCandidate[]>>;
  /** The words the platform's confirm element shows once the post went out, by UI language. */
  confirmWords: Readonly<Record<string, readonly string[]>>;
  response: ResponseMatch;
  /** A post's own address on this platform, as a pattern; only an address that matches it is kept. */
  postUrl: string;
};

/** The three steps of a browser post, in order. */
export const POSTING_STEPS: readonly PostingStepId[] = Object.freeze(['textbox', 'submit', 'confirm']);
/** The steps a dry run can check: the confirmation shows only after a post, so the first post checks it. */
export const DRY_RUN_STEPS: readonly ('textbox' | 'submit')[] = Object.freeze(['textbox', 'submit']);
/** A step in the owner's words. */
export const STEP_WORDS: Readonly<Record<PostingStepId, string>> = Object.freeze({ textbox: 'post box', submit: 'post button', confirm: 'post confirmation' });

const unchecked = <T extends PostingCandidate>(candidate: T): T & { checkedOn: null } => Object.freeze({ ...candidate, checkedOn: null });

/**
 * Text posts only. Instagram and YouTube need a picture or video upload, which is not built. The first candidate of
 * each step is the selector this build shipped before (LinkedIn's CSS written as the same xpath). Every candidate,
 * every Hindi word and both response patterns are unchecked until a check run or a post that went out dates them.
 */
export const BROWSER_SCRIPTS: Readonly<Record<string, BrowserScript>> = Object.freeze({
  x: Object.freeze({
    connectorId: 'x', name: 'X',
    signInUrl: 'https://x.com/i/flow/login', composeUrl: 'https://x.com/compose/post',
    signedOutPaths: Object.freeze(['/i/flow/login', '/login', '/logout']),
    challengePaths: Object.freeze(['/account/access']),
    noticeSelector: '[data-testid="toast"], [data-testid="error-detail"]',
    steps: Object.freeze({
      textbox: Object.freeze([
        unchecked({ kind: 'test-id', value: 'tweetTextarea_0' }),
        unchecked({ kind: 'role', value: 'textbox', name: 'Post text', lang: 'en' }),
        unchecked({ kind: 'aria-label', value: 'Post text', lang: 'en' }),
      ]),
      submit: Object.freeze([
        unchecked({ kind: 'test-id', value: 'tweetButton' }),
        unchecked({ kind: 'role', value: 'button', name: 'Post', lang: 'en' }),
        unchecked({ kind: 'role', value: 'button', name: 'पोस्ट करें', lang: 'hi' }),
      ]),
      confirm: Object.freeze([unchecked({ kind: 'test-id', value: 'toast' })]),
    }),
    confirmWords: Object.freeze({ en: Object.freeze(['Your post was sent']), hi: Object.freeze(['आपकी पोस्ट भेज दी गई']) }),
    // X's GraphQL answers 200 even when it refuses a post (187 duplicate, 226 looks automated, 344 daily limit), so
    // only a body with no errors list and a rest_id counts. Unchecked against the live site.
    response: Object.freeze({
      method: 'POST', path: '^/i/api/graphql/[^/]+/CreateTweet$', checkedOn: null,
      okStatus: Object.freeze([200]), body: Object.freeze({ absent: Object.freeze(['errors']), present: Object.freeze(['rest_id']) }),
      challengeCodes: Object.freeze([226]), rulesCheckedOn: null,
    }),
    postUrl: 'https://(?:x|twitter)\\.com/[A-Za-z0-9_]{1,15}/status/\\d{1,25}',
  }),
  linkedin: Object.freeze({
    connectorId: 'linkedin', name: 'LinkedIn',
    signInUrl: 'https://www.linkedin.com/login', composeUrl: 'https://www.linkedin.com/feed/?shareActive=true',
    // A /checkpoint page is LinkedIn's security check, not an ended session: it is a challenge (challengePaths).
    signedOutPaths: Object.freeze(['/login', '/uas/login', '/authwall']),
    challengePaths: Object.freeze(['/checkpoint']),
    noticeSelector: '[role="alert"], .artdeco-inline-feedback--error',
    steps: Object.freeze({
      textbox: Object.freeze([
        unchecked({ kind: 'xpath', value: '//div[@role="textbox"][@contenteditable="true"]' }),
        unchecked({ kind: 'aria-label', value: 'Text editor for creating content', lang: 'en' }),
      ]),
      submit: Object.freeze([
        unchecked({ kind: 'xpath', value: '//button[contains(concat(" ", normalize-space(@class), " "), " share-actions__primary-action ")]' }),
        unchecked({ kind: 'role', value: 'button', name: 'Post', lang: 'en' }),
        unchecked({ kind: 'role', value: 'button', name: 'पोस्ट करें', lang: 'hi' }),
      ]),
      confirm: Object.freeze([unchecked({ kind: 'role', value: 'alert' })]),
    }),
    confirmWords: Object.freeze({ en: Object.freeze(['Post successful']), hi: Object.freeze(['पोस्ट सफल']) }),
    // LinkedIn makes a share with 201 Created; any other status is no confirmation. Unchecked against the live site.
    response: Object.freeze({
      method: 'POST', path: '^/voyager/api/contentcreation/normShares', checkedOn: null,
      okStatus: Object.freeze([201]), body: null, challengeCodes: Object.freeze([]), rulesCheckedOn: null,
    }),
    postUrl: 'https://www\\.linkedin\\.com/feed/update/urn:li:(?:share|activity|ugcPost):\\d{1,25}',
  }),
});

/** Playwright's own defaults with a window the owner can see. Nothing else, on purpose. */
export const LAUNCH_OPTIONS: Readonly<Record<string, unknown>> = Object.freeze({ headless: false });

/** How long a platform block freezes the channel, reads too. Never cleared early. */
export const FREEZE_HOURS = 72;
/** How long the window waits for the owner to click the element of a step none of the candidates found. */
export const PICK_MS = 120000;
/** The most matches one candidate is looked at for; more than this is not "exactly one". */
const MAX_MATCHES = 20;
/** The most of a platform's response body read for the post's address. */
const MAX_BODY = 262144;

/** The key a candidate is stored under: its kind, value, role name and language. */
export function candidateKey(candidate: PostingCandidate): string {
  const name = candidate.kind === 'role' && candidate.name ? `[name=${candidate.name}]` : '';
  return `${candidate.kind}:${candidate.value}${name}${candidate.lang ? `@${candidate.lang}` : ''}`;
}

/** The key a post confirmed by the platform's response dates its confirm step under: 'response:<method> <path>'. */
export function responseKey(script: BrowserScript): string {
  return `response:${script.response.method} ${script.response.path}`;
}

type BoxLike = { x: number; y: number; width: number; height: number };
type LocatorLike = {
  first(): LocatorLike;
  nth?(index: number): LocatorLike;
  count?(): Promise<number>;
  isVisible?(): Promise<boolean>;
  boundingBox?(options?: Record<string, unknown>): Promise<BoxLike | null>;
  textContent?(options?: Record<string, unknown>): Promise<string | null>;
  fill(text: string, options?: Record<string, unknown>): Promise<void>;
  click(options?: Record<string, unknown>): Promise<void>;
  waitFor(options?: Record<string, unknown>): Promise<void>;
  evaluate?(fn: (element: any, arg?: any) => unknown, arg?: unknown, options?: Record<string, unknown>): Promise<unknown>;
};
type ResponseLike = { status(): number; url?(): string; request?(): { method(): string }; text?(): Promise<string> };
type PageLike = {
  goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
  url(): string;
  locator(selector: string): LocatorLike;
  title?(): Promise<string>;
  evaluate?(fn: (arg: any) => unknown, arg?: unknown): Promise<unknown>;
  getByTestId?(testId: string): LocatorLike;
  getByRole?(role: string, options?: { name?: string; exact?: boolean }): LocatorLike;
  waitForResponse?(match: (response: ResponseLike) => boolean, options?: { timeout?: number }): Promise<ResponseLike>;
};
type ContextLike = {
  pages(): PageLike[];
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
  waitForEvent?(event: 'close', options?: Record<string, unknown>): Promise<unknown>;
};
export type PlaywrightLike = {
  chromium: { executablePath(): string; launchPersistentContext(dir: string, options: Record<string, unknown>): Promise<ContextLike> };
};

/** Finds Playwright next to Chausar (playwright, then playwright-core). Returns null when neither is there. */
export async function loadPlaywright(): Promise<PlaywrightLike | null> {
  const require = createRequire(import.meta.url);
  for (const name of ['playwright', 'playwright-core']) {
    let resolved: string;
    try { resolved = require.resolve(name); } catch { continue; }
    try {
      const loaded = await import(pathToFileURL(resolved).href);
      const chromium = loaded.chromium ?? loaded.default?.chromium;
      if (chromium) return { chromium };
    } catch { continue; }
  }
  return null;
}

export const PRESENT_REASON = 'Playwright with Chromium found on this computer.';
export const NO_PLAYWRIGHT = 'Playwright was not found next to Chausar. Chausar does not install it.';
export const NO_CHROMIUM = 'Playwright is here but its Chromium is not. Chausar does not download it.';

/** Where the hold files and the script audit live: beside the profile folders. Injected in tests. */
export type HoldFiles = { read(path: string): string | null; write(path: string, text: string): void };

export type PlaywrightPortOptions = {
  load?: () => Promise<PlaywrightLike | null>;
  exists?: (path: string) => boolean;
  /** Where the per-platform sign-in folders live. Default: CHAUSAR_BROWSER_PROFILES, else ~/.chausar/browser-sessions. */
  profileRoot?: string;
  /** The hold files beside the profile folders. Default: the files on this computer. */
  holdFiles?: HoldFiles;
  /** Milliseconds since 1970, for a block's 72 hours. Default: the computer's clock. */
  now?: () => number;
  /** Where each page script's audit line goes. Default: page-scripts.audit.log beside the profile folders. */
  audit?: (line: string, connectorId: string) => void;
};

function underPath(url: string, prefixes: readonly string[]): boolean {
  let path: string;
  try { path = new URL(url).pathname; } catch { return true; }
  return prefixes.some(prefix => path === prefix || path.startsWith(`${prefix}/`));
}

function signedOut(url: string, script: BrowserScript): boolean {
  return underPath(url, script.signedOutPaths);
}

// ---------------------------------------------------------------------------
// The window gate: what an action touches, read by code from the page
// ---------------------------------------------------------------------------

/** What the page says about one element. READ_ELEMENT makes it inside the page; nothing here comes from a model. */
export type ElementFacts = {
  tag: string; // lower case; '' when there is no element
  type: string | null; // the type attribute, lower case
  role: string | null;
  autocomplete: string | null;
  inForm: boolean;
  href: string | null; // the full address of the nearest link around it
  download: boolean; // that link downloads a file
  formAction: string | null; // where it sends: its own formaction, else its form's action, in full
  contentEditable: boolean;
};
export type BrowserAction = { kind: 'click' } | { kind: 'fill' } | { kind: 'press'; key: string };
/** 'unreadable': code cannot tell what the action would do (a script link, a form target it cannot see). */
export type SensitiveKind = 'password' | 'file' | 'download' | 'submit' | 'off-site' | 'unreadable';

/**
 * Runs inside the page on one element (through the guarded runner), so it uses nothing from outside itself. Reads the
 * facts the gate needs from one DOM element; a missing element gives tag ''. A button's own formaction goes first.
 */
export const READ_ELEMENT = (element: any): ElementFacts => {
  const lower = (value: unknown) => (typeof value === 'string' && value.length > 0 ? value.toLowerCase() : null);
  const attribute = (name: string) => (element && typeof element.getAttribute === 'function' ? lower(element.getAttribute(name)) : null);
  const closest = (selector: string) => (element && typeof element.closest === 'function' ? element.closest(selector) : null);
  const link = closest('a[href], area[href]');
  const form = (element && element.form) || closest('form');
  const own = element && typeof element.hasAttribute === 'function' && element.hasAttribute('formaction') && typeof element.formAction === 'string' ? element.formAction : null;
  return {
    tag: lower(element && element.tagName) ?? '', type: attribute('type'), role: attribute('role'), autocomplete: attribute('autocomplete'),
    inForm: !!form, href: link && typeof link.href === 'string' ? link.href : null,
    download: !!link && typeof link.hasAttribute === 'function' && link.hasAttribute('download') === true,
    formAction: own ?? (form && typeof form.action === 'string' ? form.action : null),
    contentEditable: !!element && element.isContentEditable === true,
  };
};

/** Runs inside the page: the words of the platform's own notice element, and nothing else on the page. */
export const PAGE_NOTICE = (selector: string): string => {
  const found = (globalThis as { document?: { querySelector(selector: string): { innerText?: string } | null } }).document?.querySelector(selector);
  return typeof found?.innerText === 'string' ? found.innerText.slice(0, 2000) : '';
};

/** Runs inside the page: the UI language the platform set on the page's root element, or ''. */
export const PAGE_LANG = (): string => {
  const root = (globalThis as { document?: { documentElement?: { lang?: unknown } } }).document?.documentElement;
  return root && typeof root.lang === 'string' ? root.lang.slice(0, 20) : '';
};

/** Runs inside the page on one element: the full addresses of the link around it and the links inside it, at most ten. */
export const LINKS_IN = (element: any): string[] => {
  const out: string[] = [];
  const add = (link: any) => { if (link && typeof link.href === 'string' && out.length < 10) out.push(link.href.slice(0, 2048)); };
  if (element && typeof element.closest === 'function') add(element.closest('a[href]'));
  if (element && typeof element.querySelectorAll === 'function') for (const link of Array.from(element.querySelectorAll('a[href]'))) add(link);
  return out;
};

/** What the owner's click on one element says about it: the ways to find it again. Every field may be null. */
export type PickedElement = { testId: string | null; role: string | null; name: string | null; ariaLabel: string | null; xpath: string | null };

/** The attribute the pick overlay marks the clicked control with, so Chausar can tell it apart from every other element. */
export const PICK_MARK = 'data-chausar-pick';

/**
 * Runs inside the page: one line at the top of the window asks the owner to click the element once. Every click, key
 * and touch is stopped before the platform sees it, so nothing on the page happens. From what was clicked (often a
 * word inside a button) it climbs to the control itself: the nearest button, link, field, element with a role, or
 * editable block. It marks that control with arg.mark and answers its test id, role and name, aria-label and an xpath
 * anchored at the nearest id or test id (null when there is none, never a positional path from the top of the page),
 * or null when the time runs out. Removes its line, its listeners and its timer after.
 */
export const PICK_ELEMENT = (arg: { line: string; ms: number; step: string; mark: string }): Promise<PickedElement | null> => new Promise(resolve => {
  const scope = globalThis as any;
  const doc = scope.document;
  if (!doc || !doc.body || typeof scope.addEventListener !== 'function') { resolve(null); return; }
  const banner = doc.createElement('div');
  banner.textContent = String((arg && arg.line) || '');
  banner.setAttribute('style', 'position:fixed;top:0;left:0;right:0;z-index:2147483647;padding:10px 14px;background:#0b0d0e;color:#ffffff;font:14px sans-serif;');
  doc.body.appendChild(banner);
  const kinds = 'pointerdown mousedown pointerup mouseup click keydown keypress keyup touchstart touchend'.split(' ');
  const text = (value: unknown, max: number) => (typeof value === 'string' && value.trim().length > 0 ? value.replace(/\s+/g, ' ').trim().slice(0, max) : null);
  const attr = (node: any, name: string) => (node && typeof node.getAttribute === 'function' ? text(node.getAttribute(name), 200) : null);
  const tagOf = (node: any) => String((node && node.tagName) || '').toLowerCase();
  const editable = (node: any) => !!node && typeof node.hasAttribute === 'function' && node.hasAttribute('contenteditable') && String(node.getAttribute('contenteditable')).toLowerCase() !== 'false';
  const isControl = (node: any) => {
    const tag = tagOf(node);
    return tag === 'button' || tag === 'input' || tag === 'textarea' || tag === 'select' || (tag === 'a' && !!attr(node, 'href')) || !!attr(node, 'role') || editable(node);
  };
  const controlOf = (node: any) => {
    let at = node;
    for (let steps = 0; at && at.nodeType === 1 && steps < 12; steps += 1, at = at.parentElement) if (isControl(at)) return at;
    return node;
  };
  const roleOf = (node: any) => {
    const own = attr(node, 'role');
    if (own) return own.split(' ').shift() || null;
    const tag = tagOf(node);
    if (tag === 'button') return 'button';
    if (tag === 'a' && attr(node, 'href')) return 'link';
    if (tag === 'textarea' || editable(node)) return 'textbox';
    const type = String(attr(node, 'type') || 'text').toLowerCase();
    if (tag === 'input') return type === 'button' || type === 'submit' ? 'button' : 'textbox';
    return null;
  };
  const xpathOf = (node: any) => {
    const parts: string[] = [];
    const below = () => (parts.length ? `/${parts.join('/')}` : '');
    for (let at = node; at && at.nodeType === 1 && parts.length < 12; at = at.parentElement) {
      const id = attr(at, 'id');
      if (id && /^[A-Za-z][A-Za-z0-9_-]{0,99}$/.test(id)) return `//*[@id="${id}"]${below()}`;
      const testId = attr(at, 'data-testid');
      if (testId && /^[A-Za-z0-9_.:-]{1,120}$/.test(testId)) return `//*[@data-testid="${testId}"]${below()}`;
      const tag = tagOf(at);
      if (!/^[a-z][a-z0-9-]*$/.test(tag)) return null;
      const same = at.parentElement ? Array.from(at.parentElement.children).filter((child: any) => child.tagName === at.tagName) : [];
      parts.unshift(same.length > 1 ? `${tag}[${same.indexOf(at) + 1}]` : tag);
    }
    return null;
  };
  let done = false;
  let timer: any = null;
  const finish = (value: PickedElement | null) => {
    if (done) return;
    done = true;
    if (timer !== null) clearTimeout(timer);
    for (const kind of kinds) scope.removeEventListener(kind, stop, true);
    if (banner.parentNode) banner.parentNode.removeChild(banner);
    resolve(value);
  };
  const stop = (event: any) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    const target = event.target;
    if (event.type !== 'click' || !target || target === banner) return;
    const control = controlOf(target);
    const mark = arg && typeof arg.mark === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(arg.mark) ? arg.mark : null;
    if (mark && typeof control.setAttribute === 'function') control.setAttribute('data-chausar-pick', mark);
    const ariaLabel = attr(control, 'aria-label');
    finish({ testId: attr(control, 'data-testid'), role: roleOf(control), name: ariaLabel || text(control.textContent, 80), ariaLabel, xpath: xpathOf(control) });
  };
  for (const kind of kinds) scope.addEventListener(kind, stop, true);
  timer = setTimeout(() => finish(null), Math.max(1000, Math.min(Number(arg && arg.ms) || 0, 300000)));
});

/** Runs inside the page on one element: whether it is the control the owner clicked, by the pick overlay's mark. */
export const IS_PICKED = (element: any, mark: string): boolean => !!element && typeof element.getAttribute === 'function'
  && typeof mark === 'string' && mark.length > 0 && element.getAttribute('data-chausar-pick') === mark;

/** Runs inside the page: removes the pick overlay's mark from every element that carries it. Answers how many. */
export const UNMARK_PICK = (): number => {
  const doc = (globalThis as { document?: { querySelectorAll(selector: string): ArrayLike<{ removeAttribute(name: string): void }> } }).document;
  if (!doc) return 0;
  const marked = Array.from(doc.querySelectorAll('[data-chausar-pick]'));
  for (const node of marked) node.removeAttribute('data-chausar-pick');
  return marked.length;
};

function hostOf(url: string): { scheme: string; host: string } | null {
  try {
    const parsed = new URL(url);
    return { scheme: parsed.protocol, host: parsed.hostname.toLowerCase().replace(/^www\./, '') };
  } catch {
    return null;
  }
}

/** Whether going to target leaves the page's site. A subdomain is the same site; another scheme (mail, phone) leaves. */
export function leavesSite(target: string, pageUrl: string): boolean {
  const to = hostOf(target), from = hostOf(pageUrl);
  if (!to || !from) return true;
  if (to.scheme !== 'http:' && to.scheme !== 'https:') return true;
  return !(to.host === from.host || to.host.endsWith(`.${from.host}`) || from.host.endsWith(`.${to.host}`));
}

const SECRET_FIELDS = ['current-password', 'new-password', 'one-time-code'];
const BUTTON_INPUTS = ['submit', 'image', 'button', 'reset'];

/** What kind of sensitive action this is, or null for an ordinary one (typing in a text box, a click on the same site). */
export function sensitiveKind(action: BrowserAction, element: ElementFacts, pageUrl: string): SensitiveKind | null {
  if (element.tag === 'input' && element.type === 'password') return 'password';
  if ((element.autocomplete ?? '').split(/\s+/).some(token => SECRET_FIELDS.includes(token))) return 'password';
  if (element.tag === 'input' && element.type === 'file') return 'file';
  // A key press is named by its last part: "Control+Enter" and "NumpadEnter" are both Enter.
  const key = action.kind === 'press' ? action.key.split('+').at(-1) ?? '' : null;
  const enter = key === 'Enter' || key === 'NumpadEnter';
  const space = key === ' ' || key === 'Space';
  const buttonLike = element.tag === 'button' || element.role === 'button' || (element.tag === 'input' && BUTTON_INPUTS.includes(element.type ?? ''));
  const activates = action.kind === 'click' || (enter && (buttonLike || element.href !== null)) || (space && buttonLike);
  const enterInForm = enter && element.inForm && element.tag !== 'textarea' && !element.contentEditable;
  if (!activates && !enterInForm) return null;
  if (activates && element.href !== null) {
    if (/^\s*javascript:/i.test(element.href)) return 'unreadable';
    if (element.download || /^(?:blob|data):/i.test(element.href)) return 'download';
    if (leavesSite(element.href, pageUrl)) return 'off-site';
  }
  // A script can make any button in a form send it, so every button-like control in a form counts as a submit.
  if (!enterInForm && !(element.inForm && buttonLike)) return null;
  if (element.formAction === null) return 'unreadable';
  return leavesSite(element.formAction, pageUrl) ? 'off-site' : 'submit';
}

export type BrowserGateInput = {
  action: BrowserAction;
  /** null when the page could not say what the element is. */
  element: ElementFacts | null;
  pageUrl: string;
  /** The platform's name for the owner's words; the host when absent. */
  name?: string;
  /** This click is the one the owner approved: the post button for the approved post. It passes only as a submit. */
  approvedSubmit?: boolean;
};
export type BrowserGateResult = { allow: true } | { allow: false; kind: SensitiveKind; line: string };

/** May code do this action now? Anything sensitive is held for the owner, with one plain line saying why. */
export function gateBrowserAction(input: BrowserGateInput): BrowserGateResult {
  const name = input.name ?? hostOf(input.pageUrl)?.host ?? 'this site';
  const unreadable = `Chausar could not see what this control on ${name} does, so it stopped.`;
  if (!input.element) return { allow: false, kind: 'unreadable', line: unreadable };
  const kind = sensitiveKind(input.action, input.element, input.pageUrl);
  if (kind === null || (kind === 'submit' && input.approvedSubmit === true)) return { allow: true };
  const element = input.element;
  const target = element.href !== null && leavesSite(element.href, input.pageUrl) ? element.href : element.formAction ?? '';
  const lines: Record<SensitiveKind, () => string> = {
    password: () => `${name} asked for a password or a code. You type every password and code yourself, so Chausar stopped.`,
    file: () => `${name} asked for a file. You pick every file yourself, so Chausar stopped.`,
    download: () => `This would download a file from ${name}. Downloads wait for you, so Chausar stopped.`,
    'off-site': () => `This would leave ${name} for ${hostOf(target)?.host || 'another app'}. Chausar stopped before leaving the site.`,
    submit: () => `This would submit a form on ${name}. Only the post you approved is submitted, so Chausar stopped.`,
    unreadable: () => unreadable,
  };
  return { allow: false, kind, line: lines[kind]() };
}

// ---------------------------------------------------------------------------
// The guarded runner: every page script passes the script guard first (K4)
// ---------------------------------------------------------------------------

/** One page in Chausar's own window, with where its audit lines go. refused: the guard's reason, once it refused one. */
type Guarded = { page: PageLike; own: boolean; audit: (line: string) => void; refused: string | null };

function addressOf(page: PageLike): string {
  try { return page.url(); } catch { return ''; }
}

function guard(run: Guarded, fn: (arg: any) => unknown): void {
  const checked = checkPageScript({ source: fn, pageUrl: addressOf(run.page), ownTab: run.own });
  run.audit(auditLine(checked.audit));
  if (!checked.allowed) {
    run.refused = checked.reason;
    throw new ChausarError('PAGE_SCRIPT_REFUSED', `Chausar refused to run a script on the page. ${checked.reason}`);
  }
}

// The guarded runner: begin
/** Runs one page script on the page, only after the guard allowed it. */
async function pageScript(run: Guarded, fn: (arg: any) => unknown, arg?: unknown): Promise<unknown> {
  guard(run, fn);
  if (typeof run.page.evaluate !== 'function') throw new Error('This page cannot run scripts.');
  return run.page.evaluate(fn, arg);
}

/** Runs one page script on one element, only after the guard allowed it. */
async function elementScript(run: Guarded, locator: LocatorLike, fn: (element: any, arg?: any) => unknown, timeout: number, arg?: unknown): Promise<unknown> {
  guard(run, fn);
  if (typeof locator.evaluate !== 'function') throw new Error('This element cannot run scripts.');
  return locator.evaluate(fn, arg, { timeout });
}
// The guarded runner: end

// ---------------------------------------------------------------------------
// The page check: what the platform owns says it stopped us
// ---------------------------------------------------------------------------

/** What the check reads: the address, the HTTP status, the title and the platform's own notice element. No body text. */
export type PageFacts = { url: string; status: number | null; title: string; notice: string };

const BLOCK_WORDS = /\baction (?:was )?blocked\b|\byour account (?:has been |is |was )?(?:temporarily )?(?:suspended|restricted|limited)\b|\baccount (?:suspended|restricted)\b|\btemporarily (?:restricted|limited|blocked) from\b|\bwe restrict certain activity\b|\bapi access blocked\b/i;
const CHALLENGE_WORDS = /\bverify (?:that )?you(?:['’]re| are) (?:a )?human\b|\bverify (?:it['’]s|it is) you\b|\bverify your (?:identity|account)\b|\bconfirm (?:it['’]s|it is) you\b|\bsecurity (?:check|verification)\b|\bare you a robot\b|\bi['’]m not a robot\b|\bcaptcha\b|\bunusual (?:activity|traffic)\b|\bchecking your browser\b|\bpress (?:and|&) hold\b/i;
const CHALLENGE_TITLE = /^\s*(?:just a moment|attention required|access denied|security check)/i;
const CHALLENGE_PATHS = ['/challenge', '/captcha', '/sorry', '/cdn-cgi/challenge-platform'];

/**
 * Whether the page stops all automatic actions: a platform block ('blocked'), or a security check, verify, 403 or 429
 * page ('challenge'). A block is looked for first: it is the stronger stop. null for an ordinary page.
 */
export function pageStop(facts: PageFacts, script: BrowserScript): BrowserSiteHold | null {
  const site = hostOf(facts.url)?.host ?? script.connectorId;
  const words = `${facts.title}\n${facts.notice}`;
  if (BLOCK_WORDS.test(words)) return { kind: 'blocked', site };
  if (facts.status === 403 || facts.status === 429 || CHALLENGE_TITLE.test(facts.title) || CHALLENGE_WORDS.test(words)
    || underPath(facts.url, [...CHALLENGE_PATHS, ...script.challengePaths])) {
    return { kind: 'challenge', site };
  }
  return null;
}

function holdLine(hold: Pick<BrowserSiteHold, 'kind'>, script: BrowserScript): string {
  return hold.kind === 'blocked'
    ? `${script.name} blocked this account or this action, so Chausar stopped.`
    : `${script.name} showed a security check, so Chausar stopped. It will not act on ${script.name} until you clear the check yourself.`;
}

async function readPage(run: Guarded, response: unknown, script: BrowserScript): Promise<PageFacts | null> {
  try {
    const status = response && typeof (response as ResponseLike).status === 'function' ? (response as ResponseLike).status() : null;
    const title = typeof run.page.title === 'function' ? await run.page.title() : '';
    const notice = await pageScript(run, PAGE_NOTICE, script.noticeSelector);
    return { url: run.page.url(), status: typeof status === 'number' ? status : null, title: typeof title === 'string' ? title : '', notice: typeof notice === 'string' ? notice : '' };
  } catch {
    return null;
  }
}

/** The page check as the post sees it: why it stops, with the hold when there is one, or null to go on. */
async function checkPage(run: Guarded, response: unknown, script: BrowserScript): Promise<{ line: string; hold?: BrowserSiteHold } | null> {
  const facts = await readPage(run, response, script);
  if (!facts) return { line: `Chausar could not read the page on ${script.name}, so it stopped.` };
  const hold = pageStop(facts, script);
  return hold ? { line: holdLine(hold, script), hold } : null;
}

function isFacts(value: unknown): value is ElementFacts {
  const facts = value as ElementFacts | null;
  return !!facts && typeof facts === 'object' && typeof facts.tag === 'string' && typeof facts.inForm === 'boolean' && typeof facts.download === 'boolean'
    && typeof facts.contentEditable === 'boolean' && [facts.type, facts.role, facts.autocomplete, facts.href, facts.formAction].every(item => item === null || typeof item === 'string');
}

/** The facts about the element a locator points at, or null when the page could not say. */
async function readElement(run: Guarded, locator: LocatorLike, timeout: number): Promise<ElementFacts | null> {
  try {
    const facts = await elementScript(run, locator, READ_ELEMENT, timeout);
    return isFacts(facts) ? facts : null;
  } catch {
    return null;
  }
}

/** The page's UI language as two or three letters ('hi' for 'hi-IN'), or '' when the page does not say. */
async function pageLanguage(run: Guarded): Promise<string> {
  try {
    const lang = await pageScript(run, PAGE_LANG);
    const head = typeof lang === 'string' ? lang.trim().toLowerCase().split(/[-_]/)[0] : '';
    return /^[a-z]{2,3}$/.test(head) ? head : '';
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Finding a step's element: exactly one visible match (K2)
// ---------------------------------------------------------------------------

/** A step's element as found: the candidate that found it, by key, and the one visible element it matched. */
type Found = { key: string; candidate: PostingCandidate; element: LocatorLike };

/** A CSS attribute value in double quotes. */
function cssString(value: string): string {
  return JSON.stringify(value);
}

/** The Playwright locator a candidate stands for; null when this Playwright cannot make it. */
function locate(page: PageLike, candidate: PostingCandidate): LocatorLike | null {
  switch (candidate.kind) {
    case 'test-id': return typeof page.getByTestId === 'function' ? page.getByTestId(candidate.value) : null;
    case 'role': return typeof page.getByRole === 'function' ? page.getByRole(candidate.value, candidate.name ? { name: candidate.name, exact: true } : {}) : null;
    case 'aria-label': return page.locator(`[aria-label=${cssString(candidate.value)}]`);
    case 'xpath': return page.locator(`xpath=${candidate.value}`);
    default: return null;
  }
}

/** The visible elements a candidate matches, and how many visible ones it found (more than MAX_MATCHES count as many). */
async function visibleMatches(page: PageLike, candidate: PostingCandidate): Promise<{ count: number; first: LocatorLike | null }> {
  try {
    const locator = locate(page, candidate);
    if (!locator || typeof locator.count !== 'function' || typeof locator.nth !== 'function') return { count: 0, first: null };
    const total = await locator.count();
    if (total > MAX_MATCHES) return { count: total, first: null };
    let count = 0;
    let first: LocatorLike | null = null;
    for (let index = 0; index < total; index += 1) {
      const element = locator.nth(index);
      if (typeof element.isVisible === 'function' && await element.isVisible()) {
        count += 1;
        first ??= element;
      }
    }
    return { count, first };
  } catch {
    return { count: 0, first: null };
  }
}

/** A candidate for another UI language is not tried; one with no language always is. An unknown page language tries all. */
function forLanguage(candidate: PostingCandidate, lang: string): boolean {
  return !candidate.lang || !lang || candidate.lang === lang;
}

/**
 * A step's candidates in the order they are tried: the owner's own picks in the order kept (the vault keeps the newest
 * pick first), then the shipped ones.
 */
export function stepCandidates(script: BrowserScript, step: PostingStepId, added: readonly PostingStepPick[] = []): PostingCandidate[] {
  const own = added.filter(item => item.step === step).map(item => item.candidate);
  const seen = new Set<string>();
  return [...own, ...script.steps[step].map(({ checkedOn: _checkedOn, ...candidate }) => candidate)].filter(candidate => {
    const key = candidateKey(candidate);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The first candidate that matches exactly one visible element now, or null. */
async function resolveOnce(page: PageLike, candidates: readonly PostingCandidate[], lang: string): Promise<Found | null> {
  for (const candidate of candidates) {
    if (!forLanguage(candidate, lang)) continue;
    const match = await visibleMatches(page, candidate);
    if (match.count === 1 && match.first) return { key: candidateKey(candidate), candidate, element: match.first };
  }
  return null;
}

const sleep = (ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms); });
const pollMs = (timeout: number) => Math.max(5, Math.min(250, Math.floor(timeout / 8)));

/** Looks again until a candidate matches exactly one visible element or the step time runs out. */
async function resolveStep(page: PageLike, candidates: readonly PostingCandidate[], lang: string, timeout: number): Promise<Found | null> {
  const until = Date.now() + timeout;
  for (;;) {
    const found = await resolveOnce(page, candidates, lang);
    if (found || Date.now() >= until) return found;
    await sleep(pollMs(timeout));
  }
}

type Shape = { box: BoxLike | null; text: string };

/** Where the element is and what it says, to tell whether the page changed under it. */
async function shapeOf(element: LocatorLike, timeout: number): Promise<Shape | null> {
  try {
    const box = typeof element.boundingBox === 'function' ? await element.boundingBox({ timeout }) : null;
    const text = typeof element.textContent === 'function' ? await element.textContent({ timeout }) : '';
    return { box: box ?? null, text: (text ?? '').replace(/\s+/g, ' ').trim().slice(0, 500) };
  } catch {
    return null;
  }
}

/** Text as the box shows it, for comparing: one form of each letter, one space for any run of spaces and breaks. */
function plainWords(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** What the text box shows after typing, or null when it cannot say. Never kept: it is only compared. */
async function textOf(element: LocatorLike, timeout: number): Promise<string | null> {
  try {
    const text = typeof element.textContent === 'function' ? await element.textContent({ timeout }) : null;
    return typeof text === 'string' ? text : null;
  } catch {
    return null;
  }
}

/** Whether the box shows exactly the approved text, spaces and line breaks aside. */
function sameWords(shown: string | null, text: string): boolean {
  return shown !== null && plainWords(shown) === plainWords(text);
}

/** The same element in the same place with the same words. A move under one pixel is rounding, not a change. */
function sameShape(before: Shape | null, after: Shape | null): boolean {
  if (!before || !after || !before.box || !after.box || before.text !== after.text) return false;
  const near = (a: number, b: number) => Math.abs(a - b) < 1;
  return near(before.box.x, after.box.x) && near(before.box.y, after.box.y) && near(before.box.width, after.box.width) && near(before.box.height, after.box.height);
}

// ---------------------------------------------------------------------------
// Confirmation by the platform (K3) and the post's address
// ---------------------------------------------------------------------------

/** Whether a response is the platform's own answer to the request that makes a post, on the platform's own site. */
function isPostResponse(response: ResponseLike, script: BrowserScript): boolean {
  try {
    const url = typeof response.url === 'function' ? response.url() : '';
    const method = typeof response.request === 'function' ? response.request().method() : '';
    return !leavesSite(url, script.composeUrl) && method.toUpperCase() === script.response.method && new RegExp(script.response.path).test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/** The confirm element says the platform's own words for a post that went out, in any language in the data. */
async function saysPosted(element: LocatorLike, script: BrowserScript, timeout: number): Promise<boolean> {
  try {
    const raw = typeof element.textContent === 'function' ? await element.textContent({ timeout }) : '';
    const words = screenRead(raw ?? '').text.toLowerCase();
    return Object.values(script.confirmWords).some(list => list.some(word => words.includes(word.toLowerCase())));
  } catch {
    return false;
  }
}

/**
 * What the platform's answer to the post request says: 'posted' when its status and body pass the rule; 'challenge'
 * on a 403 or 429, or an error code that is the platform's automation check; 'refused' when the body carries an
 * error list; 'unproven' for anything else (a status outside the rule, a body without the proof, a body that is not
 * JSON). Only 'posted' confirms a post.
 */
export type ResponseVerdict = 'posted' | 'challenge' | 'refused' | 'unproven';

/** Whether a key appears anywhere inside a JSON value, looking at most this many levels down. */
function hasKey(value: unknown, key: string, depth = 12): boolean {
  if (depth < 0 || value === null || typeof value !== 'object') return false;
  if (!Array.isArray(value) && Object.hasOwn(value, key)) return true;
  return Object.values(value as Record<string, unknown>).some(item => hasKey(item, key, depth - 1));
}

/** The platform's answer to the post request against its rule (ResponseMatch). The body is read at most MAX_BODY long. */
export function responseVerdict(status: number, body: string, rule: ResponseMatch): ResponseVerdict {
  if (status === 403 || status === 429) return 'challenge';
  let json: unknown = null;
  if (rule.body || rule.challengeCodes.length) {
    try { json = JSON.parse(String(body ?? '').slice(0, MAX_BODY)); } catch { json = null; }
  }
  const top = json !== null && typeof json === 'object' && !Array.isArray(json) ? json as Record<string, unknown> : null;
  const errors = Array.isArray(top?.errors) ? top!.errors as unknown[] : [];
  const codes = errors.map(item => (item && typeof item === 'object' ? (item as { code?: unknown }).code : null));
  if (codes.some(found => typeof found === 'number' && rule.challengeCodes.includes(found))) return 'challenge';
  if (!rule.okStatus.includes(status)) return 'unproven';
  if (!rule.body) return 'posted';
  if (!top) return 'unproven';
  if (rule.body.absent.some(key => Object.hasOwn(top, key) && top[key] !== null && !(Array.isArray(top[key]) && (top[key] as unknown[]).length === 0))) return 'refused';
  return rule.body.present.every(key => hasKey(top, key)) ? 'posted' : 'unproven';
}

/** The platform's answer to the post request, once it came: the response, its body and the verdict on it. */
type Heard = { response: ResponseLike | null; body: string; verdict: ResponseVerdict | null };

/** Reads the platform's answer to the post request and gives the verdict on it. Never throws: a body it cannot read is ''. */
async function hear(response: ResponseLike, script: BrowserScript, heard: Heard): Promise<void> {
  let body = '';
  try { body = typeof response.text === 'function' ? String(await response.text()).slice(0, MAX_BODY) : ''; } catch { body = ''; }
  let status = 0;
  try { status = response.status(); } catch { status = 0; }
  heard.body = body;
  heard.response = response;
  heard.verdict = responseVerdict(status, body, script.response);
}

type Confirmation = { by: 'element'; found: Found } | { by: 'response'; response: ResponseLike; body: string };
/** No confirmation; when the platform's own answer was its security check, the hold it means. */
type NoConfirmation = { by: null; hold: BrowserSiteHold | null };

/**
 * Waits up to the step time for the confirm element or an answer to the post request that passes its rule. An answer
 * that is the platform's check, or that refuses the post, ends the wait at once with no confirmation; an answer
 * without proof leaves the confirm element to decide.
 */
async function confirmation(page: PageLike, script: BrowserScript, candidates: readonly PostingCandidate[], lang: string, timeout: number, heard: Heard): Promise<Confirmation | NoConfirmation> {
  const until = Date.now() + timeout;
  const site = hostOf(script.composeUrl)?.host ?? script.connectorId;
  for (;;) {
    if (heard.verdict === 'posted') return { by: 'response', response: heard.response!, body: heard.body };
    if (heard.verdict === 'challenge') return { by: null, hold: { kind: 'challenge', site } };
    if (heard.verdict === 'refused') return { by: null, hold: null };
    const found = await resolveOnce(page, candidates, lang);
    if (found && await saysPosted(found.element, script, timeout)) return { by: 'element', found };
    if (Date.now() >= until) return { by: null, hold: null };
    await sleep(pollMs(timeout));
  }
}

/**
 * A post's own address when the text names one in full, screened first. An address the screen changes is not kept at
 * all, never kept changed. Post ids are long numbers, so the card number rule is set aside for an address that
 * already matched the platform's own pattern; keys, codes and ids are still screened.
 */
export function postAddressIn(text: string, script: BrowserScript): string | null {
  const pattern = new RegExp(script.postUrl, 'g');
  for (const match of String(text ?? '').slice(0, MAX_BODY).matchAll(pattern)) {
    const address = match[0];
    const screened = screenReadback(address, { keep: ['card'] });
    if (screened.found.length === 0 && screened.text === address) return address;
  }
  return null;
}

/** The post's address from the confirm element's links, else from the platform's response, else null. */
async function postAddress(run: Guarded, script: BrowserScript, how: Confirmation, timeout: number): Promise<string | null> {
  try {
    if (how.by === 'element') {
      const links = await elementScript(run, how.found.element, LINKS_IN, timeout);
      for (const link of Array.isArray(links) ? links : []) {
        const address = typeof link === 'string' ? postAddressIn(link, script) : null;
        if (address && address.length >= link.length - 1) return address;
      }
      return null;
    }
    return postAddressIn(how.body, script);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// What the owner picked (owner-assisted repair)
// ---------------------------------------------------------------------------

const TEST_ID = /^[^\s"'<>`]{1,120}$/;
const ROLE = /^[a-z]{2,24}$/;

/** One picked attribute as Chausar may keep it: plain text, short, and only when the secret screen found nothing. */
function keepPicked(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text || text.length > max || /[\u0000-\u001f]/.test(text)) return null;
  const screened = screenRead(text, max);
  return screened.found.length === 0 && screened.text === text ? text : null;
}

/** An xpath held by an id or a test id (as the pick overlay builds it); a positional path from the top of the page is not kept. */
const ANCHORED_XPATH = /^\/\/\*\[@(?:id|data-testid)="[^"]{1,120}"\](?:\/[a-z][a-z0-9-]*(?:\[\d{1,3}\])?){0,12}$/;

/**
 * The candidates an owner's pick gives, each only if it now matches exactly one visible element and that element is
 * the control the owner clicked (the overlay's mark). The marks are removed after, whatever happened.
 */
async function pickedCandidates(run: Guarded, picked: unknown, lang: string, mark: string, timeout: number): Promise<PostingCandidate[]> {
  try {
    if (!picked || typeof picked !== 'object') return [];
    const item = picked as Record<string, unknown>;
    const testId = keepPicked(item.testId, 120);
    const role = keepPicked(item.role, 24);
    const name = keepPicked(item.name, 80);
    const ariaLabel = keepPicked(item.ariaLabel, 120);
    const xpath = keepPicked(item.xpath, 500);
    const language = lang ? { lang } : {};
    const all: PostingCandidate[] = [
      ...(testId && TEST_ID.test(testId) ? [{ kind: 'test-id' as const, value: testId }] : []),
      ...(role && ROLE.test(role) && name ? [{ kind: 'role' as const, value: role, name, ...language }] : []),
      ...(ariaLabel ? [{ kind: 'aria-label' as const, value: ariaLabel, ...language }] : []),
      ...(xpath && ANCHORED_XPATH.test(xpath) ? [{ kind: 'xpath' as const, value: xpath }] : []),
    ];
    const kept: PostingCandidate[] = [];
    for (const candidate of all) {
      const match = await visibleMatches(run.page, candidate);
      if (match.count !== 1 || !match.first) continue;
      if (await elementScript(run, match.first, IS_PICKED, timeout, mark).catch(() => false) === true) kept.push(candidate);
    }
    return kept;
  } finally {
    await pageScript(run, UNMARK_PICK).catch(() => 0);
  }
}

// ---------------------------------------------------------------------------
// Holds per computer, beside the profile folders
// ---------------------------------------------------------------------------

type HoldFile = { connectorId: string; kind: BrowserSiteHold['kind']; site: string; at: string; until: string | null; clearedAt: string | null };

const DISK_HOLDS: HoldFiles = {
  read(path) {
    try { return readFileSync(path, 'utf8'); } catch { return null; }
  },
  write(path, text) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, 'utf8');
  },
};

/** The audit file keeps this many lines, newest last. */
const AUDIT_LINES = 500;

/** The real port. Each call loads Playwright again only if Node has not cached it. */
export function playwrightBrowserPort(options: PlaywrightPortOptions = {}): BrowserPort & {
  signIn(connectorId: string): Promise<BrowserProbe>;
  clearHold(connectorId: string): Promise<void>;
  checkSteps(job: BrowserStepsJob): Promise<BrowserStepsResult>;
} {
  const load = options.load ?? loadPlaywright;
  const exists = options.exists ?? existsSync;
  const profileRoot = options.profileRoot ?? (process.env.CHAUSAR_BROWSER_PROFILES || join(homedir(), '.chausar', 'browser-sessions'));
  const files = options.holdFiles ?? DISK_HOLDS;
  const now = options.now ?? Date.now;
  const holdPath = (connectorId: string) => join(profileRoot, `${connectorId}.hold.json`);
  const auditPath = join(profileRoot, 'page-scripts.audit.log');
  const writeAudit = options.audit ?? ((line: string, connectorId: string) => {
    try {
      const kept = (files.read(auditPath) ?? '').split('\n').filter(Boolean);
      kept.push(`${new Date(now()).toISOString()} ${connectorId} ${line}`);
      files.write(auditPath, `${kept.slice(-AUDIT_LINES).join('\n')}\n`);
    } catch { /* the audit never stops a post; the guard has already decided */ }
  });

  /** The page Chausar opened in its own window, with the audit lines going to this connector's name. */
  function guarded(page: PageLike, connectorId: string, lines: string[] = []): Guarded {
    return { page, own: true, refused: null, audit: line => { lines.push(line); writeAudit(line, connectorId); } };
  }

  /** The hold on this platform on this computer now: an uncleared check or a block inside its 72 hours. */
  function liveHold(script: BrowserScript): (BrowserSiteHold & { line: string; file: HoldFile }) | null {
    const text = files.read(holdPath(script.connectorId));
    if (text === null) return null;
    let file: HoldFile;
    try {
      file = JSON.parse(text) as HoldFile;
      if (file.kind !== 'challenge' && file.kind !== 'blocked') throw new Error('unknown hold');
    } catch {
      // A hold file Chausar cannot read counts as a check the owner clears: it never lets automation through.
      file = { connectorId: script.connectorId, kind: 'challenge', site: script.connectorId, at: new Date(now()).toISOString(), until: null, clearedAt: null };
    }
    const live = file.kind === 'challenge' ? file.clearedAt === null : file.until !== null && Date.parse(file.until) > now();
    return live ? { kind: file.kind, site: file.site, line: holdLine(file, script), file } : null;
  }

  function writeHold(script: BrowserScript, hold: BrowserSiteHold): void {
    const at = now();
    const file: HoldFile = {
      connectorId: script.connectorId, kind: hold.kind, site: hold.site, at: new Date(at).toISOString(),
      until: hold.kind === 'blocked' ? new Date(at + FREEZE_HOURS * 3600000).toISOString() : null, clearedAt: null,
    };
    try { files.write(holdPath(script.connectorId), `${JSON.stringify(file, null, 2)}\n`); } catch { /* the vault keeps the hold too */ }
  }

  async function ready(): Promise<{ playwright: PlaywrightLike | null; probe: BrowserProbe }> {
    const playwright = await load().catch(() => null);
    if (!playwright) return { playwright: null, probe: { present: false, reason: NO_PLAYWRIGHT } };
    let executable = '';
    try { executable = playwright.chromium.executablePath(); } catch { executable = ''; }
    if (!executable || !exists(executable)) return { playwright: null, probe: { present: false, reason: NO_CHROMIUM } };
    return { playwright, probe: { present: true, reason: PRESENT_REASON } };
  }

  /**
   * One approved post: open the post box and check the page; find the text box and type into it if the gate allows;
   * read the box back and stop if it does not show exactly the text; find the post button, check the page again, find
   * the button once more right before the click and stop if it changed or the click deadline passed; click it once;
   * then wait for the platform's own confirmation, its confirm element or its answer to the post request. A step not
   * found checks the page first, so a security check the page draws after it loads is a hold, not "not found".
   */
  async function attempt(job: BrowserPostJob, script: BrowserScript): Promise<BrowserPostResult> {
    const { playwright, probe } = await ready();
    if (!playwright) return { outcome: 'not-sent', line: `${probe.reason} Nothing was posted.` };
    const timeout = job.timeoutMs;
    const added = Array.isArray(job.added) ? job.added : [];
    const notSent = (stop: { line: string; hold?: BrowserSiteHold }): BrowserPostResult => ({ outcome: 'not-sent', line: `${stop.line} Nothing was posted.`, ...(stop.hold ? { hold: stop.hold } : {}) });
    let context: ContextLike | null = null;
    let run: Guarded | null = null;
    let reached = false; // true from the click on: after it, the platform may have the post
    try {
      context = await playwright.chromium.launchPersistentContext(join(profileRoot, script.connectorId), { ...LAUNCH_OPTIONS });
      const page = context.pages()[0] ?? await context.newPage();
      const guardedRun = guarded(page, script.connectorId);
      run = guardedRun;
      /** A step not found: the page's own check first, then the plain line. */
      const missing = async (step: PostingStepId): Promise<BrowserPostResult> => {
        const stop = await checkPage(guardedRun, null, script);
        return stop ? notSent(stop) : { outcome: 'not-sent', line: `${script.name}'s ${STEP_WORDS[step]} was not found the way Chausar knows it. Nothing was posted.` };
      };
      const opened = await checkPage(run, await page.goto(script.composeUrl, { timeout }), script);
      if (opened) return notSent(opened);
      if (signedOut(page.url(), script)) {
        return { outcome: 'not-sent', line: `Sign in to ${script.name} in the Chausar browser window first. Nothing was posted.` };
      }
      const lang = await pageLanguage(run);
      const box = await resolveStep(page, stepCandidates(script, 'textbox', added), lang, timeout);
      if (!box) return await missing('textbox');
      const typing = gateBrowserAction({ action: { kind: 'fill' }, element: await readElement(run, box.element, timeout), pageUrl: page.url(), name: script.name });
      if (!typing.allow) return notSent(typing);
      await box.element.fill(job.text, { timeout });
      // The box must show exactly the approved text; neither text is kept when it does not.
      if (!sameWords(await textOf(box.element, timeout), job.text)) {
        return { outcome: 'not-sent', line: `${script.name}'s post box did not show the exact text, so Chausar did not post it. Nothing was posted.` };
      }
      const submit = stepCandidates(script, 'submit', added);
      const button = await resolveStep(page, submit, lang, timeout);
      if (!button) return await missing('submit');
      const before = await shapeOf(button.element, timeout);
      const pressing = gateBrowserAction({ action: { kind: 'click' }, element: await readElement(run, button.element, timeout), pageUrl: page.url(), name: script.name, approvedSubmit: true });
      if (!pressing.allow) return notSent(pressing);
      const typed = await checkPage(run, null, script);
      if (typed) return notSent(typed);
      // Right before the click: the same candidate finds one element, in the same place, with the same words.
      const again = await resolveOnce(page, submit, lang);
      if (!again || again.key !== button.key || !sameShape(before, await shapeOf(again.element, timeout))) {
        return { outcome: 'not-sent', line: 'The page changed before posting. Nothing was posted.' };
      }
      // Past the deadline the journal may already have closed this post as unknown: never click after it.
      if (typeof job.clickBy === 'number' && Date.now() >= job.clickBy) {
        return { outcome: 'not-sent', line: `${script.name} took too long, so Chausar did not press its post button. Nothing was posted.` };
      }
      const heard: Heard = { response: null, body: '', verdict: null };
      if (typeof page.waitForResponse === 'function') {
        page.waitForResponse(response => isPostResponse(response, script), { timeout: timeout * 2 })
          .then(response => hear(response, script, heard), () => undefined);
      }
      reached = true;
      await again.element.click({ timeout });
      const how = await confirmation(page, script, stepCandidates(script, 'confirm', added), lang, timeout, heard);
      if (how.by === null) {
        const after = await checkPage(run, null, script);
        const line = `The post may have gone out, but ${script.name} did not confirm it.`;
        const hold = how.hold ?? after?.hold ?? null;
        return hold ? { outcome: 'unknown', line: `${line} ${holdLine(hold, script)}`, hold } : { outcome: 'unknown', line };
      }
      const url = await postAddress(run, script, how, timeout);
      // A post that went out dates what it used; a confirmation by response dates the response rule.
      const confirmKey = how.by === 'element' ? how.found.key : responseKey(script);
      const checked = [{ step: 'textbox' as const, key: box.key }, { step: 'submit' as const, key: again.key }, { step: 'confirm' as const, key: confirmKey }];
      const line = how.by === 'element' ? `${script.name} showed that the post went out.` : `${script.name} answered that it took the post.`;
      return { outcome: 'posted', line, url, checked };
    } catch {
      if (!reached) return { outcome: 'not-sent', line: `${script.name} did not show its post box, so nothing was posted.` };
      const after = run ? await checkPage(run, null, script) : null;
      const line = `The post may have gone out, but ${script.name} did not confirm it.`;
      return after?.hold ? { outcome: 'unknown', line: `${line} ${after.line}`, hold: after.hold } : { outcome: 'unknown', line };
    } finally {
      if (context) await context.close().catch(() => {});
    }
  }

  /**
   * The dry run: open the post box in the owner's session, find every candidate of the text box and the post button
   * without typing or clicking, and count the visible elements each matches. The confirmation is skipped: it shows only
   * after a post, and a toast or alert that happens to be on the page proves nothing, so the first post dates it. A
   * step none matches checks the page first (a security check is a hold, and the pick never opens on it), then asks
   * the owner to click the element once in the window.
   */
  async function inspect(job: BrowserStepsJob, script: BrowserScript): Promise<BrowserStepsResult> {
    const audit: string[] = [];
    const { playwright, probe } = await ready();
    if (!playwright) return { outcome: 'not-run', line: probe.reason, audit };
    const timeout = job.timeoutMs;
    const added = Array.isArray(job.added) ? job.added : [];
    let context: ContextLike | null = null;
    let run: Guarded | null = null;
    const refusedResult = (reason: string): BrowserStepsResult => ({ outcome: 'not-run', line: `Chausar refused to run a script on the page. ${reason}`, refused: true, audit });
    const stopped = (stop: { line: string; hold?: BrowserSiteHold }): BrowserStepsResult => {
      if (stop.hold) writeHold(script, stop.hold);
      return { outcome: 'not-run', line: stop.line, ...(stop.hold ? { hold: stop.hold } : {}), audit };
    };
    try {
      context = await playwright.chromium.launchPersistentContext(join(profileRoot, script.connectorId), { ...LAUNCH_OPTIONS });
      const page = context.pages()[0] ?? await context.newPage();
      run = guarded(page, script.connectorId, audit);
      const opened = await checkPage(run, await page.goto(script.composeUrl, { timeout }), script);
      if (run.refused) return refusedResult(run.refused);
      if (opened) return stopped(opened);
      if (signedOut(page.url(), script)) return { outcome: 'signed-out', line: `Sign in to ${script.name} in the Chausar browser window first.`, audit };
      const lang = await pageLanguage(run);
      if (run.refused) return refusedResult(run.refused);
      const steps: { step: PostingStepId; key: string; visible: number }[] = [];
      const picked: PostingStepPick[] = [];
      for (const step of DRY_RUN_STEPS) {
        const candidates = stepCandidates(script, step, added).filter(candidate => forLanguage(candidate, lang));
        // Give the page the step time to draw the box and the button.
        await resolveStep(page, candidates, lang, timeout);
        const counted = [];
        for (const candidate of candidates) counted.push({ step, key: candidateKey(candidate), visible: (await visibleMatches(page, candidate)).count });
        steps.push(...counted);
        if (counted.some(item => item.visible === 1)) continue;
        const stop = await checkPage(run, null, script);
        if (run.refused) return refusedResult(run.refused);
        if (stop) return stopped(stop);
        const mark = randomUUID();
        const line = `Chausar: click the ${STEP_WORDS[step]} once. Nothing will be typed or posted.`;
        const answer = await pageScript(run, PICK_ELEMENT, { line, ms: PICK_MS, step, mark }).catch(() => null);
        for (const candidate of await pickedCandidates(run, answer, lang, mark, timeout)) picked.push({ step, candidate });
      }
      return { outcome: 'checked', steps, picked, audit };
    } catch {
      if (run?.refused) return refusedResult(run.refused);
      return { outcome: 'not-run', line: `Chausar could not check the steps on ${script.name}.`, audit };
    } finally {
      if (context) await context.close().catch(() => {});
    }
  }

  return {
    async probe() { return (await ready()).probe; },

    /**
     * Opens the platform's own sign-in page in the Chausar profile folder and waits until the owner closes the window.
     * Refused while this computer holds the platform: a check to clear first, or a block's 72 hours, when signing in
     * again is exactly what not to do.
     */
    async signIn(connectorId: string) {
      const script = BROWSER_SCRIPTS[connectorId];
      const held = script ? liveHold(script) : null;
      if (held) return { present: false, reason: held.line };
      const { playwright, probe } = await ready();
      if (!script || !playwright) return probe.present ? { present: false, reason: 'Signing in through the browser is not built for this platform.' } : probe;
      const context = await playwright.chromium.launchPersistentContext(join(profileRoot, script.connectorId), { ...LAUNCH_OPTIONS });
      try {
        const page = context.pages()[0] ?? await context.newPage();
        await page.goto(script.signInUrl);
        await context.waitForEvent?.('close', { timeout: 0 });
      } finally {
        await context.close().catch(() => {});
      }
      return probe;
    },

    /** The owner cleared the security check on this platform themselves. A block is never cleared early. */
    async clearHold(connectorId: string) {
      const script = BROWSER_SCRIPTS[connectorId];
      const held = script ? liveHold(script) : null;
      if (!script || !held || held.kind !== 'challenge') return;
      try { files.write(holdPath(connectorId), `${JSON.stringify({ ...held.file, clearedAt: new Date(now()).toISOString() }, null, 2)}\n`); } catch { /* nothing more to do */ }
    },

    /** Refused at once while this computer holds the platform; a hold the post meets is written for every business here. */
    async post(job: BrowserPostJob): Promise<BrowserPostResult> {
      const script = BROWSER_SCRIPTS[job.connectorId];
      if (!script) return { outcome: 'not-sent', line: 'Posting through the browser is not built for this platform. Nothing was posted.' };
      const held = liveHold(script);
      if (held) return { outcome: 'not-sent', line: `${held.line} Nothing was posted.`, hold: { kind: held.kind, site: held.site } };
      const result = await attempt(job, script);
      if (result.outcome !== 'posted' && result.hold) writeHold(script, result.hold);
      return result;
    },

    /** The dry run of venture.posting.checkSteps. Refused at once while this computer holds the platform. */
    async checkSteps(job: BrowserStepsJob): Promise<BrowserStepsResult> {
      const script = BROWSER_SCRIPTS[job.connectorId];
      if (!script) return { outcome: 'not-run', line: 'Checking the steps is not built for this platform.', audit: [] };
      const held = liveHold(script);
      if (held) return { outcome: 'not-run', line: held.line, hold: { kind: held.kind, site: held.site }, audit: [] };
      return inspect(job, script);
    },
  };
}
