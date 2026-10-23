// Chausar venture launcher: the owner's own browser, driven on this computer to post after each approval (P2-connectors).
// It runs only when Playwright and its Chromium are already on this computer. The probe looks and nothing more: it never
// downloads or adds anything. Each platform gets a Chausar profile folder where the owner signs in to their own account
// themselves, once; Chausar reuses that session. Launch options stay Playwright's plain defaults with a visible window:
// no proxy, no changed user agent, no extra arguments, nothing that hides the automation from the platform.
// The steps per platform are data with the day they last worked on the live site; null means never checked, and the
// connector label says so. A post that may have gone out is reported as unknown, never retried here.
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
// platform block apart from token expiry and freezes the channel.
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BrowserPort, BrowserPostJob, BrowserPostResult, BrowserProbe, BrowserSiteHold, IsoDate } from '../contracts.ts';

export type BrowserScript = {
  connectorId: string;
  name: string;
  signInUrl: string;
  composeUrl: string;
  signedOutPaths: readonly string[]; // a page under one of these means the session ended
  challengePaths: readonly string[]; // a page under one of these is the platform's own security check
  noticeSelector: string; // the platform's own error and notice element, the only page text the check reads
  textbox: string;
  submit: string;
  confirm: string; // shown by the platform once the post went out
  checkedOn: IsoDate | null; // the day these steps last worked on the live site; null: never checked
};

/** Text posts only. Instagram and YouTube need a picture or video upload, which is not built. */
export const BROWSER_SCRIPTS: Readonly<Record<string, BrowserScript>> = Object.freeze({
  x: Object.freeze({
    connectorId: 'x', name: 'X',
    signInUrl: 'https://x.com/i/flow/login', composeUrl: 'https://x.com/compose/post',
    signedOutPaths: Object.freeze(['/i/flow/login', '/login', '/logout']),
    challengePaths: Object.freeze(['/account/access']),
    noticeSelector: '[data-testid="toast"], [data-testid="error-detail"]',
    textbox: '[data-testid="tweetTextarea_0"]', submit: '[data-testid="tweetButton"]', confirm: '[data-testid="toast"]',
    checkedOn: null,
  }),
  linkedin: Object.freeze({
    connectorId: 'linkedin', name: 'LinkedIn',
    signInUrl: 'https://www.linkedin.com/login', composeUrl: 'https://www.linkedin.com/feed/?shareActive=true',
    // A /checkpoint page is LinkedIn's security check, not an ended session: it is a challenge (challengePaths).
    signedOutPaths: Object.freeze(['/login', '/uas/login', '/authwall']),
    challengePaths: Object.freeze(['/checkpoint']),
    noticeSelector: '[role="alert"], .artdeco-inline-feedback--error',
    textbox: 'div[role="textbox"][contenteditable="true"]', submit: 'button.share-actions__primary-action', confirm: '[role="alert"]',
    checkedOn: null,
  }),
});

/** Playwright's own defaults with a window the owner can see. Nothing else, on purpose. */
export const LAUNCH_OPTIONS: Readonly<Record<string, unknown>> = Object.freeze({ headless: false });

/** How long a platform block freezes the channel, reads too. Never cleared early. */
export const FREEZE_HOURS = 72;

type LocatorLike = {
  first(): LocatorLike;
  fill(text: string, options?: Record<string, unknown>): Promise<void>;
  click(options?: Record<string, unknown>): Promise<void>;
  waitFor(options?: Record<string, unknown>): Promise<void>;
  evaluate?(fn: (element: any) => unknown, arg?: unknown, options?: Record<string, unknown>): Promise<unknown>;
};
type ResponseLike = { status(): number };
type PageLike = {
  goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
  url(): string;
  locator(selector: string): LocatorLike;
  title?(): Promise<string>;
  evaluate?(fn: (arg: any) => unknown, arg?: unknown): Promise<unknown>;
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

/** Where the hold files live: beside the profile folders. Injected in tests. */
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
 * Runs inside the page through Playwright's locator.evaluate, so it uses nothing from outside itself. Reads the facts
 * the gate needs from one DOM element; a missing element gives tag ''. A button's own formaction goes before its form.
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

async function readPage(page: PageLike, response: unknown, script: BrowserScript): Promise<PageFacts | null> {
  try {
    const status = response && typeof (response as ResponseLike).status === 'function' ? (response as ResponseLike).status() : null;
    const title = typeof page.title === 'function' ? await page.title() : '';
    const notice = typeof page.evaluate === 'function' ? await page.evaluate(PAGE_NOTICE, script.noticeSelector) : '';
    return { url: page.url(), status: typeof status === 'number' ? status : null, title: typeof title === 'string' ? title : '', notice: typeof notice === 'string' ? notice : '' };
  } catch {
    return null;
  }
}

/** The page check as the post sees it: why it stops, with the hold when there is one, or null to go on. */
async function checkPage(page: PageLike, response: unknown, script: BrowserScript): Promise<{ line: string; hold?: BrowserSiteHold } | null> {
  const facts = await readPage(page, response, script);
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
async function readElement(locator: LocatorLike, timeout: number): Promise<ElementFacts | null> {
  if (typeof locator.evaluate !== 'function') return null;
  try {
    const facts = await locator.evaluate(READ_ELEMENT, undefined, { timeout });
    return isFacts(facts) ? facts : null;
  } catch {
    return null;
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

/** The real port. Each call loads Playwright again only if Node has not cached it. */
export function playwrightBrowserPort(options: PlaywrightPortOptions = {}): BrowserPort & {
  signIn(connectorId: string): Promise<BrowserProbe>;
  clearHold(connectorId: string): Promise<void>;
} {
  const load = options.load ?? loadPlaywright;
  const exists = options.exists ?? existsSync;
  const profileRoot = options.profileRoot ?? (process.env.CHAUSAR_BROWSER_PROFILES || join(homedir(), '.chausar', 'browser-sessions'));
  const files = options.holdFiles ?? DISK_HOLDS;
  const now = options.now ?? Date.now;
  const holdPath = (connectorId: string) => join(profileRoot, `${connectorId}.hold.json`);

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
   * One approved post: open the post box, check the page, type the text into a box the gate allows, check again,
   * click the post button the owner approved, then wait for the platform's own confirmation.
   */
  async function attempt(job: BrowserPostJob, script: BrowserScript): Promise<BrowserPostResult> {
    const { playwright, probe } = await ready();
    if (!playwright) return { outcome: 'not-sent', line: `${probe.reason} Nothing was posted.` };
    const timeout = job.timeoutMs;
    const notSent = (stop: { line: string; hold?: BrowserSiteHold }): BrowserPostResult => ({ outcome: 'not-sent', line: `${stop.line} Nothing was posted.`, ...(stop.hold ? { hold: stop.hold } : {}) });
    let context: ContextLike | null = null;
    let page: PageLike | null = null;
    let reached = false; // true from the click on: after it, the platform may have the post
    try {
      context = await playwright.chromium.launchPersistentContext(join(profileRoot, script.connectorId), { ...LAUNCH_OPTIONS });
      page = context.pages()[0] ?? await context.newPage();
      const opened = await checkPage(page, await page.goto(script.composeUrl, { timeout }), script);
      if (opened) return notSent(opened);
      if (signedOut(page.url(), script)) {
        return { outcome: 'not-sent', line: `Sign in to ${script.name} in the Chausar browser window first. Nothing was posted.` };
      }
      const box = page.locator(script.textbox).first();
      const typing = gateBrowserAction({ action: { kind: 'fill' }, element: await readElement(box, timeout), pageUrl: page.url(), name: script.name });
      if (!typing.allow) return notSent(typing);
      await box.fill(job.text, { timeout });
      const button = page.locator(script.submit).first();
      const pressing = gateBrowserAction({ action: { kind: 'click' }, element: await readElement(button, timeout), pageUrl: page.url(), name: script.name, approvedSubmit: true });
      if (!pressing.allow) return notSent(pressing);
      const typed = await checkPage(page, null, script);
      if (typed) return notSent(typed);
      reached = true;
      await button.click({ timeout });
      await page.locator(script.confirm).first().waitFor({ state: 'visible', timeout });
      return { outcome: 'posted', line: `${script.name} showed that the post went out.`, url: null };
    } catch {
      if (!reached) return { outcome: 'not-sent', line: `${script.name} did not show its post box, so nothing was posted.` };
      const after = page ? await checkPage(page, null, script) : null;
      const line = `The post may have gone out, but ${script.name} did not confirm it.`;
      return after?.hold ? { outcome: 'unknown', line: `${line} ${after.line}`, hold: after.hold } : { outcome: 'unknown', line };
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
  };
}
