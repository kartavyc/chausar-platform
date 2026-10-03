import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { test } from 'node:test';
import { auditAttemptIndex, auditAttemptIndexPackage } from '../attempt-index.ts';
import { readPackageArtifact } from '../audit.ts';

const indexPath = new URL('../attempt-index.json', import.meta.url);
const loadIndex = () => JSON.parse(readFileSync(indexPath, 'utf8'));

test('the index covers both preserved snapshots and all three stopped attempts without admitting data', () => {
  const result = auditAttemptIndex(loadIndex(), readPackageArtifact);

  assert.deepEqual(result, {
    contractVersion: 1,
    snapshotCount: 2,
    terminalAttemptCount: 3,
    actualCounts: {
      datasetAssetsAcquired: 0,
      retainedDatasetBytes: 0,
      coherentBusinessBooks: 0,
      independentCompanyFamilies: 0,
      independentConfigurationFamilies: 0,
      namedAdaptersQualified: 0,
      syntheticCasesAdded: 0,
      primaryReferenceCaptures: 3,
      derivedSchemaSpecifications: 1,
      acquisitionAttemptReceipts: 1,
      trackedReferenceAndReceiptBytes: 26992,
    },
  });
});

test('an omitted, duplicated or unknown snapshot is refused before any evidence is read', () => {
  const variants: Array<[string, (index: any) => void]> = [
    ['omitted snapshot', index => { index.entries.pop(); }],
    ['duplicated snapshot', index => { index.entries[1] = structuredClone(index.entries[0]); }],
    ['extra snapshot', index => {
      index.entries.push({ ...index.entries[1], id: 'extra-head' });
    }],
    ['unknown snapshot', index => { index.entries[1].id = 'unrecorded-head'; }],
  ];

  for (const [name, mutate] of variants) {
    const index = loadIndex();
    mutate(index);
    let reads = 0;

    assert.throws(() => auditAttemptIndex(index, path => {
      reads++;
      return readPackageArtifact(path);
    }), { code: 'INTAKE_INDEX_ENTRIES' }, name);
    assert.equal(reads, 0, `${name} must fail before artifact access`);
  }
});

test('changed custody pins are refused before any evidence is read', () => {
  const variants: Array<[string, (index: any) => void]> = [
    ['original source commit', index => { index.entries[0].sourceCommit = '0'.repeat(40); }],
    ['traversing receipt path', index => { index.entries[1].path = '../outside.json'; }],
    ['receipt kind', index => { index.entries[1].kind = 'blocked-corpus-intake-attempt-register'; }],
    ['receipt digest', index => { index.entries[1].sha256 = '0'.repeat(64); }],
    ['receipt byte length', index => { index.entries[1].byteLength++; }],
  ];

  for (const [name, mutate] of variants) {
    const index = loadIndex();
    mutate(index);
    let reads = 0;

    assert.throws(() => auditAttemptIndex(index, path => {
      reads++;
      return readPackageArtifact(path);
    }), { code: 'INTAKE_INDEX_PIN' }, name);
    assert.equal(reads, 0, `${name} must fail before artifact access`);
  }
});

test('a stale or tampered HEAD receipt cannot stand in for the preserved stopped attempt', () => {
  const receiptPath = 'attempts/uci-20260930-head-preflight.json';
  const variants: Array<[string, (receipt: any) => void]> = [
    ['stale receipt', receipt => { receipt.recordedAt = '2026-09-30T23:40:04Z'; }],
    ['changed receipt text', receipt => { receipt.rights.changes += '?'; }],
    ['claimed GET request', receipt => { receipt.transportPreflight.getDownloadRequests = 1; }],
    ['claimed body bytes', receipt => { receipt.transportPreflight.datasetBodyBytesMaterialized = 1; }],
  ];

  for (const [name, mutate] of variants) {
    const receipt = JSON.parse(Buffer.from(readPackageArtifact(receiptPath)).toString('utf8'));
    mutate(receipt);
    const changedBytes = Buffer.from(JSON.stringify(receipt, null, 2) + '\n');

    assert.throws(() => auditAttemptIndex(loadIndex(), path =>
      path === receiptPath ? changedBytes : readPackageArtifact(path)),
    { code: 'INTAKE_INDEX_TAMPER' }, name);
  }
});

test('the index requires a real canonical UTC timestamp at or after its latest receipt', () => {
  const variants: Array<[string, string, boolean]> = [
    ['invalid timestamp', 'not-a-timestamp', true],
    ['noncanonical timestamp', '2026-10-03T23:09:27.000Z', true],
    ['impossible calendar date', '2026-02-30T23:40:04Z', true],
    ['index predates the HEAD receipt', '2026-09-30T23:40:04Z', false],
  ];

  for (const [name, recordedAt, refuseBeforeRead] of variants) {
    const index = loadIndex();
    index.recordedAt = recordedAt;
    let reads = 0;

    assert.throws(() => auditAttemptIndex(index, path => {
      reads++;
      return readPackageArtifact(path);
    }), { code: 'INTAKE_INDEX_TIMESTAMP' }, name);
    if (refuseBeforeRead) {
      assert.equal(reads, 0, `${name} must fail before artifact access`);
    }
  }
});

test('rehashing a replacement receipt cannot promote observations, effects, rights or qualifications', () => {
  const receiptPath = 'attempts/uci-20260930-head-preflight.json';
  const variants: Array<[string, (receipt: any) => void]> = [
    ['invented row and schema observations', receipt => {
      receipt.datasetReceipt.observedRows = 1;
      receipt.datasetReceipt.observedSchemaHash = '0'.repeat(64);
    }],
    ['acquired dataset counts', receipt => {
      receipt.actualCounts.datasetAssetsAcquired = 1;
      receipt.actualCounts.datasetBytesAcquired = 1;
      receipt.actualCounts.datasetBytesRetained = 1;
    }],
    ['acquired independent origins', receipt => {
      receipt.actualCounts.independentCompanyOrigins = 1;
      receipt.actualCounts.independentConfigurationOrigins = 1;
      receipt.source.independentAcquiredOrigins = 1;
    }],
    ['named adapter qualification', receipt => { receipt.actualCounts.namedAdaptersQualified = 1; }],
    ['destination writes', receipt => {
      receipt.destination.created = true;
      receipt.destination.writeAttempted = true;
    }],
    ['parser and privacy work', receipt => {
      receipt.privacy.rawArchiveStored = true;
      receipt.privacy.parserRun = true;
      receipt.privacy.projectionRun = true;
      receipt.privacy.redactionRun = true;
      receipt.privacy.anonymizationClaim = true;
    }],
    ['training and model disclosure', receipt => {
      receipt.rights.trainingRun = true;
      receipt.rights.rawDatasetDisclosedToModels = true;
    }],
    ['alternate route and elevated retry', receipt => {
      receipt.stop.alternateDownloadRouteUsed = true;
      receipt.stop.escalatedNetworkRetry = true;
    }],
    ['source provenance drift', receipt => {
      receipt.source.officialAssetUrl = 'https://example.invalid/mirror.zip';
      receipt.transportPreflight.uri = receipt.source.officialAssetUrl;
    }],
    ['licence provenance drift', receipt => {
      receipt.rights.spdx = 'CC0-1.0';
      receipt.rights.retainedLicense.sha256 = '0'.repeat(64);
    }],
  ];

  for (const [name, mutate] of variants) {
    const index = loadIndex();
    const receipt = JSON.parse(Buffer.from(readPackageArtifact(receiptPath)).toString('utf8'));
    mutate(receipt);
    const replacementBytes = Buffer.from(JSON.stringify(receipt, null, 2) + '\n');
    const entry = index.entries.find((candidate: any) => candidate.id === 'uci-ordinary-head');
    entry.byteLength = replacementBytes.byteLength;
    entry.sha256 = createHash('sha256').update(replacementBytes).digest('hex');
    let reads = 0;

    assert.throws(() => auditAttemptIndex(index, path => {
      reads++;
      return path === receiptPath ? replacementBytes : readPackageArtifact(path);
    }), { code: 'INTAKE_INDEX_PIN' }, name);
    assert.equal(reads, 0, `${name} cannot replace the source-controlled snapshot`);
  }
});

test('a reader callback cannot change the validated snapshot by mutating the caller index', () => {
  const variants: Array<[string, (index: any) => void, number]> = [
    ['appended duplicate', index => { index.entries.push(structuredClone(index.entries[0])); }, 3],
    ['cleared entries', index => { index.entries.length = 0; }, 0],
  ];

  for (const [name, mutate, changedLength] of variants) {
    const index = loadIndex();
    let mutated = false;
    const result = auditAttemptIndex(index, path => {
      if (!mutated) {
        mutate(index);
        mutated = true;
      }
      return readPackageArtifact(path);
    });

    assert.equal(mutated, true, `${name} must exercise the reader callback`);
    assert.equal(index.entries.length, changedLength, `${name} must change the caller's object`);
    assert.equal(result.contractVersion, 1);
    assert.equal(result.snapshotCount, 2, name);
    assert.equal(result.terminalAttemptCount, 3, name);
    for (const count of [
      'datasetAssetsAcquired', 'retainedDatasetBytes', 'coherentBusinessBooks',
      'independentCompanyFamilies', 'independentConfigurationFamilies',
      'namedAdaptersQualified', 'syntheticCasesAdded',
    ] as const) {
      assert.equal(result.actualCounts[count], 0, `${name} cannot promote ${count}`);
    }
    assert.equal(result.actualCounts.acquisitionAttemptReceipts, 1);
    assert.equal(result.actualCounts.trackedReferenceAndReceiptBytes, 26992);
  }
});

test('both preserved snapshots require correctly typed bytes of the exact retained size', () => {
  const paths = ['manifest.json', 'attempts/uci-20260930-head-preflight.json'];
  const variants: Array<[string, (bytes: Uint8Array) => Uint8Array]> = [
    ['oversized snapshot', bytes => Buffer.concat([bytes, Buffer.from([0])])],
    ['truncated snapshot', bytes => bytes.subarray(0, bytes.byteLength - 1)],
    ['wrong-type snapshot', () => 'not original bytes' as unknown as Uint8Array],
  ];

  for (const receiptPath of paths) {
    for (const [name, mutate] of variants) {
      const changedBytes = mutate(readPackageArtifact(receiptPath));
      assert.throws(() => auditAttemptIndex(loadIndex(), path =>
        path === receiptPath ? changedBytes : readPackageArtifact(path)),
      { code: 'INTAKE_INDEX_TAMPER' }, `${name}: ${receiptPath}`);
    }
  }
});

test('an unavailable snapshot propagates the reader failure without issuing an audit result', () => {
  for (const receiptPath of ['manifest.json', 'attempts/uci-20260930-head-preflight.json']) {
    const missing = Object.assign(new Error('Preserved snapshot unavailable.'), { code: 'ENOENT' });

    assert.throws(() => auditAttemptIndex(loadIndex(), path => {
      if (path === receiptPath) throw missing;
      return readPackageArtifact(path);
    }), error => error === missing, receiptPath);
  }
});

test('index coverage still requires the original byte-verified licence reference', () => {
  const licencePath = 'evidence/CC-BY-4.0.normalized.txt';
  const changedBytes = Uint8Array.from(readPackageArtifact(licencePath));
  changedBytes[0] ^= 1;

  assert.throws(() => auditAttemptIndex(loadIndex(), path =>
    path === licencePath ? changedBytes : readPackageArtifact(path)),
  { code: 'INTAKE_REFERENCE_TAMPER' });
});

test('index and entry accessors are refused without invoking their getters or reading artifacts', () => {
  for (const getterLocation of ['index', 'entry']) {
    const index = loadIndex();
    let getters = 0;
    let reads = 0;
    const target = getterLocation === 'index' ? index : index.entries[1];
    const key = getterLocation === 'index' ? 'recordedAt' : 'sha256';
    const originalValue = target[key];
    Object.defineProperty(target, key, {
      enumerable: true,
      configurable: true,
      get() { getters++; return originalValue; },
    });

    assert.throws(() => auditAttemptIndex(index, path => {
      reads++;
      return readPackageArtifact(path);
    }), { code: 'NON_DATA_CONTRACT' }, getterLocation);
    assert.equal(getters, 0, `${getterLocation} getter must remain uninvoked`);
    assert.equal(reads, 0, `${getterLocation} accessor must fail before artifact access`);
  }
});

test('extra top-level or entry assertions cannot add admission authority to the index', () => {
  const variants: Array<[string, (index: any) => void]> = [
    ['top-level counts', index => { index.actualCounts = { datasetAssetsAcquired: 1 }; }],
    ['entry admission assertion', index => { index.entries[1].acquisitionState = 'admitted'; }],
  ];

  for (const [name, mutate] of variants) {
    const index = loadIndex();
    mutate(index);
    let reads = 0;

    assert.throws(() => auditAttemptIndex(index, path => {
      reads++;
      return readPackageArtifact(path);
    }), { code: 'INVALID_CONTRACT' }, name);
    assert.equal(reads, 0, `${name} must fail before artifact access`);
  }
});

test('reordering valid descriptors preserves coverage and the original zero-count register', () => {
  const index = loadIndex();
  index.entries.reverse();

  assert.deepEqual(auditAttemptIndex(index, readPackageArtifact), {
    contractVersion: 1,
    snapshotCount: 2,
    terminalAttemptCount: 3,
    actualCounts: {
      datasetAssetsAcquired: 0,
      retainedDatasetBytes: 0,
      coherentBusinessBooks: 0,
      independentCompanyFamilies: 0,
      independentConfigurationFamilies: 0,
      namedAdaptersQualified: 0,
      syntheticCasesAdded: 0,
      primaryReferenceCaptures: 3,
      derivedSchemaSpecifications: 1,
      acquisitionAttemptReceipts: 1,
      trackedReferenceAndReceiptBytes: 26992,
    },
  });
});

test('the package audit refuses oversized on-disk index or manifest bytes before parsing', () => {
  const tempBase = realpathSync(tmpdir());
  const packageRoot = mkdtempSync(join(tempBase, 'chausar-attempt-index-package-'));
  try {
    for (const file of [
      'attempt-index.json', 'manifest.json', 'attempts/uci-20260930-head-preflight.json',
      'evidence/CC-BY-4.0.normalized.txt', 'evidence/uci-source-reference.json',
      'evidence/microsoft-source-reference.json', 'evidence/acquisition-attempts.json',
      'schemas/uci-online-retail.documented-schema.json',
    ]) {
      const target = join(packageRoot, file);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, readPackageArtifact(file));
    }

    const result = auditAttemptIndexPackage(packageRoot);
    assert.equal(result.snapshotCount, 2);
    assert.equal(result.terminalAttemptCount, 3);
    assert.equal(result.actualCounts.datasetAssetsAcquired, 0);
    assert.equal(result.actualCounts.namedAdaptersQualified, 0);

    for (const file of ['attempt-index.json', 'manifest.json']) {
      const target = join(packageRoot, file);
      writeFileSync(target, Buffer.alloc(40000, 0x20));
      assert.throws(() => auditAttemptIndexPackage(packageRoot), { code: 'INTAKE_FILE_LIMIT' }, file);
      writeFileSync(target, readPackageArtifact(file));
    }
  } finally {
    const cleanupTarget = realpathSync(packageRoot);
    const insideTemp = relative(tempBase, cleanupTarget);
    assert.ok(insideTemp !== '' && !isAbsolute(insideTemp) && insideTemp !== '..'
      && !insideTemp.startsWith(`..${sep}`), 'Cleanup must stay inside the owned temporary base.');
    rmSync(cleanupTarget, { recursive: true, force: true });
  }
});
