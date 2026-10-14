import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveProcedure, featureShape, routeCase } from '../runtime/procedures/derive.ts';
import type { CaseFields, ProcedureRun, TraceStep } from '../runtime/procedures/types.ts';

const T = 'receivables-week';
const step = (kind: TraceStep['kind'], tool: string, units = 0): TraceStep => ({ kind, tool, outcome: 'ok', durationMs: 5, units });
let seq = 0;
function run(features: CaseFields, decision: string, patch: Partial<ProcedureRun> = {}): ProcedureRun {
  seq++;
  const steps = [step('calculate', 'calculator.aging'), step('lookup', 'lookup.customer', 2), step('question', 'agent.decide'),
    ...(decision === 'remind' ? [step('action', 'action.local.reminder-draft')] : [])];
  return { id: `run-${String(seq).padStart(4, '0')}`, at: `2026-10-01T00:00:${String(seq % 60).padStart(2, '0')}.000Z`, jobId: 'job-a', template: T, caseId: `case-${seq}`,
    route: 'agent', routeId: 'route-strong', decision, confidence: 0.9, featureShape: featureShape(features), features, steps,
    costMinor: '120', latencyMs: 900, outcome: 'ok', sourceIds: ['src-a'], ...patch };
}
const numeric = () => [run({ days: 3, paid: false }, 'wait'), run({ days: 5, paid: false }, 'wait'), run({ days: 20, paid: false }, 'remind'), run({ days: 35, paid: false }, 'remind'), run({ days: 40, paid: true }, 'remind')];

test('featureShape keeps names and types only', () => {
  assert.deepEqual(featureShape({ b: 1, a: 'x', c: null, d: true }), { a: 'string', b: 'number', c: 'null', d: 'boolean' });
});

test('numeric ranges: contiguous buckets with inclusive bounds, steps in trace order and actions per decision', () => {
  const result = deriveProcedure(numeric(), T);
  assert.ok(result.ok);
  assert.deepEqual(result.match, { days: 'number', paid: 'boolean' });
  assert.deepEqual(result.steps.map(s => s.kind), ['calculate', 'lookup', 'question', 'action']);
  const question = result.steps[2]; assert.equal(question.kind, 'question');
  if (question.kind !== 'question') return;
  assert.deepEqual(question.options, ['remind', 'wait']);
  assert.equal(question.rule.feature, 'days');
  assert.deepEqual(question.rule.buckets, [
    { when: { min: 3, max: 5 }, option: 'wait', confidence: 1, support: 2 },
    { when: { min: 20, max: 40 }, option: 'remind', confidence: 1, support: 3 }]);
  assert.deepEqual(result.steps[1], { kind: 'lookup', title: 'Look up customer with the agent', tool: 'lookup.customer', routeId: 'route-strong', units: 2 });
  assert.deepEqual(result.steps[3], { kind: 'action', title: 'Prepare local.reminder-draft when the decision is remind', connector: 'local', operation: 'reminder-draft', when: 'remind' });
  assert.equal(result.derivedFrom.length, 5); assert.deepEqual(result.sourceIds, ['src-a']);
  const proc = { steps: result.steps, match: result.match };
  assert.deepEqual(routeCase(proc, { fields: { days: 5, paid: false }, tainted: false }), { matched: true, decision: 'wait', confidence: 1, steps: result.steps.slice(0, 3) });
  const remind = routeCase(proc, { fields: { days: 20, paid: true }, tainted: false });
  assert.ok(remind.matched && remind.decision === 'remind' && remind.steps.some(s => s.kind === 'action'));
  assert.deepEqual(routeCase(proc, { fields: { days: 10, paid: false }, tainted: false }), { matched: false, reason: 'no-bucket' }, 'a gap between ranges is not routed');
  assert.deepEqual(routeCase(proc, { fields: { days: 41, paid: false }, tainted: false }), { matched: false, reason: 'no-bucket' });
});

test('categorical rule, ties broken by option name and by feature name, majority confidence rounded down', () => {
  const runs = [run({ tier: 'gold' }, 'wait'), run({ tier: 'gold' }, 'remind'), run({ tier: 'gold' }, 'remind'), run({ tier: 'silver' }, 'ask'), run({ tier: 'silver' }, 'ask'), run({ tier: 'bronze' }, 'wait'), run({ tier: 'bronze' }, 'remind')];
  const result = deriveProcedure(runs, T, { threshold: 0.7 });
  assert.ok(result.ok);
  const question = result.steps.find(s => s.kind === 'question');
  assert.ok(question && question.kind === 'question');
  assert.deepEqual(question.rule.buckets, [
    { when: { equals: 'bronze' }, option: 'remind', confidence: 0.5, support: 2 },
    { when: { equals: 'gold' }, option: 'remind', confidence: 0.66, support: 3 },
    { when: { equals: 'silver' }, option: 'ask', confidence: 1, support: 2 }]);
  // Two features that explain the same number of runs: the name that sorts first wins.
  const tie = deriveProcedure([run({ b: 'x', a: 'p' }, 'wait'), run({ b: 'x', a: 'p' }, 'wait'), run({ b: 'y', a: 'q' }, 'remind'), run({ b: 'y', a: 'q' }, 'remind')], T);
  assert.ok(tie.ok); const q = tie.steps.find(s => s.kind === 'question'); assert.ok(q?.kind === 'question' && q.rule.feature === 'a');
  // Low-confidence and low-support buckets go back to the agent.
  const proc = { steps: result.steps, match: result.match };
  assert.deepEqual(routeCase(proc, { fields: { tier: 'gold' }, tainted: false }), { matched: false, reason: 'low-confidence' });
  assert.equal(routeCase(proc, { fields: { tier: 'silver' }, tainted: false }).matched, true);
  const lowSupport = deriveProcedure([run({ tier: 'gold' }, 'wait'), run({ tier: 'gold' }, 'wait'), run({ tier: 'gold' }, 'wait'), run({ tier: 'gold' }, 'wait'), run({ tier: 'silver' }, 'remind')], T);
  assert.ok(lowSupport.ok);
  assert.deepEqual(routeCase({ steps: lowSupport.steps, match: lowSupport.match }, { fields: { tier: 'silver' }, tainted: false }), { matched: false, reason: 'low-support' });
});

test('refusals: not enough runs, traces that differ, no rule', () => {
  assert.deepEqual(deriveProcedure(numeric().slice(0, 2), T), { ok: false, code: 'PROCEDURE_NOT_ENOUGH_RUNS', reason: 'The job needs more successful agent runs before a procedure can be proposed.' });
  // Runs from other routes, outcomes or templates do not count.
  const mixed = [...numeric().slice(0, 2), run({ days: 1, paid: false }, 'wait', { route: 'procedure' }), run({ days: 1, paid: false }, 'wait', { outcome: 'fallback' }), run({ days: 1, paid: false }, 'wait', { template: 'cash-position' })];
  assert.equal((deriveProcedure(mixed, T) as any).code, 'PROCEDURE_NOT_ENOUGH_RUNS');
  const odd = run({ days: 9, paid: false }, 'wait'); odd.steps = [step('lookup', 'lookup.customer'), step('calculate', 'calculator.aging'), step('question', 'agent.decide')];
  assert.equal((deriveProcedure([...numeric(), odd], T) as any).code, 'PROCEDURE_TRACES_DIFFER');
  const person = numeric().map(item => ({ ...item, steps: [...item.steps, step('person', 'person.review')] }));
  assert.equal((deriveProcedure(person, T) as any).code, 'PROCEDURE_TRACES_DIFFER');
  // Action steps may differ between decisions without breaking the shared trace.
  assert.ok(deriveProcedure(numeric(), T).ok);
  const noise = [run({ n: 1 }, 'wait'), run({ n: 2 }, 'remind'), run({ n: 3 }, 'wait'), run({ n: 4 }, 'remind'), run({ n: 5 }, 'wait')];
  assert.equal((deriveProcedure(noise, T) as any).code, 'PROCEDURE_NO_RULE', 'single-run buckets explain nothing');
  assert.equal((deriveProcedure([run({}, 'wait'), run({}, 'wait'), run({}, 'wait')], T) as any).code, 'PROCEDURE_NO_RULE', 'no feature, no rule');
});

test('tainted and shape-mismatched cases are never routed', () => {
  const result = deriveProcedure(numeric(), T); assert.ok(result.ok);
  const proc = { steps: result.steps, match: result.match };
  assert.deepEqual(routeCase(proc, { fields: { days: 5, paid: false }, tainted: true }), { matched: false, reason: 'tainted' });
  assert.deepEqual(routeCase(proc, { fields: { days: '5', paid: false }, tainted: false }), { matched: false, reason: 'shape' });
  assert.deepEqual(routeCase(proc, { fields: { days: 5 }, tainted: false }), { matched: false, reason: 'shape' });
  assert.deepEqual(routeCase(proc, { fields: { days: null, paid: false }, tainted: false }), { matched: false, reason: 'shape' });
  assert.equal(routeCase(proc, { fields: { days: 4, paid: false, extra: 'x' }, tainted: false }).matched, true);
});

test('an action tool seen under two decisions gives one step per decision', () => {
  const runs = numeric(); runs[0].steps.push(step('action', 'action.local.reminder-draft'));
  const result = deriveProcedure(runs, T); assert.ok(result.ok);
  assert.deepEqual(result.steps.filter(s => s.kind === 'action').map(s => s.kind === 'action' && s.when), ['remind', 'wait']);
});
