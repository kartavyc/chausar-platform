/**
 * The fake engine's answers for the bell, the notification centre and its settings, and phone push (Ink v2 wave 4,
 * 4G4), in the engine's shapes, codes and words (platform/runtime/venture/notify: centre.ts, digest.ts, settings.ts,
 * push-methods.ts, relay.ts, webpush.ts). The centre holds one item per needs-you row of the open business (any kind
 * but locked), newest first; a row that leaves Today ends its item, which then says only what kind of thing it was and
 * counts as read. The sample opens with a digest written at 08:00 on 22 October that lists what was waiting, and the
 * two newest items unread. Phone push answers as the hosted web server does when the fake is hosted, and refuses on
 * this computer (TIER_UNAVAILABLE), where the relay is offered instead; the hosted server adds the session to a
 * subscription, so the fake accepts one without it. Nothing here sends anything anywhere.
 */

import { dayKeyIn, formatClock, formatDay, formatTime, ownerZone, timeKeyIn } from '../../../../platform/runtime/owner-format';
import { EngineError, type NotificationView, type NotifyDigestView, type NotifySettingsView, type PushSubscriptionInput, type QueueRow } from './types';
import type { W4DeskHost } from './fake-w4';
import { qrMatrix } from '../../../../platform/runtime/venture/money/qr';

const NOTIFY_METHODS = new Set<string>([
  'venture.notify.list', 'venture.notify.read', 'venture.notify.settings',
  'venture.notify.push.key', 'venture.notify.push.subscribe', 'venture.notify.push.unsubscribe', 'venture.notify.relay',
  // W6 6F6 and 6F7
  'venture.notify.telegram', 'venture.notify.telegram.findChat', 'venture.phone.access',
]);
/** W6 6F6 telegram.ts WORDS and 6F7 phone.ts WORDS, as the engine says them. */
const TELEGRAM_WORDS = {
  token: 'Paste the bot token BotFather gave you. It looks like 123456789:AA, then about 35 letters and digits.',
  chat: 'Give your chat id as a number. The phone access guide says how to find it.',
  hosted: 'The hosted app does not talk to Telegram. Telegram alerts come from the desktop app.',
  notSet: 'Set up your Telegram bot first.',
  none: 'No Telegram bot is set. Alerts can go to your own bot as a count only.',
  counts: 'Alerts go to your Telegram bot as a count only, like "3 things wait for you".',
  details: 'Alerts go to your Telegram bot with the titles of what waits. Titles can name clients.',
};
const PHONE_WORDS = {
  hosted: 'The hosted app opens on a phone by its own address. Phone access is for the desktop app.',
  noTailscale: 'Tailscale is not running on this computer. The phone access guide shows how to set it up.',
  hours: 'Choose how long a phone stays paired, from 1 to 24 hours.',
  off: 'Phone access is off. Make a pairing link to open Chausar on your phone.',
  link: 'Open this link on your phone within 10 minutes. It works once.',
};
const BOT_TOKEN = /^\d{6,12}:[A-Za-z0-9_-]{30,64}$/;
const CHAT_ID = /^-?\d{1,20}$/;
/** The fake computer's home network address (no Tailscale), and a sample pairing code: nothing listens. */
const FAKE_WIFI = '192.168.1.20';
const FAKE_PAIR_LINK = `http://${FAKE_WIFI}:43117/#pair=${'Fk'.repeat(21)}x`;

/** centre.ts KIND_WORDS and endedTitle: what an ended item says instead of its row's title, and that it ended. */
const KIND_WORDS: Readonly<Record<string, string>> = {
  plan: 'Your plan', price: 'A price change', quote: 'A cost to approve', draft: 'A draft', invoice: 'An invoice', signoff: 'A sign-off',
  question: 'A question', setup: 'A setup step', locked: 'A locked business', connector: 'A connection', bank: 'A bank line',
  proposal: 'A proposal', followup: 'A follow-up', reply: 'A reply', notice: 'A notice',
};
/** push-methods.ts PUSH_WORDS and relay.ts RELAY_WORDS, as the engine says them. */
const WORDS = {
  desktop: 'On this computer, phone alerts come by Telegram below; the tray shows the count.',
  on: 'Phone alerts are on for this browser. They carry a count only, never names or figures.',
  off: 'Phone alerts are off. The bell still lists everything.',
  endpoint: 'Phone alerts go only to a browser push service (Google, Mozilla, Microsoft or Apple) over https.',
  keys: 'The browser sent push keys Chausar cannot use. Turn phone alerts off and on again in this browser.',
  notSubscribed: 'Allow phone alerts in this browser first. Chausar turns them on when the browser says yes.',
  relayAddress: 'Give the relay as one https address of your own, like https://ntfy.sh/your-topic, with no name or password in it.',
  relayHosted: 'The hosted app sends phone alerts with web push. A relay is for the desktop app.',
  relayNone: 'No relay is set. The tray on this computer shows the count.',
};
/** webpush.ts PUSH_SERVICE_HOSTS. */
const PUSH_HOSTS = ['fcm.googleapis.com', 'android.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'];
const PUSH_SUFFIX = '.notify.windows.com';
/** A sample public key in the shape a browser subscribes with (an uncompressed P-256 point, base64url). */
const SAMPLE_PUBLIC_KEY = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
const MAX_PAUSE_MS = 30 * 24 * 3_600_000;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

interface Note { id: string; rowId: string; kind: QueueRow['kind']; title: string; at: string; readAt: string | null; ended: boolean }
interface Settings {
  pausedUntil: string | null; quietHours: { from: string; to: string } | null; digest: { hour: number } | null;
  push: boolean; tray: boolean; relay: string | null;
}
const DEFAULTS: Settings = { pausedUntil: null, quietHours: { from: '22:00', to: '07:00' }, digest: { hour: 8 }, push: false, tray: true, relay: null };

const refuse = (code: string, message: string): never => { throw new EngineError(code, message); };
const check = (ok: unknown, code: string, message: string) => { if (!ok) refuse(code, message); };

/** records.ts exactPayload: only the fields named, and the required ones present. */
function exact(p: Record<string, unknown>, allowed: string[], required: string[] = []): void {
  for (const key of Object.keys(p)) check(allowed.includes(key), 'INVALID_VENTURE_REQUEST', `Unknown field: ${key}.`);
  for (const key of required) check(Object.hasOwn(p, key), 'INVALID_VENTURE_REQUEST', `Missing field: ${key}.`);
}

/** digest.ts digestKind: what one waiting row counts as in the digest line. */
function digestKind(row: QueueRow): 'approve' | 'question' | 'setup' | 'look' {
  const ids = row.actions.map((action) => action.id as string);
  if (row.kind === 'question' || ids.includes('answer')) return 'question';
  if (row.kind === 'setup' || ids.some((id) => ['connect', 'set-prices', 'keep'].includes(id))) return 'setup';
  if (ids.some((id) => ['approve', 'issue', 'send-to-ca', 'sent', 'continue', 'resume', 'stop'].includes(id))) return 'approve';
  return 'look';
}

/** digest.ts digestLine, for counts only (the sample has no money ready to invoice). */
function digestLine(rows: readonly QueueRow[]): string {
  if (!rows.length) return 'Nothing needs you today.';
  const kinds = rows.map(digestKind);
  const words: Record<string, (n: number) => string> = {
    approve: (n) => `${n} to approve`, question: (n) => `${n} ${n === 1 ? 'question' : 'questions'}`, setup: (n) => `${n} to set up`, look: (n) => `${n} to look at`,
  };
  const parts = (['approve', 'question', 'setup', 'look'] as const).map((kind) => [kind, kinds.filter((k) => k === kind).length] as const).filter(([, n]) => n > 0).map(([kind, n]) => words[kind]!(n));
  return `Today: ${rows.length} ${rows.length === 1 ? 'needs' : 'need'} you (${parts.join(', ')}).`;
}

/** The sample businesses are in India: their zone from the engine's table, not a fixed offset (B2). */
const INDIA = ownerZone('IN', 'UTC');
/** The owner's clock in India at an instant: [the day, 'HH:MM'], keys to compare with the settings. */
function indiaAt(instant: string): [string, string] {
  return [dayKeyIn(instant, INDIA), timeKeyIn(instant, INDIA)];
}
const dayWords = (day: string) => formatDay(day, 'UTC');

export class FakeNotifyDesk {
  protected readonly host: W4DeskHost;
  protected readonly fresh: boolean;
  private notes = new Map<string, Note[]>();
  private digests = new Map<string, NotifyDigestView>();
  private settings = new Map<string, Settings>();
  private browsers = new Map<string, Set<string>>();
  private seq = 1;
  private seeded = new Set<string>();

  constructor(host: W4DeskHost, options: { fresh?: boolean } = {}) {
    this.host = host;
    this.fresh = options.fresh ?? false;
  }

  handles(method: string): boolean {
    return NOTIFY_METHODS.has(method);
  }

  request(method: string, p: Record<string, unknown>): unknown {
    switch (method) {
      case 'venture.notify.list': return this.list(p);
      case 'venture.notify.read': return this.read(p);
      case 'venture.notify.settings': return this.changeSettings(p);
      case 'venture.notify.push.key': {
        exact(p, []);
        check(this.host.hosted(), 'TIER_UNAVAILABLE', WORDS.desktop);
        return { publicKey: SAMPLE_PUBLIC_KEY };
      }
      case 'venture.notify.push.subscribe': return this.subscribe(p);
      case 'venture.notify.push.unsubscribe': return this.unsubscribe(p);
      case 'venture.notify.relay': return this.relay(p);
      case 'venture.notify.telegram': return this.telegram(p);
      case 'venture.notify.telegram.findChat': return this.findChat(p);
      case 'venture.phone.access': return this.phoneAccess(p);
      default: return refuse('METHOD_NOT_ALLOWED', 'The sample business can\'t do that yet.');
    }
  }

  /** The centre's look at Today (centre.ts notifyRefresh): one item per needs-you row; a row gone ends its item. */
  private refresh(): Note[] {
    const business = this.host.current();
    const notes = this.notes.get(business) ?? [];
    const rows = this.host.rows().filter((row) => row.businessId === business && row.kind !== 'locked');
    const now = this.host.now();
    for (const note of notes) {
      if (note.ended || rows.some((row) => row.id === note.rowId)) continue;
      note.ended = true;
      note.readAt ??= now;
      note.title = `${KIND_WORDS[note.kind] ?? 'An item'}, no longer waiting on you`;
    }
    for (const row of rows) {
      if (notes.some((note) => note.rowId === row.id && !note.ended)) continue;
      notes.push({ id: `note-${this.seq++}`, rowId: row.id, kind: row.kind, title: row.title, at: this.seeded.has(business) ? now : row.createdAt, readAt: null, ended: false });
    }
    if (!this.seeded.has(business)) {
      this.seeded.add(business);
      // The sample: the two newest items are new; the rest were seen, and the morning digest listed them all.
      const newest = [...notes].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 2);
      for (const note of notes) if (!newest.includes(note)) note.readAt = note.at;
      if (!this.fresh && notes.length) {
        this.digests.set(business, {
          id: `digest-${business}`, day: '2026-10-22', at: '2026-10-22T02:30:00.000Z', line: digestLine(rows),
          items: notes.map((note) => this.view(note)), stillWaiting: 0, receiptIds: [],
        });
      }
    }
    this.notes.set(business, notes);
    return notes;
  }

  private view(note: Note): NotificationView {
    return { id: note.id, rowId: note.rowId, kind: note.kind, title: note.title, at: note.at, read: note.readAt !== null };
  }

  private list(p: Record<string, unknown>) {
    exact(p, []);
    const notes = this.refresh();
    const newestFirst = notes.map((note, index) => ({ note, index })).sort((a, b) => b.note.at.localeCompare(a.note.at) || b.index - a.index);
    return {
      items: newestFirst.slice(0, 200).map(({ note }) => this.view(note)),
      unread: notes.filter((note) => note.readAt === null).length,
      digest: structuredClone(this.digests.get(this.host.current()) ?? null),
    };
  }

  private read(p: Record<string, unknown>) {
    exact(p, ['ids', 'all']);
    const all = Object.hasOwn(p, 'all');
    check(all !== Object.hasOwn(p, 'ids'), 'INVALID_VENTURE_REQUEST', 'Send the ids to mark as read, or all: true.');
    check(!all || p.all === true, 'INVALID_VENTURE_REQUEST', 'Send all: true to mark everything as read.');
    const notes = this.refresh();
    const ids = all ? [] : p.ids;
    check(Array.isArray(ids) && (all || (ids.length >= 1 && ids.length <= 200)) && ids.every((id) => typeof id === 'string'), 'INVALID_VENTURE_REQUEST', 'Send between 1 and 200 notification ids.');
    for (const id of ids as string[]) check(notes.some((note) => note.id === id), 'INVALID_VENTURE_REQUEST', 'This notification does not exist.');
    const now = this.host.now();
    for (const note of notes) if ((all || (ids as string[]).includes(note.id)) && note.readAt === null) note.readAt = now;
    return { unread: notes.filter((note) => note.readAt === null).length };
  }

  private current(): Settings {
    return { ...(this.settings.get(this.host.current()) ?? DEFAULTS) };
  }

  private browserCount(): number {
    return this.browsers.get(this.host.current())?.size ?? 0;
  }

  /** settings.ts settingsView: push reads as on only while a browser has subscribed, on the hosted app. */
  private settingsView(stored: Settings): NotifySettingsView {
    const hosted = this.host.hosted();
    const nowMs = Date.parse(this.host.now());
    const push = hosted ? stored.push && this.browserCount() > 0 : stored.push;
    const paused = stored.pausedUntil !== null && Date.parse(stored.pausedUntil) > nowMs;
    const parts: string[] = [];
    if (paused) {
      const [day] = indiaAt(stored.pausedUntil!);
      parts.push(`Alerts outside the app are paused until ${dayWords(day)}, ${formatTime(stored.pausedUntil!, INDIA)}. The bell still lists everything.`);
    } else if (hosted) {
      parts.push(push ? 'Phone alerts are on, with a count only, and come while Chausar is awake for this business.' : 'Phone alerts are off. The bell still lists everything.');
    } else {
      parts.push(stored.tray ? 'The tray shows how many things need you.' : 'The tray count is off. The bell still lists everything.');
    }
    parts.push(stored.quietHours ? `Quiet hours: ${formatClock(stored.quietHours.from)} to ${formatClock(stored.quietHours.to)}.` : 'No quiet hours.');
    parts.push(stored.digest ? `Daily summary at ${formatClock(`${String(stored.digest.hour).padStart(2, '0')}:00`)}.` : 'No daily summary.');
    // settings.ts keepsRunning: the Keeper jobs that ran here; the hosted app sleeps while nobody has it open.
    const keepsRunning = hosted || this.fresh ? [] : ['Backups, by Keeper', 'Journal sweep, by Keeper', 'Connection checks, by Keeper'];
    return {
      pausedUntil: paused ? stored.pausedUntil : null,
      quietHours: stored.quietHours ? { ...stored.quietHours } : null,
      digest: stored.digest ? { hour: stored.digest.hour } : null,
      push, tray: stored.tray, keepsRunning, line: parts.join(' '),
    };
  }

  private changeSettings(p: Record<string, unknown>): NotifySettingsView {
    exact(p, ['pausedUntil', 'quietHours', 'digest', 'push', 'tray']);
    const nowMs = Date.parse(this.host.now());
    const change: Partial<Settings> = {};
    if (Object.hasOwn(p, 'pausedUntil')) {
      const value = p.pausedUntil;
      if (value === null) change.pausedUntil = null;
      else {
        check(typeof value === 'string' && INSTANT.test(value) && Number.isFinite(Date.parse(value)), 'INVALID_VENTURE_REQUEST', 'Send the end of the pause as a time like 2026-10-30T09:00:00.000Z, or null to end it.');
        const until = Date.parse(value as string);
        check(until > nowMs, 'INVALID_VENTURE_REQUEST', 'Choose an end for the pause that is still ahead, or null to end it.');
        check(until - nowMs <= MAX_PAUSE_MS, 'NOTIFY_PAUSE_TOO_LONG', 'Pause alerts for 30 days at most.');
        change.pausedUntil = new Date(until).toISOString();
      }
    }
    if (Object.hasOwn(p, 'quietHours')) {
      const value = p.quietHours as { from?: unknown; to?: unknown } | null;
      if (value === null) change.quietHours = null;
      else {
        check(value && typeof value === 'object' && typeof value.from === 'string' && CLOCK.test(value.from) && typeof value.to === 'string' && CLOCK.test(value.to), 'INVALID_VENTURE_REQUEST', 'Give quiet hours as two times like 22:00 and 07:00.');
        check(value.from !== value.to, 'INVALID_VENTURE_REQUEST', 'Quiet hours need a start and an end that differ.');
        change.quietHours = { from: value.from as string, to: value.to as string };
      }
    }
    if (Object.hasOwn(p, 'digest')) {
      const value = p.digest as { hour?: unknown } | null;
      if (value === null) change.digest = null;
      else {
        check(value && Number.isInteger(value.hour) && (value.hour as number) >= 0 && (value.hour as number) <= 23, 'INVALID_VENTURE_REQUEST', 'Choose the daily summary hour from 0 to 23.');
        change.digest = { hour: value.hour as number };
      }
    }
    for (const field of ['push', 'tray'] as const) {
      if (!Object.hasOwn(p, field)) continue;
      check(typeof p[field] === 'boolean', 'INVALID_VENTURE_REQUEST', `${field === 'push' ? 'Push' : 'Tray'} must be on or off.`);
      change[field] = p[field] as boolean;
    }
    check(change.push !== true || !this.host.hosted() || this.browserCount() > 0, 'PUSH_NOT_SUBSCRIBED', WORDS.notSubscribed);
    const next = { ...this.current(), ...change };
    if (Object.keys(change).length) this.settings.set(this.host.current(), next);
    return this.settingsView(next);
  }

  private subscribe(p: Record<string, unknown>) {
    exact(p, ['subscription'], ['subscription']);
    check(this.host.hosted(), 'TIER_UNAVAILABLE', WORDS.desktop);
    const input = p.subscription as Partial<PushSubscriptionInput> | null;
    check(input && typeof input === 'object', 'INVALID_VENTURE_REQUEST', 'Send the browser\'s subscription.');
    let url: URL | null = null;
    try { url = new URL(String(input!.endpoint)); } catch { refuse('PUSH_ENDPOINT_REFUSED', WORDS.endpoint); }
    const host = url!.hostname.toLowerCase();
    check(url!.protocol === 'https:' && !url!.username && !url!.password && url!.port === '' && !url!.hash
      && (PUSH_HOSTS.includes(host) || (host.endsWith(PUSH_SUFFIX) && host.length > PUSH_SUFFIX.length)), 'PUSH_ENDPOINT_REFUSED', WORDS.endpoint);
    const keys = input!.keys as Record<string, unknown> | undefined;
    check(keys && typeof keys.p256dh === 'string' && typeof keys.auth === 'string', 'INVALID_VENTURE_REQUEST', WORDS.keys);
    const business = this.host.current();
    const set = this.browsers.get(business) ?? new Set<string>();
    set.add(url!.href);
    this.browsers.set(business, set);
    this.settings.set(business, { ...this.current(), push: true });
    return { subscribed: true, line: WORDS.on };
  }

  private unsubscribe(p: Record<string, unknown>) {
    exact(p, ['endpoint'], ['endpoint']);
    check(typeof p.endpoint === 'string' && p.endpoint.length > 0, 'INVALID_VENTURE_REQUEST', 'Send the address of the browser to remove.');
    const business = this.host.current();
    const set = this.browsers.get(business) ?? new Set<string>();
    let spelled = p.endpoint as string;
    try { spelled = new URL(spelled).href; } catch { /* stored as given */ }
    set.delete(spelled);
    this.browsers.set(business, set);
    const left = set.size;
    if (!left) this.settings.set(business, { ...this.current(), push: false });
    const line = left ? `This browser will not get phone alerts. ${left === 1 ? '1 other browser still gets them.' : `${left} other browsers still get them.`}` : WORDS.off;
    return { subscribed: false, line };
  }

  /** relay.ts relayHandler: the owner's own https address, shown by its host alone; {} reads it; null clears it. */
  private relay(p: Record<string, unknown>) {
    exact(p, ['url']);
    check(!this.host.hosted(), 'TIER_UNAVAILABLE', WORDS.relayHosted);
    const view = (stored: string | null) => {
      if (!stored) return { relay: null, line: WORDS.relayNone };
      const host = new URL(stored).host;
      return { relay: host, line: `Each alert sends ${host} a count only, never names or figures.` };
    };
    if (!Object.hasOwn(p, 'url')) return view(this.current().relay);
    let stored: string | null = null;
    if (p.url !== null) {
      check(typeof p.url === 'string' && p.url.length > 0 && p.url.length <= 500, 'INVALID_VENTURE_REQUEST', WORDS.relayAddress);
      let url: URL | null = null;
      try { url = new URL(p.url as string); } catch { refuse('INVALID_VENTURE_REQUEST', WORDS.relayAddress); }
      check(url!.protocol === 'https:' && !url!.username && !url!.password && !url!.hash && !(p.url as string).includes('#'), 'INVALID_VENTURE_REQUEST', WORDS.relayAddress);
      stored = url!.href;
    }
    this.settings.set(this.host.current(), { ...this.current(), relay: stored });
    return view(stored);
  }

  private bots = new Map<string, { details: boolean }>();
  /** telegram.ts telegramHandler: the bot goes to protected storage (here, nowhere); count only unless details; a test. Sends nothing. */
  /**
   * C5 task 11 notify/telegram.ts findChat: the sample bot's newest /start came from Kartavy's private chat. A token
   * of the bot with a webhook answers the webhook words. Nothing is kept.
   */
  private findChat(p: Record<string, unknown>) {
    exact(p, ['token'], ['token']);
    check(!this.host.hosted(), 'TIER_UNAVAILABLE', TELEGRAM_WORDS.hosted);
    check(typeof p.token === 'string' && /^\d{6,12}:[A-Za-z0-9_-]{30,64}$/.test(p.token.trim()), 'INVALID_VENTURE_REQUEST', TELEGRAM_WORDS.token);
    return { found: { chatId: '7000123456', name: 'Kartavy' }, line: 'Is this you: Kartavy?' };
  }

  private telegram(p: Record<string, unknown>) {
    exact(p, ['bot', 'details', 'test']);
    check(!this.host.hosted(), 'TIER_UNAVAILABLE', TELEGRAM_WORDS.hosted);
    const business = this.host.current();
    const view = (bot: { details: boolean } | undefined, said?: string) => {
      const base = bot ? { connected: true, details: bot.details, line: bot.details ? TELEGRAM_WORDS.details : TELEGRAM_WORDS.counts } : { connected: false, details: false, line: TELEGRAM_WORDS.none };
      return said === undefined ? base : { ...base, said };
    };
    const current = this.bots.get(business);
    if (!Object.keys(p).length) return view(current);
    let bot: 'set' | null | undefined;
    if (Object.hasOwn(p, 'bot') && p.bot !== null) {
      check(typeof p.bot === 'object' && !Array.isArray(p.bot), 'INVALID_VENTURE_REQUEST', 'Send one request object.');
      const given = p.bot as Record<string, unknown>;
      exact(given, ['token', 'chatId'], ['token', 'chatId']);
      check(typeof given.token === 'string' && BOT_TOKEN.test(given.token.trim()), 'INVALID_VENTURE_REQUEST', TELEGRAM_WORDS.token);
      check(typeof given.chatId === 'string' && CHAT_ID.test(given.chatId.trim()), 'INVALID_VENTURE_REQUEST', TELEGRAM_WORDS.chat);
      bot = 'set';
    } else if (Object.hasOwn(p, 'bot')) bot = null;
    check(!Object.hasOwn(p, 'details') || typeof p.details === 'boolean', 'INVALID_VENTURE_REQUEST', 'Details must be on or off.');
    check(!Object.hasOwn(p, 'test') || p.test === true, 'INVALID_VENTURE_REQUEST', 'Send test as true.');
    check(bot !== undefined || current, 'TELEGRAM_NOT_SET', TELEGRAM_WORDS.notSet);
    const next = bot === null ? undefined : { details: typeof p.details === 'boolean' ? p.details : bot ? false : current!.details };
    if (next) this.bots.set(business, next); else this.bots.delete(business);
    if (p.test !== true || !next) return view(next);
    return view(next, 'Telegram took the test alert.');
  }

  private phones = new Map<string, boolean>();
  /** phone.ts phoneAccessHandler on a computer at 192.168.1.20 with no Tailscale: a sample link and its QR code; nothing listens. */
  private phoneAccess(p: Record<string, unknown>) {
    exact(p, ['action', 'via', 'hours']);
    check(!this.host.hosted(), 'TIER_UNAVAILABLE', PHONE_WORDS.hosted);
    const business = this.host.current();
    check(p.action === undefined || p.action === 'link' || p.action === 'stop', 'INVALID_VENTURE_REQUEST', 'Send action as link or stop.');
    check(p.action === 'link' || (p.via === undefined && p.hours === undefined), 'INVALID_VENTURE_REQUEST', 'Only a pairing link takes via and hours.');
    const view = (link: { link: string; expiresAt: string } | null) => {
      const on = this.phones.get(business) === true;
      return {
        on, addresses: [{ via: 'wifi' as const, address: FAKE_WIFI }], phones: 0, link: link?.link ?? null, expiresAt: link?.expiresAt ?? null,
        line: link ? PHONE_WORDS.link : !on ? PHONE_WORDS.off : 'Phone access is on. 0 phones are paired. Some approvals still need this computer.',
        qr: link ? (({ size, rows }) => ({ size, rows }))(qrMatrix(link.link)) : null,
      };
    };
    if (p.action === 'stop') { this.phones.set(business, false); return view(null); }
    if (p.action !== 'link') return view(null);
    const via = p.via ?? 'wifi';
    check(via === 'wifi' || via === 'tailscale', 'INVALID_VENTURE_REQUEST', 'Send via as wifi or tailscale.');
    const hours = p.hours ?? 12;
    check(Number.isInteger(hours) && (hours as number) >= 1 && (hours as number) <= 24, 'INVALID_VENTURE_REQUEST', PHONE_WORDS.hours);
    check(via === 'wifi', 'PHONE_NO_NETWORK', PHONE_WORDS.noTailscale);
    this.phones.set(business, true);
    return view({ link: FAKE_PAIR_LINK, expiresAt: new Date(Date.parse(this.host.now()) + 10 * 60_000).toISOString() });
  }
}
