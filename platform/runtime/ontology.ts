import { authorize, audit, check, hash, now, type Context, type State, type StateStore } from './contracts.ts';
import { compileSingleSum, type CompiledSingleSum } from './compiled-calculation.ts';

export type FieldType = 'string' | 'money' | 'date' | 'integer' | 'boolean';
export type Definition = { name: string; label: string; meaning: string; kind: string; field: string; currency: string; nulls: 'exclude' | 'reject'; sign?: 1 | -1 };
export type DictionaryDraft = { pack: string; label: string; currency: string; gstMode: 'regular' | 'composition' | 'unregistered'; fields: Record<string, FieldType>; definitions: Definition[] };
export type Operation = { id: string; label: string; type: 'sum' | 'margin' | 'aging' | 'change' | 'scenario'; definitions: string[]; parameters: string[] };
export type Dictionary = DictionaryDraft & { version: number; publishedAt: string; publishedBy: string; hash: string; operations: Operation[]; compiledSums?: CompiledSingleSum[]; schema: Record<string, FieldType>; checks: { required: string[]; currency: string; nullRules: Record<string, string> } };
export type DictionaryPublishOptions = { expectedCurrentHash?: string | null; attemptId?: string };
export type OntologyPublishRequest = ({ draft: DictionaryDraft } | { pack: string }) & DictionaryPublishOptions;
export type OntologyGetRequest = { attemptId?: string };
/** Private publication evidence, atomically retained with its dictionary history.
 * Origin identity must never be rewritten into authority for a new workspace. */
export type DictionaryPublicationReceipt = {
  attemptId: string; workspaceId: string; memberId: string; epoch: number;
  draftDigest: string; expectedCurrentHash: string | null; dictionaryHash: string; version: number;
};
export type OntologySnapshot = { current: Dictionary | null; history: Dictionary[]; attempt?: DictionaryPublicationReceipt | null };

const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const attemptIdentity = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
const dictionaryDraftKeys = ['pack', 'label', 'currency', 'gstMode', 'fields', 'definitions'];
function dataRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value))
    && Reflect.ownKeys(value).every(key => typeof key === 'string')
    && Object.values(Object.getOwnPropertyDescriptors(value)).every(field => field.enumerable && 'value' in field);
}
function exactKeys(value: unknown, required: string[], optional: string[] = []): value is Record<string, unknown> {
  return dataRecord(value) && required.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => [...required, ...optional].includes(key));
}
/** Snapshot ordinary JSON data before queueing; getters, prototypes, cycles and
 * unsupported values cannot change the request's exact digest or its options. */
function snapshotDraft(value: unknown): DictionaryDraft {
  const ancestors = new Set<object>(); let nodes = 0;
  const visit = (item: unknown, depth: number): void => {
    check(depth <= 16 && ++nodes <= 100_000, 'INVALID_DICTIONARY', 'Dictionary data exceeds the supported structure bounds.');
    if (item === null || typeof item === 'string' || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)) return;
    check(item && typeof item === 'object' && !ancestors.has(item), 'INVALID_DICTIONARY', 'Dictionary input must be finite JSON data.');
    ancestors.add(item);
    if (Array.isArray(item)) {
      check(Object.getPrototypeOf(item) === Array.prototype
        && Reflect.ownKeys(item).length === item.length + 1
        && Object.getOwnPropertyDescriptors(item).length?.value === item.length,
      'INVALID_DICTIONARY', 'Dictionary arrays must contain ordinary dense data.');
      for (let index = 0; index < item.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
        check(descriptor?.enumerable && 'value' in descriptor, 'INVALID_DICTIONARY', 'Dictionary arrays must contain ordinary dense data.');
        visit(descriptor.value, depth + 1);
      }
    } else {
      check(dataRecord(item), 'INVALID_DICTIONARY', 'Dictionary objects must contain ordinary data fields.');
      for (const entry of Object.values(item)) visit(entry, depth + 1);
    }
    ancestors.delete(item);
  };
  visit(value, 0);
  check(Buffer.byteLength(JSON.stringify(value), 'utf8') <= 2 * 1024 * 1024, 'INVALID_DICTIONARY', 'Dictionary input exceeds the supported data size.');
  return structuredClone(value) as DictionaryDraft;
}
function publishOptions(value: unknown): DictionaryPublishOptions {
  check(exactKeys(value, [], ['expectedCurrentHash', 'attemptId']), 'INVALID_DICTIONARY_OPTIONS', 'Use only the declared publication options.');
  if (Object.hasOwn(value, 'expectedCurrentHash'))
    check(value.expectedCurrentHash === null || digest(value.expectedCurrentHash), 'INVALID_DICTIONARY_OPTIONS', 'Review an exact dictionary hash or explicitly require no current dictionary.');
  if (Object.hasOwn(value, 'attemptId')) {
    check(attemptIdentity(value.attemptId), 'INVALID_DICTIONARY_OPTIONS', 'Use an opaque publication attempt identity of at most 128 characters.');
    check(Object.hasOwn(value, 'expectedCurrentHash'), 'INVALID_DICTIONARY_OPTIONS', 'A retained attempt requires an explicit reviewed dictionary baseline.');
  }
  return structuredClone(value) as DictionaryPublishOptions;
}
function currentDictionary(state: State): Dictionary | null {
  const value = state.ontology;
  return value?.current ?? (value?.operations ? value : null);
}
function retainedAttempts(state: State): DictionaryPublicationReceipt[] {
  const value = state.ontology?.publicationAttempts;
  if (value === undefined) return [];
  check(Array.isArray(value), 'INVALID_DICTIONARY_RECEIPT', 'Retained publication evidence must be a collection.');
  const identities = new Set<string>();
  for (const receipt of value) {
    check(exactKeys(receipt, ['attemptId', 'workspaceId', 'memberId', 'epoch', 'draftDigest', 'expectedCurrentHash', 'dictionaryHash', 'version'])
      && attemptIdentity(receipt.attemptId) && !identities.has(receipt.attemptId)
      && receipt.workspaceId === state.workspace.id && typeof receipt.memberId === 'string' && receipt.memberId.length > 0
      && Number.isSafeInteger(receipt.epoch) && (receipt.epoch as number) > 0
      && digest(receipt.draftDigest) && (receipt.expectedCurrentHash === null || digest(receipt.expectedCurrentHash))
      && digest(receipt.dictionaryHash) && Number.isSafeInteger(receipt.version) && (receipt.version as number) > 0,
    'INVALID_DICTIONARY_RECEIPT', 'Retained publication evidence must preserve its declared origin and exact input.');
    identities.add(receipt.attemptId);
    check(Array.isArray(state.ontology?.history), 'INVALID_DICTIONARY_RECEIPT', 'Retained publication evidence requires dictionary history.');
    const matches = state.ontology.history.filter((entry: Dictionary) => entry?.hash === receipt.dictionaryHash && entry?.version === receipt.version);
    const dictionary = matches[0] as Dictionary | undefined;
    check(matches.length === 1 && dictionary && dictionary.publishedBy === receipt.memberId
      && hash(Object.fromEntries(Object.entries(dictionary).filter(([key]) => key !== 'hash'))) === receipt.dictionaryHash,
    'INVALID_DICTIONARY_RECEIPT', 'Retained publication evidence requires its exact unambiguous dictionary history.');
    const draft = Object.fromEntries(Object.entries(dictionary).filter(([key]) => dictionaryDraftKeys.includes(key)));
    check(hash(draft) === receipt.draftDigest,
      'INVALID_DICTIONARY_RECEIPT', 'Retained publication evidence must match its published draft.');
  }
  return value as DictionaryPublicationReceipt[];
}
function assertAttemptActor(receipt: DictionaryPublicationReceipt, state: State, ctx: Context) {
  check(receipt.workspaceId === state.workspace.id && receipt.memberId === ctx.memberId && receipt.epoch === ctx.epoch,
    'DICTIONARY_ATTEMPT_AUTHORITY', 'This publication attempt belongs to a different workspace actor or access epoch.');
}
/** The StateStore port has no read-only transaction result. Abort a duplicate
 * update internally so Vault does not write a revision just to replay evidence. */
class RetainedPublication extends Error {
  dictionary: Dictionary;
  constructor(dictionary: Dictionary) { super('Retained dictionary publication'); this.dictionary = structuredClone(dictionary); }
}

const fields: Record<string, FieldType> = {
  amountMinor: 'money', taxMinor: 'money', customerId: 'string', customerName: 'string', invoiceId: 'string', orderId: 'string', dueDate: 'date', status: 'string', quantity: 'integer', unit: 'string', currency: 'string', company: 'string', gstin: 'string', pan: 'string', description: 'string', costType: 'string', accountClass: 'string', bankReference: 'string',
};
const definition = (name: string, label: string, kind: string, meaning: string): Definition => ({ name, label, kind, meaning, field: 'amountMinor', currency: 'INR', nulls: 'reject' });
const base: Definition[] = [
  definition('billed', 'Billed', 'invoice', 'Invoice value excluding tax, by invoice date. A correction replaces the earlier claim; credit notes are separate refunds.'),
  definition('received', 'Received', 'payment', 'Settled cash receipts excluding bounced or cancelled payments, by settlement date.'),
  definition('earned', 'Earned', 'sale', 'Delivered goods or completed work excluding tax, by delivery date. Invoices and cash receipts do not imply delivery.'),
  definition('refunds', 'Refunds', 'refund', 'Positive value of credit notes or returns, by credit note date, deducted once from earned sales.'),
  definition('costs', 'Costs', 'cost', 'Order or period costs excluding recoverable tax; includes goods, shipping, platform fees and advertising only where explicitly imported.'),
  definition('purchases', 'Purchases', 'purchase', 'Purchase register value excluding tax, by invoice date.'),
];
const packLabels = { ecommerce: 'Online brand', retail: 'Neighbourhood retail', services: 'Professional services', distributor: 'Trader and distributor', manufacturing: 'Small manufacturer', saas: 'Software subscription' };
const domainFields: Record<string, Record<string, FieldType>> = {
  ecommerce: { sku: 'string', marketplace: 'string', shippingMinor: 'money', feeMinor: 'money', marketingMinor: 'money' },
  retail: { sku: 'string', outletId: 'string', paymentMethod: 'string', stockQuantity: 'integer' },
  services: { projectId: 'string', milestoneId: 'string', deliveredHours: 'integer', contractId: 'string' },
  distributor: { distributorId: 'string', territory: 'string', creditDays: 'integer', sku: 'string' },
  manufacturing: { batchId: 'string', rawMaterialSku: 'string', finishedSku: 'string', wasteQuantity: 'integer' },
  saas: { subscriptionId: 'string', seatCount: 'integer', recognitionStart: 'date', recognitionEnd: 'date' },
};
const earnedMeanings: Record<string, string> = {
  ecommerce: 'Goods delivered to the buyer excluding tax, by delivery date; fulfilled order events must be imported explicitly. Platform fees and shipping are separately classified cost events.',
  retail: 'Goods transferred to the retail customer excluding tax, by sale date. Stock movements and bank receipts do not imply a sale.',
  services: 'Work delivered under an accepted milestone excluding tax, by completion date. An advance or invoice does not imply completed work.',
  distributor: 'Goods delivered to the distributor excluding tax, by delivery date. Credit terms and collections are separate from revenue recognition.',
  manufacturing: 'Finished goods delivered excluding tax, by delivery date. Production, inventory and material purchases are separate events.',
  saas: 'Subscription service delivered during the period; import explicit recognition events, never assume invoices are earned.',
};
export const starterPacks: DictionaryDraft[] = Object.entries(packLabels).map(([pack, label]) => ({ pack, label, currency: 'INR', gstMode: 'regular', fields: { ...fields, ...domainFields[pack] }, definitions: base.map(d => ({ ...d, meaning: d.name === 'earned' ? earnedMeanings[pack] : d.meaning })) }));

export function compileDictionary(draft: DictionaryDraft, version = 1, publishedBy = 'owner', publishedAt = now()): Dictionary {
  check(exactKeys(draft, dictionaryDraftKeys), 'INVALID_DICTIONARY', 'Use the declared dictionary data fields.');
  check(typeof draft.pack === 'string' && draft.pack.trim().length > 0
    && typeof draft.label === 'string' && draft.label.trim().length > 0,
  'INVALID_DICTIONARY', 'Give the dictionary a pack identity and label.');
  check(typeof draft.currency === 'string' && /^[A-Z]{3}$/.test(draft.currency), 'INVALID_CURRENCY', 'Use an ISO currency code.');
  check(['regular', 'composition', 'unregistered'].includes(draft.gstMode), 'INVALID_GST_MODE', 'Choose a GST registration mode.');
  check(Array.isArray(draft.definitions) && draft.definitions.length > 0, 'INVALID_DICTIONARY', 'Publish at least one explicit definition.');
  check(dataRecord(draft.fields) && Object.entries(draft.fields).every(([name, type]) => /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(name) && typeof type === 'string' && ['string', 'money', 'date', 'integer', 'boolean'].includes(type)), 'INVALID_FIELD', 'Dictionary fields must have safe names and supported types.');
  const names = new Set<string>();
  for (const d of draft.definitions) {
    check(exactKeys(d, ['name', 'label', 'meaning', 'kind', 'field', 'currency', 'nulls'], ['sign']), 'INVALID_DEFINITION', 'Definitions are data only.');
    check(typeof d.name === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(d.name) && !names.has(d.name), 'INVALID_DEFINITION', 'Measure names must be unique.');
    check(typeof d.label === 'string' && d.label.trim().length > 0, 'INVALID_DEFINITION', 'Give each measure a label.');
    check(typeof d.kind === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(d.kind), 'INVALID_DEFINITION', 'Record kind must be a data identifier.');
    check(typeof d.meaning === 'string' && d.meaning.trim().length > 10, 'INVALID_DEFINITION', 'Explain exactly what this measure counts.');
    check(typeof d.field === 'string' && Object.hasOwn(draft.fields, d.field) && draft.fields[d.field] === 'money' && d.currency === draft.currency, 'INVALID_DEFINITION', 'Measure bindings need an exact money field in the dictionary currency.');
    check(['reject', 'exclude'].includes(d.nulls) && (d.sign === undefined || d.sign === 1 || d.sign === -1), 'INVALID_DEFINITION', 'Define null handling and a valid sign.');
    names.add(d.name);
  }
  const sumOperations: Operation[] = draft.definitions.map(d => ({ id: d.name, label: d.label, type: 'sum', definitions: [d.name], parameters: ['period', 'asOf', 'branch', 'customerId', 'orderId'] }));
  if (names.has('earned')) sumOperations.push({ id: 'revenue', label: 'Revenue (earned)', type: 'sum', definitions: ['earned'], parameters: ['period', 'asOf', 'branch', 'customerId', 'orderId'] });
  if (names.has('earned') && names.has('refunds')) sumOperations.push({ id: 'net_sales', label: 'Net sales', type: 'sum', definitions: ['earned', 'refunds'], parameters: ['period', 'asOf', 'branch', 'customerId', 'orderId'] });
  if (names.has('earned') && names.has('costs') && names.has('refunds')) sumOperations.push({ id: 'margin', label: 'Order contribution margin', type: 'margin', definitions: ['earned', 'refunds', 'costs'], parameters: ['period', 'asOf', 'branch', 'customerId', 'orderId'] });
  if (names.has('billed') && names.has('received') && names.has('refunds')) sumOperations.push({ id: 'aging', label: 'Receivable aging', type: 'aging', definitions: ['billed', 'received', 'refunds'], parameters: ['period', 'asOf', 'branch', 'customerId', 'onDate'] });
  if (names.has('earned')) {
    sumOperations.push({ id: 'change', label: 'Revenue change', type: 'change', definitions: ['earned'], parameters: ['period', 'asOf', 'branch', 'customerId', 'comparePeriod'] });
    sumOperations.push({ id: 'scenario', label: 'Price scenario', type: 'scenario', definitions: ['earned'], parameters: ['period', 'asOf', 'branch', 'customerId', 'assumptions'] });
  }
  check(new Set(sumOperations.map(o => o.id)).size === sumOperations.length, 'RESERVED_MEASURE', 'A measure uses a generated calculation name.');
  const compiledSums = sumOperations.filter(o => o.type === 'sum' && o.definitions.length === 1)
    .map(o => compileSingleSum(o, draft.definitions.find(d => d.name === o.definitions[0])!, version));
  const content = { ...structuredClone(draft), version, publishedAt, publishedBy, operations: sumOperations, compiledSums, schema: { ...draft.fields }, checks: { required: ['entityId', 'validFrom', 'currency'], currency: draft.currency, nullRules: Object.fromEntries(draft.definitions.map(d => [d.name, d.nulls])) } };
  return { ...content, hash: hash(content) };
}

export class OntologyService {
  store: StateStore;
  constructor(store: StateStore) { this.store = store; }
  packs() { return structuredClone(starterPacks); }
  current(ctx: Context): Dictionary | null { authorize(this.store, ctx); return structuredClone(currentDictionary(this.store.read())); }
  history(ctx: Context): Dictionary[] { authorize(this.store, ctx); return structuredClone(this.store.read().ontology?.history ?? []); }
  get(ctx: Context, request: OntologyGetRequest = {}): OntologySnapshot {
    check(exactKeys(request, [], ['attemptId']), 'INVALID_DICTIONARY_OPTIONS', 'Use only the optional exact publication attempt lookup.');
    const lookup = Object.hasOwn(request, 'attemptId');
    if (lookup) check(attemptIdentity(request.attemptId), 'INVALID_DICTIONARY_OPTIONS', 'Use an opaque publication attempt identity.');
    authorize(this.store, ctx, lookup ? 'admin' : 'read');
    const state = this.store.read();
    const result: OntologySnapshot = { current: structuredClone(currentDictionary(state)), history: structuredClone(state.ontology?.history ?? []) };
    if (lookup) {
      const receipt = retainedAttempts(state).find(item => item.attemptId === request.attemptId);
      if (receipt) assertAttemptActor(receipt, state, ctx);
      // Absence is unknown, including while an accepted update is still queued.
      result.attempt = structuredClone(receipt ?? null);
    }
    return result;
  }
  async publishPayload(ctx: Context, payload: OntologyPublishRequest | DictionaryDraft): Promise<Dictionary> {
    check(dataRecord(payload), 'INVALID_DICTIONARY_OPTIONS', 'Use ordinary dictionary publication data.');
    if (Object.hasOwn(payload, 'draft') || Object.hasOwn(payload, 'expectedCurrentHash') || Object.hasOwn(payload, 'attemptId')
      || Object.hasOwn(payload, 'pack') && !Object.hasOwn(payload, 'definitions')) {
      const draftInput = Object.hasOwn(payload, 'draft');
      check(exactKeys(payload, [draftInput ? 'draft' : 'pack'], ['expectedCurrentHash', 'attemptId']),
        'INVALID_DICTIONARY_OPTIONS', 'Choose exactly one draft or starter pack and the declared publication options.');
      const options = Object.fromEntries(Object.entries(payload).filter(([key]) => key === 'expectedCurrentHash' || key === 'attemptId'));
      const input = draftInput ? payload.draft : payload.pack;
      check(draftInput || typeof input === 'string', 'INVALID_DICTIONARY_OPTIONS', 'Choose a named starter pack.');
      return this.publish(ctx, input as DictionaryDraft | string, options);
    }
    return this.publish(ctx, payload as DictionaryDraft);
  }
  async publish(ctx: Context, input: DictionaryDraft | string, options: DictionaryPublishOptions = {}): Promise<Dictionary> {
    authorize(this.store, ctx, 'admin');
    const actor = structuredClone(ctx), workspaceId = this.store.read().workspace.id;
    const retainedOptions = publishOptions(options);
    const selected = typeof input === 'string' ? starterPacks.find(p => p.pack === input) : input;
    check(selected, 'UNKNOWN_PACK', 'Choose one of the published starter packs.');
    const draft = snapshotDraft(selected), draftDigest = hash(draft);
    try { return await this.store.update(state => {
      authorize(this.store, actor, 'admin');
      check(state.workspace.id === workspaceId, 'ACCESS_REVOKED', 'Your workspace access has changed. Sign in again.');
      const attempts = retainedAttempts(state);
      if (retainedOptions.attemptId) {
        const receipt = attempts.find(item => item.attemptId === retainedOptions.attemptId);
        if (receipt) {
          assertAttemptActor(receipt, state, actor);
          check(receipt.draftDigest === draftDigest && receipt.expectedCurrentHash === retainedOptions.expectedCurrentHash,
            'DICTIONARY_ATTEMPT_REUSED', 'A publication attempt cannot change its exact draft or reviewed baseline.');
          throw new RetainedPublication(state.ontology.history.find((entry: Dictionary) => entry.hash === receipt.dictionaryHash && entry.version === receipt.version));
        }
      }
      const current = currentDictionary(state);
      if (Object.hasOwn(state.ontology ?? {}, 'firstRunReviewRequired')) {
        check(state.ontology.firstRunReviewRequired === true && current === null && state.ontology.history?.length === 0,
          'INVALID_DICTIONARY_OPTIONS', 'First-run review mode must retain an empty unpublished dictionary.');
        check(retainedOptions.expectedCurrentHash === null && retainedOptions.attemptId,
          'DICTIONARY_REVIEW_REQUIRED', 'First-run publication requires an exact empty baseline and retained reviewed attempt.');
      }
      if (Object.hasOwn(retainedOptions, 'expectedCurrentHash'))
        check((current?.hash ?? null) === retainedOptions.expectedCurrentHash, 'DICTIONARY_CONFLICT', 'The reviewed dictionary changed. Read and review its current revision before publishing.');
      const compiled = compileDictionary(draft, (current?.version ?? 0) + 1, actor.memberId);
      if (retainedOptions.attemptId) attempts.push({
        attemptId: retainedOptions.attemptId, workspaceId, memberId: actor.memberId, epoch: actor.epoch,
        draftDigest, expectedCurrentHash: retainedOptions.expectedCurrentHash!, dictionaryHash: compiled.hash, version: compiled.version,
      });
      state.ontology = { current: compiled, history: [...(state.ontology?.history ?? []), compiled],
        ...(attempts.length ? { publicationAttempts: attempts } : {}) };
      for (const answer of [...state.answers, ...state.receipts]) { answer.stale = true; answer.staleReason = 'The dictionary changed.'; }
      state.learning.push({ id: `dictionary_${compiled.hash}`, at: now(), category: 'dictionary', decision: 'published', version: compiled.version, definitionNames: compiled.definitions.map(d => d.name), shared: false });
      audit(state, 'dictionary.published', { version: compiled.version, hash: compiled.hash, pack: compiled.pack });
      return structuredClone(compiled);
    }); } catch (error) {
      if (error instanceof RetainedPublication) return error.dictionary;
      throw error;
    }
  }
}
