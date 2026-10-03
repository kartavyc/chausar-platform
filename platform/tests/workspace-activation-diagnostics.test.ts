import assert from 'node:assert/strict';
import test from 'node:test';
import { ChausarError } from '../runtime/contracts.ts';
import { WorkspaceImportCandidateService } from '../runtime/workspace-import-candidate.ts';
import { canonicalInterchangeJson, captureWorkspaceInterchange, interchangeDigest } from '../runtime/workspace-interchange.ts';
import { WorkspaceActivationHost, workspaceActivationDiagnosticErrorCode, type AuthenticatedActivationCandidate, type WorkspaceActivationCommit,
  type WorkspaceActivationDiagnostic, type WorkspaceActivationDiagnosticOptions, type WorkspaceActivationPolicy,
  type WorkspaceActivationPorts, type WorkspaceActivationReadback } from '../runtime/workspace-activation.ts';
import { artifactsFor, deterministicShopState, emptyTarget, fixedTime, interchangeOwner } from './fixtures/workspace-interchange-fixture.ts';

// Explicit injected orchestration fixtures only: no native SQL, Vault, filesystem publication or provider.
const secret = 'SYNTHETIC_DIAGNOSTIC_PRIVATE_MESSAGE_84732';
const isCode = (code: string) => (error: unknown) => error instanceof ChausarError && error.code === code;
const policy: WorkspaceActivationPolicy = { approvedSyntheticWorkspaceIds: ['workspace_synthetic_source'], allowedSyntheticSourceIds: ['demo-export'],
  budgets: { maxCandidateBytes: 8_000_000, maxArtifactBytes: 1_000_000, maxArtifacts: 64, maxFacts: 1000, maxRecords: 10_000 }, retentionDays: 90 };

function fixture(diagnostics?: WorkspaceActivationDiagnosticOptions) {
  const state = deterministicShopState(), target = emptyTarget(), artifacts = artifactsFor(state);
  const capture = captureWorkspaceInterchange(state, artifacts);
  const candidate = new WorkspaceImportCandidateService({ source: () => ({ ready: true, inventory: capture.inventory }),
    target: () => target, assertCompleteRead: () => {} }).prepare(interchangeOwner,
    { text: canonicalInterchangeJson(capture.package), targetId: target.targetId });
  const issued: AuthenticatedActivationCandidate = { content: canonicalInterchangeJson(candidate),
    pin: { format: 'chausar.interchange-custody-pin.v1', kind: 'candidate', recordId: 'candidate_fixture', creationId: 'creation_fixture',
      contextDigest: interchangeDigest(interchangeOwner), inventory: capture.inventory, packageDigest: candidate.packageDigest,
      candidateDigest: interchangeDigest(candidate), target },
    measurement: { encrypted: true, archiveCiphertextBytes: 1, inventoryPinCiphertextBytes: 1, qualification: 'test-fixture' } };
  const faults: { prePublication?: unknown; commitBefore?: unknown; commitAfter?: unknown; readback?: unknown; exit?: unknown; unknownReadback?: true } = {};
  const consumed = new Set<string>(); let publication: WorkspaceActivationCommit | undefined, effects = 0, allocations = 0;
  const readback = (): WorkspaceActivationReadback => publication && !faults.unknownReadback
    ? { status: 'committed', encrypted: true, qualification: 'test-fixture', ciphertextBytes: 1, ...structuredClone(publication) }
    : { status: 'unknown', activationId: publication?.record.activationId ?? 'activation_fixture', reasonCode: 'FIXTURE_UNKNOWN' };
  const ports: WorkspaceActivationPorts = { custody: { read: async () => structuredClone(issued) },
    withTransaction: async (_context, _input, work) => {
      let allocated = false;
      const result = await work({ source: { ready: true, state: structuredClone(state), artifacts,
        assertCurrent: async () => {}, assertCompleteOwner: async () => {} }, target: structuredClone(target),
        readCandidate: async () => structuredClone(issued),
        assertCurrent: async () => { if (allocated && Object.hasOwn(faults, 'prePublication')) throw faults.prePublication; },
        allocateAuthority: async () => {
          allocated = true; allocations++;
          return { workspaceId: target.workspaceId,
            owner: { id: 'fresh_diagnostic_owner', name: 'Synthetic diagnostic owner', role: 'owner', active: true, epoch: 1, branches: ['*'] },
            context: { memberId: 'fresh_diagnostic_owner', role: 'owner', epoch: 1, channel: 'desktop' },
            sessionAuthorityId: 'fresh_diagnostic_session', createdAt: fixedTime };
        },
        commit: async value => {
          if (Object.hasOwn(faults, 'commitBefore')) throw faults.commitBefore;
          if (consumed.has(value.record.candidateCreationId)) throw new ChausarError('ACTIVATION_SINGLE_USE', secret);
          consumed.add(value.record.candidateCreationId); publication = structuredClone(value); effects++;
          if (Object.hasOwn(faults, 'commitAfter')) throw faults.commitAfter;
        },
        readback: async () => { if (Object.hasOwn(faults, 'readback')) throw faults.readback; return readback(); },
      });
      if (Object.hasOwn(faults, 'exit')) throw faults.exit;
      return result;
    }, readback: async () => readback() };
  const host = new WorkspaceActivationHost(ports, policy, diagnostics), reviewInput = { candidateId: 'candidate_fixture',
    reviewedDigest: issued.pin.kind === 'candidate' ? issued.pin.candidateDigest : '' };
  return { host, ports, faults, effects: () => effects, allocations: () => allocations,
    async request() { const review = await host.review(interchangeOwner, reviewInput);
      return { ...reviewInput, projectionDigest: review.projectionDigest, activationId: 'activation_fixture', confirmed: true as const }; } };
}

function metadata(events: WorkspaceActivationDiagnostic[]) {
  assert.equal(events.length, 1);
  assert.deepEqual(Object.keys(events[0]).sort(), ['commitAttempted', 'errorCode', 'format', 'observation', 'stage']);
  assert.equal(Object.isFrozen(events[0]), true);
  assert.equal(JSON.stringify(events).includes(secret), false);
  assert.equal(events[0].observation, 'exception');
  return events[0];
}

test('Host pre-publication guard diagnostic proves commit was never called and retains original refusal', async () => {
  const events: WorkspaceActivationDiagnostic[] = [], f = fixture({ onDiagnostic: event => { events.push(event); } });
  const input = await f.request(); f.faults.prePublication = new ChausarError('BACKUP_INVENTORY_INCOMPLETE', secret);
  await assert.rejects(f.host.activate(interchangeOwner, input), isCode('BACKUP_INVENTORY_INCOMPLETE'));
  assert.equal(f.effects(), 0); assert.equal(f.allocations(), 1);
  assert.deepEqual(metadata(events), { format: 'chausar.activation-host-diagnostic.v1', stage: 'pre-publication-guard',
    observation: 'exception', commitAttempted: false, errorCode: 'BACKUP_INVENTORY_INCOMPLETE' });
});

test('Host commit callback failures stay ambiguous both before and after synthetic publication effects', async () => {
  for (const boundary of ['commitBefore', 'commitAfter'] as const) {
    const events: WorkspaceActivationDiagnostic[] = [], f = fixture({ onDiagnostic: event => { events.push(event); } });
    const input = await f.request(); f.faults[boundary] = new ChausarError('BACKUP_INVENTORY_INCOMPLETE', secret);
    await assert.rejects(f.host.activate(interchangeOwner, input), isCode('ACTIVATION_COMMIT_UNKNOWN'));
    assert.equal(f.effects(), boundary === 'commitBefore' ? 0 : 1);
    assert.equal(metadata(events).stage, 'commit-callback'); assert.equal(events[0].commitAttempted, true);
    assert.equal(events[0].errorCode, 'BACKUP_INVENTORY_INCOMPLETE');
    if (boundary === 'commitAfter') {
      delete f.faults.commitAfter;
      assert.equal((await f.host.resolve(interchangeOwner, { activationId: input.activationId })).status, 'committed');
      await assert.rejects(f.host.activate(interchangeOwner, input), isCode('ACTIVATION_COMMIT_UNKNOWN'));
      assert.equal(f.effects(), 1, 'Diagnostics never reopen the consumed candidate.');
    }
  }
});

test('only known own ChausarError codes reach diagnostics; messages, spoofed codes and accessors never do', async () => {
  let getterCalls = 0;
  const accessor = new ChausarError('BACKUP_INVENTORY_INCOMPLETE', secret);
  Object.defineProperty(accessor, 'code', { get() { getterCalls++; throw Error(secret); } });
  for (const error of [Error(secret), new ChausarError(secret, secret), { code: 'BACKUP_INVENTORY_INCOMPLETE', message: secret }, accessor]) {
    const events: WorkspaceActivationDiagnostic[] = [], f = fixture({ onDiagnostic: event => { events.push(event); } });
    const input = await f.request(); f.faults.commitBefore = error;
    await assert.rejects(f.host.activate(interchangeOwner, input), isCode('ACTIVATION_COMMIT_UNKNOWN'));
    assert.equal(metadata(events).errorCode, 'UNCLASSIFIED'); assert.equal(f.effects(), 0);
  }
  assert.equal(getterCalls, 0);
});

test('shared custody diagnostic sanitizer admits only explicit safe codes and refuses hostile error inspection', () => {
  for (const code of ['BACKUP_ACTIVATION_STAGING_UNBOUND', 'BACKUP_ACTIVATION_STAGING_UNRESOLVED', 'BACKUP_ACTIVATION_CUSTODY_CHANGED',
    'BACKUP_ACTIVATION_JOURNAL_CHANGED', 'BACKUP_INVENTORY_INCOMPLETE', 'BACKUP_LIMIT']) {
    assert.equal(workspaceActivationDiagnosticErrorCode(new ChausarError(code, secret)), code);
    assert.equal(workspaceActivationDiagnosticErrorCode({ code, message: secret }), 'UNCLASSIFIED');
  }
  const hostile = new Proxy(new ChausarError('BACKUP_LIMIT', secret), { getPrototypeOf() { throw Error(secret); } });
  assert.equal(workspaceActivationDiagnosticErrorCode(hostile), 'UNCLASSIFIED');
  assert.equal(workspaceActivationDiagnosticErrorCode(new ChausarError(secret, secret)), 'UNCLASSIFIED');
  for (const value of [null, undefined, secret, 123, Symbol(secret)]) assert.equal(workspaceActivationDiagnosticErrorCode(value), 'UNCLASSIFIED');
});

test('diagnostic observer failures and mutation attempts cannot change unknown acknowledgement or explicit readback', async () => {
  for (const observer of [
    (event: WorkspaceActivationDiagnostic) => { assert.equal(Object.isFrozen(event), true); Reflect.set(event, 'errorCode', secret); throw Error(secret); },
    async () => { throw Error(secret); },
    () => true,
    () => Object.defineProperty({}, 'then', { get() { throw Error(secret); } }),
  ]) {
    const f = fixture({ onDiagnostic: observer }), input = await f.request();
    f.faults.commitAfter = new ChausarError('ACTIVATION_POSTGRES_UNRESOLVED', secret);
    await assert.rejects(f.host.activate(interchangeOwner, input), isCode('ACTIVATION_COMMIT_UNKNOWN'));
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(f.effects(), 1);
    assert.equal((await f.host.resolve(interchangeOwner, { activationId: input.activationId })).status, 'committed');
  }
});

test('Host diagnostics distinguish readback execution, readback validation and held transaction exit', async () => {
  for (const boundary of ['readback', 'unknownReadback', 'exit'] as const) {
    const events: WorkspaceActivationDiagnostic[] = [], f = fixture({ onDiagnostic: event => { events.push(event); } });
    const input = await f.request();
    if (boundary === 'unknownReadback') f.faults.unknownReadback = true;
    else f.faults[boundary] = new ChausarError('ACTIVATION_POSTGRES_UNRESOLVED', secret);
    await assert.rejects(f.host.activate(interchangeOwner, input), isCode('ACTIVATION_COMMIT_UNKNOWN'));
    assert.equal(f.effects(), 1);
    assert.equal(metadata(events).stage, { readback: 'immediate-readback', unknownReadback: 'readback-validation', exit: 'transaction-exit' }[boundary]);
    assert.equal(events[0].commitAttempted, true);
  }
});

test('successful activation emits no exception diagnostics and constructor rejects undeclared or getter callbacks', async () => {
  const events: WorkspaceActivationDiagnostic[] = [], f = fixture({ onDiagnostic: event => { events.push(event); } });
  const input = await f.request(); assert.equal((await f.host.activate(interchangeOwner, input)).status, 'committed');
  assert.deepEqual(events, []);
  assert.throws(() => new WorkspaceActivationHost(f.ports, policy, { onDiagnostic() {}, other: secret } as WorkspaceActivationDiagnosticOptions), isCode('ACTIVATION_ROOT_REQUIRED'));
  let invoked = false;
  const getter = Object.defineProperty({}, 'onDiagnostic', { enumerable: true, get() { invoked = true; return () => {}; } });
  assert.throws(() => new WorkspaceActivationHost(f.ports, policy, getter as WorkspaceActivationDiagnosticOptions), isCode('ACTIVATION_ROOT_REQUIRED'));
  assert.equal(invoked, false);
});
