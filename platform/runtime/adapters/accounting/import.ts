import { digest } from '../../actions.ts';
import { check } from '../../contracts.ts';
import type { MappingRecipe } from '../../ingest.ts';
import type { QualifiedDecoder, DecodedSourceRow, IndependentSourceTotals, ImportDomain, CaptureSnapshot } from '../../connector-framework/import.ts';
import { reconcileSourceTotals } from '../../connector-framework/import.ts';
import type { AccountingPage, AccountingRecord, AccountingKind } from './common.ts';
import { decimal, requiredText } from './common.ts';

export const ACCOUNTING_FIELDS = Object.freeze([
  'id', 'revision', 'company', 'dataset', 'sourceKind', 'sourceType', 'direction', 'eventType', 'date', 'currency', 'amount', 'status', 'sourceStatus', 'statusKey', 'branch', 'accounting',
]);
export type AccountingDecoderConfig = {
  id: string; version: string; identityNamespace: string; schemaSha256: string;
  company: string; dataset: string; branch: string; measure: 'total' | 'subtotal' | 'taxTotal' | 'balance';
  /** Explicit, reviewed precision per source currency. There is no default currency or precision. */
  minorDigitsByCurrency: Readonly<Record<string, number>>;
  /** Trusted, fixed source parser. Source bytes cannot select parser code or business expressions. */
  parse(content: string): AccountingPage;
};

/** Flatten a fully preserved adapter record for the existing reviewed importer. No kind/sign/status policy is accepted here. */
export function createAccountingDecoder(input: AccountingDecoderConfig): QualifiedDecoder {
  const config = { ...input, minorDigitsByCurrency: structuredClone(input.minorDigitsByCurrency) };
  for (const key of ['id', 'version', 'identityNamespace', 'company', 'dataset', 'branch'] as const) requiredText(config[key]);
  check(/^[a-f0-9]{64}$/.test(config.schemaSha256) && ['total', 'subtotal', 'taxTotal', 'balance'].includes(config.measure), 'ACCOUNTING_DECODER_INVALID', 'Pin the reviewed wire schema and exact source measure.');
  check(config.minorDigitsByCurrency && Object.entries(config.minorDigitsByCurrency).every(([code, precision]) => /^[A-Z]{3}$/.test(code) && Number.isInteger(precision) && precision >= 0 && precision <= 6),
    'ACCOUNTING_PRECISION_INVALID', 'Supply a reviewed currency precision profile.');
  const profileHash = digest({ company: config.company, dataset: config.dataset, branch: config.branch, measure: config.measure, minorDigitsByCurrency: config.minorDigitsByCurrency });
  return {
    id: config.id, version: `${config.version}.${profileHash.slice(0, 24)}`, schemaSha256: config.schemaSha256, identityNamespace: config.identityNamespace,
    identityFields: ['company', 'dataset', 'sourceKind', 'id', 'revision'], resourceIdentityFields: ['company', 'dataset', 'sourceKind', 'id'],
    // Vendor timestamps and content hashes are not a qualified monotonic correction order.
    revisionOrder: { kind: 'unqualified' }, businessFields: ACCOUNTING_FIELDS, deliveryFields: [],
    decode(content: string): DecodedSourceRow[] {
      const page = config.parse(content);
      check(!page.warnings.includes('SOURCE_VALIDATION_ERRORS'), 'ACCOUNTING_SOURCE_VALIDATION_ERRORS', 'Source envelope validation errors must be resolved before accounting publication.');
      return page.records.map(record => {
        check(!record.warnings.includes('SOURCE_VALIDATION_ERRORS'), 'ACCOUNTING_SOURCE_VALIDATION_ERRORS', 'Source validation errors must be resolved before accounting publication.');
        requiredText(record.id); const accounting = JSON.stringify(record);
        // A provider revision is retained. A missing revision becomes an exact content identity, never an ordered revision.
        const revision = record.revision ?? `content:${digest(record)}`;
        const major = decimal(record[config.measure]); let amount: string | null = null;
        if (major !== null && record.currency !== null) {
          check(Object.hasOwn(config.minorDigitsByCurrency, record.currency), 'ACCOUNTING_CURRENCY_PRECISION_REQUIRED', 'The source currency needs a reviewed precision profile.');
          amount = toMinorExact(major, config.minorDigitsByCurrency[record.currency]);
        }
        return { id: record.id, revision, company: config.company, dataset: config.dataset, sourceKind: record.kind,
          sourceType: record.sourceType, direction: record.direction, eventType: `${record.kind}:${record.sourceType ?? 'unknown'}:${record.direction}`,
          date: record.date, currency: record.currency, amount, status: record.status, sourceStatus: record.sourceStatus,
          statusKey: `${record.status}:${record.sourceStatus ?? 'missing'}`,
          branch: config.branch, accounting };
      });
    },
  };
}

export type AccountingMappingProposal = {
  origin: 'adapter-proposal'; requiresHumanAcceptance: true; semanticQualification: 'unqualified';
  recipe: MappingRecipe; notices: string[];
};
/** Proposal only: CursorImportService.reviewMapping must bind the owner, source report, domain, and exact decoder. */
export function proposeAccountingMapping(input: {
  id: string; system: string; edition: string; company: string; branch: string; currency: string;
  eventTypes: Readonly<Record<string, string>>;
  statuses: Readonly<Record<string, string>>;
}): AccountingMappingProposal {
  check(/^[A-Z]{3}$/.test(input.currency) && Object.keys(input.eventTypes).length > 0 && Object.keys(input.statuses).length > 0,
    'ACCOUNTING_MAPPING_INVALID', 'Propose explicit currency, kind and status decisions.');
  const kindMap = structuredClone(input.eventTypes), statusMap = structuredClone(input.statuses);
  const recipe: MappingRecipe = { version: 1, id: input.id, system: input.system, edition: input.edition,
    scope: { company: input.company, branches: [input.branch] }, bindings: [
      { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' },
      { target: 'kind', source: 'eventType', type: 'string', nulls: 'reject', values: kindMap },
      { target: 'validFrom', source: 'date', type: 'date', nulls: 'reject', dateFormat: 'ISO' },
      { target: 'amountMinor', source: 'amount', type: 'money', nulls: 'reject', moneyUnit: 'minor', currency: input.currency },
      { target: 'currency', source: 'currency', type: 'string', nulls: 'reject' },
      { target: 'status', source: 'statusKey', type: 'string', nulls: 'reject', values: statusMap },
      { target: 'branch', source: 'branch', type: 'string', nulls: 'reject' },
    ], allowedKinds: [...new Set(Object.values(kindMap))], allowedStatuses: [...new Set(Object.values(statusMap))],
    onUnmapped: 'reject', ignoredFields: ['revision', 'company', 'dataset', 'sourceKind', 'sourceType', 'direction', 'status', 'sourceStatus', 'accounting'] };
  return { origin: 'adapter-proposal', requiresHumanAcceptance: true, semanticQualification: 'unqualified', recipe,
    notices: ['Invoice value does not prove earned revenue or fulfillment.', 'Payment application does not prove bank settlement.',
      'A credit note is not automatically a cash refund; choose its accounting treatment explicitly.',
      'Tax, currency, voids, exclusions, correction ordering and missing values need independent source review.',
      'The decoder converts source amounts exactly using the reviewed currency precision profile; the importer receives integer minor units.',
      'The exact source measure and proposal remain unaccepted until the framework records authorized human review.'] };
}

/** Convert an exact source amount with explicitly supplied currency precision; rounding is refused. */
export function toMinorExact(value: string, minorDigits: number): string {
  check(decimal(value) !== null, 'ACCOUNTING_DECIMAL_INVALID', 'An observed amount is required.'); check(Number.isInteger(minorDigits) && minorDigits >= 0 && minorDigits <= 6, 'ACCOUNTING_PRECISION_INVALID', 'Specify supported currency precision.');
  const negative = value.startsWith('-'), unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ''] = unsigned.split('.');
  check(fraction.slice(minorDigits).split('').every(char => char === '0'), 'ACCOUNTING_MINOR_PRECISION', 'Source amount cannot be rounded into currency minor units.');
  const scaled = BigInt(whole + fraction.slice(0, minorDigits).padEnd(minorDigits, '0'));
  return String(negative ? -scaled : scaled);
}

/** Reconcile only a homogeneous captured dataset; this never converts currency or combines invoices/payments/credits. */
export function reconcileAccountingSourceTotals(input: {
  records: readonly AccountingRecord[]; kind: AccountingKind; currency: string; minorDigits: number;
  measure: AccountingDecoderConfig['measure']; domain: ImportDomain; snapshot: CaptureSnapshot; expected: IndependentSourceTotals | null;
}) {
  check(input.records.every(record => record.kind === input.kind), 'ACCOUNTING_TOTAL_KIND_MISMATCH', 'Reconcile each business event stream independently.');
  check(input.records.every(record => record.currency === input.currency), 'ACCOUNTING_TOTAL_CURRENCY_MISMATCH', 'Reconcile each currency independently.');
  // An empty supplied array does not establish a qualified complete-empty acquisition.
  const identities = new Map<string, string>(), resources = new Map<string, string>(); let sum = 0n, available = input.records.length > 0;
  for (const record of input.records) {
    const key = digest([record.kind, record.id, record.revision ?? null]); const businessHash = digest(record);
    check(!identities.has(key) || identities.get(key) === businessHash, 'ACCOUNTING_TOTAL_DUPLICATE_CONFLICT', 'A source identity has contradictory content.');
    if (identities.has(key)) continue;
    const resource = digest([record.kind, record.id]);
    check(!resources.has(resource), 'ACCOUNTING_TOTAL_REVISION_CONFLICT', 'Multiple observations of one mutable source resource need qualified correction review.');
    resources.set(resource, key);
    identities.set(key, businessHash);
    const amount = record[input.measure]; if (amount === null) available = false; else sum += BigInt(toMinorExact(amount, input.minorDigits));
  }
  return reconcileSourceTotals({ rowCount: identities.size, currency: input.currency, amountMinor: available ? String(sum) : null },
    input.expected, input.domain, input.snapshot);
}
