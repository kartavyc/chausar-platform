// Chausar connectors: page monitors (Ink v2 wave 5, package 5A6, catalogue K16). The owner asks Chausar to watch a
// public page for any change, for a text to appear, or for a price to fall below their figure. Adding one is a standing
// check, so it is on the always-ask floor (H12): approve, inside the app, never on the hosted app (it sleeps while
// nobody has it open, so it could not keep the promise). The address passes the network guard (nothing inside this
// computer or its network) and the fetch policy (no site whose terms bar automated reading), and robots.txt must let
// Chausar read the page. Keeper's 'monitors' job (checkMonitorsDue, from the journal sweep's tick) reads each due page
// as Chausar: the first check keeps a seed and alerts nothing; a later change alerts once, as a notice row on Today; an
// error backs off 1, 2, 4, 8, 16 then 24 hours; one site is read at most once an hour, the page never read first going
// first. A price is read only from the element the owner picked and parsed by code into paise; no model reads a page.
// The seed-then-diff watcher, with its last value, hash and backoff, follows OpenMuse's Monitor (packages/domain/src/
// agent.ts) and JobFinderOS's --seed poll, both reusable by licence; this is written for Chausar, not copied.
import { createHash } from 'node:crypto';
import { check, ChausarError, type Context, type State } from '../../contracts.ts';
import type { KeeperRunRecord, MonitorRecord, VentureDeps, VentureRecord } from '../contracts.ts';
import { currentVenture, exactPayload, identifier, listRecords, readVenture, requireAppChannel, singleLine, ventureAction, type VentureTx } from '../records.ts';
import { resolvePublic, signedIn } from '../core/net-guard.ts';
import { pageWords } from '../network/research.ts';
import type { W4RowItem } from '../views/queue-w4.ts';
import { checkFetchPolicy, politeFetch, robotsCheck, FETCH_POLICY_WORDS } from './fetch-policy.ts';
import type { MonitorBody, MonitorInput, MonitorKind, MonitorsView, MonitorView } from './records-connect.ts';

const HOUR = 3_600_000;
/** How often a monitor looks, and how long one site waits between reads, whichever monitor reads it. */
export const MONITOR_EVERY_MS = HOUR;
/** The most monitors a business keeps at once, and the most of one page Chausar reads. */
export const MAX_MONITORS = 20;
export const PAGE_BYTES = 1024 * 1024;
/** One tick's budget: at most this many pages, and no new look once this much time has gone. */
export const MONITOR_TICK_LOOKS = 5;
export const MONITOR_TICK_MS = 45_000;
const MAX_ALERTS = 20;
/** Hours an error waits, by errors in a row: 1, 2, 4, 8, 16, then 24 for good. */
export const backoffHours = (failures: number) => Math.min(2 ** Math.max(0, failures - 1), 24);

export const MONITOR_WORDS = Object.freeze({
  added: 'Watching. The first look keeps what the page says now; Chausar tells you when it changes.',
  seeded: 'First look kept. Chausar tells you when this changes.',
  same: 'Looked again. Nothing changed.',
  removed: 'No longer watched. Chausar will not read this page again.',
  hosted: 'Page watching runs in the desktop app, which keeps checking while it is open.',
  limit: `You watch ${MAX_MONITORS} pages already. Stop watching one first.`,
  noPrice: 'The price could not be read from the part of the page you picked.',
  signedIn: 'This address carries a key or a sign-in. Watch a public page instead.',
});

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const fold = (text: string) => text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------
// Reading a page: the owner's picked element, and a price in paise
// ---------------------------------------------------------------------------

type Simple = { tag: string | null; id: string | null; classes: string[]; attrs: [string, string | null][] };

/** One simple selector: a tag, an #id, .classes and [attr] or [attr=value], such as span.price or meta[itemprop=price]. */
function parseSelector(selector: string): Simple | null {
  const match = /^([a-zA-Z][a-zA-Z0-9-]*)?((?:#[A-Za-z0-9_-]+|\.[A-Za-z0-9_-]+|\[[a-zA-Z0-9_:-]+(?:=(?:"[^"]*"|'[^']*'|[^\]]*))?\])*)$/.exec(selector.trim());
  if (!match || !selector.trim()) return null;
  const parts = match[2].match(/#[A-Za-z0-9_-]+|\.[A-Za-z0-9_-]+|\[[^\]]+\]/g) ?? [];
  const out: Simple = { tag: match[1]?.toLowerCase() ?? null, id: null, classes: [], attrs: [] };
  for (const part of parts) {
    if (part[0] === '#') out.id = part.slice(1);
    else if (part[0] === '.') out.classes.push(part.slice(1));
    else {
      const [name, ...rest] = part.slice(1, -1).split('=');
      out.attrs.push([name.toLowerCase(), rest.length ? rest.join('=').replace(/^["']|["']$/g, '') : null]);
    }
  }
  return out;
}

/** The attributes of one start tag's text, by lower-case name. */
function attributesOf(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of text.matchAll(/([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    out.set(match[1].toLowerCase(), match[3] ?? match[4] ?? match[5] ?? '');
  }
  return out;
}

/**
 * The text of the first element a simple selector picks, or null: a meta tag's content, else the element's words up to
 * its closing tag. Read by code from the page; a selector Chausar cannot read picks nothing.
 */
export function selectText(html: string, selector: string): string | null {
  const wanted = parseSelector(selector);
  if (!wanted) return null;
  for (const match of html.matchAll(/<([a-zA-Z][a-zA-Z0-9-]*)(\s[^<>]*)?>/g)) {
    const tag = match[1].toLowerCase();
    const attrs = attributesOf(match[2] ?? '');
    if (wanted.tag && wanted.tag !== tag) continue;
    if (wanted.id && attrs.get('id') !== wanted.id) continue;
    const classes = (attrs.get('class') ?? '').split(/\s+/);
    if (!wanted.classes.every(name => classes.includes(name))) continue;
    if (!wanted.attrs.every(([name, value]) => attrs.has(name) && (value === null || attrs.get(name) === value))) continue;
    if (tag === 'meta') return (attrs.get('content') ?? '').trim() || null;
    const start = (match.index ?? 0) + match[0].length;
    const end = html.toLowerCase().indexOf(`</${tag}`, start);
    const words = pageWords(html.slice(start, end < 0 ? start : end)).replace(/\s+/g, ' ').trim();
    return words || null;
  }
  return null;
}

/** A price as minor units (paise) by code: the first amount, with or without ₹, Rs or INR, Indian or Western commas. */
export function parsePricePaise(text: string): string | null {
  const match = /(?:₹|rs\.?|inr)?\s*(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.(\d{1,2}))?/i.exec(text);
  if (!match) return null;
  const whole = match[1].replace(/,/g, '');
  if (whole.length > 13) return null;
  return String(BigInt(whole) * 100n + BigInt((match[2] ?? '').padEnd(2, '0') || '0'));
}

// ---------------------------------------------------------------------------
// The methods
// ---------------------------------------------------------------------------

function view(record: MonitorRecord): MonitorView {
  return {
    id: record.id, url: record.url, host: record.host, kind: record.watch, line: record.line, lastCheckedAt: record.lastCheckedAt,
    nextCheckAt: record.removedAt ? null : record.nextCheckAt, alert: record.alerts.at(-1) ?? null, failing: record.failures > 0, removed: record.removedAt !== null,
  };
}

const active = (state: State, ventureId: string) => listRecords(state, 'venture-monitor', ventureId).filter(record => record.removedAt === null);

/** venture.monitors.list {} (read): the pages watched now, newest first. */
export async function monitorsList(deps: VentureDeps, ctx: Context, payload: unknown): Promise<MonitorsView> {
  exactPayload(payload ?? {}, []);
  const { state, venture } = readVenture(deps, ctx);
  const records = active(state, venture.id).reverse();
  const hosted = deps.host === 'hosted-web';
  const line = hosted ? MONITOR_WORDS.hosted : records.length ? `Watching ${records.length} ${records.length === 1 ? 'page' : 'pages'}.` : 'No pages watched.';
  return { monitors: records.map(view), line, hosted };
}

/** What the owner asked to watch, checked: the address, what for, and the element or figure it needs. */
function inputOf(payload: unknown): { url: URL; kind: MonitorKind; text: string | null; selector: string | null; belowMinor: string | null } {
  const body = exactPayload(payload, ['url', 'kind', 'text', 'selector', 'belowMinor'], ['url', 'kind']) as Partial<Record<keyof MonitorInput, unknown>>;
  check(typeof body.url === 'string' && body.url.length <= 2000, 'INVALID_VENTURE_REQUEST', 'Give the page\'s web address.');
  check(body.kind === 'change' || body.kind === 'contains' || body.kind === 'price-below', 'INVALID_VENTURE_REQUEST', 'Watch for a change, a text, or a price below your figure.');
  const url = checkFetchPolicy(body.url);
  check(!signedIn({}, url), 'INVALID_VENTURE_REQUEST', MONITOR_WORDS.signedIn);
  const text = body.text === undefined || body.text === '' ? null : singleLine(body.text, 'The text to look for', { max: 200 });
  const selector = body.selector === undefined || body.selector === '' ? null : singleLine(body.selector, 'The part of the page', { max: 200 });
  if (selector !== null) check(parseSelector(selector), 'INVALID_VENTURE_REQUEST', 'Pick the part of the page as a tag, an #id or a .class.');
  check(body.kind !== 'contains' || text, 'INVALID_VENTURE_REQUEST', 'Say which words to look for.');
  let belowMinor: string | null = null;
  if (body.kind === 'price-below') {
    check(selector, 'INVALID_VENTURE_REQUEST', 'Pick the part of the page that shows the price.');
    check(typeof body.belowMinor === 'string' && /^[1-9]\d{0,14}$/.test(body.belowMinor), 'INVALID_AMOUNT', 'Give your figure as a whole amount in paise.');
    belowMinor = body.belowMinor as string;
  }
  return { url, kind: body.kind, text, selector, belowMinor };
}

/**
 * venture.monitors.add (approve, inside the app; a standing check, on the floor): checks the address (the guard, the
 * fetch policy, robots.txt) and keeps the monitor, due now; Keeper's first look keeps the seed.
 */
export async function monitorsAdd(deps: VentureDeps, ctx: Context, payload: unknown): Promise<MonitorView> {
  requireAppChannel(ctx, 'venture.monitors.add');
  const input = inputOf(payload);
  check(deps.host !== 'hosted-web', 'TIER_UNAVAILABLE', MONITOR_WORDS.hosted);
  readVenture(deps, ctx);
  await resolvePublic(input.url.hostname.replace(/\.$/, ''), deps.net?.resolve);
  const robots = await robotsCheck(input.url, deps.net ?? {});
  if (!robots.allowed) throw new ChausarError('ROBOTS_REFUSED', FETCH_POLICY_WORDS.robots);
  return ventureAction(deps, ctx, 'approve', 'monitors.add', tx => {
    check(active(tx.state, tx.venture!.id).length < MAX_MONITORS, 'MONITOR_LIMIT', MONITOR_WORDS.limit);
    const body: MonitorBody = {
      url: input.url.href, host: input.url.hostname.toLowerCase(), watch: input.kind, text: input.text, selector: input.selector, belowMinor: input.belowMinor,
      seeded: false, lastDigest: null, lastValue: null, lastCheckedAt: null, nextCheckAt: tx.now, failures: 0, lastError: null, alerts: [], removedAt: null,
      line: MONITOR_WORDS.added,
    };
    return view(tx.put<MonitorRecord>({ ...tx.base('venture-monitor'), ...body }));
  });
}

/** venture.monitors.remove { id } (approve, inside the app): the page is never read again. The record stays as history. */
export async function monitorsRemove(deps: VentureDeps, ctx: Context, payload: unknown): Promise<MonitorView> {
  requireAppChannel(ctx, 'venture.monitors.remove');
  const body = exactPayload(payload, ['id'], ['id']);
  const id = identifier(body.id, 'Monitor');
  return ventureAction(deps, ctx, 'approve', 'monitors.remove', tx => {
    const record = tx.find('venture-monitor', id);
    check(record && record.removedAt === null, 'MONITOR_NOT_FOUND', 'That page is not watched.');
    return view(tx.replace<MonitorRecord>({ ...record, removedAt: tx.now, line: MONITOR_WORDS.removed }));
  });
}

// ---------------------------------------------------------------------------
// Keeper's job
// ---------------------------------------------------------------------------

type Look = { ok: true; digest: string; value: string | null; alert: string | null } | { ok: false; error: string };

/** One look at a page as Chausar: robots.txt, then the page; what it says now, and the alert it raises, if any. */
async function look(deps: VentureDeps, record: MonitorRecord): Promise<Look> {
  try {
    const url = new URL(record.url);
    const robots = await robotsCheck(url, deps.net ?? {});
    if (!robots.allowed) return { ok: false, error: FETCH_POLICY_WORDS.robots };
    const answer = await politeFetch({ url: record.url, headers: { accept: 'text/html, text/plain' }, maxBytes: PAGE_BYTES, maxRedirects: 3 }, deps.net ?? {});
    if (answer.status < 200 || answer.status > 299) return { ok: false, error: `The page answered ${answer.status}.` };
    const html = answer.body.toString('utf8');
    const picked = record.selector ? selectText(html, record.selector) : pageWords(html).replace(/\s+/g, ' ').trim();
    if (record.watch === 'price-below') {
      const price = picked === null ? null : parsePricePaise(picked);
      if (price === null) return { ok: false, error: MONITOR_WORDS.noPrice };
      const below = BigInt(price) < BigInt(record.belowMinor!);
      const wasBelow = record.lastValue !== null && BigInt(record.lastValue) < BigInt(record.belowMinor!);
      return { ok: true, digest: sha(price), value: price, alert: record.seeded && below && !wasBelow ? `The price on ${record.host} fell below your figure.` : null };
    }
    const words = picked ?? '';
    if (record.watch === 'contains') {
      const found = fold(words).includes(fold(record.text!)) ? 'yes' : 'no';
      return { ok: true, digest: sha(found), value: found, alert: record.seeded && found === 'yes' && record.lastValue !== 'yes' ? `"${record.text}" appeared on ${record.host}.` : null };
    }
    const digest = sha(words);
    return { ok: true, digest, value: null, alert: record.seeded && digest !== record.lastDigest ? `The page you watch on ${record.host} changed.` : null };
  } catch (error) {
    return { ok: false, error: error instanceof Error && error.message ? error.message.replace(/\s+/g, ' ').slice(0, 200) : 'The page could not be read.' };
  }
}

/** What one look leaves on the record. */
function afterLook(record: MonitorRecord, result: Look, now: string): MonitorRecord {
  const nowMs = Date.parse(now);
  if (!result.ok) {
    const failures = record.failures + 1;
    return { ...record, lastCheckedAt: now, failures, lastError: result.error, nextCheckAt: new Date(nowMs + backoffHours(failures) * HOUR).toISOString(), line: `The last look did not work: ${result.error}` };
  }
  const alerts = result.alert ? [...record.alerts, { at: now, line: result.alert }].slice(-MAX_ALERTS) : record.alerts;
  const line = !record.seeded ? MONITOR_WORDS.seeded : result.alert ?? MONITOR_WORDS.same;
  return {
    ...record, seeded: true, lastDigest: result.digest, lastValue: result.value, lastCheckedAt: now, failures: 0, lastError: null,
    nextCheckAt: new Date(nowMs + MONITOR_EVERY_MS).toISOString(), alerts, line,
  };
}

/** Keeper's monitors run in place of its last one. */
function keeperRun(tx: VentureTx, outcome: KeeperRunRecord['outcome'], line: string): void {
  const old = tx.list('venture-keeper-run').find(record => record.job === 'monitors');
  const run: KeeperRunRecord = { ...tx.base('venture-keeper-run'), job: 'monitors', outcome, line };
  if (old) tx.replace<KeeperRunRecord>({ ...run, id: old.id }); else tx.put<KeeperRunRecord>(run);
  tx.emit('keeper.ran', { jobs: ['monitors'] });
}

/**
 * Keeper's monitors job, from the journal sweep's tick: each due page, one per site an hour (the one never read, or read
 * longest ago, first), read and written back in one commit. One tick has a budget (MONITOR_TICK_LOOKS pages and
 * MONITOR_TICK_MS of time), so the sweep's later jobs (money schedules, routines) are never held up; what is left stays
 * due for the next tick. Never on the hosted app. Never throws.
 */
export async function checkMonitorsDue(deps: VentureDeps, ctx: Context, budget: { looks?: number; budgetMs?: number } = {}): Promise<void> {
  const started = Date.now();
  const maxLooks = budget.looks ?? MONITOR_TICK_LOOKS;
  const maxMs = budget.budgetMs ?? MONITOR_TICK_MS;
  try {
    if (deps.host === 'hosted-web') return;
    const state = deps.store.read();
    const venture = currentVenture(state);
    if (!venture) return;
    const now = deps.clock().toISOString();
    const nowMs = Date.parse(now);
    const all = active(state, venture.id);
    const due = all.filter(record => Date.parse(record.nextCheckAt) <= nowMs)
      .sort((a, b) => (a.lastCheckedAt ?? '').localeCompare(b.lastCheckedAt ?? '') || a.nextCheckAt.localeCompare(b.nextCheckAt) || a.id.localeCompare(b.id));
    if (!due.length) return;
    const lastRead = new Map<string, number>();
    for (const record of all) if (record.lastCheckedAt) lastRead.set(record.host, Math.max(lastRead.get(record.host) ?? 0, Date.parse(record.lastCheckedAt)));
    const looked: { id: string; result: Look }[] = [];
    const waiting: { id: string; until: string }[] = [];
    for (const record of due) {
      if (looked.length >= maxLooks || Date.now() - started >= maxMs) break;
      const last = lastRead.get(record.host);
      if (last !== undefined && nowMs - last < MONITOR_EVERY_MS) { waiting.push({ id: record.id, until: new Date(last + MONITOR_EVERY_MS).toISOString() }); continue; }
      lastRead.set(record.host, nowMs);
      looked.push({ id: record.id, result: await look(deps, record) });
    }
    await ventureAction(deps, ctx, 'prepare', 'keeper.monitors', tx => {
      let alerted = 0, failed = 0;
      for (const { id, result } of looked) {
        const record = tx.find('venture-monitor', id);
        if (!record || record.removedAt !== null) continue;
        const next = tx.replace<MonitorRecord>(afterLook(record, result, now));
        if (next.alerts.length > record.alerts.length) alerted += 1;
        if (!result.ok) failed += 1;
      }
      for (const { id, until } of waiting) {
        const record = tx.find('venture-monitor', id);
        if (record && record.removedAt === null) tx.replace<MonitorRecord>({ ...record, nextCheckAt: until });
      }
      if (!looked.length) return;
      keeperRun(tx, failed ? 'warn' : 'ok', `Looked at ${looked.length} ${looked.length === 1 ? 'page' : 'pages'}${alerted ? `; ${alerted} changed` : ''}${failed ? `; ${failed} could not be read` : ''}.`);
      if (alerted) tx.emit('queue.changed', {});
    });
  } catch {
    // The next tick tries again; a monitor's own error is on its record.
  }
}

/** Today's notice rows for monitors that alerted: one per monitor, its newest alert, Open and Later. Reads only. */
export function monitorRows(state: State, venture: VentureRecord): W4RowItem[] {
  return active(state, venture.id).filter(record => record.alerts.length).map(record => {
    const alert = record.alerts.at(-1)!;
    return {
      kind: 'notice' as const, subject: `monitor:${record.id}`, version: alert.at.replace(/[^0-9]/g, ''), createdAt: alert.at,
      title: 'A page you watch changed', line: alert.line,
      actions: [{ id: 'later' as const, label: 'Later', primary: false }, { id: 'open' as const, label: 'Open Connections', primary: true }],
      navigate: 'Open Connections to see the pages you watch.',
    };
  });
}
