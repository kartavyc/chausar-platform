import { authorize, check, ChausarError, hash, now, type Context, type State, type StateStore } from './contracts.ts';
import { Vault } from './vault.ts';
import { ScenarioService } from './scenario-service.ts';
import type {
  ScenarioAnalysisRequest, ScenarioCalculatorOptions, ScenarioComparison, ScenarioCreateRequest,
  ScenarioHost, ScenarioRecord, ScenarioRun, ScenarioRunResult, ScenarioView,
} from './scenario-contracts.ts';

/** Installed Engine capabilities only. No custody, verifier or clock comes from RPC. */
export type EngineScenarioOptions = {
  calculatorOptions(view: StateStore, phase: 'calculate' | 'reopen'): ScenarioCalculatorOptions;
  now?: () => string;
};

const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => [key, canonical(child)])) : value;
function assertSealed(record: ScenarioRecord) {
  const { digest, ...body } = record;
  check(typeof digest === 'string' && /^[a-f0-9]{64}$/.test(digest) && digest === hash(canonical(body)),
    'SCENARIO_ARTIFACT_CHANGED', 'The exact encrypted scenario record changed.');
}
function records(state: State): ScenarioRecord[] {
  check(state.scenarioRecords === undefined || Array.isArray(state.scenarioRecords),
    'SCENARIO_CUSTODY_INVALID', 'The encrypted scenario namespace is invalid.');
  return state.scenarioRecords ?? [];
}
const retainedCoreStores = ['receipts', 'answers', 'decisions', 'actions', 'jobs', 'learning', 'conversations',
  'modelReceipts', 'conflicts', 'merges'] as const;
const retainedDate = (input: { learnedAt?: unknown; createdAt?: unknown; at?: unknown }) => input.learnedAt !== undefined
  ? input.learnedAt : input.createdAt !== undefined ? input.createdAt : input.at;
/** Immutable retained cuts retain their age when reopened or recomputed. */
function assertRetention(state: State, record: ScenarioRecord, at: string) {
  check([record.revisions, record.runs, record.comparisons, record.results, record.evidence]
    .every(items => Array.isArray(items) && items.every(item => item && typeof item === 'object'))
    && record.results.every(item => item.receipt && typeof item.receipt === 'object')
    && record.evidence.every(item => item.state && Array.isArray(item.state.facts) && Array.isArray(item.state.imports)
      && retainedCoreStores.every(field => Array.isArray(item.state[field]))
      && [...item.state.facts, ...item.state.imports, ...retainedCoreStores.flatMap(field => item.state[field])]
        .every(input => input && typeof input === 'object')),
  'SCENARIO_CUSTODY_INVALID', 'The complete encrypted scenario retention record is invalid.');
  const instant = Date.parse(at), days = state.policy.retentionDays;
  check(Number.isFinite(instant) && Number.isInteger(days) && days >= 1 && days <= 3650,
    'SCENARIO_RETENTION_EXPIRED', 'Current scenario retention authority is unavailable.');
  const cutoff = instant - days * 86400000;
  const dates = [
    ...record.revisions.map(item => item.createdAt), ...record.runs.map(item => item.createdAt),
    ...record.comparisons.map(item => item.createdAt), ...record.results.map(item => item.receipt.createdAt),
    ...record.evidence.flatMap(item => [item.knowledgeCut, ...item.state.facts.map(fact => fact.learnedAt),
      ...item.state.imports.filter(input => input.at !== undefined).map(input => input.at),
      ...retainedCoreStores.flatMap(field => item.state[field]).map(retainedDate)
        .filter(value => value !== undefined)]),
  ];
  check(dates.every(value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && Date.parse(value) >= cutoff),
    'SCENARIO_RETENTION_EXPIRED', 'The complete retained scenario exceeds the current retention window.');
}
/** Private custody is never an input to another retained evidence snapshot. */
function inputState(state: State): State {
  const copy = structuredClone(state);
  delete copy.scenarioRecords; delete copy.lessonState;
  return copy;
}
function readOnly(read: () => State): StateStore {
  return { read, update: async () => { throw new ChausarError('SCENARIO_READ_ONLY', 'Scenario authority is read only.'); } };
}
/** Preserve Vault's original serialized update and encrypted revision CAS. */
function serializedVaultStateStore(vault: Vault): StateStore {
  return { read: () => vault.read(), update: change => vault.update(change) };
}

/** Only producer-issued scenario identities cross this API. All custody is in the encrypted Vault. */
export class EngineScenarioService {
  readonly #vault: Vault;
  readonly #store: StateStore;
  readonly #options: EngineScenarioOptions;
  constructor(vault: Vault, options: EngineScenarioOptions) {
    check(vault instanceof Vault && options && typeof options.calculatorOptions === 'function'
      && (options.now === undefined || typeof options.now === 'function'),
      'SCENARIO_HOST_REQUIRED', 'Install an unlocked encrypted Vault and current calculator capabilities.');
    this.#vault = vault; this.#store = serializedVaultStateStore(vault); this.#options = { ...options };
  }

  #service(state: State, context: Context, mutable: boolean) {
    const identity = this.#vault.readIdentity();
    const permission = mutable ? 'prepare' : 'read';
    const resolvedIds = new Set<string>();
    const assertCurrent = (ctx: Context = context) => {
      const current = this.#vault.readIdentity();
      check(current.vaultId === identity.vaultId && current.workspaceId === state.workspace.id
        && current.revision === state.revision, 'SCENARIO_AUTHORITY_CHANGED', 'Scenario custody must use the exact current Vault revision.');
      check(ctx.memberId === context.memberId && ctx.role === context.role && ctx.epoch === context.epoch,
        'SCENARIO_FORBIDDEN', 'Use the current operation account and permission epoch.');
      authorize(this.#store, ctx, permission);
      check(!ctx.sourceTainted, 'SCENARIO_TAINTED_CONTEXT', 'Imported source text cannot authorize scenario work.');
    };
    const assertScope = (ctx: Context, record: ScenarioRecord) => {
      assertCurrent(ctx);
      check(record?.version === 1 && record.workspaceId === state.workspace.id
        && record.memberId === ctx.memberId && record.epoch === ctx.epoch,
        'SCENARIO_FORBIDDEN', 'This private scenario belongs to another workspace, member or permission epoch.');
      assertSealed(record);
      assertRetention(state, record, (this.#options.now ?? now)());
    };
    const host: ScenarioHost = {
      now: this.#options.now ?? now,
      resolveScenario: (ctx, id) => {
        assertCurrent(ctx);
        const matches = records(state).filter(record => record?.id === id);
        check(matches.length === 1, 'SCENARIO_UNAVAILABLE', 'Resolve an exact retained scenario identity from encrypted custody.');
        assertScope(ctx, matches[0]); resolvedIds.add(id); return structuredClone(matches[0]);
      },
      assertArtifactAuthentic: (ctx, digest) => {
        assertCurrent(ctx);
        const matches = records(state).filter(record => record?.digest === digest);
        check(matches.length === 1, 'SCENARIO_UNAVAILABLE', 'The exact artifact is absent from current encrypted custody.');
        assertScope(ctx, matches[0]);
      },
      retainScenario: (ctx, expectedDigest, record) => {
        check(mutable, 'SCENARIO_READ_ONLY', 'Reopening cannot modify scenario custody.');
        assertScope(ctx, record);
        const namespace = records(state), matches = namespace.filter(item => item?.id === record.id);
        check(expectedDigest === null ? matches.length === 0 : matches.length === 1 && matches[0].digest === expectedDigest,
          'SCENARIO_CUSTODY_CONFLICT', 'The exact prior scenario digest changed; custody cannot overwrite or merge it.');
        if (matches.length) assertScope(ctx, matches[0]);
        // This synchronous draft CAS is called only by this operation's producer. The sole
        // outer Vault.update encrypts and commits it before any result is released.
        const retained = structuredClone(record);
        if (matches.length) namespace[namespace.indexOf(matches[0])] = retained;
        else namespace.push(retained);
        state.scenarioRecords = namespace;
        resolvedIds.add(record.id);
        assertCurrent(ctx);
      },
      calculatorGuards: (view, phase) => { assertCurrent(); return this.#options.calculatorOptions(view, phase); },
    };
    return {
      service: new ScenarioService(readOnly(() => { assertCurrent(); return inputState(state); }), host),
      assertRelease: () => {
        assertCurrent();
        for (const id of resolvedIds) {
          const matches = records(state).filter(record => record?.id === id);
          check(matches.length === 1, 'SCENARIO_UNAVAILABLE', 'The exact scenario is unavailable at release.');
          assertScope(context, matches[0]);
        }
      },
      references: () => [...resolvedIds].map(id => {
        const matches = records(state).filter(record => record?.id === id);
        check(matches.length === 1, 'SCENARIO_UNAVAILABLE', 'The exact issued scenario reference is unavailable.');
        assertScope(context, matches[0]);
        return { id, revisions: matches[0].revisions.map(revision => ({ id: revision.id, digest: revision.digest })) };
      }),
      resolveReference: (id: string) => {
        const matches = records(state).filter(record => record?.id === id);
        check(matches.length === 1, 'SCENARIO_UNAVAILABLE', 'The committed scenario is unavailable at release.');
        assertScope(context, matches[0]); resolvedIds.add(id);
        return matches[0];
      },
    };
  }

  async #write<T>(context: Context, work: (service: ScenarioService, ctx: Context) => T | Promise<T>): Promise<T> {
    const ctx = structuredClone(context);
    let references: { id: string; revisions: { id: string; digest: string }[] }[] = [];
    const result = await this.#store.update(async state => {
      authorize(this.#store, ctx, 'prepare');
      const operation = this.#service(state, ctx, true), result = await work(operation.service, ctx);
      operation.assertRelease();
      references = operation.references();
      authorize(this.#store, ctx, 'prepare');
      return structuredClone(result);
    });
    // The encrypted adapter may await publication after the draft callback has finished.
    // Reenter only a fresh readonly fence after that commit: queued deletion/revocation
    // and elapsed retention must withhold the original result without replaying a write.
    await this.#vault.snapshot(async state => {
      authorize(this.#store, ctx, 'prepare');
      check(references.length > 0, 'SCENARIO_UNAVAILABLE', 'The operation has no exact issued custody reference.');
      const operation = this.#service(state, ctx, false);
      for (const reference of references) {
        const record = operation.resolveReference(reference.id);
        for (const pin of reference.revisions) check(record.revisions.filter(revision => revision.id === pin.id
          && revision.digest === pin.digest).length === 1, 'SCENARIO_ARTIFACT_CHANGED', 'The original issued revision changed during publication.');
        // Reopening checks the complete retained graph, current source/branch authority
        // and per-view receipt readiness. It performs no arithmetic or Vault update.
        for (const revision of record.revisions) operation.service.reopen(ctx, record.id, revision.id);
      }
      operation.assertRelease();
      authorize(this.#store, ctx, 'prepare');
    });
    return result;
  }
  #read<T>(context: Context, work: (service: ScenarioService, ctx: Context) => T): Promise<T> {
    const ctx = structuredClone(context);
    return this.#vault.snapshot(async state => {
      authorize(this.#store, ctx);
      const operation = this.#service(state, ctx, false), result = work(operation.service, ctx);
      operation.assertRelease();
      authorize(this.#store, ctx);
      return structuredClone(result);
    });
  }

  create(ctx: Context, request: ScenarioCreateRequest): Promise<ScenarioView> {
    const input = structuredClone(request);
    return this.#write(ctx, (service, current) => service.create(current, input));
  }
  addAnalysis(ctx: Context, id: string, expectedHead: string, request: ScenarioAnalysisRequest): Promise<ScenarioView> {
    const input = structuredClone(request);
    return this.#write(ctx, (service, current) => service.addAnalysis(current, id, expectedHead, input));
  }
  changeAssumption(ctx: Context, id: string, expectedHead: string, branchId: string, priceChangeBps: string): Promise<ScenarioView> {
    return this.#write(ctx, (service, current) => service.changeAssumption(current, id, expectedHead, branchId, priceChangeBps));
  }
  beginRun(ctx: Context, id: string, revisionId: string, jobId: string): Promise<ScenarioRun> {
    return this.#write(ctx, (service, current) => service.beginRun(current, id, revisionId, jobId));
  }
  evaluate(ctx: Context, id: string, runId: string): Promise<ScenarioRunResult> {
    return this.#write(ctx, (service, current) => service.evaluate(current, id, runId));
  }
  finalize(ctx: Context, id: string, expectedHead: string): Promise<ScenarioComparison> {
    return this.#write(ctx, (service, current) => service.finalize(current, id, expectedHead));
  }
  reopen(ctx: Context, id: string, revisionId: string): Promise<ScenarioView> {
    return this.#read(ctx, (service, current) => service.reopen(current, id, revisionId));
  }
  recompute(ctx: Context, id: string, expectedHead: string): Promise<ScenarioView> {
    return this.#write(ctx, (service, current) => service.recompute(current, id, expectedHead));
  }
}
