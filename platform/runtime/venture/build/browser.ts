// Chausar venture launcher: the owner's own browser, driven on this computer to post after each approval (P2-connectors).
// It runs only when Playwright and its Chromium are already on this computer. The probe looks and nothing more: it never
// downloads or adds anything. Each platform gets a Chausar profile folder where the owner signs in to their own account
// themselves, once; Chausar reuses that session. Launch options stay Playwright's plain defaults with a visible window:
// no proxy, no changed user agent, no extra arguments, nothing that hides the automation from the platform.
// The steps per platform are data with the day they last worked on the live site; null means never checked, and the
// connector label says so. A post that may have gone out is reported as unknown, never retried here.
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BrowserPort, BrowserPostJob, BrowserPostResult, BrowserProbe, IsoDate } from '../contracts.ts';

export type BrowserScript = {
  connectorId: string;
  name: string;
  signInUrl: string;
  composeUrl: string;
  signedOutPaths: readonly string[]; // a page under one of these means the session ended
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
    textbox: '[data-testid="tweetTextarea_0"]', submit: '[data-testid="tweetButton"]', confirm: '[data-testid="toast"]',
    checkedOn: null,
  }),
  linkedin: Object.freeze({
    connectorId: 'linkedin', name: 'LinkedIn',
    signInUrl: 'https://www.linkedin.com/login', composeUrl: 'https://www.linkedin.com/feed/?shareActive=true',
    signedOutPaths: Object.freeze(['/login', '/uas/login', '/checkpoint', '/authwall']),
    textbox: 'div[role="textbox"][contenteditable="true"]', submit: 'button.share-actions__primary-action', confirm: '[role="alert"]',
    checkedOn: null,
  }),
});

/** Playwright's own defaults with a window the owner can see. Nothing else, on purpose. */
export const LAUNCH_OPTIONS: Readonly<Record<string, unknown>> = Object.freeze({ headless: false });

type LocatorLike = {
  first(): LocatorLike;
  fill(text: string, options?: Record<string, unknown>): Promise<void>;
  click(options?: Record<string, unknown>): Promise<void>;
  waitFor(options?: Record<string, unknown>): Promise<void>;
};
type PageLike = { goto(url: string, options?: Record<string, unknown>): Promise<unknown>; url(): string; locator(selector: string): LocatorLike };
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

export type PlaywrightPortOptions = {
  load?: () => Promise<PlaywrightLike | null>;
  exists?: (path: string) => boolean;
  /** Where the per-platform sign-in folders live. Default: CHAUSAR_BROWSER_PROFILES, else ~/.chausar/browser-sessions. */
  profileRoot?: string;
};

function signedOut(url: string, script: BrowserScript): boolean {
  let path: string;
  try { path = new URL(url).pathname; } catch { return true; }
  return script.signedOutPaths.some(prefix => path === prefix || path.startsWith(`${prefix}/`));
}

/** The real port. Each call loads Playwright again only if Node has not cached it. */
export function playwrightBrowserPort(options: PlaywrightPortOptions = {}): BrowserPort & { signIn(connectorId: string): Promise<BrowserProbe> } {
  const load = options.load ?? loadPlaywright;
  const exists = options.exists ?? existsSync;
  const profileRoot = options.profileRoot ?? (process.env.CHAUSAR_BROWSER_PROFILES || join(homedir(), '.chausar', 'browser-sessions'));

  async function ready(): Promise<{ playwright: PlaywrightLike | null; probe: BrowserProbe }> {
    const playwright = await load().catch(() => null);
    if (!playwright) return { playwright: null, probe: { present: false, reason: NO_PLAYWRIGHT } };
    let executable = '';
    try { executable = playwright.chromium.executablePath(); } catch { executable = ''; }
    if (!executable || !exists(executable)) return { playwright: null, probe: { present: false, reason: NO_CHROMIUM } };
    return { playwright, probe: { present: true, reason: PRESENT_REASON } };
  }

  return {
    async probe() { return (await ready()).probe; },

    /** Opens the platform's own sign-in page in the Chausar profile folder and waits until the owner closes the window. */
    async signIn(connectorId: string) {
      const script = BROWSER_SCRIPTS[connectorId];
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

    async post(job: BrowserPostJob): Promise<BrowserPostResult> {
      const script = BROWSER_SCRIPTS[job.connectorId];
      if (!script) return { outcome: 'not-sent', line: 'Posting through the browser is not built for this platform. Nothing was posted.' };
      const { playwright, probe } = await ready();
      if (!playwright) return { outcome: 'not-sent', line: `${probe.reason} Nothing was posted.` };
      const timeout = job.timeoutMs;
      let context: ContextLike | null = null;
      let reached = false; // true from the click on: after it, the platform may have the post
      try {
        context = await playwright.chromium.launchPersistentContext(join(profileRoot, script.connectorId), { ...LAUNCH_OPTIONS });
        const page = context.pages()[0] ?? await context.newPage();
        await page.goto(script.composeUrl, { timeout });
        if (signedOut(page.url(), script)) {
          return { outcome: 'not-sent', line: `Sign in to ${script.name} in the Chausar browser window first. Nothing was posted.` };
        }
        await page.locator(script.textbox).first().fill(job.text, { timeout });
        reached = true;
        await page.locator(script.submit).first().click({ timeout });
        await page.locator(script.confirm).first().waitFor({ state: 'visible', timeout });
        return { outcome: 'posted', line: `${script.name} showed that the post went out.`, url: null };
      } catch {
        return reached
          ? { outcome: 'unknown', line: `The post may have gone out, but ${script.name} did not confirm it.` }
          : { outcome: 'not-sent', line: `${script.name} did not show its post box, so nothing was posted.` };
      } finally {
        if (context) await context.close().catch(() => {});
      }
    },
  };
}
