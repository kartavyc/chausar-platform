import test from 'node:test';
import assert from 'node:assert/strict';
import { digest } from '../runtime/actions.ts';
import {
  ConnectorCapabilityRegistry, connectorEvidenceDigest, connectorOperationKey,
  WRITE_QUALIFICATION_PHASES,
  type ConnectorOperationScope, type ConnectorOperationRegistration, type ConnectorEvidence,
  type ExternalConnectorEvidence, type EvidenceAssertion, type SyntheticConnectorEvidence,
} from '../runtime/connector-framework/registry.ts';

// Every record in this file is constructed locally. No external account,
// source observation, sandbox qualification or live qualification is claimed.
const observedAt = '2026-09-30T00:00:00.000Z';
const at = '2026-10-01T00:00:00.000Z';
const expiresAt = '2026-10-02T00:00:00.000Z';
const code = (expected: string) => (error: unknown) => error instanceof Error && 'code' in error && error.code === expected;
function scope(overrides: Partial<ConnectorOperationScope> = {}): ConnectorOperationScope {
  return {
    connectorId: 'synthetic-contract', connectorVersion: 'connector-v1', operationId: 'invoices',
    kind: 'read', transport: 'api',
    applicability: { applicationVersion: 'app-v1', edition: 'fixture', module: 'invoices', configuration: 'fixture-config-v1', deploymentProfile: 'synthetic' },
    ...overrides,
  };
}
function evidence(operation = scope(), asserted: EvidenceAssertion[] = ['operation'], id = 'synthetic-read'): SyntheticConnectorEvidence {
  return {
    id, scope: operation, assertions: asserted, observedAt, expiresAt,
    artifact: { sha256: digest({ fixture: id, version: 1, asserted }), reference: 'platform/tests/connector-registry.test.ts' },
    notes: ['Local deterministic synthetic contract fixture.'], environment: 'synthetic',
    provenance: { kind: 'synthetic-fixture', generatorVersion: 'registry-contract-v1' },
  };
}
function registration(operation = scope(), evidenceIds = ['synthetic-read']): ConnectorOperationRegistration {
  return { scope: operation, implemented: true, capabilities: [], evidenceIds, limitations: ['Synthetic contract fixture only.'] };
}
function externalFixture(operation = scope(), environment: 'sandbox' | 'live' = 'sandbox', asserted: EvidenceAssertion[] = ['operation'], id = 'external-metadata-fixture'): ExternalConnectorEvidence {
  const base = evidence(operation, asserted, id);
  return { ...base, environment, provenance: { kind: 'source-observation', sourceIdentity: 'simulated-source', observerId: 'simulated-observer', runId: 'simulated-run', independentReviewId: 'simulated-review' } };
}

test('empty registry selects no products and absent or unimplemented operations fail closed', () => {
  const empty = new ConnectorCapabilityRegistry();
  assert.deepEqual(empty.catalogue(), []);
  assert.equal(empty.qualification(scope(), at).permitted, false);
  assert.throws(() => empty.assertCanUse(scope(), at), code('CONNECTOR_NOT_QUALIFIED'));
  const definition = registration(); definition.implemented = false;
  const registry = new ConnectorCapabilityRegistry([definition], [evidence()]);
  assert.equal(registry.qualification(scope(), at).permitted, false);
  assert.ok(registry.qualification(scope(), at).reasonCodes.includes('operation-not-implemented'));
});

test('synthetic evidence qualifies only its exact operation, transport and applicability', () => {
  const original = scope();
  const variants: ConnectorOperationScope[] = [
    scope({ operationId: 'invoice-detail' }), scope({ connectorId: 'other-fixture' }),
    scope({ connectorVersion: 'connector-v2' }), scope({ kind: 'export' }),
    scope({ transport: 'file' }), scope({ kind: 'guided-export', transport: 'guided-ui' }),
    scope({ kind: 'import', transport: 'file' }),
    ...Object.keys(original.applicability).map(key => scope({ applicability: { ...original.applicability, [key]: 'different-fixture' } })),
    scope({ applicability: { ...original.applicability, region: 'fixture-region' } }),
  ];
  const registry = new ConnectorCapabilityRegistry([registration(original), ...variants.map(variant => registration(variant))], [evidence(original)]);
  assert.equal(registry.assertCanUse(original, at).level, 'synthetic-tested');
  assert.equal(registry.assertQualified(original, { at }).level, 'synthetic-tested');
  for (const variant of variants) {
    const result = registry.qualification(variant, at);
    assert.equal(result.permitted, false);
    assert.ok(result.reasonCodes.includes('evidence-scope-mismatch'));
    assert.notEqual(connectorOperationKey(original), connectorOperationKey(variant));
  }
});

test('declared capabilities require their own evidence and undeclared capability requests are rejected', () => {
  const definition = registration(); definition.capabilities = ['pagination', 'source-total-reconciliation'];
  const incomplete = new ConnectorCapabilityRegistry([definition], [evidence(scope(), ['operation', 'pagination'])]);
  assert.equal(incomplete.qualification(scope(), at).permitted, false);
  const complete = new ConnectorCapabilityRegistry([definition], [evidence(scope(), ['operation', 'pagination', 'source-total-reconciliation'])]);
  assert.equal(complete.assertCapability(scope(), 'pagination', at).permitted, true);
  assert.throws(() => complete.assertCapability(scope(), 'native-idempotency', at), code('CONNECTOR_CAPABILITY_UNSUPPORTED'));
  assert.throws(() => complete.assertCapability(scope(), 'made-up' as never, at), code('INVALID_CONNECTOR_CAPABILITY'));
});

test('write qualification never inherits read, export, import or incomplete phase support', () => {
  const write = scope({ operationId: 'update-invoice', kind: 'write' });
  const required: EvidenceAssertion[] = ['operation', ...WRITE_QUALIFICATION_PHASES];
  for (const omitted of WRITE_QUALIFICATION_PHASES) {
    const fixture = evidence(write, required.filter(phase => phase !== omitted), 'write-fixture');
    const registry = new ConnectorCapabilityRegistry([registration(write, [fixture.id])], [fixture]);
    assert.equal(registry.qualification(write, at).permitted, false, `Missing ${omitted} cannot authorize writes.`);
  }
  for (const route of [scope(), scope({ kind: 'export' }), scope({ kind: 'import', transport: 'file' })]) {
    const fixture = evidence(route, required, 'other-route');
    const registry = new ConnectorCapabilityRegistry([registration(write, [fixture.id])], [fixture]);
    assert.throws(() => registry.assertCanUse(write, at), code('CONNECTOR_NOT_QUALIFIED'));
  }
  const fixture = evidence(write, required, 'write-fixture');
  const registry = new ConnectorCapabilityRegistry([registration(write, [fixture.id])], [fixture]);
  assert.equal(registry.assertCanUse(write, at).level, 'synthetic-tested');
  assert.throws(() => registry.assertCanUse(write, at, 'live-verified'), code('CONNECTOR_NOT_QUALIFIED'));
});

test('self-declared live evidence and relabeled synthetic provenance cannot certify external support', () => {
  const fixture = externalFixture(scope(), 'live');
  const registry = new ConnectorCapabilityRegistry([registration(scope(), [fixture.id])], [fixture]);
  const result = registry.qualification(scope(), at, 'live-verified');
  assert.equal(result.level, 'unqualified');
  assert.ok(result.reasonCodes.includes('external-evidence-unverified'));
  assert.throws(() => registry.assertCanUse(scope(), at, 'live-verified'), code('CONNECTOR_NOT_QUALIFIED'));
  const relabeled = { ...evidence(), environment: 'live' } as unknown as ConnectorEvidence;
  assert.throws(() => new ConnectorCapabilityRegistry([registration()], [relabeled]), code('INVALID_CONNECTOR_EVIDENCE'));
});

test('trusted host attestations must bind exact evidence and cannot mutate registry inputs', () => {
  const fixture = externalFixture();
  let calls = 0;
  const registry = new ConnectorCapabilityRegistry([registration(scope(), [fixture.id])], [fixture], {
    verifyExternalEvidence: record => {
      calls++;
      assert.ok(Object.isFrozen(record) && Object.isFrozen(record.scope) && Object.isFrozen(record.provenance));
      return { evidenceDigest: connectorEvidenceDigest(record as ExternalConnectorEvidence), verifierId: 'test-only-host-verifier', verifiedAt: observedAt };
    },
  });
  assert.equal(calls, 1);
  assert.equal(registry.assertCanUse(scope(), at, 'sandbox-verified').level, 'sandbox-verified');
  assert.throws(() => registry.assertCanUse(scope(), at, 'live-verified'), code('CONNECTOR_NOT_QUALIFIED'));
  assert.throws(() => new ConnectorCapabilityRegistry([registration(scope(), [fixture.id])], [fixture], {
    verifyExternalEvidence: () => ({ evidenceDigest: digest('wrong artifact'), verifierId: 'test-only-host', verifiedAt: observedAt }),
  }), code('INVALID_EVIDENCE_ATTESTATION'));
  const future = new ConnectorCapabilityRegistry([registration(scope(), [fixture.id])], [fixture], {
    verifyExternalEvidence: () => ({ evidenceDigest: connectorEvidenceDigest(fixture), verifierId: 'test-only-host', verifiedAt: expiresAt }),
  });
  assert.ok(future.qualification(scope(), at).reasonCodes.includes('attestation-not-yet-valid'));
});

test('assertions from different environments cannot be combined to manufacture stronger support', () => {
  const definition = registration(scope(), ['local-pagination', 'external-operation']); definition.capabilities = ['pagination'];
  const local = evidence(scope(), ['operation', 'pagination'], 'local-pagination');
  const remote = externalFixture(scope(), 'sandbox', ['operation'], 'external-operation');
  const registry = new ConnectorCapabilityRegistry([definition], [local, remote], {
    verifyExternalEvidence: record => ({ evidenceDigest: connectorEvidenceDigest(record as ExternalConnectorEvidence), verifierId: 'test-only-host', verifiedAt: observedAt }),
  });
  assert.equal(registry.assertCanUse(scope(), at).level, 'synthetic-tested');
  assert.throws(() => registry.assertCanUse(scope(), at, 'sandbox-verified'), code('CONNECTOR_NOT_QUALIFIED'));
});

test('freshness limits, future evidence and exact expiration boundaries fail closed', () => {
  const registry = new ConnectorCapabilityRegistry([registration()], [evidence()]);
  assert.ok(registry.qualification(scope(), '2026-09-29T23:59:59.999Z').reasonCodes.includes('evidence-not-yet-observed'));
  assert.equal(registry.assertCanUse(scope(), observedAt).permitted, true);
  assert.equal(registry.assertCanUse(scope(), '2026-10-01T23:59:59.999Z').permitted, true);
  assert.ok(registry.qualification(scope(), expiresAt).reasonCodes.includes('evidence-expired'));
  const definition = registration(); definition.maxEvidenceAgeMs = 24 * 60 * 60 * 1000;
  const shorter = new ConnectorCapabilityRegistry([definition], [evidence()]);
  assert.equal(shorter.assertCanUse(scope(), '2026-09-30T23:59:59.999Z').permitted, true);
  assert.ok(shorter.qualification(scope(), at).reasonCodes.includes('evidence-too-old'));
});

test('approval bindings remain stable across time and change with revocation or definition changes', () => {
  const fixture = evidence(), registry = new ConnectorCapabilityRegistry([registration()], [fixture]);
  const before = registry.assertCanUse(scope(), observedAt);
  assert.equal(before.digest, registry.assertCanUse(scope(), at).digest);
  assert.equal(before.definitionDigest, digest(registration()));
  registry.revokeEvidence(fixture.id, at, 'Schema changed; requalification required.');
  assert.equal(registry.assertCanUse(scope(), '2026-09-30T23:59:59.999Z').digest, before.digest);
  const after = registry.qualification(scope(), at);
  assert.equal(after.permitted, false);
  assert.notEqual(after.digest, before.digest);
  assert.notEqual(after.evidenceDigest, before.evidenceDigest);
  assert.ok(after.reasonCodes.includes('evidence-revoked'));
  const changed = registration(); changed.limitations.push('Additional operator-reviewed limitation.');
  const newDefinition = new ConnectorCapabilityRegistry([changed], [fixture]);
  assert.notEqual(newDefinition.assertCanUse(scope(), at).definitionDigest, before.definitionDigest);
  assert.throws(() => registry.revokeEvidence('absent', at, 'Unknown evidence.'), code('INVALID_EVIDENCE_REVOCATION'));
});

test('caller input and returned catalogue or qualification mutations cannot alter registry state', () => {
  const definition = registration(), fixture = evidence();
  const registry = new ConnectorCapabilityRegistry([definition], [fixture]);
  const original = registry.assertCanUse(scope(), at);
  const originalDigest = original.digest;
  definition.implemented = false; definition.scope.applicability.edition = 'mutated'; fixture.assertions.length = 0;
  const catalogue = registry.catalogue();
  assert.ok(Object.isFrozen(catalogue) && Object.isFrozen(catalogue[0]) && Object.isFrozen(catalogue[0].scope.applicability));
  assert.throws(() => { (catalogue[0].evidenceIds as string[]).push('forged'); }, TypeError);
  original.capabilities.push('native-idempotency'); original.scope.connectorVersion = 'mutated'; original.evidenceIds.length = 0;
  assert.equal(registry.assertCanUse(scope(), at).digest, originalDigest);
  assert.deepEqual(registry.assertCanUse(scope(), at).capabilities, []);
  assert.ok(Object.isFrozen(registry.operation(scope())));
});

test('unknown evidence and duplicate identities remain explicit without changing other valid operations', () => {
  const definition = registration(scope(), ['absent-evidence']);
  const registry = new ConnectorCapabilityRegistry([definition]);
  assert.ok(registry.qualification(scope(), at).reasonCodes.includes('evidence-absent'));
  assert.throws(() => new ConnectorCapabilityRegistry([registration(), registration()], [evidence()]), code('DUPLICATE_CONNECTOR_OPERATION'));
  assert.throws(() => new ConnectorCapabilityRegistry([registration()], [evidence(), evidence()]), code('DUPLICATE_CONNECTOR_EVIDENCE'));
});

test('implementation bindings prevent same-scope evidence reuse for changed code, schema or write mappings', () => {
  const write = scope({ operationId: 'update-invoice', kind: 'write' });
  const implementationDigest = digest({ decoderVersion: 'v1', schema: 'fixture-v1', mapping: 'write-v1' });
  const changedImplementation = digest({ decoderVersion: 'v1', schema: 'fixture-v1', mapping: 'write-v2' });
  const definition = { ...registration(write, ['bound-write']), implementationDigest };
  const fixture = { ...evidence(write, ['operation', ...WRITE_QUALIFICATION_PHASES], 'bound-write'), implementationDigest };
  const registry = new ConnectorCapabilityRegistry([definition], [fixture]);
  assert.equal(registry.assertDefinition(write, implementationDigest, at).permitted, true);
  assert.throws(() => registry.assertDefinition(write, changedImplementation, at), code('CONNECTOR_DEFINITION_UNQUALIFIED'));
  const oldEvidence = new ConnectorCapabilityRegistry([{ ...definition, implementationDigest: changedImplementation }], [fixture]);
  assert.ok(oldEvidence.qualification(write, at).reasonCodes.includes('evidence-implementation-mismatch'));
  assert.throws(() => oldEvidence.assertDefinition(write, changedImplementation, at), code('CONNECTOR_NOT_QUALIFIED'));
  const unboundEvidence = evidence(write, ['operation', ...WRITE_QUALIFICATION_PHASES], 'bound-write');
  assert.equal(new ConnectorCapabilityRegistry([definition], [unboundEvidence]).qualification(write, at).permitted, false);
  const unpinnedDefinition = new ConnectorCapabilityRegistry([registration(write, ['bound-write'])], [fixture]);
  assert.throws(() => unpinnedDefinition.assertDefinition(write, implementationDigest, at), code('CONNECTOR_DEFINITION_UNQUALIFIED'));
  assert.throws(() => registry.assertDefinition(write, 'not-a-digest', at), code('INVALID_IMPLEMENTATION_DIGEST'));
  assert.throws(() => new ConnectorCapabilityRegistry([{ ...definition, implementationDigest: 'invalid' }]), code('INVALID_CONNECTOR_REGISTRATION'));
  assert.throws(() => new ConnectorCapabilityRegistry([definition], [{ ...fixture, implementationDigest: 'invalid' }]), code('INVALID_CONNECTOR_EVIDENCE'));
});

test('runtime validation rejects wildcards, impossible timestamps, unknown assertions and unsupported route shapes', () => {
  const badScope = scope({ applicability: { ...scope().applicability, edition: '*' } });
  assert.throws(() => connectorOperationKey(badScope), code('INVALID_OPERATION_SCOPE'));
  assert.throws(() => connectorOperationKey(scope({ kind: 'guided-export', transport: 'api' })), code('INVALID_OPERATION_SCOPE'));
  assert.throws(() => connectorOperationKey(scope({ kind: 'import', transport: 'api' })), code('INVALID_OPERATION_SCOPE'));
  const badDate = { ...evidence(), observedAt: '2026-02-30T00:00:00.000Z' };
  assert.throws(() => new ConnectorCapabilityRegistry([registration()], [badDate]), code('INVALID_EVIDENCE_TIME'));
  assert.throws(() => new ConnectorCapabilityRegistry([registration()], [{ ...evidence(), expiresAt: observedAt }]), code('INVALID_CONNECTOR_EVIDENCE'));
  assert.throws(() => new ConnectorCapabilityRegistry([registration()], [{ ...evidence(), assertions: ['unknown'] as never }]), code('INVALID_CONNECTOR_EVIDENCE'));
  assert.throws(() => new ConnectorCapabilityRegistry([{ ...registration(), capabilities: ['pagination', 'pagination'] }], [evidence()]), code('INVALID_CONNECTOR_REGISTRATION'));
  assert.throws(() => new ConnectorCapabilityRegistry([{ ...registration(), maxEvidenceAgeMs: 0 }], [evidence()]), code('INVALID_CONNECTOR_REGISTRATION'));
  assert.throws(() => new ConnectorCapabilityRegistry([{ ...registration(), fabricatedStatus: 'live-verified' } as never], [evidence()]), code('INVALID_CONNECTOR_REGISTRATION'));
  assert.throws(() => new ConnectorCapabilityRegistry([null as never]), code('INVALID_CONNECTOR_REGISTRATION'));
  assert.throws(() => new ConnectorCapabilityRegistry().qualification(scope(), at, 'unqualified' as never), code('INVALID_QUALIFICATION_LEVEL'));
  assert.throws(() => new ConnectorCapabilityRegistry().qualification(scope(), '2026-10-01T00:00:00Z'), code('INVALID_EVIDENCE_TIME'));
});
