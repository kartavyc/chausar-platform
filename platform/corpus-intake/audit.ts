import { readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataOnly, exactKeys, hashData, requireThat, sha256Bytes, strings, text } from '../semantic-qualification/src/validation.ts';

type Artifact = { id: string; role: string; representation: string; sourceUrl: string | null; sourceRevision: string; normalization: string; path: string; byteLength: number; sha256: string; originalHttpByteSha256: null };
export type ActualCounts = { datasetAssetsAcquired: 0; retainedDatasetBytes: 0; coherentBusinessBooks: 0; independentCompanyFamilies: 0; independentConfigurationFamilies: 0; namedAdaptersQualified: 0; syntheticCasesAdded: 0; primaryReferenceCaptures: number; derivedSchemaSpecifications: number; acquisitionAttemptReceipts: number; trackedReferenceAndReceiptBytes: number };
const artifactKeys = ['id','role','representation','sourceUrl','sourceRevision','normalization','path','byteLength','sha256','originalHttpByteSha256'];
const roles = new Set(['primary-license-reference','primary-source-reference','derived-schema-reference','acquisition-attempt-reference']);
const sourceIds = ['uci-online-retail','microsoft-adventureworks','microsoft-wide-world-importers'];
const sourceKeys = ['exactArtifactRevision','actualSchemaFingerprint','observedRowCount','privacyReview','origins','qualification','rightsTraining','id','title','publisher','sourceUrl','artifactDownloadUrl','sourceReferenceArtifactId','documentedSchemaArtifactId','sourceType','documentedMetadata','licence','rights','attribution','acquisition','limitations'];
const noDataset = {path:null,sha256:null,byteLength:null};
const exactDecimalPolicy = 'Do not coerce UnitPrice, Quantity or Excel numeric date cells to IEEE-754 values; retain exact source lexical value and cell type; dates require an explicit calendar/profile before conversion.';
const columnRetention = {InvoiceNo:'retain-for-source-receipts',StockCode:'retain-for-product-source-receipts',Description:'drop-before-retention',Quantity:'retain-exact-lexeme',InvoiceDate:'retain-original-cell-type-and-lexeme',UnitPrice:'retain-exact-decimal-lexeme',CustomerID:'drop-before-retention',Country:'drop-before-retention'};
function assertShapeEqual(actual: unknown, expected: unknown, message: string): void {
  requireThat(hashData(actual) === hashData(expected), 'INTAKE_CLAIM_MISMATCH', message);
}
function safePath(value: unknown): asserts value is string {
  requireThat(typeof value === 'string' && value.length <= 1000 && /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]|\/(?=[a-zA-Z0-9]))*$/.test(value) && !value.split('/').some(p => p === '..' || p === '.' || !p), 'INTAKE_PATH', 'Evidence paths must be relative, bounded and inside this package.');
}
function positiveSafeInteger(value: unknown, name: string): asserts value is number {
  requireThat(Number.isSafeInteger(value) && (value as number) > 0, 'INTAKE_BYTE_COUNT', `${name} must be a positive safe integer.`);
}

/** This audits stopped attempts and reference captures. It cannot admit data or qualify an adapter. */
export function auditIntakeAttempts(value: unknown, readArtifact: (path: string) => Uint8Array): ActualCounts {
  dataOnly(value);
  exactKeys(value, ['contractVersion','kind','recordedAt','preservedImplementationCommit','scope','artifacts','sources','actualCounts','nextStep']);
  const m = value as Record<string, any>;
  requireThat(m.contractVersion === 1 && m.kind === 'blocked-corpus-intake-attempt-register', 'INTAKE_CONTRACT', 'This contract records terminal blocked attempts only.');
  requireThat(m.preservedImplementationCommit === 'fe26fa945ccd847aad45310668853e67d0077f66', 'INTAKE_BASELINE', 'The queued semantic implementation must remain identified separately.');
  requireThat(typeof m.recordedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(m.recordedAt), 'INTAKE_TIMESTAMP', 'Record a UTC snapshot timestamp.');
  const timestamp = new Date(m.recordedAt);
  requireThat(Number.isFinite(timestamp.getTime()) && timestamp.toISOString().replace('.000Z','Z') === m.recordedAt,'INTAKE_TIMESTAMP','Snapshot timestamps must be real canonical calendar instants.');
  exactKeys(m.scope,['targetIndependentConfigurationBundles','requestedConnectorGroups','genericDatasetsDoNotQualifyNamedAdapters','syntheticBundlesAdded','noAccountsPaymentsLiveEffects']);
  assertShapeEqual(m.scope.targetIndependentConfigurationBundles,{minimum:1500,maximum:3000,status:'aspirational-research-target-not-acquired'},'Targets cannot become acquired counts.');
  requireThat(m.scope.requestedConnectorGroups === 56 && m.scope.genericDatasetsDoNotQualifyNamedAdapters === true && m.scope.syntheticBundlesAdded === 0 && m.scope.noAccountsPaymentsLiveEffects === true,'INTAKE_SCOPE','The accepted scope and no-live-effects policy must be explicit.');
  requireThat(Array.isArray(m.artifacts) && m.artifacts.length === 5,'INTAKE_ARTIFACTS','Retain five separately hashed reference/schema/attempt artifacts.');
  const artifacts = new Map<string, {descriptor: Artifact; bytes: Uint8Array}>();
  const paths = new Set<string>();
  for (const a of m.artifacts) {
    exactKeys(a, artifactKeys); text(a.id,'artifact id'); safePath(a.path); positiveSafeInteger(a.byteLength,'reference byteLength');
    const representationByRole = {'primary-license-reference':'normalized-web-text','primary-source-reference':'curated-web-metadata','derived-schema-reference':'authored-projection-plan','acquisition-attempt-reference':'curated-tool-outcome'};
    requireThat(a.representation === representationByRole[a.role as keyof typeof representationByRole],'INTAKE_REPRESENTATION','Reference roles require the declared retained representation; none is a dataset archive.');
    if (a.sourceUrl !== null) text(a.sourceUrl,'artifact source URL');
    text(a.sourceRevision,'reference revision'); text(a.normalization,'reference normalization');
    requireThat(roles.has(a.role) && !artifacts.has(a.id) && !paths.has(a.path),'INTAKE_ARTIFACTS','Only unique reference, schema and attempt evidence is allowed.');
    requireThat(typeof a.sha256 === 'string' && /^[a-f0-9]{64}$/.test(a.sha256) && a.originalHttpByteSha256 === null,'INTAKE_DIGEST','A retained reference hash is not an original source-byte hash.');
    const bytes = readArtifact(a.path);
    requireThat(bytes instanceof Uint8Array && bytes.byteLength === a.byteLength && sha256Bytes(bytes) === a.sha256,'INTAKE_REFERENCE_TAMPER','Retained reference bytes must match the immutable capture receipt.');
    artifacts.set(a.id,{descriptor:a as Artifact,bytes}); paths.add(a.path);
  }
  const requiredReferences = [['license-cc-by-4.0','primary-license-reference'],['uci-source-reference','primary-source-reference'],['microsoft-source-reference','primary-source-reference'],['uci-documented-schema','derived-schema-reference'],['acquisition-attempt-receipts','acquisition-attempt-reference']];
  for (const [id,role] of requiredReferences) requireThat(artifacts.get(id)?.descriptor.role === role,'INTAKE_ARTIFACTS','Required evidence must retain its reference role.');
  const referenceUrls = {'license-cc-by-4.0':'https://creativecommons.org/licenses/by/4.0/legalcode.txt','uci-source-reference':'https://archive.ics.uci.edu/dataset/352/online%2Bretail','microsoft-source-reference':'https://learn.microsoft.com/en-us/sql/samples/sql-samples-where-are?view=sql-server-ver17','uci-documented-schema':'https://archive.ics.uci.edu/dataset/352/online%2Bretail','acquisition-attempt-receipts':null};
  for (const [id,url] of Object.entries(referenceUrls)) requireThat(artifacts.get(id)!.descriptor.sourceUrl === url,'INTAKE_REFERENCE','Reference descriptors must retain the exact official source URL or explicit local-receipt origin.');
  const uciReference = JSON.parse(Buffer.from(artifacts.get('uci-source-reference')!.bytes).toString('utf8'));
  const microsoftReference = JSON.parse(Buffer.from(artifacts.get('microsoft-source-reference')!.bytes).toString('utf8'));
  const documentedSchema = JSON.parse(Buffer.from(artifacts.get('uci-documented-schema')!.bytes).toString('utf8'));
  dataOnly(uciReference); dataOnly(microsoftReference); dataOnly(documentedSchema);
  requireThat(uciReference.sourceUrl === referenceUrls['uci-source-reference'] && microsoftReference.sourceUrl === referenceUrls['microsoft-source-reference'],'INTAKE_REFERENCE','Curated reference bodies must match their descriptor source URLs.');
  requireThat(documentedSchema.contractVersion === 1 && documentedSchema.kind === 'documented-schema-and-minimization-plan' && documentedSchema.datasetId === 'uci-online-retail' && documentedSchema.sourceReferenceArtifactId === 'uci-source-reference','INTAKE_SCHEMA','The authored projection must identify its dataset and captured schema source.');
  requireThat(documentedSchema.evidenceStatus === 'documentation-only-not-observed' && documentedSchema.privacyState === 'not-inspected-not-redacted' && documentedSchema.qualificationState === 'unqualified','INTAKE_SCHEMA','A projection plan is neither observed data nor completed privacy work.');
  requireThat(documentedSchema.expectedWorksheetName === null && documentedSchema.expectedWorksheetNameStatus === 'unverified' && documentedSchema.expectedColumnOrderStatus === 'unverified','INTAKE_SCHEMA','Uninspected worksheet/order details cannot be asserted as observed.');
  requireThat(Array.isArray(documentedSchema.columns) && documentedSchema.columns.length === 8,'INTAKE_SCHEMA','Retain all eight documented source-column declarations.');
  assertShapeEqual(documentedSchema.columns.map((c:any) => c.sourceName),uciReference.claims.columnNamesReported,'Column declarations must match the captured UCI documentation.');
  for (const column of documentedSchema.columns) {
    exactKeys(column,['sourceName','documentedType','retentionPlan','semanticLimits']);
    requireThat(column.retentionPlan === columnRetention[column.sourceName as keyof typeof columnRetention],'INTAKE_SCHEMA','Customer/location/free-text exclusions and retained lexical values must match the documented projection.');
  }
  requireThat(documentedSchema.exactDecimalPolicy === exactDecimalPolicy,'INTAKE_SCHEMA','The projection must retain exact lexical numeric values until an explicit interpretation profile exists.');
  assertShapeEqual(documentedSchema.allowedProjectedColumnNames,['InvoiceNo','StockCode','Quantity','InvoiceDate','UnitPrice'],'The planned retained projection must omit customer/location/free-text columns.');
  const receipt = JSON.parse(Buffer.from(artifacts.get('acquisition-attempt-receipts')!.bytes).toString('utf8'));
  dataOnly(receipt);
  requireThat(receipt.kind === 'terminal-public-acquisition-attempt-receipts' && receipt.attempts.length === 2 && receipt.accountsCreated === 0 && receipt.paymentsMade === 0 && receipt.userDetailsSubmitted === false && receipt.alternateAcquisitionRoutesUsed === false,'INTAKE_ATTEMPTS','No accounts, payments, user details or alternate routes may be claimed or used.');
  const attempts = new Map<string, any>();
  for (const a of receipt.attempts) {
    requireThat(a.result === 'blocked' && a.datasetBytesMaterialized === 0 && a.retried === false && !attempts.has(a.id),'INTAKE_ATTEMPTS','Blocked source attempts are terminal and materialized no dataset bytes.');
    text(a.toolError,'attempt tool error'); attempts.set(a.id,a);
  }
  requireThat(Array.isArray(m.sources) && m.sources.length === 3,'INTAKE_SOURCES','Identify UCI and both Microsoft sample families separately.');
  const seen = new Set<string>();
  for (const s of m.sources) {
    exactKeys(s,sourceKeys);
    for (const key of ['id','title','publisher','sourceUrl','sourceReferenceArtifactId','sourceType']) text(s[key],`source ${key}`);
    for (const key of ['artifactDownloadUrl','documentedSchemaArtifactId']) if (s[key] !== null) text(s[key],`source ${key}`);
    requireThat(['official-generic-transaction-dataset','official-generic-sample-database'].includes(s.sourceType),'INTAKE_SOURCES','Use an explicit generic source type.');
    exactKeys(s.documentedMetadata,['fileName','fileSizeText','rowCount','businessOrigins','verification']);
    for (const key of ['fileName','fileSizeText']) if (s.documentedMetadata[key] !== null) text(s.documentedMetadata[key],`documented ${key}`);
    for (const key of ['rowCount','businessOrigins']) requireThat(s.documentedMetadata[key] === null || Number.isSafeInteger(s.documentedMetadata[key]) && s.documentedMetadata[key] >= 0,'INTAKE_METADATA','Published counts are null or nonnegative safe integers.');
    exactKeys(s.licence,['spdx','version','status','textArtifactId','textRevision','exactArtifactApplicability','noticeRequirements']);
    for (const key of ['spdx','version','status','exactArtifactApplicability']) text(s.licence[key],`licence ${key}`);
    for (const key of ['textArtifactId','textRevision']) if (s.licence[key] !== null) text(s.licence[key],`licence ${key}`);
    strings(s.licence.noticeRequirements,'licence notices');
    exactKeys(s.rights,['acquisition','reuse','redistribution','termsStatus']);
    for (const key of ['acquisition','reuse','redistribution','termsStatus']) text(s.rights[key],`rights ${key}`);
    exactKeys(s.attribution,['creator','citation','changes']);
    for (const key of ['creator','citation','changes']) text(s.attribution[key],`attribution ${key}`);
    strings(s.limitations,'source limitations');
    requireThat(sourceIds.includes(s.id) && !seen.has(s.id),'INTAKE_SOURCES','Each requested generic source appears once.'); seen.add(s.id);
    requireThat(s.exactArtifactRevision === null && s.actualSchemaFingerprint === null && s.observedRowCount === null,'INTAKE_OBSERVATION','Documentation is not an observed artifact, schema or row count.');
    assertShapeEqual(s.privacyReview,{state:'not-inspected',minimizationPerformed:false,anonymizationClaim:false,contactInformationIngested:false},'No privacy transformation was performed on unacquired rows.');
    exactKeys(s.origins,['assignedCompanyFamilyId','assignedTemplateFamilyId','assignedConfigurationFamilyId','holdoutAssignment','familyRule']);
    text(s.origins.familyRule,'independent origin family rule');
    requireThat(s.origins.assignedCompanyFamilyId === null && s.origins.assignedTemplateFamilyId === null && s.origins.assignedConfigurationFamilyId === null && s.origins.holdoutAssignment === 'unassigned','INTAKE_ORIGINS','No acquired independent company, template or configuration origin is assigned.');
    assertShapeEqual(s.qualification,{state:'unqualified',coherentBusinessBook:false,namedAdapterIds:[],perOperationEvidence:[],arbitraryCompanyGuarantee:false},'References cannot establish books or operation/adapter qualification.');
    exactKeys(s.rightsTraining,['copyrightBasis','explicitTrainingTerms','pipelineAuthorization','dataDisclosedToModels']);
    text(s.rightsTraining.copyrightBasis,'training copyright basis');
    requireThat(s.rightsTraining.explicitTrainingTerms === false && s.rightsTraining.pipelineAuthorization === 'not-authorized-or-run' && s.rightsTraining.dataDisclosedToModels === false,'INTAKE_TRAINING','A copyright licence is separate from activated model disclosure or training.');
    requireThat(artifacts.get(s.sourceReferenceArtifactId)?.descriptor.role === 'primary-source-reference','INTAKE_REFERENCE','Source assertions require a hashed primary reference capture.');
    requireThat(s.documentedSchemaArtifactId === null || artifacts.get(s.documentedSchemaArtifactId)?.descriptor.role === 'derived-schema-reference','INTAKE_SCHEMA','A proposed schema cannot be represented as observed rows.');
    requireThat(s.documentedMetadata.verification === 'documentation-only','INTAKE_METADATA','Published file sizes/rows are documentation-only.');
    requireThat(s.licence.textArtifactId === null || artifacts.get(s.licence.textArtifactId)?.descriptor.role === 'primary-license-reference','INTAKE_LICENCE','Licence text is independently identified from dataset bytes.');
    if (s.id === 'uci-online-retail') {
      requireThat(s.sourceReferenceArtifactId === 'uci-source-reference' && s.sourceUrl === uciReference.sourceUrl && s.publisher === uciReference.publisher && s.title === uciReference.title,'INTAKE_REFERENCE','UCI provenance must identify its own primary source and captured publisher/title.');
      assertShapeEqual(s.documentedMetadata,{fileName:uciReference.claims.fileNameReported,fileSizeText:uciReference.claims.fileSizeReported,rowCount:uciReference.claims.instancesReported,businessOrigins:uciReference.claims.businessOriginsReported,verification:'documentation-only'},'Published UCI metadata must match the captured reference.');
      requireThat(s.licence.spdx === uciReference.claims.license && s.licence.status === 'dataset-licence-verified-from-official-metadata' && s.licence.textArtifactId === 'license-cc-by-4.0' && s.documentedSchemaArtifactId === 'uci-documented-schema','INTAKE_LICENCE','Retain the documented UCI dataset licence and schema provenance.');
    } else {
      requireThat(s.sourceReferenceArtifactId === 'microsoft-source-reference' && s.sourceUrl === microsoftReference.sourceUrl && s.publisher === microsoftReference.publisher && microsoftReference.claims.sampleNames.includes(s.title),'INTAKE_REFERENCE','Microsoft sample provenance must identify the captured Microsoft source and sample name.');
      assertShapeEqual(s.documentedMetadata,{fileName:null,fileSizeText:null,rowCount:null,businessOrigins:null,verification:'documentation-only'},'No Microsoft backup metadata was acquired.');
      requireThat(s.licence.spdx === microsoftReference.claims.licenseReported && s.licence.status === 'official-repository-claim-only' && s.licence.textArtifactId === null && s.licence.textRevision === null && s.documentedSchemaArtifactId === null,'INTAKE_LICENCE','Repository-level licence references do not establish exact sample asset notices.');
    }
    exactKeys(s.acquisition,['state','attemptId','stopReason','stoppedEndpoint','terminal','noAlternateRoute','originalDataset','retainedDataset','actualRetainedDatasetBytes']);
    const a = s.acquisition; const attempted = attempts.get(a.attemptId);
    for (const key of ['state','attemptId','stopReason','stoppedEndpoint']) text(a[key],`acquisition ${key}`);
    requireThat(a.state === 'blocked' && a.terminal === true && a.noAlternateRoute === true && a.actualRetainedDatasetBytes === 0 && attempted?.affectedSourceIds.includes(s.id) && attempted.url === a.stoppedEndpoint && attempted.stopReason === a.stopReason,'INTAKE_BLOCKER','The exact stopped attempt and endpoint must match the source receipt.');
    assertShapeEqual(a.originalDataset,noDataset,'No original hash/size/path can be fabricated for an unacquired artifact.');
    assertShapeEqual(a.retainedDataset,noDataset,'No retained hash/size/path can be fabricated for an unacquired artifact.');
  }
  const descriptors = [...artifacts.values()].map(a => a.descriptor);
  const counts: ActualCounts = {datasetAssetsAcquired:0,retainedDatasetBytes:0,coherentBusinessBooks:0,independentCompanyFamilies:0,independentConfigurationFamilies:0,namedAdaptersQualified:0,syntheticCasesAdded:0,
    primaryReferenceCaptures:descriptors.filter(a => a.role.startsWith('primary-')).length,
    derivedSchemaSpecifications:descriptors.filter(a => a.role === 'derived-schema-reference').length,
    acquisitionAttemptReceipts:descriptors.filter(a => a.role === 'acquisition-attempt-reference').length,
    trackedReferenceAndReceiptBytes:descriptors.reduce((n,a) => n + a.byteLength,0)};
  assertShapeEqual(m.actualCounts,counts,'Counts must reflect byte-verified reference evidence; dataset/company/qualification counts remain zero.');
  text(m.nextStep,'next intake step'); return counts;
}

const packageRoot = dirname(fileURLToPath(import.meta.url));
export function readPackageArtifact(path: string): Uint8Array {
  safePath(path);
  const base = realpathSync(packageRoot); const target = realpathSync(resolve(base,path)); const inside = relative(base,target);
  requireThat(inside !== '' && !isAbsolute(inside) && inside !== '..' && !inside.startsWith(`..${sep}`),'INTAKE_PATH','Resolved evidence paths must stay inside this package.');
  return readFileSync(target);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = JSON.parse(readFileSync(resolve(packageRoot,'manifest.json'),'utf8'));
  console.log(JSON.stringify(auditIntakeAttempts(manifest,readPackageArtifact),null,2));
}
