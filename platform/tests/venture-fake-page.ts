// Test helper, not a test file: a fake Playwright module with one fake page (Ink v2 wave 2, 2B2). The page knows its
// elements by the locator Chausar builds for a candidate (test id, role and name, aria-label, xpath), each match with
// whether it is visible, its box, its text, what READ_ELEMENT says it is and the links inside it. It counts clicks,
// answers the platform's own response after the click, and answers the pick overlay. No real browser, no network.
import {
  IS_PICKED, LINKS_IN, PAGE_LANG, PAGE_NOTICE, PICK_ELEMENT, READ_ELEMENT, UNMARK_PICK, playwrightBrowserPort, type ElementFacts, type PlaywrightLike,
} from '../runtime/venture/build/browser.ts';

export type Box = { x: number; y: number; width: number; height: number };
export type FakeElement = {
  visible?: boolean; // default true
  facts?: ElementFacts | 'unreadable';
  box?: Box | null | (() => Box | null);
  text?: string | (() => string);
  links?: string[];
  /** Milliseconds the element takes to say where it is (boundingBox), to run a post past its deadline. */
  slowMs?: number;
  /** The element the owner clicked during the pick: IS_PICKED answers true only for it. */
  clicked?: boolean;
};
export type FakeResponse = { url: string; method?: string; status: number; body?: string };
export type FakePageModel = {
  url?: string; status?: number; title?: string; notice?: string | (() => string); feed?: string; lang?: string;
  /** What the text box shows after the text went in; default: exactly the text typed. */
  typedShows?: string;
  /** Elements by locator key (fakeKey): each entry is one element the locator matches. */
  elements?: Record<string, FakeElement[]>;
  /** What changes once the post button is clicked: the confirm element, the title, the notice. */
  afterClick?: { title?: string; notice?: string; elements?: Record<string, FakeElement[]> };
  /** The platform's own responses, sent right after the click. */
  responses?: FakeResponse[];
  /** What the pick overlay answers when the owner clicks an element; null when they do not. */
  pick?: Record<string, unknown> | null;
  /** Elements on the page that only the owner's pick knows how to find (the shipped candidates do not). */
  picked?: Record<string, FakeElement[]>;
  failFill?: boolean;
};

/** The locator key the fake page uses for a candidate's locator; candidateKey adds the language. */
export function fakeKey(candidate: { kind: string; value: string; name?: string }): string {
  return candidate.kind === 'role' && candidate.name ? `role:${candidate.value}[name=${candidate.name}]` : `${candidate.kind}:${candidate.value}`;
}

export function el(facts: Partial<ElementFacts> = {}, rest: Omit<FakeElement, 'facts'> = {}): FakeElement {
  return {
    facts: { tag: 'div', type: null, role: null, autocomplete: null, inForm: false, href: null, download: false, formAction: null, contentEditable: false, ...facts },
    box: { x: 10, y: 10, width: 80, height: 30 }, ...rest,
  };
}
export const BOX_ELEMENT = (rest: Omit<FakeElement, 'facts'> = {}) => el({ contentEditable: true, role: 'textbox' }, rest);
export const BUTTON = (rest: Omit<FakeElement, 'facts'> = {}) => el({ tag: 'button', type: 'button', role: 'button' }, { text: 'Post', ...rest });

/** X's compose page as the shipped steps know it: the text box and the post button; the toast after the click. */
export const X_PAGE: FakePageModel = {
  url: 'https://x.com/compose/post', lang: 'en',
  elements: { 'test-id:tweetTextarea_0': [BOX_ELEMENT()], 'test-id:tweetButton': [BUTTON()] },
  afterClick: { elements: { 'test-id:toast': [el({}, { text: 'Your post was sent.' })] } },
};
const LINKEDIN_BOX = 'xpath://div[@role="textbox"][@contenteditable="true"]';
const LINKEDIN_BUTTON = 'xpath://button[contains(concat(" ", normalize-space(@class), " "), " share-actions__primary-action ")]';
/** LinkedIn's share box as the shipped steps know it. */
export const LINKEDIN_PAGE: FakePageModel = {
  url: 'https://www.linkedin.com/feed/?shareActive=true', lang: 'en',
  elements: { [LINKEDIN_BOX]: [BOX_ELEMENT()], [LINKEDIN_BUTTON]: [BUTTON()] },
  afterClick: { elements: { 'role:alert': [el({ role: 'alert' }, { text: 'Post successful. View post' })] } },
};
export const LINKEDIN_KEYS = { box: LINKEDIN_BOX, button: LINKEDIN_BUTTON };

/** An in-memory stand-in for the files beside the profile folders, and a clock. */
export function holdDisk(start = Date.parse('2026-10-21T10:00:00.000Z')) {
  const files = new Map<string, string>();
  let now = start;
  return {
    files, advance: (ms: number) => { now += ms; },
    options: { holdFiles: { read: (path: string) => files.get(path.replaceAll('\\', '/')) ?? null, write: (path: string, text: string) => { files.set(path.replaceAll('\\', '/'), text); } }, now: () => now },
  };
}

function value<T>(item: T | (() => T)): T {
  return typeof item === 'function' ? (item as () => T)() : item;
}

/** A fake Playwright module whose every launch opens the same fake page, and the real port driven against it. */
export function fakeBrowserPage(model: FakePageModel = X_PAGE, options: { disk?: ReturnType<typeof holdDisk>; exePresent?: boolean; fileAudit?: boolean } = {}) {
  const disk = options.disk ?? holdDisk();
  const calls: string[] = [];
  const audit: string[] = [];
  const launches: { dir: string; options: Record<string, unknown> }[] = [];
  let clicked = false;
  let launched = 0;
  let closed = 0;
  let evaluated = 0;
  const typed = new Map<string, string>();
  const waiting: { match: (response: unknown) => boolean; resolve: (response: unknown) => void }[] = [];

  const elementsOf = (key: string): FakeElement[] => [
    ...(model.elements?.[key] ?? []),
    ...(clicked ? model.afterClick?.elements?.[key] ?? [] : []),
    ...(model.picked?.[key] ?? []),
  ];
  const responseOf = (item: FakeResponse) => ({
    url: () => item.url, status: () => item.status, request: () => ({ method: () => item.method ?? 'POST' }), text: async () => item.body ?? '',
  });

  function element(key: string, index: number) {
    const item = () => elementsOf(key)[index];
    const self = {
      first() { return self; },
      nth() { return self; },
      async count() { return item() ? 1 : 0; },
      async isVisible() { return item()?.visible !== false; },
      async boundingBox() {
        const found = item();
        if (found?.slowMs) await new Promise(resolve => { setTimeout(resolve, found.slowMs); });
        return found ? value(found.box ?? null) : null;
      },
      async textContent() { const found = item(); return found ? typed.get(key) ?? value(found.text ?? '') : null; },
      async evaluate(fn: unknown, arg?: unknown) {
        evaluated += 1;
        const found = item();
        if (fn === READ_ELEMENT) { if (!found?.facts || found.facts === 'unreadable') throw new Error('detached'); return found.facts; }
        if (fn === LINKS_IN) return found?.links ?? [];
        if (fn === IS_PICKED) return typeof arg === 'string' && found?.clicked === true;
        throw new Error('unknown element script');
      },
      async fill(text: string) {
        calls.push(`fill ${key} ${text}`);
        if (model.failFill) throw new Error('no textbox');
        typed.set(key, model.typedShows ?? text);
      },
      async click() {
        calls.push(`click ${key}`);
        clicked = true;
        for (const response of model.responses ?? []) {
          const answer = responseOf(response);
          for (const wait of waiting.splice(0)) { if (wait.match(answer)) wait.resolve(answer); else waiting.push(wait); }
        }
      },
      async waitFor() { calls.push(`wait ${key}`); },
    };
    return self;
  }

  function locatorFor(key: string) {
    return {
      first() { return element(key, 0); },
      nth(index: number) { return element(key, index); },
      async count() { return elementsOf(key).length; },
      async isVisible() { return elementsOf(key).some(item => item.visible !== false); },
    };
  }

  const page = {
    async goto(url: string) { calls.push(`goto ${url}`); return { status: () => model.status ?? 200 }; },
    url: () => model.url ?? 'https://x.com/compose/post',
    async title() { return clicked && model.afterClick?.title !== undefined ? model.afterClick.title : model.title ?? 'Home / X'; },
    async evaluate(fn: unknown, arg?: unknown) {
      evaluated += 1;
      if (fn === PAGE_NOTICE) return clicked && model.afterClick?.notice !== undefined ? model.afterClick.notice : value(model.notice ?? '');
      if (fn === PAGE_LANG) return model.lang ?? 'en';
      if (fn === PICK_ELEMENT) { calls.push(`pick ${String((arg as { step?: string })?.step ?? '')}`); return model.pick ?? null; }
      if (fn === UNMARK_PICK) { calls.push('unmark'); return null; }
      // Anything else the page holds is feed text: never a platform signal.
      return model.feed ?? 'What is happening?!';
    },
    getByTestId(id: string) { return locatorFor(`test-id:${id}`); },
    getByRole(role: string, opts: { name?: string } = {}) { return locatorFor(opts.name ? `role:${role}[name=${opts.name}]` : `role:${role}`); },
    locator(selector: string) {
      if (selector.startsWith('xpath=')) return locatorFor(`xpath:${selector.slice(6)}`);
      const label = /^\[aria-label=("(?:[^"\\]|\\.)*")\]$/.exec(selector);
      if (label) return locatorFor(`aria-label:${JSON.parse(label[1])}`);
      return locatorFor(`css:${selector}`);
    },
    waitForResponse(match: (response: unknown) => boolean, opts: { timeout?: number } = {}) {
      return new Promise((resolve, reject) => {
        waiting.push({ match, resolve });
        setTimeout(() => reject(new Error('Timeout waiting for response')), opts.timeout ?? 30000).unref?.();
      });
    },
  };
  const module: PlaywrightLike = {
    chromium: {
      executablePath: () => 'C:/fake/chromium/chrome.exe',
      async launchPersistentContext(dir: string, launchOptions: Record<string, unknown>) {
        launched += 1;
        launches.push({ dir, options: launchOptions });
        clicked = false;
        typed.clear();
        return { pages: () => [page], newPage: async () => page, close: async () => { closed += 1; } } as never;
      },
    },
  };
  const port = playwrightBrowserPort({
    load: async () => module, exists: () => options.exePresent !== false, profileRoot: 'C:/profiles', ...disk.options,
    ...(options.fileAudit ? {} : { audit: (line: string) => { audit.push(line); } }),
  });
  return {
    port, calls, audit, launches, disk, page,
    launched: () => launched, closedCount: () => closed, evaluated: () => evaluated,
    clicks: () => calls.filter(call => call.startsWith('click')).length,
    post: (text = 'Hello', connectorId = model.url?.includes('linkedin') ? 'linkedin' : 'x', timeoutMs = 300, extra: { clickBy?: number } = {}) => port.post({ postId: 'post_1', connectorId, text, timeoutMs, ...extra }),
  };
}
