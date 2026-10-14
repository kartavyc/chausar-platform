import { check } from '../../contracts.ts';
import { cellsOf, gridFromRows, locateTable, norm, parseDelimited, type Grid, type GridLine } from '../tabular.ts';
import { parseInteger, parseMoney } from '../values.ts';
import { headerGroups } from '../decoders.ts';
import type { Decoder, FieldSpec, SourceRecipe } from '../recipe.ts';
import type { DecodedTable, RawRow } from '../types.ts';

/**
 * Bank statements from any bank: CSV, worksheet rows and PDF text rows (see ../bank-pdf.ts).
 * The transaction table is found by heading groups; the statement's own opening and closing
 * balance are read from its preamble and trailer, and continuity is the source total.
 * Narration is data. Labels in the statement are matched against fixed lists, never interpreted.
 */
export const GROUP = 'bank-statements';
const TXN_DATE = ['Date', 'Txn Date', 'Transaction Date', 'Tran Date', 'Trans Date', 'Txn. Date', 'Post Date', 'Posting Date'] as const;
const VALUE_DATE = ['Value Date', 'Value Dt', 'Value Dt.'] as const;
const NARRATION = ['Narration', 'Description', 'Particulars', 'Remarks', 'Transaction Remarks', 'Transaction Details', 'Details'] as const;
const REFERENCE = ['Chq./Ref.No.', 'Chq./Ref. No.', 'Chq / Ref No.', 'Chq/Ref No', 'Ref No./Cheque No.', 'Cheque Number', 'Cheque No.', 'Chq No', 'Chq. No.', 'Reference No.', 'Ref No', 'UTR', 'UTR Number'] as const;
const WITHDRAWAL = ['Withdrawal Amt.', 'Withdrawal Amount (INR)', 'Withdrawal Amount', 'Withdrawals', 'Withdrawal', 'Debit', 'Debit Amount', 'Dr Amount', 'Dr'] as const;
const DEPOSIT = ['Deposit Amt.', 'Deposit Amount (INR)', 'Deposit Amount', 'Deposits', 'Deposit', 'Credit', 'Credit Amount', 'Cr Amount', 'Cr'] as const;
const BALANCE = ['Closing Balance', 'Balance', 'Balance (INR)', 'Running Balance', 'Bal', 'Balance Amount'] as const;
const AMOUNT = ['Amount', 'Amount (INR)', 'Transaction Amount', 'Txn Amount', 'Amt'] as const;
const DRCR = ['Dr/Cr', 'Dr / Cr', 'Cr/Dr', 'Dr./Cr.', 'Debit/Credit', 'Type', 'Txn Type', 'Transaction Type'] as const;
/** A synthetic column the decoder adds: reference plus amount cells, so identity is date + reference + amount + balance. */
export const ENTRY_KEY = 'Chausar Entry Key';
const BALANCE_SIGN = 'Balance Dr/Cr';
/** The exact header row pdfTextToRows emits; the PDF decoder reads nothing else. */
export const PDF_HEADER: readonly string[] = ['Date', 'Value Date', 'Narration', 'Amount', 'Dr/Cr', 'Balance', 'Page', 'Line'];
const DEBIT_WORDS = ['Dr', 'Dr.', 'D', 'Debit', 'Withdrawal', 'DR'] as const;
const CREDIT_WORDS = ['Cr', 'Cr.', 'C', 'Credit', 'Deposit', 'CR'] as const;

export type SummaryKey = 'opening' | 'closing' | 'drCount' | 'crCount' | 'debits' | 'credits' | 'total' | 'marker';
const LABELS: Record<string, SummaryKey> = Object.fromEntries(([
  ['opening', ['opening balance', 'opening bal', 'opening balance (inr)', 'balance opening']],
  ['closing', ['closing balance', 'closing bal', 'closing balance (inr)', 'balance closing']],
  ['drCount', ['dr count', 'debit count', 'no. of debits', 'no of debits', 'count of debits', 'withdrawal count']],
  ['crCount', ['cr count', 'credit count', 'no. of credits', 'no of credits', 'count of credits', 'deposit count']],
  ['debits', ['debits', 'total debits', 'total debit', 'total withdrawals', 'total withdrawal', 'debit total', 'withdrawals total']],
  ['credits', ['credits', 'total credits', 'total credit', 'total deposits', 'total deposit', 'credit total', 'deposits total']],
  ['total', ['transaction total', 'transaction totals', 'total']],
  ['marker', ['statement summary', 'account summary']],
] as const).flatMap(([key, words]) => words.map(word => [word, key])));
/** The fixed label a cell carries, if any. Only whole-cell matches count; other text stays data. */
export function labelOf(cell: string): SummaryKey | null {
  if ((cell ?? '').length > 200) return null;
  const text = norm(cell ?? '').replace(/[ :.\-–]+$/u, '');
  return Object.hasOwn(LABELS, text) ? LABELS[text] : null;
}
const MONEY_TEXT = /^(?:-\s*)?(?:₹|Rs\.?|INR)?\s*[\d,]+\.\d{1,2}(?:\s*\(?(?:Cr|Dr)\.?\)?)?$/i;
const FIGURE = /^(?:-\s*)?(?:₹|Rs\.?|INR)?\s*[\d,]+(?:\.\d{1,2})?(?:\s*\(?(?:Cr|Dr)\.?\)?)?$/i;
/**
 * A label and its figure in one cell ("Closing Balance : 9350.00"). Whitespace is collapsed and the
 * cell capped before matching, so the match stays linear in the cell length (no backtracking blow-up).
 */
const TRAILING_FIGURE = /((?:- ?)?(?:₹|Rs\.?|INR)? ?[\d,]+\.\d{1,2}(?: ?\(?(?:Cr|Dr)\.?\)?)?)$/i;
const IN_CELL = { exec(cell: string): [string, string, string] | null {
  const text = (cell ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (text.length === 0 || text.length > 200) return null;
  const m = TRAILING_FIGURE.exec(text); if (!m) return null;
  return [text, text.slice(0, m.index).replace(/[ :\-]+$/, ''), m[1]];
} };
/** "1,234.00 Cr" is a credit (positive) balance and "1,234.00 Dr" an overdrawn one. */
export function normalizeBalance(text: string, sign = ''): string {
  let value = (text ?? '').normalize('NFKC').trim(); let word = sign.trim();
  const m = /^(.*?)\s*\(?\s*(Cr|Dr)\.?\s*\)?$/i.exec(value);
  if (m && m[1]) { value = m[1].trim(); word = word || m[2]; }
  if (/^dr\.?$/i.test(word) && value && !value.startsWith('-')) value = `-${value}`;
  return value;
}
export type StatementSummary = { opening: string | null; closing: string | null; drCount: string | null; crCount: string | null; debits: string | null; credits: string | null; marker: boolean };
type TotalColumns = { debit: number; credit: number } | null;

/**
 * Read the statement's own balances and Dr/Cr summary from lines outside the transaction table.
 * Pair form ("Opening Balance", "50,000.00"), in-cell form ("Opening Balance : 50,000.00") and
 * summary-block form (a row of labels, the next row of values) are read. Conflicts are refused.
 */
export function readSummary(lines: readonly GridLine[], columns: TotalColumns = null): StatementSummary {
  const out: StatementSummary = { opening: null, closing: null, drCount: null, crCount: null, debits: null, credits: null, marker: false };
  const set = (key: SummaryKey, raw: string, sign = '') => {
    if (key === 'marker' || key === 'total') return;
    const text = (raw ?? '').trim(); if (!text || /^[-–—]$/.test(text)) return;
    let value: string;
    if (key === 'drCount' || key === 'crCount') {
      try { value = parseInteger(text)!; } catch { return check(false, 'BANK_SUMMARY_UNREADABLE', 'The statement summary holds a count that is not a whole number.'); }
    } else {
      const normalized = normalizeBalance(text, sign);
      try { check(parseMoney(normalized, 'major', 'INR') !== null, 'INVALID_MONEY', 'missing'); value = normalized; }
      catch { return check(false, 'BANK_SUMMARY_UNREADABLE', 'The statement summary holds an amount that is not exact money.'); }
    }
    const prior = out[key];
    if (prior !== null) {
      const same = key === 'drCount' || key === 'crCount' ? prior === value : parseMoney(prior, 'major', 'INR') === parseMoney(value, 'major', 'INR');
      check(same, 'BANK_BALANCE_CONFLICT', 'The statement states two different values for one balance or summary figure.');
    }
    out[key] = value;
  };
  for (let i = 0; i < lines.length; i++) {
    const cells = lines[i].cells; const found = cells.map((cell, at) => ({ at, key: labelOf(cell) })).filter(item => item.key !== null) as { at: number; key: SummaryKey }[];
    if (found.some(item => item.key === 'marker')) out.marker = true;
    const figures = found.filter(item => item.key !== 'marker' && item.key !== 'total');
    const next = lines[i + 1]?.cells ?? [];
    if (figures.length >= 2) { for (const item of figures) set(item.key, next[item.at] ?? ''); i++; continue; }
    for (const item of found) {
      if (item.key === 'marker') continue;
      if (item.key === 'total') { if (columns) { set('debits', cells[columns.debit] ?? ''); set('credits', cells[columns.credit] ?? ''); } continue; }
      const rest = cells.slice(item.at + 1); const at = rest.findIndex(cell => cell.trim() !== '');
      if (at >= 0) { const after = rest[at + 1]?.trim() ?? ''; set(item.key, rest[at], /^(?:cr|dr)\.?$/i.test(after) ? after : ''); }
      else if (found.length === 1 && FIGURE.test((next[item.at] ?? '').trim())) { set(item.key, next[item.at]); i++; }
    }
    if (!found.length) for (const cell of cells) {
      const m = IN_CELL.exec(cell.trim()); const key = m ? labelOf(m[1]) : null;
      if (m && key) set(key, m[2]);
    }
  }
  return out;
}

/** A whole-cell label, or a label with its figure in the same cell ("Closing Balance : 9350.00"). */
const cellLabel = (cell: string): SummaryKey | null => { const key = labelOf(cell); if (key) return key; const m = IN_CELL.exec((cell ?? '').trim()); return m ? labelOf(m[1]) : null; };
const fieldOf = (recipe: SourceRecipe, name: string): FieldSpec | undefined => Object.hasOwn(recipe.fields, name) ? recipe.fields[name] : undefined;
const cleanHeading = (cell: string) => (cell ?? '').normalize('NFKC').replace(/[\s ]+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim();
const DATE_LIKE = /^\d{1,2}[\s/.-](?:\d{1,2}|[A-Za-z]{3,9})[\s/.,-]+(?:\d{4}|\d{2})\b/;
const SEPARATOR = /^[\s*=_\-–—.]*$/;
type Layout = 'deposit-withdrawal' | 'amount-drcr';

/** Find, split and check one statement grid. Engine code: the recipe names the columns. */
export function bankTable(grid: Grid, recipe: SourceRecipe, meta: Record<string, string> = {}): DecodedTable {
  check(grid.length > 0, 'EMPTY_FILE', 'The file has no rows.');
  const layout: Layout = recipe.measure.type === 'money' && 'credit' in recipe.measure.amount ? 'deposit-withdrawal' : 'amount-drcr';
  const wanted = headerGroups(recipe).map(group => group.map(norm));
  const h = grid.findIndex(row => { const cells = new Set(row.cells.map(cell => norm(cleanHeading(cell)))); return wanted.every(group => group.some(alias => cells.has(alias))); });
  check(h >= 0 && h < 200, 'HEADER_NOT_FOUND', 'The column headings of a bank statement were not found. The export may be from another report or layout.');
  const headerCells = grid[h].cells.map(cleanHeading);
  const position = (aliases: readonly string[] | undefined) => aliases ? headerCells.findIndex(cell => aliases.map(norm).includes(norm(cell))) : -1;
  // Kotak-style statements repeat "Dr / Cr" after the balance; that one signs the balance.
  const balanceAt = position(fieldOf(recipe, 'balance')?.from);
  const signs = headerCells.map((cell, at) => DRCR.map(norm).includes(norm(cell)) ? at : -1).filter(at => at >= 0);
  if (signs.length > 1 && balanceAt >= 0 && signs.includes(balanceAt + 1)) headerCells[balanceAt + 1] = BALANCE_SIGN;
  // Value date is the business date only when the statement has no transaction date.
  const dateAliases = fieldOf(recipe, 'date')!.from;
  meta = { ...meta, layout, businessDate: 'transaction-date' };
  if (position(dateAliases) < 0) {
    const valueAt = position(VALUE_DATE);
    check(valueAt >= 0, 'HEADER_NOT_FOUND', 'The statement has no transaction date column.');
    headerCells[valueAt] = 'Transaction Date'; meta.businessDate = 'value-date';
  }
  check(!headerCells.some(cell => norm(cell) === norm(ENTRY_KEY)), 'INVALID_HEADERS', 'The statement uses a column heading reserved by the importer.');
  const at = {
    date: position(dateAliases), balance: balanceAt, balanceSign: headerCells.indexOf(BALANCE_SIGN),
    withdrawal: position(fieldOf(recipe, 'withdrawal')?.from), deposit: position(fieldOf(recipe, 'deposit')?.from),
    amount: position(fieldOf(recipe, 'amount')?.from), drcr: position(fieldOf(recipe, 'drcr')?.from), reference: position(fieldOf(recipe, 'reference')?.from),
  };
  // Walk the rows after the heading: transactions, an opening-balance row, then the trailer.
  const body: GridLine[] = [], pre: GridLine[] = []; let end = grid.length, transactions = 0;
  for (let i = h + 1; i < grid.length; i++) {
    const row = grid[i], dateCell = (row.cells[at.date] ?? '').trim();
    const labels = row.cells.map(cellLabel).filter((key): key is SummaryKey => key !== null);
    if (row.cells.every(cell => SEPARATOR.test(cell))) continue;
    if (labels.length && !DATE_LIKE.test(dateCell)) {
      if (transactions === 0 && labels.every(key => key === 'opening')) { pre.push(row); continue; }
      end = i; break;
    }
    body.push(row); if (dateCell) transactions++;
  }
  const trailer = grid.slice(end);
  check(!trailer.some(row => DATE_LIKE.test((row.cells[at.date] ?? '').trim()) && row.cells.some(cell => MONEY_TEXT.test(cell.trim()))), 'BANK_ROWS_AFTER_SUMMARY', 'Transaction rows appear after the statement summary. Export the statement again.');
  const table = locateTable([{ line: grid[h].line, cells: headerCells }, ...body]);
  const headers = [...table.headers, ENTRY_KEY];
  const rows: RawRow[] = table.body.map(line => {
    const cells = cellsOf(table.headers, line.cells);
    const balanceHeader = table.headers[at.balance];
    if (balanceHeader !== undefined) cells[balanceHeader] = normalizeBalance(cells[balanceHeader], at.balanceSign >= 0 ? line.cells[at.balanceSign] ?? '' : '');
    const pick = (index: number) => index >= 0 ? (line.cells[index] ?? '').trim() : '';
    cells[ENTRY_KEY] = [pick(at.reference) || '-', pick(at.withdrawal), pick(at.deposit), pick(at.amount), pick(at.drcr)].join('|');
    return { line: line.line, cells };
  });
  const summary = readSummary([...grid.slice(0, h), ...pre, ...trailer], at.withdrawal >= 0 && at.deposit >= 0 ? { debit: at.withdrawal, credit: at.deposit } : null);
  meta.summaryCheck = summaryCheck(table.headers, rows, at, layout, recipe, summary);
  for (const key of ['drCount', 'crCount', 'debits', 'credits'] as const) if (summary[key] !== null) meta[key] = summary[key]!;
  return { headers, rows, footers: [], declared: null, balances: { opening: summary.opening, closing: summary.closing }, meta };
}

/**
 * The statement's own Dr/Cr counts and sums. Checked only when the running balance is continuous:
 * a broken balance is refused by the recipe engine with the line where it broke.
 */
function summaryCheck(headers: string[], rows: RawRow[], at: Record<string, number>, layout: Layout, recipe: SourceRecipe, summary: StatementSummary): 'passed' | 'unavailable' | 'deferred' {
  if (summary.drCount === null && summary.crCount === null && summary.debits === null && summary.credits === null) return 'unavailable';
  const text = (row: RawRow, index: number) => index >= 0 ? (row.cells[headers[index]] ?? '').trim() : '';
  const money = (value: string) => parseMoney(value, 'major', 'INR');
  const movements: bigint[] = []; let previous: bigint | null = summary.opening === null ? null : BigInt(money(summary.opening)!);
  try {
    for (const row of rows) {
      if (!text(row, at.date)) return 'deferred';
      let movement: bigint;
      if (layout === 'deposit-withdrawal') {
        const w = money(text(row, at.withdrawal)), d = money(text(row, at.deposit));
        if (w === null && d === null) return 'deferred';
        movement = BigInt(d ?? '0') - BigInt(w ?? '0');
      } else {
        const amount = money(text(row, at.amount)); if (amount === null) return 'deferred';
        const word = norm(text(row, at.drcr)), sign = recipe.sign;
        const negative = !!sign?.negative.map(norm).includes(word), positive = !!sign?.positive.map(norm).includes(word);
        if (negative === positive) return 'deferred';
        const size = BigInt(amount) < 0n ? -BigInt(amount) : BigInt(amount);
        movement = negative ? -size : size;
      }
      const balance = money(row.cells[headers[at.balance]] ?? ''); if (balance === null) return 'deferred';
      if (previous !== null && previous + movement !== BigInt(balance)) return 'deferred';
      previous = BigInt(balance); movements.push(movement);
    }
    if (summary.closing !== null && previous !== BigInt(money(summary.closing)!)) return 'deferred';
  } catch { return 'deferred'; }
  const debits = movements.filter(m => m < 0n), credits = movements.filter(m => m > 0n);
  const sum = (list: bigint[]) => list.reduce((total, m) => total + (m < 0n ? -m : m), 0n);
  const agree = (summary.drCount === null || BigInt(summary.drCount) === BigInt(debits.length))
    && (summary.crCount === null || BigInt(summary.crCount) === BigInt(credits.length))
    && (summary.debits === null || BigInt(money(summary.debits)!) === sum(debits))
    && (summary.credits === null || BigInt(money(summary.credits)!) === sum(credits));
  check(agree, 'BANK_SUMMARY_MISMATCH', 'The entries do not match the statement\'s own debit and credit counts or totals.');
  return 'passed';
}

const textInput = (text: unknown) => { check(typeof text === 'string', 'TEXT_REQUIRED', 'This recipe reads a text export.'); return text as string; };
const rowsInput = (rows: unknown) => { check(Array.isArray(rows), 'ROWS_REQUIRED', 'This recipe reads a worksheet.'); return rows as readonly (readonly string[])[]; };
export const DECODERS: readonly Decoder[] = [
  { id: 'bank-statement-table', version: '1', accepts: 'text', decode: (input, recipe) => bankTable(parseDelimited(textInput(input.text), ','), recipe, input.meta) },
  { id: 'bank-statement-rows', version: '1', accepts: 'rows', decode: (input, recipe) => bankTable(gridFromRows(rowsInput(input.rows)), recipe, input.meta) },
  {
    id: 'bank-pdf-text', version: '1', accepts: 'rows',
    decode(input, recipe) {
      const rows = rowsInput(input.rows);
      check(rows.length > 0 && rows[0].length === PDF_HEADER.length && rows[0].every((cell, i) => cell === PDF_HEADER[i]), 'PDF_ROWS_REQUIRED', 'This recipe reads rows made from a PDF statement by the line parser.');
      return bankTable(gridFromRows(rows), recipe, { ...input.meta, road: 'pdf-text' });
    },
  },
];

const NOTICE = 'Bank statements are financial data and are read on this machine only.';
const common = {
  date: { from: TXN_DATE, type: 'date', required: true, dateFormats: ['DMY', 'DMY-MON', 'ISO'] },
  narration: { from: NARRATION, type: 'text' },
  reference: { from: REFERENCE, type: 'text' },
  balance: { from: BALANCE, type: 'money', required: true },
  entryKey: { from: [ENTRY_KEY], type: 'text', required: true },
} as const satisfies Record<string, FieldSpec>;
const IGNORED = ['Value Date', 'Value Dt', 'Value Dt.', 'S No.', 'S.No.', 'Sl. No.', 'Sr. No.', 'Serial No', 'Branch Code', 'Branch', 'Init. Br', 'Init.Br', BALANCE_SIGN];
const depositWithdrawal = (id: string, title: string, decoder: string): SourceRecipe => ({
  id, version: '1', group: GROUP, operation: 'statement', title, decoder,
  header: [[...TXN_DATE, ...VALUE_DATE], BALANCE, NARRATION, WITHDRAWAL, DEPOSIT],
  fields: { ...common, withdrawal: { from: WITHDRAWAL, type: 'money', required: true }, deposit: { from: DEPOSIT, type: 'money', required: true } },
  measure: { type: 'money', amount: { credit: 'deposit', debit: 'withdrawal' }, currency: { constant: 'INR' }, unit: 'major' },
  identity: ['date', 'entryKey', 'balance'], kind: { constant: 'bank' },
  outputs: { bankReference: 'reference', description: 'narration' },
  totals: { kind: 'running-balance', balanceField: 'balance' },
  ignored: IGNORED, notices: [NOTICE], sensitivity: 'financial',
});
const amountDrCr = (id: string, title: string, decoder: string, signRequired: boolean, notices: string[] = []): SourceRecipe => ({
  id, version: '1', group: GROUP, operation: 'statement', title, decoder,
  header: [[...TXN_DATE, ...VALUE_DATE], BALANCE, NARRATION, AMOUNT, DRCR],
  fields: { ...common, amount: { from: AMOUNT, type: 'money', required: true }, drcr: { from: DRCR, type: 'text', required: signRequired } },
  measure: { type: 'money', amount: { field: 'amount' }, currency: { constant: 'INR' }, unit: 'major' },
  sign: { field: 'drcr', negative: DEBIT_WORDS, positive: CREDIT_WORDS },
  identity: ['date', 'entryKey', 'balance'], kind: { constant: 'bank' },
  outputs: { bankReference: 'reference', description: 'narration' },
  totals: { kind: 'running-balance', balanceField: 'balance' },
  ignored: [...IGNORED, 'Page', 'Line'], notices: [NOTICE, ...notices], sensitivity: 'financial',
});
export const RECIPES: readonly SourceRecipe[] = [
  depositWithdrawal('bank.statement-csv', 'Bank statement CSV with withdrawal and deposit columns', 'bank-statement-table'),
  amountDrCr('bank.statement-csv-drcr', 'Bank statement CSV with an amount and a Dr/Cr column', 'bank-statement-table', true),
  depositWithdrawal('bank.statement-sheet', 'Bank statement worksheet with withdrawal and deposit columns', 'bank-statement-rows'),
  amountDrCr('bank.statement-sheet-drcr', 'Bank statement worksheet with an amount and a Dr/Cr column', 'bank-statement-rows', true),
  amountDrCr('bank.pdf-text', 'Bank statement PDF read as text lines (experimental)', 'bank-pdf-text', false,
    ['PDF statements are read by a generic line parser. This road is experimental.', 'Where the PDF does not mark Dr or Cr, the direction comes only from the change in the running balance.']),
];
