import { closeSync, constants, fstatSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditIntakeAttempts, type ActualCounts } from './audit.ts';
import { dataOnly, exactKeys, freezeData, hashData, requireThat, sha256Bytes } from '../semantic-qualification/src/validation.ts';

type AttemptIndexEntry = {
  id: string; kind: string; path: string; sourceCommit: string; byteLength: number; sha256: string;
};
type AttemptIndex = { contractVersion: number; kind: string; recordedAt: string; entries: AttemptIndexEntry[] };
const preservedSnapshots: readonly AttemptIndexEntry[] = [
  {
    id: 'original-intake', kind: 'blocked-corpus-intake-attempt-register', path: 'manifest.json',
    sourceCommit: '367463ed42e6af2e49292026955f8afab967db94', byteLength: 17121,
    sha256: 'd26f3fa3b446c297709c0316e88eeeabec7f1dea905de5512dcce25211434705',
  },
  {
    id: 'uci-ordinary-head', kind: 'uci-official-file-transfer-preflight-receipt',
    path: 'attempts/uci-20260930-head-preflight.json',
    sourceCommit: '2fb1c5b187897327efd97d3a56ec0a627adb1883', byteLength: 6087,
    sha256: '82d739dd16d955dce2c8ff254c0a96e9dbffe715ff7e8df8dd5851dde4265bf9',
  },
];

export type AttemptIndexAudit = {
  contractVersion: 1; snapshotCount: number; terminalAttemptCount: number;
  actualCounts: ActualCounts;
};

function snapshotTime(value: unknown): number {
  requireThat(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value), 'INTAKE_INDEX_TIMESTAMP', 'Use a canonical UTC snapshot timestamp.');
  const date = new Date(value);
  requireThat(Number.isFinite(date.getTime()) && date.toISOString().replace('.000Z', 'Z') === value, 'INTAKE_INDEX_TIMESTAMP', 'Snapshot timestamps must identify real calendar instants.');
  return date.getTime();
}

function verifyHeadReceipt(head: Record<string, any>, manifest: Record<string, any>): void {
  dataOnly(head);
  const uci = manifest.sources.find((source: { id: string }) => source.id === 'uci-online-retail');
  const licence = manifest.artifacts.find((artifact: { id: string }) => artifact.id === 'license-cc-by-4.0');
  requireThat(head.contractVersion === 1 && head.kind === preservedSnapshots[1].kind &&
    head.priorIntakeCommit === preservedSnapshots[0].sourceCommit &&
    head.preservedSemanticCommit === manifest.preservedImplementationCommit &&
    head.source.officialPageUrl === uci.sourceUrl && head.source.officialAssetUrl === uci.artifactDownloadUrl &&
    head.transportPreflight.uri === head.source.officialAssetUrl &&
    head.rights.spdx === 'CC-BY-4.0' && head.rights.citation === uci.attribution.citation &&
    head.rights.retainedLicense.packageRelativePath === licence.path && head.rights.retainedLicense.byteLength === licence.byteLength &&
    head.rights.retainedLicense.sha256 === licence.sha256,
  'INTAKE_HEAD_RECEIPT', 'The later receipt must join the preserved source, licence and implementation custody.');
  requireThat(head.transportPreflight.method === 'HEAD' && head.transportPreflight.transportOutcome === 'socket-access-forbidden' &&
    head.transportPreflight.httpStatus === null && head.transportPreflight.responseContentLength === null &&
    head.transportPreflight.responseETag === null && head.transportPreflight.responseLastModified === null &&
    head.transportPreflight.getDownloadRequests === 0 && head.transportPreflight.datasetBodyBytesMaterialized === 0 &&
    head.transportPreflight.attemptRepeated === false && head.stop.terminalForThisAttempt === true && head.stop.noFurtherTransportAction === true &&
    ['networkOrSecuritySettingsChanged', 'escalatedNetworkRetry', 'alternateDownloadRouteUsed', 'mirrorUsed', 'rangeOrChunkRequestsUsed'].every(key => head.stop[key] === false),
  'INTAKE_HEAD_RECEIPT', 'Count only the terminal HEAD refusal without transport effects or retries.');
  requireThat(Object.values(head.actualCounts).every(count => count === 0) && Object.values(head.datasetReceipt).every(value => value === null) &&
    head.source.independentAcquiredOrigins === 0 && head.destination.created === false && head.destination.writeAttempted === false &&
    ['rawArchiveStored', 'workbookOpened', 'parserRun', 'projectionRun', 'redactionRun', 'anonymizationClaim'].every(key => head.privacy[key] === false) &&
    head.rights.trainingRun === false && head.rights.rawDatasetDisclosedToModels === false &&
    head.qualification.state === 'unqualified' && head.qualification.genericDataDoesNotQualifyNamedAdapters === true &&
    head.qualification.sourceTotalReconciliationRun === false && head.qualification.holdoutAssignment === 'unassigned',
  'INTAKE_HEAD_RECEIPT', 'A refused preflight cannot become acquired data, privacy work, model use or qualification.');
}

export function auditAttemptIndex(value: unknown, readArtifact: (path: string) => Uint8Array): AttemptIndexAudit {
  dataOnly(value);
  exactKeys(value, ['contractVersion', 'kind', 'recordedAt', 'entries'], 'attempt index');
  const index = freezeData(value) as AttemptIndex;
  requireThat(index.contractVersion === 1 && index.kind === 'blocked-corpus-intake-attempt-index', 'INTAKE_INDEX_CONTRACT', 'Use the versioned blocked-evidence index.');
  const indexedAt = snapshotTime(index.recordedAt);
  requireThat(Array.isArray(index.entries) && index.entries.length === 2, 'INTAKE_INDEX_ENTRIES', 'Index both preserved snapshots exactly once.');
  const entries = new Map<string, AttemptIndexEntry>();
  for (const entry of index.entries) {
    exactKeys(entry, ['id', 'kind', 'path', 'sourceCommit', 'byteLength', 'sha256'], 'attempt index entry');
    requireThat(['original-intake', 'uci-ordinary-head'].includes(entry.id) && !entries.has(entry.id), 'INTAKE_INDEX_ENTRIES', 'Index both preserved snapshots exactly once.');
    entries.set(entry.id, entry);
  }
  for (const pin of preservedSnapshots) {
    requireThat(hashData(entries.get(pin.id)) === hashData(pin), 'INTAKE_INDEX_PIN', 'Index the original immutable commit, path, byte count and digest.');
  }
  const expectedSizes = new Map(preservedSnapshots.map(pin => [pin.path, pin.byteLength]));
  const snapshotPaths = new Set(expectedSizes.keys());
  const cache = new Map<string, Uint8Array>();
  const read = (file: string): Uint8Array => {
    if (!cache.has(file)) {
      const bytes = readArtifact(file);
      requireThat(expectedSizes.has(file) && bytes instanceof Uint8Array && bytes.byteLength === expectedSizes.get(file),
        snapshotPaths.has(file) ? 'INTAKE_INDEX_TAMPER' : 'INTAKE_REFERENCE_TAMPER', 'Read original evidence as exact bounded bytes.');
      cache.set(file, new Uint8Array(bytes));
    }
    return cache.get(file)!;
  };
  for (const pin of preservedSnapshots) {
    const bytes = read(pin.path);
    requireThat(bytes.byteLength === pin.byteLength && sha256Bytes(bytes) === pin.sha256, 'INTAKE_INDEX_TAMPER', 'Preserved snapshot bytes must match their original immutable receipt.');
  }
  const parse = (file: string) => JSON.parse(Buffer.from(read(file)).toString('utf8'));
  const manifest = parse(entries.get('original-intake')!.path);
  const head = parse(entries.get('uci-ordinary-head')!.path);
  requireThat(snapshotTime(manifest.recordedAt) < snapshotTime(head.recordedAt) && indexedAt >= snapshotTime(head.recordedAt), 'INTAKE_INDEX_TIMESTAMP', 'Index the later HEAD snapshot after the original manifest.');
  for (const artifact of manifest.artifacts) expectedSizes.set(artifact.path, artifact.byteLength);
  const actualCounts = auditIntakeAttempts(manifest, read);
  verifyHeadReceipt(head, manifest);
  const legacyReceipt = parse(manifest.artifacts.find((artifact: { id: string }) => artifact.id === 'acquisition-attempt-receipts').path);
  return {
    contractVersion: 1, snapshotCount: index.entries.length,
    terminalAttemptCount: legacyReceipt.attempts.length + Number(head.transportPreflight.method === 'HEAD' && head.stop.terminalForThisAttempt),
    actualCounts,
  };
}

/** Read-only CLI boundary: regular package files, bounded allocation and immutable receipt pins. */
export function auditAttemptIndexPackage(packageRoot: string): AttemptIndexAudit {
  const base = realpathSync(packageRoot);
  const read = (path: string): Uint8Array => {
    const target = realpathSync(resolve(base, path));
    const inside = relative(base, target);
    requireThat(inside !== '' && !isAbsolute(inside) && inside !== '..' && !inside.startsWith(`..${sep}`),
      'INTAKE_PATH', 'Resolved evidence paths must stay inside the package.');
    const limit = path === 'attempt-index.json' ? 8192 : 32768;
    const before = statSync(target);
    requireThat(before.isFile() && before.size <= limit, 'INTAKE_FILE_LIMIT', 'Evidence must be a bounded regular file.');
    const fd = openSync(target, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0));
    try {
      const opened = fstatSync(fd);
      requireThat(opened.isFile() && opened.size <= limit && opened.dev === before.dev && opened.ino === before.ino,
        'INTAKE_FILE_LIMIT', 'The opened evidence must remain the same bounded regular file.');
      const bytes = new Uint8Array(opened.size + 1);
      let count = 0;
      while (count < bytes.byteLength) {
        const received = readSync(fd, bytes, count, bytes.byteLength - count, count);
        if (received === 0) break;
        count += received;
      }
      requireThat(count === opened.size && fstatSync(fd).size === opened.size,
        'INTAKE_FILE_LIMIT', 'Evidence size changed during its bounded read.');
      return bytes.subarray(0, count);
    } finally { closeSync(fd); }
  };
  const index = JSON.parse(Buffer.from(read('attempt-index.json')).toString('utf8'));
  return auditAttemptIndex(index, read);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(auditAttemptIndexPackage(dirname(fileURLToPath(import.meta.url))), null, 2));
}
