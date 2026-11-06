// Chausar venture launcher, policy (Ink v2 wave 1, H11): Chausar judges effects, not the tool.
// What an action can touch is worked out by code: from Chausar's own tool declarations, the connector catalogue and
// the action itself (the words of its name, its argument values, its web method). A label a tool or a model claims is
// never read. An action nothing classifies counts as destructive: it may touch everything. A web method that changes
// something is never a read, and neither is an argument that notifies a customer, archives a record or issues for
// real. Each of Chausar's own tools declares its effects from the fixed list and the integrity of what it returns.
// The rules follow OpenTag agent/composio_tools/classify.py and marketplaces-mcp-ru core/safety.py; this is a rewrite,
// not a copy.
import { CONNECTOR_CATALOGUE } from '../build/catalogue.ts';
import type { ConnectorCategory, ResultIntegrity, ToolEffect, ToolName } from '../contracts.ts';
import type { UntrustedSource } from './untrusted.ts';

/**
 * read: looks at the run's own files, tables or the business dictionary. private-read: reads beyond this order (other
 * clients, the books, mail, secrets, a connected account). write: changes a record, a file or a connected service.
 * send: reaches a client, a contact or the public. egress: takes data off this computer or to another program.
 * money: moves money or asks for it.
 */
export const EFFECT_KINDS = ['read', 'private-read', 'write', 'send', 'egress', 'money'] as const;
export type EffectKind = typeof EFFECT_KINDS[number];
/** Effects that change something in a way that cannot simply be taken back. */
export const DESTRUCTIVE_EFFECTS: readonly EffectKind[] = Object.freeze(['write', 'send', 'money']);
/** Web methods that change something. Any method other than GET, HEAD or OPTIONS counts the same. */
export const MUTATING_HTTP = Object.freeze(['POST', 'PUT', 'PATCH', 'DELETE'] as const);
const SAFE_HTTP: readonly string[] = ['GET', 'HEAD', 'OPTIONS'];
/** What an unclassified action may touch: everything. */
const UNCLASSIFIED: readonly EffectKind[] = ['private-read', 'write', 'send', 'egress', 'money'];

/**
 * A tool's declaration: its effects, and the label on what it returns. source: where an untrusted result's content
 * comes from. refine: effects its input adds (a payment link moves money); it never takes one away.
 */
export type ToolDeclaration = {
  effects: readonly EffectKind[];
  integrity: ResultIntegrity;
  source: UntrustedSource | null;
  refine?: (input: Readonly<Record<string, unknown>>) => readonly EffectKind[];
};

const OF_FILES = { integrity: 'untrusted', source: 'client-file' } as const;
const OWN = { integrity: 'trusted', source: null } as const;
/**
 * Chausar's own agent tools. Everything that echoes the order's files is untrusted (column names and row words come
 * from the client). A hand-off asks a person inside Chausar; the owner relays it, so nothing leaves. agent.delegate
 * answers with Chausar's own note: the heavy-work output is labelled when it comes back (delivery/harness/loop.ts).
 */
export const TOOL_DECLARATIONS: Readonly<Record<ToolName, ToolDeclaration>> = Object.freeze({
  'files.list': { effects: ['read'], ...OF_FILES },
  'files.read': { effects: ['read'], ...OF_FILES },
  'dictionary.browse': { effects: ['read'], ...OWN },
  'dictionary.resolve': { effects: ['read'], ...OWN },
  'calc.sum': { effects: ['read'], ...OF_FILES },
  'calc.totals': { effects: ['read'], ...OF_FILES },
  'books.reconcile': { effects: ['read'], ...OF_FILES },
  'bills.pick': { effects: ['read'], ...OF_FILES },
  'sandbox.transform': { effects: ['read'], ...OF_FILES },
  'sandbox.python': { effects: ['read'], ...OF_FILES },
  'handoff.client': { effects: ['read'], ...OWN },
  'handoff.owner': { effects: ['read'], ...OWN },
  'outbox.propose': { effects: ['send'], ...OWN, refine: input => input.connector === 'payment-link' ? ['money'] : [] },
  'agent.delegate': { effects: ['write', 'egress'], ...OWN },
});

/** A Chausar tool's declaration, or null for a name Chausar does not ship. */
export function toolDeclaration(name: string): ToolDeclaration | null {
  return Object.hasOwn(TOOL_DECLARATIONS, name) ? TOOL_DECLARATIONS[name as ToolName] : null;
}

/** Chausar's coarse tool effects, as effect kinds. Set by Chausar's code, never by a model. */
const COARSE: Readonly<Record<ToolEffect, readonly EffectKind[]>> = Object.freeze({
  read: ['read'], compute: ['read'], sandbox: ['read'], handoff: ['read'], 'outside-write': ['write', 'send'], delegate: ['write', 'egress'],
});

/** What writing to a connector of each catalogue category can touch. */
const CATEGORY: Readonly<Record<ConnectorCategory, readonly EffectKind[]>> = Object.freeze({
  build: ['write'], 'site-domain': ['write', 'money'], payments: ['write', 'money'], email: ['write', 'send'], booking: ['write', 'send'],
  customers: ['write'], messaging: ['write', 'send'], 'docs-ops': ['write'], marketing: ['write', 'send'], 'books-tax': ['write'],
  'legal-entity': ['write', 'send'], analytics: ['write'],
});

/** Whole words of a name: split at . - _ : / and spaces, and between a lower-case letter and a capital. */
export function nameWords(name: string): string[] {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1.$2').toLowerCase().split(/[.\-_:/\s]+/).filter(Boolean);
}

/**
 * The one list of words that make an action destructive. The always-ask floor (policy/floor.ts) reads its send, money
 * going out and delete kinds from here too, so the two never drift apart. An invoice or a wallet asks for money or
 * holds it; it does not move it, so those words are money in effects but not money going out on the floor.
 */
export const DESTRUCTIVE_WORDS = Object.freeze({
  send: Object.freeze(['send', 'post', 'posts', 'publish', 'email', 'mail', 'share', 'reply', 'message', 'messages', 'dm', 'tweet', 'notify', 'invite', 'broadcast', 'forward', 'sms', 'whatsapp', 'comment']),
  moneyOut: Object.freeze(['pay', 'payment', 'payments', 'payout', 'payouts', 'refund', 'refunds', 'transfer', 'transfers', 'purchase', 'buy', 'withdraw', 'charge', 'charges', 'capture', 'checkout', 'remit', 'disburse']),
  delete: Object.freeze(['delete', 'remove', 'erase', 'purge', 'drop', 'destroy', 'archive', 'archived', 'trash']),
});
const wordSet = (...lists: readonly (readonly string[])[]) => new Set(lists.flat());
const WORDS: readonly [EffectKind, ReadonlySet<string>][] = [
  ['money', wordSet(DESTRUCTIVE_WORDS.moneyOut, ['invoice', 'invoices', 'wallet'])],
  ['send', wordSet(DESTRUCTIVE_WORDS.send)],
  ['write', wordSet(DESTRUCTIVE_WORDS.delete, ['create', 'update', 'edit', 'set', 'add', 'change', 'write', 'save', 'upload', 'apply', 'put', 'patch', 'insert', 'move', 'rename', 'cancel', 'schedule', 'issue', 'finalize', 'finalise', 'approve', 'merge', 'deploy', 'push', 'commit', 'sync', 'import', 'submit', 'sign', 'register', 'book', 'reserve', 'enable', 'disable', 'grant', 'revoke', 'rotate', 'reset', 'loosen', 'modify', 'replace'])],
  ['egress', wordSet(['fetch', 'download', 'export', 'webhook', 'request', 'http', 'https', 'url', 'browse', 'browser', 'open', 'upload', 'delegate', 'crawl', 'scrape'])],
  ['private-read', wordSet(['credential', 'credentials', 'password', 'passwords', 'secret', 'secrets', 'token', 'tokens', 'cookie', 'cookies', 'session', 'sessions', 'keychain', 'inbox', 'contacts', 'ledger', 'apikey', 'apikeys'])],
  ['read', wordSet(['get', 'list', 'read', 'search', 'find', 'view', 'show', 'lookup', 'query', 'count', 'describe', 'preview', 'check', 'inspect', 'status'])],
];

/** Argument names, compared in lower case without separators: notifyCustomer, notify_customer and NOTIFY-CUSTOMER match. */
const keyOf = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, '');
const NOTIFY_KEY = /^(?:notify(?:customers?|clients?|users?|buyers?|recipients?|payers?|contacts?)?|send(?:emails?|notifications?|invoices?|receipts?|sms|messages?|mail)|email(?:customers?|clients?|users?|receipts?))$/;
const ARCHIVE_KEY = /^(?:archive|archived|trash|delete|purge)$/;
const ISSUE_KEY = /^(?:issue|issued|issueforreal|finali[sz]e|finali[sz]ed|final)$/;
const ISSUED_STATUS = /^(issued|final|finali[sz]ed|sent)$/i;
/** A repeat rule: a recurrence or cron argument, or an iCalendar RRULE anywhere in a value. */
const REPEAT_KEY = /^(?:rrule|recurrence|recurring|repeat|repeats|cron|crontab|frequency)$/;
const RRULE = /\bRRULE:|\bFREQ=(?:SECONDLY|MINUTELY|HOURLY|DAILY|WEEKLY|MONTHLY|YEARLY)\b/i;
/** Where money is paid to: an account number, an IFSC, an IBAN, a UPI id, a beneficiary or payee. */
const PAYMENT_DETAIL_KEY = /^(?:accountnumber|accountno|acno|bankaccount|bankaccountnumber|ifsc|ifsccode|iban|swift|swiftcode|upi|upiid|vpa|beneficiary|beneficiaryaccount|payee|payoutaccount|fundaccount)$/;
const MAX_DEPTH = 16;

/** true, or the text "true" in any case. */
const yes = (value: unknown) => value === true || (typeof value === 'string' && value.trim().toLowerCase() === 'true');
/** Any member, at any depth, that says yes. */
function anyYes(value: unknown, depth = 0): boolean {
  if (yes(value)) return true;
  if (value === null || typeof value !== 'object') return false;
  if (depth > MAX_DEPTH) return true;
  return Object.values(value).some(entry => anyYes(entry, depth + 1));
}
/** A value that says something: not empty, false or null. */
const given = (value: unknown) => value !== null && value !== undefined && value !== false && value !== '' && !(typeof value === 'string' && value.trim().toLowerCase() === 'false');

export type ArgumentFlags = { notify: boolean; archive: boolean; issue: boolean; recurring: boolean; paymentDetails: boolean };

/**
 * Argument values that change what an action does, anywhere in its input: notifying someone (a notify argument that
 * says yes, or a notify object with any member that does), archiving or deleting, issuing for real, a repeat rule, and
 * payment details. Input nested deeper than Chausar ever sends counts as all of them.
 */
export function argumentFlags(input: unknown): ArgumentFlags {
  const flags: ArgumentFlags = { notify: false, archive: false, issue: false, recurring: false, paymentDetails: false };
  const walk = (value: unknown, depth: number): void => {
    if (typeof value === 'string') { if (RRULE.test(value)) flags.recurring = true; return; }
    if (value === null || typeof value !== 'object') return;
    if (depth > MAX_DEPTH) { flags.notify = flags.archive = flags.issue = flags.recurring = flags.paymentDetails = true; return; }
    if (Array.isArray(value)) { for (const entry of value) walk(entry, depth + 1); return; }
    for (const [name, entry] of Object.entries(value)) {
      const key = keyOf(name);
      if (NOTIFY_KEY.test(key) && anyYes(entry)) flags.notify = true;
      if (ARCHIVE_KEY.test(key) && yes(entry)) flags.archive = true;
      if (ISSUE_KEY.test(key) && yes(entry)) flags.issue = true;
      if (key === 'status' && typeof entry === 'string' && ISSUED_STATUS.test(entry.trim())) flags.issue = true;
      if (REPEAT_KEY.test(key) && given(entry)) flags.recurring = true;
      if (PAYMENT_DETAIL_KEY.test(key) && given(entry)) flags.paymentDetails = true;
      walk(entry, depth + 1);
    }
  };
  walk(input, 0);
  return flags;
}

/** True for any web method other than GET, HEAD or OPTIONS. */
export function mutatingHttp(method: string | null | undefined): boolean {
  return typeof method === 'string' && method.trim().length > 0 && !SAFE_HTTP.includes(method.trim().toUpperCase());
}

/** What is known about an action. claimed: the label a tool or a model gave it, kept only to show it is ignored. */
export type EffectFacts = {
  name: string;
  effect?: ToolEffect | null;
  input?: Readonly<Record<string, unknown>> | null;
  connector?: string | null;
  http?: string | null;
  claimed?: readonly string[] | null;
};
export type EffectClass = { effects: EffectKind[]; destructive: boolean; unclassified: boolean };

/**
 * The effects of one action, in EFFECT_KINDS order. A Chausar tool: its declaration plus what its input adds. Anything
 * else: Chausar's coarse effect, the words of its name and, for a connector, what its catalogue category can touch
 * (a connector read is a private read). For every action: argument values and the web method. Nothing found means
 * unclassified, which counts as everything. read is kept only when nothing else was found.
 */
export function classifyEffects(facts: EffectFacts): EffectClass {
  const found = new Set<EffectKind>();
  const declared = toolDeclaration(facts.name);
  if (declared) {
    for (const kind of declared.effects) found.add(kind);
    if (declared.refine && facts.input) for (const kind of declared.refine(facts.input)) found.add(kind);
  } else {
    if (facts.effect) for (const kind of COARSE[facts.effect] ?? UNCLASSIFIED) found.add(kind);
    const named = new Set<EffectKind>();
    for (const word of nameWords(facts.name)) for (const [kind, words] of WORDS) if (words.has(word)) named.add(kind);
    for (const kind of named) found.add(kind);
    const entry = facts.connector ? CONNECTOR_CATALOGUE.find(item => item.id === facts.connector) : undefined;
    if (entry) {
      found.add('egress');
      const changes = [...named].some(kind => kind !== 'read' && kind !== 'private-read' && kind !== 'egress');
      if (named.has('read') && !changes) found.add('private-read');
      else for (const kind of CATEGORY[entry.category]) found.add(kind);
    }
  }
  const flags = argumentFlags(facts.input);
  if (flags.notify) found.add('send');
  if (flags.archive || flags.issue || flags.recurring || flags.paymentDetails) found.add('write');
  if (mutatingHttp(facts.http)) found.add('write');
  const unclassified = found.size === 0;
  if (unclassified) for (const kind of UNCLASSIFIED) found.add(kind);
  if (found.size > 1) found.delete('read');
  const effects = EFFECT_KINDS.filter(kind => found.has(kind));
  return { effects, destructive: effects.some(kind => DESTRUCTIVE_EFFECTS.includes(kind)), unclassified };
}

/** Whether a tool call says what it does: a Chausar declaration, or a coarse effect from Chausar's own code. */
export function declaresEffects(action: { name: string; effect?: ToolEffect | null }): boolean {
  return toolDeclaration(action.name) !== null || (typeof action.effect === 'string' && Object.hasOwn(COARSE, action.effect));
}
