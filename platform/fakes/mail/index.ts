/**
 * A stateful mail provider in memory: an SMTP submission server (STARTTLS and implicit TLS,
 * AUTH PLAIN only after TLS) and an IMAP server over the same mailboxes. Accepted mail is
 * delivered to `outbox` (the test inbox) and saved to the sender's Sent folder, as many servers do.
 */
import { readFileSync } from 'node:fs';
import { ChausarError } from '../../runtime/contracts.ts';
import type { Dialer, FakeSystem, LineSocket, MailEndpoint, WireObject } from '../../runtime/writeback/types.ts';

type User = { username: string; password: string; address: string; folders: string[] };
export type MailSeed = { smtp: MailEndpoint[]; imap: { host: string; port: number }; users: User[] };
export const mailSeed: MailSeed = JSON.parse(readFileSync(new URL('../../../fixtures/writeback/mail.json', import.meta.url), 'utf8'));
export type Delivered = { from: string; to: string[]; messageId: string; headers: Record<string, string>; body: string; raw: string; at: string };

/** Header fields of a raw message, unfolded, by lower-case name (first occurrence wins). */
export function headersOf(raw: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of raw.split('\r\n\r\n')[0].replace(/\r\n[ \t]+/g, ' ').split('\r\n')) { const m = /^([!-9;-~]+):[ \t]*(.*)$/.exec(line); if (m && !(m[1].toLowerCase() in fields)) fields[m[1].toLowerCase()] = m[2]; }
  return fields;
}
/** The quoted strings and atoms of an IMAP argument list. */
function strings(text: string): string[] {
  const out: string[] = [], re = /\s*(?:"((?:[^"\\]|\\.)*)"|([^\s"]+))/y; let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2]);
  return out;
}

/** The server side of one connection. Replies are queued synchronously as lines arrive. */
class FakeLines implements LineSocket {
  #replies: string[] = []; #buffer = ''; #dead = false;
  handle: (line: string) => void = () => {}; upgrader: () => boolean = () => false;
  send(...lines: string[]) { if (!this.#dead) this.#replies.push(...lines); }
  kill() { this.#dead = true; this.#replies = []; }
  async readLine() {
    const line = this.#replies.shift(); if (line !== undefined) return line;
    throw this.#dead ? new ChausarError('MAIL_CONNECTION_LOST', 'The mail connection was lost.') : new ChausarError('MAIL_TIMEOUT', 'The mail server stopped answering.');
  }
  async write(data: string) {
    if (this.#dead) throw new ChausarError('MAIL_CONNECTION_LOST', 'The mail connection was lost.');
    this.#buffer += data; let at: number;
    while (!this.#dead && (at = this.#buffer.indexOf('\r\n')) >= 0) { const line = this.#buffer.slice(0, at); this.#buffer = this.#buffer.slice(at + 2); this.handle(line); }
  }
  async upgrade() { if (this.#dead || !this.upgrader()) throw new ChausarError('MAIL_TLS_FAILED', 'The mail server did not complete a secure connection.'); }
  close() { this.#dead = true; }
}

export class MailFake implements FakeSystem {
  readonly system = 'mail' as const;
  readonly log: { method: string; target: string; body: string | null }[] = [];
  readonly outbox: Delivered[] = [];
  readonly mailboxes: Record<string, Record<string, { uid: number; raw: string }[]>> = {};
  /** Whether EHLO on a plain connection offers STARTTLS. */
  offerStartTls = true;
  #seed: MailSeed; #fault: 'drop-after-commit' | 'fail-before-commit' | 'none' = 'none'; #saveSent = true; #uid = 1; #queue = 1; #clock: () => string;
  constructor(seed: MailSeed = mailSeed, clock: () => string = () => new Date().toISOString()) {
    this.#seed = structuredClone(seed); this.#clock = clock;
    for (const user of this.#seed.users) this.mailboxes[user.username] = Object.fromEntries(user.folders.map(folder => [folder, []]));
  }
  fault(kind: 'drop-after-commit' | 'fail-before-commit' | 'none') { this.#fault = kind; }
  /** Emulates servers that do not keep a copy of submitted mail. */
  saveSent(on: boolean) { this.#saveSent = on; }
  prime() {}
  snapshot(): WireObject {
    return structuredClone({ outbox: this.outbox.map(({ raw: _raw, ...mail }) => mail),
      mailboxes: Object.fromEntries(Object.entries(this.mailboxes).map(([user, folders]) => [user, Object.fromEntries(Object.entries(folders).map(([name, list]) => [name, list.map(m => ({ uid: m.uid, messageId: headersOf(m.raw)['message-id'] ?? '' }))]))])) }) as unknown as WireObject;
  }
  readonly dial: Dialer = async endpoint => {
    this.log.push({ method: 'CONNECT', target: endpoint.port === this.#seed.imap.port && endpoint.host === this.#seed.imap.host ? 'imap' : 'smtp', body: `${endpoint.host}:${endpoint.port} ${endpoint.security}` });
    if (this.#seed.smtp.some(e => e.host === endpoint.host && e.port === endpoint.port && e.security === endpoint.security)) return this.#smtp(endpoint);
    if (endpoint.host === this.#seed.imap.host && endpoint.port === this.#seed.imap.port && endpoint.security === 'implicit-tls') return this.#imap();
    throw new ChausarError('MAIL_CONNECTION_FAILED', 'The mail server could not be reached.');
  };
  #user(username: string, password: string) { return this.#seed.users.find(u => u.username === username && u.password === password) ?? null; }

  #smtp(endpoint: MailEndpoint): LineSocket {
    const s = new FakeLines();
    let secure = endpoint.security === 'implicit-tls', tlsPending = false, user: User | null = null, from: string | null = null, rcpts: string[] = [], data: string[] | null = null;
    s.send(`220 ${endpoint.host} ESMTP practice`);
    s.upgrader = () => { if (!tlsPending) return false; tlsPending = false; secure = true; user = null; from = null; rcpts = []; this.log.push({ method: 'TLS', target: 'smtp', body: null }); return true; };
    s.handle = line => {
      if (data) {
        if (line !== '.') { data.push(line.startsWith('.') ? line.slice(1) : line); return; }
        const raw = `${data.join('\r\n')}\r\n`; data = null;
        this.log.push({ method: 'MESSAGE', target: 'smtp', body: raw });
        if (this.#fault === 'fail-before-commit') { this.#fault = 'none'; return s.kill(); }
        const headers = headersOf(raw), body = /base64/i.test(headers['content-transfer-encoding'] ?? '') ? Buffer.from(raw.split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n/g, ''), 'base64').toString('utf8') : raw.split('\r\n\r\n').slice(1).join('\r\n\r\n');
        this.outbox.push({ from: from!, to: [...rcpts], messageId: headers['message-id'] ?? '', headers, body, raw, at: this.#clock() });
        if (this.#saveSent) { const folders = this.mailboxes[user!.username], sent = 'Sent' in folders ? 'Sent' : Object.keys(folders).find(f => f.startsWith('Sent')); if (sent) folders[sent].push({ uid: this.#uid++, raw }); }
        from = null; rcpts = [];
        if (this.#fault === 'drop-after-commit') { this.#fault = 'none'; return s.kill(); }
        return s.send(`250 2.0.0 Ok: queued as P${String(this.#queue++).padStart(6, '0')}`);
      }
      const verb = line.split(' ')[0].toUpperCase(), arg = line.slice(verb.length + 1);
      this.log.push({ method: verb, target: 'smtp', body: verb === 'AUTH' ? 'AUTH [redacted]' : line });
      if (tlsPending) return s.send('503 5.5.1 Finish the TLS negotiation first');
      switch (verb) {
        case 'EHLO': return s.send(`250-${endpoint.host} at your service`, '250-SIZE 10485760', '250-8BITMIME', ...(!secure && this.offerStartTls ? ['250-STARTTLS'] : []), '250 AUTH PLAIN');
        case 'STARTTLS': if (secure || !this.offerStartTls) return s.send('503 5.5.1 TLS not available'); tlsPending = true; return s.send('220 2.0.0 Ready to start TLS');
        case 'AUTH': {
          if (!secure) return s.send('530 5.7.0 Must issue a STARTTLS command first');
          const m = /^PLAIN ([A-Za-z0-9+/=]+)$/i.exec(arg); if (!m) return s.send('504 5.5.4 Unrecognized authentication type');
          const [, username = '', password = ''] = Buffer.from(m[1], 'base64').toString('utf8').split('\u0000');
          user = this.#user(username, password); return s.send(user ? '235 2.7.0 Authentication successful' : '535 5.7.8 Authentication credentials invalid');
        }
        case 'MAIL': {
          if (!user) return s.send('530 5.7.0 Authentication required');
          const m = /^FROM:<([^<>\s]+)>$/i.exec(arg); if (!m) return s.send('501 5.5.4 Syntax error');
          if (m[1] !== user.address) return s.send('553 5.7.1 Sender address rejected: not owned by user');
          from = m[1]; rcpts = []; return s.send('250 2.1.0 Ok');
        }
        case 'RCPT': { const m = /^TO:<([^<>\s]+)>$/i.exec(arg); if (!from || !m) return s.send('503 5.5.1 Bad sequence of commands'); rcpts.push(m[1]); return s.send('250 2.1.5 Ok'); }
        case 'DATA': if (!from || !rcpts.length) return s.send('503 5.5.1 Bad sequence of commands'); data = []; return s.send('354 End data with <CR><LF>.<CR><LF>');
        case 'RSET': from = null; rcpts = []; return s.send('250 2.0.0 Ok');
        case 'NOOP': return s.send('250 2.0.0 Ok');
        case 'QUIT': return s.send('221 2.0.0 Bye');
        default: return s.send('502 5.5.2 Command not recognized');
      }
    };
    return s;
  }

  #imap(): LineSocket {
    const s = new FakeLines(); let user: User | null = null, folder: { uid: number; raw: string }[] | null = null;
    s.send('* OK [CAPABILITY IMAP4rev1 AUTH=PLAIN] practice IMAP ready');
    s.handle = line => {
      const m = /^([A-Za-z0-9]+) ([A-Za-z]+)(?: (.*))?$/.exec(line); if (!m) return s.send('* BAD Malformed command');
      const [, tag, verbRaw, rest = ''] = m, verb = verbRaw.toUpperCase();
      this.log.push({ method: verb === 'UID' ? `UID ${rest.split(' ')[0].toUpperCase()}` : verb, target: 'imap', body: verb === 'LOGIN' ? `${tag} LOGIN [redacted]` : line });
      if (verb === 'LOGIN') { const [u = '', p = ''] = strings(rest); user = this.#user(u, p); return s.send(user ? `${tag} OK LOGIN completed` : `${tag} NO [AUTHENTICATIONFAILED] Invalid credentials`); }
      if (verb === 'LOGOUT') return s.send('* BYE practice IMAP logging out', `${tag} OK LOGOUT completed`);
      if (!user) return s.send(`${tag} BAD Not authenticated`);
      if (verb === 'SELECT') {
        const name = strings(rest)[0] ?? ''; folder = this.mailboxes[user.username][name] ?? null;
        return folder ? s.send(`* ${folder.length} EXISTS`, '* FLAGS (\\Seen \\Answered \\Flagged \\Deleted \\Draft)', `${tag} OK [READ-WRITE] SELECT completed`) : s.send(`${tag} NO [NONEXISTENT] Unknown mailbox`);
      }
      if (!folder) return s.send(`${tag} BAD No mailbox selected`);
      const search = /^UID SEARCH HEADER (\S+) (.*)$/i.exec(line.slice(tag.length + 1));
      if (search) {
        const [field, value = ''] = [search[1].toLowerCase(), strings(search[2])[0]];
        return s.send(`* SEARCH${folder.filter(msg => (headersOf(msg.raw)[field] ?? '').toLowerCase().includes(value.toLowerCase())).map(msg => ` ${msg.uid}`).join('')}`, `${tag} OK SEARCH completed`);
      }
      const fetch = /^UID FETCH (\d+) \(BODY\.PEEK\[HEADER\.FIELDS \(([A-Za-z -]+)\)\]\)$/i.exec(line.slice(tag.length + 1));
      if (fetch) {
        const index = folder.findIndex(msg => msg.uid === Number(fetch[1])); if (index < 0) return s.send(`${tag} OK FETCH completed`);
        const wanted = fetch[2].toLowerCase().split(' '), kept: string[] = []; let keep = false;
        for (const headerLine of folder[index].raw.split('\r\n\r\n')[0].split('\r\n')) { if (!/^[ \t]/.test(headerLine)) keep = wanted.includes(headerLine.split(':')[0].toLowerCase()); if (keep) kept.push(headerLine); }
        const literal = `${kept.join('\r\n')}\r\n\r\n`;
        return s.send(`* ${index + 1} FETCH (UID ${fetch[1]} BODY[HEADER.FIELDS (${fetch[2].toUpperCase()})] {${Buffer.byteLength(literal)}}`, ...literal.split('\r\n').slice(0, -1), ')', `${tag} OK FETCH completed`);
      }
      return s.send(`${tag} BAD Command not recognized`);
    };
    return s;
  }
}
