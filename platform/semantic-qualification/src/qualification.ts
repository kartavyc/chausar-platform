import type { CompiledMapping, DatasetManifest, GoldenCase, OperationEvidence, SourceBatch, SourceReport, SplitPlan } from './contracts.ts';
import { KINDS, OPERATIONS, assertCompiled } from './compiler.ts';
import { evaluateOperation, mapBatch } from './mapping.ts';
import { canonicalJson, dataOnly, digest, exactKeys, hashData, issue, record, requireThat, sha256Bytes, strings, text, validatePeriod } from './validation.ts';
import { appendEvidence, verifyLedger } from './ledger.ts';

export type QualificationInput = {
  compiled: CompiledMapping; batch: SourceBatch; report: SourceReport;
  manifest: DatasetManifest; provenance: DatasetManifest[];
  artifactBytes: Record<string, string | Uint8Array>;
  splitPlan: SplitPlan; goldenCase: GoldenCase; at: string;
};
export function reportPayload(report: SourceReport) { const { evidenceHash: _hash,...payload } = report; return payload; }
function validateManifest(manifest: DatasetManifest, bytes: QualificationInput['artifactBytes']) {
  exactKeys(manifest,['contractVersion','id','title','origin','category','source','rights','artifacts','limitations'],'dataset manifest');
  requireThat(manifest.contractVersion === 1,'UNSUPPORTED_VERSION','Unknown dataset-manifest version.'); text(manifest.id,'dataset ID'); text(manifest.title,'dataset title');
  requireThat(['synthetic','official-public','authorized-upload'].includes(manifest.origin),'INVALID_PROVENANCE','The dataset origin must be declared.');
  requireThat(['reference-schema','business-books','configuration-family','synthetic-cases'].includes(manifest.category),'INVALID_PROVENANCE','Count schemas, business books, configuration families and synthetic cases separately.');
  exactKeys(manifest.source,['publisher','url','retrievedAt','productVersion'],'source provenance');
  text(manifest.source.publisher,'source publisher'); text(manifest.source.productVersion,'source product version'); text(manifest.source.retrievedAt,'retrieval date');
  requireThat(Number.isFinite(Date.parse(manifest.source.retrievedAt)),'INVALID_PROVENANCE','A provenance retrieval date is required.');
  requireThat(manifest.source.url === null || (typeof manifest.source.url === 'string' && /^https:\/\//.test(manifest.source.url)),'INVALID_PROVENANCE','Source provenance uses an explicit HTTPS reference or null for a local authorized/synthetic source.');
  exactKeys(manifest.rights,['status','license','evidence','permittedUses','personalData','permissions'],'dataset rights');
  text(manifest.rights.license,'license'); text(manifest.rights.evidence,'rights evidence');
  strings(manifest.rights.permittedUses,'permitted uses');
  requireThat(manifest.rights.permittedUses.every(use => ['qualification','redistribution'].includes(use)),'RIGHTS_UNRESOLVED','Only explicitly recorded uses are accepted.');
  exactKeys(manifest.rights.permissions,['acquisition','reuse','redistribution','training'],'per-use permissions');
  requireThat(Object.values(manifest.rights.permissions).every(p => ['allowed','unknown','denied'].includes(p)),'RIGHTS_UNRESOLVED','Record acquisition, reuse, redistribution and training permission separately.');
  requireThat(manifest.rights.status === 'allowed' && manifest.rights.permittedUses.includes('qualification') && manifest.rights.permissions.acquisition === 'allowed' && manifest.rights.permissions.reuse === 'allowed','RIGHTS_UNRESOLVED','The dataset lacks explicit acquisition and qualification reuse rights; public availability is insufficient.');
  requireThat(['none','redacted'].includes(manifest.rights.personalData),'PERSONAL_DATA_UNREVIEWED','Qualification requires reviewed synthetic, absent or redacted personal data.');
  strings(manifest.limitations,'limitations',true);
  requireThat(Array.isArray(manifest.artifacts) && manifest.artifacts.length > 0 && manifest.artifacts.length <= 100,'ARTIFACT_MISSING','Dataset evidence artifacts are required.');
  const paths = new Set<string>();
  for (const artifact of manifest.artifacts) {
    exactKeys(artifact,['path','sha256','role'],'dataset artifact'); digest(artifact.sha256);
    requireThat(typeof artifact.path === 'string' && /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(artifact.path) && !artifact.path.split('/').some(p => p === '.' || p === '..') && !paths.has(artifact.path),'ARTIFACT_PATH','Artifact paths must be unique relative data paths.'); paths.add(artifact.path);
    requireThat(['source-rows','source-report','golden-cases','schema-reference','authorization'].includes(artifact.role),'INVALID_PROVENANCE','Unknown artifact role.');
    requireThat(Object.hasOwn(bytes,artifact.path),'ARTIFACT_MISSING','Every manifest artifact must be supplied as consumer-local verified bytes.');
    const value = bytes[artifact.path]; requireThat(typeof value === 'string' || value instanceof Uint8Array,'INVALID_ARTIFACT','Artifacts require exact bytes.');
    requireThat((typeof value === 'string' ? Buffer.byteLength(value) : value.byteLength) <= 16 * 1024 * 1024,'ARTIFACT_LIMIT','Artifact exceeds the sixteen megabyte qualification budget.');
    requireThat(sha256Bytes(value) === artifact.sha256,'ARTIFACT_HASH_MISMATCH','A dataset artifact does not match its provenance manifest.');
  }
}
export function validateSplit(plan: SplitPlan) {
  dataOnly(plan); exactKeys(plan,['contractVersion','id','mappingFingerprint','reviewer','tuning','holdout','disclosure','evidence'],'split plan');
  requireThat(plan.contractVersion === 1,'UNSUPPORTED_VERSION','Unknown split-plan version.'); digest(plan.mappingFingerprint); text(plan.id,'split ID'); text(plan.reviewer,'independent reviewer'); text(plan.evidence,'split evidence');
  requireThat(['public-synthetic','sealed-authorized'].includes(plan.disclosure),'INVALID_SPLIT','The holdout disclosure must be explicit.');
  for (const split of [plan.tuning,plan.holdout]) {
    requireThat(Array.isArray(split) && split.length > 0 && split.length <= 2000,'INVALID_SPLIT','Both tuning and holdout business sets are required.');
    for (const entry of split) {
      exactKeys(entry,['businessId','datasetId','rowsHash','origins'],'split entry'); text(entry.businessId,'business ID'); text(entry.datasetId,'dataset ID'); digest(entry.rowsHash);
      exactKeys(entry.origins,['business','template','configuration'],'origin families'); Object.entries(entry.origins).forEach(([k,v])=>text(v,k));
    }
    requireThat(new Set(split.map(e=>e.datasetId)).size === split.length,'INVALID_SPLIT','A dataset appears twice in the same split.');
  }
  for (const key of ['businessId','datasetId','rowsHash'] as const) {
    const tuning = new Set(plan.tuning.map(e=>e[key])); requireThat(plan.holdout.every(e=>!tuning.has(e[key])),'HOLDOUT_LEAKAGE','Hold out entire companies and coherent datasets; row splits and alternate exports are not independent businesses.');
  }
  for (const origin of ['business','template','configuration'] as const) {
    const tuning = new Set(plan.tuning.map(e=>e.origins[origin])); requireThat(plan.holdout.every(e=>!tuning.has(e.origins[origin])),'HOLDOUT_LEAKAGE','Holdout business, template and configuration origin families must be disjoint from tuning.');
  }
}
function validateReport(input: QualificationInput, mapped: ReturnType<typeof mapBatch>) {
  const {compiled,batch,report,manifest} = input;
  exactKeys(report,['reportId','datasetId','origin','captureMethod','evidenceHash','company','system','snapshotId','dateBasis','period','branches','taxRegistrations','sourceRowCount','includedRowCount','excludedRowCount','totals'],'source report');
  text(report.reportId,'source report ID'); digest(report.evidenceHash); validatePeriod(report.period); strings(report.branches,'report branches'); strings(report.taxRegistrations,'report tax registrations');
  requireThat(report.origin === 'independent-source-report' && report.reportId !== batch.receiptId,'SOURCE_TOTALS_REQUIRED','An independently captured source report with its own identity is required.');
  requireThat(report.captureMethod === (manifest.origin === 'synthetic' ? 'hand-worked-synthetic':'upstream-report'),'SOURCE_TOTALS_REQUIRED','Real source data needs upstream source controls; synthetic controls must be labelled hand-worked.');
  requireThat(report.datasetId === batch.datasetId && report.company === batch.company && report.system === batch.system && report.snapshotId === batch.snapshotId && report.dateBasis === compiled.pack.semantics.dateBasis && hashData(report.period) === hashData(compiled.rules.period) && hashData([...report.branches].sort()) === hashData([...compiled.rules.branches].sort()) && hashData([...report.taxRegistrations].sort()) === hashData([...compiled.rules.taxRegistrations].sort()),'REPORT_SCOPE_MISMATCH','Source controls must have the exact company, branches, tax registration, date basis, period and stable snapshot.');
  for (const n of [report.sourceRowCount,report.includedRowCount,report.excludedRowCount]) requireThat(Number.isSafeInteger(n) && n >= 0,'INVALID_SOURCE_TOTALS','Source coverage counts require nonnegative integers.');
  requireThat(report.sourceRowCount === mapped.sourceRowCount && report.includedRowCount === mapped.facts.length && report.excludedRowCount === mapped.exclusions.length && report.includedRowCount + report.excludedRowCount === report.sourceRowCount,'SOURCE_ROW_MISMATCH','Included, excluded and total source row counts do not reconcile to the independent source report.');
  requireThat(Array.isArray(report.totals) && report.totals.length <= 120,'INVALID_SOURCE_TOTALS','Bounded per-kind, per-currency source controls are required.');
  const keys = new Set<string>();
  for (const total of report.totals) {
    exactKeys(total,['kind','currency','netMinor','taxMinor','grossMinor'],'control total');
    requireThat((KINDS as readonly string[]).includes(total.kind) && Object.hasOwn(compiled.rules.currencies,total.currency),'INVALID_SOURCE_TOTALS','Source controls require declared event kinds and currencies.');
    for (const amount of [total.netMinor,total.taxMinor,total.grossMinor]) requireThat(typeof amount === 'string' && /^(?:0|[1-9]\d*)$/.test(amount) && amount.length <= 100,'INVALID_SOURCE_TOTALS','Controls need positive exact integer minor-unit strings.');
    requireThat(BigInt(total.netMinor)+BigInt(total.taxMinor) === BigInt(total.grossMinor),'INVALID_SOURCE_TOTALS','Independent net, tax and gross source totals must agree.');
    const key = `${total.kind}:${total.currency}`; requireThat(!keys.has(key),'INVALID_SOURCE_TOTALS','Duplicate source control buckets are refused.'); keys.add(key);
  }
  const sort = (a: SourceReport['totals']) => [...a].sort((x,y)=>`${x.kind}:${x.currency}`.localeCompare(`${y.kind}:${y.currency}`));
  requireThat(hashData(sort(report.totals)) === hashData(mapped.controls),'SOURCE_TOTAL_MISMATCH','Mapped net, tax and gross controls do not equal the independent source totals for each event kind and currency.');
}
function validateEvidenceInputs(input: QualificationInput) {
  const {compiled,batch,manifest,provenance,artifactBytes,splitPlan,goldenCase,report} = input;
  dataOnly({compiled,batch,manifest,provenance,splitPlan,goldenCase,report,at:input.at}); assertCompiled(compiled);
  text(input.at,'qualification time'); requireThat(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.at) && Number.isFinite(Date.parse(input.at)) && new Date(input.at).toISOString() === input.at,'INVALID_TIME','Qualification time must be a real, explicit UTC ISO timestamp.');
  record(artifactBytes,'artifact bytes');
  validateManifest(manifest,artifactBytes);
  requireThat(batch.system === 'synthetic-register' && manifest.origin === 'synthetic','SYSTEM_PROFILE_UNQUALIFIED','This executable prototype qualifies authored synthetic-register profiles only. Generic books and public examples cannot certify a named vendor; native per-version profiles, rights and source controls remain required.');
  requireThat(manifest.id === batch.datasetId && manifest.category !== 'reference-schema','DATASET_SCOPE_MISMATCH','Reference documentation alone cannot qualify a connector or substitute for a coherent source dataset.');
  requireThat(Array.isArray(provenance) && provenance.length <= 20,'PROVENANCE_MISSING','Resolve product-pack and company-rule provenance manifests.');
  const all = [manifest,...provenance]; requireThat(new Set(all.map(m=>m.id)).size === all.length,'INVALID_PROVENANCE','Provenance IDs must identify unique manifests.');
  for (const m of provenance) validateManifest(m,artifactBytes);
  for (const id of [...compiled.pack.provenanceIds,...compiled.rules.provenanceIds]) requireThat(all.some(m=>m.id === id),'PROVENANCE_MISSING','Every pack and company-rule provenance reference must resolve to a rights-reviewed manifest.');
  const role = (name:DatasetManifest['artifacts'][number]['role'],hash:string) => requireThat(manifest.artifacts.filter(a=>a.role === name).length === 1 && manifest.artifacts.some(a=>a.role === name && a.sha256 === hash),'ARTIFACT_BINDING_MISMATCH','Source rows, independent controls and the golden case each need their own byte-verified manifest artifact.');
  role('source-rows',batch.rowsHash); role('source-report',report.evidenceHash); role('golden-cases',hashData(goldenCase));
  requireThat(hashData(reportPayload(report)) === report.evidenceHash && report.evidenceHash !== batch.rowsHash,'SOURCE_TOTALS_REQUIRED','The independent report receipt differs from its captured controls or from the source row artifact.');
  validateSplit(splitPlan); requireThat(splitPlan.mappingFingerprint === compiled.productFingerprint,'SPLIT_MAPPING_MISMATCH','The split plan was not frozen for this product mapping and compiler version.');
  exactKeys(goldenCase,['id','businessId','datasetId','rationale','split','expectedDecision','expectedIssueCodes','expectations','semanticAssertions','exclusionAssertions'],'golden case');
  ['id','businessId','datasetId','rationale'].forEach(k=>text((goldenCase as any)[k],k));
  requireThat(goldenCase.datasetId === batch.datasetId && goldenCase.businessId === batch.company && ['tuning','holdout'].includes(goldenCase.split),'GOLDEN_SCOPE_MISMATCH','The independent golden business case must match this complete dataset and company.');
  requireThat(['qualified','abstained','invalidated'].includes(goldenCase.expectedDecision),'INVALID_GOLDEN_CASE','Declare the expected decision.'); strings(goldenCase.expectedIssueCodes,'expected issues',true);
  const entry = splitPlan[goldenCase.split].find(e=>e.datasetId === batch.datasetId);
  requireThat(entry && entry.businessId === goldenCase.businessId && entry.rowsHash === batch.rowsHash && hashData(entry.origins) === hashData(batch.origins),'HOLDOUT_SCOPE_MISMATCH','This dataset or origin is not the predeclared whole-business split member.');
  requireThat(manifest.origin === 'synthetic' ? splitPlan.disclosure === 'public-synthetic' : splitPlan.disclosure === 'sealed-authorized','INVALID_SPLIT','Public synthetic cases cannot claim a sealed authorized business holdout.');
  requireThat(Array.isArray(goldenCase.expectations) && goldenCase.expectations.length === compiled.ontology.operations.length && new Set(goldenCase.expectations.map(e=>e.operation)).size === goldenCase.expectations.length,'GOLDEN_COVERAGE_MISSING','Every declared operation requires one independent golden expectation.');
  for (const e of goldenCase.expectations) {
    exactKeys(e,['operation','values'],'operation expectation'); requireThat(compiled.ontology.operations.includes(e.operation),'GOLDEN_COVERAGE_MISSING','Golden expectations must match the declared operation catalogue.');
    requireThat(Array.isArray(e.values) && e.values.length <= 20 && new Set(e.values.map(v=>v.currency)).size === e.values.length,'INVALID_GOLDEN_CASE','Each golden currency needs one expected exact amount.');
    for (const v of e.values) { exactKeys(v,['currency','minor'],'golden amount'); requireThat(Object.hasOwn(compiled.rules.currencies,v.currency) && typeof v.minor === 'string' && /^-?(?:0|[1-9]\d*)$/.test(v.minor),'INVALID_GOLDEN_CASE','Golden amounts require a declared currency and exact integer minor-unit strings.'); }
  }
  requireThat(Array.isArray(goldenCase.semanticAssertions) && goldenCase.semanticAssertions.length <= 2000 && Array.isArray(goldenCase.exclusionAssertions) && goldenCase.exclusionAssertions.length <= 2000,'GOLDEN_COVERAGE_MISSING','Independent golden rows and exclusion assertions are required, not solely money totals or prose rationale.');
  for (const f of goldenCase.semanticAssertions) {
    exactKeys(f,['entityId','kind','date','company','branch','taxRegistration','currency','currencyScale','netMinor','taxMinor','grossMinor','quantity','unit','relatedIdentity','sourceRow'],'golden semantic row');
    requireThat(Number.isSafeInteger(f.sourceRow) && f.sourceRow >= 1 && f.sourceRow <= report.sourceRowCount,'INVALID_GOLDEN_CASE','Golden source positions are one-based rows in the independent complete source report.');
  }
  for (const e of goldenCase.exclusionAssertions) { exactKeys(e,['entityId','row','reason'],'golden exclusion'); requireThat(Number.isSafeInteger(e.row) && e.row >= 1 && e.row <= report.sourceRowCount,'INVALID_GOLDEN_CASE','Golden exclusion positions are one-based rows in the independent complete source report.'); }
}
/** No database or network effect. Ledger publication is local and explicit. */
export function qualifyCase(input: QualificationInput, ledger: OperationEvidence[] = []) {
  exactKeys(input,['compiled','batch','report','manifest','provenance','artifactBytes','splitPlan','goldenCase','at'],'qualification envelope');
  verifyLedger(ledger);
  const {compiled,batch,report,manifest,splitPlan,goldenCase} = input;
  // Rights, personal-data review, artifact bytes and split admission precede all mapping/arithmetic.
  // Invalid admission throws without retaining source values or appending operation receipts.
  validateEvidenceInputs(input);
  const mapped = mapBatch(compiled,batch), problems = [...mapped.issues];
  try { if (mapped.decision === 'mapped') validateReport(input,mapped); }
  catch (error) { problems.push(issue(error)); }
  const actualDecision = mapped.decision === 'invalidated' ? 'invalidated' : problems.length ? 'abstained' : 'qualified';
  if (goldenCase.expectedDecision !== actualDecision) problems.push({code:'GOLDEN_DECISION_MISMATCH',message:'The mapping decision differs from the independently authored business case.'});
  const actualCodes = [...new Set(problems.filter(p=>p.code !== 'GOLDEN_DECISION_MISMATCH').map(p=>p.code))].sort();
  if (hashData(actualCodes) !== hashData([...goldenCase.expectedIssueCodes].sort())) problems.push({code:'GOLDEN_ISSUE_MISMATCH',message:'The semantic issues differ from the independent business case; expected refusal evidence cannot be ignored.'});
  const results = new Map<string,ReturnType<typeof evaluateOperation>>();
  if (!problems.length && mapped.decision === 'mapped') {
    const actualRows = mapped.facts.map(({source,...fact})=>({...fact,sourceRow:source.row}));
    if (hashData(actualRows) !== hashData(goldenCase.semanticAssertions) || hashData(mapped.exclusions) !== hashData(goldenCase.exclusionAssertions)) problems.push({code:'GOLDEN_SEMANTIC_MISMATCH',message:'Identity, kind, date, currency, units, quantities, refund links, scope, tax values or exclusions differ from the independent per-row semantic assertions.'});
  }
  if (!problems.length && mapped.decision === 'mapped') for (const operation of compiled.ontology.operations) {
    const result = evaluateOperation(operation,mapped.facts), expected = goldenCase.expectations.find(e=>e.operation === operation)!;
    results.set(operation,result);
    if (hashData([...result.values].sort((a,b)=>a.currency.localeCompare(b.currency))) !== hashData([...expected.values].sort((a,b)=>a.currency.localeCompare(b.currency)))) problems.push({code:'GOLDEN_MISMATCH',message:`Operation ${operation} differs from its independently hand-worked business expectation.`});
  }
  const decisions: OperationEvidence[] = [];
  for (const operation of compiled.ontology.operations) {
    const operationIssues = [...problems], result = results.get(operation) ?? {values:[],countedRows:[]};
    const decision = mapped.decision === 'invalidated' ? 'invalidated' as const : operationIssues.length ? 'abstained' as const : 'qualified' as const;
    const evidence = appendEvidence(ledger,{
      contractVersion:1,at:input.at,operation,caseId:goldenCase.id,businessId:goldenCase.businessId,datasetId:batch.datasetId,decision,
      qualification:decision === 'qualified' ? manifest.origin === 'synthetic' ? 'synthetic-qualified':'scoped-evidence' : 'unqualified',
      scope:{system:batch.system,product:structuredClone(batch.product),company:batch.company,period:structuredClone(compiled.rules.period),branches:[...compiled.rules.branches],taxRegistrations:[...compiled.rules.taxRegistrations],currencies:Object.keys(compiled.rules.currencies).sort(),snapshotId:batch.snapshotId},
      compilerVersion:compiled.compilerVersion,compilerBuildHash:compiled.compilerBuildHash,mappingFingerprint:compiled.fingerprint,packHash:compiled.packHash,rulesHash:compiled.rulesHash,ontologyHash:compiled.ontologyHash,schemaHash:compiled.schemaHash,sourceReceiptId:batch.receiptId,rowsHash:batch.rowsHash,sourceReportId:report.reportId,sourceReportHash:hashData(report),manifestHash:hashData({manifest,provenance:input.provenance}),splitPlanHash:hashData(splitPlan),goldenCaseHash:hashData(goldenCase),
      values:decision === 'qualified' ? result.values:[],countedRows:decision === 'qualified' ? result.countedRows:[],exclusions:decision === 'qualified' ? mapped.exclusions:[],controlTotals:decision === 'qualified' ? mapped.controls:[],issues:operationIssues,question:operationIssues.length ? operationIssues[0].message:null,
      liveVerified:false,arbitraryCompanyGuarantee:false,writebackQualified:false,
    }); decisions.push(evidence);
  }
  return {mapped:problems.length ? {...mapped,facts:[],controls:[],decision:mapped.decision === 'invalidated' ? 'invalidated' as const:'abstained' as const,issues:problems}:mapped,evidence:decisions,ledger};
}
