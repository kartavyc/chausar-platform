// Chausar venture launcher, network (Ink v2 wave 4, package 4E3, catalogue K8): a read-only IMAP client over node:tls,
// with no new dependency. It speaks only what Chausar needs to read the owner's mail without changing it: CAPABILITY,
// LOGIN (or AUTHENTICATE PLAIN where the server turns LOGIN off), EXAMINE (the read-only open, so no flag can change),
// UID SEARCH, UID FETCH with BODY.PEEK (so nothing is marked read) and LOGOUT. It never sends SELECT, STORE, EXPUNGE,
// COPY, MOVE or APPEND. The host passes the network guard first (no internal name or address, every DNS answer public),
// the socket connects to the address that was checked, and the certificate is checked against the name. One deadline
// covers the whole session, and every reply is capped in size. Nothing here logs, and no error carries the password.
import { connect as tlsConnect } from 'node:tls';
import type { Duplex } from 'node:stream';
import { ChausarError } from '../../contracts.ts';
import { checkUrl, classifyAddress, resolvePublic, type NetResolver } from '../core/net-guard.ts';

/** Where one secure connection goes: the name for the certificate, the checked address for the socket. */
export type TlsTarget = { host: string; address: string; family: 4 | 6; port: number; timeoutMs: number };
/** Opens one secure connection. The real one is node:tls; tests pass a socket pair to a scripted server. */
export type TlsConnector = (target: TlsTarget) => Promise<Duplex>;

/** The longest a whole session may take, unless the caller gives its own deadline. */
export const IMAP_TIMEOUT_MS = 60_000;
const MAX_LINE = 64 * 1024;
const MAX_LITERAL = 512 * 1024;
const MAX_RESPONSE = 8 * 1024 * 1024;
/** The most every untagged reply to one command may hold together, in bytes: a server cannot flood one answer. */
const MAX_COMMAND_BYTES = 4 * 1024 * 1024;
/** The most Chausar reads past and drops in one answer before it gives the session up. */
const MAX_DISCARD = 16 * 1024 * 1024;
/** An answer past the caps, read to its end and dropped: the session is still usable. */
const oversized = (host: string) => Object.assign(new ChausarError('MAILBOX_FAILED', MAILBOX_WORDS.big(host)), { oversized: true });
/** Whether an error is an answer set aside for its size (the session goes on), not a broken session. */
export const isOversized = (error: unknown) => (error as { oversized?: unknown })?.oversized === true;
/** The most of one message's header fields Chausar reads, in bytes. */
export const MAX_HEADER_BYTES = 65_536;
/** The header fields Chausar reads: who, when, what it answers, and the few that say it is automatic, bulk or a report. */
export const HEADER_FIELDS = [
  'FROM', 'SENDER', 'REPLY-TO', 'TO', 'CC', 'DATE', 'SUBJECT', 'MESSAGE-ID', 'IN-REPLY-TO', 'REFERENCES', 'AUTO-SUBMITTED', 'X-AUTOREPLY',
  'X-AUTORESPOND', 'PRECEDENCE', 'LIST-ID', 'LIST-UNSUBSCRIBE', 'CONTENT-TYPE', 'CONTENT-TRANSFER-ENCODING', 'X-FAILED-RECIPIENTS', 'AUTHENTICATION-RESULTS',
] as const;

export const MAILBOX_WORDS = Object.freeze({
  oauthOnly: 'This account only allows Google or Microsoft sign-in, so it can\'t connect this way. Use an app password, or keep recording replies by hand.',
  login: 'The mail server did not accept this address and app password. Check both, and use an app password from your mail account\'s security settings.',
  appPassword: 'Your mail provider wants an app password here, not your usual password. Make one in your account\'s security settings, then try again.',
  tls: (host: string, port: number) => `Chausar could not open a secure connection to ${host} on port ${port}. Use the server's secure IMAP port, usually 993.`,
  timeout: (host: string) => `${host} did not answer in time. Nothing was read.`,
  failed: (host: string) => `${host} answered in a way Chausar does not read, so nothing was read.`,
  closed: (host: string) => `${host} closed the connection. Nothing was read.`,
  big: (host: string) => `${host} sent back more than Chausar reads at once. Nothing was read.`,
  readOnly: 'The mail server would not open your inbox read-only, so Chausar read nothing.',
  host: 'Type the mail server\'s name, like imap.gmail.com, with no https:// or slashes.',
});

/** The real connector: TLS 1.2 or later to the checked address, the certificate checked against the name. */
export const systemTls: TlsConnector = target => new Promise<Duplex>((resolve, reject) => {
  const literal = classifyAddress(target.host) !== null;
  const socket = tlsConnect({ host: target.address, port: target.port, ...(literal ? {} : { servername: target.host }), minVersion: 'TLSv1.2', rejectUnauthorized: true });
  const timer = setTimeout(() => { socket.destroy(); reject(new ChausarError('NET_TIMEOUT', MAILBOX_WORDS.timeout(target.host))); }, Math.max(1, target.timeoutMs));
  socket.once('secureConnect', () => { clearTimeout(timer); resolve(socket); });
  socket.once('error', () => { clearTimeout(timer); socket.destroy(); reject(new ChausarError('MAILBOX_FAILED', MAILBOX_WORDS.tls(target.host, target.port))); });
});

/** The mail server's name as typed, checked by the guard's own rules: a public name or address, never an internal one. */
export function checkMailHost(raw: unknown): string {
  const host = typeof raw === 'string' ? raw.trim().toLowerCase().replace(/\.$/, '') : '';
  if (!host || host.length > 253 || !/^[a-z0-9.:[\]-]+$/.test(host) || host.includes('/')) throw new ChausarError('INVALID_VENTURE_REQUEST', MAILBOX_WORDS.host);
  checkUrl(`https://${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}/`);
  return host;
}

// ---------------------------------------------------------------------------
// The wire: lines and literals, read in order, with one failure for all waiters
// ---------------------------------------------------------------------------

/** One reply as it came: text pieces (bytes as latin1) and literals (raw bytes), in order. */
export type Piece = string | Buffer;

class Wire {
  #buffer: Buffer = Buffer.alloc(0);
  #wake: (() => void) | null = null;
  #failure: ChausarError | null = null;
  #ended = false;
  readonly stream: Duplex;
  readonly host: string;

  constructor(stream: Duplex, host: string) {
    this.stream = stream;
    this.host = host;
    stream.on('data', (chunk: Buffer) => {
      this.#buffer = this.#buffer.length ? Buffer.concat([this.#buffer, chunk]) : Buffer.from(chunk);
      if (this.#buffer.length > MAX_RESPONSE + MAX_LINE) this.fail(new ChausarError('MAILBOX_FAILED', MAILBOX_WORDS.big(host)));
      this.#poke();
    });
    stream.on('end', () => { this.#ended = true; this.#poke(); });
    stream.on('close', () => { this.#ended = true; this.#poke(); });
    stream.on('error', () => this.fail(new ChausarError('MAILBOX_FAILED', MAILBOX_WORDS.closed(host))));
  }

  fail(error: ChausarError): void {
    if (!this.#failure) this.#failure = error;
    this.#poke();
  }

  #poke(): void {
    const wake = this.#wake;
    this.#wake = null;
    wake?.();
  }

  async #more(): Promise<void> {
    if (this.#failure) throw this.#failure;
    if (this.#ended) throw new ChausarError('MAILBOX_FAILED', MAILBOX_WORDS.closed(this.host));
    await new Promise<void>(resolve => { this.#wake = resolve; });
    if (this.#failure) throw this.#failure;
  }

  async line(): Promise<string> {
    for (;;) {
      const at = this.#buffer.indexOf('\r\n');
      if (at >= 0) {
        const line = this.#buffer.subarray(0, at).toString('latin1');
        this.#buffer = this.#buffer.subarray(at + 2);
        return line;
      }
      if (this.#buffer.length > MAX_LINE) throw new ChausarError('MAILBOX_FAILED', MAILBOX_WORDS.big(this.host));
      await this.#more();
    }
  }

  async bytes(n: number): Promise<Buffer> {
    while (this.#buffer.length < n) await this.#more();
    const out = Buffer.from(this.#buffer.subarray(0, n));
    this.#buffer = this.#buffer.subarray(n);
    return out;
  }

  /** Reads past n bytes without keeping them. */
  async skip(n: number): Promise<void> {
    let left = n;
    while (left > 0) {
      if (!this.#buffer.length) await this.#more();
      const take = Math.min(left, this.#buffer.length);
      this.#buffer = this.#buffer.subarray(take);
      left -= take;
    }
  }

  /** True once a reply held a literal past the caps, read past and dropped; the command that asked is told (ImapSession #run). */
  setAside = false;

  /**
   * One whole reply: a line, and when it ends in {n}, the n bytes after it and the rest of the reply. A literal past the
   * caps is read past and dropped (an empty piece in its place, setAside marked), so the session stays in step; past
   * MAX_DISCARD bytes in one reply the session is given up.
   */
  async reply(): Promise<Piece[]> {
    const pieces: Piece[] = [];
    let size = 0;
    for (;;) {
      const line = await this.line();
      const literal = /\{(\d{1,9})\+?\}$/.exec(line);
      if (!literal) { pieces.push(line); return pieces; }
      const n = Number(literal[1]);
      size += n;
      if (size > MAX_DISCARD) throw new ChausarError('MAILBOX_FAILED', MAILBOX_WORDS.big(this.host));
      if (n > MAX_LITERAL || size > MAX_RESPONSE) {
        await this.skip(n);
        this.setAside = true;
        pieces.push(line.slice(0, literal.index), Buffer.alloc(0));
        continue;
      }
      pieces.push(line.slice(0, literal.index), await this.bytes(n));
    }
  }

  write(data: string | Buffer): void {
    if (this.#failure) throw this.#failure;
    this.stream.write(typeof data === 'string' ? Buffer.from(data, 'latin1') : data);
  }
}

// ---------------------------------------------------------------------------
// Tokens: atoms (a BODY[...]<n> name is one atom), strings, literals, lists, NIL
// ---------------------------------------------------------------------------

export type ImapValue = string | Buffer | null | ImapValue[];
type Token = { kind: 'atom'; value: string } | { kind: 'string'; value: Buffer } | { kind: 'open' } | { kind: 'close' };

/** The tokens of one reply. A quoted string or a literal is a string token; NIL is an atom read as null by the parser. */
export function tokensOf(pieces: Piece[]): Token[] {
  const out: Token[] = [];
  for (const piece of pieces) {
    if (Buffer.isBuffer(piece)) { out.push({ kind: 'string', value: piece }); continue; }
    let i = 0;
    while (i < piece.length) {
      const c = piece[i];
      if (c === ' ') { i += 1; continue; }
      if (c === '(') { out.push({ kind: 'open' }); i += 1; continue; }
      if (c === ')') { out.push({ kind: 'close' }); i += 1; continue; }
      if (c === '"') {
        let text = '';
        i += 1;
        while (i < piece.length && piece[i] !== '"') {
          if (piece[i] === '\\' && i + 1 < piece.length) i += 1;
          text += piece[i];
          i += 1;
        }
        i += 1;
        out.push({ kind: 'string', value: Buffer.from(text, 'latin1') });
        continue;
      }
      let atom = '';
      let depth = 0;
      while (i < piece.length) {
        const ch = piece[i];
        if (depth === 0 && (ch === ' ' || ch === '(' || ch === ')')) break;
        if (ch === '[') depth += 1;
        if (ch === ']') depth = Math.max(0, depth - 1);
        atom += ch;
        i += 1;
      }
      out.push({ kind: 'atom', value: atom });
    }
  }
  return out;
}

/** Values from tokens: an atom as text (NIL as null), a string as bytes, a list as an array. */
export function valuesOf(tokens: Token[]): ImapValue[] {
  let at = 0;
  const list = (): ImapValue[] => {
    const items: ImapValue[] = [];
    while (at < tokens.length) {
      const token = tokens[at];
      at += 1;
      if (token.kind === 'close') return items;
      if (token.kind === 'open') { items.push(list()); continue; }
      if (token.kind === 'string') { items.push(token.value); continue; }
      items.push(token.value.toUpperCase() === 'NIL' ? null : token.value);
    }
    return items;
  };
  return list();
}

/** One message's FETCH items by name (upper case): its UID, INTERNALDATE, and each BODY[...] section's bytes. */
export type FetchItems = { seq: number; items: Map<string, ImapValue> };

function fetchOf(pieces: Piece[]): FetchItems | null {
  const head = typeof pieces[0] === 'string' ? pieces[0] : '';
  const match = /^\* (\d+) FETCH /i.exec(head);
  if (!match) return null;
  const values = valuesOf(tokensOf(pieces));
  const list = values.find(value => Array.isArray(value));
  if (!Array.isArray(list)) return null;
  const items = new Map<string, ImapValue>();
  for (let i = 0; i + 1 < list.length; i += 2) {
    const name = list[i];
    if (typeof name === 'string') items.set(name.toUpperCase().replace(/\s+/g, ' '), list[i + 1]);
  }
  return { seq: Number(match[1]), items };
}

const asText = (value: ImapValue | undefined): string | null => (typeof value === 'string' ? value : Buffer.isBuffer(value) ? value.toString('latin1') : null);

// ---------------------------------------------------------------------------
// The session
// ---------------------------------------------------------------------------

/** An IMAP astring: a quoted string for plain printable ASCII, else a literal. */
type Part = string | { literal: Buffer };
const quoted = (value: string): Part => (/^[\x20-\x7e]*$/.test(value) ? `"${value.replace(/[\\"]/g, mark => `\\${mark}`)}"` : { literal: Buffer.from(value, 'utf8') });

/** What one tagged command answered: its untagged replies, its status and its text. */
type Done = { untagged: Piece[][]; status: 'OK' | 'NO' | 'BAD'; text: string };

/** Microsoft's mail servers took sign-in by password away; any refused sign-in there is an OAuth-only account. */
const MICROSOFT = /(?:^|\.)(?:outlook\.office365\.com|office365\.com|outlook\.com|hotmail\.com|live\.com)$/i;
const OAUTH_WORDS = /\b(?:x?oauth2?|oauthbearer|webalert|web\s*login|modern\s+auth\w*|sign\s+in\s+(?:with|through|using|in)\s+(?:a\s+|your\s+)?(?:web\s+)?browser|basic\s+auth\w*\s+(?:is\s+)?(?:disabled|turned\s+off|not\s+supported|blocked))/i;

/** Why a sign-in was refused, in the owner's words: OAuth only, an app password wanted, or a plain refusal. */
export function loginRefusal(text: string, host: string): ChausarError {
  if (OAUTH_WORDS.test(text) || MICROSOFT.test(host)) return new ChausarError('MAILBOX_OAUTH_ONLY', MAILBOX_WORDS.oauthOnly);
  if (/application[-\s]specific\s+password|app\s+password/i.test(text)) return new ChausarError('MAILBOX_LOGIN_FAILED', MAILBOX_WORDS.appPassword);
  return new ChausarError('MAILBOX_LOGIN_FAILED', MAILBOX_WORDS.login);
}

/** The inbox as EXAMINE opened it. */
export type ImapBox = { uidValidity: string; uidNext: number | null; exists: number };
/** One message's headers as fetched: its UID, the server's arrival time, and the raw header bytes. */
export type ImapHead = { uid: number; internalDate: string | null; header: Buffer };

export class ImapSession {
  #wire: Wire;
  #tag = 0;
  #timer: ReturnType<typeof setTimeout> | null;
  #closed = false;
  readonly host: string;
  capabilities = new Set<string>();

  private constructor(wire: Wire, host: string, timeoutMs: number) {
    this.#wire = wire;
    this.host = host;
    this.#timer = setTimeout(() => { wire.fail(new ChausarError('NET_TIMEOUT', MAILBOX_WORDS.timeout(host))); wire.stream.destroy(); }, Math.max(1, timeoutMs));
  }

  /** Reads the server's greeting. A server that says BYE, or anything but OK or PREAUTH, is refused. */
  static async start(stream: Duplex, host: string, timeoutMs: number): Promise<ImapSession> {
    const session = new ImapSession(new Wire(stream, host), host, timeoutMs);
    try {
      const greeting = await session.#wire.reply();
      const line = typeof greeting[0] === 'string' ? greeting[0] : '';
      if (!/^\* (?:OK|PREAUTH)\b/i.test(line)) throw new ChausarError('MAILBOX_FAILED', MAILBOX_WORDS.failed(host));
      session.#capsFrom(line);
      return session;
    } catch (error) {
      session.close();
      throw error;
    }
  }

  #capsFrom(line: string): void {
    const found = /\[CAPABILITY ([^\]]*)\]/i.exec(line) ?? /^\* CAPABILITY (.*)$/i.exec(line);
    if (found) this.capabilities = new Set(found[1].trim().split(/\s+/).map(item => item.toUpperCase()));
  }

  /** Sends one command (literals wait for the server's go-ahead) and reads to its tagged answer. */
  async #run(parts: Part[], onContinue?: () => Buffer): Promise<Done> {
    this.#tag += 1;
    const tag = `c${this.#tag}`;
    let pending = `${tag} `;
    for (const part of parts) {
      if (typeof part === 'string') { pending += part; continue; }
      this.#wire.write(`${pending}{${part.literal.length}}\r\n`);
      pending = '';
      await this.#continuation();
      this.#wire.write(part.literal);
    }
    this.#wire.write(`${pending}\r\n`);
    const untagged: Piece[][] = [];
    let bytes = 0;
    let over = false;
    this.#wire.setAside = false;
    for (;;) {
      const reply = await this.#wire.reply();
      const line = typeof reply[0] === 'string' ? reply[0] : '';
      if (line.startsWith('+')) {
        if (!onContinue) throw new ChausarError('MAILBOX_FAILED', MAILBOX_WORDS.failed(this.host));
        this.#wire.write(Buffer.concat([onContinue(), Buffer.from('\r\n', 'latin1')]));
        continue;
      }
      if (line.startsWith(`${tag} `)) {
        const status = line.slice(tag.length + 1, tag.length + 4).toUpperCase().trim();
        if (status !== 'OK' && status !== 'NO' && status !== 'BAD') throw new ChausarError('MAILBOX_FAILED', MAILBOX_WORDS.failed(this.host));
        // The answer was past the caps: read to its end and dropped, so the session is still in step, and the caller
        // may ask again for less (one message at a time) or skip it.
        if (over || this.#wire.setAside) throw oversized(this.host);
        return { untagged, status, text: line.slice(tag.length + 1) };
      }
      if (/^\* BYE\b/i.test(line)) throw new ChausarError('MAILBOX_FAILED', MAILBOX_WORDS.closed(this.host));
      bytes += reply.reduce((sum, piece) => sum + piece.length, 0);
      if (bytes > MAX_DISCARD) throw new ChausarError('MAILBOX_FAILED', MAILBOX_WORDS.big(this.host));
      if (bytes > MAX_COMMAND_BYTES) over = true;
      if (!over) untagged.push(reply);
    }
  }

  async #continuation(): Promise<void> {
    for (;;) {
      const reply = await this.#wire.reply();
      const line = typeof reply[0] === 'string' ? reply[0] : '';
      if (line.startsWith('+')) return;
      if (/^c\d+ (?:NO|BAD)\b/i.test(line) || /^\* BYE\b/i.test(line)) throw new ChausarError('MAILBOX_FAILED', MAILBOX_WORDS.failed(this.host));
    }
  }

  #ok(done: Done): Done {
    if (done.status !== 'OK') throw new ChausarError('MAILBOX_FAILED', MAILBOX_WORDS.failed(this.host));
    return done;
  }

  /** Signs in: LOGIN, or AUTHENTICATE PLAIN when the server turns LOGIN off; with neither, it is an OAuth-only account. */
  async login(user: string, password: string): Promise<void> {
    if (!this.capabilities.size) {
      const done = this.#ok(await this.#run(['CAPABILITY']));
      for (const reply of done.untagged) if (typeof reply[0] === 'string') this.#capsFrom(reply[0]);
    }
    let done: Done;
    if (this.capabilities.has('LOGINDISABLED')) {
      if (!this.capabilities.has('AUTH=PLAIN')) throw new ChausarError('MAILBOX_OAUTH_ONLY', MAILBOX_WORDS.oauthOnly);
      const nul = String.fromCharCode(0);
      done = await this.#run(['AUTHENTICATE PLAIN'], () => Buffer.from(Buffer.from(`${nul}${user}${nul}${password}`, 'utf8').toString('base64'), 'latin1'));
    } else {
      done = await this.#run(['LOGIN ', quoted(user), ' ', quoted(password)]);
    }
    if (done.status !== 'OK') throw loginRefusal(done.text, this.host);
  }

  /** Opens the inbox read-only (EXAMINE). A server that opens it for writing anyway is refused. */
  async examine(box = 'INBOX'): Promise<ImapBox> {
    const done = this.#ok(await this.#run([`EXAMINE ${box}`]));
    if (/\[READ-WRITE\]/i.test(done.text)) throw new ChausarError('MAILBOX_FAILED', MAILBOX_WORDS.readOnly);
    let uidValidity: string | null = null, uidNext: number | null = null, exists = 0;
    for (const reply of done.untagged) {
      const line = typeof reply[0] === 'string' ? reply[0] : '';
      uidValidity = /\[UIDVALIDITY (\d{1,20})\]/i.exec(line)?.[1] ?? uidValidity;
      const next = /\[UIDNEXT (\d{1,20})\]/i.exec(line)?.[1];
      if (next) uidNext = Number(next);
      const count = /^\* (\d{1,10}) EXISTS/i.exec(line)?.[1];
      if (count) exists = Number(count);
    }
    if (!uidValidity) throw new ChausarError('MAILBOX_FAILED', MAILBOX_WORDS.failed(this.host));
    return { uidValidity, uidNext, exists };
  }

  /** UID SEARCH with Chausar's own criteria (a UID range or SINCE a day): the UIDs, in order. */
  async uidSearch(criteria: string): Promise<number[]> {
    const done = this.#ok(await this.#run([`UID SEARCH ${criteria}`]));
    const uids = new Set<number>();
    for (const reply of done.untagged) {
      const line = typeof reply[0] === 'string' ? reply[0] : '';
      const found = /^\* SEARCH\b(.*)$/i.exec(line);
      if (!found) continue;
      for (const word of found[1].trim().split(/\s+/)) if (/^\d{1,10}$/.test(word)) uids.add(Number(word));
    }
    return [...uids].sort((a, b) => a - b);
  }

  /**
   * The header fields Chausar reads, at most 64 KB a message, for each UID, with BODY.PEEK so nothing is marked read. A
   * batch the server refuses is fetched again one message at a time, and a message it still refuses is skipped.
   */
  async fetchHeaders(uids: readonly number[]): Promise<ImapHead[]> {
    if (!uids.length) return [];
    let done: Done;
    try {
      done = await this.#run([`UID FETCH ${uids.join(',')} (UID INTERNALDATE BODY.PEEK[HEADER.FIELDS (${HEADER_FIELDS.join(' ')})]<0.${MAX_HEADER_BYTES}>)`]);
    } catch (error) {
      // An answer past the caps (a server that ignored the partial fetch): ask again one message at a time, skip the one.
      if (!isOversized(error)) throw error;
      done = { untagged: [], status: 'NO', text: '' };
    }
    if (done.status === 'BAD') throw new ChausarError('MAILBOX_FAILED', MAILBOX_WORDS.failed(this.host));
    if (done.status === 'NO') {
      if (uids.length === 1) return [];
      const heads: ImapHead[] = [];
      for (const uid of uids) heads.push(...await this.fetchHeaders([uid]));
      return heads;
    }
    const heads: ImapHead[] = [];
    for (const reply of done.untagged) {
      const fetched = fetchOf(reply);
      if (!fetched) continue;
      const uid = Number(asText(fetched.items.get('UID')) ?? '');
      const section = [...fetched.items].find(([name]) => name.startsWith('BODY[HEADER'))?.[1];
      if (!Number.isSafeInteger(uid) || !Buffer.isBuffer(section)) continue;
      heads.push({ uid, internalDate: asText(fetched.items.get('INTERNALDATE')), header: section });
    }
    return heads.sort((a, b) => a.uid - b.uid);
  }

  /** The first maxBytes of one message's text, with BODY.PEEK so it is not marked read. Null when the server sent none or refused it. */
  async fetchText(uid: number, maxBytes: number): Promise<Buffer | null> {
    let done: Done;
    try {
      done = await this.#run([`UID FETCH ${uid} (UID BODY.PEEK[TEXT]<0.${maxBytes}>)`]);
    } catch (error) {
      if (isOversized(error)) return null; // past the caps: this text is skipped, and the session goes on
      throw error;
    }
    if (done.status === 'BAD') throw new ChausarError('MAILBOX_FAILED', MAILBOX_WORDS.failed(this.host));
    if (done.status === 'NO') return null;
    for (const reply of done.untagged) {
      const fetched = fetchOf(reply);
      if (!fetched || Number(asText(fetched.items.get('UID')) ?? '') !== uid) continue;
      const section = [...fetched.items].find(([name]) => name.startsWith('BODY[TEXT]'))?.[1];
      if (Buffer.isBuffer(section)) return section;
      if (typeof section === 'string') return Buffer.from(section, 'latin1');
    }
    return null;
  }

  /** Says goodbye, best effort, and closes. */
  async logout(): Promise<void> {
    try { if (!this.#closed) await this.#run(['LOGOUT']); } catch { /* closing anyway */ }
    this.close();
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    this.#wire.stream.destroy();
  }
}

/** What opening a mailbox takes: the server, the owner's address and app password, and the guard's lookup and connector. */
export type OpenMailbox = {
  host: string; port: number; user: string; password: string; resolve?: NetResolver; connect?: TlsConnector; timeoutMs?: number;
};

/**
 * Checks the server's name, looks it up (every answer must be public), connects securely to the checked address and
 * signs in. Answers the session; the caller examines the inbox, reads, and logs out. A refusal closes the connection.
 */
export async function openMailbox(input: OpenMailbox): Promise<ImapSession> {
  const host = checkMailHost(input.host);
  const timeoutMs = input.timeoutMs ?? IMAP_TIMEOUT_MS;
  const checked = await resolvePublic(host.replace(/^\[|\]$/g, ''), input.resolve);
  const stream = await (input.connect ?? systemTls)({ host, address: checked.address, family: checked.family, port: input.port, timeoutMs });
  const session = await ImapSession.start(stream, host, timeoutMs);
  try {
    await session.login(input.user, input.password);
    return session;
  } catch (error) {
    session.close();
    throw error;
  }
}

const IMAP_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** A day as IMAP's SEARCH SINCE takes it: '26-Sep-2026'. */
export function imapDay(day: string): string {
  const [year, month, date] = day.split('-');
  return `${Number(date)}-${IMAP_MONTHS[Number(month) - 1]}-${year}`;
}
