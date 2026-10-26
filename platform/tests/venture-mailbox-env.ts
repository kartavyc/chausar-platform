// Shared by the mailbox, inbound and meeting tests (Ink v2 wave 4, package 4E3): a scripted fake IMAP server on a socket
// pair (node:stream duplexPair), which answers exactly the commands a read-only client may send and records every one,
// so a test can prove nothing was selected for writing, stored, or fetched without PEEK; mail built as RFC 5322 text;
// and a business in India with people from the owner's own files, the network guard's lookup stubbed to a public
// address and its TLS connector to the fake server. The app password is built at runtime, never a literal.
import { duplexPair, type Duplex } from 'node:stream';
import type { Context } from '../runtime/contracts.ts';
import type { InboundRecord, MailboxSync, MailboxView, OpportunityRecord, OutreachRecord, PersonRecord } from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import type { TlsConnector, TlsTarget } from '../runtime/venture/network/imap.ts';
import { recordCardSend } from '../runtime/venture/network/pipeline.ts';
import { owner, setup, type Env } from './venture-views-env.ts';
import { CONTACTS, net } from './venture-network-env.ts';
import { add, withPeople } from './venture-pipeline-env.ts';

export type FakeMail = { uid: number; raw: string; internalDate: string };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** An instant as IMAP's INTERNALDATE writes it: '15-Oct-2026 10:00:00 +0000'. */
export function internalDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getUTCDate())}-${MONTHS[d.getUTCMonth()]}-${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0000`;
}

/** The receiving server's own check of a message from a domain: DKIM and DMARC passed for it. */
export const passed = (domain: string) => `Authentication-Results: mx.mail.example; dkim=pass header.d=${domain}; spf=pass; dmarc=pass header.from=${domain}`;

let messageNo = 0;
/** One message as RFC 5322 text with CRLF line ends. An Authentication-Results line goes first, as a receiving server puts it. */
export function mail(input: {
  from: string; to?: string; subject: string; date: string; body: string; headers?: string[]; messageId?: string; contentType?: string;
}): string {
  messageNo += 1;
  const auth = (line: string) => /^Authentication-Results:/i.test(line);
  const lines = [
    ...(input.headers ?? []).filter(auth),
    `From: ${input.from}`, `To: ${input.to ?? 'Owner <owner@ledger.example>'}`, `Subject: ${input.subject}`, `Date: ${new Date(input.date).toUTCString()}`,
    `Message-ID: ${input.messageId ?? `<m${messageNo}.${Date.parse(input.date)}@mail.example>`}`, ...(input.headers ?? []).filter(line => !auth(line)),
    'MIME-Version: 1.0', `Content-Type: ${input.contentType ?? 'text/plain; charset=utf-8'}`,
  ];
  return `${lines.join('\r\n')}\r\n\r\n${input.body.replace(/\r?\n/g, '\r\n')}\r\n`;
}

/** The app password the fake server accepts, made at runtime. */
export const APP_PASSWORD = ['abcd', 'efgh', 'ijkl', 'mnop'].join(' ');

/** The header section of a raw message, and the fields of it a HEADER.FIELDS fetch names. */
function headerFields(raw: string, names: string[]): string {
  const head = raw.split('\r\n\r\n')[0];
  const out: string[] = [];
  let keep = false;
  for (const line of head.split('\r\n')) {
    if (/^[ \t]/.test(line)) { if (keep) out.push(line); continue; }
    const name = line.slice(0, line.indexOf(':')).trim().toUpperCase();
    keep = names.includes(name);
    if (keep) out.push(line);
  }
  return `${out.join('\r\n')}\r\n\r\n`;
}

/**
 * A scripted IMAP server. caps: what CAPABILITY and the greeting say. loginReply: a tagged answer to LOGIN in place of
 * the check (for OAuth-only and wrong-password servers). chunked: every answer goes in pieces of three bytes, as TLS
 * may hand them over. failText, failHeaders: UIDs whose fetch the server refuses. Every command line is in commands.
 */
export class FakeImap {
  caps = 'IMAP4rev1 AUTH=PLAIN LITERAL+ UIDPLUS';
  user = 'owner@ledger.example';
  password = APP_PASSWORD;
  uidValidity = '1700000001';
  messages: FakeMail[] = [];
  loginReply: string | null = null;
  examineReadWrite = false;
  chunked = false;
  failText = new Set<number>();
  failHeaders = new Set<number>();
  /** UIDs for which the server ignores a partial fetch and sends the whole section. */
  ignorePartial = new Set<number>();
  commands: string[] = [];
  targets: TlsTarget[] = [];
  /** UIDs a fetch would have marked read (a BODY[...] without PEEK, RFC822, or a STORE). Must stay empty. */
  marked = new Set<number>();
  logins = 0;

  connector: TlsConnector = async target => {
    this.targets.push(target);
    const [client, server] = duplexPair();
    this.#serve(server);
    return client;
  };

  /** Adds one message with the next UID, arrived at the given instant. */
  deliver(raw: string, at: string, given?: number): number {
    const uid = given ?? (this.messages.at(-1)?.uid ?? 100) + 1;
    this.messages.push({ uid, raw, internalDate: internalDate(at) });
    this.messages.sort((a, b) => a.uid - b.uid);
    return uid;
  }

  #serve(stream: Duplex): void {
    let buffer = Buffer.alloc(0);
    let waiting: { n: number; rest: (bytes: Buffer, tail: string) => void } | null = null;
    let auth: string | null = null;
    const write = (text: string | Buffer) => {
      const bytes = typeof text === 'string' ? Buffer.from(text, 'utf8') : text;
      if (!this.chunked) { stream.write(bytes); return; }
      for (let i = 0; i < bytes.length; i += 3) stream.write(bytes.subarray(i, i + 3));
    };
    write(`* OK [CAPABILITY ${this.caps}] Fake IMAP ready\r\n`);
    const handle = (line: string) => {
      if (auth) { const tag = auth; auth = null; this.#plain(tag, line, write); return; }
      this.commands.push(line);
      const match = /^(\S+) (.*)$/.exec(line);
      if (!match) return;
      const [, tag, command] = match;
      const literal = /\{(\d+)\}$/.exec(command);
      if (literal) {
        // A synchronizing literal: say go ahead, take n bytes, then the rest of the line.
        write('+ go ahead\r\n');
        const head = command.slice(0, literal.index);
        waiting = { n: Number(literal[1]), rest: (bytes, tail) => this.#command(tag, `${head}"${bytes.toString('utf8')}"${tail}`, write, stream) };
        return;
      }
      if (/^AUTHENTICATE PLAIN$/i.test(command)) { write('+ \r\n'); auth = tag; return; }
      this.#command(tag, command, write, stream);
    };
    stream.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        if (waiting) {
          if (buffer.length < waiting.n) return;
          const bytes = buffer.subarray(0, waiting.n);
          const rest = buffer.subarray(waiting.n);
          const end = rest.indexOf('\r\n');
          if (end < 0) return;
          buffer = rest.subarray(end + 2);
          const done = waiting;
          waiting = null;
          done.rest(Buffer.from(bytes), rest.subarray(0, end).toString('utf8'));
          continue;
        }
        const end = buffer.indexOf('\r\n');
        if (end < 0) return;
        const line = buffer.subarray(0, end).toString('utf8');
        buffer = buffer.subarray(end + 2);
        handle(line);
      }
    });
    stream.on('error', () => undefined);
  }

  #plain(tag: string, line: string, write: (text: string | Buffer) => void): void {
    const [, user, password] = Buffer.from(line, 'base64').toString('utf8').split(String.fromCharCode(0));
    this.logins += 1;
    write(user === this.user && password === this.password ? `${tag} OK signed in\r\n` : `${tag} NO [AUTHENTICATIONFAILED] Invalid credentials\r\n`);
  }

  #command(tag: string, command: string, write: (text: string | Buffer) => void, stream: Duplex): void {
    const upper = command.toUpperCase();
    if (upper === 'CAPABILITY') { write(`* CAPABILITY ${this.caps}\r\n${tag} OK done\r\n`); return; }
    if (upper.startsWith('LOGIN ')) {
      this.logins += 1;
      if (this.loginReply) { write(`${tag} ${this.loginReply}\r\n`); return; }
      const args = [...command.slice(6).matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(item => item[1].replace(/\\(.)/g, '$1'));
      write(args[0] === this.user && args[1] === this.password ? `${tag} OK signed in\r\n` : `${tag} NO [AUTHENTICATIONFAILED] Invalid credentials (Failure)\r\n`);
      return;
    }
    if (upper.startsWith('EXAMINE ') || upper.startsWith('SELECT ')) {
      const next = (this.messages.at(-1)?.uid ?? 100) + 1;
      write(`* ${this.messages.length} EXISTS\r\n* OK [UIDVALIDITY ${this.uidValidity}] UIDs valid\r\n* OK [UIDNEXT ${next}] next\r\n`);
      write(`${tag} OK [${this.examineReadWrite || upper.startsWith('SELECT ') ? 'READ-WRITE' : 'READ-ONLY'}] done\r\n`);
      return;
    }
    if (upper.startsWith('UID SEARCH ')) {
      const criteria = command.slice(11).trim();
      const range = /\bUID (\d+):(\d+|\*)/i.exec(criteria);
      const since = /\bSINCE (\d{1,2})-([A-Za-z]{3})-(\d{4})/i.exec(criteria);
      let found = this.messages.map(item => item.uid);
      if (range) {
        const from = Number(range[1]), to = range[2] === '*' ? Infinity : Number(range[2]);
        const hit = found.filter(uid => uid >= from && uid <= to);
        // RFC 3501: n:* with n past the last UID still names the last message.
        found = !hit.length && range[2] === '*' && this.messages.length ? [this.messages.at(-1)!.uid] : hit;
      }
      if (since) {
        const day = Date.UTC(Number(since[3]), MONTHS.indexOf(since[2][0].toUpperCase() + since[2].slice(1).toLowerCase()), Number(since[1]));
        found = found.filter(uid => {
          const message = this.messages.find(item => item.uid === uid)!;
          return Date.parse(message.internalDate.replace(/^(\d+)-(\w+)-(\d+) /, '$2 $1 $3 ')) >= day;
        });
      }
      write(`* SEARCH${found.map(uid => ` ${uid}`).join('')}\r\n${tag} OK done\r\n`);
      return;
    }
    if (upper.startsWith('UID FETCH ')) {
      const [, set, items] = /^UID FETCH (\S+) \((.*)\)$/i.exec(command) ?? [];
      const uids = (set ?? '').split(',').map(Number);
      if ((/BODY\[/i.test(items ?? '') && !/BODY\.PEEK\[/i.test(items ?? '')) || /RFC822(?!\.SIZE)/i.test(items ?? '')) for (const uid of uids) this.marked.add(uid);
      const fields = /HEADER\.FIELDS \(([^)]*)\)\](?:<0\.(\d+)>)?/i.exec(items ?? '');
      const partial = /BODY\.PEEK\[TEXT\]<0\.(\d+)>/i.exec(items ?? '');
      if ((fields && uids.some(uid => this.failHeaders.has(uid))) || (partial && uids.some(uid => this.failText.has(uid)))) { write(`${tag} NO [UNAVAILABLE] cannot read that message\r\n`); return; }
      for (const uid of uids) {
        const message = this.messages.find(item => item.uid === uid);
        if (!message) continue;
        const seq = this.messages.indexOf(message) + 1;
        if (fields) {
          let bytes = Buffer.from(headerFields(message.raw, fields[1].toUpperCase().split(/\s+/)), 'utf8');
          if (fields[2] && !this.ignorePartial.has(uid)) bytes = bytes.subarray(0, Number(fields[2]));
          const name = `BODY[HEADER.FIELDS (${fields[1]})]${fields[2] ? '<0>' : ''}`;
          write(Buffer.concat([Buffer.from(`* ${seq} FETCH (UID ${uid} INTERNALDATE "${message.internalDate}" ${name} {${bytes.length}}\r\n`), bytes, Buffer.from(')\r\n')]));
          continue;
        }
        if (partial) {
          const whole = Buffer.from(message.raw, 'utf8');
          const start = whole.indexOf('\r\n\r\n') + 4;
          const bytes = this.ignorePartial.has(uid) ? whole.subarray(start) : whole.subarray(start, start + Number(partial[1]));
          write(Buffer.concat([Buffer.from(`* ${seq} FETCH (UID ${uid} BODY[TEXT]<0> {${bytes.length}}\r\n`), bytes, Buffer.from(')\r\n')]));
        }
      }
      write(`${tag} OK done\r\n`);
      return;
    }
    if (upper.startsWith('UID STORE') || upper.startsWith('STORE')) { for (const message of this.messages) this.marked.add(message.uid); write(`${tag} OK done\r\n`); return; }
    if (upper === 'LOGOUT') { write(`* BYE bye\r\n${tag} OK done\r\n`); stream.end(); return; }
    write(`${tag} BAD unknown\r\n`);
  }
}

/** Calls one network handler as the owner, inside the app unless a test says otherwise. */
export const mailCall = <T>(env: Env, method: string, payload: unknown = {}, ctx: Context = owner) => net<T>(env, method as never, payload, ctx);

/** A public address for every name, as the guard's lookup would answer for a real mail server. */
export const PUBLIC = '142.250.1.10';

/** The owner's mailbox settings for the fake server. */
export const MAILBOX = { host: 'imap.mail.example', port: 993, user: 'owner@ledger.example', appPassword: APP_PASSWORD };

export type MailEnv = Env & { imap: FakeImap; asha: PersonRecord; rahul: PersonRecord; priya: PersonRecord };

/** A business with Asha, Rahul and Farhan (LinkedIn) and Priya and Asha (contacts), the fake server, and the guard stubbed. */
export async function mailEnv(): Promise<MailEnv> {
  const env = await setup();
  const imap = new FakeImap();
  env.deps.net = { resolve: async () => [{ address: PUBLIC, family: 4 }], tls: imap.connector };
  const { asha, rahul } = await withPeople(env);
  await net(env, 'venture.network.import', { kind: 'contacts-csv', name: 'contacts.csv', text: CONTACTS });
  const people = listRecords(env.store.read(), 'venture-person');
  const priya = people.find(person => person.name === 'Priya Nair')!;
  return { ...env, imap, asha: people.find(person => person.id === asha.id) ?? people.find(person => person.name === 'Asha Rao')!, rahul, priya };
}

export const connect = (env: MailEnv, payload: Record<string, unknown> = {}) => mailCall<MailboxView>(env, 'venture.mailbox.connect', { ...MAILBOX, ...payload });
export const sync = (env: MailEnv, ctx: Context = owner) => mailCall<MailboxSync>(env, 'venture.mailbox.sync', {}, ctx);
export const inbound = (env: Env): InboundRecord[] => listRecords(env.store.read(), 'venture-inbound');

/**
 * Puts a person on the pipeline and records the first note the owner sent them, as 4E2's "I sent it" does: a drafted
 * email with its subject (and, given one, the footer it carried), marked sent, and the send on the card.
 */
export async function sentTo(env: Env, person: PersonRecord, input: { subject: string; on: string; at?: string; channel?: 'email' | 'whatsapp'; unsubscribe?: string }): Promise<OpportunityRecord> {
  const { card } = await add(env, person);
  return ventureAction(env.deps, owner, 'approve', 'test.sent', tx => {
    const channel = input.channel ?? 'email';
    const draft = tx.put<OutreachRecord>({
      ...tx.base('venture-outreach'), opportunityId: card.id, invoiceId: null, personId: person.id, outreachKind: 'cold-email', channel, to: person.handles.emails[0] ?? null,
      subject: input.subject, text: 'Hello, a short note about gift boxes.', blurb: null,
      footer: input.unsubscribe ? { unsubscribe: input.unsubscribe, postalAddress: '12 MG Road, Pune' } : null, sourceUrl: null, basis: null, lints: [], by: 'owner', callId: null,
      digest: 'e'.repeat(64), sent: { at: input.at ?? `${input.on}T05:00:00.000Z`, channel: channel === 'email' ? 'own-mailbox' : 'whatsapp', recordedAt: tx.now, recordedBy: owner.memberId }, acceptedOn: null,
    });
    return recordCardSend(tx, card.id, { on: input.on, channel: channel === 'email' ? 'own-mailbox' : 'whatsapp', outreachKind: 'cold-email', ref: draft.id, by: owner.memberId });
  });
}
