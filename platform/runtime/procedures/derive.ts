/**
 * Deriving a procedure from agent runs, and routing a case through it. Pure and deterministic:
 * the same runs always give the same steps, rule and digest. No floats ever touch money; the
 * only fractions are confidences, rounded down to two decimals from integer counts.
 */
import type { CaseFields, CaseValue, DecisionRule, Procedure, ProcedureRun, ProcedureStep, RuleBucket, WorkCase } from './types.ts';

export type FeatureType = 'string' | 'number' | 'boolean' | 'null';
export type DeriveOptions = { minRuns?: number; threshold?: number; minSupport?: number };
export type DeriveRefusal = 'PROCEDURE_NOT_ENOUGH_RUNS' | 'PROCEDURE_TRACES_DIFFER' | 'PROCEDURE_NO_RULE';
export type DeriveResult =
  | { ok: true; steps: ProcedureStep[]; match: Procedure['match']; derivedFrom: string[]; sourceIds: string[] }
  | { ok: false; code: DeriveRefusal; reason: string };
export type RouteMiss = 'tainted' | 'shape' | 'no-bucket' | 'low-confidence' | 'low-support';
export type RouteResult = { matched: true; decision: string; confidence: number; steps: ProcedureStep[] } | { matched: false; reason: RouteMiss };

export const typeOf = (value: CaseValue): FeatureType => value === null ? 'null' : typeof value as FeatureType;
export function featureShape(fields: CaseFields): Record<string, FeatureType> {
  return Object.fromEntries(Object.keys(fields).sort().map(name => [name, typeOf(fields[name])]));
}

const byName = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const confidenceOf = (count: number, size: number) => Math.floor(count * 100 / size) / 100;
/** The decision seen most often; ties go to the option name that sorts first. */
function majority(counts: Map<string, number>): [string, number] {
  return [...counts].sort((a, b) => b[1] - a[1] || byName(a[0], b[0]))[0];
}
function tally(values: string[]) { const counts = new Map<string, number>(); for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1); return counts; }

type Learned = { feature: string; buckets: RuleBucket[]; correct: number };
/** A run counts as explained only when its bucket's majority matches it and the bucket has enough support to be routed. */
function learn(feature: string, type: FeatureType, runs: ProcedureRun[], minSupport: number): Learned {
  const buckets: RuleBucket[] = []; let correct = 0;
  if (type === 'number') {
    const values = [...new Set(runs.map(run => run.features[feature] as number))].sort((a, b) => a - b);
    let open: { min: number; max: number; option: string; counts: Map<string, number> } | undefined;
    const close = () => { if (!open) return; const size = [...open.counts.values()].reduce((a, b) => a + b, 0), count = open.counts.get(open.option)!;
      buckets.push({ when: { min: open.min, max: open.max }, option: open.option, confidence: confidenceOf(count, size), support: size }); if (size >= minSupport) correct += count; };
    for (const value of values) {
      const counts = tally(runs.filter(run => run.features[feature] === value).map(run => run.decision!)), [option] = majority(counts);
      if (open && open.option === option) { open.max = value; for (const [key, n] of counts) open.counts.set(key, (open.counts.get(key) ?? 0) + n); }
      else { close(); open = { min: value, max: value, option, counts }; }
    }
    close();
  } else {
    const groups = new Map<string, { value: CaseValue; decisions: string[] }>();
    for (const run of runs) { const value = run.features[feature], key = JSON.stringify(value); if (!groups.has(key)) groups.set(key, { value, decisions: [] }); groups.get(key)!.decisions.push(run.decision!); }
    for (const key of [...groups.keys()].sort(byName)) {
      const { value, decisions } = groups.get(key)!, [option, count] = majority(tally(decisions));
      buckets.push({ when: { equals: value }, option, confidence: confidenceOf(count, decisions.length), support: decisions.length }); if (decisions.length >= minSupport) correct += count;
    }
  }
  return { feature, buckets, correct };
}

const pattern = { calculate: /^calculator\.([a-z0-9_]{1,64})$/i, lookup: /^lookup\.([a-z0-9_-]{1,64})$/i, action: /^action\.([a-z0-9_-]{1,64})\.([a-z0-9_-]{1,64})$/i };

/** Propose typed steps and a decision rule from the owner's successful agent runs of one template. */
export function deriveProcedure(all: readonly ProcedureRun[], template: string, opts: DeriveOptions = {}): DeriveResult {
  const minRuns = opts.minRuns ?? 3, threshold = opts.threshold ?? 0.8, minSupport = opts.minSupport ?? 2;
  const runs = all.filter(run => run.template === template && run.route === 'agent' && run.outcome === 'ok' && typeof run.decision === 'string' && run.decision.length > 0)
    .sort((a, b) => byName(a.at, b.at) || byName(a.id, b.id));
  if (runs.length < Math.max(1, minRuns)) return { ok: false, code: 'PROCEDURE_NOT_ENOUGH_RUNS', reason: 'The job needs more successful agent runs before a procedure can be proposed.' };
  const shape = (run: ProcedureRun) => run.steps.filter(step => step.kind !== 'action').map(step => `${step.kind}:${step.tool}`).join('|');
  if (runs.some(run => shape(run) !== shape(runs[0]))) return { ok: false, code: 'PROCEDURE_TRACES_DIFFER', reason: 'The agent runs did not follow the same steps.' };
  const differ = { ok: false as const, code: 'PROCEDURE_TRACES_DIFFER' as const, reason: 'A run used a step that is not a calculation, a lookup, a question or a catalogue action.' };

  // The rule: the one feature that explains most decisions.
  const names = Object.keys(runs[0].features).filter(name => runs.every(run => Object.hasOwn(run.features, name) && typeOf(run.features[name]) === typeOf(runs[0].features[name])));
  const match: Procedure['match'] = {};
  for (const name of names.sort(byName)) { const type = typeOf(runs[0].features[name]); if (type !== 'null') match[name] = type; }
  const best = Object.keys(match).map(name => learn(name, match[name], runs, minSupport)).sort((a, b) => b.correct - a.correct || byName(a.feature, b.feature))[0];
  if (!best || best.correct * 100 < Math.ceil(threshold * 100 - 1e-9) * runs.length) return { ok: false, code: 'PROCEDURE_NO_RULE', reason: 'No single case detail explains the agent’s decisions well enough.' };
  const rule: DecisionRule = { feature: best.feature, buckets: best.buckets, threshold, minSupport };
  const options = [...new Set(runs.map(run => run.decision!))].sort(byName);
  const question: ProcedureStep = { kind: 'question', title: 'Decide for each case from the learned rule', id: 'decision', options, rule };

  const steps: ProcedureStep[] = []; let asked = false;
  for (const [index, step] of runs[0].steps.filter(item => item.kind !== 'action').entries()) {
    if (step.kind === 'calculate') { const found = pattern.calculate.exec(step.tool); if (!found) return differ; steps.push({ kind: 'calculate', title: `Run the ${found[1]} calculation`, operation: found[1] }); }
    else if (step.kind === 'lookup') {
      const found = pattern.lookup.exec(step.tool); if (!found) return differ;
      const units = Math.max(...runs.map(run => run.steps.filter(item => item.kind !== 'action')[index].units));
      steps.push({ kind: 'lookup', title: `Look up ${found[1]} with the agent`, tool: step.tool, routeId: runs.at(-1)!.routeId ?? '', units });
    } else if (step.kind === 'question') { if (!asked) { steps.push(question); asked = true; } }
    else return differ;
  }
  if (!asked) steps.push(question);
  const actions = new Map<string, ProcedureStep>();
  for (const run of runs) for (const step of run.steps.filter(item => item.kind === 'action')) {
    const found = pattern.action.exec(step.tool); if (!found) return differ;
    const key = `${found[1]}\u0000${found[2]}\u0000${run.decision}`;
    if (!actions.has(key)) actions.set(key, { kind: 'action', title: `Prepare ${found[1]}.${found[2]} when the decision is ${run.decision}`, connector: found[1], operation: found[2], when: run.decision! });
  }
  steps.push(...[...actions.keys()].sort(byName).map(key => actions.get(key)!));
  return { ok: true, steps, match, derivedFrom: runs.map(run => run.id), sourceIds: [...new Set(runs.flatMap(run => run.sourceIds))].sort(byName) };
}

/** Route one case through an approved procedure, or say why it goes back to the full agent. */
export function routeCase(procedure: Pick<Procedure, 'steps' | 'match'>, item: Pick<WorkCase, 'fields' | 'tainted'>): RouteResult {
  if (item.tainted) return { matched: false, reason: 'tainted' };
  for (const [name, type] of Object.entries(procedure.match)) if (!Object.hasOwn(item.fields, name) || typeOf(item.fields[name]) !== type) return { matched: false, reason: 'shape' };
  const question = procedure.steps.find(step => step.kind === 'question');
  if (!question || question.kind !== 'question') return { matched: false, reason: 'no-bucket' };
  const { rule } = question, value = item.fields[rule.feature];
  if (value === undefined) return { matched: false, reason: 'shape' };
  const bucket = rule.buckets.find(({ when }) => Object.hasOwn(when, 'equals') ? when.equals === value
    : typeof value === 'number' && (when.min === undefined || value >= when.min) && (when.max === undefined || value <= when.max));
  if (!bucket) return { matched: false, reason: 'no-bucket' };
  if (bucket.confidence < rule.threshold) return { matched: false, reason: 'low-confidence' };
  if (bucket.support < rule.minSupport) return { matched: false, reason: 'low-support' };
  return { matched: true, decision: bucket.option, confidence: bucket.confidence,
    steps: structuredClone(procedure.steps.filter(step => step.kind !== 'action' || step.when === bucket.option)) };
}
