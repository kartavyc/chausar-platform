// Chausar venture launcher, web (wave 6, package 6F3, DECISIONS D32): reading a public page on this computer. The AI
// tool's own web search and page reading come first (driver settings); this is Chausar's own reader, for Chausar's own
// lookups (Before you write, a network search's outside pages) and anything else that reads a page by itself.
// - Every request goes through the same polite fetcher the SEO source checks, monitors and job capture use
//   (build/fetch-policy.ts): the network guard, the terms-barred list, robots.txt, Chausar's own honest name, one request
//   per site every few seconds, and a full stop at a CAPTCHA. No proxy, no disguise, no retry.
// - The page's main text is kept with Mozilla's Readability (Apache-2.0, the reader view of Firefox), run on a clean
//   copy of the page made with parse5: scripts, styles, frames and comments never reach it. The text is screened as
//   untrusted words (policy/untrusted.ts, enforce): a page with words aimed at the AI is held and gives nothing.
// - A page that needs JavaScript is opened only in the desktop's hidden Electron window (a render port the desktop host
//   composes, app/desktop/web-render.cjs), at the same pace; elsewhere the read says so.
// - A page read is kept for half an hour in memory, so a second look sends nothing. Nothing is written to disk.
// - crawlSite reads a few pages of one site (at most ten, two links deep), its own links only, and stops the whole
//   crawl at a CAPTCHA or a site's request to slow down. Crawlee's BasicCrawler (@crawlee/basic, Apache-2.0) holds the
//   queue and readPage reads each page: no got-scraping, header or fingerprint generator, proxy or session pool.
// Fetched text is data, never instructions; callers keep the label "From a public page, not confirmed".
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse, parseFragment } from 'parse5';
import { ChausarError, check } from '../../contracts.ts';
import { pinnedSend } from '../core/net-guard.ts';
import { checkFetchPolicy, noteAnswer, paceSite, politeFetch, robotsSafe, type PoliteNet } from '../build/fetch-policy.ts';
import { screenUntrusted } from '../policy/untrusted.ts';
import { PAGE_LABEL } from './search-data.ts';

const require = createRequire(import.meta.url);
const { Readability } = require('@mozilla/readability') as { Readability: new (doc: unknown, options?: Record<string, unknown>) => { parse(): ReadabilityArticle | null } };
const JSDOMParser = require('@mozilla/readability/JSDOMParser.js') as new () => { parse(html: string, url?: string): unknown };
type ReadabilityArticle = { title?: string | null; byline?: string | null; content?: string | null; textContent?: string | null; siteName?: string | null; lang?: string | null };

export const READER_WORDS = Object.freeze({
  label: PAGE_LABEL,
  held: 'This page had words aimed at the AI, so nothing from it was kept.',
  javascript: 'This page needs JavaScript. Chausar opens such pages only in the desktop app.',
  empty: 'This page has no text Chausar can read.',
  failed: 'The site did not give this page, so nothing was read.',
});

/** The most of a page read, in bytes, and the most text kept from one, in characters. */
export const PAGE_LIMITS = Object.freeze({ bytes: 2 * 1024 * 1024, chars: 100_000, timeoutMs: 20_000, renderMs: 30_000 });
/** Fewer words than this on a page with scripts means it is drawn by JavaScript. */
const JS_WORDS = 30;

export type PageReading = {
  url: string; title: string | null; byline: string | null; siteName: string | null; lang: string | null;
  text: string; words: number; via: 'page' | 'javascript'; cached: boolean; label: string;
};
/** The desktop's hidden window: opens one page with JavaScript and gives back its HTML. Desktop only. */
export type PageRenderPort = { render(request: { url: string; timeoutMs: number }): Promise<{ ok: true; html: string; finalUrl: string } | { ok: false; reason: 'refused' | 'failed' | 'timeout' }> };
export type ReaderOptions = { net?: PoliteNet; render?: PageRenderPort; javascript?: 'auto' | 'never'; cache?: PageCache | null };

// ---------------------------------------------------------------------------
// The cache
// ---------------------------------------------------------------------------

type Kept = { reading: PageReading; links: string[] };
export type PageCache = { get(url: string): Kept | null; set(url: string, kept: Kept): void };
/** Pages kept in memory for half an hour, at most 64 of them, oldest out first. */
export function createPageCache(options: { now?: () => number; ttlMs?: number; size?: number } = {}): PageCache {
  const now = options.now ?? (() => Date.now()), ttl = options.ttlMs ?? 30 * 60 * 1000, size = options.size ?? 64;
  const kept = new Map<string, { at: number; item: Kept }>();
  return {
    get(url) {
      const item = kept.get(url);
      if (!item) return null;
      if (now() - item.at >= ttl) { kept.delete(url); return null; }
      return item.item;
    },
    set(url, item) {
      kept.delete(url);
      kept.set(url, { at: now(), item });
      while (kept.size > size) kept.delete(kept.keys().next().value!);
    },
  };
}
/** The cache for the real network, shared by every reader in this process. Injected senders get none unless given one. */
const SHARED_CACHE = createPageCache();

// ---------------------------------------------------------------------------
// Readable text
// ---------------------------------------------------------------------------

type Node = { nodeName: string; tagName?: string; attrs?: { name: string; value: string }[]; childNodes?: Node[]; value?: string; content?: Node };
const DROPPED = new Set(['script', 'style', 'noscript', 'template', 'iframe', 'frame', 'frameset', 'object', 'embed', 'svg', 'math', 'canvas', 'audio', 'video']);
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const BLOCKS = new Set(['p', 'div', 'li', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'table', 'section', 'article', 'header', 'footer', 'blockquote', 'pre', 'dd', 'dt', 'dl', 'figcaption', 'figure', 'aside', 'main', 'br', 'hr']);
const MAX_DEPTH = 400;
const escText = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (text: string) => escText(text).replace(/"/g, '&quot;');

/** A well-formed copy of a parsed page (the minimal parser Readability ships needs closed tags), dropped parts left out. */
function wellFormed(node: Node, depth = 0): string {
  if (depth > MAX_DEPTH) return '';
  if (node.nodeName === '#text') return escText(node.value ?? '');
  if (node.nodeName === '#comment' || node.nodeName === '#documentType') return '';
  const inner = () => (node.childNodes ?? []).map(child => wellFormed(child, depth + 1)).join('');
  if (!node.tagName) return inner();
  const name = node.tagName.toLowerCase();
  if (DROPPED.has(name)) return '';
  if (!/^[a-z][a-z0-9-]*$/.test(name)) return inner();
  const attrs = (node.attrs ?? []).filter(attr => /^[a-zA-Z_:][-a-zA-Z0-9_:.]*$/.test(attr.name) && !/^on/i.test(attr.name)).map(attr => ` ${attr.name}="${escAttr(attr.value)}"`).join('');
  return VOID.has(name) ? `<${name}${attrs}/>` : `<${name}${attrs}>${inner()}</${name}>`;
}

/** The words of a parsed tree: whitespace folded inside text, a line break at each block, dropped parts left out. */
function wordsOf(node: Node, out: string[] = [], depth = 0): string[] {
  if (depth > MAX_DEPTH) return out;
  if (node.nodeName === '#text') { out.push((node.value ?? '').replace(/\s+/g, ' ')); return out; }
  const name = node.tagName?.toLowerCase();
  if (name && DROPPED.has(name)) return out;
  if (name === 'title' || name === 'head') return out;
  for (const child of node.childNodes ?? []) wordsOf(child, out, depth + 1);
  if (name && BLOCKS.has(name)) out.push('\n');
  return out;
}
const tidy = (parts: string[]) => parts.join('').split('\n').map(line => line.replace(/[ \t ]+/g, ' ').trim()).filter(Boolean).join('\n');

function find(node: Node, test: (node: Node) => boolean, depth = 0): Node | null {
  if (depth > MAX_DEPTH) return null;
  if (test(node)) return node;
  for (const child of node.childNodes ?? []) { const found = find(child, test, depth + 1); if (found) return found; }
  return null;
}
function each(node: Node, visit: (node: Node) => void, depth = 0): void {
  if (depth > MAX_DEPTH) return;
  visit(node);
  for (const child of node.childNodes ?? []) each(child, visit, depth + 1);
}
const attr = (node: Node, name: string) => node.attrs?.find(item => item.name === name)?.value ?? null;

/** The page's own links, as full http or https addresses without their #part, each once, in page order. */
function linksOf(tree: Node, base: string): string[] {
  const seen = new Set<string>(), links: string[] = [];
  each(tree, node => {
    if (node.tagName?.toLowerCase() !== 'a' || links.length >= 200) return;
    const href = attr(node, 'href');
    if (!href) return;
    try {
      const url = new URL(href, base);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
      url.hash = '';
      if (!seen.has(url.href)) { seen.add(url.href); links.push(url.href); }
    } catch { /* not an address */ }
  });
  return links;
}

export type Readable = { title: string | null; byline: string | null; siteName: string | null; lang: string | null; text: string; links: string[] };

/** A page's main text with Readability, else all its words; its title, byline, site name and language; and its links. */
export function readable(html: string, url: string): Readable {
  const tree = parse(html.slice(0, PAGE_LIMITS.bytes)) as unknown as Node;
  const titleNode = find(tree, node => node.tagName?.toLowerCase() === 'title');
  const pageTitle = titleNode ? tidy(wordsOf({ nodeName: 'div', childNodes: titleNode.childNodes })) : '';
  const htmlNode = find(tree, node => node.tagName?.toLowerCase() === 'html');
  let article: ReadabilityArticle | null = null;
  try {
    const doc = new JSDOMParser().parse(wellFormed(tree), url);
    article = new Readability(doc, { charThreshold: 200 }).parse();
  } catch { article = null; }
  let text = article?.content ? tidy(wordsOf(parseFragment(article.content) as unknown as Node)) : '';
  if (!text) text = tidy(wordsOf(tree));
  const clean = (value: string | null | undefined) => { const trimmed = (value ?? '').replace(/\s+/g, ' ').trim(); return trimmed ? trimmed.slice(0, 300) : null; };
  return {
    title: clean(pageTitle) ?? clean(article?.title), byline: clean(article?.byline), siteName: clean(article?.siteName),
    lang: clean(article?.lang) ?? clean(htmlNode ? attr(htmlNode, 'lang') : null), text: text.slice(0, PAGE_LIMITS.chars), links: linksOf(tree, url),
  };
}

// ---------------------------------------------------------------------------
// Reading a page
// ---------------------------------------------------------------------------

const wordCount = (text: string) => (text.match(/\S+/g) ?? []).length;
const needsJavaScript = (html: string, page: Readable) => wordCount(page.text) < JS_WORDS && /<script\b/i.test(html);

function screened(page: Readable): string {
  const result = screenUntrusted({ source: 'web-page', text: page.text }, { mode: 'enforce' });
  if (result.text === null) throw new ChausarError('PAGE_HELD', READER_WORDS.held);
  return result.text;
}

/** One page read, with its links for a crawl. */
async function readOne(raw: string, options: ReaderOptions): Promise<{ reading: PageReading; links: string[] }> {
  const asked = checkFetchPolicy(raw);
  asked.hash = '';
  const net = options.net ?? {};
  const cache = options.cache === undefined ? (net.send ? null : SHARED_CACHE) : options.cache;
  const kept = cache?.get(asked.href);
  if (kept) return { reading: { ...kept.reading, cached: true }, links: kept.links };
  const send = net.send ?? pinnedSend;
  const answer = await politeFetch({ url: asked.href, headers: { accept: 'text/html, text/plain' }, maxBytes: PAGE_LIMITS.bytes, maxRedirects: 3, timeoutMs: PAGE_LIMITS.timeoutMs }, { resolve: net.resolve, send: robotsSafe(send, net.resolve) });
  if (answer.status < 200 || answer.status > 299) throw new ChausarError('PAGE_NOT_READABLE', READER_WORDS.failed);
  const type = (answer.headers['content-type'] ?? 'text/html').toLowerCase();
  const finalUrl = answer.url || asked.href;
  let page: Readable, via: PageReading['via'] = 'page';
  if (type.includes('text/plain')) page = { title: null, byline: null, siteName: null, lang: null, text: answer.body.toString('utf8').slice(0, PAGE_LIMITS.chars).replace(/\r\n/g, '\n').trim(), links: [] };
  else if (type.includes('text/html') || type.includes('application/xhtml')) {
    const html = answer.body.toString('utf8');
    page = readable(html, finalUrl);
    if (needsJavaScript(html, page)) {
      if (!options.render || options.javascript === 'never') throw new ChausarError('PAGE_NEEDS_JAVASCRIPT', READER_WORDS.javascript);
      const url = new URL(finalUrl);
      const timeoutMs = await paceSite(send, url, PAGE_LIMITS.renderMs);
      const rendered = await options.render.render({ url: url.href, timeoutMs });
      if (!rendered.ok) throw new ChausarError('PAGE_NOT_READABLE', READER_WORDS.failed);
      const landed = checkFetchPolicy(rendered.finalUrl);
      noteAnswer(send, landed, { status: 200, headers: {}, body: rendered.html });
      page = readable(rendered.html, landed.href);
      via = 'javascript';
    }
  } else throw new ChausarError('PAGE_NOT_READABLE', READER_WORDS.empty);
  if (!page.text) throw new ChausarError('PAGE_NOT_READABLE', READER_WORDS.empty);
  const text = screened(page);
  const reading: PageReading = { url: finalUrl, title: page.title, byline: page.byline, siteName: page.siteName, lang: page.lang, text, words: wordCount(text), via, cached: false, label: READER_WORDS.label };
  cache?.set(asked.href, { reading, links: page.links });
  return { reading, links: page.links };
}

/** Reads one public page as above. Throws in plain words when it may not or cannot be read. */
export async function readPage(raw: string, options: ReaderOptions = {}): Promise<PageReading> {
  return (await readOne(raw, options)).reading;
}

// ---------------------------------------------------------------------------
// A small crawl of one site
// ---------------------------------------------------------------------------

export const CRAWL_LIMITS = Object.freeze({ maxPages: 10, maxDepth: 2 });
export type CrawlResult = { pages: PageReading[]; skipped: { url: string; code: string }[]; stopped: 'CAPTCHA_STOP' | 'SITE_PAUSED' | null };

/**
 * How Crawlee's BasicCrawler is set up (founder decision, 2 November 2026: small crawls use Crawlee, the honest way).
 * It is only the queue: one page at a time, never retried, no session pool (so no session or cookie rotation), no
 * robots.txt fetch or delay of its own (the polite reader does both), and long enough for a paced read to finish.
 * BasicCrawler has no proxy setting, and no got-scraping client is ever given to it (REFUSING_CLIENT below).
 */
export const CRAWLER_SETTINGS = Object.freeze({ minConcurrency: 1, maxConcurrency: 1, maxRequestRetries: 0, useSessionPool: false, respectRobotsTxtFile: false, sameDomainDelaySecs: 0, requestHandlerTimeoutSecs: 300 });
const CRAWL_REFUSED = 'A crawl reads pages only through Chausar\'s own polite reader.';
/** In place of Crawlee's default got-scraping client (generated browser headers): every call is refused. */
const REFUSING_CLIENT = Object.freeze({
  async sendRequest(): Promise<never> { throw new ChausarError('FETCH_POLICY_REFUSED', CRAWL_REFUSED); },
  async stream(): Promise<never> { throw new ChausarError('FETCH_POLICY_REFUSED', CRAWL_REFUSED); },
});

/**
 * Reads up to maxPages pages (at most ten) of the start page's own site, following its own links breadth first up to
 * maxDepth links deep (at most two). A page that may not or cannot be read is skipped with its reason; a CAPTCHA or a
 * request to slow down stops the whole crawl at once. Each page goes through readPage, so the pace and cache hold.
 * Crawlee's BasicCrawler holds the queue (CRAWLER_SETTINGS). Its storage stays in memory, pointed at a new temporary
 * folder that is removed afterwards, so nothing is kept on disk or carried from one crawl to the next; its own log is
 * silent. Crawlee is loaded only when a crawl starts.
 */
export async function crawlSite(start: string, options: ReaderOptions & { maxPages?: number; maxDepth?: number } = {}): Promise<CrawlResult> {
  const maxPages = options.maxPages ?? 5, maxDepth = options.maxDepth ?? 1;
  check(Number.isInteger(maxPages) && maxPages >= 1 && maxPages <= CRAWL_LIMITS.maxPages, 'INVALID_VENTURE_REQUEST', `Read at most ${CRAWL_LIMITS.maxPages} pages of one site.`);
  check(Number.isInteger(maxDepth) && maxDepth >= 0 && maxDepth <= CRAWL_LIMITS.maxDepth, 'INVALID_VENTURE_REQUEST', `Follow links at most ${CRAWL_LIMITS.maxDepth} steps from the first page.`);
  const first = checkFetchPolicy(start);
  first.hash = '';
  const origin = first.origin;
  const result: CrawlResult = { pages: [], skipped: [], stopped: null };
  const seen = new Set([first.href]);
  const { BasicCrawler, Configuration, EventManager, log, LogLevel } = await import('@crawlee/basic');
  const folder = await mkdtemp(join(tmpdir(), 'chausar-crawl-'));
  try {
    // Explicit storage options win over any CRAWLEE_ setting in the environment: in memory, in the temporary folder.
    // A set memory ceiling and a plain event manager: otherwise Crawlee starts a process listing (PowerShell or ps) to
    // measure memory at the start and every second after. One page at a time needs no autoscaling.
    const config = new Configuration({ purgeOnStart: false, persistStorage: false, memoryMbytes: 1024, containerized: false, storageClientOptions: { localDataDirectory: folder, persistStorage: false, writeMetadata: false } });
    config.useEventManager(new (class QuietEvents extends EventManager {})(config));
    type Step = { href: string; depth: number };
    const crawler = new BasicCrawler({
      ...CRAWLER_SETTINGS,
      httpClient: REFUSING_CLIENT as never,
      log: log.child({ prefix: 'Chausar crawl', level: LogLevel.OFF }),
      requestHandler: async ({ request }) => {
        if (result.stopped || result.pages.length >= maxPages) return;
        const step = request.userData as Step;
        let read: { reading: PageReading; links: string[] };
        try { read = await readOne(step.href, options); } catch (error) {
          const code = (error as { code?: string }).code ?? 'PAGE_NOT_READABLE';
          if (code === 'CAPTCHA_STOP' || code === 'SITE_PAUSED') { result.stopped = code; crawler.stop(); return; }
          result.skipped.push({ url: step.href, code });
          return;
        }
        result.pages.push(read.reading);
        if (result.pages.length >= maxPages) { crawler.stop(); return; }
        if (step.depth >= maxDepth) return;
        const next: { url: string; uniqueKey: string; userData: Step }[] = [];
        for (const link of read.links) {
          if (new URL(link).origin !== origin || seen.has(link)) continue;
          seen.add(link);
          next.push({ url: link, uniqueKey: link, userData: { href: link, depth: step.depth + 1 } });
        }
        if (next.length) await crawler.addRequests(next);
      },
      // Only reached if a read outlasts the handler's time limit; it is skipped like any page that gave nothing.
      failedRequestHandler: async ({ request }) => { result.skipped.push({ url: (request.userData as Step).href, code: 'PAGE_NOT_READABLE' }); },
    }, config);
    await crawler.run([{ url: first.href, uniqueKey: first.href, userData: { href: first.href, depth: 0 } }]);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
  return result;
}
