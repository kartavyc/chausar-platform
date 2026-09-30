import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareSyntheticSuite } from '../fixtures/prepare-suite.ts';
import { canonicalJson, compileMapping, hashData, mapBatch, qualifyCase, reportPayload, SemanticError, evaluateOperation, type QualificationInput } from '../src/index.ts';

const inputs = prepareSyntheticSuite();
const positive = () => structuredClone(inputs.find(x=>x.goldenCase.id === 'tuning-retail-separated-events')!);
function recapture(input:QualificationInput) {
  input.batch.rowsHash = hashData(input.batch.rows); input.report.evidenceHash = hashData(reportPayload(input.report));
  const member = input.splitPlan[input.goldenCase.split].find(e=>e.datasetId === input.batch.datasetId)!; member.rowsHash = input.batch.rowsHash;
  for (const a of input.manifest.artifacts) {
    const bytes = a.role === 'source-rows' ? canonicalJson(input.batch.rows) : a.role === 'source-report' ? canonicalJson(reportPayload(input.report)) : canonicalJson(input.goldenCase);
    a.sha256 = hashData(a.role === 'source-rows' ? input.batch.rows : a.role === 'source-report' ? reportPayload(input.report) : input.goldenCase); input.artifactBytes[a.path] = bytes;
  }
  return input;
}
for (const input of inputs) test(`independent business case: ${input.goldenCase.id}`,()=> {
  const result = qualifyCase(input);
  assert.equal(result.evidence.length,7);
  for (const e of result.evidence) {
    assert.equal(e.decision,input.goldenCase.expectedDecision);
    assert.deepEqual([...new Set(e.issues.map(p=>p.code))].sort(),[...input.goldenCase.expectedIssueCodes].sort());
    assert.equal(e.liveVerified,false); assert.equal(e.arbitraryCompanyGuarantee,false); assert.equal(e.writebackQualified,false);
    assert.equal(e.qualification,e.decision === 'qualified' ? 'synthetic-qualified':'unqualified');
  }
  if (input.goldenCase.expectedDecision === 'qualified') {
    assert.deepEqual(result.mapped.facts.map(({source,...fact})=>({...fact,sourceRow:source.row})),input.goldenCase.semanticAssertions);
    assert.deepEqual(result.mapped.exclusions,input.goldenCase.exclusionAssertions);
    for (const e of result.evidence) assert.deepEqual(e.values,input.goldenCase.expectations.find(g=>g.operation === e.operation)!.values.sort((a,b)=>a.currency.localeCompare(b.currency)));
  } else { assert.deepEqual(result.mapped.facts,[]); assert.equal(result.mapped.decision,'abstained'); }
});
test('same-money wrong unit conversion fails independent semantic assertions',()=> {
  const input = positive(), rules = structuredClone(input.compiled.rules); rules.units.box.numerator = '10';
  input.compiled = compileMapping(input.compiled.pack,rules,input.compiled.ontology);
  const result = qualifyCase(input);
  assert.ok(result.evidence.every(e=>e.decision === 'abstained' && e.issues.some(p=>p.code === 'GOLDEN_SEMANTIC_MISMATCH')));
  assert.deepEqual(result.mapped.facts,[]);
});
test('same-money valid but wrong date fails independent semantic assertions',()=> {
  const input = positive(); input.batch.rows[0].date = '2026-04-16'; recapture(input);
  const result = qualifyCase(input);
  assert.ok(result.evidence.every(e=>e.issues.some(p=>p.code === 'GOLDEN_SEMANTIC_MISMATCH')));
  assert.deepEqual(result.mapped.facts,[]);
});
test('equal grand total with wrong tax allocation fails source controls',()=> {
  const input = positive(); input.report.totals.find(t=>t.kind === 'sale')!.taxMinor = '26999'; input.report.totals.find(t=>t.kind === 'sale')!.grossMinor = '176999'; recapture(input);
  const result = qualifyCase(input);
  assert.ok(result.evidence.every(e=>e.decision === 'abstained' && e.issues.some(p=>p.code === 'SOURCE_TOTAL_MISMATCH'))); assert.deepEqual(result.mapped.facts,[]);
});
test('truncated source is refused even when remaining rows parse',()=> {
  const input = positive(); input.batch.rows.pop(); recapture(input);
  const result = qualifyCase(input); assert.ok(result.evidence.every(e=>e.issues.some(p=>p.code === 'SOURCE_ROW_MISMATCH'))); assert.deepEqual(result.mapped.facts,[]);
});
test('period, branch, tax registration and snapshot source report scopes cannot drift',()=> {
  for (const mutate of [(i:QualificationInput)=>i.report.snapshotId='changed',(i:QualificationInput)=>i.report.period.to='2026-04-29',(i:QualificationInput)=>i.report.branches=['other'],(i:QualificationInput)=>i.report.taxRegistrations=['other']]) {
    const input = positive(); mutate(input); recapture(input); const result = qualifyCase(input);
    assert.ok(result.evidence.every(e=>e.issues.some(p=>p.code === 'REPORT_SCOPE_MISMATCH'))); assert.deepEqual(result.mapped.facts,[]);
  }
});
test('one wrong golden operation blocks all proposed facts and receipts',()=> {
  const input = positive(); input.goldenCase.expectations.find(e=>e.operation === 'earned')!.values[0].minor='1'; recapture(input);
  const result = qualifyCase(input); assert.ok(result.evidence.every(e=>e.decision === 'abstained' && e.issues.some(p=>p.code === 'GOLDEN_MISMATCH'))); assert.deepEqual(result.mapped.facts,[]);
});
test('golden expected refusal and issue assertions cannot be ignored',()=> {
  const input = positive(); input.goldenCase.expectedDecision='abstained'; input.goldenCase.expectedIssueCodes=['UNKNOWN_STATE']; recapture(input);
  const result = qualifyCase(input); assert.ok(result.evidence.every(e=>e.issues.some(p=>p.code === 'GOLDEN_DECISION_MISMATCH') && e.issues.some(p=>p.code === 'GOLDEN_ISSUE_MISMATCH'))); assert.deepEqual(result.mapped.facts,[]);
});
test('duplicate source identity cannot hide a refund or row',()=> {
  const input = positive(); input.batch.rows[1].id=input.batch.rows[0].id; input.batch.rowsHash=hashData(input.batch.rows);
  const result=mapBatch(input.compiled,input.batch); assert.equal(result.decision,'abstained'); assert.equal(result.issues[0].code,'DUPLICATE_IDENTITY'); assert.deepEqual(result.facts,[]);
});
test('unsupported operations never return a plausible zero',()=> {
  assert.throws(()=>evaluateOperation('select 1' as any,[]),(e:any)=>e instanceof SemanticError && e.code === 'UNSUPPORTED_OPERATION');
});
test('impossible receipt timestamp cannot normalize into another date',()=> {
  const input=positive(); input.at='2026-02-30T00:00:00.000Z';
  assert.throws(()=>qualifyCase(input),(e:any)=>e.code === 'INVALID_TIME');
});
test('data-only mappings reject executable SQL and ambiguous semantic configuration',()=> {
  const input=positive();
  for (const extra of [{sql:'SELECT * FROM business'},{expression:'process.exit()'},{company:'cross-company'}]) assert.throws(()=>compileMapping({...input.compiled.pack,...extra},input.compiled.rules,input.compiled.ontology),(e:any)=>e.code === 'INVALID_CONTRACT');
  const pack=structuredClone(input.compiled.pack); (pack.semantics as any).missing='zero';
  assert.throws(()=>compileMapping(pack,input.compiled.rules,input.compiled.ontology),(e:any)=>e.code === 'AMBIGUOUS_SEMANTICS');
});
test('captured numeric decimal lexemes cannot enter as rounded JS numbers',()=> {
  const input=positive(); (input.batch.rows[0] as any).amount=9007199254740994;
  const result=mapBatch(input.compiled,input.batch); assert.equal(result.decision,'abstained'); assert.deepEqual(result.facts,[]);
});
test('separate entire companies and origins, distinct pack profiles, eight positive businesses',()=> {
  assert.equal(inputs.length,17); assert.equal(inputs.filter(i=>i.goldenCase.expectedDecision === 'qualified').length,8);
  const tuning=inputs.filter(i=>i.goldenCase.split === 'tuning'), holdout=inputs.filter(i=>i.goldenCase.split === 'holdout');
  for (const key of ['business','template','configuration'] as const) assert.ok(holdout.every(h=>tuning.every(t=>h.batch.origins[key] !== t.batch.origins[key])));
  assert.ok(holdout.every(i=>i.compiled.pack.semantics.taxInclusion === 'inclusive' && i.compiled.pack.semantics.dateFormat === 'DMY'));
});
test('exact56 requested group roster preserves QuickBooks and no synthetic uplift',()=> {
  const roster=JSON.parse(readFileSync(new URL('../fixtures/connector-groups.json',import.meta.url),'utf8'));
  assert.equal(roster.originalGroupCount,50); assert.equal(roster.addedGroupCount,6); assert.equal(roster.totalGroupCount,56);
  assert.equal(roster.groups.length,56); assert.equal(new Set(roster.groups.map((g:any)=>g.id)).size,56);
  assert.ok(JSON.stringify(roster.groups).includes('QuickBooks'));
  for (const g of roster.groups) for (const op of Object.values(g.operations) as any[]) assert.equal(typeof op === 'string' ? op:op.status,'unqualified');
});
