import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareSyntheticSuite } from '../fixtures/prepare-suite.ts';
import { evaluateConnectorSemanticGate, hashData, qualifyCase, verifyLedger, type ConnectorSemanticGateHost, type ConnectorSemanticGateRequest, type ConnectorSemanticBinding, type GateConnectorScope } from '../src/index.ts';

function fixture() {
  const input=prepareSyntheticSuite().find(x=>x.goldenCase.id === 'tuning-retail-separated-events')!, result=qualifyCase(input), e=result.evidence.find(e=>e.operation === 'earned')!;
  const hash=(s:string)=>hashData(s), read:GateConnectorScope={connectorId:'synthetic-register',connectorVersion:'fixture-adapter-v1',operationId:'read-register',kind:'export',transport:'file',applicability:{applicationVersion:'1',edition:'fixture',module:'register',configuration:'tax-exclusive',deploymentProfile:'local-fixture'}};
  const imp:GateConnectorScope={...structuredClone(read),operationId:'import-register',kind:'import'};
  const binding:ConnectorSemanticBinding={contractVersion:1,workspaceId:'fixture-workspace',sourceId:'fixture-source',readScope:read,importScope:imp,readDefinitionDigest:hash('read-definition'),readEvidenceDigest:hash('read-evidence'),importDefinitionDigest:hash('import-definition'),importEvidenceDigest:hash('import-evidence'),importImplementationDigest:hash('import-implementation'),recipeHash:hash('parent-owned-reviewed-baseline-recipe-link'),semanticMappingFingerprint:e.mappingFingerprint,captureId:'fixture-capture',generation:1,reviewId:'fixture-owner-review',decoder:{id:'fixture-json',version:'1',definitionHash:hash('decoder'),schemaSha256:hash('qualified-decoder-schema'),identityNamespace:'fixture-register-revisions'},domain:{company:e.scope.company,dataset:'register-domain',branches:e.scope.branches,period:e.scope.period},datasetManifestId:e.datasetId,sourceReceiptId:e.sourceReceiptId,sourceRowsHash:e.rowsHash,originalPageHashes:[hash('original-source-byte-page')],snapshot:{kind:'source-snapshot',id:e.scope.snapshotId},sourceObservedAt:e.at,at:e.at,expiresAt:'2026-10-02T00:00:00.000Z',minimum:'synthetic-tested'};
  const request:ConnectorSemanticGateRequest={binding,ledger:result.ledger,expectedHead:verifyLedger(result.ledger).head!,measure:'earned',evidenceId:e.id};
  const expectedBinding=hashData(binding), current={mappingFingerprint:e.mappingFingerprint,schemaHash:e.schemaHash,rowsHash:e.rowsHash,snapshotId:e.scope.snapshotId,sourceReportHash:e.sourceReportHash,manifestHash:e.manifestHash,splitPlanHash:e.splitPlanHash,goldenCaseHash:e.goldenCaseHash};
  // Explicit trusted fixture host. This is not a production/cross-process custody verifier.
  const retainedHead=request.expectedHead;
  const host:ConnectorSemanticGateHost={now:()=>e.at,retainedLedgerHead:()=>retainedHead,verifyCustody:b=>({bindingHash:hashData(b) === expectedBinding ? expectedBinding:hash('wrong-custody'),verified:true}),assertCurrentAccess:()=>true,assertCaptureReady:()=>true,qualification:s=>({permitted:true,level:'synthetic-tested',definitionDigest:s.kind === 'import' ? binding.importDefinitionDigest:binding.readDefinitionDigest,evidenceDigest:s.kind === 'import' ? binding.importEvidenceDigest:binding.readEvidenceDigest,implementationDigest:binding.importImplementationDigest}),currentDependencies:()=>current};
  return {request,host,current};
}
test('explicit acquisition custody and current semantic evidence permit only synthetic import',()=> {
  const {request,host}=fixture(), gate=evaluateConnectorSemanticGate(request,host);
  assert.equal(gate.permitted,true);assert.equal(gate.level,'synthetic-tested');assert.equal(gate.liveVerified,false);assert.equal(gate.writebackQualified,false);
});
test('read capability alone cannot substitute for independent import evidence',()=> {
  const {request,host}=fixture();host.qualification=s=>({permitted:s.kind !== 'import',level:s.kind === 'import' ? 'unqualified':'synthetic-tested',definitionDigest:request.binding.readDefinitionDigest,evidenceDigest:request.binding.readEvidenceDigest,implementationDigest:request.binding.importImplementationDigest});
  assert.deepEqual(evaluateConnectorSemanticGate(request,host).reasonCodes,['CONNECTOR_QUALIFICATION_CHANGED']);
});
test('changed source capture, generation, decoder or reviewed recipe cannot bypass custody',()=> {
  for(const mutate of [(b:ConnectorSemanticBinding)=>b.captureId='other',(b:ConnectorSemanticBinding)=>b.generation=2,(b:ConnectorSemanticBinding)=>b.decoder.version='2',(b:ConnectorSemanticBinding)=>b.recipeHash=hashData('other-recipe')]) {
    const {request,host}=fixture();mutate(request.binding);assert.deepEqual(evaluateConnectorSemanticGate(request,host).reasonCodes,['CUSTODY_UNVERIFIED']);
  }
});
test('overlapping conflict or revoked access blocks semantic publication',()=> {
  for(const verifier of ['assertCaptureReady','assertCurrentAccess'] as const) {const {request,host}=fixture();(host as any)[verifier]=()=>false;assert.deepEqual(evaluateConnectorSemanticGate(request,host).reasonCodes,['SOURCE_NOT_READY']);}
});
test('source rows, domain or semantic fingerprint mismatch blocks publication',()=> {
  for(const mutate of [(b:ConnectorSemanticBinding)=>b.sourceRowsHash=hashData('other'),(b:ConnectorSemanticBinding)=>b.domain.company='other',(b:ConnectorSemanticBinding)=>b.semanticMappingFingerprint=hashData('other-mapping')]) {
    const {request,host}=fixture();mutate(request.binding);assert.deepEqual(evaluateConnectorSemanticGate(request,host).reasonCodes,['SEMANTIC_SCOPE_MISMATCH']);
  }
});
test('sandbox, live and write claims cannot be promoted from synthetic semantics',()=> {
  for(const minimum of ['sandbox-verified','live-verified'] as const) {const {request,host}=fixture();request.binding.minimum=minimum;assert.deepEqual(evaluateConnectorSemanticGate(request,host).reasonCodes,['EXTERNAL_SEMANTICS_UNQUALIFIED']);}
  const {request,host}=fixture();request.binding.importScope.kind='write';assert.deepEqual(evaluateConnectorSemanticGate(request,host).reasonCodes,['CONNECTOR_SCOPE_MISMATCH']);
});
test('old rights or golden hashes and an unretained ledger head block publication',()=> {
  const {request,host,current}=fixture();current.manifestHash=hashData('revoked-rights');assert.deepEqual(evaluateConnectorSemanticGate(request,host).reasonCodes,['SEMANTIC_EVIDENCE_STALE']);
  const next=fixture();next.request.expectedHead=hashData('wrong-head');assert.deepEqual(evaluateConnectorSemanticGate(next.request,next.host).reasonCodes,['LEDGER_HEAD_MISMATCH']);
});
test('expiry or future semantic evidence cannot establish readiness',()=> {
  const {request,host}=fixture();request.binding.expiresAt=request.binding.at;assert.deepEqual(evaluateConnectorSemanticGate(request,host).reasonCodes,['EVIDENCE_EXPIRED']);
  const next=fixture();next.request.binding.sourceObservedAt='2026-09-30T00:00:00.000Z';next.request.binding.at='2026-09-30T23:00:00.000Z';assert.deepEqual(evaluateConnectorSemanticGate(next.request,next.host).reasonCodes,['EVIDENCE_NOT_YET_OBSERVED']);
});
test('missing trusted host checks never default to allowed',()=> {
  const {request}=fixture();assert.deepEqual(evaluateConnectorSemanticGate(request,{} as any).reasonCodes,['TRUSTED_GATE_HOST_REQUIRED']);
});
test('a historically valid request cannot replay after trusted current expiry',()=> {
  const {request,host}=fixture();host.now=()=> '2026-10-03T00:00:00.000Z';
  assert.deepEqual(evaluateConnectorSemanticGate(request,host).reasonCodes,['EVIDENCE_EXPIRED']);
});
test('rehashed forged amounts cannot supply their own retained ledger anchor',()=> {
  const {request,host}=fixture();const index=request.ledger.findIndex(e=>e.id === request.evidenceId);request.ledger[index].values[0].minor='1';
  let previous:string|null=null;for(const entry of request.ledger){entry.previousHash=previous;const {id,...payload}=entry;entry.id=hashData(payload);previous=entry.id;}
  request.evidenceId=request.ledger[index].id;request.expectedHead=previous!;
  assert.deepEqual(evaluateConnectorSemanticGate(request,host).reasonCodes,['LEDGER_HEAD_MISMATCH']);
});
test('connector evidence expiring during gate checks cannot authorize the final decision time',()=> {
  const {request,host}=fixture();let clocks=0;host.now=()=>++clocks === 1 ? request.binding.at:'2026-10-01T00:00:01.000Z';
  const original=host.qualification;host.qualification=(scope,at)=>({...original(scope,at),permitted:at === request.binding.at});
  assert.deepEqual(evaluateConnectorSemanticGate(request,host).reasonCodes,['CONNECTOR_QUALIFICATION_CHANGED']);
});
