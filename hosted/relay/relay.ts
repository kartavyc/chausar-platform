import { createHash, hkdfSync } from 'node:crypto';
import type { HostedDeps, HostedModule } from '../shared/module.ts';
import type { Router, HostedRequest } from '../shared/http.ts';
import { fields, json, ok } from '../shared/http.ts';
import { HostedError, check } from '../shared/errors.ts';
import { hmacHex, isLetterToken, letterToken, newId, openServer, sameHex, sameText, sealServer, secretHash } from '../shared/crypto.ts';
import { monthKey } from '../shared/clock.ts';
import { CHANNELS, DESTINATION_OF, MAIL_TEXT, MESSAGE_EVENTS, OPT_IN_TEXT, REPLIES, hasDigit } from '../shared/templates.ts';
import type { Channel, Destination, MessageEvent } from '../shared/templates.ts';
import type { Sql, Row } from '../db/sql.ts';
import { PermanentJobError } from '../db/queue.ts';
import type { Job, Worker } from '../db/queue.ts';
import { MAIL_ADDRESS } from './channels.ts';
import type { OutboundTemplate } from './channels.ts';
import type { RelayOptions } from './config.ts';
import { createRelayDocuments } from './documents.ts';
import type { InboundDocument } from './documents.ts';
import { createMailVerify } from './mail-verify.ts';
import type { MailConfirmPages } from './mail-verify.ts';
import { createMailInbound } from './mail-inbound.ts';
import { createBusinessStatuses } from './business-statuses.ts';

export { relayConfig, parseRelayPrices } from './config.ts';
export type { RelayOptions, RelayPrices } from './config.ts';

export const BUTTON_MS = 30 * 60000, CONNECT_MS = 30 * 60000, OPEN_LINK_MS = 7 * 86400000, SERVICE_WINDOW_MS = 24 * 3600000;
export const DISPATCH_JOB = 'relay.dispatch';
/** Help tickets one account (or one sender no account owns) may open in twenty-four hours. Further HELPs get the reply and open nothing. */
export const HELP_TICKETS_PER_DAY = 3;
export type Decision = 'approve' | 'not-now';
type ReplyKey = keyof typeof REPLIES;
/** The one single-use decision path, shared by chat buttons and the mail link page. */
export type RelayButtons = {
  /** Where an Open the app link hands over to, or null when the token is unknown or expired. Consumes nothing. */
  openDestination(token: string): Promise<Destination | null>;
  /** Which decision a still-usable button would make. Consumes nothing (mail scanners prefetch links). */
  peek(token: string, channel: Channel): Promise<Decision | null>;
  /** Decides once. `sender` is the wa_id or Telegram user id for chat presses; null for the mail page (tokens offered before mail offers stopped). */
  decide(token: string, channel: Channel, sender: string | null): Promise<Decision | null>;
};
export type RelayModule = HostedModule & {
  readonly buttons: RelayButtons;
  /** The mail address confirmation link page (/v/:token). */
  readonly mailConfirm: MailConfirmPages;
  /** Server-side sends (the always-on worker): one fixed template, no offer, on the first channel that is on. */
  notify(accountId: string, event: MessageEvent, idempotencyKey: string): Promise<{ messageId: string; channel: Channel }>;
};

const SEALED_FORMAT = 'chausar-relay-sealed-v1';
const RETRYABLE = new Set(['PROVIDER_FAILED', 'PROVIDER_UNREACHABLE']);
const STATUS_RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 2 };
type Sealed = { nonce: string; ciphertext: string };

/** https, no path, and no digit, so a link inside a message never carries one. */
export function checkLinkOrigin(origin: string): string {
  let url: URL | undefined;
  try { url = new URL(origin); } catch { url = undefined; }
  if (!url || url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash
    || origin.replace(/\/$/, '') !== url.origin || hasDigit(url.origin)) throw new HostedError('LINK_ORIGIN_INVALID', 'The link origin must be an https origin without digits.', 500);
  return url.origin;
}
function strictBase64(value: unknown, min: number, max: number): value is string {
  if (typeof value !== 'string' || value.length > 8192 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return false;
  const bytes = Buffer.from(value, 'base64');
  return bytes.toString('base64') === value && bytes.length >= min && bytes.length <= max;
}
function sealedBlob(value: unknown): Sealed {
  const blob = fields<{ format: string; nonce: string; ciphertext: string }>(value, ['format', 'nonce', 'ciphertext']);
  check(blob.format === SEALED_FORMAT && strictBase64(blob.nonce, 12, 12) && strictBase64(blob.ciphertext, 16, 4096), 'OFFER_INVALID', 'The sealed offer is not valid.');
  return { nonce: blob.nonce, ciphertext: blob.ciphertext };
}
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const isoOf = (value: unknown) => value == null ? null : new Date(value as string).toISOString();
const list = (value: unknown, max = 100): any[] => Array.isArray(value) ? value.slice(0, max) : [];
const maskPhone = (phone: string) => `${phone.slice(0, 3)}${'•'.repeat(Math.max(0, phone.length - 7))}${phone.slice(-4)}`;
const maskMail = (address: string) => { const at = address.lastIndexOf('@'); return `${address[0]}•••${address.slice(at)}`; };

export function createRelayModule(deps: HostedDeps, options: RelayOptions): RelayModule {
  const linkOrigin = checkLinkOrigin(deps.linkOrigin);
  secretHash(deps.pepper, 'relay-check', 'pepper');
  const sealKey = Buffer.from(hkdfSync('sha256', deps.pepper, 'chausar-relay', 'relay-seal', 32));
  const adapters = { whatsapp: options.whatsapp, telegram: options.telegram, mail: options.mail };
  const documents = createRelayDocuments(deps, options.documents ?? {});
  const now = () => deps.clock();
  const tokenHash = (token: string) => secretHash(deps.pepper, 'relay-button', token);
  const recipientHash = (channel: Channel, id: string) => secretHash(deps.pepper, 'relay-recipient', `${channel}:${id}`);
  const addressAad = (accountId: string, channel: Channel) => `relay-address:${accountId}:${channel}`;

  /** `verified`: mail once its address was confirmed; WhatsApp while it is on for the account's current OTP-verified phone; Telegram while bound and on. */
  async function channelView(sql: Sql, accountId: string, channel: Channel, row: Row | undefined) {
    let verified = false;
    if (row?.recipient_hash && channel === 'mail') verified = !!row.confirmed_hash && sameHex(row.confirmed_hash, row.recipient_hash);
    else if (row?.recipient_hash && row.status === 'on' && channel === 'whatsapp') {
      const { rows: [account] } = await sql.query('SELECT phone FROM accounts WHERE id = $1', [accountId]);
      verified = typeof account?.phone === 'string' && /^\+[1-9][0-9]{7,14}$/.test(account.phone) && sameHex(row.recipient_hash, recipientHash('whatsapp', account.phone.slice(1)));
    } else if (row?.recipient_hash && row.status === 'on') verified = true;
    return { channel, status: adapters[channel] ? (row?.status ?? 'off') : 'not-configured', optInAt: isoOf(row?.opt_in_at), address: row?.address_mask ?? null, verified };
  }
  async function refuse(sql: Sql, reason: string, channel: Channel, accountId: string | null = null, messageId: string | null = null) {
    await sql.query('INSERT INTO relay_refusals (id, account_id, message_id, channel, reason, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [newId('rrf'), accountId, messageId, channel, reason, now().toISOString()]);
  }

  // ---- the single-use decision path
  async function decide(sql: Sql, token: string, channel: Channel, sender: string | null): Promise<Decision | null> {
    if (!isLetterToken(token)) { await refuse(sql, 'unknown', channel); return null; }
    const hash = tokenHash(token);
    return sql.transaction(async tx => {
      const at = now();
      const { rows: [found] } = await tx.query('SELECT message_id FROM relay_buttons WHERE token_hash = $1 AND kind IN ($2, $3)', [hash, 'approve', 'not-now']);
      if (!found) { await refuse(tx, 'unknown', channel); return null; }
      const { rows: [message] } = await tx.query('SELECT id, account_id, device_id, channel, decided, expires_at FROM relay_messages WHERE id = $1 FOR UPDATE', [found.message_id]);
      const { rows: [button] } = await tx.query('SELECT kind, used_at, expires_at FROM relay_buttons WHERE token_hash = $1', [hash]);
      if (!message || !button) { await refuse(tx, 'unknown', channel); return null; }
      const no = async (reason: string) => { await refuse(tx, reason, channel, message.account_id, message.id); return null; };
      if (message.channel !== channel) return no('wrong-channel');
      const { rows: [owner] } = await tx.query('SELECT status, recipient_hash FROM relay_channels WHERE account_id = $1 AND channel = $2', [message.account_id, channel]);
      if (channel !== 'mail' && (!sender || !owner?.recipient_hash || !sameHex(owner.recipient_hash, recipientHash(channel, sender)))) return no('not-owner');
      // After STOP, or with the channel turned off from the desktop, a press decides nothing.
      if (owner?.status !== 'on') return no('channel-off');
      if (button.used_at) return no('used');
      if (message.decided) return no('decided');
      if (new Date(button.expires_at) <= at || new Date(message.expires_at) <= at) return no('expired');
      const { rows: [offer] } = await tx.query('SELECT * FROM relay_offers WHERE message_id = $1', [message.id]);
      if (!offer) return no('expired');
      const decision = button.kind as Decision;
      await tx.query('UPDATE relay_messages SET decided = $2, decided_at = $3, updated_at = $3 WHERE id = $1 AND decided IS NULL', [message.id, decision, at.toISOString()]);
      await tx.query(`UPDATE relay_buttons SET used_at = $2 WHERE message_id = $1 AND kind IN ('approve', 'not-now') AND used_at IS NULL`, [message.id, at.toISOString()]);
      const sealed = decision === 'approve' ? { nonce: offer.approve_nonce, ciphertext: offer.approve_ciphertext } : { nonce: offer.not_now_nonce, ciphertext: offer.not_now_ciphertext };
      await tx.query(`INSERT INTO relay_envelopes (id, account_id, device_id, message_id, purpose, decision, channel, created_at, expires_at, nonce, ciphertext)
        VALUES ($1, $2, $3, $4, 'approval-intent', $5, $6, $7, $8, $9, $10)`,
        [newId('env'), message.account_id, message.device_id, message.id, decision, channel, at.toISOString(), isoOf(message.expires_at), sealed.nonce, sealed.ciphertext]);
      return decision;
    });
  }
  const buttons: RelayButtons = {
    async openDestination(token) {
      if (!isLetterToken(token)) return null;
      const { rows: [row] } = await deps.sql.query(`SELECT m.event FROM relay_buttons b JOIN relay_messages m ON m.id = b.message_id
        WHERE b.token_hash = $1 AND b.kind = 'open' AND b.expires_at > $2`, [tokenHash(token), now().toISOString()]);
      return row ? DESTINATION_OF[row.event as MessageEvent] : null;
    },
    async peek(token, channel) {
      if (!isLetterToken(token)) return null;
      const { rows: [row] } = await deps.sql.query(`SELECT b.kind FROM relay_buttons b JOIN relay_messages m ON m.id = b.message_id
        JOIN relay_channels c ON c.account_id = m.account_id AND c.channel = m.channel AND c.status = 'on'
        WHERE b.token_hash = $1 AND b.kind IN ('approve', 'not-now') AND b.used_at IS NULL AND b.expires_at > $2 AND m.decided IS NULL AND m.channel = $3`,
        [tokenHash(token), now().toISOString(), channel]);
      return row ? row.kind as Decision : null;
    },
    decide: (token, channel, sender) => decide(deps.sql, token, channel, sender),
  };

  // ---- fixed replies, sent on the queue inside the service window
  async function queueReply(sql: Sql, input: { channel: Channel; accountId: string | null; key: ReplyKey; to: string; callback?: string; inboundAt: Date }) {
    const id = newId('msg'), at = now();
    await sql.query(`INSERT INTO relay_messages (id, account_id, kind, reply_key, channel, month, buttons, reply_recipient_sealed, reply_callback, window_until, created_at, updated_at)
      VALUES ($1, $2, 'reply', $3, $4, $5, 'none', $6, $7, $8, $9, $9)`,
      [id, input.accountId, input.key, input.channel, monthKey(at), sealServer(sealKey, input.to, `relay-reply:${id}`), input.callback ?? null,
        new Date(input.inboundAt.getTime() + SERVICE_WINDOW_MS).toISOString(), at.toISOString()]);
    await deps.queue.enqueue({ type: DISPATCH_JOB, accountId: input.accountId, payload: { messageId: id }, dedupeKey: `relay:${id}` }, sql);
  }
  /** Records that an inbound event arrived (never its content). False when the provider already delivered it. */
  async function arrived(sql: Sql, channel: Channel, providerEventId: string, accountId: string | null, kind: string): Promise<boolean> {
    const { rowCount } = await sql.query('INSERT INTO relay_inbound (id, channel, event_hash, account_id, kind, created_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (event_hash) DO NOTHING',
      [newId('rin'), channel, secretHash(deps.pepper, 'relay-inbound', `${channel}:${providerEventId}`), accountId, kind, now().toISOString()]);
    return rowCount === 1;
  }
  /**
   * The one account a chat, number or confirmed mail address belongs to. A live binding (any status but 'off'; for mail,
   * only a confirmed address) wins; with none, a single turned-off binding still names its account. More than one
   * candidate is never resolved by guessing: the sender then belongs to nobody.
   */
  async function ownerOf(sql: Sql, channel: Channel, sender: string): Promise<string | null> {
    const { rows } = await sql.query(`SELECT account_id, status <> 'off' AS live FROM relay_channels WHERE channel = $1 AND recipient_hash = $2
      AND ($1 <> 'mail' OR confirmed_hash = recipient_hash) LIMIT 50`, [channel, recipientHash(channel, sender)]);
    const live = rows.filter(row => row.live);
    if (live.length) return live.length === 1 ? live[0].account_id : null;
    return rows.length === 1 ? rows[0].account_id : null;
  }
  /** Whether the recipient is bound, live, to an account other than `accountId` (the rule the unique index enforces). */
  async function boundElsewhere(sql: Sql, channel: Channel, hash: string, accountId: string): Promise<boolean> {
    const { rows } = await sql.query(`SELECT 1 FROM relay_channels WHERE channel = $1 AND recipient_hash = $2 AND account_id <> $3 AND status <> 'off'
      AND ($1 <> 'mail' OR confirmed_hash = recipient_hash) LIMIT 1`, [channel, hash, accountId]);
    return rows.length > 0;
  }
  /** HELP, STOP and START act only on the sender's own account's channel; a sender no account owns changes nothing. */
  async function command(sql: Sql, channel: Channel, sender: string, accountId: string | null, kind: 'help' | 'stop' | 'start'): Promise<ReplyKey> {
    const at = now(), hash = recipientHash(channel, sender);
    if (kind === 'help') {
      // The account (or the unknown sender) is the lock, so concurrent HELPs cannot open more than the limit.
      const key = accountId ? `account:${accountId}` : `sender:${hash}`;
      await sql.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`relay-help:${key}`]);
      const since = new Date(at.getTime() - 24 * 3600000).toISOString();
      const { rows: [counted] } = accountId
        ? await sql.query('SELECT count(*)::int AS n FROM relay_help_requests WHERE account_id = $1 AND created_at > $2', [accountId, since])
        : await sql.query('SELECT count(*)::int AS n FROM relay_help_requests WHERE account_id IS NULL AND sender_hash = $1 AND created_at > $2', [hash, since]);
      if (counted.n < HELP_TICKETS_PER_DAY) await sql.query('INSERT INTO relay_help_requests (id, account_id, channel, sender_hash, created_at) VALUES ($1, $2, $3, $4, $5)',
        [newId('rhp'), accountId, channel, hash, at.toISOString()]);
      return 'help';
    }
    if (!accountId) return kind === 'stop' ? 'stop' : 'freeText';
    if (kind === 'stop') {
      await sql.query(`UPDATE relay_channels SET status = 'stopped', stopped_at = $4, updated_at = $4 WHERE account_id = $1 AND channel = $2 AND recipient_hash = $3`,
        [accountId, channel, hash, at.toISOString()]);
      return 'stop';
    }
    // START never revives a binding another account now holds live (the unique index would refuse it anyway).
    if (await boundElsewhere(sql, channel, hash, accountId)) return 'freeText';
    const { rowCount } = await sql.query(`UPDATE relay_channels SET status = 'on', stopped_at = NULL, updated_at = $4
      WHERE account_id = $1 AND channel = $2 AND recipient_hash = $3 AND status = 'stopped' AND enabled AND opt_in_at IS NOT NULL`, [accountId, channel, hash, at.toISOString()]);
    return rowCount ? 'start' : 'freeText';
  }
  const textCommand = (text: string): 'help' | 'stop' | 'start' | 'text' => {
    const word = text.trim().toUpperCase().replace(/^\//, '');
    return word === 'HELP' ? 'help' : word === 'STOP' ? 'stop' : word === 'START' ? 'start' : 'text';
  };
  const decisionReply = (decision: Decision | null): ReplyKey => decision === 'approve' ? 'approved' : decision === 'not-now' ? 'notNow' : 'buttonGone';

  async function inboundWhatsApp(message: any) {
    const from = typeof message?.from === 'string' && /^[1-9][0-9]{7,14}$/.test(message.from) ? message.from : null;
    const id = typeof message?.id === 'string' && message.id.length <= 256 ? message.id : null;
    if (!from || !id) return;
    const seconds = Number(message.timestamp), inboundAt = Number.isFinite(seconds) && seconds > 0 ? new Date(Math.min(seconds * 1000, now().getTime())) : now();
    const token = message.type === 'button' ? message.button?.payload : message.type === 'interactive' && message.interactive?.type === 'button_reply' ? message.interactive.button_reply?.id : undefined;
    const kind = token !== undefined ? 'button' : message.type === 'document' || message.type === 'image' ? 'document'
      : message.type === 'text' && typeof message.text?.body === 'string' && message.text.body.length <= 4096 ? textCommand(message.text.body) : 'other';
    await deps.sql.transaction(async tx => {
      const accountId = await ownerOf(tx, 'whatsapp', from);
      if (!await arrived(tx, 'whatsapp', id, accountId, kind)) return;
      // A document from the opted-in owner is queued for a sealed download (documents.ts); anyone else's is only acknowledged.
      if (kind === 'document') await documents.received(tx, whatsappDocument(message, accountId));
      const key: ReplyKey = kind === 'button' ? decisionReply(typeof token === 'string' ? await decide(tx, token, 'whatsapp', from) : null)
        : kind === 'document' ? 'documentReceived' : kind === 'help' || kind === 'stop' || kind === 'start' ? await command(tx, 'whatsapp', from, accountId, kind) : 'freeText';
      await queueReply(tx, { channel: 'whatsapp', accountId, key, to: from, inboundAt });
    });
  }
  function whatsappDocument(message: any, accountId: string | null): InboundDocument {
    const media = message.type === 'document' ? message.document : message.image;
    return { channel: 'whatsapp', accountId, ref: typeof media?.id === 'string' ? media.id : '', declaredType: typeof media?.mime_type === 'string' ? media.mime_type : null, declaredSize: null };
  }
  function telegramDocument(message: any, accountId: string | null): InboundDocument {
    const photo = Array.isArray(message.photo) ? message.photo.slice(0, 20).filter((size: any) => typeof size?.file_id === 'string').at(-1) : undefined;
    const media = message.document && typeof message.document === 'object' ? message.document : photo;
    return { channel: 'telegram', accountId, ref: typeof media?.file_id === 'string' ? media.file_id : '', declaredType: typeof media?.mime_type === 'string' ? media.mime_type : photo ? 'image/jpeg' : null,
      declaredSize: Number.isSafeInteger(media?.file_size) ? media.file_size : null };
  }
  async function statusUpdate(status: any) {
    const id = typeof status?.id === 'string' && status.id.length <= 256 ? status.id : null, rank = STATUS_RANK[status?.status];
    if (!id || !rank || !Object.hasOwn(STATUS_RANK, status.status)) return;
    await deps.sql.query(`UPDATE relay_messages SET status = $2, updated_at = $4, last_error = CASE WHEN $2 = 'failed' THEN 'PROVIDER_FAILED' ELSE last_error END
      WHERE channel = 'whatsapp' AND provider_message_id = $1 AND (CASE status WHEN 'queued' THEN 0 WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 ELSE 9 END) < $3`,
      [id, status.status, rank, now().toISOString()]);
  }
  async function connectTelegram(sql: Sql, token: string, chatId: string): Promise<{ accountId: string; on: boolean } | null> {
    if (!isLetterToken(token)) return null;
    const at = now().toISOString();
    const { rows: [row] } = await sql.query('UPDATE relay_connect_tokens SET used_at = $2 WHERE token_hash = $1 AND used_at IS NULL AND expires_at > $2 RETURNING account_id',
      [secretHash(deps.pepper, 'relay-connect', token), at]);
    if (!row) return null;
    // A chat bound to another account stays where it is: the link is used up and the press is recorded, nothing else.
    const hash = recipientHash('telegram', chatId);
    if (await boundElsewhere(sql, 'telegram', hash, row.account_id)) { await refuse(sql, 'chat-in-use', 'telegram', row.account_id); return null; }
    const { rows: [bound] } = await sql.query(`UPDATE relay_channels SET recipient_hash = $3, address_sealed = $4, address_mask = $5, stopped_at = NULL, updated_at = $6,
      status = CASE WHEN enabled AND opt_in_at IS NOT NULL THEN 'on' ELSE status END WHERE account_id = $1 AND channel = $2 RETURNING status`,
      [row.account_id, 'telegram', hash, sealServer(sealKey, chatId, addressAad(row.account_id, 'telegram')), `••${chatId.slice(-2)}`, at]);
    return { accountId: row.account_id, on: bound?.status === 'on' };
  }
  async function inboundTelegram(update: any) {
    if (!Number.isSafeInteger(update?.update_id)) return;
    const eventId = String(update.update_id), callback = update.callback_query, message = update.message;
    if (callback && typeof callback === 'object') {
      const sender = Number.isSafeInteger(callback.from?.id) ? String(callback.from.id) : null, callbackId = typeof callback.id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(callback.id) ? callback.id : null;
      if (!sender || !callbackId) return;
      await deps.sql.transaction(async tx => {
        const accountId = await ownerOf(tx, 'telegram', sender);
        if (!await arrived(tx, 'telegram', eventId, accountId, 'button')) return;
        const key = decisionReply(typeof callback.data === 'string' ? await decide(tx, callback.data, 'telegram', sender) : null);
        await queueReply(tx, { channel: 'telegram', accountId, key, to: sender, callback: callbackId, inboundAt: now() });
      });
      return;
    }
    if (!message || typeof message !== 'object' || message.chat?.type !== 'private' || !Number.isSafeInteger(message.chat?.id)) return;
    const chatId = String(message.chat.id), text = typeof message.text === 'string' && message.text.length <= 4096 ? message.text : null;
    const seconds = Number(message.date), inboundAt = Number.isFinite(seconds) && seconds > 0 ? new Date(Math.min(seconds * 1000, now().getTime())) : now();
    const connect = text ? /^\/start\s+(\S+)$/.exec(text.trim()) : null;
    const kind = connect ? 'connect' : text ? textCommand(text) : message.document || Array.isArray(message.photo) ? 'document' : 'other';
    await deps.sql.transaction(async tx => {
      let accountId = await ownerOf(tx, 'telegram', chatId);
      if (!await arrived(tx, 'telegram', eventId, accountId, kind)) return;
      let key: ReplyKey;
      if (connect) { const bound = await connectTelegram(tx, connect[1], chatId); accountId = bound?.accountId ?? accountId; key = bound ? (bound.on ? 'start' : 'freeText') : 'buttonGone'; }
      else if (kind === 'document') { await documents.received(tx, telegramDocument(message, accountId)); key = 'documentReceived'; }
      else key = kind === 'help' || kind === 'stop' || kind === 'start' ? await command(tx, 'telegram', chatId, accountId, kind) : 'freeText';
      await queueReply(tx, { channel: 'telegram', accountId, key, to: chatId, inboundAt });
    });
  }
  function webhookJson(request: HostedRequest): any {
    try { return JSON.parse(request.body.toString('utf8')); } catch { throw new HostedError('INVALID_JSON', 'The request body is not valid JSON.'); }
  }

  // ---- the dispatch job
  async function recipientFor(message: Row): Promise<string> {
    const channel = message.channel as Channel;
    const { rows: [row] } = await deps.sql.query('SELECT status, recipient_hash, address_sealed FROM relay_channels WHERE account_id = $1 AND channel = $2', [message.account_id, channel]);
    check(row?.status === 'on', 'CHANNEL_OFF', 'This channel is not on.', 409);
    if (channel === 'whatsapp') {
      const { rows: [account] } = await deps.sql.query('SELECT phone FROM accounts WHERE id = $1', [message.account_id]);
      const to = typeof account?.phone === 'string' && /^\+[1-9][0-9]{7,14}$/.test(account.phone) ? account.phone.slice(1) : null;
      check(to && row.recipient_hash && sameHex(row.recipient_hash, recipientHash('whatsapp', to)), 'RECIPIENT_CHANGED', 'The verified phone changed since the opt-in.', 409);
      return to;
    }
    check(row.address_sealed, 'RECIPIENT_MISSING', 'The channel has no recipient.', 409);
    try { return openServer(sealKey, row.address_sealed, addressAad(message.account_id, channel)); } catch { throw new HostedError('RECIPIENT_INVALID', 'The stored recipient is not valid.', 500); }
  }
  async function sendTemplate(message: Row): Promise<string> {
    const channel = message.channel as Channel, adapter = adapters[channel];
    check(adapter, 'CHANNEL_NOT_CONFIGURED', 'This channel is not configured.', 503);
    const to = await recipientFor(message);
    const openToken = letterToken(), offered = message.buttons === 'approve-not-now-open';
    const offer = offered ? { approveToken: letterToken(), notNowToken: letterToken() } : null;
    const at = now().toISOString();
    await deps.sql.transaction(async tx => {
      await tx.query('DELETE FROM relay_buttons WHERE message_id = $1', [message.id]);
      const insert = (token: string, kind: string, expires: unknown) => tx.query('INSERT INTO relay_buttons (token_hash, message_id, kind, expires_at, created_at) VALUES ($1, $2, $3, $4, $5)', [tokenHash(token), message.id, kind, isoOf(expires), at]);
      await insert(openToken, 'open', message.open_expires_at);
      if (offer) { await insert(offer.approveToken, 'approve', message.expires_at); await insert(offer.notNowToken, 'not-now', message.expires_at); }
    });
    const outbound: OutboundTemplate = { event: message.event, linkOrigin, openToken, offer };
    return adapter.sendTemplate(deps.fetch, to, outbound);
  }
  async function sendReply(message: Row): Promise<string | null> {
    const channel = message.channel as Channel, text = REPLIES[message.reply_key as ReplyKey];
    check(text && message.reply_recipient_sealed && new Date(message.window_until) > now(), 'SERVICE_WINDOW_CLOSED', 'The reply window has closed.', 409);
    let to: string;
    try { to = openServer(sealKey, message.reply_recipient_sealed, `relay-reply:${message.id}`); } catch { throw new HostedError('RECIPIENT_INVALID', 'The stored recipient is not valid.', 500); }
    if (channel === 'whatsapp') { check(adapters.whatsapp, 'CHANNEL_NOT_CONFIGURED', 'This channel is not configured.', 503); return adapters.whatsapp.sendText(deps.fetch, to, text); }
    if (channel === 'telegram') {
      check(adapters.telegram, 'CHANNEL_NOT_CONFIGURED', 'This channel is not configured.', 503);
      if (message.reply_callback) { await adapters.telegram.answerCallback(deps.fetch, message.reply_callback, text); return null; }
      return adapters.telegram.sendText(deps.fetch, to, text);
    }
    check(adapters.mail, 'CHANNEL_NOT_CONFIGURED', 'This channel is not configured.', 503);
    return adapters.mail.sendText(deps.fetch, to, MAIL_TEXT.replySubject, text);
  }
  /** Queues one fixed template under the month lock: idempotency, opt-in and the budget of thirty are decided together. */
  async function queueTemplate(accountId: string, deviceId: string | null, event: MessageEvent, channel: Channel, key: string, offer: { approve: Sealed; notNow: Sealed } | null) {
    const entitlements = await deps.entitlements(accountId);
    check(entitlements.relay, 'PLAN_REQUIRED', 'The relay is part of the paid plan.', 402);
    check(adapters[channel], 'CHANNEL_NOT_CONFIGURED', 'This channel is not configured.', 503);
    const digest = sha256(JSON.stringify([event, channel, offer && [offer.approve.nonce, offer.approve.ciphertext, offer.notNow.nonce, offer.notNow.ciphertext]]));
    const at = now(), month = monthKey(at), budget = entitlements.monthlyMessages;
    return deps.sql.transaction(async tx => {
      // The month row is the per-account lock: idempotency and the budget are decided under it.
      await tx.query('INSERT INTO relay_months (account_id, month) VALUES ($1, $2) ON CONFLICT DO NOTHING', [accountId, month]);
      const { rows: [counter] } = await tx.query('SELECT sent FROM relay_months WHERE account_id = $1 AND month = $2 FOR UPDATE', [accountId, month]);
      const { rows: [prior] } = await tx.query('SELECT id, request_digest, status FROM relay_messages WHERE account_id = $1 AND idempotency_key = $2', [accountId, key]);
      if (prior) {
        check(prior.request_digest === digest, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was used for a different message.', 409);
        return ok({ messageId: prior.id, status: prior.status, month, sent: counter.sent, budget }, 202);
      }
      const { rows: [state] } = await tx.query('SELECT status FROM relay_channels WHERE account_id = $1 AND channel = $2', [accountId, channel]);
      check(state?.status === 'on', 'CHANNEL_OFF', 'This channel is not on.', 409);
      const { rows: [counted] } = await tx.query('UPDATE relay_months SET sent = sent + 1 WHERE account_id = $1 AND month = $2 AND sent < $3 RETURNING sent', [accountId, month, budget]);
      check(counted, 'MONTHLY_BUDGET_REACHED', 'This month\'s messages are used up.', 429);
      const id = newId('msg'), expires = new Date(at.getTime() + BUTTON_MS).toISOString();
      await tx.query(`INSERT INTO relay_messages (id, account_id, device_id, kind, event, channel, idempotency_key, request_digest, month, buttons, expires_at, open_expires_at, created_at, updated_at)
        VALUES ($1, $2, $3, 'template', $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)`,
        [id, accountId, deviceId, event, channel, key, digest, month, offer ? 'approve-not-now-open' : 'open-only', expires, new Date(at.getTime() + OPEN_LINK_MS).toISOString(), at.toISOString()]);
      if (offer) await tx.query('INSERT INTO relay_offers (message_id, approve_nonce, approve_ciphertext, not_now_nonce, not_now_ciphertext, expires_at) VALUES ($1, $2, $3, $4, $5, $6)',
        [id, offer.approve.nonce, offer.approve.ciphertext, offer.notNow.nonce, offer.notNow.ciphertext, expires]);
      await deps.queue.enqueue({ type: DISPATCH_JOB, accountId, payload: { messageId: id }, dedupeKey: `relay:${id}` }, tx);
      return ok({ messageId: id, status: 'queued', month, sent: counted.sent, budget }, 202);
    });
  }

  async function dispatch(job: Job) {
    const messageId = job.payload.messageId;
    if (typeof messageId !== 'string') throw new PermanentJobError('JOB_PAYLOAD_INVALID');
    const { rows: [message] } = await deps.sql.query('SELECT * FROM relay_messages WHERE id = $1', [messageId]);
    if (!message || message.status !== 'queued') return;
    try {
      const providerId = message.kind === 'template' ? await sendTemplate(message) : await sendReply(message);
      await deps.sql.query(`UPDATE relay_messages SET status = 'sent', provider_message_id = $2, sent_at = $3, updated_at = $3, last_error = NULL, reply_recipient_sealed = NULL
        WHERE id = $1 AND status = 'queued'`, [message.id, providerId, now().toISOString()]);
    } catch (error: any) {
      const code = error instanceof HostedError ? error.code : 'DISPATCH_FAILED';
      const retry = !(error instanceof HostedError) || RETRYABLE.has(code);
      if (!retry || job.attempts >= job.maxAttempts) {
        await deps.sql.query(`UPDATE relay_messages SET status = 'failed', last_error = $2, updated_at = $3, reply_recipient_sealed = NULL WHERE id = $1 AND status = 'queued'`, [message.id, code, now().toISOString()]);
        await deps.sql.query('DELETE FROM relay_buttons WHERE message_id = $1', [message.id]);
      } else await deps.sql.query('UPDATE relay_messages SET last_error = $2, updated_at = $3 WHERE id = $1', [message.id, code, now().toISOString()]);
      throw retry ? error : new PermanentJobError(code);
    }
  }

  // ---- routes
  function routes(router: Router) {
    router.add('GET', '/v1/relay/channels', async request => {
      const { accountId } = await deps.authenticate(request);
      const { rows } = await deps.sql.query('SELECT * FROM relay_channels WHERE account_id = $1', [accountId]);
      return ok({ channels: await Promise.all(CHANNELS.map(channel => channelView(deps.sql, accountId, channel, rows.find(row => row.channel === channel)))) });
    });

    router.add('PUT', '/v1/relay/channels/:channel', async request => {
      const { accountId } = await deps.authenticate(request);
      const channel = request.params.channel as Channel;
      check((CHANNELS as readonly string[]).includes(channel), 'CHANNEL_UNKNOWN', 'There is no such channel.', 404);
      const body = fields<{ enabled: unknown; optIn: any; address?: unknown }>(json(request), ['enabled', 'optIn'], ['address']);
      check(typeof body.enabled === 'boolean', 'INVALID_REQUEST', 'Say whether the channel is on.');
      let optIn: { textSha256: string; recordedAt: string } | null = null;
      if (body.optIn !== null) {
        const given = fields<{ given: unknown; textSha256: unknown; recordedAt: unknown }>(body.optIn, ['given', 'textSha256', 'recordedAt']);
        check(given.given === true && typeof given.textSha256 === 'string' && /^[0-9a-f]{64}$/.test(given.textSha256), 'INVALID_REQUEST', 'The opt-in is not valid.');
        check(sameHex(given.textSha256, sha256(OPT_IN_TEXT[channel])), 'OPT_IN_TEXT_CHANGED', 'The opt-in wording is not the current wording.', 409);
        const recorded = typeof given.recordedAt === 'string' && given.recordedAt.length <= 40 ? Date.parse(given.recordedAt) : NaN;
        check(Number.isFinite(recorded) && recorded <= now().getTime() + 300000, 'INVALID_REQUEST', 'The opt-in time is not valid.');
        optIn = { textSha256: given.textSha256, recordedAt: new Date(recorded).toISOString() };
      }
      let address: string | undefined;
      if (body.address !== undefined) {
        check(channel === 'mail', 'INVALID_REQUEST', 'This channel takes no address.');
        check(typeof body.address === 'string' && body.address.length <= 254 && MAIL_ADDRESS.test(body.address), 'ADDRESS_INVALID', 'The mail address is not valid.');
        address = body.address;
      }
      if (body.enabled) {
        check(adapters[channel], 'CHANNEL_NOT_CONFIGURED', 'This channel is not configured.', 503);
        check((await deps.entitlements(accountId)).relay, 'PLAN_REQUIRED', 'This channel is part of the paid plan.', 402);
        check(channel !== 'telegram' || options.telegramBotName, 'CHANNEL_NOT_CONFIGURED', 'This channel is not configured.', 503);
      }
      return deps.sql.transaction(async tx => {
        const at = now().toISOString();
        const { rows: [existing] } = await tx.query('SELECT * FROM relay_channels WHERE account_id = $1 AND channel = $2 FOR UPDATE', [accountId, channel]);
        let { recipient_hash: recipient = null, address_sealed: sealed = null, address_mask: mask = null, stopped_at: stoppedAt = null } = (existing ?? {}) as Row;
        if (address !== undefined) { recipient = recipientHash('mail', address.toLowerCase()); sealed = sealServer(sealKey, address, addressAad(accountId, 'mail')); mask = maskMail(address); }
        if (optIn) stoppedAt = null; // a fresh opt-in from the desktop lifts an earlier STOP
        let status = 'off', connectUrl: string | undefined;
        if (body.enabled) {
          check(optIn || existing?.opt_in_at, 'OPT_IN_REQUIRED', 'Turning a channel on needs the opt-in.');
          if (channel === 'whatsapp') {
            const { rows: [account] } = await tx.query('SELECT phone FROM accounts WHERE id = $1', [accountId]);
            check(typeof account?.phone === 'string' && /^\+[1-9][0-9]{7,14}$/.test(account.phone), 'ACCOUNT_PHONE_MISSING', 'The account has no verified phone.', 409);
            recipient = recipientHash('whatsapp', account.phone.slice(1)); mask = maskPhone(account.phone); sealed = null;
          }
          if (channel === 'mail') check(sealed, 'ADDRESS_REQUIRED', 'Mail needs an address.');
          // One live binding per chat, number or confirmed address. A mail address another account confirmed is refused
          // (no confirmation mail is sent for it); a Telegram chat that another account bound since this one turned
          // Telegram off is let go, and this account gets a fresh connect link.
          if (recipient && channel !== 'telegram') check(!await boundElsewhere(tx, channel, recipient, accountId), 'ADDRESS_IN_USE', 'This address is in use on another Chausar account.', 409);
          if (recipient && channel === 'telegram' && await boundElsewhere(tx, channel, recipient, accountId)) { recipient = null; sealed = null; mask = null; stoppedAt = null; }
          status = stoppedAt ? 'stopped' : channel === 'telegram' && !sealed ? 'awaiting-start' : 'on';
          // Mail turns on only for a confirmed address; otherwise one confirmation mail is queued.
          if (channel === 'mail' && status === 'on') status = await mailVerify.require(tx, accountId, recipient, existing?.confirmed_hash ?? null);
          if (status === 'awaiting-start') {
            const token = letterToken();
            await tx.query('DELETE FROM relay_connect_tokens WHERE account_id = $1', [accountId]);
            await tx.query('INSERT INTO relay_connect_tokens (token_hash, account_id, expires_at, created_at) VALUES ($1, $2, $3, $4)',
              [secretHash(deps.pepper, 'relay-connect', token), accountId, new Date(now().getTime() + CONNECT_MS).toISOString(), at]);
            connectUrl = `https://t.me/${options.telegramBotName}?start=${token}`;
          }
        }
        const { rows: [row] } = await tx.query(`INSERT INTO relay_channels (account_id, channel, enabled, status, opt_in_at, opt_in_recorded_at, opt_in_text_sha256, recipient_hash, address_sealed, address_mask, stopped_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          ON CONFLICT (account_id, channel) DO UPDATE SET enabled = EXCLUDED.enabled, status = EXCLUDED.status, opt_in_at = EXCLUDED.opt_in_at, opt_in_recorded_at = EXCLUDED.opt_in_recorded_at,
            opt_in_text_sha256 = EXCLUDED.opt_in_text_sha256, recipient_hash = EXCLUDED.recipient_hash, address_sealed = EXCLUDED.address_sealed, address_mask = EXCLUDED.address_mask,
            stopped_at = EXCLUDED.stopped_at, updated_at = EXCLUDED.updated_at RETURNING *`,
          [accountId, channel, body.enabled, status, optIn ? at : existing?.opt_in_at ?? null, optIn ? optIn.recordedAt : existing?.opt_in_recorded_at ?? null,
            optIn ? optIn.textSha256 : existing?.opt_in_text_sha256 ?? null, recipient, sealed, mask, stoppedAt, at]);
        return ok({ ...await channelView(tx, accountId, channel, row), ...(connectUrl ? { connectUrl } : {}) });
      });
    });

    router.add('POST', '/v1/relay/messages', async request => {
      const { accountId, deviceId } = await deps.authenticate(request);
      const body = fields<{ event: unknown; channel: unknown; idempotencyKey: unknown; offer?: any }>(json(request), ['event', 'channel', 'idempotencyKey'], ['offer']);
      check((MESSAGE_EVENTS as readonly unknown[]).includes(body.event), 'EVENT_UNKNOWN', 'There is no such message.');
      check((CHANNELS as readonly unknown[]).includes(body.channel), 'CHANNEL_UNKNOWN', 'There is no such channel.');
      check(typeof body.idempotencyKey === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(body.idempotencyKey), 'INVALID_REQUEST', 'The idempotency key is not valid.');
      const event = body.event as MessageEvent, channel = body.channel as Channel, key = body.idempotencyKey;
      let offer: { approve: Sealed; notNow: Sealed } | null = null;
      if (body.offer !== undefined && body.offer !== null) {
        check(event === 'review-ready', 'OFFER_NOT_ALLOWED', 'Only a review message can carry Approve and Not now.');
        // A mail link works for whoever holds the mail, forwarded copies included; chat presses are bound to the owner's number or chat.
        check(channel !== 'mail', 'OFFER_NOT_ALLOWED', 'Approve and Not now are offered only on WhatsApp and Telegram.');
        const given = fields<{ approve: unknown; notNow: unknown }>(body.offer, ['approve', 'notNow']);
        offer = { approve: sealedBlob(given.approve), notNow: sealedBlob(given.notNow) };
      }
      return queueTemplate(accountId, deviceId, event, channel, key, offer);
    });

    // A desktop whose send got no reply asks, without sending anything, whether the relay received that key.
    router.add('GET', '/v1/relay/messages/by-key/:idempotencyKey', async request => {
      const { accountId } = await deps.authenticate(request);
      const key = request.params.idempotencyKey;
      check(/^[A-Za-z0-9_-]{8,100}$/.test(key), 'INVALID_REQUEST', 'The idempotency key is not valid.');
      const { rows: [row] } = await deps.sql.query(`SELECT id, status FROM relay_messages WHERE account_id = $1 AND idempotency_key = $2 AND kind = 'template'`, [accountId, key]);
      check(row, 'MESSAGE_NOT_FOUND', 'There is no such message.', 404);
      return ok({ messageId: row.id, status: row.status });
    });

    router.add('GET', '/v1/relay/messages/:messageId', async request => {
      const { accountId } = await deps.authenticate(request);
      const { rows: [row] } = await deps.sql.query(`SELECT * FROM relay_messages WHERE id = $1 AND account_id = $2 AND kind = 'template'`, [request.params.messageId, accountId]);
      check(row, 'MESSAGE_NOT_FOUND', 'There is no such message.', 404);
      return ok({ messageId: row.id, event: row.event, channel: row.channel, status: row.status, buttons: row.buttons, decided: row.decided ?? null, expiresAt: isoOf(row.expires_at) });
    });

    router.add('GET', '/v1/relay/counts', async request => {
      const { accountId } = await deps.authenticate(request);
      const month = request.query.get('month') ?? monthKey(now());
      check(/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(month), 'INVALID_REQUEST', 'The month is not valid.');
      const budget = (await deps.entitlements(accountId)).monthlyMessages;
      const { rows: [counter] } = await deps.sql.query('SELECT sent FROM relay_months WHERE account_id = $1 AND month = $2', [accountId, month]);
      const { rows } = await deps.sql.query(`SELECT channel, count(*)::int AS total, count(*) FILTER (WHERE status IN ('sent', 'delivered', 'read'))::int AS sent
        FROM relay_messages WHERE account_id = $1 AND month = $2 AND kind = 'template' GROUP BY channel`, [accountId, month]);
      const byChannel = { whatsapp: 0, telegram: 0, mail: 0 };
      let cost: bigint | null = 0n;
      for (const row of rows) {
        byChannel[row.channel as Channel] = row.total;
        if (!row.sent) continue;
        const price = options.prices?.perMessagePaise[row.channel as Channel];
        cost = cost === null || price === undefined ? null : cost + BigInt(price) * BigInt(row.sent);
      }
      return ok({ month, sent: counter?.sent ?? 0, budget, costPaise: cost === null ? null : cost.toString(), costState: cost === null ? 'unknown' : 'known', byChannel });
    });

    // An envelope goes back only to the desktop install that offered the approval.
    router.add('GET', '/v1/relay/envelopes', async request => {
      const { accountId, deviceId } = await deps.authenticate(request);
      const { rows } = await deps.sql.query('SELECT * FROM relay_envelopes WHERE account_id = $1 AND device_id = $2 AND expires_at > $3 ORDER BY created_at, id', [accountId, deviceId, now().toISOString()]);
      return ok({ envelopes: rows.map(row => ({ envelopeId: row.id, messageId: row.message_id, purpose: row.purpose, decision: row.decision, channel: row.channel,
        createdAt: isoOf(row.created_at), expiresAt: isoOf(row.expires_at), nonce: row.nonce, ciphertext: row.ciphertext })) });
    });

    router.add('POST', '/v1/relay/envelopes/:envelopeId/ack', async request => {
      const { accountId, deviceId } = await deps.authenticate(request);
      const { disposition } = fields<{ disposition: unknown }>(json(request), ['disposition']);
      check(disposition === 'collected' || disposition === 'expired' || disposition === 'invalid', 'INVALID_REQUEST', 'The disposition is not valid.');
      const { rowCount } = await deps.sql.query('DELETE FROM relay_envelopes WHERE id = $1 AND account_id = $2 AND device_id = $3', [request.params.envelopeId, accountId, deviceId]);
      check(rowCount === 1, 'ENVELOPE_NOT_FOUND', 'There is no such envelope.', 404);
      return ok({ envelopeId: request.params.envelopeId, disposition });
    });

    router.add('GET', '/v1/webhooks/whatsapp', request => {
      const challenge = request.query.get('hub.challenge') ?? '';
      check(options.whatsappVerifyToken && request.query.get('hub.mode') === 'subscribe' && sameText(request.query.get('hub.verify_token') ?? '', options.whatsappVerifyToken)
        && /^[A-Za-z0-9_-]{1,128}$/.test(challenge), 'WEBHOOK_VERIFY_FAILED', 'The webhook could not be verified.', 403);
      return { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' }, body: challenge };
    });
    mailInbound.routes(router);
    businessStatuses.routes(router);

    router.add('POST', '/v1/webhooks/whatsapp', async request => {
      const secret = options.whatsappAppSecret;
      check(secret && adapters.whatsapp, 'CHANNEL_NOT_CONFIGURED', 'This channel is not configured.', 503);
      const signature = /^sha256=([0-9a-f]{64})$/.exec(request.headers['x-hub-signature-256'] ?? '');
      check(signature && sameHex(signature[1], hmacHex(secret, request.body)), 'WEBHOOK_SIGNATURE_INVALID', 'The webhook signature is not valid.', 401);
      const body = webhookJson(request);
      for (const entry of list(body?.entry)) for (const change of list(entry?.changes)) {
        if (change?.field !== 'messages' || !change.value || typeof change.value !== 'object') continue;
        for (const status of list(change.value.statuses)) await statusUpdate(status);
        for (const message of list(change.value.messages)) await inboundWhatsApp(message);
      }
      return ok({ received: true });
    });
    documents.routes(router);

    router.add('POST', '/v1/webhooks/telegram', async request => {
      const secret = options.telegramSecret;
      check(secret && adapters.telegram, 'CHANNEL_NOT_CONFIGURED', 'This channel is not configured.', 503);
      check(sameText(request.headers['x-telegram-bot-api-secret-token'] ?? '', secret), 'WEBHOOK_SIGNATURE_INVALID', 'The webhook signature is not valid.', 401);
      await inboundTelegram(webhookJson(request));
      return ok({ received: true });
    });
  }

  const kit = { sealKey, linkOrigin, mail: options.mail, recipientHash, addressAad, queueReply, arrived, command, ownerOf, boundElsewhere, refuse };
  const mailVerify = createMailVerify(deps, kit), mailInbound = createMailInbound(deps, kit, options.mailInbound ?? {});
  const businessStatuses = createBusinessStatuses(deps, kit, options.apiOrigin);

  return {
    id: 'relay', buttons, routes, mailConfirm: mailVerify.pages,
    async notify(accountId, event, idempotencyKey) {
      const { rows } = await deps.sql.query(`SELECT channel FROM relay_channels WHERE account_id = $1 AND status = 'on'`, [accountId]);
      const channel = CHANNELS.find(name => adapters[name] && rows.some(row => row.channel === name));
      check(channel, 'CHANNEL_OFF', 'No message channel is on.', 409);
      const reply = await queueTemplate(accountId, null, event, channel, idempotencyKey, null);
      return { messageId: (reply.body as { messageId: string }).messageId, channel };
    },
    jobs(worker: Worker) { worker.register(DISPATCH_JOB, dispatch); documents.jobs(worker); mailVerify.jobs(worker); },
    async sweep() {
      const at = now().toISOString();
      await deps.sql.query('DELETE FROM relay_envelopes WHERE expires_at <= $1', [at]);
      await deps.sql.query('DELETE FROM relay_buttons WHERE expires_at <= $1', [at]);
      await deps.sql.query('DELETE FROM relay_offers WHERE expires_at <= $1', [at]);
      await deps.sql.query('DELETE FROM relay_connect_tokens WHERE expires_at <= $1 OR used_at IS NOT NULL', [at]);
      await deps.sql.query(`UPDATE relay_messages SET reply_recipient_sealed = NULL WHERE kind = 'reply' AND reply_recipient_sealed IS NOT NULL AND window_until <= $1`, [at]);
      await documents.sweep();
      await mailVerify.sweep(); await mailInbound.sweep(); await businessStatuses.sweep();
    },
  };
}
