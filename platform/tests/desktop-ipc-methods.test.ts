import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import type { DesktopPayload } from '../../app/desktop/types.ts';

const { METHODS, validateRequest } = createRequire(import.meta.url)('../../app/desktop/ipc-contract.cjs');
const connectorMethods = [
  'connectors.profiles', 'connectors.read', 'connectors.reviewMapping', 'connectors.capture',
  'connectors.publish', 'connectors.ready', 'connectors.captureStatus', 'connectors.releaseRead',
] as const;
const addedJobMethods = ['jobs.types', 'jobs.amend', 'jobs.cancel', 'jobs.reconcile', 'jobs.progress'] as const;
const calendarMethods = ['jobs.calendar.preview', 'jobs.calendar.configure', 'jobs.calendar.pause', 'jobs.calendar.resume'] as const;
type RequestMethod = typeof connectorMethods[number] | typeof addedJobMethods[number] | typeof calendarMethods[number] | 'jobs.create' | 'jobs.accept' | 'sources.groups';

const recipe = {
  version: 1, id: 'reviewed-mapping', system: 'fixture', edition: '1',
  scope: { company: 'Fixture Company', branches: ['main'] },
  bindings: [
    { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' },
    { target: 'amountMinor', source: 'amount', type: 'money', nulls: 'reject', moneyUnit: 'minor', currency: 'INR' },
  ],
  allowedKinds: ['sale'], allowedStatuses: ['delivered'], onUnmapped: 'reject',
} satisfies DesktopPayload<'connectors.capture'>['recipe'];
const requests = {
  'sources.groups': {},
  'jobs.types': {},
  'jobs.create': { type: 'owner-brief', goal: 'Review current business evidence', budgetMinor: '900719925474099301', reserveMinor: '100', stopRule: { maxRuns: 1, deadline: '2030-01-01T00:00:00.000Z' } },
  'jobs.amend': { id: 'job-fixture', config: { type: 'evidence-review', input: { receiptIds: ['receipt-fixture'] }, goal: 'Review current calculation receipts', budgetMinor: '100', stopRule: { maxRuns: 1, deadline: '2030-01-01T00:00:00.000Z' }, limits: { modelUnits: 0, durationMs: 1000, actionExposureMinor: '0' } } },
  'jobs.cancel': { id: 'job-fixture' },
  'jobs.reconcile': { id: 'job-fixture' },
  'jobs.progress': { id: 'job-fixture' },
  'jobs.accept': { id: 'job-fixture', repeat: true },
  'jobs.calendar.preview': { id: 'job-fixture' },
  'jobs.calendar.pause': { id: 'job-fixture' },
  'jobs.calendar.resume': { id: 'job-fixture' },
  'jobs.calendar.configure': { id: 'job-fixture', expectedScheduleRevision: 1, expectedObjectiveRevision: 1, replacement: 'replace-immediately',
    definition: { version: 1, basis: 'calendar', timeZone: 'UTC', rulesRevision: 'synthetic-rules-v1', effectiveFrom: '2026-10-01T00:00:00.000Z',
      recurrence: { kind: 'once', atLocal: '2026-10-01T09:00' }, dst: { gap: 'reject', overlap: 'reject' },
      excludedResolvedDates: [], holidays: { kind: 'include' }, missed: { kind: 'skip', graceMs: 1000 }, overlap: 'defer', identityBasis: 'local-date-time',
      stop: { until: '2026-10-02T00:00:00.000Z', maxNominalOccurrences: 1 }, revisionPolicy: 'idle-only' } },
  'connectors.profiles': {},
  'connectors.read': { profileId: 'profile-fixture' },
  'connectors.reviewMapping': { profileId: 'profile-fixture', recipe, evidence: { reportId: 'report-fixture', sha256: 'a'.repeat(64) } },
  'connectors.capture': { acquisitionId: 'acquisition-fixture', reviewId: 'review-fixture', recipe, idempotencyKey: 'capture-fixture' },
  'connectors.publish': { profileId: 'profile-fixture', captureId: 'capture-fixture', sourceTotals: { provenance: 'independent-source-report', reportId: 'report-fixture', sha256: 'a'.repeat(64), domainHash: 'b'.repeat(64), company: 'Fixture Company', dataset: 'sales', currency: 'INR', rowCount: 1, amountMinor: '900719925474099301', observedAt: '2026-10-01T00:00:00.000Z', snapshotId: null } },
  'connectors.ready': { profileId: 'profile-fixture' },
  'connectors.captureStatus': { profileId: 'profile-fixture', captureId: 'capture-fixture' },
  'connectors.releaseRead': { acquisitionId: 'acquisition-fixture' },
} satisfies { [M in RequestMethod]: DesktopPayload<M> };

test('desktop runtime and TypeScript declaration expose the same unique method tuple', async () => {
  const declaration = await readFile(new URL('../../app/desktop/ipc-contract.d.cts', import.meta.url), 'utf8');
  const tuple = declaration.match(/export const METHODS:\s*readonly\s*(\[[\s\S]*?\]);/);
  assert.ok(tuple, 'The declaration must retain its literal method tuple.');
  assert.deepEqual(JSON.parse(tuple[1]), METHODS);
  assert.equal(new Set(METHODS).size, METHODS.length);
});

test('desktop jobs and connectors whitelist covers exactly the actual dispatch methods', async () => {
  const [engine, connectors] = await Promise.all([
    readFile(new URL('../runtime/engine.ts', import.meta.url), 'utf8'),
    readFile(new URL('../runtime/engine-connectors.ts', import.meta.url), 'utf8'),
  ]);
  for (const [namespace, source] of [['jobs', engine], ['connectors', connectors]]) {
    const dispatched = [...source.matchAll(/case '([^']+)':/g)].map(match => match[1]).filter(method => method.startsWith(`${namespace}.`));
    assert.ok(dispatched.length > 0, `${namespace} needs real dispatcher cases.`);
    assert.deepEqual(METHODS.filter((method: string) => method.startsWith(`${namespace}.`)).sort(), [...new Set(dispatched)].sort());
  }
  for (const method of [...addedJobMethods, ...calendarMethods, ...connectorMethods]) assert.ok(METHODS.includes(method), `${method} must reach the engine.`);
});

test('desktop forwards new connector and job payloads without changing JSON values', () => {
  for (const [method, payload] of Object.entries(requests)) {
    const forwarded = validateRequest({ method, payload });
    assert.deepEqual(forwarded, { method, payload });
    assert.notEqual(forwarded.payload, payload, 'The forwarded request is an independent JSON value.');
  }
  assert.deepEqual(validateRequest({ method: 'connectors.profiles' }), { method: 'connectors.profiles', payload: {} });
  assert.deepEqual(validateRequest({ method: 'jobs.types' }), { method: 'jobs.types', payload: {} });
  assert.deepEqual(validateRequest({ method: 'sources.groups' }), { method: 'sources.groups', payload: {} });
});

test('desktop retains legacy source requests and refuses invented connector or job methods', async () => {
  const engine = await readFile(new URL('../runtime/engine.ts', import.meta.url), 'utf8');
  const sourceMethods = [...engine.matchAll(/case '(sources\.[^']+)':/g)].map(match => match[1]);
  assert.ok(sourceMethods.length >= 11);
  assert.ok(sourceMethods.includes('sources.groups'), 'The planned family catalogue must be publicly dispatched.');
  assert.deepEqual(METHODS.filter((method: string) => method.startsWith('sources.')).sort(), [...new Set(sourceMethods)].sort());
  for (const method of sourceMethods) assert.deepEqual(validateRequest({ method, payload: {} }), { method, payload: {} });
  for (const method of ['connectors.install', 'connectors.readBytes', 'jobs.executePlan', 'jobs.calendar.installRules']) {
    assert.throws(() => validateRequest({ method, payload: {} }), (error: any) => error.code === 'INVALID_REQUEST');
  }
});

test('desktop forwards the nine onboarding draft methods, right after venture.preview, in the contract order', async () => {
  const { DRAFT_METHODS } = await import('../runtime/venture/contracts.ts');
  const at = METHODS.indexOf('venture.preview');
  assert.deepEqual(METHODS.slice(at + 1, at + 1 + DRAFT_METHODS.length), [...DRAFT_METHODS]);
  const declared = await readFile(new URL('../../app/desktop/ipc-contract.d.cts', import.meta.url), 'utf8');
  const typed = JSON.parse(/METHODS: readonly (\[[^\]]+\])/.exec(declared)?.[1] ?? '[]');
  assert.deepEqual(typed, [...METHODS], 'the declaration file lists the same methods in the same order');
  for (const method of DRAFT_METHODS) assert.deepEqual(validateRequest({ method, payload: {} }), { method, payload: {} });
});

test('desktop forwards the eleven custody methods, right after workspace.delete, in the contract order', async () => {
  const { CUSTODY_METHODS } = await import('../runtime/workspace-custody-contracts.ts');
  assert.equal(CUSTODY_METHODS.length, 11); // 4J6 added workspace.custody.neverContactReset
  const at = METHODS.indexOf('workspace.delete');
  assert.deepEqual(METHODS.slice(at + 1, at + 1 + CUSTODY_METHODS.length), [...CUSTODY_METHODS]);
  const declared = await readFile(new URL('../../app/desktop/ipc-contract.d.cts', import.meta.url), 'utf8');
  const typed = JSON.parse(/METHODS: readonly (\[[^\]]+\])/.exec(declared)?.[1] ?? '[]');
  assert.deepEqual(typed, [...METHODS], 'the declaration file lists the same methods in the same order');
  for (const method of CUSTODY_METHODS) assert.deepEqual(validateRequest({ method, payload: {} }), { method, payload: {} });
});
