import type { HostedDeps } from '../shared/module.ts';
import type { HeaderMap, Router } from '../shared/http.ts';
import { ok } from '../shared/http.ts';
import { HostedError, check } from '../shared/errors.ts';
import { hmacHex, sameHex, sameText } from '../shared/crypto.ts';
import { MAIL_ADDRESS } from './channels.ts';
import type { RelayKit } from './mail-verify.ts';

/** What the relay takes from one inbound mail. The text is read for a command and then dropped; nothing of it is stored. */
export type InboundMail = { from: string; text: string; messageId: string };
/** One mail provider's inbound webhook: `verify` authenticates the raw request, `parse` returns null for a mail to ignore. */
export interface MailInboundAdapter {
  readonly provider: string;
  verify(rawBody: Buffer, headers: HeaderMap): boolean;
  parse(rawBody: Buffer, headers: HeaderMap): InboundMail | null;
}
export const MAIL_REPLIES_PER_SENDER_PER_DAY = 5;

function jsonBody(rawBody: Buffer): any {
  try { return JSON.parse(rawBody.toString('utf8')); } catch { throw new HostedError('INVALID_JSON', 'The request body is not valid JSON.'); }
}
const address = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const bare = (/<([^<>]+)>\s*$/.exec(value)?.[1] ?? value).trim();
  return bare.length <= 254 && MAIL_ADDRESS.test(bare) ? bare : null;
};
const eventId = (value: unknown): string | null => typeof value === 'string' && value.length >= 1 && value.length <= 256 && !/[\x00-\x1f\x7f]/.test(value) ? value : null;
const bounded = (value: unknown): string | null => typeof value === 'string' && value.trim() !== '' ? value.slice(0, 20000) : null;

/**
 * Postmark inbound: JSON with From, FromFull.Email, TextBody, StrippedTextReply and MessageID. Postmark signs nothing,
 * so the webhook URL carries HTTP basic credentials (https://user:password@api.../v1/webhooks/mail/postmark), compared in constant time.
 */
export function postmarkInbound(config: { user: string; password: string }): MailInboundAdapter {
  check(/^[A-Za-z0-9_.-]{8,128}$/.test(config.user) && /^[A-Za-z0-9_.~-]{16,256}$/.test(config.password), 'RELAY_CONFIG_INVALID', 'The inbound mail configuration is not valid.', 500);
  return {
    provider: 'postmark',
    verify(_rawBody, headers) {
      const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/.exec(headers.authorization ?? '');
      const decoded = match ? Buffer.from(match[1], 'base64').toString('utf8') : '';
      const split = decoded.indexOf(':');
      const user = split > 0 ? decoded.slice(0, split) : '', password = split > 0 ? decoded.slice(split + 1) : '';
      const userOk = sameText(user, config.user), passwordOk = sameText(password, config.password);
      return userOk && passwordOk;
    },
    parse(rawBody) {
      const body = jsonBody(rawBody);
      if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
      // An automatic reply (out of office, a bounce) never gets one back: no mail loops.
      const headers = Array.isArray(body.Headers) ? body.Headers.slice(0, 200) : [];
      if (headers.some((h: any) => typeof h?.Name === 'string' && h.Name.toLowerCase() === 'auto-submitted' && String(h.Value ?? '').trim().toLowerCase() !== 'no')) return null;
      const from = address(body.FromFull?.Email) ?? address(body.From), messageId = eventId(body.MessageID);
      if (!from || !messageId) return null;
      return { from, messageId, text: bounded(body.StrippedTextReply) ?? bounded(body.TextBody) ?? '' };
    },
  };
}

/** Any other provider (or a small forwarder in front of one): `x-chausar-mail-signature: sha256=<hex>` over the raw body, and a body of exactly `{ from, text, messageId }`. */
export function hmacMailInbound(config: { secret: string; provider?: string }): MailInboundAdapter {
  check(typeof config.secret === 'string' && config.secret.length >= 16 && config.secret.length <= 512, 'RELAY_CONFIG_INVALID', 'The inbound mail configuration is not valid.', 500);
  return {
    provider: config.provider ?? 'hmac',
    verify(rawBody, headers) {
      const signature = /^sha256=([0-9a-f]{64})$/.exec(headers['x-chausar-mail-signature'] ?? '');
      return !!signature && sameHex(signature[1], hmacHex(config.secret, rawBody));
    },
    parse(rawBody) {
      const body = jsonBody(rawBody);
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).sort().join() !== 'from,messageId,text') return null;
      const from = address(body.from), messageId = eventId(body.messageId);
      if (!from || !messageId || typeof body.text !== 'string') return null;
      return { from, messageId, text: body.text.slice(0, 20000) };
    },
  };
}

const indianDay = (at: Date) => new Date(at.getTime() + 330 * 60000).toISOString().slice(0, 10);
/** The first non-empty line decides: HELP or STOP, else free text. A typed "yes" is never an approval. */
export function mailCommand(text: string): 'help' | 'stop' | 'text' {
  const first = text.split(/\r?\n/).map(line => line.trim()).find(line => line !== '') ?? '';
  const word = first.toUpperCase().replace(/[.!]+$/, '');
  return word === 'HELP' ? 'help' : word === 'STOP' ? 'stop' : 'text';
}

/**
 * POST /v1/webhooks/mail/:provider. Only a sender whose address an account confirmed (matched by the keyed hash of
 * the normalized address, never a plaintext lookup) gets a reply: HELP opens a help ticket, STOP stops mail, anything
 * else gets the fixed free-text reply. Replies go through the queue, do not count against the thirty, and are limited per sender.
 */
export function createMailInbound(deps: HostedDeps, kit: RelayKit, adapters: Readonly<Record<string, MailInboundAdapter>>) {
  async function inbound(mail: InboundMail) {
    const normalized = mail.from.trim().toLowerCase(), hash = kit.recipientHash('mail', normalized);
    const kind = mailCommand(mail.text);
    await deps.sql.transaction(async tx => {
      const { rows: [owner] } = await tx.query(`SELECT account_id FROM relay_channels WHERE channel = 'mail' AND recipient_hash = $1 AND confirmed_hash = recipient_hash
        ORDER BY updated_at DESC LIMIT 1`, [hash]);
      const accountId: string | null = owner?.account_id ?? null;
      if (!await kit.arrived(tx, 'mail', mail.messageId, accountId, kind)) return;
      // An address nobody confirmed gets nothing back: the relay never mails an address that did not ask for it.
      if (!accountId) return;
      const key = kind === 'text' ? 'freeText' : await kit.command(tx, 'mail', normalized, accountId, kind);
      const { rows: [counted] } = await tx.query(`INSERT INTO relay_mail_senders (sender_hash, day, replies) VALUES ($1, $2, 1)
        ON CONFLICT (sender_hash, day) DO UPDATE SET replies = relay_mail_senders.replies + 1 WHERE relay_mail_senders.replies < $3 RETURNING replies`,
        [hash, indianDay(deps.clock()), MAIL_REPLIES_PER_SENDER_PER_DAY]);
      if (counted) await kit.queueReply(tx, { channel: 'mail', accountId, key, to: normalized, inboundAt: deps.clock() });
    });
  }
  return {
    routes(router: Router) {
      router.add('POST', '/v1/webhooks/mail/:provider', async request => {
        const adapter = Object.hasOwn(adapters, request.params.provider) ? adapters[request.params.provider] : undefined;
        check(adapter && kit.mail, 'MAIL_PROVIDER_UNKNOWN', 'No inbound mail is configured for that provider.', 404);
        check(adapter.verify(request.body, request.headers), 'WEBHOOK_SIGNATURE_INVALID', 'The webhook signature is not valid.', 401);
        const mail = adapter.parse(request.body, request.headers);
        if (mail) await inbound(mail);
        return ok({ received: true });
      });
    },
    async sweep() {
      await deps.sql.query('DELETE FROM relay_mail_senders WHERE day < $1', [indianDay(new Date(deps.clock().getTime() - 2 * 86400000))]);
    },
  };
}
