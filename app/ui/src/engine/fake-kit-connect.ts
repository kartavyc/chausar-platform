/**
 * The fake engine's answers for monitors, mail import, local apps, the webhook handoff and speech providers (Ink v2
 * wave 5, package 5A6), in the engine's shapes, codes, order and words (platform/runtime/venture/build/monitors.ts,
 * mail-in.ts, local-apps.ts, webhook-handoff.ts, speech-out.ts, fetch-policy.ts). The fake reads no page and runs no
 * app: a new monitor waits for its first look, as the engine's does until Keeper's next tick; the demo seeds one that
 * has looked. Mail files are read in the page the way the engine reads them (headers, mbox "From " lines, threads by
 * Message-ID, In-Reply-To and References). It answers as the local web app does: no app on PATH unless the demo has one.
 * Written for Chausar; nothing is learned from an outside source.
 */

import {SPEECH_PROVIDER_METADATA} from './speech-provider-metadata';
import { EngineError } from './types';
import type {
  LocalAppView, LocalAppsView, MailImportView, MailThreadView, MailThreadsView, MonitorKind, MonitorView, MonitorsView, SpeechProviderView,
  SpeechProvidersView, WebhookKind, WebhookView,
} from './types';
import type { W4DeskHost } from './fake-w4';

const METHODS = new Set<string>([
  'venture.monitors.list',
  'venture.monitors.add',
  'venture.monitors.remove',
  'venture.mail.import',
  'venture.mail.threads',
  'venture.localApps.list',
  'venture.webhook.set',
  'venture.speechOut.providers',
]);

const WORDS = {
  exact: 'Send the required fields and nothing else.',
  policy: "This site's terms don't allow automated reading. Paste the text instead.",
  address: 'This address points inside your computer or your network, so Chausar will not open it.',
  url: 'Chausar opens only plain web addresses (http or https) with no name or password in them.',
  added: 'Watching. The first look keeps what the page says now; Chausar tells you when it changes.',
  seeded: 'First look kept. Chausar tells you when this changes.',
  removed: 'No longer watched. Chausar will not read this page again.',
  hosted: 'Page watching runs in the desktop app, which keeps checking while it is open.',
  limit: 'You watch 20 pages already. Stop watching one first.',
  notWatched: 'That page is not watched.',
  kind: 'Watch for a change, a text, or a price below your figure.',
  text: 'Say which words to look for.',
  selector: 'Pick the part of the page that shows the price.',
  figure: 'Give your figure as a whole amount in paise.',
  notMail: 'Import a mail file: one message as .eml, or many as .mbox.',
  empty: 'This file has no mail Chausar can read.',
  manualPath: 'Forward the mails, or export them as .eml files',
  notConnected: 'Your mailbox is not connected. Chausar reads only the mail files you import.',
  apps: 'Apps on your computer run only in the desktop app.',
  install: 'Install it yourself; Chausar never installs it.',
  choose: 'Choose n8n or Make.',
  https: 'Use the https address n8n or Make gives the webhook.',
  speech: "Add your Google Cloud key in the narration desk. Other providers remain planned; make audio in their own site meanwhile.",
} as const;
const MAX_MAIL_FILE_BYTES = 25 * 1024 * 1024;
const NAMES: Record<WebhookKind, string> = { n8n: 'n8n', make: 'Make' };

/** build/fetch-policy.ts's list: hosts, and the two shops' product pages only. */
const POLICY: readonly { hosts: string[]; pages?: RegExp }[] = [
  { hosts: ['linkedin.com'] }, { hosts: ['naukri.com'] }, { hosts: ['justdial.com'] }, { hosts: ['indiamart.com'] }, { hosts: ['instagram.com'] },
  { hosts: ['facebook.com', 'fb.com'] }, { hosts: ['x.com', 'twitter.com'] }, { hosts: ['maps.google.com', 'maps.app.goo.gl'] },
  { hosts: ['google.com', 'google.co.in'], pages: /^\/maps(?:\/|$)/ }, { hosts: ['amazon.in'], pages: /\/(?:dp|gp\/product|gp\/aw\/d)\/[A-Za-z0-9]{6,}/ },
  { hosts: ['flipkart.com'], pages: /\/p\/itm[a-z0-9]+/i },
];
const PRIVATE = /^(?:localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?$)/i;

const invalid = (message: string) => new EngineError('INVALID_VENTURE_REQUEST', message);
function exact(p: Record<string, unknown>, allowed: readonly string[], required: readonly string[]): void {
  if (!Object.keys(p).every((key) => allowed.includes(key)) || !required.every((key) => Object.hasOwn(p, key))) throw invalid(WORDS.exact);
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** checkUrl and the fetch policy, as the engine applies them before anything is sent. */
function checkedUrl(raw: unknown, reading = true): URL {
  let url: URL;
  try { url = new URL(String(raw)); } catch { throw new EngineError('NET_URL_REFUSED', WORDS.url); }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) throw new EngineError('NET_URL_REFUSED', WORDS.url);
  if (PRIVATE.test(url.hostname) || !url.hostname.includes('.')) throw new EngineError('NET_ADDRESS_REFUSED', WORDS.address);
  const host = url.hostname.toLowerCase();
  if (reading && POLICY.some((item) => item.hosts.some((name) => host === name || host.endsWith(`.${name}`)) && (!item.pages || item.pages.test(url.pathname)))) {
    throw new EngineError('FETCH_POLICY_REFUSED', WORDS.policy);
  }
  return url;
}

interface Monitor extends MonitorView { at: string }
interface Mail { id: string; messageId: string; references: string[]; from: string; subject: string; date: string; source: 'mailbox' | 'file-import'; held: boolean; text?: string | null; to?: string[] }
interface Book { monitors: Monitor[]; mail: Mail[]; webhooks: Partial<Record<WebhookKind, string>> }

const LOCAL_APPS: readonly { id: LocalAppView['id']; name: string; note: string; licence: string }[] = [
  { id: 'baocut', name: 'BaoCut', note: 'Video cutting and dubbing on this computer, through its public command line.', licence: 'Source-available (BaoCut Community License): Chausar never bundles it and drives only a copy you installed.' },
  { id: 'kimo', name: 'Kimo', note: 'Transcripts and captions on this computer, through its command line.', licence: 'MIT' },
  { id: 'filmcraft', name: 'FilmCraft', note: 'Video editing on this computer, through its command line.', licence: 'MIT or Apache-2.0' },
];

const SPEECH: readonly SpeechProviderView[] = SPEECH_PROVIDER_METADATA.map(provider=>({...provider,languages:[...provider.languages],voices:provider.voices.map(voice=>({...voice}))}));

// --- Reading mail files, as build/mail-in.ts reads them ---

const header = (head: string, name: string): string | null => {
  const match = new RegExp(`^${name}:[ \\t]*((?:.*)(?:\\r?\\n[ \\t].*)*)`, 'im').exec(head);
  return match ? (match[1] ?? '').replace(/\r?\n[ \t]+/g, ' ').trim() : null;
};
const ids = (value: string | null) => [...new Set((value ?? '').match(/<[^<>\s]{1,250}>/g) ?? [])];
const emailOf = (value: string | null) => (/<([^<>\s]+@[^<>\s]+)>/.exec(value ?? '')?.[1] ?? /([^\s<>"(),;]+@[^\s<>"(),;]+)/.exec(value ?? '')?.[1] ?? '').toLowerCase();

function split(name: string, text: string): string[] {
  if (name.toLowerCase().endsWith('.eml')) return [text];
  const out: string[] = [];
  let current: string[] | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (/^From \S/.test(line)) { if (current) out.push(current.join('\r\n')); current = []; continue; }
    if (current) current.push(line.replace(/^>(>*From )/, '$1'));
  }
  if (current) out.push(current.join('\r\n'));
  return out.filter((item) => item.trim());
}

/** Reads plain or multipart text without executing HTML; secret-like content is redacted before support sees it. */
function mailBody(head: string, body: string, depth = 0): string {
  if (depth > 4) return '';
  const contentType = header(head, 'Content-Type') ?? 'text/plain';
  const boundary = /boundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  if (/^multipart\//i.test(contentType) && boundary) return body.split(`--${boundary[1] ?? boundary[2]}`).slice(1, 30).flatMap(part => { const cut = /\r?\n\r?\n/.exec(part); return cut ? [mailBody(part.slice(0, cut.index), part.slice(cut.index + cut[0].length), depth + 1)] : []; }).filter(Boolean).join('\n').slice(0, 4000);
  if (!/^text\/(?:plain|html)/i.test(contentType)) return '';
  let words = body;
  if (/^base64$/i.test(header(head, 'Content-Transfer-Encoding') ?? '')) { try { words = new TextDecoder().decode(Uint8Array.from(atob(body.replace(/\s/g, '')), c => c.charCodeAt(0))); } catch { return ''; } }
  if (/^quoted-printable$/i.test(header(head, 'Content-Transfer-Encoding') ?? '')) { const bytes = words.replace(/=\r?\n/g, '').replace(/=([a-f0-9]{2})/gi, (_all, hex: string) => String.fromCharCode(parseInt(hex, 16))); words = new TextDecoder().decode(Uint8Array.from(bytes, c => c.charCodeAt(0))); }
  if (/^text\/html/i.test(contentType)) words = words.replace(/<(script|style|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '').replace(/<[^>]*>/g, ' ').replace(/&(?:lt|gt|amp|quot|#39);/g, value => ({ '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#39;': "'" })[value] ?? value);
  return words.replace(/\bsk-[a-z0-9_-]{20,}\b/gi, '[secret removed]').replace(/\b\d{12,19}\b/g, '[number removed]').replace(/\r\n/g, '\n').slice(0, 4000).trim();
}

/** Words aimed at an agent, as the untrusted screen holds them in its plainest form. */
const AIMED = /ignore (?:all )?previous instructions|disregard (?:the )?(?:above|previous)|you are now|system prompt/i;

export class FakeKitConnectDesk {
  protected readonly host: W4DeskHost;
  protected readonly fresh: boolean;
  private readonly books = new Map<string, Book>();

  constructor(host: W4DeskHost, options: { fresh?: boolean } = {}) {
    this.host = host;
    this.fresh = options.fresh ?? false;
  }

  handles(method: string): boolean {
    return METHODS.has(method);
  }

  /** Internal read of already-screened imported words, the counterpart of the engine thread reader. */
  supportThread(id: string): ReturnType<NonNullable<W4DeskHost['supportThread']>> {
    const messages = this.threads().get(id);
    return messages ? { held: messages.some(mail => mail.held), messages: messages.map(mail => ({ messageId: mail.messageId, references: [...mail.references], from: mail.from, subject: mail.subject, date: mail.date, text: mail.source === 'file-import' ? mail.text ?? null : 'The original words remain in the mailbox. Forward or export them to read them here.', source: mail.source })) } : null;
  }
  recruitingMail(threadIds:readonly string[]):Mail[]{return [...this.threads()].filter(([id])=>threadIds.includes(id)).flatMap(([,messages])=>messages.filter(m=>m.source==='file-import')).map(m=>structuredClone(m));}
  eraseRecruitingMail(threadIds:readonly string[]):void{const ids=new Set(this.recruitingMail(threadIds).map(m=>m.id));this.book().mail=this.book().mail.filter(m=>!ids.has(m.id));}
  /** Forget erases full imported conversations involving the person, with the words kept for support. */
  forgetPeople(people: readonly { names: readonly string[]; emails: readonly string[] }[], erase: boolean): void {
    if (!erase) return;
    const emails = new Set(people.flatMap(person => person.emails).map(email => email.toLowerCase()));
    const names = people.flatMap(person => person.names).filter(name => name.length >= 3);
    const escaped = names.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const pattern = escaped.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${escaped.join('|')})(?![\\p{L}\\p{N}])`, 'iu') : null;
    const gone = new Set<string>();
    for (const messages of this.threads().values()) if (messages.some(mail => emails.has(mail.from) || mail.to?.some(to => emails.has(to)) || !!pattern?.test(`${mail.subject}\n${mail.text ?? ''}`))) for (const mail of messages) gone.add(mail.id);
    this.book().mail = this.book().mail.filter(mail => !gone.has(mail.id));
  }

  private book(): Book {
    const business = this.host.current();
    let book = this.books.get(business);
    if (!book) {
      book = { monitors: [], mail: [], webhooks: {} };
      if (!this.fresh) {
        const at = this.host.now();
        book.monitors.push({
          id: 'monitor_demo1', at, url: 'https://chai-supplies.example/assam-tea', host: 'chai-supplies.example', kind: 'price-below', line: 'The price on chai-supplies.example fell below your figure.',
          lastCheckedAt: at, nextCheckAt: new Date(Date.parse(at) + 3_600_000).toISOString(), alert: { at, line: 'The price on chai-supplies.example fell below your figure.' }, failing: false, removed: false,
        });
        book.mail.push(
          { id: 'inbound_demo1', messageId: '<d1@customer.example>', references: [], from: 'meera@customer.example', subject: 'Refund for a broken lid', date: at, source: 'mailbox', held: false },
          { id: 'inbound_demo2', messageId: '<d2@customer.example>', references: ['<d1@customer.example>'], from: 'meera@customer.example', subject: 'Re: Refund for a broken lid', date: at, source: 'file-import', held: false },
        );
      }
      this.books.set(business, book);
    }
    return book;
  }

  request(method: string, p: Record<string, unknown>): unknown {
    switch (method) {
      case 'venture.monitors.list': return this.monitorsList(p);
      case 'venture.monitors.add': return this.monitorsAdd(p);
      case 'venture.monitors.remove': return this.monitorsRemove(p);
      case 'venture.mail.import': return this.mailImport(p);
      case 'venture.mail.threads': return this.mailThreads(p);
      case 'venture.localApps.list': return this.localApps(p);
      case 'venture.webhook.set': return this.webhookSet(p);
      case 'venture.speechOut.providers': exact(p, [], []); return clone({ providers: [...SPEECH], line: WORDS.speech } satisfies SpeechProvidersView);
      default: throw new EngineError('NOT_BUILT_YET', 'This part of Chausar is not built yet.');
    }
  }

  // --- Monitors ---

  private view(monitor: Monitor): MonitorView {
    const { at: _at, ...view } = monitor;
    return clone(view);
  }

  private monitorsList(p: Record<string, unknown>): MonitorsView {
    exact(p, [], []);
    const hosted = this.host.hosted();
    const live = this.book().monitors.filter((monitor) => !monitor.removed).reverse();
    const line = hosted ? WORDS.hosted : live.length ? `Watching ${live.length} ${live.length === 1 ? 'page' : 'pages'}.` : 'No pages watched.';
    return { monitors: live.map((monitor) => this.view(monitor)), line, hosted };
  }

  private monitorsAdd(p: Record<string, unknown>): MonitorView {
    exact(p, ['url', 'kind', 'text', 'selector', 'belowRupees'], ['url', 'kind']);
    if (typeof p.url !== 'string' || p.url.length > 2000) throw invalid("Give the page's web address.");
    const kind = p.kind;
    if (kind !== 'change' && kind !== 'contains' && kind !== 'price-below') throw invalid(WORDS.kind);
    const url = checkedUrl(p.url);
    const text = typeof p.text === 'string' && p.text.trim() ? p.text.trim() : null;
    const selector = typeof p.selector === 'string' && p.selector.trim() ? p.selector.trim() : null;
    if (kind === 'contains' && !text) throw invalid(WORDS.text);
    if (kind === 'price-below') {
      if (!selector) throw invalid(WORDS.selector);
      {
        const raw = p.belowRupees;
        if (typeof raw !== 'string' || raw.length > 40) throw new EngineError('INVALID_AMOUNT', 'Your figure must be an amount like 2499 or 2499.50.');
        const amount = raw.replace(/[\s,]/g, '');
        if (!/^\d+(?:\.\d+)?$/.test(amount)) throw new EngineError('INVALID_AMOUNT', 'Your figure must be a positive amount like 2499 or 2499.50.');
        const [whole, fraction = ''] = amount.split('.');
        const cents = fraction.replace(/0+$/, '');
        if (cents.length > 2) throw new EngineError('INVALID_AMOUNT', 'The amount contains a fractional minor unit for its currency.');
        const minor = BigInt(whole!) * 100n + BigInt(cents.padEnd(2, '0') || '0');
        if (minor <= 0n) throw new EngineError('INVALID_AMOUNT', 'Your figure must be more than zero.');
        if (minor > 1_000_000_000_000n) throw new EngineError('INVALID_AMOUNT', 'Your figure is larger than Chausar accepts.');
      }
    }
    if (this.host.hosted()) throw new EngineError('TIER_UNAVAILABLE', WORDS.hosted);
    const book = this.book();
    if (book.monitors.filter((monitor) => !monitor.removed).length >= 20) throw new EngineError('MONITOR_LIMIT', WORDS.limit);
    const at = this.host.now();
    const monitor: Monitor = {
      id: `monitor_${Math.random().toString(36).slice(2, 12)}`, at, url: url.href, host: url.hostname.toLowerCase(), kind: kind as MonitorKind, line: WORDS.added,
      lastCheckedAt: null, nextCheckAt: at, alert: null, failing: false, removed: false,
    };
    book.monitors.push(monitor);
    return this.view(monitor);
  }

  private monitorsRemove(p: Record<string, unknown>): MonitorView {
    exact(p, ['id'], ['id']);
    const monitor = this.book().monitors.find((item) => item.id === p.id && !item.removed);
    if (!monitor) throw new EngineError('MONITOR_NOT_FOUND', WORDS.notWatched);
    monitor.removed = true;
    monitor.nextCheckAt = null;
    monitor.line = WORDS.removed;
    return this.view(monitor);
  }

  // --- Mail in ---

  private mailImport(p: Record<string, unknown>): MailImportView {
    exact(p, ['name', 'contentBase64'], ['name', 'contentBase64']);
    const name = typeof p.name === 'string' ? p.name.trim() : '';
    if (!name || name.length > 200) throw invalid('The file name must be one line.');
    if (!/\.(eml|mbox)$/i.test(name)) throw new EngineError('MAIL_FILE_UNREADABLE', WORDS.notMail);
    if (typeof p.contentBase64 !== 'string') throw invalid("Send the file's bytes.");
    const encoded = p.contentBase64.replace(/\s/g, '');
    const size = Math.floor((encoded.length * 3) / 4) - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);
    if (size > MAX_MAIL_FILE_BYTES) throw new EngineError('MAIL_FILE_TOO_LARGE', `This file is ${(size / (1024 * 1024)).toFixed(1)} MB. Chausar imports mail files of up to 25 MB.`);
    let text: string;
    try { text = new TextDecoder().decode(Uint8Array.from(atob(encoded), (ch) => ch.charCodeAt(0))); } catch { throw invalid("Send the file's bytes."); }
    const book = this.book();
    const at = this.host.now();
    let added = 0, repeats = 0, skipped = 0, held = 0;
    const touched: Mail[] = [];
    for (const raw of split(name, text).slice(0, 2000)) {
      const cut = /\r?\n\r?\n/.exec(raw);
      const head = cut ? raw.slice(0, cut.index) : raw;
      const body = cut ? raw.slice(cut.index + cut[0].length) : '';
      const from = emailOf(header(head, 'From'));
      if (!from || header(head, 'List-Id') || header(head, 'List-Unsubscribe')) { skipped += 1; continue; }
      const messageId = ids(header(head, 'Message-ID'))[0] ?? `<import.${added + repeats + skipped}.${at}@chausar>`;
      if (book.mail.some((mail) => mail.messageId === messageId)) { repeats += 1; continue; }
      const stated = Date.parse(header(head, 'Date') ?? '');
      const mail: Mail = {
        id: `inbound_${Math.random().toString(36).slice(2, 12)}`, messageId, references: ids(`${header(head, 'References') ?? ''} ${header(head, 'In-Reply-To') ?? ''}`).slice(-20),
        from, subject: (header(head, 'Subject') ?? '').trim() || '(no subject)', date: new Date(Number.isFinite(stated) ? Math.min(stated, Date.parse(at)) : Date.parse(at)).toISOString(),
        source: 'file-import', held: AIMED.test(body) || AIMED.test(mailBody(head, body)), text: null, to: [...new Set((`${header(head, 'To') ?? ''} ${header(head, 'Cc') ?? ''}`.match(/[^\s<>"(),;]+@[^\s<>"(),;]+/g) ?? []).map(address => address.toLowerCase()))],
      };
      mail.text = mail.held ? null : mailBody(head, body);
      if (mail.held) held += 1;
      book.mail.push(mail);
      this.host.supportImported?.({...mail,text:mail.text??null});
      touched.push(mail);
      added += 1;
    }
    if (!added && !repeats) throw new EngineError('MAIL_FILE_UNREADABLE', WORDS.empty);
    const threads = new Set(touched.map((mail) => this.threadOf(mail.id)));
    const words = [`${added} ${added === 1 ? 'message' : 'messages'} imported from ${name}`, repeats ? `${repeats} already kept` : '', skipped ? `${skipped} skipped` : '',
      held ? `${held} held by the screen` : ''].filter(Boolean).join(', ');
    return { added, repeats, skipped, held, threads: threads.size, line: `${words}.` };
  }

  /** Threads by the message ids each message names, as the engine joins them; thread id from the earliest message. */
  private threads(): Map<string, Mail[]> {
    const mail = this.book().mail;
    const parent = new Map<string, string>();
    const find = (key: string): string => { let root = key; while (parent.has(root) && parent.get(root) !== root) root = parent.get(root)!; parent.set(key, root); return root; };
    for (const item of mail) { find(item.messageId); for (const ref of item.references) { const a = find(item.messageId), b = find(ref); if (a !== b) parent.set(a, b); } }
    const groups = new Map<string, Mail[]>();
    for (const item of mail) groups.set(find(item.messageId), [...(groups.get(find(item.messageId)) ?? []), item]);
    const out = new Map<string, Mail[]>();
    for (const list of groups.values()) {
      const ordered = [...list].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
      out.set(`thread_${this.host.digest(ordered[0]!.messageId).slice(0, 16)}`, ordered);
    }
    return out;
  }

  private threadOf(mailId: string): string {
    for (const [id, list] of this.threads()) if (list.some((mail) => mail.id === mailId)) return id;
    return '';
  }

  private mailThreads(p: Record<string, unknown>): MailThreadsView {
    exact(p, ['clientId'], []);
    const views: MailThreadView[] = [];
    for (const [id, list] of this.threads()) {
      const last = list.at(-1)!;
      views.push({
        id, subject: list[0]!.subject, from: last.from, count: list.length, lastAt: last.date,
        sources: (['mailbox', 'file-import'] as const).filter((source) => list.some((mail) => mail.source === source)), clientId: null, desk: null,
        held: list.some((mail) => mail.held),
      });
    }
    views.sort((a, b) => b.lastAt.localeCompare(a.lastAt) || a.id.localeCompare(b.id));
    const threads = typeof p.clientId === 'string' ? views.filter((thread) => thread.clientId === p.clientId) : views;
    return { threads, mailbox: { connected: false, label: 'read', line: WORDS.notConnected, manualPath: WORDS.manualPath } };
  }

  // --- Local apps, the webhook, speech ---

  private localApps(p: Record<string, unknown>): LocalAppsView {
    exact(p, [], []);
    const hosted = this.host.hosted();
    // The demo has Kimo installed, so the screen shows both labels; a fresh fake has none.
    const found = (id: string) => !hosted && !this.fresh && id === 'kimo';
    const apps: LocalAppView[] = LOCAL_APPS.map((app) => ({
      id: app.id, name: app.name, label: found(app.id) ? 'write' : 'planned: write', found: found(app.id), licence: app.licence,
      note: hosted ? WORDS.apps : found(app.id) ? `${app.note} Found on this computer. Anything that changes something runs only as the exact command you approve.` : app.note,
      manualPath: found(app.id) ? null : WORDS.install, needs: null,
    }));
    const count = apps.filter((app) => app.found).length;
    return { apps, hosted, line: hosted ? WORDS.apps : count ? `${count} of your apps ${count === 1 ? 'is' : 'are'} on this computer.` : 'None of these apps is on this computer.' };
  }

  private webhookSet(p: Record<string, unknown>): WebhookView {
    exact(p, ['kind', 'url', 'test'], ['kind', 'url']);
    if (p.kind !== 'n8n' && p.kind !== 'make') throw invalid(WORDS.choose);
    const kind = p.kind;
    if (p.test !== undefined && typeof p.test !== 'boolean') throw invalid('test is true or false.');
    const book = this.book();
    if (p.url === null) {
      delete book.webhooks[kind];
      return { kind, set: false, host: null, line: `No ${NAMES[kind]} webhook is set. Chausar sends nothing there.`, test: null };
    }
    if (typeof p.url !== 'string' || p.url.length > 2000) throw invalid('Paste the webhook address from n8n or Make.');
    const url = checkedUrl(p.url, false);
    if (url.protocol !== 'https:') throw invalid(WORDS.https);
    book.webhooks[kind] = url.href;
    const kept = `Your ${NAMES[kind]} webhook at ${url.hostname} is set. Chausar sends an item there only after you approve that exact item. It keeps the address only while the app is open.`;
    if (p.test !== true) return { kind, set: true, host: url.hostname, line: kept, test: null };
    return { kind, set: true, host: url.hostname, line: `The test item reached your ${NAMES[kind]} webhook. ${kept}`, test: 'answered' };
  }
}

/** Reuse the fake network policy in desks that read public sites. */
export { checkedUrl as fakeCheckedFetchUrl };
