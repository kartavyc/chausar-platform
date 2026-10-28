// Chausar venture launcher, journal (Ink v2 wave 4, package 4J10; catalogue H28): the extras a journalled action may
// carry. A kind may declare a cleanup that runs, in the same commit, when the owner rejects one (a website edit's
// staged copy is removed). An action may say which keys it provides and which it depends on: it waits until every one
// it depends on has applied, and when one of those is rejected it is rejected too, with the actions that depended on
// it. An approved action is fenced to the account it was approved for (ACCOUNT_FENCE). And actions that would go on
// working after the session (minting a key or token, a webhook that keeps delivering, a bulk call that hides what it
// wraps) are refused before they are recorded (ACTION_DENYLISTED).
// The reject cleanup, the dependencies and the account fence follow cloudflare/cloudflare-os (Apache-2.0,
// packages/gatekeeper-kit/src/actions.ts) and shopify-multi-store (docs/ACTIONS.md), as the catalogue row H28 names
// them; this is a rewrite in TypeScript, not a copy.
import { check, ChausarError } from '../../contracts.ts';
import type { JournalActionId, JournalRecord, SiteEditRecord } from '../contracts.ts';
import type { VentureTx } from '../records.ts';
import { stepTo, type Journalled } from './journal.ts';

// ---------------------------------------------------------------------------
// The denylist
// ---------------------------------------------------------------------------

/** What a proposal that would outlive the session is told. */
export const ACTION_DENY_LINE = 'Chausar does not do this: it would keep working after you close the app, such as a new key or token, a webhook that keeps sending, or a batch that hides what it does. Do it yourself where you can see it.';

/** Action names Chausar never journals: each makes something that keeps acting after the session. */
const DENIED_ACTION = /^(credentials?|tokens?|api[-_]?keys?|secrets?|webhooks?|bulk|batch)([._-]|$)/i;
/** A connected service's operation that does the same: a credential minted, a webhook made, a bulk wrapper. */
const DENIED_OPERATIONS: readonly RegExp[] = Object.freeze([
  /(^|[._/-])(api[_-]?keys?|access[_-]?tokens?|tokens?|credentials?|secrets?|oauth[_-]?(apps?|clients?)|service[_-]?accounts?|deploy[_-]?keys?)[._/-]?(create|mint|issue|new|generate|add|rotate)\b/i,
  /(^|[._/-])webhooks?([_-]?subscriptions?)?[._/-]?(create|add|subscribe|register|new)\b/i,
  /(^|[._/-])(bulk|batch|multi)([._/-]|$)/i,
]);

/** True when an action, or the operation it runs on a connected service, would outlive the session. */
export function outlivesSession(action: string, operation: string | null | undefined): boolean {
  if (DENIED_ACTION.test(action)) return true;
  return !!operation && DENIED_OPERATIONS.some(pattern => pattern.test(operation));
}

/** journal.ts normalizeProposal: refuses such an action before anything is recorded. */
export function refuseDenylisted(action: unknown, operation: unknown): void {
  check(operation === undefined || operation === null || (typeof operation === 'string' && /^[A-Za-z0-9_./:-]{1,120}$/.test(operation)),
    'INVALID_VENTURE_REQUEST', 'The operation must be a short name, such as send-deliverable.');
  if (typeof action === 'string' && outlivesSession(action, operation as string | null | undefined)) throw new ChausarError('ACTION_DENYLISTED', ACTION_DENY_LINE);
  // Fails closed: a write to a connected service names what it does, and only the writes Chausar knows go.
  if (action === 'connector.write' && !(typeof operation === 'string' && CONNECTOR_WRITE_OPERATIONS.includes(operation))) {
    throw new ChausarError('ACTION_DENYLISTED', OPERATION_UNKNOWN_LINE);
  }
}

/**
 * The writes to a connected service Chausar knows (delivery/harness/tools.ts): sending a deliverable through the
 * owner's mail app and making a payment link. Any other operation, or none, is refused.
 */
export const CONNECTOR_WRITE_OPERATIONS: readonly string[] = Object.freeze(['send-deliverable', 'create-link',
  // Ink v2 wave 5 (5A6): one approved item to the owner's own n8n or Make webhook, and one approved command of an app they installed.
  'webhook-send', 'local-app-run', 'happenstance-search']);
export const OPERATION_UNKNOWN_LINE = 'Chausar writes to a connected service only in the ways it knows: sending a deliverable by mail, making a payment link, sending an item you approved to your webhook, or running a command you approved in your own app. This is not one of them.';

// ---------------------------------------------------------------------------
// reject() cleanup
// ---------------------------------------------------------------------------

/** What a website edit the owner turned down says. */
const EDIT_TURNED_DOWN = 'You turned this edit down. Its staged copy was removed; nothing was written.';

/**
 * The cleanup each action kind declares for when the owner rejects one, run inside the rejection's commit. A website
 * edit: the staged edit is turned down and its staged copy removed (its digest stays, so the record says what it was).
 */
export const REJECT_CLEANUPS: Readonly<Partial<Record<JournalActionId, (tx: VentureTx, record: JournalRecord) => void>>> = Object.freeze({
  'site.apply': (tx: VentureTx, record: JournalRecord) => {
    if (!record.subject.endsWith('.applied')) return;
    const edit = tx.find('venture-site-edit', record.subject.slice(0, record.subject.lastIndexOf('.')));
    if (edit?.state === 'staged') turnDownEditIn(tx, edit);
  },
});

/**
 * The website edit's own cleanup, on whichever path the owner turns it down (build/site-edits.ts rejectSiteEdit, or a
 * waiting site.apply entry rejected): the edit is rejected, its staged copy removed (its digest stays, so the record
 * still says what it was), and a waiting site.apply entry for it ends too. Nothing is written to the site.
 */
export function turnDownEditIn(tx: VentureTx, edit: SiteEditRecord): SiteEditRecord {
  const done = tx.replace<SiteEditRecord>({ ...edit, state: 'rejected', after: '', log: [...edit.log, { at: tx.now, by: tx.ctx.memberId, step: 'rejected', line: EDIT_TURNED_DOWN }] });
  for (const entry of tx.list('venture-journal-entry')) {
    if (entry.action !== 'site.apply' || entry.subject !== `${edit.id}.applied` || entry.state !== 'described') continue;
    tx.replace(stepTo(entry, 'rejected', tx.now, 'owner', EDIT_TURNED_DOWN, { outcome: { line: EDIT_TURNED_DOWN, url: null, by: 'owner' }, decidedBy: tx.ctx.memberId }));
  }
  return done;
}

/** journal.ts rejectAction: the rejected kind's cleanup, if it has one. */
export function cleanUpRejected(tx: VentureTx, record: Journalled): void {
  if (record.kind === 'venture-journal-entry') REJECT_CLEANUPS[record.action]?.(tx, record);
}

// ---------------------------------------------------------------------------
// provides and dependsOn
// ---------------------------------------------------------------------------

const KEY = /^[A-Za-z0-9_.:-]{1,120}$/;
const MAX_KEYS = 8;

/** A list of keys a proposal provides or depends on: up to eight short names. */
export function normalizeKeys(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  check(Array.isArray(value) && value.length <= MAX_KEYS && value.every(key => typeof key === 'string' && KEY.test(key)) && new Set(value).size === value.length,
    'INVALID_VENTURE_REQUEST', `${field} must be up to ${MAX_KEYS} short names, such as invoice:12.`);
  return [...value];
}

/** The newest real entry that provides key, other than the one asking. */
function providerOf(tx: VentureTx, key: string, asking: string): JournalRecord | undefined {
  return tx.list('venture-journal-entry').filter(entry => !entry.shadow && entry.id !== asking && (entry.provides ?? []).includes(key)).pop();
}

/** Approve and apply: refused while anything this depends on has not applied (JOURNAL_WAITING). */
export function checkDependenciesIn(tx: VentureTx, record: Journalled): void {
  if (record.kind !== 'venture-journal-entry') return;
  for (const key of record.dependsOn ?? []) {
    const provider = providerOf(tx, key, record.id);
    check(provider, 'JOURNAL_WAITING', 'This waits for an action that is not in the journal yet.');
    if (provider.state === 'applied') continue;
    if (provider.state === 'rejected') throw new ChausarError('JOURNAL_WAITING', neededLine(provider));
    throw new ChausarError('JOURNAL_WAITING', `This waits for "${provider.describe}" to happen first.`);
  }
}

const neededLine = (provider: JournalRecord) => `Not done: it needed "${provider.describe}", which did not happen.`;

/**
 * After an entry is rejected, in the same commit: each waiting entry that depended on something it provided, and that
 * it was the newest provider of, is rejected too, and so on down the line. Nothing is sent or run.
 */
export function rejectDependentsIn(tx: VentureTx, record: Journalled): void {
  if (record.kind !== 'venture-journal-entry' || record.state !== 'rejected' || !record.provides?.length) return;
  const provided = new Set(record.provides);
  for (const entry of tx.list('venture-journal-entry')) {
    if (entry.shadow || entry.state !== 'described' || !(entry.dependsOn ?? []).some(key => provided.has(key))) continue;
    const blocked = (entry.dependsOn ?? []).some(key => provided.has(key) && providerOf(tx, key, entry.id)?.id === record.id);
    if (!blocked) continue;
    const line = neededLine(record);
    const ended = tx.replace(stepTo(entry, 'rejected', tx.now, 'engine', line, { outcome: { line, url: null, by: 'engine' } }));
    rejectDependentsIn(tx, ended);
  }
}

// ---------------------------------------------------------------------------
// The account fence
// ---------------------------------------------------------------------------

const approvedAccount = (record: Journalled): string | null => (record.kind === 'venture-connector-post' ? record.account : record.account ?? null);
const sameAccount = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * An approved action runs only under the account it was approved for. running: the account the effect is about to
 * use; null or undefined (the caller cannot tell, or did not say) is refused, for every caller: an account Chausar
 * cannot see is not the approved one. An action approved with no account named is not fenced.
 */
export function fenceAccount(record: Pick<JournalRecord, 'kind' | 'account'> | Journalled, running: string | null | undefined): void {
  const approved = approvedAccount(record as Journalled);
  if (!approved) return;
  if (running === null || running === undefined) throw new ChausarError('ACCOUNT_FENCE', `This was approved for ${approved}, and Chausar cannot tell which account it would run under. Nothing was sent.`);
  if (sameAccount(approved, running)) return;
  throw new ChausarError('ACCOUNT_FENCE', `This was approved for ${approved}, not ${running}. Nothing was sent; approve it again for this account.`);
}
