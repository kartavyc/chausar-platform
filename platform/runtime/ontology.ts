import { authorize, audit, check, hash, now, type Context, type StateStore } from './contracts.ts';
import { compileSingleSum, type CompiledSingleSum } from './compiled-calculation.ts';

export type FieldType = 'string' | 'money' | 'date' | 'integer' | 'boolean';
export type Definition = { name: string; label: string; meaning: string; kind: string; field: string; currency: string; nulls: 'exclude' | 'reject'; sign?: 1 | -1 };
export type DictionaryDraft = { pack: string; label: string; currency: string; gstMode: 'regular' | 'composition' | 'unregistered'; fields: Record<string, FieldType>; definitions: Definition[] };
export type Operation = { id: string; label: string; type: 'sum' | 'margin' | 'aging' | 'change' | 'scenario'; definitions: string[]; parameters: string[] };
export type Dictionary = DictionaryDraft & { version: number; publishedAt: string; publishedBy: string; hash: string; operations: Operation[]; compiledSums?: CompiledSingleSum[]; schema: Record<string, FieldType>; checks: { required: string[]; currency: string; nullRules: Record<string, string> } };

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
  check(draft && typeof draft === 'object', 'INVALID_DICTIONARY', 'A dictionary object is required.');
  check(Object.keys(draft).every(k => ['pack', 'label', 'currency', 'gstMode', 'fields', 'definitions'].includes(k)), 'INVALID_DICTIONARY', 'Unknown dictionary properties are not executable.');
  check(/^[A-Z]{3}$/.test(draft.currency), 'INVALID_CURRENCY', 'Use an ISO currency code.');
  check(['regular', 'composition', 'unregistered'].includes(draft.gstMode), 'INVALID_GST_MODE', 'Choose a GST registration mode.');
  check(Array.isArray(draft.definitions) && draft.definitions.length > 0, 'INVALID_DICTIONARY', 'Publish at least one explicit definition.');
  check(Object.entries(draft.fields).every(([name, type]) => /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(name) && ['string', 'money', 'date', 'integer', 'boolean'].includes(type)), 'INVALID_FIELD', 'Dictionary fields must have safe names and supported types.');
  const names = new Set<string>();
  for (const d of draft.definitions) {
    check(Object.keys(d).every(k => ['name', 'label', 'meaning', 'kind', 'field', 'currency', 'nulls', 'sign'].includes(k)), 'INVALID_DEFINITION', 'Definitions are data only.');
    check(/^[a-z][a-z0-9_]{0,63}$/.test(d.name) && !names.has(d.name), 'INVALID_DEFINITION', 'Measure names must be unique.');
    check(/^[a-z][a-z0-9_]{0,63}$/.test(d.kind), 'INVALID_DEFINITION', 'Record kind must be a data identifier.');
    check(typeof d.meaning === 'string' && d.meaning.trim().length > 10, 'INVALID_DEFINITION', 'Explain exactly what this measure counts.');
    check(draft.fields[d.field] === 'money' && d.currency === draft.currency, 'INVALID_DEFINITION', 'Measure bindings need an exact money field in the dictionary currency.');
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
  current(ctx: Context): Dictionary | null { authorize(this.store, ctx); const value = this.store.read().ontology; return structuredClone(value?.current ?? (value?.operations ? value : null)); }
  history(ctx: Context): Dictionary[] { authorize(this.store, ctx); return structuredClone(this.store.read().ontology?.history ?? []); }
  async publish(ctx: Context, input: DictionaryDraft | string): Promise<Dictionary> {
    authorize(this.store, ctx, 'admin');
    const draft = typeof input === 'string' ? starterPacks.find(p => p.pack === input) : input;
    check(draft, 'UNKNOWN_PACK', 'Choose one of the published starter packs.');
    return this.store.update(state => {
      authorize(this.store, ctx, 'admin');
      const current = state.ontology?.current ?? state.ontology;
      const compiled = compileDictionary(draft, (current?.version ?? 0) + 1, ctx.memberId);
      state.ontology = { current: compiled, history: [...(state.ontology?.history ?? []), compiled] };
      for (const answer of [...state.answers, ...state.receipts]) { answer.stale = true; answer.staleReason = 'The dictionary changed.'; }
      state.learning.push({ id: `dictionary_${compiled.hash}`, at: now(), category: 'dictionary', decision: 'published', version: compiled.version, definitionNames: compiled.definitions.map(d => d.name), shared: false });
      audit(state, 'dictionary.published', { version: compiled.version, hash: compiled.hash, pack: compiled.pack });
      return structuredClone(compiled);
    });
  }
}
