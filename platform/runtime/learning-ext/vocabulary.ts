/**
 * The structure-only vocabulary of the learning loop.
 *
 * Every token that may ever leave this computer in a sharing batch is listed here. A shared
 * event is built only from these tokens, so a value, a name, an amount or free text cannot
 * enter it by construction. No token contains a digit, so the outbound scan can refuse any
 * digit outright. `hosted/learning-intake/src/vocabulary.ts` carries an identical copy for the
 * receiving service; a test keeps the two equal.
 */
export const LEARNING_SCHEMA = 'chausar.learning.v1';

export const DECISION_KINDS = ['mapping', 'identity', 'accounts-label', 'action', 'procedure', 'calculation', 'dictionary-edit'] as const;
export const CHOICES = ['proposed', 'accepted', 'rejected', 'corrected'] as const;
export const REASONS = [
  'manual-confirmation', 'ambiguous-field', 'type-match', 'date-format', 'currency-mismatch', 'duplicate-record', 'exact-reference',
  'reconciliation', 'unsupported-shape', 'verified-readback', 'low-confidence', 'evidence-keyword', 'evidence-group', 'owner-override',
  'answer-key-passed', 'answer-key-failed', 'grammar-refused', 'library-match', 'routed', 'fallback', 'stop-rule', 'budget-reached',
] as const;
export const FIELD_NAMES = [
  'invoice-id', 'customer-id', 'supplier-id', 'date', 'due-date', 'amount', 'tax', 'currency', 'account', 'account-class', 'parent-group',
  'debit', 'credit', 'balance', 'sku', 'quantity', 'unit', 'status', 'description', 'narration', 'order-id', 'payment-id', 'bank-reference',
  'branch', 'voucher-type', 'gstin', 'pan', 'hsn', 'tax-rate', 'payment-method', 'marketplace', 'fee', 'shipping', 'discount', 'channel',
  'kind', 'reference',
] as const;
export const FIELD_TYPES = ['string', 'integer', 'decimal', 'date', 'boolean'] as const;
export const REPORT_SHAPES = [
  'ledger', 'invoice', 'bank-statement', 'order', 'receipt', 'summary', 'settlement', 'gst-return', 'payroll', 'chart-of-accounts', 'trial-balance', 'stock',
] as const;
export const SYSTEMS = [
  'tally', 'zoho-books', 'busy', 'vyapar', 'marg', 'mybillbook', 'khatabook', 'okcredit', 'quickbooks', 'xero', 'shopify', 'woocommerce',
  'amazon', 'flipkart', 'meesho', 'razorpay', 'cashfree', 'payu', 'stripe', 'bharatpe', 'petpooja', 'bank', 'gst-portal', 'income-tax',
  'google-sheets', 'spreadsheet', 'canonical', 'other',
] as const;
/** The classes a chart-of-accounts line is sorted into (plan day 2, block 4). */
export const ACCOUNT_CLASSES = [
  'sales', 'purchases', 'direct-expenses', 'indirect-expenses', 'indirect-income', 'bank', 'cash', 'duties-taxes', 'loans', 'capital',
  'fixed-assets', 'current-assets', 'current-liabilities', 'sundry-debtors', 'sundry-creditors', 'stock', 'suspense',
] as const;
export const CONFIDENCE = ['high', 'medium', 'low'] as const;
export const ACTION_IMPACTS = ['reversible', 'message', 'money', 'destructive'] as const;
export const ACTION_OUTCOMES = ['done', 'refused', 'unknown', 'read-back-matched', 'read-back-mismatch'] as const;
export const PROCEDURE_STEPS = ['calculator', 'question', 'action', 'agent-lookup'] as const;
export const EDIT_KINDS = ['add-field', 'add-definition', 'remove-definition', 'change-meaning', 'change-nulls', 'change-label', 'change-sign', 'change-kind'] as const;
export const EVIDENCE_KINDS = ['name-keyword', 'parent-group', 'library', 'model', 'owner'] as const;

/** Sharing boxes. The last two exist behind a founder switch and stay closed until a lawyer has read the consent text. */
export const BOXES = ['setup-shapes', 'corrections', 'account-words', 'question-shapes'] as const;
export const OPEN_BOXES = ['setup-shapes', 'corrections'] as const;

export type DecisionKind = typeof DECISION_KINDS[number];
export type Choice = typeof CHOICES[number];
export type Reason = typeof REASONS[number];
export type FieldName = typeof FIELD_NAMES[number];
export type FieldType = typeof FIELD_TYPES[number];
export type ReportShape = typeof REPORT_SHAPES[number];
export type SystemFamily = typeof SYSTEMS[number];
export type AccountClass = typeof ACCOUNT_CLASSES[number];
export type Confidence = typeof CONFIDENCE[number];
export type Box = typeof BOXES[number];

/** One shared event. Every value is a vocabulary token; arrays are sorted and unique. */
export type StructuralEvent = {
  kind: DecisionKind; choice: Choice; reason?: Reason; system?: SystemFamily; shape?: ReportShape;
  fields?: [FieldName, FieldType][]; accountClass?: AccountClass; proposedClass?: AccountClass; confidence?: Confidence;
  evidence?: typeof EVIDENCE_KINDS[number][]; impact?: typeof ACTION_IMPACTS[number]; outcome?: typeof ACTION_OUTCOMES[number];
  steps?: typeof PROCEDURE_STEPS[number][]; edit?: typeof EDIT_KINDS[number];
};
export type StructuralBatch = { schema: typeof LEARNING_SCHEMA; boxes: Box[]; events: StructuralEvent[] };

export const EVENT_VOCABULARY = {
  kind: DECISION_KINDS, choice: CHOICES, reason: REASONS, system: SYSTEMS, shape: REPORT_SHAPES, accountClass: ACCOUNT_CLASSES,
  proposedClass: ACCOUNT_CLASSES, confidence: CONFIDENCE, impact: ACTION_IMPACTS, outcome: ACTION_OUTCOMES, edit: EDIT_KINDS,
} as const;
export const EVENT_LISTS = { evidence: EVIDENCE_KINDS, steps: PROCEDURE_STEPS } as const;
