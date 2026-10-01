import { authorize, audit, check, hash, newId, now, type Context, type Fact, type State, type StateStore } from './contracts.ts';
import { CalculatorService, type CalculationReceipt, type CalculatorOptions, type CalculationRequest } from './calculator.ts';
import { assertCompiledSingleSum } from './compiled-calculation.ts';
import { currentAccess, canSeeFact, selectFacts, type Period } from './memory.ts';
import { OntologyService, type Dictionary, type Definition } from './ontology.ts';
import { assertSourceAccess } from './trust.ts';
import { computeDescriptiveBridge, DESCRIPTIVE_BRIDGE_REVISION, type BridgeFactorRow, type DescriptiveBridgeResult } from './descriptive-bridge.ts';

export type BridgeProfileDefinition = {
  label: string; dictionaryHash: string; operationId: string; moneyDefinitionHash: string;
  quantityField: string; quantityMeaning: string; quantityScale: number;
  identityFields: string[]; identityMeaning: string; grain: 'one-fact-per-product-period';
  unitField: string; unit: string; unitMeaning: string;
  factorRule: 'realized-average-net-amount-per-unit'; method: 'separate-interaction';
  rounding: 'truncate-toward-zero-minor'; incompleteCoverage: 'partial' | 'refuse';
  scope: { branch: string | null; sourceIds: string[] };
};
export type BridgeProfileRecord = {
  id: string; kind: 'descriptive-bridge-profile-v1'; revision: number; ownerId: string; epoch: number;
  createdAt: string; definition: BridgeProfileDefinition; sourceIds: string[]; rowIds: string[]; contentHash: string;
};
export type BridgeFactorManifest = {
  receiptId: string; factId: string; sourceId: string; sourceRow: number; factHash: string;
  identity: string[]; quantity: string | null; unit: string | null; amountMinor: string;
  sourceAmountMinor: string; moneyField: string; sign: 1 | -1;
  validFrom: string; learnedAt: string; branch: string | null;
};
export type BridgeFactorAdmissionManifest = {
  profileId: string; profileRevision: number; profileHash: string; profile: BridgeProfileDefinition;
  receiptIds: string[]; receiptHashes: string[]; sourceIds: string[]; managedSourceIds: string[];
  rowIds: string[]; factors: BridgeFactorManifest[];
  population: { branch: string | null; customerId: string | null; orderId: string | null; asOf: string; baselinePeriod: Period; comparisonPeriod: Period };
};
export type BridgeFactorAdmission = { digest: string; qualification: 'synthetic-tested' | 'source-qualified' };
/** Trusted host port only. The host must prove the profile's factor/grain/unit semantics for every managed scope. */
export type BridgeServiceOptions = {
  calculator?: CalculatorOptions;
  factorAdmission?: (ctx: Context, manifest: Readonly<BridgeFactorAdmissionManifest>, view: StateStore) => BridgeFactorAdmission | void;
};
export type BridgeRunRequest = { profileId: string; profileRevision: number; baselineReceiptId: string; comparisonReceiptId: string };
export type BridgeRecord = {
  id: string; kind: 'descriptive-bridge-receipt-v1'; memberId: string; epoch: number; createdAt: string;
  profileId: string; profileRevision: number; profileHash: string; implementation: typeof DESCRIPTIVE_BRIDGE_REVISION;
  qualification: 'declared-experimental'; sourceQualification: 'source-unqualified' | 'synthetic-factor-admitted' | 'host-factor-admitted';
  interpretation: string; currency: string; manifest: BridgeFactorAdmissionManifest;
  factorAdmission: BridgeFactorAdmission | null; receipts: CalculationReceipt[]; result: DescriptiveBridgeResult;
  sourceIds: string[]; rowIds: string[]; stale: boolean; contentHash: string;
};
const PROFILE_KIND = 'descriptive-bridge-profile-v1', RECEIPT_KIND = 'descriptive-bridge-receipt-v1';
const SHA = /^[a-f0-9]{64}$/, FIELD = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const PROFILE_KEYS = ['label', 'dictionaryHash', 'operationId', 'moneyDefinitionHash', 'quantityField', 'quantityMeaning', 'quantityScale', 'identityFields', 'identityMeaning', 'grain', 'unitField', 'unit', 'unitMeaning', 'factorRule', 'method', 'rounding', 'incompleteCoverage', 'scope'];
function plain(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype; }
function exact(value: unknown, keys: string[], code: string) {
  check(plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), code, 'Supply only the complete declared bridge contract.');
}
function text(value: unknown, minimum = 1, maximum = 500): value is string { return typeof value === 'string' && value.trim().length >= minimum && value.length <= maximum; }
function view(state: State): StateStore { return { read: () => structuredClone(state), update: async () => { throw new Error('Bridge authorization views are read-only.'); } }; }
function contentHash(value: Record<string, unknown>): string {
  const { contentHash: _, stale: _stale, staleReason: _reason, ...body } = value; return hash(body);
}
function unique(values: string[]) { return [...new Set(values)].sort(); }
function profileDefinition(value: unknown, dictionary: Dictionary): asserts value is BridgeProfileDefinition {
  exact(value, PROFILE_KEYS, 'BRIDGE_PROFILE_INVALID'); const p = value as unknown as BridgeProfileDefinition;
  check(text(p.label, 1, 200) && SHA.test(p.dictionaryHash) && SHA.test(p.moneyDefinitionHash) && FIELD.test(p.operationId), 'BRIDGE_PROFILE_INVALID', 'Bind an explicit named profile to its exact published money definition.');
  check(p.factorRule === 'realized-average-net-amount-per-unit' && p.method === 'separate-interaction'
    && p.rounding === 'truncate-toward-zero-minor' && p.grain === 'one-fact-per-product-period'
    && ['partial', 'refuse'].includes(p.incompleteCoverage), 'BRIDGE_PROFILE_UNSUPPORTED', 'Select a supported explicit factor rule, grain, method, rounding and incomplete-coverage policy.');
  check(FIELD.test(p.quantityField) && dictionary.fields[p.quantityField] === 'integer'
    && FIELD.test(p.unitField) && dictionary.fields[p.unitField] === 'string'
    && Number.isSafeInteger(p.quantityScale) && p.quantityScale >= 0 && p.quantityScale <= 6
    && text(p.quantityMeaning, 10) && text(p.unitMeaning, 10) && text(p.unit, 1, 100), 'BRIDGE_FACTOR_BINDING_INVALID', 'Declare the quantity scale, unit and their business meaning using published fields.');
  check(Array.isArray(p.identityFields) && p.identityFields.length > 0 && p.identityFields.length <= 8
    && new Set(p.identityFields).size === p.identityFields.length && p.identityFields.every(field => FIELD.test(field) && dictionary.fields[field] === 'string')
    && text(p.identityMeaning, 10), 'BRIDGE_IDENTITY_BINDING_INVALID', 'Declare exact product-identity fields and the supported one-fact grain.');
  exact(p.scope, ['branch', 'sourceIds'], 'BRIDGE_PROFILE_INVALID');
  check((p.scope.branch === null || text(p.scope.branch, 1, 200)) && Array.isArray(p.scope.sourceIds)
    && p.scope.sourceIds.length > 0 && p.scope.sourceIds.length <= 128 && p.scope.sourceIds.every(id => text(id, 1, 200))
    && new Set(p.scope.sourceIds).size === p.scope.sourceIds.length, 'BRIDGE_SCOPE_INVALID', 'Declare one branch or the entire authorized branch scope and explicit source roots.');
}
function moneyDefinition(dictionary: Dictionary, profile: BridgeProfileDefinition): Definition {
  check(dictionary.hash === profile.dictionaryHash, 'BRIDGE_DICTIONARY_CHANGED', 'Republish the bridge profile against the current dictionary.');
  const operation = dictionary.operations.find(item => item.id === profile.operationId);
  check(operation?.type === 'sum' && operation.definitions.length === 1, 'BRIDGE_MEASURE_UNSUPPORTED', 'A bridge requires one published single-definition money sum.');
  const definition = dictionary.definitions.find(item => item.name === operation.definitions[0]);
  check(definition && hash(definition) === profile.moneyDefinitionHash, 'BRIDGE_DEFINITION_CHANGED', 'The declared money meaning differs from the profile.'); return definition;
}
function managedSources(state: State, roots: string[]) {
  return unique(state.imports.filter(item => ['connector-capture-v1', 'connector-consumer-binding-v1', 'engine-semantic-evidence-v1', 'engine-semantic-anchor-v1'].includes(item.type)
    && roots.includes(item.sourceId)).map(item => item.sourceId));
}

export class BridgeService {
  readonly store: StateStore; readonly options: BridgeServiceOptions;
  constructor(store: StateStore, options: BridgeServiceOptions = {}) { this.store = store; this.options = options; }
  private currentProfile(at: StateStore, ctx: Context, id: string): BridgeProfileRecord {
    const state = at.read(); authorize(at, ctx);
    const candidates = state.answers.filter(item => item.kind === PROFILE_KIND && item.id === id && item.ownerId === ctx.memberId && item.epoch === ctx.epoch);
    const record = candidates.sort((a, b) => b.revision - a.revision)[0] as BridgeProfileRecord | undefined;
    check(record, 'BRIDGE_PROFILE_UNAVAILABLE', 'This private bridge profile is unavailable.');
    check(record.contentHash === contentHash(record as unknown as Record<string, unknown>), 'BRIDGE_PROFILE_CHANGED', 'The retained profile changed after publication.');
    const dictionary = new OntologyService(at).current(ctx); check(dictionary, 'DICTIONARY_REQUIRED', 'Publish money definitions before a bridge profile.');
    profileDefinition(record.definition, dictionary); moneyDefinition(dictionary, record.definition);
    currentAccess(at, ctx, record.definition.scope.branch ?? undefined); assertSourceAccess(state, ctx, record.sourceIds);
    check(hash(record.sourceIds) === hash(record.definition.scope.sourceIds) && record.rowIds.length === 0, 'BRIDGE_PROFILE_CHANGED', 'The retained scope roots differ from the profile.'); return structuredClone(record);
  }
  async publish(ctx: Context, input: { id: string; expectedRevision: number; definition: BridgeProfileDefinition }): Promise<BridgeProfileRecord> {
    exact(input, ['id', 'expectedRevision', 'definition'], 'BRIDGE_PROFILE_INVALID');
    check(ctx.channel === 'desktop' && !ctx.sourceTainted, 'BRIDGE_APP_AUTHOR_REQUIRED', 'Publish explicit bridge meanings in an untainted desktop app request.');
    check(text(input.id, 1, 100) && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(input.id)
      && Number.isSafeInteger(input.expectedRevision) && input.expectedRevision >= 0, 'BRIDGE_PROFILE_INVALID', 'Choose an explicit profile ID and expected revision; new profiles expect zero.');
    const request = structuredClone({ ctx, input }); authorize(this.store, ctx, 'admin');
    return this.store.update(state => {
      const at = view(state), member = authorize(at, request.ctx, 'admin');
      const dictionary = new OntologyService(at).current(request.ctx); check(dictionary, 'DICTIONARY_REQUIRED', 'Publish money definitions first.');
      profileDefinition(request.input.definition, dictionary); moneyDefinition(dictionary, request.input.definition);
      const scope = request.input.definition.scope;
      check(scope.branch !== null || member.branches.includes('*'), 'BRIDGE_SCOPE_FORBIDDEN', 'An all-branch profile requires current all-branch authority.');
      currentAccess(at, request.ctx, scope.branch ?? undefined); assertSourceAccess(state, request.ctx, scope.sourceIds);
      const previous = state.answers.filter(item => item.kind === PROFILE_KIND && item.id === request.input.id && item.ownerId === request.ctx.memberId && item.epoch === request.ctx.epoch)
        .sort((a, b) => b.revision - a.revision)[0] as BridgeProfileRecord | undefined;
      check((previous?.revision ?? 0) === request.input.expectedRevision, 'BRIDGE_PROFILE_REVISION_CHANGED', 'The profile revision changed; review the current declaration.');
      if (previous) check(previous.contentHash === contentHash(previous as unknown as Record<string, unknown>), 'BRIDGE_PROFILE_CHANGED', 'The previous profile lost its publication integrity.');
      const record: BridgeProfileRecord = { id: request.input.id, kind: PROFILE_KIND, revision: request.input.expectedRevision + 1, ownerId: request.ctx.memberId, epoch: request.ctx.epoch,
        createdAt: now(), definition: structuredClone(request.input.definition), sourceIds: [...scope.sourceIds], rowIds: [], contentHash: '' };
      record.contentHash = contentHash(record as unknown as Record<string, unknown>); state.answers.push(record);
      audit(state, 'bridge.profile.published', { profileId: record.id, revision: record.revision, memberId: request.ctx.memberId }); return structuredClone(record);
    });
  }
  profiles(ctx: Context): BridgeProfileRecord[] {
    const at = view(this.store.read()); authorize(at, ctx);
    const ids = unique(at.read().answers.filter(item => item.kind === PROFILE_KIND && item.ownerId === ctx.memberId && item.epoch === ctx.epoch).map(item => item.id));
    return ids.flatMap(id => { try { return [this.currentProfile(at, ctx, id)]; } catch { return []; } });
  }
  private build(at: StateStore, ctx: Context, request: BridgeRunRequest) {
    const profile = this.currentProfile(at, ctx, request.profileId);
    check(profile.revision === request.profileRevision, 'BRIDGE_PROFILE_REVISION_CHANGED', 'Select the current published profile revision.');
    const dictionary = new OntologyService(at).current(ctx)!, definition = moneyDefinition(dictionary, profile.definition);
    const state = at.read(), calculator = new CalculatorService(at, this.options.calculator);
    const receipts = [request.baselineReceiptId, request.comparisonReceiptId].map(id => calculator.receipt(ctx, id));
    const requests = receipts.map(receipt => {
      check(!receipt.stale, 'BRIDGE_STALE_EVIDENCE', 'Recalculate stale money receipts before a bridge.');
      check(receipt.operation === profile.definition.operationId && receipt.dictionaryHash === dictionary.hash && receipt.ontologyVersion === dictionary.version
        && receipt.currency === definition.currency && receipt.definitions.length === 1 && hash(receipt.definitions[0]) === hash(definition)
        && receipt.definitionHash === hash([definition]) && receipt.compiledCalculation?.dictionaryHash === dictionary.hash,
      'BRIDGE_RECEIPT_MISMATCH', 'Both receipts must retain the profile\'s exact current single money definition and currency.');
      assertCompiledSingleSum(receipt.compiledCalculation!.sum, receipt.operation, definition, dictionary.version);
      check(receipt.period && !receipt.comparePeriod && receipt.branch === profile.definition.scope.branch, 'BRIDGE_POPULATION_MISMATCH', 'Use explicit money periods in the exact declared branch scope.');
      const matches = state.answers.filter(item => item.receiptId === receipt.id && plain(item.request));
      check(matches.length === 1, 'BRIDGE_REQUEST_MANIFEST_REQUIRED', 'Retain the original calculation request to establish its population selectors.');
      const original = matches[0].request as CalculationRequest;
      check(original.operation === receipt.operation && hash(original.period) === hash(receipt.period) && (original.branch ?? null) === receipt.branch
        && (!original.asOf || new Date(original.asOf).toISOString() === receipt.asOf), 'BRIDGE_RECEIPT_MISMATCH', 'The receipt and its original population manifest differ.');
      return { branch: receipt.branch, customerId: original.customerId ?? null, orderId: original.orderId ?? null, asOf: receipt.asOf };
    });
    check(hash(requests[0]) === hash(requests[1]), 'BRIDGE_POPULATION_MISMATCH', 'Baseline and comparison must share branch, customer/order selectors and the exact known-on cut.');
    const baselinePeriod = receipts[0].period!, comparisonPeriod = receipts[1].period!;
    check(baselinePeriod.to < comparisonPeriod.from || comparisonPeriod.to < baselinePeriod.from, 'BRIDGE_PERIOD_OVERLAP', 'Choose disjoint baseline and comparison periods.');
    const gaps = unique(receipts.flatMap(receipt => receipt.coverage.gaps));
    receipts.forEach(receipt => { if (receipt.coverage.completeness !== 'reconciled-imports') gaps.push(`Money receipt ${receipt.id} has ${receipt.coverage.completeness} coverage.`); });
    const factors: BridgeFactorManifest[] = [], allRows = unique(receipts.flatMap(receipt => [...receipt.rowIds, ...receipt.exclusions.map(item => item.rowId)]));
    const dependencies = allRows.map(id => { const fact = state.facts.find(item => item.id === id); check(fact && !fact.deletedAt && canSeeFact(at, ctx, fact), 'BRIDGE_FACT_UNAVAILABLE', 'Every counted and excluded dependency needs current access.'); return fact; });
    const populations: BridgeFactorRow[][] = receipts.map((receipt, index) => {
      check(receipt.rows.length === receipt.rowIds.length && new Set(receipt.rowIds).size === receipt.rowIds.length
        && new Set(receipt.rows.map(row => row.factId)).size === receipt.rowIds.length
        && receipt.rows.every(row => receipt.rowIds.includes(row.factId)), 'BRIDGE_RECEIPT_MISMATCH', 'Receipt rows and counted identities must correspond exactly.');
      const selection = selectFacts(at, ctx, { period: receipt.period!, asOf: receipt.asOf, branch: receipt.branch ?? undefined,
        customerId: requests[index].customerId ?? undefined, orderId: requests[index].orderId ?? undefined, kinds: [definition.kind] });
      const expected = selection.facts.filter(fact => !['cancelled', 'void', 'draft', 'bounced'].includes(String(fact.fields.status ?? '')) && fact.fields[definition.field] !== undefined && fact.fields[definition.field] !== null);
      check(hash(unique(expected.map(fact => fact.id))) === hash(unique(receipt.rowIds)), 'BRIDGE_FACTS_CHANGED', 'The original counted population no longer equals the current known-on selection.');
      let total = 0n;
      const rows = receipt.rows.map(row => {
        const fact = expected.find(item => item.id === row.factId)!;
        const amount = fact.fields[definition.field];
        check(typeof amount === 'string' && /^-?\d+$/.test(amount) && amount === row.amountMinor && row.measureField === definition.field
          && fact.fields.currency === definition.currency && fact.kind === row.kind && fact.entityId === row.entityId
          && fact.sourceId === row.sourceId && fact.sourceRow === row.sourceRow && fact.validFrom === row.validFrom,
        'BRIDGE_FACTS_CHANGED', 'The measured row lost its exact source and money binding.');
        check(profile.definition.scope.sourceIds.includes(fact.sourceId), 'BRIDGE_SCOPE_MISMATCH', 'Every counted row must belong to a declared source root.');
        const identity = profile.definition.identityFields.map(field => fact.fields[field]);
        check(identity.every(value => text(value, 1, 200)), 'BRIDGE_IDENTITY_REQUIRED', 'Missing exact product identity prevents a scope bridge; no product key is invented.');
        const quantityValue = fact.fields[profile.definition.quantityField];
        const quantity = typeof quantityValue === 'number' && Number.isSafeInteger(quantityValue) && quantityValue >= 0 ? String(quantityValue) : null;
        const unitValue = fact.fields[profile.definition.unitField], unit = unitValue === profile.definition.unit ? profile.definition.unit : null;
        const amountMinor = String(BigInt(amount) * BigInt(definition.sign ?? 1)); total += BigInt(amountMinor);
        factors.push({ receiptId: receipt.id, factId: fact.id, sourceId: fact.sourceId, sourceRow: fact.sourceRow, factHash: hash(fact), identity: identity as string[],
          quantity, unit, amountMinor, sourceAmountMinor: amount, moneyField: definition.field, sign: definition.sign ?? 1,
          validFrom: fact.validFrom, learnedAt: fact.learnedAt, branch: fact.branch ?? null });
        return { key: JSON.stringify(identity), amountMinor, quantity, unit };
      });
      check(total.toString() === receipt.totalMinor && receipt.totalMinor === receipt.valueMinor, 'BRIDGE_RECEIPT_MISMATCH', 'Measured total must reconcile to its exact counted rows.'); return rows;
    });
    const sourceIds = unique([...profile.sourceIds, ...dependencies.map(fact => fact.sourceId), ...receipts.flatMap(receipt => receipt.sourceIds)]);
    assertSourceAccess(state, ctx, sourceIds);
    const manifest: BridgeFactorAdmissionManifest = { profileId: profile.id, profileRevision: profile.revision, profileHash: profile.contentHash, profile: structuredClone(profile.definition),
      receiptIds: receipts.map(receipt => receipt.id), receiptHashes: receipts.map(receipt => hash(receipt)), sourceIds, managedSourceIds: managedSources(state, sourceIds), rowIds: allRows,
      factors, population: { ...requests[0], baselinePeriod: structuredClone(baselinePeriod), comparisonPeriod: structuredClone(comparisonPeriod) } };
    const admission = this.options.factorAdmission?.({ ...ctx }, structuredClone(manifest), at);
    if (manifest.managedSourceIds.length) check(admission && SHA.test(admission.digest) && ['synthetic-tested', 'source-qualified'].includes(admission.qualification),
      'BRIDGE_FACTOR_ADMISSION_REQUIRED', 'Managed sources require the trusted host to admit product grain, quantity and unit semantics for this exact profile and manifest.');
    const result = computeDescriptiveBridge({ baseline: populations[0], comparison: populations[1], quantityScale: profile.definition.quantityScale,
      factorRule: profile.definition.factorRule, method: profile.definition.method, rounding: profile.definition.rounding, incompleteCoverage: profile.definition.incompleteCoverage, coverageGaps: unique(gaps) });
    return { profile, receipts, manifest, admission: manifest.managedSourceIds.length ? structuredClone(admission!) : null, result };
  }
  async run(ctx: Context, input: BridgeRunRequest): Promise<BridgeRecord> {
    exact(input, ['profileId', 'profileRevision', 'baselineReceiptId', 'comparisonReceiptId'], 'BRIDGE_REQUEST_INVALID');
    check(text(input.profileId) && Number.isSafeInteger(input.profileRevision) && input.profileRevision > 0
      && text(input.baselineReceiptId) && text(input.comparisonReceiptId) && input.baselineReceiptId !== input.comparisonReceiptId, 'BRIDGE_REQUEST_INVALID', 'Choose an exact current profile revision and two private money receipts.');
    const request = structuredClone({ ctx, input }); authorize(this.store, ctx);
    const prepared = this.build(view(this.store.read()), request.ctx, request.input);
    return this.store.update(state => {
      const current = this.build(view(state), request.ctx, request.input);
      check(hash(current) === hash(prepared), 'BRIDGE_EVIDENCE_CHANGED', 'Bridge evidence or trusted factor admission changed before commit.');
      const record: BridgeRecord = { id: newId('bridge'), kind: RECEIPT_KIND, memberId: request.ctx.memberId, epoch: request.ctx.epoch, createdAt: now(),
        profileId: current.profile.id, profileRevision: current.profile.revision, profileHash: current.profile.contentHash, implementation: DESCRIPTIVE_BRIDGE_REVISION,
        qualification: 'declared-experimental', sourceQualification: !current.admission ? 'source-unqualified' : current.admission.qualification === 'synthetic-tested' ? 'synthetic-factor-admitted' : 'host-factor-admitted',
        interpretation: 'Descriptive contributions under the owner-published convention. They are not causal effects, intervention benefits or action recommendations.',
        currency: current.receipts[0].currency, manifest: current.manifest, factorAdmission: current.admission, receipts: current.receipts, result: current.result,
        sourceIds: current.manifest.sourceIds, rowIds: current.manifest.rowIds, stale: false, contentHash: '' };
      record.contentHash = contentHash(record as unknown as Record<string, unknown>); state.answers.push(record);
      audit(state, 'bridge.completed', { bridgeId: record.id, profileId: record.profileId, profileRevision: record.profileRevision, status: record.result.status, memberId: request.ctx.memberId }); return structuredClone(record);
    });
  }
  get(ctx: Context, input: { id: string }): BridgeRecord {
    exact(input, ['id'], 'BRIDGE_REQUEST_INVALID'); check(text(input.id), 'BRIDGE_REQUEST_INVALID', 'Choose a private saved bridge receipt.');
    const at = view(this.store.read()); authorize(at, ctx);
    const saved = at.read().answers.find(item => item.kind === RECEIPT_KIND && item.id === input.id && item.memberId === ctx.memberId && item.epoch === ctx.epoch) as BridgeRecord | undefined;
    check(saved, 'BRIDGE_UNAVAILABLE', 'This private bridge receipt is unavailable.');
    check(!saved.stale, 'BRIDGE_STALE_EVIDENCE', 'Recalculate a stale descriptive bridge.');
    check(saved.contentHash === contentHash(saved as unknown as Record<string, unknown>), 'BRIDGE_EVIDENCE_CHANGED', 'The saved bridge lost its manifest integrity.');
    const current = this.build(at, ctx, { profileId: saved.profileId, profileRevision: saved.profileRevision, baselineReceiptId: saved.receipts[0].id, comparisonReceiptId: saved.receipts[1].id });
    check(hash(current.manifest) === hash(saved.manifest) && hash(current.receipts) === hash(saved.receipts)
      && hash(current.admission) === hash(saved.factorAdmission) && hash(current.result) === hash(saved.result), 'BRIDGE_EVIDENCE_CHANGED', 'The current evidence or factor admission differs from the saved bridge.');
    return structuredClone(saved);
  }
}
