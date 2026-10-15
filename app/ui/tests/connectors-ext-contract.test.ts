import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { connectionsReply, envelope, exporterReply, freshnessReply, repeatable, systemsReply, tablesReply, waiting } from '../src/screens/connectors/contract.ts';
import { buildMapping, wordLines } from '../src/screens/connectors/mapping.ts';
import { words } from '../src/text/lanes/connectors-ext.ts';
import { subPlaces } from '../src/places/subplaces/connectors-ext.ts';
import { run } from '../src/screens/work/kit/validate.ts';

const refused = (check: Parameters<typeof run>[0], value: unknown) => assert.throws(() => run(check, value), (e: unknown) => (e as { code?: string }).code === 'INVALID_REPLY');
const months = Array.from({ length: 12 }, (_, i) => ({ month: `2026-${String(i + 1).padStart(2, '0')}`, status: i === 3 ? 'failed' : 'not-loaded-yet' }));
const schedule = { operation: 'invoices', everyHours: 6, freshnessTargetHours: 24, catchUp: 'run-once', autoImport: false, lastRunAt: null, lastOutcome: null, runs: { day: '', count: 0 } };
const conn = { id: 'connection_1', group: 'zoho-books', road: 'interface', label: 'Zoho Books', company: 'Synthetic Co', branch: 'main', sourceId: 'cx-zoho-books-1', settings: { region: 'in' }, status: 'active', createdAt: '2026-10-01T00:00:00.000Z', createdBy: 'm1', schedule };
const env = {
  id: 'envelope_1', connectionId: 'connection_1', sourceId: 'cx-db-1', company: 'Synthetic Co', branch: 'main', group: 'plain-database', operation: 'orders', recipeId: 'plain-db.orders', recipeVersion: '1', recipeDigest: 'd',
  road: 'database', fetchedAt: '2026-10-15T10:00:00.000Z', requestedPeriod: null, period: { from: '2026-10-01', to: '2026-10-14' }, status: 'accepted', refusal: null, abstention: null,
  checks: [{ id: 'source-total', status: 'passed', expected: '150000', observed: '150000' }, { id: 'source-row-count', status: 'passed', expected: 3, observed: 3 }],
  observed: { rowCount: 3, total: '150000', unit: 'INR' }, sourceTotals: { rowCount: 3, total: '150000', reference: 'database-aggregate', provenance: 'database-aggregate' },
  unmappedFields: [], excludedRows: 0, contentHash: 'h', sensitivity: 'financial', notices: [], read: null, committed: null, createdBy: 'm1', pendingRows: 3, pendingExpiresAt: '2026-10-15T16:00:00.000Z',
};

test('connections and their schedules mirror the engine reply', () => {
  const [one] = run(connectionsReply, [conn]);
  assert.equal(one?.schedule?.everyHours, 6);
  assert.equal(run(connectionsReply, [{ ...conn, schedule: null }])[0]?.schedule, null);
  refused(connectionsReply, [{ ...conn, road: 'cloud' }]);
  refused(connectionsReply, [{ ...conn, schedule: { ...schedule, everyHours: 1.5 } }]);
  refused(connectionsReply, [{ ...conn, schedule: { ...schedule, catchUp: 'always' } }]);
  refused(connectionsReply, [{ ...conn, settings: { region: 7 } }]);
  refused(connectionsReply, { connections: [conn] });
});

test('freshness has exactly twelve months in the fixed states, and staleness may be unknown', () => {
  const row = { sourceId: 'cx-zoho-books-1', months, lastRead: null, lastFailure: null, unmappedFields: [], connection: null, schedule: null, stale: null };
  assert.equal(run(freshnessReply, [row])[0]?.months.length, 12);
  refused(freshnessReply, [{ ...row, months: months.slice(1) }]);
  refused(freshnessReply, [{ ...row, months: months.map(m => ({ ...m, status: 'zero' })) }]);
  refused(freshnessReply, [{ ...row, stale: 'yes' }]);
});

test('only live interface reads built by this lane can repeat', () => {
  const reply = run(systemsReply, { asOf: '2026-10-15T00:00:00.000Z', board: {}, signIn: {}, groups: [{ id: 'zoho-books', name: 'Zoho Books', family: 'accounting', operations: [
    { id: 'invoices-api', label: 'Core', depth: 'read', road: 'interface', status: 'tested', owner: 'core', limitation: '' },
    { id: 'invoices', label: 'Invoices', depth: 'read', road: 'interface', status: 'tested', owner: 'connectors-ext', limitation: '' },
    { id: 'contacts', label: 'Contacts', depth: 'read', road: 'interface', status: 'experimental', owner: 'connectors-ext', limitation: '' },
    { id: 'csv', label: 'File', depth: 'import', road: 'file', status: 'tested', owner: 'connectors-ext', limitation: '' },
  ] }] });
  assert.deepEqual(repeatable(reply, 'zoho-books').map(o => o.id), ['invoices']);
  assert.deepEqual(repeatable(reply, 'tally'), []);
  refused(systemsReply, { groups: [{ id: 'x', name: 'X', operations: [{ id: 'a', label: 'A', depth: 'deep', road: 'interface', status: 'tested', limitation: '' }] }] });
});

test('an envelope carries exact figures as text, never floats, and waits only while accepted and held', () => {
  const e = run(envelope, env);
  assert.equal(e.checks[0]?.expected, '150000');
  assert.equal(waiting(e), true);
  assert.equal(waiting(run(envelope, { ...env, committed: { importId: 'import_1', at: '2026-10-15T11:00:00.000Z', rows: 3, duplicate: false }, pendingRows: 0 })), false);
  assert.equal(waiting(run(envelope, { ...env, status: 'refused', refusal: { code: 'SOURCE_TOTAL_MISMATCH', reason: 'The total differs.' } })), false);
  refused(envelope, { ...env, observed: { ...env.observed, total: 1500.5 } });
  refused(envelope, { ...env, checks: [{ id: 'source-total', status: 'passed', expected: '1500.50', observed: '150050' }] });
  refused(envelope, { ...env, status: 'maybe' });
  refused(envelope, { ...env, abstention: { reason: 'currency', field: 'c', question: 'q', options: 'INR' } });
});

test('database tables and the Tally exporter reply are checked; file names are plain', () => {
  assert.equal(run(tablesReply, [{ schema: 'public', name: 'orders', columns: [{ name: 'id', type: 'integer', nullable: false }] }])[0]?.name, 'orders');
  refused(tablesReply, [{ schema: 'public', name: 'orders', columns: [{ name: 'id', type: 'integer', nullable: 'no' }] }]);
  const made = { exportId: 'tallyexport_1', fileName: 'chausar-tally-sales-2026-10-01-to-2026-10-14.ps1', script: '# script\r\nWrite-Output 1', guideFileName: 'chausar-tally-guide.txt',
    guide: { en: '1. Copy the script.\n2. Run it.', hi: '1. स्क्रिप्ट कॉपी करें।' }, expiresAt: '2026-11-14T00:00:00.000Z' };
  assert.equal(run(exporterReply, made).guide.hi.startsWith('1.'), true);
  refused(exporterReply, { ...made, fileName: '../evil.ps1' });
  refused(exporterReply, { ...made, fileName: 'run.exe' });
  refused(exporterReply, { ...made, guide: { en: 'x' } });
});

test('the read mapping is names only and refuses to be built incomplete', () => {
  const table = { schema: 'public', name: 'orders', columns: [] };
  const base = { engine: 'postgres' as const, table, columns: { id: 'id', date: 'created', amount: 'total_paise' }, measure: 'money' as const, moneyUnit: 'minor' as const, currency: 'INR', countUnit: '',
    constantKind: 'invoice', kindValues: '', statusValues: '', dateFormat: 'ISO' as const, from: '2026-10-01', to: '2026-10-14' };
  assert.deepEqual(buildMapping(base), { engine: 'postgres', table: { schema: 'public', name: 'orders' }, columns: { id: 'id', date: 'created', amount: 'total_paise' }, measure: 'money', moneyUnit: 'minor',
    dateFormat: 'ISO', currency: 'INR', constantKind: 'invoice', period: { from: '2026-10-01', to: '2026-10-14' } });
  assert.deepEqual(buildMapping({ ...base, engine: 'sqlite' })?.['table'], { name: 'orders' });
  assert.equal(buildMapping({ ...base, columns: { id: 'id', date: 'created' } }), null);
  assert.equal(buildMapping({ ...base, currency: 'rupees' }), null);
  assert.equal(buildMapping({ ...base, from: '2026-10-14', to: '2026-10-01' }), null);
  assert.deepEqual(buildMapping({ ...base, columns: { ...base.columns, kind: 'type' }, kindValues: 'S = sale\nR = refund\n\nbad line' })?.['kindValues'], { S: 'sale', R: 'refund' });
  assert.deepEqual(wordLines('a=b\n=c\nno'), { a: 'b', '': 'c' });
});

test('every word the screens use is in both languages, sub-places are named, and copy has no banned punctuation', () => {
  assert.deepEqual(Object.keys(words.hi).sort(), Object.keys(words.en).sort());
  for (const sub of subPlaces) assert.ok(words.en[`SH-01.sub.${sub.place}.${sub.id}` as keyof typeof words.en], sub.id);
  for (const [key, value] of Object.entries(words.en)) {
    assert.ok(key.startsWith('CX.') || key.startsWith('SH-01.sub.books.'), key);
    assert.doesNotMatch(value, /[—!]/u, key);
    assert.ok(words.hi[key as keyof typeof words.hi]?.trim(), key);
    // Hindi keeps every {slot} of the English template.
    for (const slot of value.match(/\{[a-zA-Z]+\}/g) ?? []) assert.ok(words.hi[key as keyof typeof words.hi].includes(slot), `${key} ${slot}`);
  }
  const source = ['Scheduled.tsx', 'Database.tsx', 'TallyExport.tsx', 'shared.tsx'].map(name => readFileSync(new URL(`../src/screens/connectors/${name}`, import.meta.url), 'utf8')).join('\n');
  for (const match of source.matchAll(/'(CX\.[A-Za-z0-9.-]+)'/g)) assert.ok(match[1]! in words.en, match[1]);
});
