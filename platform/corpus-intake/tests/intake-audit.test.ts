import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { auditIntakeAttempts, readPackageArtifact } from '../audit.ts';

const manifestPath = fileURLToPath(new URL('../manifest.json',import.meta.url));
const load = () => JSON.parse(readFileSync(manifestPath,'utf8'));
const check = (m: unknown) => auditIntakeAttempts(m,readPackageArtifact);
function fails(m: unknown, code: string): void {
  assert.throws(() => check(m),(error: any) => error.code === code);
}
function rehashSchemaAndCheck(mutator: (value: any) => void): void {
  const m=load(); const a=m.artifacts.find((a:any) => a.id === 'uci-documented-schema');
  const schema=JSON.parse(Buffer.from(readPackageArtifact(a.path)).toString('utf8')); mutator(schema);
  const bytes=Buffer.from(JSON.stringify(schema,null,2)+'\n');
  m.actualCounts.trackedReferenceAndReceiptBytes+=bytes.byteLength-a.byteLength;
  a.byteLength=bytes.byteLength; a.sha256=createHash('sha256').update(bytes).digest('hex');
  assert.throws(() => auditIntakeAttempts(m,path => path === a.path ? bytes : readPackageArtifact(path)),(error:any) => ['INTAKE_SCHEMA','INTAKE_CLAIM_MISMATCH'].includes(error.code));
}
test('reference and licence bytes never increment dataset, company or adapter counts',() => {
  const counts = check(load());
  assert.equal(counts.datasetAssetsAcquired,0); assert.equal(counts.retainedDatasetBytes,0);
  assert.equal(counts.coherentBusinessBooks,0); assert.equal(counts.independentCompanyFamilies,0);
  assert.equal(counts.independentConfigurationFamilies,0); assert.equal(counts.namedAdaptersQualified,0);
  assert.equal(counts.primaryReferenceCaptures,3); assert.equal(counts.derivedSchemaSpecifications,1);
  assert.equal(counts.acquisitionAttemptReceipts,1); assert.equal(counts.trackedReferenceAndReceiptBytes,26992);
});
test('published row counts cannot be promoted to observed rows',() => {
  const m=load(); m.sources[0].observedRowCount=541909; fails(m,'INTAKE_OBSERVATION');
});
test('published workbook size is not an acquired artifact size or hash',() => {
  const m=load(); m.sources[0].acquisition.originalDataset={path:'dataset.xlsx',sha256:'0'.repeat(64),byteLength:22600000};
  fails(m,'INTAKE_CLAIM_MISMATCH');
});
test('a zero-byte dataset digest cannot be fabricated for the absent ZIP',() => {
  const m=load(); m.sources[0].acquisition.originalDataset.sha256='e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  fails(m,'INTAKE_CLAIM_MISMATCH');
});
test('retained reference text hashes do not claim original HTTP bytes',() => {
  const m=load(); m.artifacts[0].originalHttpByteSha256=m.artifacts[0].sha256; fails(m,'INTAKE_DIGEST');
});
test('any reference evidence modification invalidates its immutable capture',() => {
  const m=load();
  assert.throws(() => auditIntakeAttempts(m,path => {
    const bytes=Uint8Array.from(readPackageArtifact(path)); if(path.includes('CC-BY')) bytes[0]^=1; return bytes;
  }),(error:any) => error.code === 'INTAKE_REFERENCE_TAMPER');
});
test('references cannot masquerade as an acquired asset or a business book',() => {
  const m=load(); m.actualCounts.datasetAssetsAcquired=3; fails(m,'INTAKE_CLAIM_MISMATCH');
  const n=load(); n.sources[0].qualification.coherentBusinessBook=true; fails(n,'INTAKE_CLAIM_MISMATCH');
});
test('customer or row subsets cannot create independent company/configuration holdouts',() => {
  const m=load(); m.sources[0].origins.assignedCompanyFamilyId='customer-17850'; fails(m,'INTAKE_ORIGINS');
  const n=load(); n.sources[0].origins.holdoutAssignment='holdout'; fails(n,'INTAKE_ORIGINS');
});
test('the promised projection cannot claim completed redaction or anonymization',() => {
  const m=load(); m.sources[0].privacyReview.minimizationPerformed=true; fails(m,'INTAKE_CLAIM_MISMATCH');
});
test('generic data cannot enable a named connector or authorize model training',() => {
  const m=load(); m.sources[0].qualification.namedAdapterIds=['tally-prime']; fails(m,'INTAKE_CLAIM_MISMATCH');
  const n=load(); n.sources[0].rightsTraining.pipelineAuthorization='authorized'; fails(n,'INTAKE_TRAINING');
});
test('published metadata must agree with the byte-verified reference snapshot',() => {
  const m=load(); m.sources[0].documentedMetadata.rowCount=3000; fails(m,'INTAKE_CLAIM_MISMATCH');
  const n=load(); n.sources[0].licence.spdx='CC0-1.0'; fails(n,'INTAKE_LICENCE');
});
test('terminal blocked sources cannot claim an alternate acquisition route',() => {
  const m=load(); m.sources[0].acquisition.noAlternateRoute=false; fails(m,'INTAKE_BLOCKER');
  const n=load(); n.sources[1].acquisition.stoppedEndpoint='https://example.invalid/mirror'; fails(n,'INTAKE_BLOCKER');
});
test('path traversal is refused before reading reference bytes',() => {
  const m=load(); m.artifacts[0].path='../outside.txt'; let reads=0;
  assert.throws(() => auditIntakeAttempts(m,() => { reads++; return new Uint8Array(); }),(error:any) => error.code === 'INTAKE_PATH');
  assert.equal(reads,0);
});
test('an impossible calendar timestamp cannot identify an intake snapshot',() => {
  const m=load(); m.recordedAt='2026-02-30T23:40:04Z'; fails(m,'INTAKE_TIMESTAMP');
});
test('a rehashed projection cannot silently retain unnecessary customer identifiers',() => {
  rehashSchemaAndCheck(s => s.columns.find((c:any) => c.sourceName === 'CustomerID').retentionPlan='retain-for-source-receipts');
});
test('a rehashed projection cannot replace a documented column or cite another dataset',() => {
  rehashSchemaAndCheck(s => s.columns[0].sourceName='Email');
  rehashSchemaAndCheck(s => s.datasetId='other-company');
});
test('a rehashed projection cannot substitute floating-point conversion for exact lexical values',() => {
  rehashSchemaAndCheck(s => s.exactDecimalPolicy='Convert prices with Number and round to two places');
});
test('a UCI source cannot borrow the Microsoft primary-reference identity',() => {
  const m=load(); m.sources[0].sourceReferenceArtifactId='microsoft-source-reference'; fails(m,'INTAKE_REFERENCE');
});
test('source and descriptor provenance URLs cannot silently point to a mirror',() => {
  const m=load(); m.sources[0].sourceUrl='https://example.invalid/other'; fails(m,'INTAKE_REFERENCE');
  const n=load(); n.artifacts.find((a:any) => a.id === 'uci-source-reference').sourceUrl='https://example.invalid/other'; fails(n,'INTAKE_REFERENCE');
});
test('a reference descriptor cannot claim archive bytes or omit capture normalization',() => {
  const m=load(); m.artifacts[0].representation='original-dataset-archive'; fails(m,'INTAKE_REPRESENTATION');
  const n=load(); n.artifacts[0].normalization=null; fails(n,'INVALID_CONTRACT');
});
test('licence, permissions and attribution require exact data-only shapes',() => {
  const m=load(); m.sources[0].licence.unreviewedOverride='redistribution-unrestricted'; fails(m,'INVALID_CONTRACT');
  const n=load(); delete n.sources[0].attribution.citation; fails(n,'INVALID_CONTRACT');
  const p=load(); p.sources[0].rights.acquisition={approved:true}; fails(p,'INVALID_CONTRACT');
});
