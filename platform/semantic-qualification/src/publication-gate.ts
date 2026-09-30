import type { OperationEvidence, OperationId } from './contracts.ts';
import { checkEvidenceCurrent, verifyLedger } from './ledger.ts';
import { dataOnly, digest, exactKeys, freezeData, hashData, record, requireThat, SemanticError, strings, text, validatePeriod } from './validation.ts';

/** Structural mirror of connector-framework/registry.ts at af089b75. No runtime import. */
export type GateConnectorScope = {
  connectorId:string;connectorVersion:string;operationId:string;
  kind:'read'|'export'|'guided-export'|'import'|'write';transport:'api'|'file'|'guided-ui';
  applicability:{applicationVersion:string;edition:string;module:string;configuration:string;deploymentProfile:string;region?:string};
};
export type ConnectorSemanticBinding = {
  contractVersion:1;workspaceId:string;sourceId:string;
  readScope:GateConnectorScope;importScope:GateConnectorScope;
  readDefinitionDigest:string;readEvidenceDigest:string;importDefinitionDigest:string;importEvidenceDigest:string;
  importImplementationDigest:string;recipeHash:string;semanticMappingFingerprint:string;
  captureId:string;generation:number;reviewId:string;
  decoder:{id:string;version:string;definitionHash:string;schemaSha256:string;identityNamespace:string};
  domain:{company:string;dataset:string;branches:string[];period:{from:string;to:string}};
  datasetManifestId:string;sourceReceiptId:string;sourceRowsHash:string;originalPageHashes:string[];
  snapshot:{kind:'source-snapshot';id:string};sourceObservedAt:string;
  at:string;expiresAt:string;minimum:'synthetic-tested'|'sandbox-verified'|'live-verified';
};
export type CurrentSemanticDependencies = Parameters<typeof checkEvidenceCurrent>[1];
export type ConnectorSemanticGateHost = {
  /** Trusted engine clock and retained durable head; neither comes from a request DTO. */
  now():string;
  retainedLedgerHead(binding:Readonly<ConnectorSemanticBinding>):string;
  /** Trusted parent-owned verifier. JSON, source text and phone callers cannot supply these functions. */
  verifyCustody(binding:Readonly<ConnectorSemanticBinding>):{bindingHash:string;verified:true};
  assertCurrentAccess(binding:Readonly<ConnectorSemanticBinding>):true;
  /** Delegate to CursorImportService.assertReady(ctx, sourceId, domain, true). */
  assertCaptureReady(binding:Readonly<ConnectorSemanticBinding>):true;
  qualification(scope:Readonly<GateConnectorScope>,at:string):{permitted:boolean;level:'unqualified'|'synthetic-tested'|'sandbox-verified'|'live-verified';definitionDigest:string;evidenceDigest:string;implementationDigest:string};
  /** Must resolve current rights, source, pack/ontology, split and golden hashes from trusted storage. */
  currentDependencies(binding:Readonly<ConnectorSemanticBinding>,evidence:Readonly<OperationEvidence>):CurrentSemanticDependencies;
};
export type ConnectorSemanticGateRequest = {binding:ConnectorSemanticBinding;ledger:OperationEvidence[];expectedHead:string;measure:OperationId;evidenceId:string};
export type ConnectorSemanticGateDecision = {contractVersion:1;permitted:boolean;level:'unqualified'|'synthetic-tested';bindingHash:string;semanticEvidenceId:string;measure:OperationId;checkedAt:string|null;reasonCodes:string[];liveVerified:false;writebackQualified:false};
function time(value:string) {text(value,'gate time'); requireThat(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value,'INVALID_TIME','Gate timestamps must be real canonical UTC instants.');return Date.parse(value);}
function scope(value:GateConnectorScope) {
  exactKeys(value,['connectorId','connectorVersion','operationId','kind','transport','applicability'],'connector operation scope');
  ['connectorId','connectorVersion','operationId'].forEach(k=>text((value as any)[k],k));
  requireThat(/^[a-z][a-z0-9-]{0,63}$/.test(value.connectorId) && !value.connectorVersion.includes('*') && !value.operationId.includes('*'),'CONNECTOR_SCOPE_MISMATCH','Connector and operation revisions must be explicit without wildcards.');
  requireThat(['read','export','guided-export','import','write'].includes(value.kind) && ['api','file','guided-ui'].includes(value.transport),'CONNECTOR_SCOPE_MISMATCH','Use explicit connector operation kinds and transports.');
  record(value.applicability,'connector applicability');
  const keys=['applicationVersion','edition','module','configuration','deploymentProfile'];
  requireThat(keys.every(k=>Object.hasOwn(value.applicability,k)) && Object.keys(value.applicability).every(k=>[...keys,'region'].includes(k)),'CONNECTOR_SCOPE_MISMATCH','Specify exact version, edition, module, configuration and deployment profile.');
  Object.values(value.applicability).forEach(v=>{text(v,'connector applicability');requireThat(!v.includes('*'),'CONNECTOR_SCOPE_MISMATCH','Wildcard connector profiles are refused.');});
}
/** An explicit parent integration helper; installed nowhere by importing this package. */
export function evaluateConnectorSemanticGate(request:ConnectorSemanticGateRequest,host:ConnectorSemanticGateHost):ConnectorSemanticGateDecision {
  exactKeys(request,['binding','ledger','expectedHead','measure','evidenceId'],'semantic gate request');
  dataOnly(request); const input=freezeData(request), b=input.binding, bindingHash=hashData(b);
  let checkedAt:string|null=null;
  try {
    exactKeys(b,['contractVersion','workspaceId','sourceId','readScope','importScope','readDefinitionDigest','readEvidenceDigest','importDefinitionDigest','importEvidenceDigest','importImplementationDigest','recipeHash','semanticMappingFingerprint','captureId','generation','reviewId','decoder','domain','datasetManifestId','sourceReceiptId','sourceRowsHash','originalPageHashes','snapshot','sourceObservedAt','at','expiresAt','minimum'],'connector semantic binding');
    requireThat(b.contractVersion === 1,'UNSUPPORTED_VERSION','Unknown semantic publication binding version.');
    ['workspaceId','sourceId','captureId','reviewId','datasetManifestId','sourceReceiptId'].forEach(k=>text((b as any)[k],k));
    requireThat(Number.isSafeInteger(b.generation) && b.generation > 0,'CAPTURE_FENCE_EXPIRED','An exact positive capture ownership generation is required.');
    for(const h of [b.readDefinitionDigest,b.readEvidenceDigest,b.importDefinitionDigest,b.importEvidenceDigest,b.importImplementationDigest,b.recipeHash,b.semanticMappingFingerprint,b.sourceRowsHash,input.expectedHead,input.evidenceId])digest(h);
    scope(b.readScope);scope(b.importScope);
    requireThat(['read','export','guided-export'].includes(b.readScope.kind) && b.importScope.kind === 'import' && b.importScope.transport === 'file' && (b.readScope.kind !== 'guided-export' || b.readScope.transport === 'guided-ui'),'CONNECTOR_SCOPE_MISMATCH','A semantic publication gate binds independent acquisition and file-import operations; it cannot authorize writes.');
    requireThat(b.minimum === 'synthetic-tested','EXTERNAL_SEMANTICS_UNQUALIFIED','This prototype has synthetic semantic evidence only; sandbox/live execution requires a future independently qualified native semantic gate.');
    exactKeys(b.domain,['company','dataset','branches','period'],'import domain');text(b.domain.company,'company');text(b.domain.dataset,'dataset');strings(b.domain.branches,'domain branches');validatePeriod(b.domain.period);
    exactKeys(b.decoder,['id','version','definitionHash','schemaSha256','identityNamespace'],'decoder binding');text(b.decoder.id,'decoder');text(b.decoder.version,'decoder version');text(b.decoder.identityNamespace,'identity namespace');digest(b.decoder.definitionHash);digest(b.decoder.schemaSha256);
    exactKeys(b.snapshot,['kind','id'],'snapshot');requireThat(b.snapshot.kind === 'source-snapshot','SNAPSHOT_UNVERIFIED','An upstream snapshot must be verified by the parent custody boundary.');text(b.snapshot.id,'snapshot ID');strings(b.originalPageHashes,'original byte receipts');b.originalPageHashes.forEach(digest);
    record(host,'trusted semantic host');
    for(const name of ['now','retainedLedgerHead','verifyCustody','assertCurrentAccess','assertCaptureReady','qualification','currentDependencies'])requireThat(typeof (host as any)[name] === 'function','TRUSTED_GATE_HOST_REQUIRED','The parent must inject every clock/anchor/custody/access/readiness/qualification/current-evidence verifier.');
    checkedAt=host.now();
    requireThat(time(b.sourceObservedAt) <= time(b.at) && time(b.at) <= time(checkedAt) && time(checkedAt) < time(b.expiresAt),'EVIDENCE_EXPIRED','The source observation and validity interval must cover the trusted current engine time; a historical payload time cannot replay an expired gate.');
    const retainedHead=host.retainedLedgerHead(b);digest(retainedHead);
    requireThat(input.expectedHead === retainedHead,'LEDGER_HEAD_MISMATCH','The requested ledger head must equal the independently retained trusted engine anchor.');
    verifyLedger(input.ledger,retainedHead);
    const evidence=input.ledger.find(e=>e.id === input.evidenceId);
    requireThat(evidence && evidence.operation === input.measure && evidence.decision === 'qualified' && evidence.qualification === 'synthetic-qualified','SEMANTIC_OPERATION_UNQUALIFIED','Require the exact qualified synthetic measure receipt; a different measure or a refusal cannot publish facts.');
    requireThat(evidence.mappingFingerprint === b.semanticMappingFingerprint && evidence.datasetId === b.datasetManifestId && evidence.sourceReceiptId === b.sourceReceiptId && evidence.rowsHash === b.sourceRowsHash && evidence.scope.company === b.domain.company && hashData(evidence.scope.period) === hashData(b.domain.period) && hashData([...evidence.scope.branches].sort()) === hashData([...b.domain.branches].sort()) && evidence.scope.snapshotId === b.snapshot.id,'SEMANTIC_SCOPE_MISMATCH','Semantic evidence belongs to a different mapping, capture, company, branch, period, dataset or source snapshot.');
    requireThat(time(b.sourceObservedAt) <= time(evidence.at) && time(evidence.at) <= time(b.at),'EVIDENCE_NOT_YET_OBSERVED','The semantic qualification cannot predate source observation or be reused before it was observed.');
    for(const s of [b.readScope,b.importScope])requireThat(s.connectorId === evidence.scope.system && s.applicability.applicationVersion === evidence.scope.product.version && s.applicability.edition === evidence.scope.product.edition && s.applicability.configuration === evidence.scope.product.configuration,'CONNECTOR_SCOPE_MISMATCH','Acquisition, import and semantic evidence must share the exact system/version/edition/configuration.');
    const custody=host.verifyCustody(b);dataOnly(custody);exactKeys(custody,['bindingHash','verified'],'custody attestation');requireThat(custody.verified === true && custody.bindingHash === bindingHash,'CUSTODY_UNVERIFIED','A source-supplied flag or deserialized DTO cannot establish acquisition custody.');
    requireThat(host.assertCurrentAccess(b) === true && host.assertCaptureReady(b) === true,'SOURCE_NOT_READY','Require current workspace/source access and conflict-free published source readiness with snapshot consistency.');
    const assertQualificationAt=(at:string)=>{for(const [s,definition,evidenceDigest] of [[b.readScope,b.readDefinitionDigest,b.readEvidenceDigest],[b.importScope,b.importDefinitionDigest,b.importEvidenceDigest]] as const) {
      const q=host.qualification(s,at);dataOnly(q);
      requireThat(q.permitted === true && q.level === 'synthetic-tested' && q.definitionDigest === definition && q.evidenceDigest === evidenceDigest && (s.kind !== 'import' || q.implementationDigest === b.importImplementationDigest),'CONNECTOR_QUALIFICATION_CHANGED','The exact independent connector capability evidence or implementation changed or lacks synthetic qualification.');
    }};
    assertQualificationAt(checkedAt);
    requireThat(checkEvidenceCurrent(evidence,host.currentDependencies(b,evidence)).valid,'SEMANTIC_EVIDENCE_STALE','Current semantic dependencies differ from the scoped qualification receipt.');
    // Recheck authority after all host lookups; serialized DTOs never provide these checks.
    requireThat(host.assertCurrentAccess(b) === true && host.assertCaptureReady(b) === true,'SOURCE_NOT_READY','Source access or readiness changed during gate evaluation.');
    const completedAt=host.now();requireThat(time(completedAt) >= time(checkedAt) && time(completedAt) < time(b.expiresAt),'EVIDENCE_EXPIRED','The trusted clock changed or validity expired while checking readiness.');checkedAt=completedAt;
    assertQualificationAt(completedAt);
    requireThat(checkEvidenceCurrent(evidence,host.currentDependencies(b,evidence)).valid,'SEMANTIC_EVIDENCE_STALE','Semantic dependencies changed while checking readiness.');
    requireThat(host.assertCurrentAccess(b) === true && host.assertCaptureReady(b) === true,'SOURCE_NOT_READY','Source authority or readiness changed while checking current evidence.');
    requireThat(host.retainedLedgerHead(b) === retainedHead,'LEDGER_HEAD_MISMATCH','The retained semantic evidence changed during gate evaluation.');
    return {contractVersion:1,permitted:true,level:'synthetic-tested',bindingHash,semanticEvidenceId:evidence.id,measure:input.measure,checkedAt,reasonCodes:[],liveVerified:false,writebackQualified:false};
  }catch(error){if(!(error instanceof SemanticError))throw error;return {contractVersion:1,permitted:false,level:'unqualified',bindingHash,semanticEvidenceId:input.evidenceId,measure:input.measure,checkedAt,reasonCodes:[error.code],liveVerified:false,writebackQualified:false};}
}
