// Chausar venture launcher: venture.journal.list, the action journal as the Money place shows it (package P2-journal).
// One JournalEntry per outside effect, newest first: the journal entries (invoices, sends to the owner's AI and every
// other write), the connector posts, which are journalled records of their own, and the staged website edits, whose
// own states map onto the journal's. Shadow entries never happened, so they are left out. A read: no token, no digest.
import { authorize, check, type Context, type State } from '../../contracts.ts';
import type { JournalEntry, JournalRecord, JournalState, SiteEditRecord, SiteEditState, VentureDeps } from '../contracts.ts';
import { currentVenture, exactPayload, listRecords } from '../records.ts';
import { postJournal } from '../build/posting.ts';
import { JOURNAL_ACTIONS } from './journal.ts';

export const JOURNAL_LIST_DEFAULT = 100;
export const JOURNAL_LIST_MAX = 500;

const lastOf = <T>(items: readonly T[]): T | undefined => items[items.length - 1];

function entryOf(record: JournalRecord): JournalEntry {
  const last = lastOf(record.journal);
  return {
    id: record.id, action: JOURNAL_ACTIONS[record.action]?.label ?? record.action, target: record.target, state: record.state,
    at: last?.at ?? record.at, line: last?.line ?? record.describe, ...(record.receiptId ? { receiptId: record.receiptId } : {}),
  };
}

/** A staged edit waits like a described action; one that could not be confirmed is an unknown outcome. */
const SITE_STATES: Readonly<Record<SiteEditState, JournalState>> = Object.freeze({
  staged: 'described', applying: 'approved', applied: 'applied', 'rolled-back': 'applied', rejected: 'rejected', 'needs-inspection': 'outcome_unknown',
});

function siteOf(edit: SiteEditRecord): JournalEntry {
  const last = lastOf(edit.log);
  return { id: edit.id, action: JOURNAL_ACTIONS['site.apply'].label, target: edit.path, state: SITE_STATES[edit.state] ?? 'outcome_unknown', at: last?.at ?? edit.at, line: last?.line ?? edit.summary };
}

/** Every journalled effect of the open business, newest first. */
export function journalEntries(state: State, limit = JOURNAL_LIST_DEFAULT): JournalEntry[] {
  const venture = currentVenture(state);
  if (!venture) return [];
  const entries = [
    ...listRecords(state, 'venture-journal-entry', venture.id).filter(record => !record.shadow).map(entryOf),
    ...postJournal(state, venture.id),
    ...listRecords(state, 'venture-site-edit', venture.id).map(siteOf),
  ];
  return entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, limit);
}

/** venture.journal.list { limit? } (read): what each outside effect is and where it stands, newest first. */
export async function journalListHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ entries: JournalEntry[] }> {
  const body = exactPayload(payload, ['limit']);
  check(body.limit === undefined || (Number.isInteger(body.limit) && (body.limit as number) >= 1 && (body.limit as number) <= JOURNAL_LIST_MAX),
    'INVALID_VENTURE_REQUEST', `limit must be a whole number from 1 to ${JOURNAL_LIST_MAX}.`);
  authorize(deps.store, ctx);
  return { entries: journalEntries(deps.store.read(), (body.limit as number | undefined) ?? JOURNAL_LIST_DEFAULT) };
}
