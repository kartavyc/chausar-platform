/**
 * Connector factory contracts. A recipe is data: field aliases, value maps and the source's own
 * total to check against. Decoders are registered engine code chosen by recipe id, never by the
 * source. Refusal reasons are fixed sentences; numbers travel as typed fields, never inside text.
 */
export type Depth = 'import' | 'read' | 'full';
export type Road = 'interface' | 'file' | 'screen' | 'database';
export type OperationStatus = 'tested' | 'experimental' | 'planned' | 'not-possible';

/** One source row in raw form: header name to exact cell text, with its line in the file. */
export type RawRow = { line: number; cells: Record<string, string> };
/** What a decoder hands to the recipe interpreter. Totals are the source's own, never computed here. */
export type DecodedTable = {
  headers: string[];
  rows: RawRow[];
  /** Rows after the table that carry the source's own totals (labelled "Total", "Grand Total" ...). */
  footers: RawRow[];
  /** A total the source declared in a structured place (a JSON summary, an API count, a 26AS total row). */
  declared: DeclaredTotals | null;
  /** Bank statements: the statement's own opening and closing balance, as exact source text. */
  balances?: { opening: string | null; closing: string | null } | null;
  /** Free-form source metadata the decoder could read (company, GSTIN, period). Data only. */
  meta: Record<string, string>;
};
export type DeclaredTotals = { rowCount: number | null; amount: string | null; amountUnit: 'major' | 'minor'; reference: string };

export type Measure =
  | { type: 'money'; amountMinor: string; currency: string }
  | { type: 'count'; quantity: string; unit: string };
export type CanonicalRecord = {
  entityId: string; kind: string; date: string; measure: Measure;
  /** Dictionary-shaped optional fields: customerId, customerName, invoiceId, orderId, dueDate, status, description, gstin, pan, taxMinor, sku ... */
  fields: Record<string, string>;
  sourceRow: number;
};
/** `source-declared-count`: the system stated its record count for exactly the filter read, and no amount; the amount was not checked. */
export type TotalsProvenance = 'in-file-total' | 'source-declared' | 'source-declared-count' | 'user-entered-report' | 'database-aggregate' | 'balance-continuity';
export type SourceTotals = { rowCount: number | null; total: string | null; reference: string; provenance: TotalsProvenance };
export type Check = { id: string; status: 'passed' | 'failed' | 'unavailable'; expected?: string | number | null; observed?: string | number | null; line?: number };
export type AbstentionReason = 'ambiguous_field' | 'unknown_value' | 'date_format' | 'currency' | 'sign_convention';
export type Abstention = { reason: AbstentionReason; field: string; question: string; options: string[] };
export type Refusal = { code: string; reason: string; line?: number };

export type RecipeOutcome = {
  status: 'accepted' | 'refused' | 'abstained';
  recipe: { id: string; version: string; group: string; operation: string; measure: 'money' | 'count'; digest: string };
  records: CanonicalRecord[];
  observed: { rowCount: number; total: string; unit: string };
  sourceTotals: SourceTotals | null;
  checks: Check[];
  unmappedFields: string[];
  excludedRows: number;
  refusal: Refusal | null;
  abstention: Abstention | null;
  period: { from: string; to: string } | null;
  contentHash: string;
  notices: string[];
  /** Bank statements: the opening balance (stated, or implied by the first row) and the stated closing balance, in minor units. */
  balances?: { opening: string | null; closing: string | null };
};
