/**
 * Mail over the user's own SMTP server, with optional IMAP read-back of the Sent folder.
 * Credentials (username, password) go only over TLS: implicit TLS, or STARTTLS followed by a
 * fresh EHLO before AUTH PLAIN. The Message-ID is derived from the effect key, so the Sent
 * folder can be searched for it before sending and after a lost reply.
 */
import { canonical } from '../../actions.ts';
import { check, hash } from '../../contracts.ts';
import { account, effectReference, secret } from '../reference.ts';
import type { ActionAdapter, AdapterContext, LineSocket, SystemAdapters } from '../types.ts';
import { email, list, record, text } from '../validate.ts';

const HOST = /^[a-z0-9.-]{1,253}$/i, PORT = /^[1-9]\d{0,4}$/, NAME = /^[^\u0000-\u001f\u007f]{1,100}$/, LINES = 1000;
const optional = (ctx: AdapterContext, field: string, pattern: RegExp) => ctx.connection.account[field] === undefined ? undefined : account(ctx, field, pattern);
function settings(ctx: AdapterContext) {
  const imapHost = optional(ctx, 'imapHost', HOST);
  return { smtp: { host: account(ctx, 'smtpHost', HOST), port: Number(account(ctx, 'smtpPort', PORT)), security: account(ctx, 'smtpSecurity', /^(implicit-tls|starttls)$/) as 'implicit-tls' | 'starttls' },
    from: account(ctx, 'from', /^[^\s@<>()",;]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/), fromName: optional(ctx, 'fromName', NAME), sentFolder: optional(ctx, 'sentFolder', NAME) ?? 'Sent',
    imap: imapHost === undefined ? null : { host: imapHost, port: Number(optional(ctx, 'imapPort', PORT) ?? '993'), security: 'implicit-tls' as const } };
}
function header(value: unknown, max: number): string {
  check(typeof value === 'string' && !/[\r\n]/.test(value), 'INVALID_WRITE_PAYLOAD', 'A mail header cannot hold a line break.'); return text(value, max);
}

/** RFC 2047: non-ASCII text as UTF-8 base64 encoded words of at most 75 characters, folded. */
function encodeWords(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  const words: string[] = []; let chunk = '';
  for (const char of value) { if (Buffer.byteLength(chunk + char) > 45) { words.push(chunk); chunk = ''; } chunk += char; }
  return [...words, chunk].filter(Boolean).map(w => `=?UTF-8?B?${Buffer.from(w).toString('base64')}?=`).join('\r\n ');
}
export function decodeWords(value: string): string {
  return value.replace(/(=\?[^?\s]+\?[BbQq]\?[^?\s]*\?=)\s+(?==\?)/g, '$1').replace(/=\?([^?\s]+)\?([BbQq])\?([^?\s]*)\?=/g, (word, charset: string, kind: string, data: string) => !/^utf-8$/i.test(charset) ? word
    : (kind.toUpperCase() === 'B' ? Buffer.from(data, 'base64') : Buffer.from(data.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16))), 'latin1')).toString('utf8'));
}
/** SMTP transparency (RFC 5321 4.5.2): a line that starts with a dot gets one more. */
export const dotStuff = (message: string) => message.split('\r\n').map(line => line.startsWith('.') ? `.${line}` : line).join('\r\n');
const messageId = (key: string) => `<${hash(`writeback-message-id:${key}`).slice(0, 32)}@chausar.local>`;
const quote = (value: string) => `"${value.replace(/[\\"]/g, m => `\\${m}`)}"`;

type Mail = { to: string[]; subject: string; body: string; inReplyTo?: string };
function build(ctx: AdapterContext, p: Mail, key: string, from: string, fromName: string | undefined): string {
  const when = new Date(ctx.clock()); check(Number.isFinite(when.getTime()), 'WRITE_CLOCK_INVALID', 'The clock gave an invalid time.');
  const body = Buffer.from(p.body.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64').match(/.{1,76}/g) ?? [];
  return [`Date: ${when.toUTCString().replace(/GMT$/, '+0000')}`, `From: ${fromName ? `${/^[\x20-\x7e]*$/.test(fromName) ? quote(fromName) : encodeWords(fromName)} <${from}>` : from}`,
    `To: ${p.to.join(',\r\n ')}`, `Subject: ${encodeWords(p.subject)}`, `Message-ID: ${messageId(key)}`, ...(p.inReplyTo ? [`In-Reply-To: ${p.inReplyTo}`, `References: ${p.inReplyTo}`] : []),
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', `X-Chausar-Reference: ${effectReference(key)}`, '', ...body].join('\r\n');
}

/** One SMTP reply: three-digit code, '-' continuation lines, at most LINES lines. */
async function smtpReply(socket: LineSocket): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = [];
  while (true) {
    const m = /^(\d{3})([ -]?)(.*)$/.exec(await socket.readLine());
    check(m, 'MAIL_REPLY_INVALID', 'The mail server sent a reply Chausar cannot read.'); check(lines.push(m[3]) <= LINES, 'MAIL_REPLY_LIMIT', 'The mail server sent an overlong reply.');
    if (m[2] !== '-') return { code: Number(m[1]), lines };
  }
}
async function smtp(socket: LineSocket, command: string | null, codes: number[], refusal = 'MAIL_REFUSED') {
  if (command !== null) await socket.write(`${command}\r\n`);
  const reply = await smtpReply(socket); check(codes.includes(reply.code), refusal, refusal === 'MAIL_AUTH_REFUSED' ? 'The mail server did not accept the sign-in.' : 'The mail server refused the message.');
  return reply;
}

/** One IMAP command: untagged lines and literals until the tagged status, at most LINES lines. */
async function imap(socket: LineSocket, tag: string, command: string, refusal = 'MAIL_REFUSED'): Promise<{ lines: string[]; literal: string }> {
  await socket.write(`${tag} ${command}\r\n`);
  const lines: string[] = []; let literal = '';
  const next = async () => { check(lines.length < LINES, 'MAIL_REPLY_LIMIT', 'The mail server sent an overlong reply.'); const line = await socket.readLine(); lines.push(line); return line; };
  while (true) {
    const line = await next();
    if (line.startsWith(`${tag} `)) { check(/^OK\b/i.test(line.slice(tag.length + 1)), refusal, refusal === 'MAIL_AUTH_REFUSED' ? 'The mail server did not accept the sign-in.' : 'The mail server refused to show the Sent folder.'); return { lines, literal }; }
    const size = /\{(\d{1,7})\}$/.exec(line);
    for (let need = size ? Number(size[1]) : 0; need > 0;) { const part = await next(); literal += `${part}\r\n`; need -= Buffer.byteLength(part) + 2; }
  }
}
type Found = { uids: string[]; headers: { to: string[]; subject: string; messageId: string } | null };
/** Searches the Sent folder for the Message-ID and reads the headers of a single match. */
async function look(ctx: AdapterContext, id: string): Promise<Found | null> {
  const s = settings(ctx); if (!s.imap) return null;
  const username = await secret(ctx, 'username'), password = await secret(ctx, 'password');
  const socket = await ctx.dial(s.imap);
  try {
    check(/^\* OK\b/i.test(await socket.readLine()), 'MAIL_REFUSED', 'The mail server did not greet Chausar.');
    await imap(socket, 'a1', `LOGIN ${quote(username)} ${quote(password)}`, 'MAIL_AUTH_REFUSED');
    await imap(socket, 'a2', `SELECT ${quote(s.sentFolder)}`);
    const uids = (await imap(socket, 'a3', `UID SEARCH HEADER Message-ID ${quote(id)}`)).lines.filter(l => /^\* SEARCH\b/i.test(l)).flatMap(l => l.slice(8).trim().split(/\s+/)).filter(u => /^\d{1,10}$/.test(u));
    let headers: Found['headers'] = null;
    if (uids.length === 1) {
      const fields: Record<string, string> = {};
      for (const line of (await imap(socket, 'a4', `UID FETCH ${uids[0]} (BODY.PEEK[HEADER.FIELDS (TO SUBJECT MESSAGE-ID)])`)).literal.replace(/\r\n[ \t]+/g, ' ').split('\r\n')) {
        const m = /^([A-Za-z-]+):\s*(.*)$/.exec(line); if (m) fields[m[1].toLowerCase()] = m[2].trim();
      }
      headers = { messageId: fields['message-id'] ?? '', subject: decodeWords(fields.subject ?? ''), to: (fields.to ?? '').split(',').map(a => (/<([^>]*)>/.exec(a)?.[1] ?? a).trim()).filter(Boolean).sort() };
    }
    await imap(socket, uids.length === 1 ? 'a5' : 'a4', 'LOGOUT').catch(() => {});
    return { uids, headers };
  } finally { socket.close(); }
}

const smtpSend: ActionAdapter<any> = {
  validate(payload) {
    const p = record(payload, ['to', 'subject', 'body'], ['inReplyTo']);
    return { to: list(p.to, 5, email), subject: header(p.subject, 200), body: text(p.body, 20000), ...(p.inReplyTo === undefined ? {} : { inReplyTo: text(p.inReplyTo, 500, /^<[^\s<>]{1,240}@[^\s<>]{1,240}>$/) }) } as Mail;
  },
  async prepare(ctx, p: Mail, key) {
    const s = settings(ctx), id = messageId(key), found = await look(ctx, id);
    return { before: null, command: { from: s.from, to: p.to, messageId: id, message: build(ctx, p, key, s.from, s.fromName) }, postconditions: { messageId: id, to: [...p.to].sort(), subject: p.subject },
      preview: { asWritten: `From: ${s.fromName ? `${s.fromName} <${s.from}>` : s.from}\nTo: ${p.to.join(', ')}\nSubject: ${p.subject}\n\n${p.body}` },
      target: { label: `Email to ${p.to.join(', ')}`, ref: null }, sourceVersion: null, alreadyApplied: found?.uids.length ? { externalId: id } : null };
  },
  async do(ctx, _p, preparation) {
    const s = settings(ctx), username = await secret(ctx, 'username'), password = await secret(ctx, 'password');
    const socket = await ctx.dial(s.smtp); let secure = s.smtp.security === 'implicit-tls';
    try {
      await smtp(socket, null, [220]);
      let capabilities = (await smtp(socket, 'EHLO chausar.local', [250])).lines;
      if (!secure) {
        check(capabilities.some(c => /^STARTTLS$/i.test(c.trim())), 'MAIL_TLS_UNAVAILABLE', 'The mail server does not offer a secure connection, so Chausar will not sign in.');
        await smtp(socket, 'STARTTLS', [220]); await socket.upgrade(); secure = true;
        capabilities = (await smtp(socket, 'EHLO chausar.local', [250])).lines;
      }
      check(secure && capabilities.some(c => /^AUTH\b.*\bPLAIN\b/i.test(c)), 'MAIL_AUTH_REFUSED', 'The mail server does not take a password sign-in over a secure connection.');
      await smtp(socket, `AUTH PLAIN ${Buffer.from(`\u0000${username}\u0000${password}`, 'utf8').toString('base64')}`, [235], 'MAIL_AUTH_REFUSED');
      await smtp(socket, `MAIL FROM:<${String(preparation.command.from)}>`, [250]);
      for (const to of preparation.command.to as string[]) await smtp(socket, `RCPT TO:<${to}>`, [250, 251]);
      await smtp(socket, 'DATA', [354]);
      await socket.write(`${dotStuff(String(preparation.command.message))}\r\n.\r\n`);
      const queued = await smtp(socket, null, [250]);
      await smtp(socket, 'QUIT', [221]).catch(() => {});
      return { outcome: 'accepted', externalId: String(preparation.command.messageId), data: { queueReply: queued.lines.join(' ').replace(/[^\x20-\x7e]/g, '').slice(0, 100) } };
    } finally { socket.close(); }
  },
  async readBack(ctx, _p, preparation) {
    const id = String(preparation.postconditions.messageId), found = await look(ctx, id);
    if (!found) return { outcome: 'inconclusive', reason: 'This mail server gives no way to look; a person settles it.' };
    if (found.uids.length > 1) return { outcome: 'conflicting', reason: 'The Sent folder holds this message more than once.' };
    if (!found.headers) return { outcome: 'inconclusive', reason: 'The message is not in the Sent folder yet.' };
    const observed = { messageId: found.headers.messageId, to: found.headers.to, subject: found.headers.subject };
    return canonical(observed) === canonical(preparation.postconditions) ? { outcome: 'confirmed-applied', observed, externalId: id, businessSuccess: true }
      : { outcome: 'conflicting', reason: 'The message in the Sent folder does not match what was approved.' };
  },
};

export const mailAdapters: SystemAdapters = Object.freeze({ 'smtp.send': smtpSend });
