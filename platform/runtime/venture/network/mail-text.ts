// Chausar venture launcher, network (Ink v2 wave 4, package 4E3): reading one mail message the way triage needs it, in
// code. Header fields unfolded and their encoded words (RFC 2047) decoded; addresses and message ids picked out; the
// MIME parts walked (multipart, base64, quoted-printable, the charset named); and the new words of a reply, with the
// quoted mail it answers, the sender's signature and Chausar's own unsubscribe line taken off. Pure: nothing here
// stores or sends anything, and none of it is kept beyond the triage that reads it.
import { normalEmail } from './text.ts';
import { DEFAULT_UNSUBSCRIBE_LINE } from '../customers/leads.ts';

/** Header fields by lower-case name, each value unfolded, in the order they came. */
export type MailHeaders = Map<string, string[]>;

/** Bytes as text in a charset, UTF-8 when the charset is unknown. Never throws. */
export function decodeBytes(bytes: Buffer, charset: string | null | undefined): string {
  const name = (charset ?? 'utf-8').trim().toLowerCase().replace(/^"|"$/g, '') || 'utf-8';
  try { return new TextDecoder(name === 'us-ascii' || name === 'ascii' ? 'utf-8' : name, { fatal: false }).decode(bytes); }
  catch { return new TextDecoder('utf-8', { fatal: false }).decode(bytes); }
}

/** The bytes of one Q-encoded word: '_' is a space, '=XX' a byte. */
function qBytes(text: string): Buffer {
  const out: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '_') out.push(0x20);
    else if (c === '=' && /^[0-9a-f]{2}$/i.test(text.slice(i + 1, i + 3))) { out.push(parseInt(text.slice(i + 1, i + 3), 16)); i += 2; }
    else out.push(c.charCodeAt(0) & 0xff);
  }
  return Buffer.from(out);
}

const ENCODED_WORD = /=\?([^?\s]+)\?([BbQq])\?([^?\s]*)\?=/g;
/** A header value with its encoded words decoded; the space between two encoded words goes, as RFC 2047 says. */
export function decodeWords(value: string): string {
  const joined = value.replace(/(=\?[^?\s]+\?[BbQq]\?[^?\s]*\?=)\s+(?==\?[^?\s]+\?[BbQq]\?)/g, '$1');
  return joined.replace(ENCODED_WORD, (_whole, charset: string, kind: string, text: string) => {
    const bytes = kind.toUpperCase() === 'B' ? Buffer.from(text, 'base64') : qBytes(text);
    return decodeBytes(bytes, charset.split('*')[0]);
  });
}

/** The header fields of a message or a MIME part, up to the first empty line. Raw bytes are read as UTF-8. */
export function readHeaders(raw: Buffer | string): MailHeaders {
  const text = typeof raw === 'string' ? raw : decodeBytes(raw, 'utf-8');
  const headers: MailHeaders = new Map();
  let name: string | null = null;
  let value = '';
  const flush = () => {
    if (name) headers.set(name, [...(headers.get(name) ?? []), decodeWords(value.trim())]);
    name = null;
    value = '';
  };
  for (const line of text.split(/\r?\n/)) {
    if (line === '') break;
    if (/^[ \t]/.test(line) && name) { value += ` ${line.trim()}`; continue; }
    flush();
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    name = line.slice(0, colon).trim().toLowerCase();
    value = line.slice(colon + 1);
  }
  flush();
  return headers;
}

/** The first value of one header field, or null. */
export const headerOf = (headers: MailHeaders, name: string): string | null => headers.get(name)?.[0] ?? null;

export type MailAddress = { name: string | null; email: string };

/** Splits an address list on commas outside quotes, angle brackets and comments. */
function splitAddresses(value: string): string[] {
  const parts: string[] = [];
  let current = '', quote = false, angle = 0, paren = 0;
  for (const c of value) {
    if (c === '"' && !angle) quote = !quote;
    else if (!quote && c === '<') angle += 1;
    else if (!quote && c === '>') angle = Math.max(0, angle - 1);
    else if (!quote && c === '(') paren += 1;
    else if (!quote && c === ')') paren = Math.max(0, paren - 1);
    if (c === ',' && !quote && !angle && !paren) { parts.push(current); current = ''; continue; }
    current += c;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

/** Every address in a From, To or Cc value, lower case, with the display name when there is one. */
export function addressesOf(value: string | null): MailAddress[] {
  if (!value) return [];
  const out: MailAddress[] = [];
  for (const part of splitAddresses(value.replace(/^[^:<"]*:(?=[^:]*;\s*$)/, '').replace(/;\s*$/, ''))) {
    const angled = /<([^<>\s]+@[^<>\s]+)>/.exec(part);
    const raw = angled ? angled[1] : /([^\s<>"(),;]+@[^\s<>"(),;]+)/.exec(part)?.[1] ?? null;
    const email = normalEmail(raw);
    if (!email) continue;
    const name = angled ? part.slice(0, angled.index).replace(/\([^)]*\)/g, '').trim().replace(/^"|"$/g, '').replace(/\\(.)/g, '$1').trim() : '';
    out.push({ name: name && !name.includes('@') ? name : null, email });
  }
  return out;
}

/** The message ids in a Message-ID, In-Reply-To or References value, at most max. */
export function messageIdsOf(value: string | null, max = 20): string[] {
  return [...new Set((value ?? '').match(/<[^<>\s]{1,250}>/g) ?? [])].slice(-max);
}

export type ContentType = { type: string; params: Record<string, string> };

/** A Content-Type value: its type in lower case, and its parameters by lower-case name, unquoted. */
export function contentTypeOf(value: string | null): ContentType {
  if (!value) return { type: 'text/plain', params: {} };
  const [head, ...rest] = value.split(';');
  const params: Record<string, string> = {};
  for (const item of rest.join(';').matchAll(/([A-Za-z0-9*_.-]+)\s*=\s*("(?:[^"\\]|\\.)*"|[^;\s]*)/g)) {
    params[item[1].toLowerCase().replace(/\*$/, '')] = item[2].replace(/^"|"$/g, '').replace(/\\(.)/g, '$1');
  }
  return { type: head.trim().toLowerCase() || 'text/plain', params };
}

/** A part's bytes with its transfer encoding undone: base64, quoted-printable, or as they are. */
export function decodeTransfer(body: Buffer, encoding: string | null): Buffer {
  const kind = (encoding ?? '').trim().toLowerCase();
  if (kind === 'base64') return Buffer.from(body.toString('latin1').replace(/[^A-Za-z0-9+/=]/g, ''), 'base64');
  if (kind === 'quoted-printable') {
    const text = body.toString('latin1').replace(/=\r?\n/g, '');
    const out: number[] = [];
    for (let i = 0; i < text.length; i += 1) {
      if (text[i] === '=' && /^[0-9a-f]{2}$/i.test(text.slice(i + 1, i + 3))) { out.push(parseInt(text.slice(i + 1, i + 3), 16)); i += 2; }
      else out.push(text.charCodeAt(i) & 0xff);
    }
    return Buffer.from(out);
  }
  return body;
}

/** One MIME leaf: its type, parameters, header fields and decoded bytes. */
export type MimePart = { type: string; params: Record<string, string>; headers: MailHeaders; body: Buffer };

/**
 * The leaves of a message's body, given its top Content-Type and transfer encoding. A multipart body is split on its
 * boundary (four levels deep at most); a body cut short by a partial fetch keeps what arrived.
 */
export function mimeParts(type: ContentType, encoding: string | null, body: Buffer, depth = 0): MimePart[] {
  const boundary = type.params.boundary;
  if (!type.type.startsWith('multipart/') || !boundary || depth > 4) return [{ type: type.type, params: type.params, headers: new Map(), body: decodeTransfer(body, encoding) }];
  const text = body.toString('latin1');
  const marker = `--${boundary}`;
  const pieces = text.split(new RegExp(`(?:^|\\r?\\n)${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?[ \\t]*(?=\\r?\\n|$)`));
  const parts: MimePart[] = [];
  for (const piece of pieces.slice(1)) {
    const trimmed = piece.replace(/^\r?\n/, '');
    if (!trimmed.trim()) continue;
    const split = /\r?\n\r?\n/.exec(trimmed);
    const headText = split ? trimmed.slice(0, split.index) : trimmed;
    const content = split ? trimmed.slice(split.index + split[0].length) : '';
    const headers = readHeaders(Buffer.from(headText, 'latin1'));
    const inner = contentTypeOf(headerOf(headers, 'content-type'));
    const leaves = mimeParts(inner, headerOf(headers, 'content-transfer-encoding'), Buffer.from(content, 'latin1'), depth + 1);
    for (const leaf of leaves) parts.push(leaf.headers.size ? leaf : { ...leaf, headers });
  }
  return parts;
}

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ' };
/** The words of an HTML part: scripts and styles gone, breaks as new lines, tags and entities as text. */
export function htmlText(html: string): string {
  return html.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<br\s*\/?>|<\/(?:p|div|li|tr|h\d)>/gi, '\n').replace(/<[^>]*>/g, ' ')
    .replace(/&(#x?[0-9a-f]{1,6}|[a-z]{2,6});/gi, (whole, name: string) => {
      if (name.startsWith('#')) {
        const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' ';
      }
      return ENTITIES[name.toLowerCase()] ?? whole;
    }).replace(/[ \t]+/g, ' ');
}

/** The readable text of a message: its first plain-text part, else its first HTML part's words. */
export function readableText(parts: MimePart[]): string {
  const plain = parts.find(part => part.type === 'text/plain');
  if (plain) return decodeBytes(plain.body, plain.params.charset);
  const html = parts.find(part => part.type === 'text/html');
  return html ? htmlText(decodeBytes(html.body, html.params.charset)) : '';
}

/** Lines that start the mail a reply quotes, in English and Hindi mail apps. */
const QUOTE_START: readonly RegExp[] = [
  /^On\b.{0,300}\bwrote:\s*$/i,
  /^-{2,}\s*Original Message\s*-{2,}/i,
  /^-{3,}\s*Forwarded message\s*-{3,}/i,
  /^_{8,}\s*$/,
  /^.{0,200}\s*को\s.{0,300}\sने लिखा:\s*$/u,
];

/**
 * The new words of a reply: everything before the mail it quotes ("On ... wrote:", "Original Message", an Outlook
 * "From: ... Sent:" block), without quoted lines, the signature after "-- ", or Chausar's own unsubscribe lines (the
 * default one, and ours: the Hindi one and each footer actually sent, which a reply may paste back unquoted, even wrapped
 * across lines). At most 4,000 characters.
 */
export function freshText(text: string, ours: readonly string[] = []): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    const joined = `${line} ${(lines[i + 1] ?? '').trim()}`;
    if (QUOTE_START.some(pattern => pattern.test(line)) || (/^On\b/i.test(line) && /\bwrote:\s*$/i.test(joined) && !/\bwrote:/i.test(line))) break;
    if (/^(?:From|De|Von):\s/i.test(line) && lines.slice(i + 1, i + 4).some(next => /^(?:Sent|Date|Gesendet|Envoyé):\s/i.test(next.trim()))) break;
    if (line === '--' || lines[i] === '-- ') break;
    if (line.startsWith('>')) continue;
    out.push(lines[i]);
  }
  let fresh = out.join('\n');
  for (const line of [...new Set([DEFAULT_UNSUBSCRIBE_LINE, ...ours].map(item => item.trim()).filter(item => item.length >= 8))]) {
    const pattern = line.split(/\s+/).map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
    fresh = fresh.replace(new RegExp(pattern, 'giu'), ' ');
  }
  return fresh.trim().slice(0, 4000);
}

/** Second-level labels under which a registrable domain takes three labels (example.co.in), not two. */
const SECOND_LEVEL: ReadonlySet<string> = new Set(['co', 'com', 'net', 'org', 'gov', 'ac', 'edu', 'firm', 'gen', 'ind', 'res']);
/** The registrable domain of a host: imap.mail.example is mail.example, imap.example.co.in is example.co.in. */
export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, '').split('.');
  const keep = labels.length >= 3 && labels.at(-1)!.length === 2 && SECOND_LEVEL.has(labels.at(-2)!) ? 3 : 2;
  return labels.slice(-keep).join('.');
}

/** The authserv-ids each big mailbox provider stamps on its own Authentication-Results, by its IMAP host. */
const PROVIDERS: readonly { host: RegExp; ids: readonly string[] }[] = [
  { host: /(?:^|\.)(?:gmail|googlemail)\.com$/, ids: ['mx.google.com', 'google.com'] },
  { host: /(?:^|\.)(?:outlook\.office365\.com|office365\.com|outlook\.com|hotmail\.com|live\.com)$/, ids: ['protection.outlook.com', 'outlook.com', 'office365.com'] },
  { host: /(?:^|\.)(?:zoho|zohomail)\.(?:com|in|eu)$/, ids: ['zoho.com', 'zohomail.com', 'zoho.in', 'zohomail.in', 'zoho.eu', 'zohomail.eu'] },
  { host: /(?:^|\.)(?:yahoo\.com|yahoo\.co\.in|aol\.com)$/, ids: ['yahoo.com', 'aol.com'] },
];

/**
 * Which authserv-ids to trust for a mailbox on this IMAP host: the provider's own (Gmail, Outlook, Zoho, Yahoo), and
 * the IMAP host's own domain (a business's own mail server). Any other Authentication-Results is not the receiving
 * server's word, whatever it says.
 */
export function trustedAuthServ(imapHost: string): (id: string) => boolean {
  const host = imapHost.toLowerCase();
  const ids = [...(PROVIDERS.find(item => item.host.test(host))?.ids ?? []), registrableDomain(host)];
  return id => ids.some(trusted => id === trusted || id.endsWith(`.${trusted}`));
}

/**
 * Whether the receiving server proved a message comes from its sender's domain. Only the topmost Authentication-Results
 * counts (a sender can only add ones below it), and only when its authserv-id is the mailbox provider's (trusted); it
 * must say dkim=pass with header.d (or header.i) the sender's domain or its parent, or dmarc=pass with header.from the
 * sender's domain. A pass that names no domain proves nothing; anything else, or no such header, is not proof.
 */
export function provedFrom(headers: MailHeaders, domain: string, trusted: (id: string) => boolean): boolean {
  const top = headers.get('authentication-results')?.[0];
  if (!top || !domain) return false;
  const [head, ...results] = top.split(';');
  const id = head.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  if (!id || id.includes('=') || !trusted(id)) return false;
  const aligned = (value: string | undefined) => !!value && (value === domain || domain.endsWith(`.${value}`));
  for (const part of results) {
    const method = /^\s*(dkim|dmarc)\s*=\s*([a-z]+)/i.exec(part);
    if (!method || method[2].toLowerCase() !== 'pass') continue;
    const named = method[1].toLowerCase() === 'dkim' ? /\bheader\.[di]\s*=\s*([^\s;]+)/i.exec(part) : /\bheader\.from\s*=\s*([^\s;]+)/i.exec(part);
    if (aligned(named?.[1]?.toLowerCase().replace(/^.*@/, ''))) return true;
  }
  return false;
}
