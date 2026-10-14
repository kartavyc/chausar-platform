import type { HostedDeps } from '../shared/module.ts';
import type { HeaderMap, Router } from '../shared/http.ts';
import { ok } from '../shared/http.ts';
import { HostedError, check } from '../shared/errors.ts';
import { hmacHex, sameHex, sameText } from '../shared/crypto.ts';
import { MAIL_ADDRESS } from './channels.ts';
import type { RelayKit } from './mail-verify.ts';

/**
 * What the relay takes from one inbound mail. The text is read for a command and then dropped; nothing of it is stored.
 * `authenticated`: the provider reported SPF or DKIM passing for the From address's own domain. Only then may HELP or
 * STOP act; anyone can put any address in From.
 */
export type InboundMail = { from: string; text: string; messageId: string; authenticated: boolean };
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
const domainOf = (value: string): string | null => {
  const bare = value.trim().replace(/^"(.*)"$/, '$1').replace(/^<(.*)>$/, '$1');
  const domain = (bare.includes('@') ? bare.slice(bare.lastIndexOf('@') + 1) : bare).toLowerCase().replace(/\.$/, '');
  return /^[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/.test(domain) ? domain : null;
};
/** `name=value` from a `;`-separated header (parenthesized comments removed first); the first one wins. */
const property = (text: string, name: string): string | null => {
  const match = new RegExp(`(?:^|[;\\s])${name.replace(/\./g, '\\.')}\\s*=\\s*("[^"]*"|[^;\\s]+)`, 'i').exec(text);
  return match ? match[1].replace(/^"(.*)"$/, '$1') : null;
};
const uncommented = (text: string) => text.replace(/\([^()]*\)/g, ' ');

/**
 * Received-SPF as the receiving server prepends it (RFC 7208 9.1): `Pass ... identity=mailfrom; envelope-from=<addr>; ...`.
 * Passes only for the mail-from identity and only when the envelope sender's domain is exactly the From domain.
 */
export function spfPasses(value: string, fromDomain: string): boolean {
  const text = uncommented(value).trim();
  if (!/^pass(\s|;|$)/i.test(text)) return false;
  const identity = property(text, 'identity');
  if (identity !== null && identity.toLowerCase() !== 'mailfrom') return false;
  const envelope = property(text, 'envelope-from');
  return envelope !== null && domainOf(envelope) === fromDomain;
}
/**
 * One Authentication-Results header (RFC 8601) whose authserv-id was already checked: passes when a `dkim=pass` result
 * signs for exactly the From domain (`header.d`, or the domain of `header.i`), or `spf=pass` has `smtp.mailfrom` in it.
 */
export function authenticationResultsPass(value: string, fromDomain: string): boolean {
  const [, ...results] = uncommented(value).split(';').map(part => part.trim());
  return results.some(result => {
    if (/^dkim\s*=\s*pass(\s|$)/i.test(result)) {
      const signer = property(result, 'header.d') ?? property(result, 'header.i');
      return signer !== null && domainOf(signer) === fromDomain;
    }
    if (/^spf\s*=\s*pass(\s|$)/i.test(result)) {
      const envelope = property(result, 'smtp.mailfrom');
      return envelope !== null && domainOf(envelope) === fromDomain;
    }
    return false;
  });
}
const authservId = (value: string) => uncommented(value).split(';')[0].trim().split(/\s+/)[0]?.toLowerCase() ?? '';
/**
 * Conservative: exactly one Received-SPF header (a second one may come from the sender), or, when the receiving
 * server's authserv-id is configured, exactly one Authentication-Results header carrying it. Anything else is unauthenticated.
 */
export function postmarkAuthenticated(headers: unknown[], from: string, receiverId?: string): boolean {
  const fromDomain = domainOf(from);
  if (!fromDomain) return false;
  const named = (name: string) => headers.filter((h: any) => typeof h?.Name === 'string' && h.Name.trim().toLowerCase() === name && typeof h.Value === 'string')
    .map((h: any) => h.Value as string);
  const spf = named('received-spf');
  if (spf.length === 1 && spfPasses(spf[0], fromDomain)) return true;
  if (!receiverId) return false;
  const results = named('authentication-results').filter(value => authservId(value) === receiverId.toLowerCase());
  return results.length === 1 && authenticationResultsPass(results[0], fromDomain);
}

/**
 * Postmark inbound: JSON with From, FromFull.Email, TextBody, StrippedTextReply, MessageID and Headers. Postmark signs nothing,
 * so the webhook URL carries HTTP basic credentials (https://user:password@api.../v1/webhooks/mail/postmark), compared in constant time.
 * The sender counts as authenticated from Postmark's Received-SPF header, or from an Authentication-Results header whose
 * authserv-id is `authservId` (only when that is configured).
 */
export function postmarkInbound(config: { user: string; password: string; authservId?: string }): MailInboundAdapter {
  check(/^[A-Za-z0-9_.-]{8,128}$/.test(config.user) && /^[A-Za-z0-9_.~-]{16,256}$/.test(config.password)
    && (config.authservId === undefined || /^[A-Za-z0-9.-]{3,253}$/.test(config.authservId)), 'RELAY_CONFIG_INVALID', 'The inbound mail configuration is not valid.', 500);
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
      return { from, messageId, text: bounded(body.StrippedTextReply) ?? bounded(body.TextBody) ?? '', authenticated: postmarkAuthenticated(headers, from, config.authservId) };
    },
  };
}

/**
 * Any other provider (or a small forwarder in front of one): `x-chausar-mail-signature: sha256=<hex>` over the raw body, and a
 * body of exactly `{ from, text, messageId, authenticated }`. `authenticated` (a boolean, required) is the forwarder's
 * statement that SPF or DKIM passed for the From domain; false makes the mail free text.
 */
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
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).sort().join() !== 'authenticated,from,messageId,text') return null;
      const from = address(body.from), messageId = eventId(body.messageId);
      if (!from || !messageId || typeof body.text !== 'string' || typeof body.authenticated !== 'boolean') return null;
      return { from, messageId, text: body.text.slice(0, 20000), authenticated: body.authenticated };
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
 * the normalized address, never a plaintext lookup) gets a reply. From an authenticated sender HELP opens a help ticket
 * (limited per account) and STOP stops mail; anything else, and every mail whose sender is not authenticated, gets the
 * fixed free-text reply and changes nothing. Replies go through the queue, do not count against the thirty, and are limited per sender.
 */
export function createMailInbound(deps: HostedDeps, kit: RelayKit, adapters: Readonly<Record<string, MailInboundAdapter>>) {
  async function inbound(mail: InboundMail) {
    const normalized = mail.from.trim().toLowerCase(), hash = kit.recipientHash('mail', normalized);
    // A forged From can neither stop someone's mail nor open tickets in their name: unauthenticated mail is free text.
    const kind = mail.authenticated ? mailCommand(mail.text) : 'text';
    await deps.sql.transaction(async tx => {
      const accountId = await kit.ownerOf(tx, 'mail', normalized);
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
