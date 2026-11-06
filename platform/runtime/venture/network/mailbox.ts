// Chausar venture launcher, network (Ink v2 wave 4, package 4E3, catalogue K8): the owner's own mailbox, read-only. The
// owner connects it with an app password (approve, inside the app, on the desktop only): the server's name passes the
// network guard, Chausar signs in over TLS and opens the inbox read-only before anything is kept, and the password goes
// on the engine's secret shelf, never into a record, an export or a log (it is kept only while the app is open, as the
// model keys are). A server that only takes Google or Microsoft sign-in is said plainly. Sync reads one window of UIDs
// past the stored cursor up to the inbox's last (a changed UIDVALIDITY rescans the last 30 days), takes the text only
// of mail from people in the network or the pipeline by address or full name (and of delivery reports about them),
// never of bulk mail, screens it, triages it in code (inbound.ts) and keeps only what triage needs. A message that will
// not read is skipped, and the cursor moves past it. Chausar never sends mail, and nothing it does marks a message read.
import { authorize, check, ChausarError, type Context, type State } from '../../contracts.ts';
import type { MailboxRecord, MailboxSync, MailboxView, VentureDeps, VentureRecord } from '../contracts.ts';
import { exactPayload, formatVentureDate, listRecords, readVenture, requireAppChannel, requireVenture, singleLine, smallInteger, ventureAction } from '../records.ts';
import { localDayAt, localTimeAt } from '../local-day.ts';
import { addDays } from './followups.ts';
import { cardsOf } from './pipeline.ts';
import { listPeople } from './store.ts';
import { checkMailHost, imapDay, MAILBOX_WORDS, openMailbox, type ImapBox, type ImapHead, type ImapSession } from './imap.ts';
import { addressesOf, contentTypeOf, freshText, headerOf, messageIdsOf, mimeParts, provedFrom, readableText, readHeaders, trustedAuthServ } from './mail-text.ts';
import { isDeliveryReport, reportedRecipients } from './bounces.ts';
import { screenMail, syncWords, triageMail, writeInbound, type ReadMail } from './inbound.ts';
import { fold } from './text.ts';
import { NO_COUNTRY } from './calendar-feed.ts';
import { HINDI_UNSUBSCRIBE_LINE } from './outreach-templates.ts';
import { settleInboundIn } from './inbound-rows.ts';
import { checkConnectorFields, mailboxConnectorOf } from '../build/connector-truth.ts';

export const HOSTED_MAILBOX = 'Connect your mailbox in the desktop app. It reads your mail on your computer.';
export const NOT_CONNECTED = 'Your mailbox is not connected. Connect it under Connections to read replies.';
export const PASSWORD_AGAIN = 'Chausar keeps your app password only while the app is open. Type it again under Connections to read new mail.';
/** How far back a first read, or a read after the mailbox's UIDs changed, goes. */
export const RESCAN_DAYS = 30;
/** The most messages one sync reads the headers of; a sync that has more goes on from there next time. */
export const MAX_SYNC_MESSAGES = 200;
/** The most of one message's text Chausar reads, in bytes. */
export const MAX_TEXT_BYTES = 16_384;
/** The longest one sync's session may take: up to 200 headers and the texts of the mail Chausar keeps. */
export const SYNC_TIMEOUT_MS = 180_000;
const SECRET = 'mailbox:password' as const;

/** The business's mailbox record, or undefined. One per business; a new connection replaces it. */
export function mailboxOf(state: State, ventureId: string): MailboxRecord | undefined {
  return listRecords(state, 'venture-mailbox', ventureId).at(-1);
}

/** The mailbox as the screens show it, in the engine's words. */
export function mailboxView(deps: VentureDeps, venture: VentureRecord, record: MailboxRecord | undefined): MailboxView {
  if (!record || record.status === 'disconnected') return { connected: false, host: record?.host ?? null, user: record?.user ?? null, lastSync: record?.lastSync ?? null, line: 'Not connected. Chausar reads no mail.', needsPassword: false };
  if (record.status === 'failed') return { connected: false, host: record.host, user: record.user, lastSync: record.lastSync, line: record.line, needsPassword: false };
  // 4E4: connected, but the password left the shelf with the last restart: the owner types it again.
  if (!deps.secrets.has(SECRET)) return { connected: true, host: record.host, user: record.user, lastSync: record.lastSync, line: PASSWORD_AGAIN, needsPassword: true };
  const when = record.lastSync && venture.country
    ? `Last read ${formatVentureDate(localDayAt(record.lastSync, venture.country), venture.country.dateOrder)} at ${localTimeAt(record.lastSync, venture.country).slice(11, 16)}.`
    : 'Not read yet.';
  return { connected: true, host: record.host, user: record.user, lastSync: record.lastSync, line: `Reading ${record.user} on ${record.host}, read-only. ${when} Chausar never sends mail or marks it read.`, needsPassword: false };
}

/** The app password as typed: one line of at most 256 characters. Never echoed in an error. */
function appPasswordOf(value: unknown): string {
  check(typeof value === 'string' && value.length >= 1 && value.length <= 256 && !/[\r\n\u0000]/.test(value), 'INVALID_VENTURE_REQUEST', 'Type the app password your mail account gave you, on one line.');
  return value;
}

/**
 * venture.mailbox.connect { host, port, user, appPassword } (approve, inside the app, never hosted): signs in and opens
 * the inbox read-only first; only then is the password put on the secret shelf and the mailbox recorded (host, port,
 * address, status, the UID cursor). The same address on the same server keeps its cursor. Refusals keep nothing.
 */
export async function mailboxConnect(deps: VentureDeps, ctx: Context, payload: unknown): Promise<MailboxView> {
  requireAppChannel(ctx, 'venture.mailbox.connect');
  const body = exactPayload(payload, ['host', 'port', 'user', 'appPassword'], ['host', 'port', 'user', 'appPassword']);
  check(deps.host !== 'hosted-web', 'TIER_UNAVAILABLE', HOSTED_MAILBOX);
  const host = checkMailHost(body.host);
  // 4J7 (K6): a Zoho Mail or Gmail server's capability set names every field an inbox read takes.
  const inbox = mailboxConnectorOf(host);
  if (inbox) checkConnectorFields(inbox, 'read-inbox', Object.keys(body));
  const port = smallInteger(body.port, 'The port', 1, 65535);
  const user = singleLine(body.user, 'Your mail address', { min: 3, max: 254 });
  const password = appPasswordOf(body.appPassword);
  authorize(deps.store, ctx, 'approve');
  check(requireVenture(deps.store.read()).country, 'INVALID_VENTURE_REQUEST', NO_COUNTRY);
  const session = await openMailbox({ host, port, user, password, resolve: deps.net?.resolve, connect: deps.net?.tls });
  try { await session.examine(); } finally { await session.logout(); }
  const previous = deps.secrets.get(SECRET);
  deps.secrets.set(SECRET, password);
  try {
    return await ventureAction(deps, ctx, 'approve', 'mailbox.connect', tx => {
      const old = mailboxOf(tx.state, tx.venture!.id);
      const same = !!old && old.host === host && old.user.toLowerCase() === user.toLowerCase() && old.port === port;
      const fields = {
        host, port, user, status: 'connected' as const, uidValidity: same ? old!.uidValidity : null, cursor: same ? old!.cursor : null,
        lastSync: same ? old!.lastSync : null, line: `Connected to ${user} on ${host}, read-only.`,
      };
      const record = old ? tx.replace<MailboxRecord>({ ...old, ...fields }) : tx.put<MailboxRecord>({ ...tx.base('venture-mailbox'), ...fields });
      return mailboxView(deps, tx.venture!, record);
    });
  } catch (error) {
    if (previous !== null) deps.secrets.set(SECRET, previous); else deps.secrets.delete(SECRET);
    throw error;
  }
}

/** venture.mailbox.disconnect {} (approve, inside the app): the password leaves the shelf and nothing more is read. */
export async function mailboxDisconnect(deps: VentureDeps, ctx: Context, payload: unknown): Promise<MailboxView> {
  requireAppChannel(ctx, 'venture.mailbox.disconnect');
  exactPayload(payload ?? {}, []);
  return ventureAction(deps, ctx, 'approve', 'mailbox.disconnect', tx => {
    deps.secrets.delete(SECRET);
    const old = mailboxOf(tx.state, tx.venture!.id);
    if (!old) return mailboxView(deps, tx.venture!, undefined);
    const record = tx.replace<MailboxRecord>({ ...old, status: 'disconnected', line: 'Disconnected. Mail Chausar already read stays with your pipeline; nothing more is read.' });
    return mailboxView(deps, tx.venture!, record);
  });
}

type Known = { emails: Set<string>; names: Set<string>; footers: string[] };

/**
 * Who the business knows, to choose which messages' text to read: every address in the network and the pipeline, and
 * every full name (two words or more) in the network, so a sender who signs with a LinkedIn address, or a name and a
 * company, can be told apart in code. A first name alone opens nothing. footers: Chausar's own unsubscribe lines (the
 * Hindi one, and each footer actually sent), which a reply may paste back and which must never read as an opt-out.
 */
function knownOf(state: State, venture: VentureRecord, today: string): Known {
  const emails = new Set<string>(), names = new Set<string>();
  for (const person of listPeople(state, venture.id)) {
    for (const email of person.handles.emails) emails.add(email);
    const name = fold(person.name);
    if (name.includes(' ')) names.add(name);
  }
  for (const card of cardsOf(state, venture, today)) for (const email of card.emails) emails.add(email);
  const footers = [HINDI_UNSUBSCRIBE_LINE];
  for (const draft of listRecords(state, 'venture-outreach', venture.id)) if (draft.sent && draft.footer?.unsubscribe) footers.push(draft.footer.unsubscribe);
  for (const lead of listRecords(state, 'venture-lead', venture.id)) for (const draft of lead.drafts) if (draft.footer?.unsubscribe) footers.push(draft.footer.unsubscribe);
  return { emails, names, footers: [...new Set(footers)] };
}

/** Bulk mail, by the header fields a list sets: never a reply, so its text is never read. */
export function isBulk(headers: ReturnType<typeof readHeaders>): boolean {
  return !!headerOf(headers, 'list-id') || !!headerOf(headers, 'list-unsubscribe') || /^(?:bulk|list|junk)\b/i.test(headerOf(headers, 'precedence') ?? '');
}

/** The instant a message came: the earliest of its Date header, the server's arrival time and now (a forged date cannot run ahead). */
function dateOf(header: string | null, internal: string | null, now: string): string {
  const times = [header, internal?.replace(/^(\d{1,2})-([A-Za-z]{3})-(\d{4}) /, '$2 $1 $3 ') ?? null, now].map(value => (value ? Date.parse(value) : NaN)).filter(Number.isFinite);
  return new Date(Math.min(...times)).toISOString();
}

/** An error of the session itself (the connection is gone), as against one message that would not read. */
const sessionError = (error: unknown) => ['MAILBOX_FAILED', 'NET_TIMEOUT', 'NET_FAILED'].includes((error as { code?: string })?.code ?? '');

/**
 * Reads the messages one sync takes: the headers of each, then the text only of those from someone Chausar knows (by
 * address, or by a full name in the network) and of delivery reports; bulk mail is skipped before any text is read. A
 * message that will not read is skipped, never the whole read. Everything else is left unread and unkept.
 */
async function readMessages(session: ImapSession, heads: ImapHead[], input: { known: Known; owner: string; now: string; uidValidity: string; host: string }): Promise<ReadMail[]> {
  const out: ReadMail[] = [];
  const trusted = trustedAuthServ(input.host);
  for (const head of heads) {
    try {
      const headers = readHeaders(head.header);
      const from = addressesOf(headerOf(headers, 'from'))[0];
      if (!from || from.email === input.owner) continue;
      const type = contentTypeOf(headerOf(headers, 'content-type'));
      const report = isDeliveryReport(type);
      if (!report && isBulk(headers)) continue;
      const named = !!from.name && input.known.names.has(fold(from.name));
      if (!report && !input.known.emails.has(from.email) && !named) continue;
      const raw = await session.fetchText(head.uid, MAX_TEXT_BYTES);
      if (!raw) continue;
      const parts = mimeParts(type, headerOf(headers, 'content-transfer-encoding'), raw);
      const recipients = report ? reportedRecipients(parts) : null;
      if (report && !recipients!.some(item => input.known.emails.has(item.address))) continue;
      const subject = (headerOf(headers, 'subject') ?? '').replace(/\s+/g, ' ').trim();
      const readable = report ? '' : readableText(parts);
      const text = freshText(readable, input.known.footers);
      const to = [...addressesOf(headerOf(headers, 'to')), ...addressesOf(headerOf(headers, 'cc'))].map(item => item.email).filter(email => email === input.owner);
      out.push({
        messageId: messageIdsOf(headerOf(headers, 'message-id'), 1)[0] ?? `<uid.${input.uidValidity}.${head.uid}@mailbox>`,
        from, to: [...new Set(to)], date: dateOf(headerOf(headers, 'date'), head.internalDate, input.now), subject,
        references: messageIdsOf(`${headerOf(headers, 'in-reply-to') ?? ''} ${headerOf(headers, 'references') ?? ''}`), headers, text, whole: readable.slice(0, 8000), report: recipients,
        proved: provedFrom(headers, from.email.split('@')[1] ?? '', trusted), triage: triageMail({ headers, subject, text, report }),
      });
    } catch (error) {
      if (sessionError(error)) throw error;
      // One message that would not read is left for the owner's own mail app; the read goes on.
    }
  }
  return out;
}

/** Records a sign-in the server refused: the mailbox reads as failed, with the reason, and the password leaves the shelf. */
async function recordFailure(deps: VentureDeps, ctx: Context, line: string): Promise<void> {
  deps.secrets.delete(SECRET);
  await ventureAction(deps, ctx, 'prepare', 'mailbox.failed', tx => {
    const old = mailboxOf(tx.state, tx.venture!.id);
    if (old) tx.replace<MailboxRecord>({ ...old, status: 'failed', line });
  }).catch(() => { /* the refusal itself still reaches the owner */ });
}

/** The most UID SEARCH calls one sync makes, whatever the windows hold. */
export const MAX_SEARCHES = 40;

/** The first MAX_SYNC_MESSAGES of the UIDs found, and the cursor that leaves none unread: the last read, or the end searched. */
function capped(found: number[], end: number): { uids: number[]; cursor: number } {
  const uids = [...new Set(found)].sort((a, b) => a - b);
  return uids.length > MAX_SYNC_MESSAGES ? { uids: uids.slice(0, MAX_SYNC_MESSAGES), cursor: uids[MAX_SYNC_MESSAGES - 1] } : { uids, cursor: end };
}

/**
 * The UIDs one sync reads, by windows of MAX_SYNC_MESSAGES UIDs and at most MAX_SEARCHES searches. Past the cursor the
 * windows step forward until 200 messages are found or UIDNEXT is reached, over any gap in the UIDs. With no cursor, or
 * a changed UIDVALIDITY, they step back from UIDNEXT with the 30 days on each, over gaps (a window with no messages at
 * all), until one holds only older mail (the 30-day mark), then what they found is read oldest first. cursor: where the
 * next sync starts, never past a message found and not read. A server that gives no UIDNEXT is read past the cursor.
 */
async function windowOf(session: ImapSession, box: ImapBox, record: MailboxRecord, sinceDay: string): Promise<{ uids: number[]; cursor: number | null }> {
  const same = record.uidValidity === box.uidValidity && record.cursor !== null;
  const since = Number(record.cursor ?? '0');
  const next = box.uidNext;
  let searches = 0;
  const search = (criteria: string) => { searches += 1; return session.uidSearch(criteria); };
  if (same) {
    if (next === null) {
      const uids = (await search(`UID ${since + 1}:*`)).filter(uid => uid > since);
      return capped(uids, uids.at(-1) ?? since);
    }
    const found: number[] = [];
    let end = since;
    for (let a = since + 1; a <= next - 1 && found.length < MAX_SYNC_MESSAGES && searches < MAX_SEARCHES; a += MAX_SYNC_MESSAGES) {
      const b = Math.min(a + MAX_SYNC_MESSAGES - 1, next - 1);
      found.push(...(await search(`UID ${a}:${b}`)).filter(uid => uid >= a && uid <= b));
      end = b;
    }
    return capped(found, end);
  }
  if (next === null) {
    const uids = await search(`SINCE ${sinceDay}`);
    return capped(uids, uids.at(-1) ?? 0);
  }
  const found: number[] = [];
  for (let b = next - 1; b >= 1 && searches < MAX_SEARCHES - 1; b -= MAX_SYNC_MESSAGES) {
    const a = Math.max(1, b - MAX_SYNC_MESSAGES + 1);
    const recent = (await search(`UID ${a}:${b} SINCE ${sinceDay}`)).filter(uid => uid >= a && uid <= b);
    found.push(...recent);
    // A window with no recent mail: either a gap in the UIDs (go on) or only older mail (the 30-day mark: stop).
    if (!recent.length && (await search(`UID ${a}:${b}`)).some(uid => uid >= a && uid <= b)) break;
  }
  return capped(found, next - 1);
}

/**
 * venture.mailbox.sync {} (prepare, never hosted): reads one window of new mail past the UID cursor, or the last 30
 * days when there is none or the mailbox's UIDVALIDITY changed. Each message from someone in the network or the
 * pipeline is screened and triaged in code and kept as venture-inbound (inbound.ts); nothing else is kept. One
 * transaction writes them, settles any reply whose row can no longer be, and moves the cursor; a failure writes
 * nothing. A refused sign-in marks the mailbox failed.
 */
export async function mailboxSync(deps: VentureDeps, ctx: Context, payload: unknown): Promise<MailboxSync> {
  exactPayload(payload ?? {}, []);
  check(deps.host !== 'hosted-web', 'TIER_UNAVAILABLE', HOSTED_MAILBOX);
  const { state, venture } = readVenture(deps, ctx);
  authorize(deps.store, ctx, 'prepare');
  check(venture.country, 'INVALID_VENTURE_REQUEST', NO_COUNTRY);
  const record = mailboxOf(state, venture.id);
  check(record && record.status === 'connected', 'MAILBOX_NOT_CONNECTED', record?.status === 'failed' ? record.line : NOT_CONNECTED);
  const password = deps.secrets.get(SECRET);
  check(password, 'MAILBOX_NOT_CONNECTED', PASSWORD_AGAIN);
  const now = deps.clock().toISOString();
  let session: ImapSession;
  try {
    session = await openMailbox({ host: record.host, port: record.port, user: record.user, password, resolve: deps.net?.resolve, connect: deps.net?.tls, timeoutMs: SYNC_TIMEOUT_MS });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'MAILBOX_LOGIN_FAILED' || code === 'MAILBOX_OAUTH_ONLY') await recordFailure(deps, ctx, (error as Error).message);
    throw error;
  }
  let mails: ReadMail[];
  let box: ImapBox;
  let cursor: number | null;
  try {
    box = await session.examine();
    const window = await windowOf(session, box, record, imapDay(addDays(localDayAt(now, venture.country), -RESCAN_DAYS)));
    cursor = window.cursor;
    const heads: ImapHead[] = [];
    for (let i = 0; i < window.uids.length; i += 50) heads.push(...await session.fetchHeaders(window.uids.slice(i, i + 50)));
    const known = knownOf(state, venture, localDayAt(now, venture.country));
    mails = await readMessages(session, heads, { known, owner: record.user.toLowerCase(), now, uidValidity: box.uidValidity, host: record.host });
  } finally {
    await session.logout();
  }
  return ventureAction(deps, ctx, 'prepare', 'mailbox.sync', tx => {
    const v = tx.venture!;
    const effects: NonNullable<ReturnType<typeof writeInbound>>[] = [];
    for (const mail of mails) {
      const screen = screenMail(tx.state, v, mail.subject, mail.text);
      const effect = writeInbound(tx, mail, screen, record.user);
      if (effect) effects.push(effect);
    }
    settleInboundIn(tx);
    const line = syncWords(effects);
    const old = mailboxOf(tx.state, v.id);
    if (!old || old.status !== 'connected') throw new ChausarError('MAILBOX_NOT_CONNECTED', NOT_CONNECTED);
    const kept = cursor === null && old.uidValidity === box.uidValidity ? old.cursor : cursor === null ? null : String(cursor);
    const updated = tx.replace<MailboxRecord>({ ...old, uidValidity: box.uidValidity, cursor: kept, lastSync: tx.now, line });
    if (effects.some(effect => effect.needsYou)) tx.emit('queue.changed', {});
    return { mailbox: mailboxView(deps, v, updated), added: effects.length, line };
  });
}

export { MAILBOX_WORDS };
