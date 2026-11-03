// Chausar venture launcher, CRM upgrades (wave 6, package 6G3, D44): writes one field change beside the record it is
// about, inside the caller's transaction. Kept apart from crm.ts so the evidence ledger, which writes a client's
// fields back, can record its changes without importing the CRM handlers.
import type { CrmChangeRecord } from '../contracts.ts';
import type { VentureTx } from '../records.ts';
import type { CrmChangeBody, CrmWho } from './crm-data.ts';

/** Records one change; nothing when the value did not change. */
export function crmChange(tx: VentureTx, change: CrmChangeBody): CrmChangeRecord | null {
  if (change.before === change.after) return null;
  return tx.put<CrmChangeRecord>({ ...tx.base('venture-crm-change'), ...change });
}

/** Who an evidence row's writer is, as the field history names them. */
export const crmWhoOf = (by: string): CrmWho => (by === 'owner' ? 'owner' : by === 'agent' ? 'agent' : 'chausar');
