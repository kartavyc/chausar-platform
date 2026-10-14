/**
 * Synthetic data for the fake engine: one invented demo shop, invented customers and
 * invented figures. Nothing here describes a real business. Money is whole paise as digit
 * strings and every display string is written here as the engine would supply it.
 *
 * Only `bridge/fake.ts`, previews and tests import this folder.
 */
import type { Language } from '../../app/presentation.ts';

/* ------------------------------------------------------------------ identities */

export const DEMO_TIME_ZONE = 'Asia/Kolkata';
export const DEMO_CLOCK = '2026-09-30';
export const DEMO_WORKSPACE = Object.freeze({ id: 'workspace_demo_shop', name: 'Demo shop', demo: true });
export const DEMO_OWNER = Object.freeze({ id: 'member_demo_owner', name: 'Asha Demo', role: 'owner' as const });
export const DEMO_VIEWER = Object.freeze({ id: 'member_demo_viewer', name: 'Ravi Demo', role: 'viewer' as const });
export const DEMO_SOURCES = Object.freeze(['source_tally_demo', 'source_bank_demo']);
export const DEMO_ROUTE = Object.freeze({ id: 'route_local_demo', kind: 'ollama', model: 'demo-local-model', enabled: true, installationVerified: false, label: 'Local demo model' });

/** Invented customers. Any likeness to a real firm is accidental. */
export const DEMO_CUSTOMERS = Object.freeze(['Kiran Retail Demo', 'Meera Textiles Demo', 'Arjun Stores Demo', 'Sunrise Kirana Demo', 'Lotus Traders Demo']);

/** A deterministic 64-hex identity from a seed (FNV-1a lanes). An id for fixtures, not a security hash. */
export function fakeHash(seed: string): string {
  let out = '';
  for (let lane = 0; lane < 8; lane++) {
    let h = 0x811c9dc5 ^ lane;
    for (const char of `${lane}:${seed}`) { h ^= char.codePointAt(0) ?? 0; h = Math.imul(h, 0x01000193) >>> 0; }
    out += h.toString(16).padStart(8, '0');
  }
  return out;
}

/** SHA-256 hex over UTF-8 text with WebCrypto (browser and Node). */
export async function sha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) throw Object.assign(new Error('DIGEST_UNAVAILABLE'), { code: 'DIGEST_UNAVAILABLE' });
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/* ------------------------------------------------------------------ dictionary */

type FieldType = 'string' | 'money' | 'date' | 'integer' | 'boolean';
const fields: Record<string, FieldType> = {
  amountMinor: 'money', taxMinor: 'money', customerId: 'string', customerName: 'string', invoiceId: 'string', orderId: 'string', dueDate: 'date', status: 'string', quantity: 'integer', unit: 'string', currency: 'string', company: 'string', gstin: 'string', pan: 'string', description: 'string', costType: 'string', accountClass: 'string', bankReference: 'string',
};
const definition = (name: string, label: string, kind: string, meaning: string) => ({ name, label, meaning, kind, field: 'amountMinor', currency: 'INR', nulls: 'reject' as const });
const base = [
  definition('billed', 'Billed', 'invoice', 'Invoice value excluding tax, by invoice date. A correction replaces the earlier claim; credit notes are separate refunds.'),
  definition('received', 'Received', 'payment', 'Settled cash receipts excluding bounced or cancelled payments, by settlement date.'),
  definition('earned', 'Earned', 'sale', 'Delivered goods or completed work excluding tax, by delivery date. Invoices and cash receipts do not imply delivery.'),
  definition('refunds', 'Refunds', 'refund', 'Positive value of credit notes or returns, by credit note date, deducted once from earned sales.'),
  definition('costs', 'Costs', 'cost', 'Order or period costs excluding recoverable tax; includes goods, shipping, platform fees and advertising only where explicitly imported.'),
  definition('purchases', 'Purchases', 'purchase', 'Purchase register value excluding tax, by invoice date.'),
];
const packLabels: Record<string, string> = { ecommerce: 'Online brand', retail: 'Neighbourhood retail', services: 'Professional services', distributor: 'Trader and distributor', manufacturing: 'Small manufacturer', saas: 'Software subscription' };
const domainFields: Record<string, Record<string, FieldType>> = {
  ecommerce: { sku: 'string', marketplace: 'string', shippingMinor: 'money', feeMinor: 'money', marketingMinor: 'money' },
  retail: { sku: 'string', outletId: 'string', paymentMethod: 'string', stockQuantity: 'integer' },
  services: { projectId: 'string', milestoneId: 'string', deliveredHours: 'integer', contractId: 'string' },
  distributor: { distributorId: 'string', territory: 'string', creditDays: 'integer', sku: 'string' },
  manufacturing: { batchId: 'string', rawMaterialSku: 'string', finishedSku: 'string', wasteQuantity: 'integer' },
  saas: { subscriptionId: 'string', seatCount: 'integer', recognitionStart: 'date', recognitionEnd: 'date' },
};
const earnedMeanings: Record<string, string> = {
  ecommerce: 'Goods delivered to the buyer excluding tax, by delivery date; fulfilled order events must be imported explicitly.',
  retail: 'Goods transferred to the retail customer excluding tax, by sale date. Stock movements and bank receipts do not imply a sale.',
  services: 'Work delivered under an accepted milestone excluding tax, by completion date. An advance or invoice does not imply completed work.',
  distributor: 'Goods delivered to the distributor excluding tax, by delivery date. Credit terms and collections are separate from revenue recognition.',
  manufacturing: 'Finished goods delivered excluding tax, by delivery date. Production, inventory and material purchases are separate events.',
  saas: 'Subscription service delivered during the period; import explicit recognition events, never assume invoices are earned.',
};

/** The six starter drafts, in the engine's order, with the engine's shape. */
export function starterPacks(): Record<string, unknown>[] {
  return Object.entries(packLabels).map(([pack, label]) => ({
    pack, label, currency: 'INR', gstMode: 'regular', fields: { ...fields, ...domainFields[pack] },
    definitions: base.map(item => ({ ...item, meaning: item.name === 'earned' ? earnedMeanings[pack] ?? item.meaning : item.meaning })),
  }));
}

/** The engine's compiled shape without compiled sums (optional on the wire), hashed the engine's way. */
export async function compileDictionary(draft: Record<string, unknown>, version: number, publishedBy: string, publishedAt: string): Promise<Record<string, unknown>> {
  const definitions = Array.isArray(draft['definitions']) ? draft['definitions'] as { name: string; label: string; nulls: string }[] : [];
  const names = new Set(definitions.map(item => item.name));
  const parameters = ['period', 'asOf', 'branch', 'customerId', 'orderId'];
  const operations: Record<string, unknown>[] = definitions.map(item => ({ id: item.name, label: item.label, type: 'sum', definitions: [item.name], parameters }));
  if (names.has('earned')) operations.push({ id: 'revenue', label: 'Revenue (earned)', type: 'sum', definitions: ['earned'], parameters });
  if (names.has('earned') && names.has('refunds')) operations.push({ id: 'net_sales', label: 'Net sales', type: 'sum', definitions: ['earned', 'refunds'], parameters });
  if (names.has('earned') && names.has('costs') && names.has('refunds')) operations.push({ id: 'margin', label: 'Order contribution margin', type: 'margin', definitions: ['earned', 'refunds', 'costs'], parameters });
  const content = {
    ...structuredClone(draft), version, publishedAt, publishedBy, operations,
    schema: { ...(draft['fields'] as Record<string, string>) },
    checks: { required: ['entityId', 'validFrom', 'currency'], currency: draft['currency'], nullRules: Object.fromEntries(definitions.map(item => [item.name, item.nulls])) },
  };
  return { ...content, hash: await sha256Hex(JSON.stringify(content)) };
}

/* ------------------------------------------------------------------ figures */

export interface Amount { readonly minor: string; readonly display: string }
export interface Bucket { readonly id: string; readonly label: { readonly en: string; readonly hi: string }; readonly from: string; readonly to: string; readonly value: Amount | null }
export interface TileFixture {
  readonly id: string;
  readonly label: { readonly en: string; readonly hi: string };
  readonly operation: 'billed' | 'received' | 'costs';
  readonly from: string;
  readonly to: string;
  /** The engine's total over the tile period: the known buckets only. */
  readonly total: Amount;
  readonly form: 'columns' | 'line' | 'ordered-bar';
  readonly sentence: { readonly en: string; readonly hi: string };
  readonly buckets: readonly Bucket[];
}
const month = (id: string, en: string, hi: string, from: string, to: string, value: Amount | null): Bucket => ({ id, label: { en, hi }, from, to, value });

/** Three configured tiles. Totals are written out; each was checked against its buckets. */
export const TILES: readonly TileFixture[] = Object.freeze([
  {
    id: 'tile_billed', label: { en: 'Billed', hi: 'बिल किया' }, operation: 'billed', from: '2026-04-01', to: '2026-09-30',
    total: { minor: '253685000', display: '₹25,36,850' }, form: 'columns',
    sentence: { en: 'Billed each month, April to September.', hi: 'हर महीने का बिल, अप्रैल से सितंबर।' },
    buckets: [
      month('billed_2026_04', 'Apr', 'अप्रै', '2026-04-01', '2026-04-30', { minor: '39840000', display: '₹3,98,400' }),
      month('billed_2026_05', 'May', 'मई', '2026-05-01', '2026-05-31', { minor: '41275000', display: '₹4,12,750' }),
      month('billed_2026_06', 'Jun', 'जून', '2026-06-01', '2026-06-30', { minor: '37620000', display: '₹3,76,200' }),
      month('billed_2026_07', 'Jul', 'जुला', '2026-07-01', '2026-07-31', { minor: '43590000', display: '₹4,35,900' }),
      month('billed_2026_08', 'Aug', 'अग', '2026-08-01', '2026-08-31', { minor: '46130000', display: '₹4,61,300' }),
      month('billed_2026_09', 'Sep', 'सितं', '2026-09-01', '2026-09-30', { minor: '45230000', display: '₹4,52,300' }),
    ],
  },
  {
    id: 'tile_received', label: { en: 'Received', hi: 'मिला' }, operation: 'received', from: '2026-04-01', to: '2026-09-30',
    total: { minor: '201800000', display: '₹20,18,000' }, form: 'line',
    sentence: { en: 'Received each month. June is not loaded yet.', hi: 'हर महीने मिली रकम। जून अभी लोड नहीं हुआ।' },
    buckets: [
      month('received_2026_04', 'Apr', 'अप्रै', '2026-04-01', '2026-04-30', { minor: '37100000', display: '₹3,71,000' }),
      month('received_2026_05', 'May', 'मई', '2026-05-01', '2026-05-31', { minor: '39525000', display: '₹3,95,250' }),
      month('received_2026_06', 'Jun', 'जून', '2026-06-01', '2026-06-30', null),
      month('received_2026_07', 'Jul', 'जुला', '2026-07-01', '2026-07-31', { minor: '40210000', display: '₹4,02,100' }),
      month('received_2026_08', 'Aug', 'अग', '2026-08-01', '2026-08-31', { minor: '43895000', display: '₹4,38,950' }),
      month('received_2026_09', 'Sep', 'सितं', '2026-09-01', '2026-09-30', { minor: '41070000', display: '₹4,10,700' }),
    ],
  },
  {
    id: 'tile_costs', label: { en: 'Costs in September', hi: 'सितंबर की लागत' }, operation: 'costs', from: '2026-09-01', to: '2026-09-30',
    total: { minor: '18653000', display: '₹1,86,530' }, form: 'ordered-bar',
    sentence: { en: 'Costs in three parts of September.', hi: 'सितंबर के तीन हिस्सों की लागत।' },
    buckets: [
      month('costs_2026_09_a', '1-10 Sep', '1-10 सितं', '2026-09-01', '2026-09-10', { minor: '6124000', display: '₹61,240' }),
      month('costs_2026_09_b', '11-20 Sep', '11-20 सितं', '2026-09-11', '2026-09-20', { minor: '5891000', display: '₹58,910' }),
      month('costs_2026_09_c', '21-30 Sep', '21-30 सितं', '2026-09-21', '2026-09-30', { minor: '6638000', display: '₹66,380' }),
    ],
  },
]);

export const receiptIdFor = (bucketOrTile: string) => `rcpt_${bucketOrTile}`;

/** Every receipt the fake can serve: id → its subject. */
export function receiptSubjects(): Map<string, { operation: string; label: string; amount: Amount; from: string; to: string }> {
  const out = new Map<string, { operation: string; label: string; amount: Amount; from: string; to: string }>();
  for (const tile of TILES) {
    out.set(receiptIdFor(tile.id), { operation: tile.operation, label: tile.label.en, amount: tile.total, from: tile.from, to: tile.to });
    for (const bucket of tile.buckets) if (bucket.value) out.set(receiptIdFor(bucket.id), { operation: tile.operation, label: `${tile.label.en} ${bucket.label.en}`, amount: bucket.value, from: bucket.from, to: bucket.to });
  }
  return out;
}

/** A receipt in the engine's full shape. Its rows add up to its figure; the fake does that split, not a screen. */
export function receiptFor(id: string, dictionaryHash: string, memberId: string, asOf: string): Record<string, unknown> | null {
  const subject = receiptSubjects().get(id);
  if (subject === undefined) return null;
  const total = BigInt(subject.amount.minor);
  const first = total * 5n / 10n, second = total * 3n / 10n, third = total - first - second;
  const customers = DEMO_CUSTOMERS.slice(0, 3);
  const rows = [first, second, third].map((amount, index) => ({
    factId: `${id}_fact_${index + 1}`, entityId: `inv_demo_${subject.operation}_${index + 1}`, sourceId: DEMO_SOURCES[0]!, sourceRow: index + 2,
    kind: subject.operation === 'received' ? 'payment' : subject.operation === 'costs' ? 'cost' : 'invoice', amountMinor: amount.toString(), validFrom: subject.from,
    customerId: customers[index] ?? 'Demo customer',
  }));
  const definitionRow = base.find(item => item.name === subject.operation) ?? base[0]!;
  return {
    id, memberId, epoch: 1, sourceIds: [DEMO_SOURCES[0]!], operation: subject.operation,
    createdAt: asOf, asOf, period: { from: subject.from, to: subject.to }, comparePeriod: null, branch: null,
    currency: 'INR', ontologyVersion: 1, dictionaryHash, definitionHash: fakeHash(`definition:${subject.operation}`),
    figures: [{ key: 'total', label: subject.label, minor: subject.amount.minor, display: subject.amount.display, unit: 'money', currency: 'INR' }],
    valueMinor: subject.amount.minor, totalMinor: subject.amount.minor, rowIds: rows.map(row => row.factId), rows,
    exclusions: [{ rowId: `${id}_cancelled`, reason: 'Cancelled invoice, excluded by the meaning.' }],
    coverage: { selectedRows: rows.length + 1, countedRows: rows.length, excludedRows: 1, unresolvedConflicts: 0, importIds: ['import_tally_demo'], completeness: 'reconciled-imports', gaps: [] },
    assumptions: {}, explanation: `Synthetic demo receipt for ${subject.label}.`, stale: false,
    allowedNumbers: [subject.amount.minor, ...rows.map(row => row.amountMinor)],
    definitions: [definitionRow],
  };
}

/* ------------------------------------------------------------------ review, attention, events */

export interface ActionFixture { readonly id: string; readonly connector: string; readonly operation: string; readonly title: string; readonly impact: 'reversible' | 'message' | 'money' | 'destructive'; readonly customer: string }
export const ACTIONS: readonly ActionFixture[] = Object.freeze([
  { id: 'act_demo_reminder_kiran', connector: 'whatsapp', operation: 'send-reminder', title: 'Send a payment reminder to Kiran Retail Demo', impact: 'message', customer: 'Kiran Retail Demo' },
  { id: 'act_demo_invoice_meera', connector: 'tally', operation: 'create-invoice', title: 'Record an invoice for Meera Textiles Demo', impact: 'reversible', customer: 'Meera Textiles Demo' },
  { id: 'act_demo_refund_arjun', connector: 'bank', operation: 'refund', title: 'Refund Arjun Stores Demo for a return', impact: 'money', customer: 'Arjun Stores Demo' },
  { id: 'act_demo_stock_sunrise', connector: 'tally', operation: 'stock-adjustment', title: 'Adjust stock after the Sunrise Kirana Demo return', impact: 'reversible', customer: 'Sunrise Kirana Demo' },
  { id: 'act_demo_price_lotus', connector: 'shopify', operation: 'update-price', title: 'Change the price list Lotus Traders Demo sees', impact: 'destructive', customer: 'Lotus Traders Demo' },
]);
export const actionDigest = (id: string) => fakeHash(`action:${id}`);

export function actionRecord(action: ActionFixture, date: string): Record<string, unknown> {
  return {
    id: action.id, connector: action.connector, operation: action.operation, payload: { customer: action.customer },
    sourceIds: [DEMO_SOURCES[0]!], idempotencyKey: `idem_${action.id}`, digest: actionDigest(action.id), revision: 1,
    createdBy: DEMO_OWNER.id, createdEpoch: 1, createdAt: `${date}T04:10:00.000Z`, impact: action.impact, status: 'prepared', attempts: [],
  };
}
export function reviewRow(action: ActionFixture, date: string): Record<string, unknown> {
  const digest = actionDigest(action.id);
  return {
    kind: 'action-approval', title: action.title, since: `${date}T04:10:00.000Z`,
    reference: { kind: 'action-approval', id: action.id, revision: 1, digest },
    request: { method: 'actions.approve', payload: { id: action.id, digest } },
    canApprove: true, provenance: [{ producer: 'actions', id: action.id, revision: 1, digest }],
  };
}

export const DECISION_ID = 'dec_demo_credit_kiran';
export function dueDecision(date: string): Record<string, unknown> {
  return { reference: { kind: 'decision', decisionId: DECISION_ID }, text: 'Review the credit limit for Kiran Retail Demo', reviewDate: date, due: 'today', status: 'open', branch: null, revision: 1, receiptIds: [receiptIdFor('tile_received')] };
}
export function alertEpisode(date: string): Record<string, unknown> {
  const opened = `${date}T02:30:00.000Z`;
  const episode = { id: 'episode_demo_meera_late', status: 'open', severity: 'warning', openedAt: opened, reopenCount: 0, uncertain: false, observationIds: ['obs_demo_meera_1'] };
  return {
    reference: { kind: 'alert-episode', alertId: 'alert_demo_late_payments', episodeId: episode.id }, conditionId: 'late-payment-30-days',
    label: 'Payments from Meera Textiles Demo are late', revision: 1, definitionDigest: fakeHash('alert:late-payments'), branch: null,
    sourceIds: [DEMO_SOURCES[1]!], receiptIds: [receiptIdFor('received_2026_09')], episode,
    lastObservation: { id: 'obs_demo_meera_1', anchorId: 'anchor_demo_meera', observedAt: opened, recordedAt: opened, state: 'breach', issues: [], receiptId: receiptIdFor('received_2026_09') },
    amendments: [], notices: [], evidence: { state: 'current', issues: [] },
  };
}
export function decisionRecord(): Record<string, unknown> {
  return { id: DECISION_ID, text: 'Review the credit limit for Kiran Retail Demo', status: 'open', reviews: [], receiptIds: [receiptIdFor('tile_received')] };
}
export const IMPORT = Object.freeze({ id: 'import_tally_demo', sourceId: DEMO_SOURCES[0]! });
export function importRecord(date: string): Record<string, unknown> {
  return { id: IMPORT.id, sourceId: IMPORT.sourceId, format: 'tally-xml', contentHash: fakeHash('import:content'), recipeHash: fakeHash('import:recipe'), rowIds: [], importedAt: `${date}T03:45:00.000Z` };
}
export function dayEvents(date: string): Record<string, unknown>[] {
  const actor = { kind: 'member', memberId: DEMO_OWNER.id };
  return [
    { id: 'evt_demo_import', at: `${date}T03:45:00.000Z`, actor, kind: 'source.imported', args: { sourceId: IMPORT.sourceId, format: 'tally-xml', rowCount: 1284, qualification: 'experimental' }, reference: { kind: 'import', importId: IMPORT.id, sourceId: IMPORT.sourceId } },
    { id: 'evt_demo_calc', at: `${date}T04:00:00.000Z`, actor, kind: 'calculation.completed', args: { operation: 'billed', stale: false }, reference: { kind: 'receipt', receiptId: receiptIdFor('billed_2026_09') } },
    { id: 'evt_demo_action', at: `${date}T04:10:00.000Z`, actor: { kind: 'not-recorded' }, kind: 'action.prepared', args: { connector: 'whatsapp', operation: 'send-reminder', outcome: 'prepared' }, reference: { kind: 'action', actionId: ACTIONS[0]!.id } },
    { id: 'evt_demo_decision', at: `${date}T05:20:00.000Z`, actor, kind: 'decision.created', args: { revision: 1 }, reference: { kind: 'decision', decisionId: DECISION_ID } },
  ];
}

export const label = (value: { readonly en: string; readonly hi: string }, language: Language) => value[language];
