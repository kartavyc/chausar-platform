import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ConnectorCapabilityRegistry } from '../runtime/connector-framework/registry.ts';
import type { ConnectorCapability, ConnectorOperationScope } from '../runtime/connector-framework/registry.ts';
import { ConnectorReadDispatcher, ConnectorReadError, ReadTransportError } from '../runtime/connector-framework/read.ts';
import type { ConnectorReadAdapter, ConnectorReadRequest, RawSourcePage, ReadAuthorization, ReadClock, ReadContinuation, ReadTransportContext } from '../runtime/connector-framework/read.ts';

const NOW = Date.parse('2026-10-01T00:00:00.000Z');
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const authority = { tenantId: 'tenant-a', sourceId: 'selected-source', organizationId: 'org-a', companyId: 'company-a' };
const operation: ConnectorOperationScope = { connectorId: 'synthetic-contract', connectorVersion: '1.0.0', operationId: 'read-ledger', kind: 'read', transport: 'api',
  applicability: { applicationVersion: '1.0', edition: 'fixture', module: 'ledger', configuration: 'reviewed-fixture', deploymentProfile: 'synthetic' } };
const capabilities: ConnectorCapability[] = ['authentication-expiry', 'raw-provenance', 'coverage', 'freshness', 'pagination', 'rate-limit-backoff'];
function registry(scope = operation, claimed = capabilities) {
  return new ConnectorCapabilityRegistry([{ scope, implemented: true, capabilities: claimed, evidenceIds: ['fixture-read'], limitations: ['Synthetic contracts only.'] }], [{
    id: 'fixture-read', scope, assertions: ['operation', ...claimed], observedAt: '2026-09-30T00:00:00.000Z', expiresAt: '2026-10-02T00:00:00.000Z',
    artifact: { sha256: hash('read-contract-fixture'), reference: 'platform/tests/connector-read-contracts.test.ts' }, notes: [], environment: 'synthetic',
    provenance: { kind: 'synthetic-fixture', generatorVersion: '1' },
  }]);
}
class FakeClock implements ReadClock {
  value = NOW;
  waits: number[] = [];
  timers = new Map<number, { at: number; callback: () => void }>();
  sequence = 0;
  nowMs = () => this.value;
  setTimer = (callback: () => void, ms: number) => {
    const id = ++this.sequence; this.timers.set(id, { at: this.value + ms, callback }); return () => { this.timers.delete(id); };
  };
  sleep = async (ms: number, signal?: AbortSignal) => { if (signal?.aborted) throw new ReadTransportError('cancelled'); this.waits.push(ms); this.advance(ms); };
  advance(ms: number) { this.value += ms; for (const [id, timer] of [...this.timers]) if (timer.at <= this.value) { this.timers.delete(id); timer.callback(); } }
}
function page(text = '{"amount":"9007199254740993.25"}', continuation: ReadContinuation = { kind: 'complete' }, options: Partial<RawSourcePage> = {}): RawSourcePage {
  return { content: Buffer.from(text), contentType: 'application/json', schemaFingerprint: hash('fixture-schema-v1'), rowCount: 1, continuation,
    source: { reportReference: null, generatedAtMs: null, snapshotId: null, completeness: 'unknown', totalRows: null }, ...options };
}
function fixture(readPage: ConnectorReadAdapter['readPage'], options: { scope?: ConnectorOperationScope; clock?: FakeClock; authorize?: () => Promise<ReadAuthorization>; registry?: ConnectorCapabilityRegistry; adapter?: Partial<ConnectorReadAdapter> } = {}) {
  const clock = options.clock ?? new FakeClock(), scope = options.scope ?? operation;
  const adapter: ConnectorReadAdapter = { operation: scope, environment: 'synthetic', sideEffects: 'none', retrySafety: 'idempotent-read', retryOwner: 'dispatcher',
    mode: 'api', requiredAuthScopes: ['ledger.read'], pagination: { kind: 'token' }, readPage, ...options.adapter } as ConnectorReadAdapter;
  const guard = options.authorize ?? (async () => ({ scope: authority, authorityRevision: 'revision-1', grantedScopes: ['ledger.read'], expiresAtMs: clock.value + 100_000, credentialReference: 'private-broker-reference' }));
  return { clock, adapter, dispatcher: new ConnectorReadDispatcher({ registry: options.registry ?? registry(scope), authorize: guard, clock }),
    request: { operation: scope, authority, environment: 'synthetic' } as ConnectorReadRequest };
}
const code = (expected: string) => (error: unknown) => {
  assert.ok(error instanceof ConnectorReadError); assert.equal(error.code, expected); assert.equal(error.receipt.outcome, 'refused'); return true;
};
const undeliveredBytes = (error: unknown, expected: string, receivedBytes: number) => {
  code(expected)(error); assert.ok(error instanceof ConnectorReadError);
  const { requests, pages, rows, bytes, discardedBytes, transportBytes, contentHashes } = error.receipt;
  assert.deepEqual({ requests, pages, rows, bytes, discardedBytes, transportBytes, contentHashes },
    { requests: 1, pages: 0, rows: 0, bytes: 0, discardedBytes: receivedBytes, transportBytes: receivedBytes, contentHashes: [] });
  return true;
};

test('qualified synthetic API read captures raw lexical numbers, provenance and complete bounded pagination', async () => {
  const source = { reportReference: 'separate-source-report', generatedAtMs: NOW - 100, snapshotId: 'source-snapshot', completeness: 'reported-complete' as const, totalRows: 2 };
  const privateCursor = 'PRIVATE-OPAQUE-CURSOR', calls: Array<{ cursor: unknown; context: ReadTransportContext }> = [];
  const input = fixture(async (request, context) => { calls.push({ cursor: request.cursor, context }); return page(undefined,
    request.cursor === null ? { kind: 'more', next: { kind: 'token', token: privateCursor } } : { kind: 'complete' }, { source }); });
  const result = await input.dispatcher.read(input.request, input.adapter);
  assert.equal(calls.length, 2); assert.equal(calls[0].cursor, null); assert.deepEqual(calls[1].cursor, { kind: 'token', token: privateCursor });
  assert.ok(calls.every(call => call.context.retryOwner === 'dispatcher' && call.context.timeoutMs === 15_000 && call.context.maxBytes === 4 * 1024 * 1024));
  assert.equal(Buffer.from(result.pages[0].content).toString(), '{"amount":"9007199254740993.25"}');
  assert.equal(result.pages[0].provenance.contentSha256, hash(result.pages[0].content));
  assert.deepEqual(result.completeness, { pagination: 'complete', source: 'reported-complete', expectedRows: 2, actualRows: 2, sourceTotalMatches: true,
    snapshot: 'same-declared-snapshot', independentReconciliation: 'required' });
  assert.equal(result.freshness.state, 'current'); assert.equal(result.receipt.environment, 'synthetic'); assert.equal(input.clock.timers.size, 0);
  assert.equal(result.receipt.qualification!.definitionDigest.length, 64); assert.deepEqual(result.receipt.qualification!.evidenceIds, ['fixture-read']);
  assert.ok(!JSON.stringify(result.receipt).includes(privateCursor)); assert.ok(!JSON.stringify(result.receipt).includes('private-broker-reference'));
});

test('missing source totals and times remain unknown; stale and future timestamps stay distinct', async () => {
  const input = fixture(async () => page()); const missing = await input.dispatcher.read(input.request, input.adapter);
  assert.equal(missing.completeness.expectedRows, null); assert.equal(missing.completeness.sourceTotalMatches, null);
  assert.equal(missing.completeness.source, 'unknown'); assert.equal(missing.completeness.snapshot, 'unverified');
  assert.equal(missing.freshness.oldestSourceGeneratedAtMs, null); assert.equal(missing.freshness.state, 'unknown');
  for (const [generatedAtMs, state, reason] of [[NOW - 101, 'stale', 'older-than-policy'], [NOW + 1, 'unknown', 'source-clock-ahead']] as const) {
    const dated = fixture(async () => page(undefined, undefined, { source: { ...page().source, generatedAtMs } }));
    const result = await dated.dispatcher.read({ ...dated.request, maximumSourceAgeMs: 100 }, dated.adapter);
    assert.equal(result.freshness.state, state); assert.equal(result.freshness.reason, reason);
  }
});

test('file export and operator guided export are separately qualified operation interfaces', async () => {
  for (const mode of ['export', 'guided-export'] as const) {
    const scope = { ...operation, kind: mode, transport: mode === 'export' ? 'file' as const : 'guided-ui' as const };
    const input = fixture(async () => page(), { scope, adapter: { mode, pagination: { kind: 'none' }, retrySafety: 'single-attempt',
      ...(mode === 'guided-export' ? { instructionsReference: 'reviewed-operator-guide' } : {}) } });
    assert.equal((await input.dispatcher.read(input.request, input.adapter)).receipt.pages, 1);
  }
});

test('registry evidence, exact applicability and execution environment gate every read before transport', async () => {
  let called = 0;
  for (const customRegistry of [new ConnectorCapabilityRegistry(), registry(operation, capabilities.filter(cap => cap !== 'authentication-expiry'))]) {
    const input = fixture(async () => { called++; return page(); }, { registry: customRegistry });
    await assert.rejects(input.dispatcher.read(input.request, input.adapter), code('READ_CAPABILITY_UNQUALIFIED'));
  }
  const mismatch = fixture(async () => { called++; return page(); });
  await assert.rejects(mismatch.dispatcher.read({ ...mismatch.request, operation: { ...operation, applicability: { ...operation.applicability, edition: 'other' } } }, mismatch.adapter), code('READ_OPERATION_MISMATCH'));
  const liveAdapter = { ...mismatch.adapter, environment: 'live' as const };
  await assert.rejects(mismatch.dispatcher.read({ ...mismatch.request, environment: 'live' }, liveAdapter), code('READ_CAPABILITY_UNQUALIFIED'));
  assert.equal(called, 0);
});

test('wrong source/tenant, missing auth scope and expired auth fail closed before any read', async () => {
  let called = 0;
  const base = { scope: authority, authorityRevision: 'revision-1', grantedScopes: ['ledger.read'], expiresAtMs: NOW + 100, credentialReference: null };
  for (const [authorization, expected] of [
    [{ ...base, scope: { ...authority, tenantId: 'other' } }, 'READ_AUTHORIZATION_SCOPE_MISMATCH'],
    [{ ...base, scope: { ...authority, sourceId: 'other' } }, 'READ_AUTHORIZATION_SCOPE_MISMATCH'],
    [{ ...base, grantedScopes: [] }, 'READ_AUTHORIZATION_SCOPE_MISSING'],
    [{ ...base, expiresAtMs: NOW }, 'READ_AUTHENTICATION_EXPIRED'],
  ] as const) {
    const input = fixture(async () => { called++; return page(); }, { authorize: async () => authorization as ReadAuthorization });
    await assert.rejects(input.dispatcher.read(input.request, input.adapter), code(expected));
  }
  assert.equal(called, 0);
});

test('authority revocation or expiry during transport prevents content delivery and accounts discarded bytes', async t => {
  for (const change of ['revision', 'scopes', 'expiry'] as const) {
    await t.test(change, async () => {
      const clock = new FakeClock(); let revision = 'revision-1', grantedScopes = ['ledger.read'];
      const content = 'SECRET-RAW-DATA';
      const input = fixture(async () => {
        if (change === 'expiry') clock.advance(101);
        else if (change === 'scopes') grantedScopes = [];
        else revision = 'revision-2';
        return page(content);
      }, { clock, authorize: async () => ({ scope: authority, authorityRevision: revision, grantedScopes, expiresAtMs: NOW + 100, credentialReference: null }) });
      await assert.rejects(input.dispatcher.read(input.request, input.adapter), error => {
        const expected = change === 'expiry' ? 'READ_AUTHENTICATION_EXPIRED' : change === 'scopes' ? 'READ_AUTHORIZATION_SCOPE_MISSING' : 'READ_AUTHORITY_CHANGED';
        undeliveredBytes(error, expected, Buffer.byteLength(content));
        assert.ok(error instanceof ConnectorReadError); assert.equal(error.receipt.attempts[0].outcome, 'succeeded');
        assert.ok(!JSON.stringify(error.receipt).includes(content)); return true;
      });
      assert.equal(clock.timers.size, 0);
    });
  }
});

test('registry evidence revoked during transport refuses delivery and accounts discarded raw bytes', async () => {
  const capabilityRegistry = registry(), returned = page();
  const input = fixture(async () => { capabilityRegistry.revokeEvidence('fixture-read', new Date(NOW).toISOString(), 'Contract revocation.'); return returned; }, { registry: capabilityRegistry });
  await assert.rejects(input.dispatcher.read(input.request, input.adapter), error => undeliveredBytes(error, 'READ_CAPABILITY_UNQUALIFIED', returned.content.byteLength));
});

test('a refused later page preserves earlier captured counts and charges only the new discarded bytes', async () => {
  let revision = 'revision-1';
  const first = page('accepted-page', { kind: 'more', next: { kind: 'token', token: 'second-page' } }), second = page('refused-page');
  const input = fixture(async request => {
    if (request.cursor === null) return first;
    revision = 'revision-2'; return second;
  }, { authorize: async () => ({ scope: authority, authorityRevision: revision, grantedScopes: ['ledger.read'], expiresAtMs: NOW + 100_000, credentialReference: null }) });
  const totalBytes = first.content.byteLength + second.content.byteLength;
  await assert.rejects(input.dispatcher.read({ ...input.request, limits: { pageBytes: totalBytes, totalBytes } }, input.adapter), error => {
    code('READ_AUTHORITY_CHANGED')(error); assert.ok(error instanceof ConnectorReadError);
    const { requests, pages, rows, bytes, discardedBytes, transportBytes, contentHashes } = error.receipt;
    assert.deepEqual({ requests, pages, rows, bytes, discardedBytes, transportBytes, contentHashes },
      { requests: 2, pages: 1, rows: 1, bytes: first.content.byteLength, discardedBytes: second.content.byteLength,
        transportBytes: totalBytes, contentHashes: [hash(first.content)] });
    assert.deepEqual(error.receipt.attempts.map(attempt => attempt.outcome), ['succeeded', 'succeeded']);
    assert.ok(!JSON.stringify(error.receipt).includes('refused-page')); return true;
  });
});

test('known transport failure bytes remain accounted when post-attempt authority checks refuse retry', async t => {
  for (const change of ['revision', 'scopes', 'expiry', 'evidence'] as const) {
    await t.test(change, async () => {
      const clock = new FakeClock(), capabilityRegistry = registry(); let revision = 'revision-1', grantedScopes = ['ledger.read'], calls = 0;
      const input = fixture(async () => {
        calls++;
        if (change === 'expiry') clock.advance(101);
        else if (change === 'scopes') grantedScopes = [];
        else if (change === 'evidence') capabilityRegistry.revokeEvidence('fixture-read', new Date(NOW).toISOString(), 'Contract revocation.');
        else revision = 'revision-2';
        throw new ReadTransportError('rate-limited', 0, 'settled', 40);
      }, { clock, registry: capabilityRegistry,
        authorize: async () => ({ scope: authority, authorityRevision: revision, grantedScopes, expiresAtMs: NOW + 100, credentialReference: null }) });
      await assert.rejects(input.dispatcher.read({ ...input.request, retry: { maxAttemptsPerPage: 3 } }, input.adapter), error => {
        const expected = change === 'expiry' ? 'READ_AUTHENTICATION_EXPIRED' : change === 'scopes' ? 'READ_AUTHORIZATION_SCOPE_MISSING'
          : change === 'evidence' ? 'READ_CAPABILITY_UNQUALIFIED' : 'READ_AUTHORITY_CHANGED';
        undeliveredBytes(error, expected, 40); assert.ok(error instanceof ConnectorReadError);
        assert.equal(error.receipt.attempts[0].outcome, 'rate-limited'); assert.equal(error.receipt.attempts[0].delayBeforeNextMs, null); return true;
      });
      assert.equal(calls, 1); assert.deepEqual(clock.waits, []); assert.equal(clock.timers.size, 0);
    });
  }
});

test('known idempotent transient failures use deterministic exponential backoff and provider retry floors', async () => {
  let calls = 0;
  const input = fixture(async () => { calls++; if (calls === 1) throw new ReadTransportError('rate-limited', 750); if (calls === 2) throw new ReadTransportError('temporarily-unavailable'); return page(); });
  const result = await input.dispatcher.read({ ...input.request, retry: { maxAttemptsPerPage: 3 } }, input.adapter);
  assert.equal(calls, 3); assert.deepEqual(input.clock.waits, [750, 500]); assert.equal(result.receipt.finishedAtMs - result.receipt.startedAtMs, 1_250);
  assert.deepEqual(result.receipt.attempts.map(attempt => [attempt.outcome, attempt.delayBeforeNextMs]), [['rate-limited', 750], ['temporarily-unavailable', 500], ['succeeded', null]]);
});

test('permanent or unclassified errors never retry and secret transport messages stay out of receipts', async () => {
  for (const error of [new ReadTransportError('authentication-expired'), new ReadTransportError('permission-denied'), new ReadTransportError('invalid-request'), new Error('PRIVATE-TOKEN')]) {
    let calls = 0; const input = fixture(async () => { calls++; throw error; });
    await assert.rejects(input.dispatcher.read({ ...input.request, retry: { maxAttemptsPerPage: 5 } }, input.adapter), refused => {
      assert.ok(refused instanceof ConnectorReadError); assert.equal(refused.receipt.requests, 1); assert.ok(!JSON.stringify(refused.receipt).includes('PRIVATE-TOKEN')); return true;
    });
    assert.equal(calls, 1); assert.deepEqual(input.clock.waits, []);
  }
});

test('default single attempt, unqualified retries, excessive Retry-After and retry budgets never resubmit early', async () => {
  let calls = 0; const input = fixture(async () => { calls++; throw new ReadTransportError('rate-limited', 11_000); });
  await assert.rejects(input.dispatcher.read(input.request, input.adapter), code('READ_TRANSPORT_RATE_LIMITED'));
  await assert.rejects(input.dispatcher.read({ ...input.request, retry: { maxAttemptsPerPage: 2 } }, { ...input.adapter, retrySafety: 'single-attempt' }), code('READ_RETRY_UNQUALIFIED'));
  await assert.rejects(input.dispatcher.read({ ...input.request, retry: { maxAttemptsPerPage: 2 } }, input.adapter), code('READ_RETRY_AFTER_REFUSED'));
  assert.equal(calls, 2); assert.deepEqual(input.clock.waits, []);
  const budget = fixture(async () => { throw new ReadTransportError('temporarily-unavailable'); });
  await assert.rejects(budget.dispatcher.read({ ...budget.request, retry: { maxAttemptsPerPage: 2, maxTotalDelayMs: 100 } }, budget.adapter), code('READ_RETRY_BUDGET_EXCEEDED'));
});

test('retry sleep is followed by authority and expiry checks before the next transport', async () => {
  let calls = 0; const clock = new FakeClock();
  const input = fixture(async () => { calls++; throw new ReadTransportError('temporarily-unavailable'); }, { clock,
    authorize: async () => ({ scope: authority, authorityRevision: 'revision-1', grantedScopes: ['ledger.read'], expiresAtMs: NOW + 200, credentialReference: null }) });
  await assert.rejects(input.dispatcher.read({ ...input.request, retry: { maxAttemptsPerPage: 2 } }, input.adapter), code('READ_AUTHENTICATION_EXPIRED'));
  assert.equal(calls, 1); assert.deepEqual(clock.waits, [250]);
});

test('page timeout aborts the transport, accounts the attempt and ignores its late result', async () => {
  const clock = new FakeClock(); let signal: AbortSignal | undefined;
  const input = fixture(async (_request, context) => { signal = context.signal; clock.advance(context.timeoutMs); return page('LATE-RESPONSE'); }, { clock });
  await assert.rejects(input.dispatcher.read({ ...input.request, limits: { pageTimeoutMs: 10 } }, input.adapter), error => {
    code('READ_TRANSPORT_TIMED_OUT')(error); assert.ok(error instanceof ConnectorReadError); assert.equal(error.receipt.cleanup, 'abort-requested');
    assert.equal(error.receipt.pages, 0); assert.equal(error.receipt.requests, 1); assert.ok(!JSON.stringify(error.receipt).includes('LATE-RESPONSE')); return true;
  });
  assert.equal(signal!.aborted, true); assert.equal(clock.timers.size, 0);
});

test('overall deadline and caller cancellation refuse delivery and do not imply source effects', async () => {
  const clock = new FakeClock(); const deadline = fixture(async (_request, context) => { clock.advance(context.timeoutMs); return page(); }, { clock });
  await assert.rejects(deadline.dispatcher.read({ ...deadline.request, limits: { totalTimeoutMs: 10, pageTimeoutMs: 10 } }, deadline.adapter), code('READ_DEADLINE_EXCEEDED'));
  const controller = new AbortController(); let calls = 0;
  const cancelled = fixture(async () => { calls++; controller.abort(); return page(); });
  await assert.rejects(cancelled.dispatcher.read({ ...cancelled.request, signal: controller.signal }, cancelled.adapter), code('READ_CANCELLED'));
  await assert.rejects(cancelled.dispatcher.read({ ...cancelled.request, signal: controller.signal }, cancelled.adapter), code('READ_CANCELLED'));
  assert.equal(calls, 1);
});

test('hard page/request/row/byte bounds never publish a truncated successful read', async () => {
  for (const [limits, makePage, expected] of [
    [{ maxPages: 1 }, () => page(undefined, { kind: 'more', next: { kind: 'token', token: 'next' } }), 'READ_PAGE_LIMIT'],
    [{ maxRequests: 1 }, () => page(undefined, { kind: 'more', next: { kind: 'token', token: 'next' } }), 'READ_REQUEST_LIMIT'],
    [{ maxRows: 1 }, () => page(undefined, undefined, { rowCount: 2 }), 'READ_PAGE_INVALID'],
    [{ pageBytes: 1 }, () => page(), 'READ_BYTE_LIMIT'],
  ] as const) {
    const input = fixture(async () => makePage()); await assert.rejects(input.dispatcher.read({ ...input.request, limits }, input.adapter), code(expected));
  }
});

test('opaque cursor loops, wrong cursor types and empty continuing pages are refused', async () => {
  for (const [makePage, expected] of [
    [() => page(undefined, { kind: 'more', next: { kind: 'token', token: 'repeat' } }), 'READ_PAGINATION_LOOP'],
    [() => page(undefined, { kind: 'more', next: { kind: 'page', page: 2 } }), 'READ_PAGINATION_INVALID'],
    [() => page(undefined, { kind: 'more', next: { kind: 'token', token: 'next' } }, { rowCount: 0 }), 'READ_PAGINATION_INVALID'],
  ] as const) {
    const input = fixture(async () => makePage()); await assert.rejects(input.dispatcher.read(input.request, input.adapter), code(expected));
  }
});

test('source-total and snapshot inconsistency fail; schema drift remains explicit for import quarantine', async () => {
  for (const property of ['totalRows', 'snapshotId', 'schemaFingerprint'] as const) {
    let calls = 0;
    const input = fixture(async () => { calls++; return page(undefined, calls === 1 ? { kind: 'more', next: { kind: 'token', token: 'next' } } : { kind: 'complete' }, {
      schemaFingerprint: hash(property === 'schemaFingerprint' ? `schema-${calls}` : 'schema'),
      source: { ...page().source, totalRows: property === 'totalRows' ? calls : 2, snapshotId: property === 'snapshotId' ? `snapshot-${calls}` : 'snapshot' },
    }); });
    if (property === 'schemaFingerprint') { const result = await input.dispatcher.read(input.request, input.adapter); assert.equal(result.schema.state, 'changed'); assert.equal(result.schema.fingerprints.length, 2); }
    else await assert.rejects(input.dispatcher.read(input.request, input.adapter), code(property === 'totalRows' ? 'READ_SOURCE_TOTAL_CHANGED' : 'READ_SOURCE_SNAPSHOT_CHANGED'));
  }
  const mismatch = fixture(async () => page(undefined, undefined, { source: { ...page().source, totalRows: 2 } }));
  await assert.rejects(mismatch.dispatcher.read(mismatch.request, mismatch.adapter), code('READ_SOURCE_TOTAL_MISMATCH'));
  const partial = fixture(async () => page(undefined, undefined, { source: { ...page().source, completeness: 'reported-partial' } }));
  await assert.rejects(partial.dispatcher.read(partial.request, partial.adapter), code('READ_SOURCE_INCOMPLETE'));
});

test('operator and adapter inputs cannot silently increase budgets or claim nested retry ownership', async () => {
  let calls = 0; const input = fixture(async () => { calls++; return page(); });
  await assert.rejects(input.dispatcher.read({ ...input.request, limits: { totalTimeoutMs: 60_001 } }, input.adapter), code('READ_LIMIT_INVALID'));
  await assert.rejects(input.dispatcher.read(input.request, { ...input.adapter, retryOwner: 'sdk' } as unknown as ConnectorReadAdapter), code('READ_CAPABILITY_REQUIRED'));
  assert.equal(calls, 0);
});

test('a slow authorization dependency is bounded and aborted before transport can start', async () => {
  const clock = new FakeClock(); let calls = 0, signal: AbortSignal | undefined;
  const input = fixture(async () => { calls++; return page(); }, { clock });
  const dispatcher = new ConnectorReadDispatcher({ registry: registry(), clock, authorize: async (_scope, _scopes, context) => {
    signal = context.signal; clock.advance(10); return { scope: authority, authorityRevision: 'revision-1', grantedScopes: ['ledger.read'], expiresAtMs: NOW + 100_000, credentialReference: null };
  } });
  await assert.rejects(dispatcher.read({ ...input.request, limits: { pageTimeoutMs: 10 } }, input.adapter), code('READ_AUTHORIZATION_TIMEOUT'));
  assert.equal(signal!.aborted, true); assert.equal(calls, 0); assert.equal(clock.timers.size, 0);
});

test('unreviewed metadata, oversized report references and source-provided URL cursor fields are refused', async () => {
  for (const raw of [
    { ...page(), source: { ...page().source, unreviewedMetadata: 'extra' } },
    { ...page(), source: { ...page().source, reportReference: 'x'.repeat(1_001) } },
    { ...page(), source: { ...page().source, snapshotId: 'x'.repeat(201) } },
    { ...page(), continuation: { kind: 'more', next: { kind: 'token', token: 'next', url: 'https://unreviewed.invalid' } } },
  ]) {
    const input = fixture(async () => raw as RawSourcePage);
    await assert.rejects(input.dispatcher.read(input.request, input.adapter), error => {
      assert.ok(error instanceof ConnectorReadError); assert.equal(error.receipt.pages, 0); return true;
    });
  }
});

test('an unacknowledged timeout cannot start another request even under an idempotent retry policy', async () => {
  const clock = new FakeClock(); let calls = 0;
  const input = fixture(async (_request, context) => { calls++; clock.advance(context.timeoutMs); return page(); }, { clock });
  await assert.rejects(input.dispatcher.read({ ...input.request, limits: { pageTimeoutMs: 10 }, retry: { maxAttemptsPerPage: 2 } }, input.adapter), code('READ_TRANSPORT_TIMEOUT_UNSETTLED'));
  assert.equal(calls, 1); assert.deepEqual(clock.waits, []);
});

test('changing a credential broker reference requires a fresh authorization-bound read', async () => {
  let reference = 'ref-a';
  const input = fixture(async () => { reference = 'ref-b'; return page(); }, { authorize: async () => ({ scope: authority, authorityRevision: 'revision-1', grantedScopes: ['ledger.read'], expiresAtMs: NOW + 100_000, credentialReference: reference }) });
  await assert.rejects(input.dispatcher.read(input.request, input.adapter), code('READ_CREDENTIAL_CHANGED'));
});

test('discarded retry payloads consume the total byte budget and remain separate from captured bytes', async () => {
  let calls = 0;
  const input = fixture(async (_request, context) => {
    calls++; if (calls === 1) throw new ReadTransportError('rate-limited', 0, 'settled', 40);
    assert.equal(context.maxBytes, 60); return page('x'.repeat(50));
  });
  const request = { ...input.request, limits: { pageBytes: 100, totalBytes: 100 }, retry: { maxAttemptsPerPage: 2 } };
  const result = await input.dispatcher.read(request, input.adapter);
  assert.equal(result.receipt.bytes, 50); assert.equal(result.receipt.discardedBytes, 40); assert.equal(result.receipt.transportBytes, 90);
  calls = 0;
  const excess = { ...input.adapter, readPage: async () => { calls++; if (calls === 1) throw new ReadTransportError('rate-limited', 0, 'settled', 40); return page('x'.repeat(61)); } };
  await assert.rejects(input.dispatcher.read(request, excess), error => {
    code('READ_BYTE_LIMIT')(error); assert.ok(error instanceof ConnectorReadError);
    assert.equal(error.receipt.requests, 2); assert.equal(error.receipt.attempts.length, 2); return true;
  }); assert.equal(calls, 2);
});

test('retried failure payloads and the admitted page each count once at the exact total byte budget', async () => {
  const maxBytes: number[] = [];
  const input = fixture(async (_request, context) => {
    maxBytes.push(context.maxBytes);
    if (context.attempt === 1) throw new ReadTransportError('rate-limited', 0, 'settled', 40);
    if (context.attempt === 2) throw new ReadTransportError('temporarily-unavailable', null, 'settled', 10);
    return page('x'.repeat(50));
  });
  const result = await input.dispatcher.read({ ...input.request, limits: { pageBytes: 100, totalBytes: 100 }, retry: { maxAttemptsPerPage: 3 } }, input.adapter);
  assert.deepEqual(maxBytes, [100, 60, 50]);
  const { requests, pages, rows, bytes, discardedBytes, transportBytes, contentHashes } = result.receipt;
  assert.deepEqual({ requests, pages, rows, bytes, discardedBytes, transportBytes, contentHashes },
    { requests: 3, pages: 1, rows: 1, bytes: 50, discardedBytes: 50, transportBytes: 100, contentHashes: [hash('x'.repeat(50))] });
  assert.equal(result.pages.length, 1); assert.equal(result.pages[0].content.byteLength, 50);
});
