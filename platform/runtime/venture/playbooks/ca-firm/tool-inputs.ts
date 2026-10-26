// AI-native CA firm: the tax engines' inputs, built by code from the client's files (Ink v2 wave 2, package 2A1). The
// agent names a table and maps its columns, or picks an amount by its id in a PDF or by its cell in a table; code reads
// every cell (delivery/harness/cells.ts) and builds the exact input each engine takes, in BigInt paise. No amount, rate
// or date here is one the model wrote: each comes from a cell or a PDF, or the call fails and says what is there. Each
// amount is picked once per call, so nothing is counted twice. Awkward rows never sink a whole table: rows the agent
// leaves out (a subtotal, a note) and rows the working cannot take (a credit note, a payment outside the year, a
// section that is not exact) are listed as not counted, each with its reason, and logged on the receipt.
import { INDIA_STATES } from '../../contracts.ts';
import type { IsoDate, WorkStep } from '../../contracts.ts';
import { amountCandidates, parseDateCell, parseMoneyCell } from '../../delivery/harness/cells.ts';
import { pdfPages, type SourceTable } from '../../delivery/harness/files.ts';
import { fail, fileOf, tableOf, type ToolEnv } from '../../delivery/harness/tools.ts';
import type { GstLine } from './gst.ts';
import { previousYearStart } from './income-tax.ts';
import type { PayeeKind, TdsPayment, TdsSectionCode } from './tds.ts';

/**
 * What a builder read, for the work receipt: the files and tables, the columns mapped, the rows or amount ids, the steps.
 * picked: every amount picked in this call, by file or table id, so none is picked twice. notCounted: rows read but not
 * given to the engine, each with its reason, for the agent's answer.
 */
export type ReadLog = {
  sources: { id: string; name: string; digest: string }[]; columns: Record<string, string>; rowIds: string[]; steps: WorkStep[];
  picked: Set<string>; notCounted: { line: string; reason: string }[];
};
export const newLog = (): ReadLog => ({ sources: [], columns: {}, rowIds: [], steps: [], picked: new Set(), notCounted: [] });

/** Notes a file, table or receipt the builder read, once. */
export function noteSource(log: ReadLog, source: { id: string; name: string; digest: string }): void {
  if (!log.sources.some(item => item.id === source.id)) log.sources.push({ id: source.id, name: source.name, digest: source.digest });
}

/** The CA firm's engines work in rupees only: a business keeping its books in another currency is refused. */
export function requireRupees(env: Pick<ToolEnv, 'currency'>): void {
  if (env.currency !== 'INR') fail(`The CA firm's calculator works in Indian rupees only, and this business keeps its books in ${env.currency}.`);
}

/** A table's column by its header, or a refusal that names the columns there are. */
export function columnOf(table: SourceTable, alias: string, header: unknown, role: string): string {
  if (typeof header !== 'string' || !table.columns.includes(header)) fail(`${alias} has no column ${JSON.stringify(header ?? '')} for ${role}. Its columns are: ${table.columns.join(', ')}.`);
  return header as string;
}

/** A table amounts may be read from: the client's own file, or bills picked from PDFs. A table a program made holds labels. */
export function amountTable(env: ToolEnv, alias: string): SourceTable {
  const table = tableOf(env, alias);
  if (table.origin === 'transform' || table.origin === 'computed') fail(`${alias} was made by a program or a tool, so it holds labels, not amounts. Read amounts from the client's file.`);
  return table;
}

/** A cell's text, trimmed; empty when the row lacks it. */
export const cellOf = (row: { cells: Record<string, string> }, column: string) => (row.cells[column] ?? '').trim();
const where = (alias: string, rowId: string, column: string) => `In ${alias}, row ${rowId}, the ${column} cell`;

/** A money cell in minor units (it may be negative); null when empty; a refusal naming the cell when it is not money. */
export function moneyCell(env: ToolEnv, alias: string, rowId: string, column: string, raw: string): bigint | null {
  const parsed = parseMoneyCell(raw, env.currency);
  if (!parsed.ok) fail(`${where(alias, rowId, column)} ${parsed.why}: ${JSON.stringify(raw.slice(0, 40))}.`);
  return parsed.ok && parsed.minor !== null ? BigInt(parsed.minor) : null;
}

function dateCell(env: ToolEnv, alias: string, rowId: string, column: string, raw: string): IsoDate {
  const date = parseDateCell(raw, env.dateOrder);
  if (!date) fail(`${where(alias, rowId, column)} is not a date Chausar can read: ${JSON.stringify(raw.slice(0, 40))}.`);
  return date!;
}

function yesNo(alias: string, rowId: string, column: string, raw: string): boolean {
  if (/^(?:y|yes|true|1)$/i.test(raw)) return true;
  if (/^(?:n|no|false|0|)$/i.test(raw)) return false;
  return fail(`${where(alias, rowId, column)} is not yes or no: ${JSON.stringify(raw.slice(0, 40))}.`);
}

/** A rate written as a percent ("18", "18%", "0.25 %") as whole basis points; null when it is not one. */
export function rateBps(raw: string): string | null {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?\s*%?$/.exec(raw.trim());
  return match ? String(BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'))) : null;
}

/**
 * The place of supply as a two-digit state code: "27", "27-Maharashtra" or "Maharashtra". Anything else is passed on as
 * written, and the GST working lists the line as an exception with its reason.
 */
export function stateCode(raw: string): string {
  const text = raw.trim();
  const coded = /^(\d{1,2})(?:\s*[-:]\s*\S.*|\s+\S.*)?$/.exec(text);
  if (coded) return coded[1].padStart(2, '0');
  const named = Object.entries(INDIA_STATES).find(([, name]) => name.toLowerCase() === text.toLowerCase());
  return named ? named[0] : text;
}

/**
 * The rows a table builder reads: all but the ones the agent leaves out (a subtotal, a total, a note), which must be rows
 * of the table and are logged on the receipt.
 */
function rowsToRead(table: SourceTable, alias: string, skipRows: readonly string[] | undefined, log: ReadLog): SourceTable['rows'] {
  const skip = [...new Set(skipRows ?? [])];
  for (const id of skip) if (!table.rows.some(row => row.id === id)) fail(`${alias} has no row ${id} to leave out.`);
  if (skip.length) log.steps.push({ op: 'count', inputs: skip.map(id => `${alias}.${id}`), result: String(skip.length), rule: `rows of ${alias} the agent left out` });
  return table.rows.filter(row => !skip.includes(row.id));
}

/** Rows read but not given to the engine, each with its reason; one step on the receipt says which. */
function notCounted(log: ReadLog, rows: { line: string; ref: string; reason: string }[], rule: string): void {
  if (!rows.length) return;
  log.notCounted.push(...rows.map(row => ({ line: row.line, reason: row.reason })));
  log.steps.push({ op: 'count', inputs: rows.map(row => row.ref), result: String(rows.length), rule });
}

// ---------------------------------------------------------------------------
// Picked amounts
// ---------------------------------------------------------------------------

/** One amount: an amount id from a PDF the agent read (file and amount), or one cell of a table (table, row and column). */
export type AmountPick = { file?: string; amount?: string; table?: string; row?: string; column?: string };

async function pickedAmount(env: ToolEnv, pick: AmountPick, field: string, log: ReadLog): Promise<{ minor: bigint; ref: string }> {
  const fromPdf = pick.file !== undefined || pick.amount !== undefined;
  const fromTable = pick.table !== undefined || pick.row !== undefined || pick.column !== undefined;
  if (fromPdf === fromTable || (fromPdf && (!pick.file || !pick.amount)) || (fromTable && (!pick.table || !pick.row || !pick.column))) {
    fail(`Each ${field} pick names an amount in a PDF (file and amount) or one table cell (table, row and column).`);
  }
  let minor: bigint, ref: string, key: string;
  if (fromPdf) {
    const file = fileOf(env, pick.file);
    if (file.format !== 'pdf') fail(`${pick.file} is not a PDF. Pick a cell of its table with table, row and column.`);
    const text = (await pdfPages(env.deps, file)).pages.map(page => page.text).join('\n');
    const index = parseInt(/^a(\d{1,2})$/.exec(pick.amount!)?.[1] ?? '0', 10);
    const found = amountCandidates(text, env.currency)[index - 1];
    if (!found) fail(`${pick.file} has no amount ${pick.amount}. Read it again with files.read part pages.`);
    noteSource(log, file);
    minor = BigInt(found!.minor);
    ref = `${pick.file}.${pick.amount}`;
    key = `${file.id}:${pick.amount}`;
  } else {
    const table = amountTable(env, pick.table!);
    const column = columnOf(table, pick.table!, pick.column, field);
    const row = table.rows.find(item => item.id === pick.row);
    if (!row) fail(`${pick.table} has no row ${pick.row}.`);
    const value = moneyCell(env, pick.table!, pick.row!, column, cellOf(row!, column));
    if (value === null) fail(`${where(pick.table!, pick.row!, column)} is empty.`);
    noteSource(log, table);
    minor = value!;
    ref = `${pick.table}.${pick.row}.${column}`;
    key = `${table.id}:${pick.row}:${column}`;
  }
  // By the file's or the table's own id, so two names for one table (f1 and f1.s1) are still one amount.
  if (log.picked.has(key)) fail(`The amount ${ref} is picked twice in this call. Pick each amount once.`);
  log.picked.add(key);
  if (minor < 0n) fail(`The ${field} amount ${ref} is negative. Pick the amount as the document shows it.`);
  return { minor, ref };
}

/** The picks for one input added up by the calculator; undefined when none were given. */
export async function sumPicks(env: ToolEnv, picks: readonly AmountPick[] | undefined, field: string, log: ReadLog): Promise<string | undefined> {
  if (!picks?.length) return undefined;
  let total = 0n;
  const inputs: string[] = [];
  for (const pick of picks) {
    const { minor, ref } = await pickedAmount(env, pick, field, log);
    total += minor;
    inputs.push(`${ref}:${minor}`);
    log.rowIds.push(ref);
  }
  log.steps.push({ op: 'add', inputs, result: String(total), rule: `${field}: the picked amounts added` });
  return String(total);
}

// ---------------------------------------------------------------------------
// Registers and payment tables
// ---------------------------------------------------------------------------

/** A sales or purchase register, column by column. The tax columns, cess and reverse charge are optional. */
export type RegisterMap = {
  table: string; invoice: string; date: string; counterpartyGstin?: string; placeOfSupply: string; hsnSac: string; taxable: string; rate: string;
  igst?: string; cgst?: string; sgst?: string; cess?: string; reverseCharge?: string; in2B?: string; eligible?: string;
  /** Rows to leave out, such as a subtotal or a total row. */
  skipRows?: string[];
};

/** The GST working's lines from one register: sales (outward) or purchases (inward). */
export function gstLines(env: ToolEnv, map: RegisterMap, side: 'outward' | 'inward', log: ReadLog): GstLine[] {
  const alias = map.table;
  const table = amountTable(env, alias);
  const role = side === 'outward' ? 'sales' : 'purchases';
  const col = (key: keyof RegisterMap, what: string) => columnOf(table, alias, map[key], `the ${what} of the ${role}`);
  const optional = (key: keyof RegisterMap, what: string) => (map[key] === undefined ? null : col(key, what));
  const columns = {
    invoice: col('invoice', 'invoice number'), date: col('date', 'invoice date'), counterpartyGstin: optional('counterpartyGstin', side === 'outward' ? "buyer's GSTIN" : "supplier's GSTIN"),
    placeOfSupply: col('placeOfSupply', 'place of supply'), hsnSac: col('hsnSac', 'HSN or SAC code'), taxable: col('taxable', 'taxable value'), rate: col('rate', 'GST rate'),
    igst: optional('igst', 'IGST charged'), cgst: optional('cgst', 'CGST charged'), sgst: optional('sgst', 'SGST charged'),
    cess: optional('cess', 'cess'), reverseCharge: optional('reverseCharge', 'reverse charge mark'),
    in2B: side === 'inward' ? optional('in2B', 'GSTR-2B mark') : null, eligible: side === 'inward' ? optional('eligible', 'credit eligibility mark') : null,
  };
  const charged = [columns.igst, columns.cgst, columns.sgst].filter(Boolean).length;
  if (charged !== 0 && charged !== 3) fail(`Map all three of the tax columns charged on the ${role} (igst, cgst and sgst), or none.`);
  noteSource(log, table);
  for (const [key, column] of Object.entries(columns)) if (column) log.columns[`${side}.${key}`] = column;
  const prefix = side === 'outward' ? 'sale' : 'purchase';
  const notes: { line: string; ref: string; reason: string }[] = [];
  const lines = rowsToRead(table, alias, map.skipRows, log).flatMap(row => {
    const cell = (column: string) => cellOf(row, column);
    const invoiceNo = cell(columns.invoice);
    if (!invoiceNo) fail(`${where(alias, row.id, columns.invoice)} is empty.`);
    const taxable = moneyCell(env, alias, row.id, columns.taxable, cell(columns.taxable));
    if (taxable === null) fail(`${where(alias, row.id, columns.taxable)} is empty.`);
    if (taxable! < 0n) {
      notes.push({ line: `${prefix}.${alias}.${row.id}`, ref: `${alias}.${row.id}`, reason: `${invoiceNo} has a negative taxable value: a credit or debit note, which this working does not count. Your CA works it.` });
      return [];
    }
    const rate = rateBps(cell(columns.rate));
    if (rate === null) fail(`${where(alias, row.id, columns.rate)} is not a rate such as 18%: ${JSON.stringify(cell(columns.rate).slice(0, 20))}.`);
    const gstin = columns.counterpartyGstin ? cell(columns.counterpartyGstin).replace(/\s+/g, '').toUpperCase() : '';
    const line: GstLine = {
      id: `${prefix}.${alias}.${row.id}`, invoiceNo, date: dateCell(env, alias, row.id, columns.date, cell(columns.date)), counterpartyGstin: gstin || null,
      placeOfSupply: stateCode(cell(columns.placeOfSupply)), hsnSac: cell(columns.hsnSac).replace(/\s+/g, ''), taxableMinor: String(taxable), rateBps: rate!,
    };
    if (charged === 3) {
      const head = (column: string) => {
        const value = moneyCell(env, alias, row.id, column, cell(column)) ?? 0n;
        if (value < 0n) fail(`${where(alias, row.id, column)} is negative.`);
        return String(value);
      };
      line.charged = { igstMinor: head(columns.igst!), cgstMinor: head(columns.cgst!), sgstMinor: head(columns.sgst!) };
    }
    if (columns.cess) {
      const cess = moneyCell(env, alias, row.id, columns.cess, cell(columns.cess));
      if (cess !== null && cess !== 0n) line.cessMinor = String(cess);
    }
    if (columns.reverseCharge && yesNo(alias, row.id, columns.reverseCharge, cell(columns.reverseCharge))) line.reverseCharge = true;
    if (columns.in2B) line.in2B = yesNo(alias, row.id, columns.in2B, cell(columns.in2B));
    if (columns.eligible) line.itcEligible = yesNo(alias, row.id, columns.eligible, cell(columns.eligible));
    log.rowIds.push(`${alias}.${row.id}`);
    return [line];
  });
  notCounted(log, notes, `credit or debit notes in ${alias}, not counted: your CA works them`);
  log.steps.push({ op: 'count', inputs: lines.map(line => line.id.slice(prefix.length + 1)), result: String(lines.length), rule: `${role} lines read from ${alias}` });
  return lines;
}

/**
 * A table of payments a business made that may need tax deducted, column by column. The PAN column is optional. The
 * name column is payeeName, never payee: a bare payee field reads as payment details to the policy (policy/effects.ts).
 */
export type PaymentsMap = { table: string; payeeName: string; pan?: string; payeeKind?: string; section: string; date: string; amount: string; skipRows?: string[] };

const PAYEE_KINDS: Readonly<Record<string, PayeeKind>> = Object.freeze({
  individual: 'individual', huf: 'huf', 'hindu undivided family': 'huf', company: 'company', firm: 'firm', 'partnership firm': 'firm', llp: 'firm', other: 'other',
});

/** A section cell in the working's own codes: "194c" reads 194C, "194J-Professional" reads 194J-professional. */
function sectionCode(raw: string): TdsSectionCode {
  const text = raw.replace(/\s+/g, '');
  const match = /^(\d{3}[A-Za-z]{0,2})(?:-(.+))?$/.exec(text);
  return (match ? `${match[1].toUpperCase()}${match[2] ? `-${match[2].toLowerCase()}` : ''}` : text) as TdsSectionCode;
}

/** Sections the working splits by kind, at different rates: a bare one cannot be placed. */
const SPLIT_SECTIONS: Readonly<Record<string, string>> = Object.freeze({ '194J': '194J-professional or 194J-technical', '194I': '194I-building or 194I-plant' });

/**
 * The TDS working's payments from one table, for one financial year. A payment dated outside the year, or under a
 * bare 194J or 194I, is listed as not counted with its reason. A section the working does not have at all is refused
 * by the working itself (NOT_MODELLED): that part goes to the CA.
 */
export function tdsPayments(env: ToolEnv, map: PaymentsMap, financialYear: string, log: ReadLog): TdsPayment[] {
  const alias = map.table;
  const table = amountTable(env, alias);
  const col = (key: keyof PaymentsMap, what: string) => columnOf(table, alias, map[key], what);
  const columns = {
    // Ink v2 4J16 (CA8): no kind column, an empty kind cell or an empty date cell reach the working as '' and it asks
    // the client (NEEDS_FACTS); nothing is guessed here.
    payee: col('payeeName', "the payee's name"), pan: map.pan === undefined ? null : col('pan', "the payee's PAN"), payeeKind: map.payeeKind === undefined ? null : col('payeeKind', 'the kind of payee'),
    section: col('section', 'the TDS section'), date: col('date', 'the payment date'), amount: col('amount', 'the amount paid'),
  };
  noteSource(log, table);
  for (const [key, column] of Object.entries(columns)) if (column) log.columns[`payments.${key}`] = column;
  const first = Number(financialYear.slice(0, 4));
  const from = `${first}-04-01`, to = `${first + 1}-04-01`;
  const notes: { line: string; ref: string; reason: string }[] = [];
  const payments = rowsToRead(table, alias, map.skipRows, log).flatMap(row => {
    const cell = (column: string) => cellOf(row, column);
    const payee = cell(columns.payee);
    if (!payee) fail(`${where(alias, row.id, columns.payee)} is empty.`);
    const amount = moneyCell(env, alias, row.id, columns.amount, cell(columns.amount));
    if (amount === null) fail(`${where(alias, row.id, columns.amount)} is empty.`);
    if (amount! < 0n) fail(`${where(alias, row.id, columns.amount)} is negative. A refund from a payee goes to your CA.`);
    const kind = columns.payeeKind ? cell(columns.payeeKind).toLowerCase().replace(/\s+/g, ' ') : '';
    const pan = columns.pan ? cell(columns.pan).replace(/\s+/g, '').toUpperCase() : '';
    const id = `${alias}.${row.id}`;
    const section = sectionCode(cell(columns.section));
    const date = cell(columns.date) ? dateCell(env, alias, row.id, columns.date, cell(columns.date)) : '';
    if (date && (date < from || date >= to)) {
      notes.push({ line: id, ref: id, reason: `${payee}: dated ${date}, outside the financial year ${financialYear}.` });
      return [];
    }
    if (Object.hasOwn(SPLIT_SECTIONS, section)) {
      notes.push({ line: id, ref: id, reason: `${payee}: section ${section} is paid at different rates as ${SPLIT_SECTIONS[section]}. The table must say which; ask the owner.` });
      return [];
    }
    log.rowIds.push(id);
    return [{ id, payee, pan: pan || null, payeeKind: (PAYEE_KINDS[kind] ?? kind) as PayeeKind, section, date, amountMinor: String(amount) }];
  });
  notCounted(log, notes, `payments in ${alias} not counted: outside the year, or no exact section`);
  log.steps.push({ op: 'count', inputs: payments.map(payment => payment.id), result: String(payments.length), rule: `payments read from ${alias}` });
  return payments;
}

/**
 * Advance tax paid for one assessment year, dated, from one table. Rows with no amount are left out; a payment made
 * outside the year (after 31 March it is not advance tax) is listed as not counted.
 */
export function advancePayments(env: ToolEnv, map: { table: string; date: string; amount: string; skipRows?: string[] }, assessmentYear: string, log: ReadLog): { date: IsoDate; amountMinor: string }[] {
  const alias = map.table;
  const table = amountTable(env, alias);
  const date = columnOf(table, alias, map.date, 'the date advance tax was paid');
  const amount = columnOf(table, alias, map.amount, 'the advance tax paid');
  noteSource(log, table);
  log.columns['advanceTax.date'] = date;
  log.columns['advanceTax.amount'] = amount;
  const from = previousYearStart(assessmentYear), to = `${assessmentYear.slice(0, 4)}-04-01`;
  const payments: { date: IsoDate; amountMinor: string }[] = [];
  const read: string[] = [];
  const notes: { line: string; ref: string; reason: string }[] = [];
  for (const row of rowsToRead(table, alias, map.skipRows, log)) {
    const value = moneyCell(env, alias, row.id, amount, cellOf(row, amount));
    if (value === null) continue;
    if (value < 0n) fail(`${where(alias, row.id, amount)} is negative.`);
    const paid = dateCell(env, alias, row.id, date, cellOf(row, date));
    const id = `${alias}.${row.id}`;
    if (paid < from || paid >= to) {
      notes.push({ line: id, ref: id, reason: `Paid on ${paid}, outside the year to 31 March ${to.slice(0, 4)}: not advance tax for assessment year ${assessmentYear}.` });
      continue;
    }
    payments.push({ date: paid, amountMinor: String(value) });
    read.push(id);
  }
  notCounted(log, notes, `payments in ${alias} not counted as advance tax: outside the year`);
  log.rowIds.push(...read);
  log.steps.push({ op: 'count', inputs: read, result: String(payments.length), rule: `advance tax payments read from ${alias}` });
  return payments;
}
