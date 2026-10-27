// Chausar connectors: mail in (Ink v2 wave 5, package 5A6). No second mailbox reader is built: playbooks read the
// owner's read-only mailbox through 4E3 (network/mailbox.ts, venture.mailbox.*, labelled read), and an owner without
// one forwards the mails or exports them as .eml or .mbox files and imports them here (venture.mail.import, approve,
// inside the app). Imported messages land in 4E3's own records (venture-inbound) marked source 'file-import', so a
// desk sees one inbox whichever way a message came. Each message is screened before anything is kept (1E): Message-ID,
// In-Reply-To, References, From, To, Date and Subject are parsed in code; its new words are kept only as the screen
// left them (null when it held them), at most 4,000 characters; each attachment is screened on its own and kept only
// when Chausar can read its kind (PDF, CSV, XLSX, a transcript) and it fits an upload. Bulk mail is skipped and a
// message already kept is not kept twice. A file over 25 MB is refused with its size. Imported mail makes no pipeline
// row (it is processed); an opt-out in it still blocks its sender's address at once, as 4E3 does.
// routeInbound hands a message to the playbook desk whose client it matches: threads are joined in code by
// Message-ID, In-Reply-To and References across both sources, and a thread's client is the client whose address wrote
// in it. Forget (network/forget.ts) deletes an imported message like any other inbound mail, its words and files too.
// Written for Chausar; the mbox reading follows the mboxrd convention (">From " lines), nothing copied.
import { createHash } from 'node:crypto';
import { check, ChausarError, type Context, type State } from '../../contracts.ts';
import type { InboundRecord, UploadFormat, VentureDeps, VentureRecord } from '../contracts.ts';
import { currentVenture, exactPayload, identifier, listRecords, readVenture, requireAppChannel, singleLine, ventureAction } from '../records.ts';
import { addressesOf, contentTypeOf, decodeTransfer, freshText, headerOf, messageIdsOf, mimeParts, readableText, readHeaders, type MailHeaders, type MimePart } from '../network/mail-text.ts';
import { isBulk, mailboxOf } from '../network/mailbox.ts';
import { HELD_SUBJECT, triageMail } from '../network/inbound.ts';
import { screenNote, screenUntrusted } from '../policy/untrusted.ts';
import { blockEntries } from '../customers/lead-methods.ts';
import { MAX_UPLOAD_BYTES, sniffFormat } from '../delivery/harness/files.ts';
import { currentPlaybook } from '../delivery/playbook.ts';
import { pickPlaybook } from '../playbooks/registry.ts';
import type { MailAttachment, MailDesk, MailImportView, MailThreadsView, MailThreadView } from './records-connect.ts';

/** The biggest mail file Chausar imports, and the most messages, words and attachments it keeps of one. */
export const MAX_MAIL_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_MESSAGES = 2000;
export const MAX_TEXT_CHARS = 4000;
export const MAX_ATTACHMENTS = 10;

export const MAIL_WORDS = Object.freeze({
  manualPath: 'Forward the mails, or export them as .eml files',
  notMail: 'Import a mail file: one message as .eml, or many as .mbox.',
  empty: 'This file has no mail Chausar can read.',
  notConnected: 'Your mailbox is not connected. Chausar reads only the mail files you import.',
});

/**
 * The playbook desks mail goes to, and the kind of record each makes of a thread: the support desk's tickets (5G), the
 * recruiting desk's resumes (5H) and the virtual assistant's inbox (5R1). A playbook not listed has no mail desk.
 */
export const MAIL_DESKS: Readonly<Record<string, string>> = Object.freeze({ 'support-desk': 'ticket', 'recruiting-desk': 'resume', 'virtual-assistant': 'inbox' });

const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const megabytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

// ---------------------------------------------------------------------------
// Reading a file
// ---------------------------------------------------------------------------

/** The messages of an .mbox (split on its "From " lines, ">From " lines read back) or the one message of an .eml. */
export function splitMailFile(name: string, text: string): string[] {
  if (name.toLowerCase().endsWith('.eml')) return [text];
  const out: string[] = [];
  let current: string[] | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (/^From \S/.test(line)) { if (current) out.push(current.join('\r\n')); current = []; continue; }
    if (current) current.push(line.replace(/^>(>*From )/, '$1'));
  }
  if (current) out.push(current.join('\r\n'));
  return out.filter(item => item.trim());
}

type Parsed = {
  messageId: string; from: string; to: string[]; date: string; subject: string; references: string[]; headers: MailHeaders; text: string;
  parts: MimePart[];
};

/** One message's headers and parts, or null when it has no From line (not mail). */
function parseMessage(raw: string, nowIso: string): Parsed | null {
  const split = /\r?\n\r?\n/.exec(raw);
  const head = split ? raw.slice(0, split.index) : raw;
  const body = split ? raw.slice(split.index + split[0].length) : '';
  const headers = readHeaders(head);
  const from = addressesOf(headerOf(headers, 'from'))[0];
  if (!from) return null;
  const type = contentTypeOf(headerOf(headers, 'content-type'));
  const parts = mimeParts(type, headerOf(headers, 'content-transfer-encoding'), Buffer.from(body, 'latin1'));
  const stated = Date.parse(headerOf(headers, 'date') ?? '');
  // A date in the future cannot run ahead of now, as 4E3 reads it.
  const date = new Date(Number.isFinite(stated) ? Math.min(stated, Date.parse(nowIso)) : Date.parse(nowIso)).toISOString();
  const to = [...addressesOf(headerOf(headers, 'to')), ...addressesOf(headerOf(headers, 'cc'))].map(item => item.email);
  return {
    messageId: messageIdsOf(headerOf(headers, 'message-id'), 1)[0] ?? `<import.${sha(raw).slice(0, 24)}@chausar>`,
    from: from.email, to: [...new Set(to)], date, subject: (headerOf(headers, 'subject') ?? '').replace(/\s+/g, ' ').trim(),
    references: messageIdsOf(`${headerOf(headers, 'references') ?? ''} ${headerOf(headers, 'in-reply-to') ?? ''}`).slice(-20),
    headers, text: freshText(readableText(parts)).slice(0, MAX_TEXT_CHARS), parts,
  };
}

/** A part's file name, from its disposition or its type, or null when it is not an attachment. */
function fileNameOf(part: MimePart): string | null {
  const disposition = headerOf(part.headers, 'content-disposition') ?? '';
  const named = /filename\*?="?([^";]+)"?/i.exec(disposition)?.[1] ?? part.params.name ?? null;
  if (!named && !/^attachment/i.test(disposition)) return null;
  return (named ?? 'attachment').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200) || 'attachment';
}

/** The sender's file name for the owner, screened: null when the screen held it. */
function screenedName(name: string): string | null {
  const result = screenUntrusted({ source: 'mail', text: name }, { mode: 'enforce' });
  return result.status === 'quarantined' || !result.text ? null : result.text.slice(0, 120);
}

/** A message's attachments, each screened on its own; bytes kept only for a kind Chausar reads, within an upload's size. */
function attachmentsOf(parts: MimePart[]): MailAttachment[] {
  const out: MailAttachment[] = [];
  for (const part of parts) {
    const name = fileNameOf(part);
    if (!name || out.length >= MAX_ATTACHMENTS) continue;
    const bytes = part.body;
    const ext = /\.([a-z0-9]{1,5})$/i.exec(name)?.[1]?.toLowerCase() ?? null;
    const id = `att_${sha(bytes).slice(0, 16)}_${out.length + 1}`;
    const clientName = screenedName(name);
    const base = { id, name: `attachment-${out.length + 1}${ext ? `.${ext}` : ''}`, clientName, bytes: bytes.length, digest: sha(bytes) };
    let format: UploadFormat | null = null;
    try { format = sniffFormat(name, bytes); } catch { format = null; }
    if (!format || format === 'image') {
      out.push({ ...base, format: null, contentBase64: null, line: `${clientName ?? 'This file'} is not kept: Chausar reads PDF, CSV, XLSX and transcript files. Open it in your mail app.` });
      continue;
    }
    if (bytes.length > MAX_UPLOAD_BYTES) {
      out.push({ ...base, format, contentBase64: null, line: `${clientName ?? 'This file'} is ${megabytes(bytes.length)}, too big to keep here. Add it to the order yourself.` });
      continue;
    }
    // A text file's words pass the screen now; a PDF or workbook is screened again when it is read.
    if (format === 'csv' || format === 'transcript') {
      const screened = screenUntrusted({ source: 'mail', text: bytes.toString('utf8').slice(0, 200_000) }, { mode: 'enforce' });
      if (screened.status === 'quarantined') { out.push({ ...base, format, contentBase64: null, line: 'Held by the screen: it had words aimed at an agent. Nothing of it is kept.' }); continue; }
    }
    out.push({ ...base, format, contentBase64: bytes.toString('base64'), line: 'Kept with the message, screened again when it is read.' });
  }
  return out;
}

/**
 * venture.mail.import { name, contentBase64 } (approve, inside the app): an .eml or .mbox into venture-inbound. Answers
 * how many were added, already kept, skipped (bulk mail, or not mail) and held, and how many threads they make.
 */
export async function mailImport(deps: VentureDeps, ctx: Context, payload: unknown): Promise<MailImportView> {
  requireAppChannel(ctx, 'venture.mail.import');
  const body = exactPayload(payload, ['name', 'contentBase64'], ['name', 'contentBase64']);
  const name = singleLine(body.name, 'The file name', { max: 200 });
  check(/\.(eml|mbox)$/i.test(name), 'MAIL_FILE_UNREADABLE', MAIL_WORDS.notMail);
  const encoded = body.contentBase64;
  check(typeof encoded === 'string' && /^[A-Za-z0-9+/\r\n]*={0,2}\s*$/.test(encoded.slice(-64)), 'INVALID_VENTURE_REQUEST', 'Send the file\'s bytes.');
  const size = Math.floor((encoded.replace(/\s/g, '').length * 3) / 4) - (encoded.trimEnd().endsWith('==') ? 2 : encoded.trimEnd().endsWith('=') ? 1 : 0);
  if (size > MAX_MAIL_FILE_BYTES) throw new ChausarError('MAIL_FILE_TOO_LARGE', `This file is ${megabytes(size)}. Chausar imports mail files of up to 25 MB.`);
  const bytes = Buffer.from(encoded, 'base64');
  const now = deps.clock().toISOString();
  const parsed: Parsed[] = [];
  let skipped = 0;
  for (const raw of splitMailFile(name, bytes.toString('utf8')).slice(0, MAX_MESSAGES)) {
    const message = parseMessage(raw, now);
    if (!message || isBulk(message.headers)) { skipped += 1; continue; }
    parsed.push(message);
  }
  check(parsed.length > 0, 'MAIL_FILE_UNREADABLE', MAIL_WORDS.empty);
  const importId = `mailimport_${sha(bytes).slice(0, 16)}`;
  return ventureAction(deps, ctx, 'approve', 'mail.import', tx => {
    const venture = tx.venture!;
    const kept = new Set(tx.list('venture-inbound').map(record => record.messageId));
    let added = 0, repeats = 0, held = 0;
    const ids: string[] = [];
    for (const message of parsed) {
      if (kept.has(message.messageId)) { repeats += 1; continue; }
      kept.add(message.messageId);
      const whole = screenUntrusted({ source: 'mail', text: `${message.subject}\n${message.text}` }, { mode: 'enforce' });
      const words = screenUntrusted({ source: 'mail', text: message.text }, { mode: 'enforce' });
      const title = screenUntrusted({ source: 'mail', text: message.subject }, { mode: 'enforce' });
      const text = whole.status === 'quarantined' || words.status === 'quarantined' ? null : words.text;
      if (text === null && message.text) held += 1;
      const triage = triageMail({ headers: message.headers, subject: message.subject, text: message.text, report: false });
      let line = `Imported from ${name}.`;
      if (triage.triage === 'opt-out') {
        blockEntries(tx, [message.from], 'chausar');
        line = `Imported from ${name}. They asked not to be contacted, so ${message.from} is on your blocklist now.`;
      }
      const record = tx.put<InboundRecord>({
        ...tx.base('venture-inbound'), messageId: message.messageId, from: message.from, to: message.to, date: message.date,
        subject: ((title.status === 'quarantined' ? null : title.text) ?? HELD_SUBJECT).replace(/\s+/g, ' ').trim().slice(0, 300) || '(no subject)',
        references: message.references, matched: null, triage: triage.triage === 'bulk' ? 'unmatched' : triage.triage, line, processed: true,
        screen: screenNote(whole), source: 'file-import', text, attachments: attachmentsOf(message.parts), importId,
        ...(triage.hindi ? { hindi: true } : {}),
      });
      ids.push(record.id);
      added += 1;
    }
    const threads = new Set(ids.map(id => threadIdOf(tx.state, venture, id)));
    const words = [`${added} ${added === 1 ? 'message' : 'messages'} imported from ${name}`, repeats ? `${repeats} already kept` : '', skipped ? `${skipped} skipped` : '',
      held ? `${held} held by the screen` : ''].filter(Boolean).join(', ');
    return { added, repeats, skipped, held, threads: threads.size, line: `${words}.` };
  });
}

// ---------------------------------------------------------------------------
// Threads and routing
// ---------------------------------------------------------------------------

/** Threads of the business's inbound mail, joined in code by the message ids each message names: record id to thread id. */
function threadMap(state: State, venture: VentureRecord): { records: InboundRecord[]; threadOf: Map<string, string> } {
  const records = listRecords(state, 'venture-inbound', venture.id) as InboundRecord[];
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    let root = key;
    while (parent.has(root) && parent.get(root) !== root) root = parent.get(root)!;
    parent.set(key, root);
    return root;
  };
  const join = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  for (const record of records) {
    find(record.messageId);
    for (const ref of record.references ?? []) join(record.messageId, ref);
  }
  const earliest = new Map<string, InboundRecord>();
  for (const record of records) {
    const root = find(record.messageId);
    const first = earliest.get(root);
    if (!first || record.date < first.date || (record.date === first.date && record.id < first.id)) earliest.set(root, record);
  }
  const threadOf = new Map<string, string>();
  for (const record of records) threadOf.set(record.id, `thread_${sha(earliest.get(find(record.messageId))!.messageId).slice(0, 16)}`);
  return { records, threadOf };
}

/**
 * DPDP Forget (network/forget.ts): the imported messages that go with a forgotten person. Imported mail keeps words and
 * files, so every imported message of a thread where any message (from either source) was from them, to them or copied
 * to them goes, as does an imported message whose words name them. Answers record ids.
 */
export function importedMailOf(state: State, venture: VentureRecord, emails: ReadonlySet<string>, names: (text: unknown) => boolean): Set<string> {
  const { records, threadOf } = threadMap(state, venture);
  const lower = new Set([...emails].map(email => email.trim().toLowerCase()));
  const touches = (record: InboundRecord) => lower.has(record.from.toLowerCase()) || record.to.some(address => lower.has(address.toLowerCase()))
    || (record.source === 'file-import' && (names(record.text) || names(record.subject)));
  const threads = new Set(records.filter(touches).map(record => threadOf.get(record.id)!));
  return new Set(records.filter(record => record.source === 'file-import' && threads.has(threadOf.get(record.id)!)).map(record => record.id));
}

/** The thread one inbound message belongs to. */
export function threadIdOf(state: State, venture: VentureRecord, inboundId: string): string {
  const id = threadMap(state, venture).threadOf.get(inboundId);
  check(id, 'INVALID_VENTURE_REQUEST', 'This mail is not in this business.');
  return id;
}

/** The business's playbook, as the desks know it: the playbook in use, else the one its idea picks. */
export function businessPlaybookId(state: State, venture: VentureRecord): string | null {
  return currentPlaybook(state, venture)?.flagship ?? pickPlaybook(venture.idea)?.id ?? null;
}

/** The client whose address wrote in a thread, by the messages' senders (the owner's own replies match none). */
function clientOfThread(state: State, venture: VentureRecord, messages: readonly InboundRecord[]): string | null {
  const clients = listRecords(state, 'venture-client', venture.id).filter(client => client.email);
  const senders = new Set(messages.map(message => message.from.toLowerCase()));
  return clients.find(client => senders.has(client.email!.trim().toLowerCase()))?.id ?? null;
}

/** Where one message goes: its thread, the client it matches, and the playbook desk that takes it (null when none). */
export type InboundRoute = { inboundId: string; threadId: string; clientId: string | null; desk: MailDesk | null };

/**
 * Hands one inbound message, from the mailbox or a file, to a playbook desk: its thread (shared with every message it
 * names or that names it), the client whose address wrote in that thread, and the desk of the playbook given (else the
 * business's own) that takes mail. A desk calls it for its own playbook. Reads only.
 */
export function routeInbound(state: State, inboundId: string, playbook?: string): InboundRoute {
  const venture = currentVenture(state);
  check(venture, 'VENTURE_NOT_FOUND', 'Start a business first.');
  const { records, threadOf } = threadMap(state, venture);
  const threadId = threadOf.get(inboundId);
  check(threadId, 'INVALID_VENTURE_REQUEST', 'This mail is not in this business.');
  const messages = records.filter(record => threadOf.get(record.id) === threadId);
  const id = playbook ?? businessPlaybookId(state, venture);
  const kind = id ? MAIL_DESKS[id] : undefined;
  return { inboundId, threadId, clientId: clientOfThread(state, venture, messages), desk: id && kind ? { playbook: id, kind } : null };
}

/** The business's threads, newest first, each with its client and desk. */
export function mailThreadsOf(state: State, venture: VentureRecord): MailThreadView[] {
  const { records, threadOf } = threadMap(state, venture);
  const playbook = businessPlaybookId(state, venture);
  const kind = playbook ? MAIL_DESKS[playbook] : undefined;
  const groups = new Map<string, InboundRecord[]>();
  for (const record of records) groups.set(threadOf.get(record.id)!, [...(groups.get(threadOf.get(record.id)!) ?? []), record]);
  const out: MailThreadView[] = [];
  for (const [id, messages] of groups) {
    const ordered = [...messages].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    const lastMessage = ordered.at(-1)!;
    const sources = [...new Set(ordered.map(message => (message.source === 'file-import' ? 'file-import' as const : 'mailbox' as const)))];
    out.push({
      id, subject: ordered[0].subject, from: lastMessage.from, count: ordered.length, lastAt: lastMessage.date,
      sources: (['mailbox', 'file-import'] as const).filter(source => sources.includes(source)), clientId: clientOfThread(state, venture, ordered),
      desk: playbook && kind ? { playbook, kind } : null, held: ordered.some(message => !!message.screen && message.screen.status === 'quarantined'),
    });
  }
  return out.sort((a, b) => b.lastAt.localeCompare(a.lastAt) || a.id.localeCompare(b.id));
}

/** venture.mail.threads { clientId? } (read): the threads from both sources, and the mailbox's state with the manual path. */
export async function mailThreads(deps: VentureDeps, ctx: Context, payload: unknown): Promise<MailThreadsView> {
  const body = exactPayload(payload ?? {}, ['clientId']);
  const clientId = body.clientId === undefined ? null : identifier(body.clientId, 'Client');
  const { state, venture } = readVenture(deps, ctx);
  const threads = mailThreadsOf(state, venture).filter(thread => clientId === null || thread.clientId === clientId);
  const mailbox = mailboxOf(state, venture.id);
  const connected = mailbox?.status === 'connected';
  return {
    threads,
    mailbox: {
      connected, label: 'read', manualPath: MAIL_WORDS.manualPath,
      line: connected ? `Reading ${mailbox!.user} on ${mailbox!.host}, read-only.` : MAIL_WORDS.notConnected,
    },
  };
}

/** The words of one thread for the mail.read tool, oldest first: imported messages' screened words, the mailbox's who and when only. */
export function threadForAgent(state: State, venture: VentureRecord, threadId: string): { subject: string; messages: { from: string; date: string; subject: string; text: string; attachments: { id: string; name: string; format: string | null; bytes: number }[] }[] } | null {
  const { records, threadOf } = threadMap(state, venture);
  const messages = records.filter(record => threadOf.get(record.id) === threadId).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  if (!messages.length) return null;
  return {
    subject: messages[0].subject,
    messages: messages.map(message => ({
      from: message.from, date: message.date, subject: message.subject,
      text: message.source !== 'file-import' ? 'Chausar keeps only who and when for mail from your mailbox; its words stay there.'
        : message.text ?? 'The screen held these words, so nothing of them is read.',
      attachments: (message.attachments ?? []).map(item => ({ id: item.id, name: item.name, format: item.contentBase64 ? item.format : null, bytes: item.bytes })),
    })),
  };
}

/** Decodes a stored attachment to text for a reader, when it is a text kind. */
export function attachmentText(attachment: MailAttachment): string | null {
  if (!attachment.contentBase64 || (attachment.format !== 'csv' && attachment.format !== 'transcript')) return null;
  return decodeTransfer(Buffer.from(attachment.contentBase64, 'base64'), null).toString('utf8').slice(0, 20_000);
}
