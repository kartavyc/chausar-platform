import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { COMPILER_BUILD_HASH, COMPILER_VERSION, hashData, qualifyCase, verifyLedger, type OperationEvidence } from './src/index.ts';
import { prepareSyntheticSuite } from './fixtures/prepare-suite.ts';

const inputs = prepareSyntheticSuite(new Date().toISOString()), ledger:OperationEvidence[] = [];
const results = inputs.map(input => {
  const result = qualifyCase(input,ledger), expected = input.goldenCase;
  const actual = result.evidence[0]?.decision;
  const codes = [...new Set(result.evidence.flatMap(e=>e.issues.map(p=>p.code)))].sort();
  const passed = result.evidence.every(e=>e.decision === expected.expectedDecision) && hashData(codes) === hashData([...expected.expectedIssueCodes].sort());
  return {id:expected.id,split:expected.split,expected:expected.expectedDecision,actual,passed,issueCodes:codes,operations:result.evidence.length,qualification:result.evidence[0]?.qualification};
});
const anchor = verifyLedger(ledger), groups = JSON.parse(readFileSync(new URL('./fixtures/connector-groups.json',import.meta.url),'utf8'));
const candidates = JSON.parse(readFileSync(new URL('./fixtures/public-source-candidates.json',import.meta.url),'utf8'));
const report = {
  contractVersion:1,generatedAt:new Date().toISOString(),compilerVersion:COMPILER_VERSION,compilerBuildHash:COMPILER_BUILD_HASH,
  baseline:'100df1d3c3bdb8e7793d81e6590cd6145c617d3e',
  synthetic:{cases:inputs.length,wholeBusinesses:new Set(inputs.map(x=>x.batch.origins.business)).size,templateFamilies:new Set(inputs.map(x=>x.batch.origins.template)).size,configurationFamilies:new Set(inputs.map(x=>x.batch.origins.configuration)).size,tuning:inputs.filter(x=>x.goldenCase.split === 'tuning').length,holdout:inputs.filter(x=>x.goldenCase.split === 'holdout').length,correct:results.filter(x=>x.passed).length,failed:results.filter(x=>!x.passed).length,qualified:results.filter(x=>x.actual === 'qualified').length,abstained:results.filter(x=>x.actual === 'abstained').length,acceptedWrong:results.filter(x=>x.actual === 'qualified' && !x.passed).length},
  ledger:anchor,requestedConnectorGroups:groups.totalGroupCount,namedConnectorGroupsQualified:0,externalDatasetsAcquired:0,externalDatasetsAdmitted:0,publicCandidates:candidates.candidates?.length ?? candidates.sources?.length ?? 0,
  splitDisclosure:'public-synthetic',policy:'Refusal frequency here reflects deliberately adversarial fixtures, not real onboarding performance. No public sample guarantees arbitrary-company correctness.',
  countsPolicy:'Reference/schema documents, coherent business books, independent company/configuration/version/template origins and synthetic cases are distinct categories. Future corpus targets are aspirational, not available or qualified corpus counts.',
  liveVerified:false,productionQualified:false,arbitraryCompanyGuarantee:false,writebackQualified:false,
  limitations:['Only seven synthetic register operations have executable evidence.','All 56 named connector groups remain unqualified.','Public synthetic holdout is independently authored but disclosed, not sealed or real.','No authorized external business books, native adapter, live environment, dual-database SQL proof or financial writeback verified.','Source report metadata and local hash chains are not upstream publisher signatures.'],results,
};
const out = new URL('./evidence/',import.meta.url); mkdirSync(out,{recursive:true});
for (const [name,value] of Object.entries({'qualification-report.json':report,'operation-ledger.json':ledger,'ledger-anchor.json':anchor,'dataset-manifests.json':inputs.map(x=>({manifest:x.manifest,provenance:x.provenance})),'split-plans.json':inputs.map(x=>x.splitPlan)})) writeFileSync(new URL(name,out),JSON.stringify(value,null,2)+'\n');
// Persist the exact already-admitted local bytes so manifest receipts are independently reviewable.
for(const input of inputs) for(const [path,bytes] of Object.entries(input.artifactBytes)) {
  const target=new URL(`artifacts/${path}`,out);mkdirSync(new URL('./',target),{recursive:true});writeFileSync(target,bytes);
}
console.log(JSON.stringify({report:fileURLToPath(new URL('qualification-report.json',out)),...report.synthetic,ledgerEntries:anchor.entries,requestedConnectorGroups:groups.totalGroupCount,namedConnectorGroupsQualified:0},null,2));
if (report.synthetic.failed > 0 || report.synthetic.acceptedWrong > 0) process.exitCode = 1;
