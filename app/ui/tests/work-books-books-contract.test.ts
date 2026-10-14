import assert from 'node:assert/strict';
import test from 'node:test';
import { asKnownReply, conflictsReply, draft, forgetReply, memoryReply, sourcesReply, versionsReply } from '../src/screens/books/contract.ts';
import { run } from '../src/screens/work/kit/validate.ts';

const months = Array.from({ length: 12 }, (_, i) => ({ month: `2026-${String(i + 1).padStart(2, '0')}`, state: 'loaded' }));
const row = { sourceId: 'src:tally', system: 'Tally', way: 'files', scope: null, lastReadAt: null, months, rows: 1, refused: 0, unmapped: 0, experimental: true, connected: true };
const refused = (check: Parameters<typeof run>[0], value: unknown) => assert.throws(() => run(check, value), (e: unknown) => (e as { code?: string }).code === 'INVALID_REPLY');

test('sources need exactly twelve months in the fixed states', () => {
  assert.equal(run(sourcesReply, { rows: [row], unmappedFields: 0, freshness: { available: false } }).rows[0]?.months.length, 12);
  refused(sourcesReply, { rows: [{ ...row, months: months.slice(1) }], unmappedFields: 0, freshness: { available: false } });
  refused(sourcesReply, { rows: [{ ...row, months: months.map(m => ({ ...m, state: 'empty' })) }], unmappedFields: 0, freshness: { available: false } });
  refused(sourcesReply, { rows: [{ ...row, way: 'cloud' }], unmappedFields: 0, freshness: { available: false } });
});

test('amounts are paise strings or a missing word, never a float or a zero for missing', () => {
  const at = (value: unknown) => ({ then: { value, receiptId: 'r1', asOf: '2026-09-30' }, now: { value: { minor: '1' }, receiptId: 'r2', asOf: '2026-10-14' } });
  assert.deepEqual(run(asKnownReply, at({ missing: 'not-loaded-yet' })).then.value, { missing: 'not-loaded-yet' });
  refused(asKnownReply, at({ minor: 12.5 }));
  refused(asKnownReply, at({ missing: 'zero' }));
  refused(asKnownReply, { ...at({ minor: '1' }), now: { value: { minor: '1' }, receiptId: null, asOf: '2026-10-14' } });
});

test('drafts, memory, versions and conflicts mirror the contract', () => {
  const d = { id: 'd1', name: 'billed', author: 'A', createdAt: '2026-10-01T00:00:00Z', state: 'draft', before: null,
    after: { label: 'Billed', meaning: 'm', kind: 'invoice', field: 'total', nulls: 'exclude', sign: -1 }, change: 'c',
    affects: { calculations: [], savedAnswers: 0 }, reviews: [], checks: { ok: false, code: 'NULL_RULE' }, digest: 'x' };
  assert.equal(run(draft, d).after?.sign, -1);
  refused(draft, { ...d, after: { ...d.after, sign: 2 } });
  refused(draft, { ...d, reviews: [{ kind: 'human', by: 'A', role: 'owner', at: '2026-10-01' }] });
  refused(memoryReply, { lines: [{ id: 'm', text: 't', kind: 'claim', status: 'assumed', source: 'web', receiptId: null, learnedAt: '2026-10-01', confirmedAt: null, earlier: [] }] });
  assert.equal(run(forgetReply, { id: 'm', deleted: true }).deleted, true);
  refused(forgetReply, { id: 'm', deleted: 'yes' });
  refused(versionsReply, { versions: [{ factId: 'f', learnedAt: '2026-10-01', supersededAt: null, kind: 'k', validFrom: '2026-10-01', amount: { minor: '1' }, sourceId: 's', change: 'edit' }] });
  const c = run(conflictsReply, { conflicts: [{ entityId: 'e1', kind: 'customer', rule: null, picked: null, claims: [{ sourceId: 'a', fields: { phone: '1' } }] }], rules: [] });
  assert.equal(c.conflicts[0]?.claims[0]?.fields['phone'], '1');
  refused(conflictsReply, { conflicts: [{ entityId: 'e1', kind: 'customer', rule: null, picked: null, claims: [{ sourceId: 'a', fields: { phone: 1 } }] }], rules: [] });
});

test('text with control characters is refused', () => {
  refused(sourcesReply, { rows: [{ ...row, system: 'Tally\u0007' }], unmappedFields: 0, freshness: { available: true } });
});
