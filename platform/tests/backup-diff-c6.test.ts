// One-shot C6 task 1 (section 9 idea 25): what a backup holds and what a restore would take back, by record kind.
// Pure: two states in, owner counts out. The engine method around it is in workspace-custody.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BACKUP_KIND_WORDS, backupCounts, backupDiff } from '../runtime/venture/views/backup-diff.ts';
import type { State } from '../runtime/contracts.ts';

const state = (records: Record<string, unknown>[]): State => ({ conversations: records } as unknown as State);
const client = (id: string, name = 'Cafe Aroma') => ({ id, kind: 'venture-client', name });
const order = (id: string, request = 'Books for October') => ({ id, kind: 'venture-order', request });
const invoice = (id: string) => ({ id, kind: 'venture-invoice', state: 'issued' });

test('counts each kind an owner knows, in the table order, and leaves out kinds with none', () => {
  const counts = backupCounts(state([client('c1'), client('c2'), order('o1'), invoice('i1'), invoice('i2'), invoice('i3')]));
  assert.deepEqual(counts, [
    { kind: 'clients', words: 'clients', count: 2 },
    { kind: 'orders', words: 'orders', count: 1 },
    { kind: 'invoices', words: 'invoices', count: 3 },
  ]);
});

test('added, changed and removed per kind: a newer version of the same id is a change', () => {
  const then = state([client('c1'), client('c2'), order('o1'), invoice('i1')]);
  const now = state([client('c1', 'Cafe Aroma Ltd'), order('o1'), order('o2'), invoice('i1'), invoice('i2')]);
  assert.deepEqual(backupDiff(now, then), [
    { kind: 'clients', words: 'clients', added: 0, changed: 1, removed: 1 },
    { kind: 'orders', words: 'orders', added: 1, changed: 0, removed: 0 },
    { kind: 'invoices', words: 'invoices', added: 1, changed: 0, removed: 0 },
  ]);
});

test('nothing changed reads as an empty list', () => {
  const records = [client('c1'), order('o1')];
  assert.deepEqual(backupDiff(state(records), state(structuredClone(records))), []);
});

test('a kind not in the table lands in "other records", so a new kind never breaks it', () => {
  const then = state([]);
  const now = state([{ id: 't1', kind: 'venture-other-one' }, { id: 't2', kind: 'venture-other-two' }, client('c1')]);
  assert.deepEqual(backupDiff(now, then), [
    { kind: 'clients', words: 'clients', added: 1, changed: 0, removed: 0 },
    { kind: 'other', words: 'other records', added: 2, changed: 0, removed: 0 },
  ]);
  assert.deepEqual(backupCounts(now).at(-1), { kind: 'other', words: 'other records', count: 2 });
});

test("Chausar's own bookkeeping is not counted, and the owner's own shop is not a client", () => {
  const now = state([{ id: 'e1', kind: 'venture-event' }, { id: 'v1', kind: 'venture-record' }, { id: 'c0', kind: 'venture-client', self: true }, client('c1')]);
  assert.deepEqual(backupCounts(now), [{ kind: 'clients', words: 'clients', count: 1 }]);
  assert.deepEqual(backupDiff(now, state([])), [{ kind: 'clients', words: 'clients', added: 1, changed: 0, removed: 0 }]);
});

test('every kind in the table has words and at least one record kind, and no record kind is in two rows', () => {
  const seen = new Set<string>();
  for (const row of BACKUP_KIND_WORDS) {
    assert.ok(row.words && row.kinds.length, row.kind);
    for (const kind of row.kinds) { assert.ok(!seen.has(kind), kind); seen.add(kind); }
  }
  assert.deepEqual(BACKUP_KIND_WORDS.map(row => row.kind),
    ['clients', 'orders', 'drafts', 'invoices', 'payments', 'bills', 'decisions', 'notes', 'routines', 'apps', 'tracker-rows', 'hired-agents']);
});

test('records without an id or a kind are skipped, never a crash', () => {
  const now = state([null as unknown as Record<string, unknown>, { kind: 'venture-client' }, { id: 'x' }, client('c1')]);
  assert.deepEqual(backupCounts(now), [{ kind: 'clients', words: 'clients', count: 1 }]);
});
