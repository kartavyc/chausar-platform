import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  checkEvidenceCurrent, compileMapping, hashData, mapBatch, qualifyCase,
  SemanticError, validateSplit, verifyLedger,
  type OperationEvidence, type QualificationInput,
} from '../src/index.ts';
import { prepareSyntheticSuite } from '../fixtures/prepare-suite.ts';

function validInput(): QualificationInput {
  const input = prepareSyntheticSuite().find(candidate => candidate.goldenCase.id === 'tuning-retail-separated-events');
  assert.ok(input, 'The independently authored retail business case must exist.');
  return structuredClone(input);
}

function refusesAdmission(input: QualificationInput, code: string) {
  const ledger: OperationEvidence[] = [];
  assert.throws(() => qualifyCase(input, ledger), (error: unknown) => error instanceof SemanticError && error.code === code);
  assert.equal(ledger.length, 0, 'A refused admission must not retain operation receipts.');
}

function currentFor(evidence: OperationEvidence) {
  return {
    mappingFingerprint: evidence.mappingFingerprint, schemaHash: evidence.schemaHash,
    rowsHash: evidence.rowsHash, snapshotId: evidence.scope.snapshotId,
    sourceReportHash: evidence.sourceReportHash, manifestHash: evidence.manifestHash,
    splitPlanHash: evidence.splitPlanHash, goldenCaseHash: evidence.goldenCaseHash,
  };
}

test('unresolved acquisition or reuse rights refuse admission before invalid source rows can be mapped', async t => {
  for (const permission of ['acquisition', 'reuse'] as const) {
    await t.test(permission, () => {
      const input = validInput();
      input.manifest.rights.permissions[permission] = 'unknown';
      // A deliberately malformed amount would fail the mapper if admission let it run.
      input.batch.rows[0].amount = '1.001';
      refusesAdmission(input, 'RIGHTS_UNRESOLVED');
    });
  }
  await t.test('discovery-only', () => {
    const input = validInput(); input.manifest.rights.status = 'discovery-only';
    refusesAdmission(input, 'RIGHTS_UNRESOLVED');
  });
});

test('unreviewed personal data cannot enter the qualification ledger', () => {
  const input = validInput(); input.manifest.rights.personalData = 'unreviewed';
  refusesAdmission(input, 'PERSONAL_DATA_UNREVIEWED');
});

test('one changed consumer-local artifact byte rejects the whole admission', () => {
  const input = validInput(), artifact = input.manifest.artifacts.find(item => item.role === 'source-rows')!;
  input.artifactBytes[artifact.path] = String(input.artifactBytes[artifact.path]) + ' ';
  refusesAdmission(input, 'ARTIFACT_HASH_MISMATCH');
});

test('qualification rejects an envelope getter without executing it', () => {
  const input = validInput(), ledger: OperationEvidence[] = []; let executions = 0;
  Object.defineProperty(input, 'compiled', { enumerable: true, get() { executions++; throw new Error('Getter executed.'); } });
  assert.throws(() => qualifyCase(input, ledger), (error: unknown) => error instanceof SemanticError && error.code === 'NON_DATA_CONTRACT');
  assert.equal(executions, 0); assert.equal(ledger.length, 0);
});

test('entire company, dataset, row-set, template and configuration origins are withheld', async t => {
  for (const key of ['businessId', 'datasetId', 'rowsHash'] as const) {
    await t.test(key, () => {
      const plan = validInput().splitPlan;
      plan.holdout[0][key] = plan.tuning[0][key];
      assert.throws(() => validateSplit(plan), (error: unknown) => error instanceof SemanticError && error.code === 'HOLDOUT_LEAKAGE');
    });
  }
  for (const origin of ['business', 'template', 'configuration'] as const) {
    await t.test(origin, () => {
      const input = validInput(); input.splitPlan.holdout[0].origins[origin] = input.splitPlan.tuning[0].origins[origin];
      refusesAdmission(input, 'HOLDOUT_LEAKAGE');
    });
  }
});

test('relabeling generic synthetic records as a named vendor cannot certify its connector', () => {
  const input = validInput(), pack = structuredClone(input.compiled.pack), rules = structuredClone(input.compiled.rules);
  pack.system = 'tally'; pack.product = { ...pack.product, name: 'TallyPrime', version: '7.0' };
  rules.packHash = hashData(pack); input.compiled = compileMapping(pack, rules, input.compiled.ontology);
  input.batch.system = pack.system; input.batch.product = pack.product; input.report.system = pack.system;
  refusesAdmission(input, 'SYSTEM_PROFILE_UNQUALIFIED');
});

test('schema or compiler identity drift invalidates all proposed source facts', async t => {
  await t.test('schema', () => {
    const input = validInput(); input.batch.schema.fields.extra_state = 'text';
    const result = mapBatch(input.compiled, input.batch);
    assert.equal(result.decision, 'invalidated'); assert.deepEqual(result.facts, []);
    assert.equal(result.issues[0].code, 'SCHEMA_DRIFT');
  });
  await t.test('compiler', () => {
    const input = validInput(); input.compiled.compilerBuildHash = '0'.repeat(64);
    const result = mapBatch(input.compiled, input.batch);
    assert.equal(result.decision, 'invalidated'); assert.deepEqual(result.facts, []);
    assert.equal(result.issues[0].code, 'COMPILED_DRIFT');
  });
});

test('qualification reuse requires current mapping, source, rights, split and golden evidence', async t => {
  const { evidence } = qualifyCase(validInput()), receipt = evidence[0];
  assert.equal(receipt.decision, 'qualified');
  assert.equal(checkEvidenceCurrent(receipt, currentFor(receipt)).valid, true);
  for (const key of Object.keys(currentFor(receipt)) as Array<keyof ReturnType<typeof currentFor>>) {
    await t.test(key, () => {
      const current = currentFor(receipt); current[key] = key === 'snapshotId' ? 'replacement-snapshot' : '0'.repeat(64);
      const result = checkEvidenceCurrent(receipt, current);
      assert.equal(result.valid, false); assert.equal(result.decision, 'invalidated');
    });
  }
});

test('the independently retained head detects truncation and qualification tampering', async t => {
  const { ledger } = qualifyCase(validInput()), anchor = verifyLedger(ledger);
  assert.equal(verifyLedger(ledger, anchor.head).valid, true);
  await t.test('tail removal', () => {
    assert.throws(() => verifyLedger(ledger.slice(0, -1), anchor.head), (error: unknown) => error instanceof SemanticError && error.code === 'LEDGER_HEAD_MISMATCH');
  });
  await t.test('changed amount', () => {
    const changed = structuredClone(ledger); changed[0].values[0].minor = '1';
    assert.throws(() => verifyLedger(changed, anchor.head), (error: unknown) => error instanceof SemanticError && error.code === 'LEDGER_TAMPERED');
    assert.throws(() => checkEvidenceCurrent(changed[0], currentFor(ledger[0])), (error: unknown) => error instanceof SemanticError && error.code === 'LEDGER_TAMPERED');
  });
  await t.test('reordered receipts', () => {
    const changed = structuredClone(ledger); [changed[0], changed[1]] = [changed[1], changed[0]];
    assert.throws(() => verifyLedger(changed, anchor.head), (error: unknown) => error instanceof SemanticError && error.code === 'LEDGER_TAMPERED');
  });
});

test('public discovery references and dataset licenses never count as admitted connector evidence', () => {
  const registry = JSON.parse(readFileSync(new URL('../fixtures/public-source-candidates.json', import.meta.url), 'utf8'));
  assert.equal(registry.kind, 'public-source-candidate-registry');
  assert.equal(registry.admittedExternalDatasetCount, 0);
  assert.ok(registry.candidates.length > 0);
  assert.equal(new Set(registry.candidates.map((candidate: any) => candidate.id)).size, registry.candidates.length);
  for (const candidate of registry.candidates) {
    assert.equal(candidate.status, 'discovery-only', candidate.id);
    assert.equal(candidate.qualificationState, 'unqualified', candidate.id);
    assert.equal(candidate.sourceDatasetReceipt, null, candidate.id);
    assert.deepEqual(candidate.localArtifactPaths, [], candidate.id);
    assert.ok(candidate.rights.license && candidate.rights.evidence, candidate.id);
    assert.ok(candidate.requiredBeforeAdmission.length > 0, candidate.id);
  }
});
