// Chausar delivery harness: the calculator for agent work. Sums, totals by group, and a bank reconciliation.
// Code reads every amount from the client's file (cells.ts) and adds with BigInt. The agent picks tables and columns
// by name; it never states a number. Each answer is a work receipt: inputs, steps, figures and the numbers a
// sentence may cite, so the draft quotes money only through a figure part bound to the receipt.
import { ChausarError, check } from '../../../contracts.ts';
import { numberGuard } from '../../../calculator.ts';
import { formatMinor } from '../../../currency.ts';
import { digest } from '../../records.ts';
import type {
  DateOrder, IsoDate, Reconciliation, ReconciliationLine, WorkFigure, WorkReceiptRecord, WorkRunRef, WorkStep, WorkTableRow,
} from '../../contracts.ts';
import { parseDateCell, parseMoneyCell } from './cells.ts';
import type { SourceTable } from './files.ts';
import { labelFinding } from './sandbox.ts';

export type WorkReceiptDraft = Omit<WorkReceiptRecord, 'id' | 'kind' | 'ventureId' | 'memberId' | 'epoch' | 'at'>;
export type WorkEnv = { currency: string; dateOrder: DateOrder; runRef: WorkRunRef };
export const MAX_GROUPS = 30;

function fail(message: string): never {
  throw new ChausarError('TOOL_FAILED', message);
}

function needColumn(table: SourceTable, column: string | undefined, role: string): string {
  if (typeof column !== 'string' || !table.columns.includes(column)) fail(`${table.name} has no column ${JSON.stringify(column ?? '')} for ${role}. Its columns are: ${table.columns.join(', ')}.`);
  return column as string;
}

/**
 * Amounts come only from the client's own files or from bills picked out of PDFs by amount id. A table a program made
 * holds labels and keys, so the calculator never reads an amount from it.
 */
function amountSource(table: SourceTable): SourceTable {
  if (table.origin === 'transform') fail(`${table.name} was made by a program, so it holds labels and keys, not amounts. Read amounts from the client's file.`);
  return table;
}

/** A table joined to another by row id must have been made from it by a program, or be the same table. */
function joinedTo(table: SourceTable, base: SourceTable, role: string): SourceTable {
  if (table.id !== base.id && table.madeFrom !== base.id) fail(`${table.name} was not made from ${base.name}, so its rows can't be used for ${role}.`);
  return table;
}

function amountOf(env: WorkEnv, table: SourceTable, row: WorkTableRow, column: string): bigint | null {
  const parsed = parseMoneyCell(row.cells[column] ?? '', env.currency);
  if (!parsed.ok) fail(`In ${table.name}, row ${row.id}, the ${column} cell ${parsed.why}: ${JSON.stringify((row.cells[column] ?? '').slice(0, 40))}.`);
  return parsed.ok && parsed.minor !== null ? BigInt(parsed.minor) : null;
}

const moneyFigure = (env: WorkEnv, key: string, label: string, value: bigint): WorkFigure =>
  ({ key, label, minor: String(value), display: formatMinor(value, env.currency), currency: env.currency, unit: 'money' });
const countFigure = (env: WorkEnv, key: string, label: string, value: number): WorkFigure =>
  ({ key, label, minor: String(value), display: String(value), currency: env.currency, unit: 'count' });
const line = (env: WorkEnv, rowId: string, date: IsoDate | null, text: string, amount: bigint): ReconciliationLine =>
  ({ rowId, date, text: text.slice(0, 120), amountMinor: String(amount), display: formatMinor(amount, env.currency) });

function allowedNumbers(figures: readonly WorkFigure[]): string[] {
  const numbers = new Set<string>();
  for (const figure of figures) {
    numbers.add(figure.minor);
    numbers.add(figure.unit === 'money' ? figure.display.slice(figure.currency.length + 1).replace(/,/g, '') : figure.display);
  }
  return [...numbers];
}

function finish(env: WorkEnv, body: Omit<WorkReceiptDraft, 'runRef' | 'currency' | 'allowedNumbers' | 'explanation' | 'digest'>): WorkReceiptDraft {
  const allowed = allowedNumbers(body.figures);
  const explanation = body.figures.map(figure => `${figure.label}: ${figure.display}.`).join(' ');
  const draft: WorkReceiptDraft = { ...body, runRef: env.runRef, currency: env.currency, allowedNumbers: allowed, explanation, digest: '' };
  // Labels hold column names and filter values, which may have digits; the amounts and counts are what is checked.
  numberGuard(body.figures.map(figure => figure.display).join(' '), draft);
  const { digest: _unset, ...covered } = draft;
  draft.digest = digest(covered);
  return draft;
}

const tableRef = (table: SourceTable) => ({ id: table.id, name: table.name, digest: table.digest });

/** work.sum: the total of one amount column, over every row or the rows where a column equals a value. */
export function sumRows(env: WorkEnv, table: SourceTable, amountColumn: string, filter: { column: string; equals: string } | null): WorkReceiptDraft {
  amountSource(table);
  needColumn(table, amountColumn, 'the amount');
  if (filter) needColumn(table, filter.column, 'the filter');
  const rows = filter ? table.rows.filter(row => (row.cells[filter.column] ?? '') === filter.equals) : table.rows;
  let total = 0n;
  const inputs: string[] = [];
  const counted: string[] = [];
  for (const row of rows) {
    const amount = amountOf(env, table, row, amountColumn);
    if (amount === null) continue;
    total += amount;
    inputs.push(`${row.id}:${amount}`);
    counted.push(row.id);
  }
  const where = filter ? ` where ${filter.column} is ${filter.equals}` : '';
  const figures = [moneyFigure(env, 'total', `Total of ${amountColumn}${where}`, total), countFigure(env, 'rows', 'Rows counted', counted.length)];
  const steps: WorkStep[] = [{ op: 'add', inputs, result: String(total), rule: `sum of ${amountColumn}${where}, empty cells left out` }];
  return finish(env, { operation: 'work.sum', inputs: { tables: [tableRef(table)], columns: { amount: amountColumn, ...(filter ? { filter: filter.column } : {}) }, rowIds: counted }, steps, figures, reconciliation: null });
}

/**
 * work.totals: totals of an amount column by a group column. The groups may come from a table a row program made
 * from the same file (joined by row id). Group names are labels: one that looks like a number is refused.
 */
export function totalsBy(env: WorkEnv, amounts: SourceTable, amountColumn: string, groups: SourceTable, groupColumn: string): WorkReceiptDraft {
  amountSource(amounts);
  joinedTo(groups, amounts, 'groups');
  needColumn(amounts, amountColumn, 'the amount');
  needColumn(groups, groupColumn, 'the groups');
  const same = groups.id === amounts.id;
  const groupOf = new Map(groups.rows.map(row => [row.id, (row.cells[groupColumn] ?? '').trim() || 'No group']));
  if (!same) check(amounts.rows.every(row => groupOf.has(row.id)), 'TOOL_FAILED', `${groups.name} does not have a row for every row of ${amounts.name}.`);
  const sums = new Map<string, { total: bigint; inputs: string[] }>();
  let total = 0n;
  const counted: string[] = [];
  for (const row of amounts.rows) {
    const amount = amountOf(env, amounts, row, amountColumn);
    if (amount === null) continue;
    const name = groupOf.get(row.id)!;
    const why = labelFinding(name);
    if (why) fail(`The group name in row ${row.id} ${why}. Groups are labels like Travel or Software.`);
    const entry = sums.get(name) ?? { total: 0n, inputs: [] };
    entry.total += amount;
    entry.inputs.push(`${row.id}:${amount}`);
    sums.set(name, entry);
    total += amount;
    counted.push(row.id);
  }
  check(sums.size <= MAX_GROUPS, 'TOOL_FAILED', `There are more than ${MAX_GROUPS} groups. Use a row program to put rows into fewer groups.`);
  const names = [...sums.keys()].sort((a, b) => a.localeCompare(b));
  const figures: WorkFigure[] = names.map((name, index) => moneyFigure(env, `group-${index + 1}`, name.slice(0, 60), sums.get(name)!.total));
  figures.push(moneyFigure(env, 'total', `Total of ${amountColumn}`, total));
  const steps: WorkStep[] = names.map(name => ({ op: 'add' as const, inputs: sums.get(name)!.inputs, result: String(sums.get(name)!.total), rule: `sum of ${amountColumn} for ${name.slice(0, 60)}` }));
  steps.push({ op: 'add', inputs: names.map(name => String(sums.get(name)!.total)), result: String(total), rule: 'sum of the group totals' });
  return finish(env, {
    operation: 'work.totals', inputs: { tables: same ? [tableRef(amounts)] : [tableRef(amounts), tableRef(groups)], columns: { amount: amountColumn, group: groupColumn }, rowIds: counted },
    steps, figures, reconciliation: null,
  });
}

export type BankColumns = { date?: string; description: string; moneyOut?: string; moneyIn?: string; amount?: string; balance?: string };
export type BillColumns = { vendor: string; amount: string; date?: string; number?: string };
export type ReconcileInput = {
  bank: SourceTable;
  bankColumns: BankColumns;
  bills: { table: SourceTable; columns: BillColumns }[];
  /** Match keys a row program made, joined by row id: equal keys and equal amounts match first. */
  bankKeys?: { table: SourceTable; column: string } | null;
  billKeys?: { table: SourceTable; column: string } | null;
};

type BankLine = { row: WorkTableRow; date: IsoDate | null; text: string; moneyIn: bigint; moneyOut: bigint; balance: bigint | null };
type BillLine = { table: SourceTable; row: WorkTableRow; ref: string; vendor: string; number: string; date: IsoDate | null; amount: bigint };

function bankLines(env: WorkEnv, bank: SourceTable, columns: BankColumns): BankLine[] {
  const description = needColumn(bank, columns.description, 'the description');
  const date = columns.date ? needColumn(bank, columns.date, 'the date') : null;
  const balance = columns.balance ? needColumn(bank, columns.balance, 'the balance') : null;
  const split = columns.moneyOut !== undefined || columns.moneyIn !== undefined;
  if (split) { needColumn(bank, columns.moneyOut, 'money out'); needColumn(bank, columns.moneyIn, 'money in'); }
  else needColumn(bank, columns.amount, 'the amount (money in positive, money out negative)');
  check(!(split && columns.amount !== undefined), 'TOOL_FAILED', 'Give either money out and money in columns, or one amount column, not both.');
  return bank.rows.map(row => {
    let moneyIn = 0n, moneyOut = 0n;
    if (split) {
      const out = amountOf(env, bank, row, columns.moneyOut!) ?? 0n, inn = amountOf(env, bank, row, columns.moneyIn!) ?? 0n;
      check(out >= 0n && inn >= 0n, 'TOOL_FAILED', `In ${bank.name}, row ${row.id} has a negative amount in a money in or money out column.`);
      moneyOut = out; moneyIn = inn;
    } else {
      const amount = amountOf(env, bank, row, columns.amount!) ?? 0n;
      if (amount < 0n) moneyOut = -amount; else moneyIn = amount;
    }
    const dateText = date ? row.cells[date] ?? '' : '';
    const parsedDate = date ? parseDateCell(dateText, env.dateOrder) : null;
    if (date && dateText && !parsedDate) fail(`In ${bank.name}, row ${row.id}, the date ${JSON.stringify(dateText.slice(0, 30))} could not be read.`);
    return { row, date: parsedDate, text: row.cells[description] ?? '', moneyIn, moneyOut, balance: balance ? amountOf(env, bank, row, balance) : null };
  });
}

/** True when each balance equals the one before plus money in minus money out. */
function chainHolds(lines: readonly BankLine[]): { holds: boolean; breakAt: string | null } {
  for (let i = 1; i < lines.length; i += 1) {
    const before = lines[i - 1].balance, after = lines[i].balance;
    if (before === null || after === null || after !== before + lines[i].moneyIn - lines[i].moneyOut) return { holds: false, breakAt: lines[i].row.id };
  }
  return { holds: true, breakAt: null };
}

function billLines(env: WorkEnv, input: ReconcileInput['bills']): BillLine[] {
  const lines: BillLine[] = [];
  for (const { table, columns } of input) {
    needColumn(table, columns.vendor, 'the supplier');
    needColumn(table, columns.amount, 'the bill amount');
    if (columns.date) needColumn(table, columns.date, 'the bill date');
    if (columns.number) needColumn(table, columns.number, 'the bill number');
    for (const row of table.rows) {
      const amount = amountOf(env, table, row, columns.amount);
      if (amount === null) continue;
      check(amount > 0n, 'TOOL_FAILED', `In ${table.name}, row ${row.id}, a bill amount must be above zero.`);
      const dateText = columns.date ? row.cells[columns.date] ?? '' : '';
      lines.push({
        table, row, ref: input.length > 1 ? `${table.id}#${row.id}` : row.id, vendor: (row.cells[columns.vendor] ?? '').trim(),
        number: columns.number ? (row.cells[columns.number] ?? '').trim() : '', date: dateText ? parseDateCell(dateText, env.dateOrder) : null, amount,
      });
    }
  }
  return lines;
}

/** The first word of a supplier name with three or more letters, lower case, for a name match in a bank line. */
function nameWord(vendor: string): string | null {
  const word = vendor.toLowerCase().split(/[^\p{L}\p{Nd}]+/u).find(part => part.replace(/\p{Nd}/gu, '').length >= 3);
  return word ?? null;
}

/** How many rows break the running balance: each balance should equal the one before plus money in less money out. */
function breaks(lines: readonly BankLine[]): number {
  let count = 0;
  for (let i = 1; i < lines.length; i += 1) {
    const before = lines[i - 1].balance, after = lines[i].balance;
    if (before === null || after === null || after !== before + lines[i].moneyIn - lines[i].moneyOut) count += 1;
  }
  return count;
}

/**
 * Statements come oldest first or newest first. The dates decide when every row has one and they run one way; else
 * the running balance does (the order with fewer breaks), so one bad balance can't flip the opening and the closing.
 */
function oldestFirst(lines: BankLine[]): { lines: BankLine[]; reversed: boolean } {
  const dates = lines.map(item => item.date);
  if (lines.length > 1 && dates.every(date => date !== null)) {
    const up = dates.every((date, i) => i === 0 || dates[i - 1]! <= date!);
    const down = dates.every((date, i) => i === 0 || dates[i - 1]! >= date!);
    if (up && !down) return { lines, reversed: false };
    if (down && !up) return { lines: [...lines].reverse(), reversed: true };
  }
  if (lines.every(item => item.balance !== null)) {
    const reversed = [...lines].reverse();
    if (breaks(reversed) < breaks(lines)) return { lines: reversed, reversed: true };
  }
  return { lines, reversed: false };
}

/**
 * The bill a payment most likely settled among candidates of the same amount: the oldest open bill dated on or before
 * the payment, then an undated one, then the earliest bill dated after it.
 */
function likeliestBill(candidates: readonly BillLine[], paid: IsoDate | null): BillLine | undefined {
  if (!candidates.length || !paid) return candidates[0];
  const byDate = (a: BillLine, b: BillLine) => (a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : 0);
  return candidates.filter(bill => bill.date !== null && bill.date <= paid).sort(byDate)[0]
    ?? candidates.find(bill => bill.date === null)
    ?? candidates.filter(bill => bill.date !== null).sort(byDate)[0];
}

function keyOf(keys: { table: SourceTable; column: string } | null | undefined, row: WorkTableRow): string {
  if (!keys) return '';
  return (keys.table.rows.find(item => item.id === row.id)?.cells[keys.column] ?? '').trim().toLowerCase();
}

/**
 * work.reconcile: one statement period against the bills. The running balance is checked row by row (a statement in
 * newest-first order is read in reverse); the closing balance code works out is compared with the statement's own.
 * Money out is matched to bills in four passes: the agent's keys, a bill number in the bank text, the same amount
 * and the supplier's name, then the same amount when it is unique on both sides.
 */
export function reconcileMonth(env: WorkEnv, input: ReconcileInput): WorkReceiptDraft {
  check(input.bills.length >= 1 && input.bills.length <= 6, 'TOOL_FAILED', 'Give between one and six bill tables.');
  check(new Set(input.bills.map(bill => bill.table.id)).size === input.bills.length, 'TOOL_FAILED', 'Give each bill table once.');
  amountSource(input.bank);
  for (const bill of input.bills) amountSource(bill.table);
  if (input.bankKeys) { needColumn(joinedTo(input.bankKeys.table, input.bank, 'bank keys'), input.bankKeys.column, 'the bank keys'); check(input.bankKeys.table.rows.length === input.bank.rows.length, 'TOOL_FAILED', 'The bank key table must have a row for every bank row.'); }
  if (input.billKeys) { check(input.bills.length === 1, 'TOOL_FAILED', 'Bill keys work with one bill table.'); needColumn(joinedTo(input.billKeys.table, input.bills[0].table, 'bill keys'), input.billKeys.column, 'the bill keys'); }
  const read = bankLines(env, input.bank, input.bankColumns);
  check(read.length > 0, 'TOOL_FAILED', `${input.bank.name} has no rows.`);
  const steps: WorkStep[] = [];
  const oriented = oldestFirst(read);
  const lines = oriented.lines;
  if (oriented.reversed) steps.push({ op: 'compare', inputs: [], result: 'reversed', rule: 'the statement lists the newest row first, so it is read from the bottom up' });
  const hasBalance = lines.every(item => item.balance !== null);
  const chain = hasBalance ? chainHolds(lines) : { holds: false, breakAt: null };
  const moneyIn = lines.reduce((sum, item) => sum + item.moneyIn, 0n);
  const moneyOut = lines.reduce((sum, item) => sum + item.moneyOut, 0n);
  const first = lines[0], last = lines[lines.length - 1];
  const opening = hasBalance ? first.balance! - first.moneyIn + first.moneyOut : null;
  const computed = opening === null ? null : opening + moneyIn - moneyOut;
  const statementClosing = hasBalance ? last.balance! : null;
  const difference = computed !== null && statementClosing !== null ? statementClosing - computed : null;
  const balanced = hasBalance && chain.holds && difference === 0n;

  steps.push({ op: 'add', inputs: lines.filter(item => item.moneyIn > 0n).map(item => `${item.row.id}:${item.moneyIn}`), result: String(moneyIn), rule: 'money in, every row' });
  steps.push({ op: 'add', inputs: lines.filter(item => item.moneyOut > 0n).map(item => `${item.row.id}:${item.moneyOut}`), result: String(moneyOut), rule: 'money out, every row' });
  if (opening !== null && computed !== null) {
    steps.push({ op: 'subtract', inputs: [String(first.balance), String(first.moneyIn), String(first.moneyOut)], result: String(opening), rule: 'opening balance: the first row balance, less its money in, plus its money out' });
    steps.push({ op: 'add', inputs: [String(opening), String(moneyIn), `-${moneyOut}`], result: String(computed), rule: 'closing balance worked out: opening plus money in less money out' });
    steps.push({ op: 'compare', inputs: [String(statementClosing), String(computed)], result: String(difference), rule: chain.holds ? 'the statement closing balance less the one worked out' : `the running balance breaks at row ${chain.breakAt}` });
  } else {
    steps.push({ op: 'compare', inputs: [], result: 'not-checked', rule: 'the statement has no balance column, so the closing balance could not be checked' });
  }

  const bills = billLines(env, input.bills);
  const outflows = lines.filter(item => item.moneyOut > 0n);
  const usedBank = new Set<string>(), usedBill = new Set<string>();
  const matched: Reconciliation['matched'] = [];
  const pair = (bankLine: BankLine, bill: BillLine, rule: Reconciliation['matched'][number]['rule']) => {
    usedBank.add(bankLine.row.id); usedBill.add(bill.ref);
    matched.push({ bankRowId: bankLine.row.id, billRowId: bill.ref, amountMinor: String(bill.amount), display: formatMinor(bill.amount, env.currency), bankText: bankLine.text.slice(0, 120), billText: `${bill.vendor}${bill.number ? ` ${bill.number}` : ''}`.slice(0, 120), rule });
  };
  const open = () => ({ bank: outflows.filter(item => !usedBank.has(item.row.id)), bill: bills.filter(item => !usedBill.has(item.ref)) });
  if (input.bankKeys || input.billKeys) {
    for (const bankLine of open().bank) {
      const key = keyOf(input.bankKeys, bankLine.row);
      if (!key) continue;
      const bill = likeliestBill(open().bill.filter(item => item.amount === bankLine.moneyOut && (input.billKeys ? keyOf(input.billKeys, item.row) : item.number.toLowerCase()) === key), bankLine.date);
      if (bill) pair(bankLine, bill, 'agent-key');
    }
  }
  for (const bankLine of open().bank) {
    const text = bankLine.text.toLowerCase();
    const bill = likeliestBill(open().bill.filter(item => item.number.length >= 3 && text.includes(item.number.toLowerCase()) && item.amount === bankLine.moneyOut), bankLine.date);
    if (bill) pair(bankLine, bill, 'bill-number');
  }
  for (const bankLine of open().bank) {
    const text = bankLine.text.toLowerCase();
    const bill = likeliestBill(open().bill.filter(item => item.amount === bankLine.moneyOut && (() => { const word = nameWord(item.vendor); return !!word && text.includes(word); })()), bankLine.date);
    if (bill) pair(bankLine, bill, 'amount-and-name');
  }
  for (const bankLine of open().bank) {
    const { bank, bill } = open();
    const sameBank = bank.filter(item => item.moneyOut === bankLine.moneyOut);
    const sameBill = bill.filter(item => item.amount === bankLine.moneyOut);
    if (sameBank.length === 1 && sameBill.length === 1) pair(bankLine, sameBill[0], 'amount-only');
  }
  const unmatchedBankLines = outflows.filter(item => !usedBank.has(item.row.id));
  const unmatchedBillLines = bills.filter(item => !usedBill.has(item.ref));
  const matchedTotal = matched.reduce((sum, item) => sum + BigInt(item.amountMinor), 0n);
  const unmatchedBankTotal = unmatchedBankLines.reduce((sum, item) => sum + item.moneyOut, 0n);
  const unmatchedBillTotal = unmatchedBillLines.reduce((sum, item) => sum + item.amount, 0n);
  steps.push({ op: 'match', inputs: matched.map(item => `${item.bankRowId}=${item.billRowId}:${item.amountMinor}:${item.rule}`), result: String(matched.length), rule: 'money out matched to bills: agent keys, bill numbers, amount and supplier name, then a unique amount' });
  steps.push({ op: 'add', inputs: matched.map(item => item.amountMinor), result: String(matchedTotal), rule: 'matched money out' });
  steps.push({ op: 'add', inputs: unmatchedBankLines.map(item => `${item.row.id}:${item.moneyOut}`), result: String(unmatchedBankTotal), rule: 'money out with no bill' });
  steps.push({ op: 'add', inputs: unmatchedBillLines.map(item => `${item.ref}:${item.amount}`), result: String(unmatchedBillTotal), rule: 'bills not paid in this statement' });

  const figures: WorkFigure[] = [];
  if (opening !== null) figures.push(moneyFigure(env, 'opening', 'Opening balance', opening));
  figures.push(moneyFigure(env, 'money-in', 'Money in', moneyIn), moneyFigure(env, 'money-out', 'Money out', moneyOut));
  if (computed !== null) figures.push(moneyFigure(env, 'computed-closing', 'Closing balance worked out', computed));
  if (statementClosing !== null) figures.push(moneyFigure(env, 'statement-closing', 'Closing balance on the statement', statementClosing));
  if (difference !== null) figures.push(moneyFigure(env, 'difference', 'Difference', difference));
  figures.push(
    moneyFigure(env, 'matched', 'Money out matched to bills', matchedTotal),
    moneyFigure(env, 'unmatched-bank', 'Money out with no bill', unmatchedBankTotal),
    moneyFigure(env, 'unmatched-bills', 'Bills not paid in this statement', unmatchedBillTotal),
    countFigure(env, 'matched-count', 'Payments matched to bills', matched.length),
    countFigure(env, 'unmatched-bank-count', 'Payments with no bill', unmatchedBankLines.length),
    countFigure(env, 'unmatched-bills-count', 'Bills not paid in this statement', unmatchedBillLines.length),
  );
  const reconciliation: Reconciliation = {
    balanced, statementClosing: hasBalance, matched,
    unmatchedBank: unmatchedBankLines.map(item => line(env, item.row.id, item.date, item.text, item.moneyOut)),
    unmatchedBills: unmatchedBillLines.map(item => line(env, item.ref, item.date, `${item.vendor}${item.number ? ` ${item.number}` : ''}`, item.amount)),
    moneyIn: lines.filter(item => item.moneyIn > 0n).map(item => line(env, item.row.id, item.date, item.text, item.moneyIn)),
  };
  const columns: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.bankColumns)) if (value) columns[`bank.${key}`] = value;
  input.bills.forEach((bill, index) => { for (const [key, value] of Object.entries(bill.columns)) if (value) columns[`bills.${index + 1}.${key}`] = value; });
  return finish(env, {
    operation: 'work.reconcile',
    inputs: { tables: [tableRef(input.bank), ...input.bills.map(item => tableRef(item.table))], columns, rowIds: lines.map(item => item.row.id) },
    steps, figures, reconciliation,
  });
}
