import { readFileSync } from 'node:fs';
import type { DatasetManifest, SplitPlan } from '../src/contracts.ts';
import { canonicalJson, compileMapping, hashData, reportPayload, sha256Bytes, type QualificationInput } from '../src/index.ts';
import { makeSyntheticCases } from './synthetic-cases.ts';
import { semanticAssertionsByCase, exclusionAssertionsByCase } from './semantic-assertions.ts';

const fixtureBytes = readFileSync(new URL('./synthetic-cases.ts',import.meta.url));
const semanticFixtureBytes = readFileSync(new URL('./semantic-assertions.ts',import.meta.url));
/** Only fills provenance/identity digests. Never derives expected totals from rows. */
export function prepareSyntheticSuite(at = '2026-10-01T00:00:00.000Z'): QualificationInput[] {
  const raw = makeSyntheticCases();
  const cases = raw.cases.map(c => {
    c.goldenCase.semanticAssertions = structuredClone(semanticAssertionsByCase[c.goldenCase.id]);
    c.goldenCase.exclusionAssertions = structuredClone(exclusionAssertionsByCase[c.goldenCase.id]);
    c.pack.ontologyHash = hashData(raw.ontology); c.rules.packHash = hashData(c.pack);
    c.batch.rowsHash = hashData(c.batch.rows);
    c.batch.origins = {business:c.goldenCase.businessId,template:c.originFamily,configuration:c.pack.product.configuration};
    c.report.evidenceHash = hashData(reportPayload(c.report));
    return {...c,compiled:compileMapping(c.pack,c.rules,raw.ontology)};
  });
  const entry = (c:typeof cases[number]) => ({businessId:c.goldenCase.businessId,datasetId:c.batch.datasetId,rowsHash:c.batch.rowsHash,origins:c.batch.origins});
  return cases.map(c => {
    const artifactBytes: QualificationInput['artifactBytes'] = {};
    const artifact = (path:string,role:DatasetManifest['artifacts'][number]['role'],bytes:string | Uint8Array) => {artifactBytes[path]=bytes;return {path,sha256:sha256Bytes(bytes),role};};
    const metadata = (id:string,title:string,category:DatasetManifest['category'],artifacts:DatasetManifest['artifacts']): DatasetManifest => ({
      contractVersion:1,id,title,origin:'synthetic',category,
      source:{publisher:'Independent synthetic fixture lane',url:null,retrievedAt:at,productVersion:c.pack.product.version},
      rights:{status:'allowed',license:'Task-authorized synthetic qualification only; no distribution or training authorization asserted',evidence:'User authorized synthetic businesses first. These are newly authored fictional records and hand-worked controls, with no real vendor data or personal information.',permittedUses:['qualification'],personalData:'none',permissions:{acquisition:'allowed',reuse:'allowed',redistribution:'unknown',training:'unknown'}},
      artifacts,limitations:['Public synthetic compiler fixtures only. No real installation, named vendor, sealed holdout or arbitrary-company onboarding qualification.'],
    });
    const manifest = metadata(c.batch.datasetId,c.goldenCase.id,'synthetic-cases',[
      artifact(`synthetic/${c.goldenCase.id}/rows.json`,'source-rows',canonicalJson(c.batch.rows)),
      artifact(`synthetic/${c.goldenCase.id}/report.json`,'source-report',canonicalJson(reportPayload(c.report))),
      artifact(`synthetic/${c.goldenCase.id}/golden.json`,'golden-cases',canonicalJson(c.goldenCase)),
    ]);
    const provenance = [metadata('synthetic-register-independent-v1','Independent authored fixture, mapping and company-rule dossier','reference-schema',[
      artifact('synthetic/synthetic-cases.ts','schema-reference',fixtureBytes),
      artifact('synthetic/semantic-assertions.ts','schema-reference',semanticFixtureBytes),
      artifact(`synthetic/${c.goldenCase.id}/pack.json`,'schema-reference',canonicalJson(c.pack)),
      artifact(`synthetic/${c.goldenCase.id}/rules.json`,'authorization',canonicalJson(c.rules)),
    ])];
    const splitPlan:SplitPlan = {contractVersion:1,id:'whole-company-and-template-split-v1',mappingFingerprint:c.compiled.productFingerprint,reviewer:'Independent golden_fixtures lane; source expectations authored without mapper access',tuning:cases.filter(x=>x.goldenCase.split === 'tuning').map(entry),holdout:cases.filter(x=>x.goldenCase.split === 'holdout').map(entry),disclosure:'public-synthetic',evidence:'Business, template and configuration origins are wholly disjoint. The two independently declared synthetic templates exercise the compiler against their own explicit packs. This public fixture split is not sealed, real or a learned-mapper generalization claim.'};
    return {compiled:c.compiled,batch:c.batch,report:c.report,manifest,provenance,artifactBytes,splitPlan,goldenCase:c.goldenCase,at};
  });
}
