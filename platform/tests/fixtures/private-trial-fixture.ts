import assert from 'node:assert/strict';
import { CalculatorService, type CalculationRequest } from '../../runtime/calculator.ts';
import { check, hash, initialState, type Context, type Fact, type State, type StateStore } from '../../runtime/contracts.ts';
import { ImportService, type ImportInput, type MappingRecipe } from '../../runtime/ingest.ts';
import { compileDictionary, starterPacks } from '../../runtime/ontology.ts';
import type {
  PrivateTrialChange, PrivateTrialDependencyImpact, PrivateTrialEvaluation, PrivateTrialFork,
  PrivateTrialGuardContext, PrivateTrialHost, PrivateTrialRecipeEvidence,
} from '../../runtime/private-trial-contracts.ts';

// Pure synthetic source fixture. No Vault, database verifier, native runtime, model, or transport.
export const OWNER: Context = { memberId: 'owner', role: 'owner', epoch: 1 };
export const CLOCK = '2026-10-01T12:00:00.000Z';
export const CUT = '2026-09-30T23:59:59.000Z';
export const PERIOD = { from: '2026-09-01', to: '2026-09-30' };
const LEARNED = '2026-09-02T00:00:00.000Z';

export class SyntheticTrialStore implements StateStore {
  state: State;
  updates = 0;
  constructor(state = syntheticState()) { this.state = structuredClone(state); }
  read() { return structuredClone(this.state); }
  async update<T>(change: (state: State) => T | Promise<T>): Promise<T> {
    const draft = this.read(); const result = await change(draft); this.state = draft; this.updates++; return result;
  }
}

export function syntheticFact(id: string, kind: string, amountMinor: string, overrides: Partial<Fact> = {}): Fact {
  return {
    id, entityId: id, sourceId: 'synthetic-register', sourceRow: 2, kind,
    validFrom: '2026-09-10', validTo: null, learnedAt: LEARNED, supersededAt: null, branch: 'main',
    fields: { amountMinor, currency: 'INR', status: 'settled' }, ...structuredClone(overrides),
  };
}

export function syntheticState(): State {
  const state = initialState('Synthetic private trial acceptance', true);
  state.workspace = { id: 'synthetic-trial-workspace', name: 'Synthetic private trial acceptance', currency: 'INR', demo: true, createdAt: LEARNED };
  const dictionary = compileDictionary(structuredClone(starterPacks.find(pack => pack.pack === 'retail')!), 7, 'owner', LEARNED);
  state.ontology = { current: dictionary, history: [dictionary] };
  state.facts = [
    syntheticFact('invoice-huge', 'invoice', '900719925474099325', { fields: { amountMinor: '900719925474099325', taxMinor: '30', currency: 'INR', status: 'settled', invoiceId: 'I-H', customerId: 'C', dueDate: '2026-09-15' } }),
    syntheticFact('invoice-small', 'invoice', '75', { sourceRow: 3, fields: { amountMinor: '75', taxMinor: '70', currency: 'INR', status: 'settled', invoiceId: 'I-S', customerId: 'C', dueDate: '2026-09-15' } }),
    syntheticFact('payment-one', 'payment', '7000', { sourceRow: 4 }),
    syntheticFact('sale-one', 'sale', '12500', { sourceRow: 5 }),
  ];
  return state;
}

export function savedRequest(operation: string, extra: Partial<CalculationRequest> = {}): CalculationRequest {
  return { operation, period: { ...PERIOD }, asOf: CUT, branch: 'main', sourceIds: ['synthetic-register'], ...extra };
}

export async function saveQuestions(store: SyntheticTrialStore, requests = ['billed', 'received', 'earned'].map(operation => savedRequest(operation))) {
  const calculator = new CalculatorService(store);
  for (let index = 0; index < requests.length; index++) {
    const receipt = await calculator.calculate(OWNER, requests[index]);
    const storedReceipt = store.state.receipts.find(item => item.id === receipt.id)!;
    const storedAnswer = store.state.answers.find(item => item.receiptId === receipt.id)!;
    storedReceipt.id = `synthetic-receipt-${index + 1}`; storedReceipt.createdAt = CLOCK;
    storedAnswer.id = `synthetic-answer-${index + 1}`; storedAnswer.receiptId = storedReceipt.id; storedAnswer.at = CLOCK;
  }
  store.state.activity = [];
  return store.state.answers.map(answer => answer.id as string);
}

export function definitionChange(store: SyntheticTrialStore): Extract<PrivateTrialChange, { type: 'definition' }> {
  const original = store.read().ontology.current.definitions.find((item: { name: string }) => item.name === 'billed');
  return { type: 'definition', name: 'billed', replacement: { ...original, field: 'taxMinor', meaning: 'Only the explicitly imported invoice tax amount, by invoice date.' } };
}

export type GuardCall = PrivateTrialGuardContext & { kind: 'consumer' | 'receipt'; dictionaryHash: string; operation: string };
export function syntheticHost(store: SyntheticTrialStore, evidence?: PrivateTrialRecipeEvidence) {
  const custody = new Map<string, { fork: PrivateTrialFork; evaluation?: PrivateTrialEvaluation }>();
  // Independent service-minted artifact identities; mutable custody records cannot reseal themselves.
  const authenticForkDigests = new Set<string>(), authenticEvaluationDigests = new Set<string>();
  const calls: GuardCall[] = [];
  const controls: {
    blocked?: { phase: PrivateTrialGuardContext['phase']; side: PrivateTrialGuardContext['side']; kind?: GuardCall['kind'] };
    consumerHook?: (view: StateStore, context: PrivateTrialGuardContext) => void;
    impact: PrivateTrialDependencyImpact;
    evidence?: PrivateTrialRecipeEvidence;
  } = { impact: { complete: true, affectedArtifactIds: ['synthetic-dependent-report'], rebuildArtifactIds: ['synthetic-dependent-report'], activeWorkIds: [] }, evidence };
  const host: PrivateTrialHost = {
    now: () => CLOCK,
    assertArtifactAuthentic: (_ctx, kind, digest) => {
      const authentic = kind === 'fork' ? authenticForkDigests : authenticEvaluationDigests;
      check(authentic.has(digest), 'SYNTHETIC_ARTIFACT_UNAUTHENTIC', 'Managed custody must authenticate the exact service-minted artifact identity.');
    },
    resolveRecipeEvidence: (_ctx, sourceId) => {
      check(controls.evidence?.sourceId === sourceId, 'SYNTHETIC_EVIDENCE_MISSING', 'Synthetic retained recipe evidence is unavailable.');
      return structuredClone(controls.evidence);
    },
    resolveTrial: (_ctx, id) => {
      const value = custody.get(id); check(value, 'SYNTHETIC_TRIAL_MISSING', 'Synthetic managed custody has no such trial.');
      return structuredClone(value);
    },
    calculatorGuards: (view, context) => {
      const guard = (kind: GuardCall['kind'], operation: string) => {
        calls.push({ ...context, kind, dictionaryHash: view.read().ontology.current.hash, operation });
        const blocked = controls.blocked;
        check(!(blocked && blocked.phase === context.phase && blocked.side === context.side && (!blocked.kind || blocked.kind === kind)),
          'SYNTHETIC_READINESS_REVOKED', 'The current synthetic view-specific readiness guard refuses this trial use.');
        if (kind === 'consumer') controls.consumerHook?.(view, context);
      };
      return { consumerGuard: (_ctx, request) => guard('consumer', request.operation), receiptGuard: (_ctx, receipt) => guard('receipt', receipt.operation) };
    },
    resolvePromotionImpact: () => structuredClone(controls.impact),
  };
  const retainFork = (fork: PrivateTrialFork) => {
    authenticForkDigests.add(fork.digest); custody.set(fork.id, { fork: structuredClone(fork) }); return fork;
  };
  const retainEvaluation = (evaluation: PrivateTrialEvaluation) => {
    const value = custody.get(evaluation.trialId); assert.ok(value);
    authenticEvaluationDigests.add(evaluation.digest); value.evaluation = structuredClone(evaluation); return evaluation;
  };
  // read-only live port deliberately has no update method.
  const live: Pick<StateStore, 'read'> = { read: store.read.bind(store) };
  return { host, live, custody, calls, controls, retainFork, retainEvaluation };
}

export function recipeFixture(): { store: SyntheticTrialStore; evidence: PrivateTrialRecipeEvidence; change: PrivateTrialChange } {
  const store = new SyntheticTrialStore();
  const recipe: MappingRecipe = {
    version: 1, id: 'synthetic-register-v1', system: 'synthetic-csv', edition: 'fixture-v1',
    scope: { company: 'Synthetic fixture only', branches: ['main'] },
    bindings: [
      { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' },
      { target: 'kind', constant: 'invoice', type: 'string', nulls: 'reject' },
      { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
      { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'minor', currency: 'INR', nulls: 'reject' },
      { target: 'currency', constant: 'INR', type: 'string', nulls: 'reject' },
      { target: 'status', source: 'status', type: 'string', nulls: 'reject', values: { OPEN: 'settled', CANCEL: 'settled' } },
    ], allowedKinds: ['invoice'], allowedStatuses: ['settled', 'cancelled'], onUnmapped: 'reject',
  };
  const input: ImportInput = {
    sourceId: 'synthetic-register', format: 'csv', content: 'id,date,amount,status\nI-1,2026-09-10,10000,OPEN\nI-2,2026-09-11,20000,CANCEL\n',
    recipe, expectedTotals: { rowCount: 2, amountMinor: '30000' }, installation: { company: 'Synthetic fixture only', edition: 'fixture-v1' },
  };
  const preview = new ImportService(store).preview(OWNER, input); assert.equal(preview.accepted, true);
  store.state.facts = preview.facts.map((fact, index) => ({ ...fact, id: `synthetic-mapped-${index + 1}`, validTo: fact.validTo ?? null, learnedAt: LEARNED, supersededAt: null }));
  const factIds = store.state.facts.map(fact => fact.id);
  store.state.imports = [{
    id: 'synthetic-retained-import-1', generation: 1, at: LEARNED, sourceId: input.sourceId,
    format: input.format, contentHash: hash(input.content), recipeHash: hash(recipe), rowIds: factIds,
    coverage: preview.coverage, totalsMinor: '30000', expectedTotals: input.expectedTotals, unmappedFields: [], qualification: 'experimental',
  }];
  const evidence: PrivateTrialRecipeEvidence = { sourceId: input.sourceId, recipe, captures: [{ importId: 'synthetic-retained-import-1', generation: 1, complete: true, input, factIds }] };
  const replacement = structuredClone(recipe); replacement.bindings.find(binding => binding.target === 'status')!.values!.CANCEL = 'cancelled';
  return { store, evidence, change: { type: 'recipe', sourceId: input.sourceId, recipeId: recipe.id, replacement } };
}
