import { CalculatorService, type CalculationRequest } from './calculator.ts';
import { ChausarError, authorize, check, hash, newId, type Context, type State, type StateStore } from './contracts.ts';
import { canSeeFact, currentAccess, validatePeriod } from './memory.ts';
import { assertSourceAccess } from './trust.ts';
import type {
  ScenarioAnalysisRequest, ScenarioBranch, ScenarioComparison, ScenarioCreateRequest, ScenarioEvidence,
  ScenarioHost, ScenarioJob, ScenarioJobState, ScenarioRecord, ScenarioRevision, ScenarioRun,
  ScenarioRunResult, ScenarioView, ScenarioDiscoveryRow,
} from './scenario-contracts.ts';

const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)])) : value;
const digest = (value: unknown) => hash(canonical(value));
const seal = <T extends object>(body: T): T & { digest: string } => ({ ...body, digest: digest(body) });
const assertSealed = (value: { digest: string }) => {
  const { digest: pin, ...body } = value;
  check(pin === digest(body), 'SCENARIO_ARTIFACT_CHANGED', 'A retained scenario artifact changed.');
};
const readOnly = (state: State): StateStore => ({ read: () => structuredClone(state), update: async () => { throw new ChausarError('SCENARIO_READ_ONLY', 'Scenario authority is read only.'); } });
// Only #access, #requestAccess and #load use this view for pure synchronous
// access checks on their fresh live read. Never pass it to a host or callback.
const internalAccessView = (state: State): StateStore => ({ read: () => state, update: async () => { throw new ChausarError('SCENARIO_READ_ONLY', 'Scenario authority is read only.'); } });
const label = (value: unknown) => check(typeof value === 'string' && value.trim().length > 0 && value.length <= 200, 'INVALID_SCENARIO', 'Supply a nonempty scenario label.');
function dataOnly(value: unknown, seen = new Set<object>()) {
  if (value === null || ['string', 'boolean'].includes(typeof value) || (typeof value === 'number' && Number.isFinite(value))) return;
  check(value && typeof value === 'object' && !seen.has(value), 'INVALID_SCENARIO', 'Scenario inputs must be finite, acyclic plain data.');
  check(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype, 'INVALID_SCENARIO', 'Scenario inputs must be plain data.');
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    check(!['__proto__', 'constructor', 'prototype'].includes(key), 'INVALID_SCENARIO', 'Reserved scenario properties are refused.');
    dataOnly(child, seen);
  }
  if (Array.isArray(value)) check(Object.keys(value).length === value.length, 'INVALID_SCENARIO', 'Sparse scenario arrays are refused.');
  seen.delete(value);
}
function keys(value: unknown, allowed: string[]) {
  check(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key)), 'INVALID_SCENARIO', 'Only declared scenario parameters are accepted.');
}
function price(value: unknown) {
  check(typeof value === 'string' && /^-?\d+$/.test(value), 'SCENARIO_REQUIRED', 'Supply the existing integer price change in basis points.');
  check(BigInt(value) >= -10000n && BigInt(value) <= 100000n, 'SCENARIO_LIMIT', 'The price scenario is outside the calculator range.');
}
const inputState = (state: State) => ({ schemaVersion: state.schemaVersion, workspace: state.workspace, ontology: state.ontology,
  facts: state.facts, imports: state.imports, sourceRules: state.sourceRules, merges: state.merges, tombstones: state.tombstones });
function isolate(state: State) {
  const copy = structuredClone(state);
  for (const field of ['receipts', 'answers', 'decisions', 'actions', 'jobs', 'learning', 'plugins', 'modelReceipts', 'activity', 'conflicts', 'conversations', 'routes', 'sessions', 'unsupported', 'schedules'] as const) copy[field] = [];
  copy.revision = 0;
  return copy;
}
const scope = (request: CalculationRequest) => {
  const { operation, assumptions, comparePeriod, onDate, ...filters } = request;
  return digest(filters);
};
function requestValid(state: State, request: CalculationRequest) {
  dataOnly(request);
  keys(request, ['operation', 'sourceIds', 'period', 'asOf', 'branch', 'customerId', 'orderId', 'comparePeriod', 'onDate', 'assumptions']);
  validatePeriod(request.period); validatePeriod(request.comparePeriod);
  check(typeof request.operation === 'string', 'INVALID_CALCULATION', 'A published calculator operation is required.');
  const dictionary = state.ontology?.current ?? state.ontology;
  const operation = dictionary?.operations?.find((item: { id: string }) => item.id === request.operation);
  check(operation, 'UNKNOWN_CALCULATION', 'Only an existing published calculator operation can be a scenario analysis.');
  if (request.sourceIds !== undefined) check(Array.isArray(request.sourceIds) && request.sourceIds.length <= 64
    && request.sourceIds.every(id => typeof id === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(id))
    && new Set(request.sourceIds).size === request.sourceIds.length, 'INVALID_SOURCE_SCOPE', 'Supply distinct plain source identifiers.');
  for (const field of ['branch', 'customerId', 'orderId'] as const) if (request[field] !== undefined)
    check(typeof request[field] === 'string' && request[field].length > 0, 'INVALID_CALCULATION', 'Calculation scopes must be explicit strings.');
  if (request.asOf !== undefined) check(typeof request.asOf === 'string' && Number.isFinite(Date.parse(request.asOf)), 'INVALID_ASOF', 'Supply a valid knowledge cut.');
  if (operation.type === 'scenario') { keys(request.assumptions, ['priceChangeBps']); price(request.assumptions?.priceChangeBps); }
  else check(request.assumptions === undefined, 'INVALID_CALCULATION', 'Only price scenarios accept branch assumptions.');
  check(!request.comparePeriod || operation.type === 'change', 'INVALID_CALCULATION', 'Only change calculations accept a comparison period.');
  return operation;
}
function job(input: ScenarioAnalysisRequest, id: string, knowledgeCut: string): ScenarioJob {
  const authoredRequest = structuredClone(input.request);
  const request = { ...structuredClone(input.request), asOf: knowledgeCut };
  return { ...structuredClone(input), id, request, authoredRequest, authoredRequestDigest: digest(authoredRequest), requestDigest: digest(request), inputDigest: '' };
}
/** Validate and pin the transitive vector; labels never participate in dependency identity. */
function pinJobs(evidence: ScenarioEvidence, branches: ScenarioBranch[], jobs: ScenarioJob[]): ScenarioJob[] {
  const result = structuredClone(jobs), visited = new Set<string>(), active = new Set<string>();
  check(new Set(result.map(item => item.id)).size === result.length, 'SCENARIO_GRAPH_INVALID', 'Job identities must be unique.');
  const visit = (item: ScenarioJob) => {
    if (visited.has(item.id)) return;
    check(!active.has(item.id), 'SCENARIO_GRAPH_INVALID', 'Scenario dependencies must be acyclic.'); active.add(item.id);
    const branch = branches.find(branch => branch.id === item.branchId);
    check(branch, 'SCENARIO_BRANCH_UNAVAILABLE', 'Resolve the exact scenario branch identity.');
    check(Array.isArray(item.dependsOn) && new Set(item.dependsOn).size === item.dependsOn.length, 'SCENARIO_GRAPH_INVALID', 'Dependencies must be distinct job identities.');
    const predecessors = item.dependsOn.map(id => {
      const predecessor = result.find(other => other.id === id);
      check(predecessor && predecessor.branchId === item.branchId, 'SCENARIO_GRAPH_INVALID', 'Dependencies must exist in the same exact branch.');
      visit(predecessor); return { jobId: id, inputDigest: predecessor.inputDigest };
    });
    item.inputDigest = digest({ evidenceId: evidence.id, evidenceDigest: evidence.digest, requestDigest: item.requestDigest,
      authoredRequestDigest: item.authoredRequestDigest,
      assumptionRevisionId: item.usesBranchAssumptions ? branch.assumptionRevisionId : null, predecessors });
    active.delete(item.id); visited.add(item.id);
  };
  result.forEach(visit); return result;
}
function revision(record: ScenarioRecord, id: string) {
  const result = record.revisions.find(item => item.id === id);
  check(result, 'SCENARIO_REVISION_UNAVAILABLE', 'The exact retained revision is unavailable.'); return result;
}
function evaluation(record: ScenarioRecord, id: string) {
  const result = record.evaluations.find(item => item.revisionId === id);
  check(result, 'SCENARIO_REVISION_UNAVAILABLE', 'The retained evaluation manifest is unavailable.'); return result;
}
/** Metadata is released only for an exact internally coherent retained graph.
 * This checks hashes and issued pins only; it never calculates or refreshes a job. */
function assertDiscoveryGraph(record: ScenarioRecord, selected: ScenarioRevision) {
  const graph = (condition: unknown) => check(condition, 'SCENARIO_GRAPH_INVALID', 'The exact retained scenario graph is unavailable.');
  const vector = (condition: unknown) => check(condition, 'SCENARIO_VECTOR_MISMATCH', 'The exact retained scenario vectors are incompatible.');
  graph(new Set(record.revisions.map(item => item.id)).size === record.revisions.length
    && record.revisions.some(item => item.id === record.headRevisionId)
    && new Set(record.evidence.map(item => item.id)).size === record.evidence.length
    && new Set(record.runs.map(item => item.id)).size === record.runs.length
    && new Set(record.results.map(item => item.runId)).size === record.results.length);
  const checked = new Set<string>();
  const inspectRevision = (rev: ScenarioRevision): ScenarioEvidence => {
    const evidence = record.evidence.find(item => item.id === rev.evidenceId);
    vector(evidence && evidence.digest === rev.evidenceDigest && rev.scenarioId === record.id);
    if (checked.has(rev.id)) return evidence!;
    const dictionary = evidence!.state.ontology?.current ?? evidence!.state.ontology;
    vector(dictionary && dictionary.hash === evidence!.dictionaryHash && dictionary.version === evidence!.dictionaryVersion);
    graph(typeof rev.createdAt === 'string' && Number.isFinite(Date.parse(rev.createdAt))
      && ['initial', 'assumption-change', 'graph-change', 'current-state-recompute'].includes(rev.mode)
      && (rev.mode === 'initial' ? rev.parentRevisionId === null : record.revisions.some(parent => parent.id === rev.parentRevisionId
        && parent.id !== rev.id && parent.scenarioId === record.id))
      && Array.isArray(rev.branches) && rev.branches.length > 1 && Array.isArray(rev.jobs) && rev.jobs.length >= rev.branches.length
      && new Set(rev.branches.map(item => item.id)).size === rev.branches.length
      && rev.branches.filter(item => item.role === 'baseline' && item.id === record.baselineBranchId).length === 1
      && rev.branches.filter(item => item.role === 'baseline').length === 1);
    for (const branch of rev.branches) {
      const root = rev.jobs.find(item => item.id === branch.rootJobId);
      graph(root && root.branchId === branch.id && Array.isArray(root.dependsOn) && root.dependsOn.length === 0
        && root.usesBranchAssumptions === true && ['baseline', 'alternative'].includes(branch.role));
      price(branch.priceChangeBps);
      vector(branch.role !== 'baseline' || BigInt(branch.priceChangeBps) === 0n);
    }
    for (const item of rev.jobs) {
      const branch = rev.branches.find(branch => branch.id === item.branchId);
      graph(branch && typeof item.usesBranchAssumptions === 'boolean');
      const operation = requestValid(evidence!.state, item.request);
      requestValid(evidence!.state, item.authoredRequest);
      vector(item.authoredRequestDigest === digest(item.authoredRequest) && item.requestDigest === digest(item.request)
        && digest(item.request) === digest({ ...item.authoredRequest, asOf: evidence!.knowledgeCut })
        && item.usesBranchAssumptions === (operation.type === 'scenario')
        && (!item.usesBranchAssumptions || item.request.assumptions?.priceChangeBps === branch!.priceChangeBps)
        && scope(item.request) === scope(rev.jobs[0].request));
    }
    const pinned = pinJobs(evidence!, rev.branches, rev.jobs);
    vector(pinned.every((item, index) => item.inputDigest === rev.jobs[index].inputDigest));
    checked.add(rev.id); return evidence!;
  };
  inspectRevision(selected);
  const isAncestor = (ancestor: string, descendant: ScenarioRevision) => {
    const seen = new Set<string>(); let current: ScenarioRevision | undefined = descendant;
    while (current) {
      graph(!seen.has(current.id)); seen.add(current.id);
      if (current.id === ancestor) return true;
      const parent: ScenarioRevision | undefined = record.revisions.find(item => item.id === current!.parentRevisionId);
      graph(current.parentRevisionId === null || parent); current = parent;
    }
    return false;
  };
  // Also reject a parent cycle in a revision whose runs have not started yet.
  graph(selected.parentRevisionId === null || !isAncestor(selected.id, record.revisions.find(item => item.id === selected.parentRevisionId)!));
  const runs = new Set<string>(), inspecting = new Set<string>();
  const referencedResults = new Map<string, ScenarioRunResult>();
  const inspectRun = (id: string): ScenarioRun => {
    const run = record.runs.find(item => item.id === id);
    vector(run);
    if (runs.has(id)) return run!;
    graph(!inspecting.has(id)); inspecting.add(id);
    const original = record.revisions.find(item => item.id === run!.revisionId);
    vector(original);
    const evidence = inspectRevision(original!);
    const item = original!.jobs.find(item => item.id === run!.jobId);
    vector(item && run!.scenarioId === record.id && run!.revisionDigest === original!.digest
      && run!.evidenceId === original!.evidenceId && run!.evidenceDigest === original!.evidenceDigest
      && run!.branchId === item.branchId && run!.requestDigest === item.requestDigest && run!.inputDigest === item.inputDigest);
    graph(Array.isArray(run!.dependencies) && run!.dependencies.length === item!.dependsOn.length);
    for (const [index, dependency] of run!.dependencies.entries()) {
      const predecessor = original!.jobs.find(item => item.id === dependency.jobId);
      const prior = inspectRun(dependency.runId), result = record.results.find(item => item.runId === prior.id);
      vector(dependency.jobId === item!.dependsOn[index] && predecessor && prior.jobId === predecessor.id
        && prior.branchId === predecessor.branchId && prior.inputDigest === predecessor.inputDigest
        && prior.requestDigest === predecessor.requestDigest && prior.evidenceId === original!.evidenceId
        && prior.evidenceDigest === original!.evidenceDigest && dependency.inputDigest === predecessor.inputDigest
        && result && result.digest === dependency.resultDigest && isAncestor(prior.revisionId, original!));
    }
    const result = record.results.find(item => item.runId === id);
    vector(!result || result.runDigest === run!.digest);
    if (result) {
      const receipt = result.receipt, request = item!.request;
      const operation = requestValid(evidence.state, request);
      vector(receipt.period !== undefined && receipt.comparePeriod !== undefined
        && receipt.assumptions && typeof receipt.assumptions === 'object'
        && receipt.memberId === record.memberId && receipt.epoch === record.epoch
        && receipt.operation === request.operation && receipt.asOf === evidence.knowledgeCut
        && receipt.dictionaryHash === evidence.dictionaryHash && receipt.ontologyVersion === evidence.dictionaryVersion
        && receipt.branch === (request.branch ?? null) && digest(receipt.period) === digest(request.period ?? null)
        && digest(receipt.comparePeriod) === digest(request.comparePeriod ?? null)
        && (request.sourceIds === undefined ? !Object.hasOwn(receipt, 'requestedSourceIds')
          : Array.isArray(receipt.requestedSourceIds) && digest(receipt.requestedSourceIds) === digest(request.sourceIds))
        && (!item!.usesBranchAssumptions || receipt.assumptions.priceChangeBps === String(BigInt(request.assumptions!.priceChangeBps)))
        && (operation.type !== 'aging' || receipt.assumptions.onDate === (request.onDate ?? evidence.knowledgeCut.slice(0, 10))));
      graph(Array.isArray(receipt.rows) && Array.isArray(receipt.rowIds) && Array.isArray(receipt.sourceIds)
        && Array.isArray(receipt.exclusions) && receipt.coverage && Array.isArray(receipt.coverage.importIds));
      vector(new Set(receipt.rowIds).size === receipt.rowIds.length
        && digest(receipt.rowIds) === digest(receipt.rows.map(row => row.factId))
        && digest(receipt.sourceIds) === digest([...new Set(receipt.rows.map(row => row.sourceId))]));
      const originalFact = (id: string) => {
        const matches = evidence.state.facts.filter(fact => fact.id === id);
        vector(matches.length === 1 && (!request.branch || matches[0].branch === request.branch)
          && (request.sourceIds === undefined || request.sourceIds.includes(matches[0].sourceId)));
        return matches[0];
      };
      for (const row of receipt.rows) {
        const fact = originalFact(row.factId);
        vector(row.sourceId === fact.sourceId && row.entityId === fact.entityId && row.sourceRow === fact.sourceRow
          && row.kind === fact.kind && row.branch === fact.branch && row.validFrom === fact.validFrom);
      }
      for (const exclusion of receipt.exclusions) originalFact(exclusion.rowId);
      const rowIds = new Set(receipt.rowIds);
      vector(digest(receipt.coverage.importIds) === digest(evidence.state.imports
        .filter(input => input.rowIds?.some((id: string) => rowIds.has(id))).map(input => input.id)));
      referencedResults.set(id, result);
    }
    inspecting.delete(id); runs.add(id); return run!;
  };
  const matchingRun = (id: string, item: ScenarioJob) => {
    const run = inspectRun(id);
    vector(run.jobId === item.id && run.branchId === item.branchId && run.inputDigest === item.inputDigest
      && run.requestDigest === item.requestDigest && run.evidenceId === selected.evidenceId
      && run.evidenceDigest === selected.evidenceDigest && isAncestor(run.revisionId, selected));
    return run;
  };
  const evaluations = record.evaluations.filter(item => item.revisionId === selected.id);
  graph(evaluations.length === 1 && Array.isArray(evaluations[0].jobs));
  const states = evaluations[0].jobs;
  graph(states.length === selected.jobs.length && new Set(states.map(item => item.jobId)).size === states.length
    && states.every(state => selected.jobs.some(item => item.id === state.jobId)));
  for (const state of states) {
    const item = selected.jobs.find(item => item.id === state.jobId)!;
    graph(['pending', 'stale', 'running', 'ready'].includes(state.status)
      && (state.status === 'ready' ? !!state.runId && !state.activeRunId : !state.runId && !state.reusedFromRevisionId)
      && (state.status === 'running' ? !!state.activeRunId : !state.activeRunId)
      && (state.status !== 'pending' || !state.retainedRunId));
    if (state.retainedRunId) {
      const retained = inspectRun(state.retainedRunId);
      vector(retained.jobId === item.id && retained.branchId === item.branchId
        && record.results.some(result => result.runId === retained.id) && isAncestor(retained.revisionId, selected));
    }
    if (state.activeRunId) {
      const active = matchingRun(state.activeRunId, item);
      vector(active.revisionId === selected.id && !record.results.some(result => result.runId === active.id));
    }
    if (state.runId) {
      const run = matchingRun(state.runId, item);
      vector(record.results.some(result => result.runId === run.id));
      if (run.revisionId !== selected.id) {
        const previous = record.revisions.find(item => item.id === state.reusedFromRevisionId);
        const prior = record.evaluations.filter(item => item.revisionId === previous?.id);
        vector(previous && previous.id === selected.parentRevisionId && prior.length === 1
          && previous.jobs.some(job => job.id === item.id && job.inputDigest === item.inputDigest)
          && prior[0].jobs.some(state => state.jobId === item.id && state.status === 'ready' && state.runId === run.id));
      } else vector(!state.reusedFromRevisionId);
      for (const dependency of run.dependencies) vector(states.some(state => state.jobId === dependency.jobId
        && state.status === 'ready' && state.runId === dependency.runId));
    }
  }
  // Comparisons keep their own immutable run selection even if an evaluation ledger later advances.
  for (const comparison of record.comparisons.filter(item => item.revisionId === selected.id)) {
    vector(comparison.scenarioId === record.id && comparison.revisionDigest === selected.digest
      && comparison.evidenceId === selected.evidenceId && comparison.evidenceDigest === selected.evidenceDigest
      && comparison.noAction === true);
    graph(Array.isArray(comparison.requiredJobs) && comparison.requiredJobs.length === selected.jobs.length
      && new Set(comparison.requiredJobs.map(item => item.jobId)).size === selected.jobs.length);
    for (const pin of comparison.requiredJobs) {
      const item = selected.jobs.find(item => item.id === pin.jobId);
      vector(item); const run = matchingRun(pin.runId, item!);
      const result = record.results.find(item => item.runId === run.id);
      vector(result && pin.branchId === item!.branchId && pin.requestDigest === item!.requestDigest
        && pin.inputDigest === item!.inputDigest && pin.runRevisionId === run.revisionId
        && pin.receiptId === result.receipt.id && pin.receiptDigest === result.receiptDigest
        && (run.revisionId === selected.id ? pin.reusedFromRevisionId === null : pin.reusedFromRevisionId === selected.parentRevisionId));
      for (const dependency of run.dependencies) vector(comparison.requiredJobs.some(pin => pin.jobId === dependency.jobId
        && pin.runId === dependency.runId && pin.inputDigest === dependency.inputDigest));
    }
  }
  return [...referencedResults.values()];
}
const limitations = [
  'Only published calculator analyses are supported. Price scenarios hold volume constant and are hypothetical, not qualified demand forecasts or causal predictions.',
  'Receipts retain their original assumptions, exclusions, provenance and coverage gaps. Graph completeness does not certify source completeness or calibrated uncertainty.',
  'This comparison grants no action, materialization, reservation or execution authority. Broader variables, constraints, models and provisional-object binding remain gated.',
];
function synchronous(result: unknown) {
  if (result && typeof (result as { then?: unknown }).then === 'function') {
    if (result instanceof Promise) void result.catch(() => {});
    check(false, 'SCENARIO_HOST_REQUIRED', 'Custody and readiness guards must finish synchronously at the use boundary.');
  }
}

/** Isolated revision graph. The host owns durable encrypted custody; live authority is read-only. */
export class ScenarioService {
  readonly #live: Pick<StateStore, 'read'>;
  readonly #host: ScenarioHost;
  constructor(live: Pick<StateStore, 'read'>, host: ScenarioHost) {
    check(live && typeof live.read === 'function' && host && ['now', 'resolveScenario', 'assertArtifactAuthentic', 'retainScenario', 'calculatorGuards']
      .every(key => typeof (host as unknown as Record<string, unknown>)[key] === 'function'), 'SCENARIO_HOST_REQUIRED', 'Install authenticated custody, atomic retention, clock and readiness hooks.');
    this.#live = live; this.#host = host;
  }
  #clock() {
    const value = this.#host.now(); check(typeof value === 'string' && Number.isFinite(Date.parse(value)), 'SCENARIO_HOST_REQUIRED', 'The host clock must supply a valid instant.');
    return new Date(value).toISOString();
  }
  #access(ctx: Context, evidence: ScenarioEvidence, record?: ScenarioRecord) {
    check(!ctx.sourceTainted, 'SCENARIO_TAINTED_CONTEXT', 'Imported source text cannot authorize scenario work.');
    const live = this.#live.read(), view = internalAccessView(live); authorize(view, ctx);
    check(live.workspace.id === evidence.state.workspace.id, 'SCENARIO_WORKSPACE_CHANGED', 'This retained scenario belongs to another workspace.');
    if (record) check(record.workspaceId === live.workspace.id && record.memberId === ctx.memberId && record.epoch === ctx.epoch,
      'SCENARIO_FORBIDDEN', 'This private scenario belongs to another member or permission epoch.');
    const sources = [...new Set([...evidence.state.facts.map(fact => fact.sourceId), ...evidence.state.imports.map(item => item.sourceId).filter((id): id is string => typeof id === 'string')])];
    assertSourceAccess(live, ctx, sources);
    // This host-only slice retains the complete input snapshot and conservatively withholds it
    // if any retained history is now inaccessible, including excluded and superseded evidence.
    for (const fact of evidence.state.facts) {
      const current = live.facts.find(item => item.id === fact.id);
      check(current && !current.deletedAt && !live.tombstones.some(item => (item.factId ?? item.id) === fact.id)
        && canSeeFact(view, ctx, current) && canSeeFact(view, ctx, fact), 'SCENARIO_EVIDENCE_UNAVAILABLE', 'Retained evidence is deleted or outside current access.');
    }
  }
  #requestAccess(ctx: Context, request: CalculationRequest) {
    const live = this.#live.read(); currentAccess(internalAccessView(live), ctx, request.branch);
    if (request.sourceIds !== undefined) assertSourceAccess(live, ctx, request.sourceIds);
  }
  #currentAuthority(state: State): State {
    const live = this.#live.read();
    return { ...structuredClone(state), members: structuredClone(live.members), policy: structuredClone(live.policy),
      // Preserve retained precedence semantics while every source grant uses current authority.
      sourceRules: [...structuredClone(state.sourceRules.filter(rule => typeof rule.sourceId !== 'string')),
        ...structuredClone(live.sourceRules.filter(rule => typeof rule.sourceId === 'string'))] };
  }
  #load(ctx: Context, id: string): ScenarioRecord {
    authorize(internalAccessView(this.#live.read()), ctx);
    const value = this.#host.resolveScenario(ctx, id); synchronous(value);
    const record = structuredClone(value);
    check(record?.version === 1 && record.id === id, 'SCENARIO_UNAVAILABLE', 'Authenticated scenario custody is unavailable.');
    synchronous(this.#host.assertArtifactAuthentic(ctx, record.digest)); assertSealed(record);
    for (const item of [...record.evidence, ...record.revisions, ...record.runs, ...record.results, ...record.comparisons]) assertSealed(item);
    for (const result of record.results) check(result.receiptDigest === digest(result.receipt), 'SCENARIO_ARTIFACT_CHANGED', 'The retained receipt changed.');
    return record;
  }
  #evidence(record: ScenarioRecord, rev: ScenarioRevision) {
    const evidence = record.evidence.find(item => item.id === rev.evidenceId && item.digest === rev.evidenceDigest);
    check(evidence, 'SCENARIO_EVIDENCE_UNAVAILABLE', 'The exact retained input revision is unavailable.'); return evidence;
  }
  #guard(view: StateStore, phase: 'calculate' | 'reopen') {
    const guards = this.#host.calculatorGuards(view, phase); synchronous(guards);
    check(guards && typeof guards.consumerGuard === 'function' && typeof guards.receiptGuard === 'function', 'SCENARIO_HOST_REQUIRED', 'Both current view-specific calculator guards are required.');
    check(guards.verifier === undefined || typeof guards.verifier === 'function', 'SCENARIO_HOST_REQUIRED', 'Calculator verification must be a trusted installed capability.');
    return {
      ...(guards.verifier ? { verifier: guards.verifier } : {}),
      consumerGuard: (ctx: Context, request: CalculationRequest) => synchronous(guards.consumerGuard(ctx, request)),
      receiptGuard: (ctx: Context, receipt: ScenarioRunResult['receipt']) => synchronous(guards.receiptGuard(ctx, receipt)),
    };
  }
  #snapshot(ctx: Context, cut: string): ScenarioEvidence {
    const state = isolate(this.#live.read()), dictionary = state.ontology?.current ?? state.ontology;
    check(dictionary?.hash && Number.isSafeInteger(dictionary.version), 'DICTIONARY_REQUIRED', 'Publish business definitions before scenario work.');
    const value = seal({ id: newId('scenario_evidence'), knowledgeCut: cut, dictionaryHash: dictionary.hash, dictionaryVersion: dictionary.version,
      factsDigest: digest(state.facts), importsDigest: digest(state.imports), identityDigest: digest({ merges: state.merges, tombstones: state.tombstones }),
      sourceRulesDigest: digest(state.sourceRules), state });
    this.#access(ctx, value); return value;
  }
  #save(ctx: Context, record: ScenarioRecord, expectedDigest: string | null) {
    const rev = revision(record, record.headRevisionId); this.#access(ctx, this.#evidence(record, rev), record);
    for (const item of rev.jobs) this.#requestAccess(ctx, item.request);
    const { digest: ignored, ...body } = record; const next = seal(body);
    synchronous(this.#host.retainScenario(ctx, expectedDigest, structuredClone(next)));
    // Recheck after custody too: a revoked result never escapes through a host callback.
    this.#access(ctx, this.#evidence(next, rev), next); for (const item of rev.jobs) this.#requestAccess(ctx, item.request);
    return next;
  }
  #head(record: ScenarioRecord, expected: string) {
    check(record.headRevisionId === expected, 'SCENARIO_HEAD_CHANGED', 'The scenario head changed. Resolve its exact revision before continuing.');
    return revision(record, expected);
  }
  #append(ctx: Context, record: ScenarioRecord, old: ScenarioRevision, mode: ScenarioRevision['mode'], evidence: ScenarioEvidence,
    branches: ScenarioBranch[], jobs: ScenarioJob[]) {
    authorize(readOnly(this.#live.read()), ctx, 'prepare');
    const rev = seal({ id: newId('scenario_revision'), scenarioId: record.id, parentRevisionId: old.id, mode, createdAt: this.#clock(),
      evidenceId: evidence.id, evidenceDigest: evidence.digest, branches, jobs: pinJobs(evidence, branches, jobs) });
    const previous = evaluation(record, old.id);
    const states: ScenarioJobState[] = rev.jobs.map(item => {
      const prior = previous.jobs.find(state => state.jobId === item.id), oldJob = old.jobs.find(job => job.id === item.id);
      if (prior?.status === 'ready' && prior.runId && oldJob?.inputDigest === item.inputDigest)
        return { jobId: item.id, status: 'ready', runId: prior.runId, reusedFromRevisionId: old.id };
      return { jobId: item.id, status: prior && (prior.runId || prior.activeRunId || prior.retainedRunId) ? 'stale' : 'pending',
        ...(prior?.runId || prior?.retainedRunId ? { retainedRunId: prior.runId ?? prior.retainedRunId } : {}) };
    });
    const expected = record.digest; record.revisions.push(rev); record.evaluations.push({ revisionId: rev.id, jobs: states }); record.headRevisionId = rev.id;
    return this.#view(ctx, this.#save(ctx, record, expected), rev.id);
  }
  #view(ctx: Context, record: ScenarioRecord, id: string): ScenarioView {
    const rev = revision(record, id), evidence = this.#evidence(record, rev); this.#access(ctx, evidence, record);
    const states = evaluation(record, id).jobs, ids = new Set(states.flatMap(item => [item.runId, item.retainedRunId].filter((id): id is string => !!id)));
    const results = record.results.filter(item => ids.has(item.runId));
    const guards = this.#guard(readOnly(this.#currentAuthority(evidence.state)), 'reopen');
    for (const item of rev.jobs) { this.#requestAccess(ctx, item.request); guards.consumerGuard(ctx, structuredClone(item.request)); }
    for (const item of results) {
      const run = record.runs.find(run => run.id === item.runId);
      check(run, 'SCENARIO_RUN_UNAVAILABLE', 'The retained receipt needs its original run pin.');
      const originalEvidence = this.#evidence(record, revision(record, run.revisionId));
      this.#access(ctx, originalEvidence, record);
      const originalView = readOnly(this.#currentAuthority(originalEvidence.state));
      this.#guard(originalView, 'reopen').receiptGuard(ctx, structuredClone(item.receipt));
    }
    this.#access(ctx, evidence, record); for (const item of rev.jobs) this.#requestAccess(ctx, item.request);
    const output: ScenarioView = { scenarioId: record.id, headRevisionId: record.headRevisionId, mode: 'retained-revision', revision: rev,
      jobs: states, status: states.every(item => item.status === 'ready') ? 'complete' : 'partial', results,
      comparisons: record.comparisons.filter(item => item.revisionId === id), noAction: true };
    return structuredClone(output);
  }
  create(ctx: Context, request: ScenarioCreateRequest): ScenarioView {
    authorize(readOnly(this.#live.read()), ctx, 'prepare'); dataOnly(request); keys(request, ['version', 'label', 'baseline', 'alternatives']);
    check(request.version === 1, 'INVALID_SCENARIO', 'Use scenario contract version one.'); label(request.label);
    keys(request.baseline, ['label', 'request']); label(request.baseline.label);
    check(Array.isArray(request.alternatives) && request.alternatives.length > 0, 'INVALID_SCENARIO', 'Supply explicit alternatives.');
    const captured = digest(inputState(this.#live.read())), authored = request.baseline.request;
    requestValid(this.#live.read(), authored);
    const cut = authored.asOf === undefined ? this.#clock() : new Date(authored.asOf).toISOString();
    const evidence = this.#snapshot(ctx, cut), operation = requestValid(evidence.state, authored);
    check(operation.type === 'scenario' && BigInt(authored.assumptions!.priceChangeBps) === 0n, 'SCENARIO_BASELINE_REQUIRED', 'Supply an explicit zero-price-change calculator baseline.');
    const branches: ScenarioBranch[] = [], jobs: ScenarioJob[] = [];
    for (const [index, input] of [{ label: request.baseline.label, priceChangeBps: authored.assumptions!.priceChangeBps }, ...request.alternatives].entries()) {
      if (index > 0) keys(input, ['label', 'priceChangeBps']); label(input.label); price(input.priceChangeBps);
      const branch: ScenarioBranch = { id: newId('scenario_branch'), label: input.label, role: index === 0 ? 'baseline' : 'alternative',
        assumptionRevisionId: newId('scenario_assumption'), priceChangeBps: input.priceChangeBps, rootJobId: newId('scenario_job') };
      branches.push(branch);
      jobs.push(job({ branchId: branch.id, label: input.label, request: { ...structuredClone(authored), assumptions: { priceChangeBps: input.priceChangeBps } },
        dependsOn: [], usesBranchAssumptions: true }, branch.rootJobId, cut));
    }
    const id = newId('scenario'), rev = seal({ id: newId('scenario_revision'), scenarioId: id, parentRevisionId: null, mode: 'initial' as const,
      createdAt: this.#clock(), evidenceId: evidence.id, evidenceDigest: evidence.digest, branches, jobs: pinJobs(evidence, branches, jobs) });
    const record = seal({ version: 1 as const, id, workspaceId: evidence.state.workspace.id, memberId: ctx.memberId, epoch: ctx.epoch, label: request.label,
      baselineBranchId: branches[0].id, headRevisionId: rev.id, evidence: [evidence], revisions: [rev],
      evaluations: [{ revisionId: rev.id, jobs: jobs.map(item => ({ jobId: item.id, status: 'pending' as const })) }], runs: [], results: [], comparisons: [] });
    check(captured === digest(inputState(this.#live.read())), 'SCENARIO_INPUTS_CHANGED', 'Source inputs changed during scenario capture.');
    return this.#view(ctx, this.#save(ctx, record, null), rev.id);
  }
  addAnalysis(ctx: Context, id: string, expectedHead: string, input: ScenarioAnalysisRequest): ScenarioView {
    const record = this.#load(ctx, id), old = this.#head(record, expectedHead), evidence = this.#evidence(record, old);
    this.#access(ctx, evidence, record); dataOnly(input); keys(input, ['branchId', 'label', 'request', 'dependsOn', 'usesBranchAssumptions']); label(input.label);
    const branch = old.branches.find(item => item.id === input.branchId);
    check(branch, 'SCENARIO_BRANCH_UNAVAILABLE', 'Supply the exact branch identity.');
    const operation = requestValid(evidence.state, input.request);
    check(typeof input.usesBranchAssumptions === 'boolean' && input.usesBranchAssumptions === (operation.type === 'scenario'),
      'INVALID_SCENARIO', 'Declare price assumption use exactly for existing price-scenario calculations.');
    if (input.usesBranchAssumptions) check(input.request.assumptions!.priceChangeBps === branch.priceChangeBps, 'SCENARIO_VECTOR_MISMATCH', 'The request must bind the exact branch assumption text.');
    const item = job(input, newId('scenario_job'), evidence.knowledgeCut);
    check(input.request.asOf === undefined || new Date(input.request.asOf).toISOString() === evidence.knowledgeCut, 'SCENARIO_VECTOR_MISMATCH', 'Analyses share the exact retained knowledge cut.');
    check(scope(item.request) === scope(old.jobs[0].request), 'SCENARIO_VECTOR_MISMATCH', 'Analyses share the baseline source, period and object scope.');
    return this.#append(ctx, record, old, 'graph-change', evidence, structuredClone(old.branches), [...old.jobs, item]);
  }
  changeAssumption(ctx: Context, id: string, expectedHead: string, branchId: string, priceChangeBps: string): ScenarioView {
    const record = this.#load(ctx, id), old = this.#head(record, expectedHead), evidence = this.#evidence(record, old); this.#access(ctx, evidence, record); price(priceChangeBps);
    const branches = structuredClone(old.branches), branch = branches.find(item => item.id === branchId);
    check(branch?.role === 'alternative', 'SCENARIO_BASELINE_IMMUTABLE', 'Only an exact alternative branch can change its price assumption.');
    check(branch.priceChangeBps !== priceChangeBps, 'SCENARIO_NO_CHANGE', 'Supply a changed assumption.');
    branch.priceChangeBps = priceChangeBps; branch.assumptionRevisionId = newId('scenario_assumption');
    const jobs = old.jobs.map(item => {
      if (item.branchId !== branchId || !item.usesBranchAssumptions) return item;
      const request = { ...structuredClone(item.authoredRequest), assumptions: { priceChangeBps } };
      return job({ ...item, request }, item.id, evidence.knowledgeCut);
    });
    return this.#append(ctx, record, old, 'assumption-change', evidence, branches, jobs);
  }
  beginRun(ctx: Context, id: string, revisionId: string, jobId: string): ScenarioRun {
    const record = this.#load(ctx, id), rev = this.#head(record, revisionId), evidence = this.#evidence(record, rev); this.#access(ctx, evidence, record);
    authorize(readOnly(this.#live.read()), ctx, 'prepare');
    const item = rev.jobs.find(item => item.id === jobId), states = evaluation(record, rev.id).jobs, state = states.find(item => item.jobId === jobId);
    check(item && state, 'SCENARIO_JOB_UNAVAILABLE', 'Resolve the exact required job.'); this.#requestAccess(ctx, item.request);
    check(state.status !== 'ready' && !state.activeRunId, 'SCENARIO_RUN_EXISTS', 'This job is already ready or running.');
    const dependencies = item.dependsOn.map(jobId => {
      const status = states.find(item => item.jobId === jobId), predecessor = rev.jobs.find(item => item.id === jobId);
      const result = record.results.find(item => item.runId === status?.runId);
      check(status?.status === 'ready' && result && predecessor, 'SCENARIO_DEPENDENCIES_PENDING', 'All exact predecessor runs must be ready.');
      return { jobId, inputDigest: predecessor.inputDigest, runId: result.runId, resultDigest: result.digest };
    });
    const run = seal({ id: newId('scenario_run'), scenarioId: id, revisionId: rev.id, revisionDigest: rev.digest, branchId: item.branchId, jobId,
      evidenceId: evidence.id, evidenceDigest: evidence.digest, requestDigest: item.requestDigest, inputDigest: item.inputDigest,
      dependencies, createdAt: this.#clock() });
    const expected = record.digest; record.runs.push(run); state.status = 'running'; state.activeRunId = run.id; this.#save(ctx, record, expected);
    return structuredClone(run);
  }
  async evaluate(ctx: Context, id: string, runId: string): Promise<ScenarioRunResult> {
    const record = this.#load(ctx, id), run = record.runs.find(item => item.id === runId);
    check(run, 'SCENARIO_RUN_UNAVAILABLE', 'Use an issued retained run identity.');
    const rev = revision(record, run.revisionId), evidence = this.#evidence(record, rev), item = rev.jobs.find(item => item.id === run.jobId);
    this.#access(ctx, evidence, record); authorize(readOnly(this.#live.read()), ctx, 'prepare');
    check(item && run.revisionDigest === rev.digest && run.inputDigest === item.inputDigest && run.requestDigest === item.requestDigest,
      'SCENARIO_VECTOR_MISMATCH', 'The run must match its exact issued revision and request vector.');
    const existing = record.results.find(item => item.runId === runId);
    if (existing) { this.#view(ctx, record, rev.id); return structuredClone(existing); }
    const draft = structuredClone(evidence.state);
    // Current authority is read live while meaning/evidence stay at the retained cut.
    const view: StateStore = {
      read: () => { this.#access(ctx, evidence, record); return this.#currentAuthority(draft); },
      update: async change => { this.#access(ctx, evidence, record); const current = this.#currentAuthority(draft);
        draft.members = current.members; draft.policy = current.policy; draft.sourceRules = current.sourceRules;
        const result = await change(draft); this.#access(ctx, evidence, record); return result; },
    };
    const guards = this.#guard(view, 'calculate');
    const receipt = await new CalculatorService(view, {
      ...(guards.verifier ? { verifier: guards.verifier } : {}),
      consumerGuard: (context, request) => { this.#access(context, evidence, record); this.#requestAccess(context, request); guards.consumerGuard(context, request); },
      receiptGuard: (context, value) => { this.#access(context, evidence, record); guards.receiptGuard(context, value); },
    }).calculate(ctx, item.request);
    this.#access(ctx, evidence, record); this.#requestAccess(ctx, item.request);
    const latest = this.#load(ctx, id), issued = latest.runs.find(item => item.id === runId);
    check(issued?.digest === run.digest, 'SCENARIO_VECTOR_MISMATCH', 'The issued run changed during calculation.');
    const prior = latest.results.find(item => item.runId === runId);
    if (prior) { this.#view(ctx, latest, rev.id); return structuredClone(prior); }
    const state = evaluation(latest, rev.id).jobs.find(item => item.jobId === run.jobId);
    check(state?.activeRunId === runId, 'SCENARIO_VECTOR_MISMATCH', 'The run no longer owns its original evaluation slot.');
    for (const dependency of run.dependencies) check(latest.results.some(item => item.runId === dependency.runId && item.digest === dependency.resultDigest),
      'SCENARIO_VECTOR_MISMATCH', 'The exact predecessor result is unavailable.');
    const result = seal({ runId, runDigest: run.digest, receipt: structuredClone(receipt), receiptDigest: digest(receipt) });
    const expected = latest.digest; latest.results.push(result); state.status = 'ready'; state.runId = runId; delete state.activeRunId;
    this.#save(ctx, latest, expected); this.#access(ctx, evidence, latest); this.#requestAccess(ctx, item.request);
    // Late completion only fills its original revision. It never promotes the current head.
    return structuredClone(result);
  }
  finalize(ctx: Context, id: string, expectedHead: string): ScenarioComparison {
    const record = this.#load(ctx, id), rev = this.#head(record, expectedHead), states = evaluation(record, rev.id).jobs;
    this.#view(ctx, record, rev.id); authorize(readOnly(this.#live.read()), ctx, 'prepare');
    check(states.every(item => item.status === 'ready'), 'SCENARIO_COMPARISON_PARTIAL', 'The comparison still contains pending, stale or running analyses.');
    const requiredJobs = rev.jobs.map(item => {
      const state = states.find(state => state.jobId === item.id), run = record.runs.find(run => run.id === state?.runId), result = record.results.find(result => result.runId === run?.id);
      check(run && result && run.inputDigest === item.inputDigest && run.requestDigest === item.requestDigest
        && run.evidenceId === rev.evidenceId && run.evidenceDigest === rev.evidenceDigest && run.branchId === item.branchId,
      'SCENARIO_VECTOR_MISMATCH', 'Every required run must match the selected revision vector.');
      for (const dependency of run.dependencies) {
        const selected = states.find(state => state.jobId === dependency.jobId), predecessor = rev.jobs.find(job => job.id === dependency.jobId);
        check(selected?.runId === dependency.runId && predecessor?.inputDigest === dependency.inputDigest
          && record.results.some(result => result.runId === dependency.runId && result.digest === dependency.resultDigest),
        'SCENARIO_VECTOR_MISMATCH', 'A descendant cannot finalize against mixed predecessor revisions.');
      }
      return { jobId: item.id, branchId: item.branchId, requestDigest: item.requestDigest, inputDigest: item.inputDigest, runId: run.id,
        runRevisionId: run.revisionId, receiptId: result.receipt.id, receiptDigest: result.receiptDigest, reusedFromRevisionId: state?.reusedFromRevisionId ?? null };
    });
    const comparison = seal({ id: newId('scenario_comparison'), scenarioId: id, revisionId: rev.id, revisionDigest: rev.digest,
      evidenceId: rev.evidenceId, evidenceDigest: rev.evidenceDigest, createdAt: this.#clock(), requiredJobs, noAction: true as const, limitations });
    const expected = record.digest; record.comparisons.push(comparison); this.#save(ctx, record, expected); this.#view(ctx, record, rev.id);
    return structuredClone(comparison);
  }
  reopen(ctx: Context, id: string, revisionId: string): ScenarioView { return this.#view(ctx, this.#load(ctx, id), revisionId); }
  describe(ctx: Context, id: string, revisionId: string): ScenarioDiscoveryRow {
    const record = this.#load(ctx, id), view = this.#view(ctx, record, revisionId);
    const results = assertDiscoveryGraph(record, view.revision);
    label(record.label);
    // An immutable comparison may still pin a receipt replaced in the mutable evaluation ledger.
    // Guard every graph-referenced receipt using its exact original evidence before releasing metadata.
    for (const result of results) {
      const run = record.runs.find(item => item.id === result.runId)!;
      const original = revision(record, run.revisionId), request = original.jobs.find(item => item.id === run.jobId)!.request;
      const evidence = this.#evidence(record, original);
      this.#access(ctx, evidence, record);
      this.#requestAccess(ctx, request);
      assertSourceAccess(this.#live.read(), ctx, result.receipt.sourceIds);
      this.#guard(readOnly(this.#currentAuthority(evidence.state)), 'reopen').receiptGuard(ctx, structuredClone(result.receipt));
      this.#access(ctx, evidence, record); this.#requestAccess(ctx, request);
      assertSourceAccess(this.#live.read(), ctx, result.receipt.sourceIds);
    }
    // Repeat the ordinary release guards after the view-specific callbacks.
    this.#access(ctx, this.#evidence(record, view.revision), record);
    for (const item of view.revision.jobs) this.#requestAccess(ctx, item.request);
    return { scenarioId: record.id, revisionId: view.revision.id, label: record.label,
      createdAt: view.revision.createdAt, revisionMode: view.revision.mode, status: view.status,
      isHead: record.headRevisionId === view.revision.id, noAction: true };
  }
  recompute(ctx: Context, id: string, expectedHead: string): ScenarioView {
    const record = this.#load(ctx, id), old = this.#head(record, expectedHead); this.#view(ctx, record, old.id);
    const captured = digest(inputState(this.#live.read())), evidence = this.#snapshot(ctx, this.#clock());
    const jobs = old.jobs.map(item => {
      const request = { ...structuredClone(item.request), asOf: evidence.knowledgeCut };
      requestValid(evidence.state, request);
      return job({ ...item, request }, item.id, evidence.knowledgeCut);
    });
    check(captured === digest(inputState(this.#live.read())), 'SCENARIO_INPUTS_CHANGED', 'Source inputs changed during explicit recomputation capture.');
    record.evidence.push(evidence);
    return this.#append(ctx, record, old, 'current-state-recompute', evidence, structuredClone(old.branches), jobs);
  }
}
