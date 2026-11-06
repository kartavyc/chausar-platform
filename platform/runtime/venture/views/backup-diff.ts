// One-shot C6 task 1 (section 9 idea 25, SCREENS 208 and 213): what a backup holds and what a restore would take back.
// Browser safe and pure: two states in, owner counts out. Records are the vault's conversations, keyed by kind and id;
// a record whose id is in both states but whose content differs is "changed" (records are replaced in place).
export type BackupKind = (typeof BACKUP_KIND_WORDS)[number]['kind'] | 'other';
import type { State } from '../../contracts.ts';

/**
 * The kinds an owner knows, in the order they are said. Any other record kind is counted under "other records", so a
 * new kind never breaks a diff (C7 adds tracker rows and hired agents here).
 */
export const BACKUP_KIND_WORDS = Object.freeze([
  { kind: 'clients', words: 'clients', kinds: ['venture-client'] },
  { kind: 'orders', words: 'orders', kinds: ['venture-order'] },
  { kind: 'drafts', words: 'drafts', kinds: ['venture-delivery-run', 'venture-connector-post'] },
  { kind: 'invoices', words: 'invoices', kinds: ['venture-invoice'] },
  { kind: 'payments', words: 'payments', kinds: ['venture-payment'] },
  { kind: 'bills', words: 'bills', kinds: ['venture-bill'] },
  { kind: 'decisions', words: 'decisions', kinds: ['venture-decision'] },
  { kind: 'notes', words: 'notes', kinds: ['venture-agent-note'] },
  { kind: 'routines', words: 'routines', kinds: ['venture-routine'] },
  { kind: 'apps', words: 'apps', kinds: ['venture-mini-app'] },
] as const);
export const OTHER_WORDS = 'other records';

/**
 * Chausar's own bookkeeping, written on most changes and never made by the owner: counting it would say "14 other
 * records changed" after any click. The business record itself is touched on every write.
 */
const NOT_COUNTED: ReadonlySet<string> = new Set(['venture-record', 'venture-event', 'venture-model-call', 'venture-queue-view',
  'venture-notification', 'venture-journal-chain', 'venture-receipt-signature', 'venture-keeper-run', 'venture-sum-receipt',
  'venture-evidence', 'venture-crm-change']);

export type BackupCount = { kind: BackupKind; words: string; count: number };
export type BackupChange = { kind: BackupKind; words: string; added: number; changed: number; removed: number };

const OWNER_KIND = new Map<string, BackupKind>(BACKUP_KIND_WORDS.flatMap(row => row.kinds.map(kind => [kind, row.kind] as const)));
const ORDER: readonly { kind: BackupKind; words: string }[] = [...BACKUP_KIND_WORDS.map(row => ({ kind: row.kind as BackupKind, words: row.words })), { kind: 'other', words: OTHER_WORDS }];

type Keyed = { key: string; kind: BackupKind; text: string };
function keyed(state: State): Map<string, Keyed> {
  const out = new Map<string, Keyed>();
  for (const record of (state?.conversations ?? []) as unknown[]) {
    if (!record || typeof record !== 'object') continue;
    const { id, kind, self } = record as { id?: unknown; kind?: unknown; self?: unknown };
    if (typeof id !== 'string' || typeof kind !== 'string' || NOT_COUNTED.has(kind)) continue;
    if (kind === 'venture-client' && self === true) continue; // the owner's own shop, never a client
    out.set(`${kind}\u0000${id}`, { key: id, kind: OWNER_KIND.get(kind) ?? 'other', text: JSON.stringify(record) });
  }
  return out;
}

/** How many of each kind a state holds, in the table order, kinds with none left out. */
export function backupCounts(state: State): BackupCount[] {
  const tally = new Map<BackupKind, number>();
  for (const record of keyed(state).values()) tally.set(record.kind, (tally.get(record.kind) ?? 0) + 1);
  return ORDER.filter(row => tally.get(row.kind)).map(row => ({ kind: row.kind, words: row.words, count: tally.get(row.kind)! }));
}

/** What changed from `then` (the backup) to `now` (the open business), per kind: restoring takes these back. */
export function backupDiff(now: State, then: State): BackupChange[] {
  const after = keyed(now), before = keyed(then);
  const tally = new Map<BackupKind, { added: number; changed: number; removed: number }>();
  const bump = (kind: BackupKind, field: 'added' | 'changed' | 'removed') => {
    const row = tally.get(kind) ?? { added: 0, changed: 0, removed: 0 }; row[field]++; tally.set(kind, row);
  };
  for (const [key, record] of after) {
    const old = before.get(key);
    if (!old) bump(record.kind, 'added'); else if (old.text !== record.text) bump(record.kind, 'changed');
  }
  for (const [key, record] of before) if (!after.has(key)) bump(record.kind, 'removed');
  return ORDER.filter(row => tally.has(row.kind)).map(row => ({ kind: row.kind, words: row.words, ...tally.get(row.kind)! }));
}
