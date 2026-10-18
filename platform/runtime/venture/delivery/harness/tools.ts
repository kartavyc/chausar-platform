// Chausar delivery harness: the agent's tools. Each is a host function that takes one JSON object and returns the
// agentOS envelope, {ok: true, result} or {ok: false, error: {code, name, message}}. Deny by default: a tool works
// only when the playbook grants it to the run. Nothing here writes outside Chausar; an outside write is only ever
// recorded for the owner's approval. Money comes back as calculator receipts the draft cites by reference. On the
// shared hosted server the tools that need agent-written code, a container, the Python helper or the owner's own
// command-line tool are refused before they start, and the agent is not offered them.
import { ChausarError, check, newId } from '../../../contracts.ts';
import { digest, modelWords } from '../../records.ts';
import { TOOL_NAMES } from '../../contracts.ts';
import type {
  ClaimProof, ClaimProofKind, DateOrder, DelegationRequest, ExecutionOutcome, ExecutionTier, Json, MockEffect, RecordBase, SandboxPorts, ToolCallRecord,
  ToolEffect, ToolEnvelope, ToolName, VentureDeps, VentureHostKind, VentureRecordKind, WorkReceiptRecord, WorkRunRef, WorkTableRecord, WorkTableRow,
} from '../../contracts.ts';
import { amountCandidates, dateCandidates } from './cells.ts';
import { DELEGATE_LABELS, DELEGATE_MINUTES, prepareDelegation, REAL_ORDER_ONLY, type DelegateAvailability, type DelegationDraft } from './delegate.ts';
import { browse, DICTIONARY_KINDS, resolve, type DictionaryEntry, type DictionaryKind } from './dictionary.ts';
import { HOSTED_NO_PDF, pdfPages, tableOfRecord, tablesOfFile, type FileLike, type SourceTable } from './files.ts';
import { labelFinding, runPythonTransform, runRowProgram, tierRefusal } from './sandbox.ts';
import { parseRowProgram, ROW_LANGUAGE_GUIDE } from './sandbox-lang.ts';
import { reconcileMonth, sumRows, totalsBy, type WorkEnv, type WorkReceiptDraft } from './work.ts';

export const MAX_INPUT_CHARS = 12000;
/** Long enough for the slowest honest call: Docker checks and a 30 second container run, or a big table in chunks. */
const TOOL_TIMEOUT_MS = 60000;
const SAMPLE_ROWS = 5;
const PAGE_ROWS = 60;

/** Everything a tool may touch during one run. Records a tool makes wait in pending until the run stores them. */
export type ToolEnv = {
  deps: VentureDeps;
  ventureId: string;
  memberId: string;
  epoch: number;
  currency: string;
  dateOrder: DateOrder;
  runRef: WorkRunRef;
  files: FileLike[]; // in the run's order: f1, f2, ...
  tables: WorkTableRecord[]; // made earlier in this run, in order: t1, t2, ...
  receipts: WorkReceiptRecord[]; // made earlier in this run, in order: w1, w2, ...
  dictionary: DictionaryEntry[];
  sandbox: SandboxPorts | undefined;
  now: () => string;
  /** Tokens with a letter and a digit the agent may repeat, copied from the client's words and the idea (B2B, Q3). */
  allowed: readonly string[];
  /** The owner's command-line tools found and checked for this run. Empty in rehearsals and on the hosted server. */
  delegateOffer?: readonly DelegateAvailability[];
};

type ToolResult = { result: unknown; tables?: WorkTableRecord[]; receipts?: WorkReceiptRecord[]; proofs?: { kind: ClaimProofKind; receiptId?: string; tableId?: string }[]; handoff?: { to: 'client' | 'owner'; question: string }; mock?: MockEffect; delegate?: DelegationDraft };
type Field =
  | { type: 'text'; required: boolean; max: number; about: string }
  | { type: 'enum'; required: boolean; values: readonly string[]; about: string }
  | { type: 'list'; required: boolean; max: number; item: Field; about: string }
  | { type: 'object'; required: boolean; fields: Record<string, Field>; about: string };
type Spec = {
  name: ToolName;
  effect: ToolEffect;
  tier: ExecutionTier;
  endsTurn: boolean;
  summary: string;
  input: Record<string, Field>;
  run(env: ToolEnv, input: Record<string, any>): Promise<ToolResult>;
};

const text = (about: string, max = 200, required = true): Field => ({ type: 'text', required, max, about });
function fail(message: string): never {
  throw new ChausarError('TOOL_FAILED', message);
}

/** Short names the model uses: f1 (a file), f1.s2 (its second sheet), t1 (a table a tool made), w1 (a work receipt). */
function fileAlias(env: ToolEnv, uploadId: string): string { return `f${env.files.findIndex(file => file.id === uploadId) + 1}`; }
function tableAlias(env: ToolEnv, table: SourceTable): string {
  if (table.kind === 'work') return `t${env.tables.findIndex(item => item.id === table.id) + 1}`;
  const alias = fileAlias(env, table.uploadId!);
  return table.id === table.uploadId ? alias : `${alias}${table.id.slice(table.uploadId!.length)}`;
}
export function receiptAlias(env: Pick<ToolEnv, 'receipts'>, receiptId: string): string { return `w${env.receipts.findIndex(item => item.id === receiptId) + 1}`; }

function fileOf(env: ToolEnv, alias: unknown): FileLike {
  const match = typeof alias === 'string' ? /^f(\d{1,2})$/.exec(alias) : null;
  const file = match ? env.files[parseInt(match[1], 10) - 1] : undefined;
  if (!file) fail(`There is no file ${JSON.stringify(alias)}. The files are: ${env.files.map((_, i) => `f${i + 1}`).join(', ') || 'none'}.`);
  return file!;
}

function tableOf(env: ToolEnv, alias: unknown): SourceTable {
  if (typeof alias === 'string') {
    const work = /^t(\d{1,2})$/.exec(alias);
    if (work) { const record = env.tables[parseInt(work[1], 10) - 1]; if (record) return tableOfRecord(record); }
    const file = /^(f\d{1,2})(\.s\d{1,2})?$/.exec(alias);
    if (file) {
      const upload = fileOf(env, file[1]);
      if (upload.format === 'pdf') fail(`${file[1]} is a PDF. Read its text with files.read, and use bills.pick for bill amounts.`);
      const tables = tablesOfFile(upload);
      const found = file[2] ? tables.find(table => table.id === `${upload.id}${file[2]}`) : tables[0];
      if (found) return found;
    }
  }
  return fail(`There is no table ${JSON.stringify(alias)}. Use files.list to see the tables.`);
}

function base<K extends VentureRecordKind>(env: ToolEnv, kind: K, prefix: string): RecordBase<K> {
  return { id: newId(prefix), kind, ventureId: env.ventureId, memberId: env.memberId, epoch: env.epoch, at: env.now() };
}

/** A new receipt and the short name it will have. It joins the run only when the call succeeds (see callTool). */
function receiptOut(env: ToolEnv, draft: WorkReceiptDraft): { record: WorkReceiptRecord; alias: string; figures: Json } {
  const record: WorkReceiptRecord = { ...base(env, 'venture-work-receipt', 'work'), ...draft };
  const alias = `w${env.receipts.length + 1}`;
  return { record, alias, figures: record.figures.map(figure => ({ ref: `${alias}.${figure.key}`, label: figure.label, value: figure.display })) };
}

function rowsOut(rows: readonly WorkTableRow[]): Json {
  return rows.map(row => ({ id: row.id, ...row.cells }));
}

const TOOLS: Readonly<Record<ToolName, Spec>> = {
  'files.list': {
    name: 'files.list', effect: 'read', tier: 'code', endsTurn: false, input: {},
    summary: 'Lists the files the client sent and the tables in them, with their columns, and the tables your tools made.',
    async run(env) {
      const files = env.files.map((file, index) => {
        const alias = `f${index + 1}`;
        if (file.format === 'pdf') return { file: alias, name: file.name, format: file.format, tables: [] };
        let tables: Json = [];
        let note: string | null = null;
        try { tables = tablesOfFile(file).map(table => ({ table: tableAlias(env, table), name: table.name, columns: table.columns, rows: table.rows.length })); }
        catch (error) { note = error instanceof ChausarError ? error.message : 'This file could not be read.'; }
        return { file: alias, name: file.name, format: file.format, tables, ...(note ? { note } : {}) };
      });
      const made = env.tables.map((record, index) => ({ table: `t${index + 1}`, name: record.name, columns: record.columns, rows: record.rows.length }));
      return { result: { files, tablesMade: made } };
    },
  },
  'files.read': {
    name: 'files.read', effect: 'read', tier: 'code', endsTurn: false,
    summary: 'Reads a table (part columns, sample or rows, from a row id) or the text of a PDF (part pages), with amounts and dates you can pick by id.',
    input: {
      target: text('A table such as f1, f1.s2 or t1, or a PDF file such as f2.', 12),
      part: { type: 'enum', required: true, values: ['columns', 'sample', 'rows', 'pages'], about: 'columns, sample (first rows), rows (a page of rows) or pages (PDF text).' },
      from: text('For part rows: the row id to start from, such as r61.', 12, false),
    },
    async run(env, input) {
      if (input.part === 'pages') {
        const file = fileOf(env, input.target);
        if (file.format !== 'pdf') fail(`${input.target} is a table. Read it with part columns, sample or rows.`);
        const pdf = await pdfPages(env.deps, file);
        const all = pdf.pages.map(page => page.text).join('\n');
        const amounts = amountCandidates(all, env.currency).slice(0, 40).map((item, i) => ({ id: `a${i + 1}`, text: item.text, line: item.line }));
        const dates = dateCandidates(all, env.dateOrder).slice(0, 20).map((item, i) => ({ id: `d${i + 1}`, text: item.text, line: item.line }));
        return { result: { file: input.target, pages: pdf.pages.map(page => ({ page: page.page, text: page.text.slice(0, 6000) })), amounts, dates, coverage: pdf.coverage }, proofs: [{ kind: 'file-read', tableId: file.id }] };
      }
      const table = tableOf(env, input.target);
      const alias = tableAlias(env, table);
      if (input.part === 'columns') return { result: { table: alias, name: table.name, columns: table.columns, rows: table.rows.length }, proofs: [{ kind: 'file-read', tableId: table.id }] };
      if (input.part === 'sample') return { result: { table: alias, name: table.name, columns: table.columns, rows: table.rows.length, sample: rowsOut(table.rows.slice(0, SAMPLE_ROWS)) }, proofs: [{ kind: 'file-read', tableId: table.id }] };
      const start = input.from ? table.rows.findIndex(row => row.id === input.from) : 0;
      if (start < 0) fail(`${alias} has no row ${input.from}.`);
      const page = table.rows.slice(start, start + PAGE_ROWS);
      const next = table.rows[start + PAGE_ROWS]?.id ?? null;
      return { result: { table: alias, columns: table.columns, rows: rowsOut(page), next }, proofs: [{ kind: 'file-read', tableId: table.id }] };
    },
  },
  'dictionary.browse': {
    name: 'dictionary.browse', effect: 'read', tier: 'code', endsTurn: false,
    summary: "Searches the business dictionary (its terms, offers, steps, approvals, settings and money definitions) with a few words.",
    input: { query: text('A few words to look for.', 120), kind: { type: 'enum', required: false, values: DICTIONARY_KINDS, about: 'Only entries of this kind.' } },
    async run(env, input) {
      const found = browse(env.dictionary, input.query, (input.kind as DictionaryKind | undefined) ?? null);
      return { result: { entries: found.map(entry => ({ id: entry.id, kind: entry.kind, name: entry.name, meaning: entry.meaning.slice(0, 400) })), more: found.length === 0 ? 'Nothing matched. Try other words.' : null } };
    },
  },
  'dictionary.resolve': {
    name: 'dictionary.resolve', effect: 'read', tier: 'code', endsTurn: false,
    summary: 'Checks up to five words or names against the business dictionary and returns the entry each one means, or none.',
    input: { mentions: { type: 'list', required: true, max: 5, item: text('A word or name.', 80), about: 'Words or names to check.' } },
    async run(env, input) {
      return { result: { resolved: resolve(env.dictionary, input.mentions).map(item => ({ mention: item.mention, entry: item.entry ? { id: item.entry.id, name: item.entry.name, meaning: item.entry.meaning.slice(0, 300) } : null })) } };
    },
  },
  'calc.sum': {
    name: 'calc.sum', effect: 'compute', tier: 'code', endsTurn: false,
    summary: 'The calculator adds one amount column, over every row or the rows where a column equals a value. Returns a receipt with figure refs.',
    input: { table: text('A table such as f1 or t1.', 12), amountColumn: text('The amount column header.', 80), whereColumn: text('Optional: only rows where this column...', 80, false), equals: text('...equals this text.', 120, false) },
    async run(env, input) {
      const table = tableOf(env, input.table);
      check((input.whereColumn === undefined) === (input.equals === undefined), 'TOOL_FAILED', 'Give whereColumn and equals together, or neither.');
      const draft = sumRows(workEnv(env), table, input.amountColumn, input.whereColumn !== undefined ? { column: input.whereColumn, equals: input.equals } : null);
      const out = receiptOut(env, draft);
      return { result: { receipt: out.alias, figures: out.figures }, receipts: [out.record], proofs: [{ kind: 'totals', receiptId: out.record.id }] };
    },
  },
  'calc.totals': {
    name: 'calc.totals', effect: 'compute', tier: 'code', endsTurn: false,
    summary: 'The calculator totals an amount column by group. The group column can be in the same table or in a table a row program made from it.',
    input: { table: text('The table with the amounts.', 12), amountColumn: text('The amount column header.', 80), groupTable: text('Optional: the table with the groups (defaults to the same table).', 12, false), groupColumn: text('The group column header.', 80) },
    async run(env, input) {
      const amounts = tableOf(env, input.table);
      const groups = input.groupTable ? tableOf(env, input.groupTable) : amounts;
      const out = receiptOut(env, totalsBy(workEnv(env), amounts, input.amountColumn, groups, input.groupColumn));
      return { result: { receipt: out.alias, figures: out.figures }, receipts: [out.record], proofs: [{ kind: 'totals', receiptId: out.record.id }] };
    },
  },
  'books.reconcile': {
    name: 'books.reconcile', effect: 'compute', tier: 'code', endsTurn: false,
    summary: "Reconciles a bank statement table against bill tables: checks the running balance and closing balance, and matches money out to bills. Returns a receipt.",
    input: {
      bank: text('The bank statement table, such as f1.', 12),
      date: text('Bank date column.', 80, false), description: text('Bank description column.', 80),
      moneyOut: text('Money out column (or use amount).', 80, false), moneyIn: text('Money in column (or use amount).', 80, false),
      amount: text('One signed amount column instead of money out and money in.', 80, false), balance: text('Running balance column, if the statement has one.', 80, false),
      bills: { type: 'list', required: true, max: 6, about: 'The bill tables.', item: { type: 'object', required: true, about: 'One bill table.', fields: {
        table: text('A bill table, such as f2 or t1.', 12), vendor: text('Supplier column.', 80), amount: text('Bill amount column.', 80),
        date: text('Bill date column.', 80, false), number: text('Bill number column.', 80, false),
      } } },
      bankKeys: text('Optional: a table a row program made from the bank table, with a match key column...', 12, false),
      bankKeyColumn: text('...and that column.', 80, false),
    },
    async run(env, input) {
      check((input.bankKeys === undefined) === (input.bankKeyColumn === undefined), 'TOOL_FAILED', 'Give bankKeys and bankKeyColumn together, or neither.');
      const bank = tableOf(env, input.bank);
      const draft = reconcileMonth(workEnv(env), {
        bank, bankColumns: { date: input.date, description: input.description, moneyOut: input.moneyOut, moneyIn: input.moneyIn, amount: input.amount, balance: input.balance },
        bills: (input.bills as any[]).map(bill => ({ table: tableOf(env, bill.table), columns: { vendor: bill.vendor, amount: bill.amount, date: bill.date, number: bill.number } })),
        bankKeys: input.bankKeys ? { table: tableOf(env, input.bankKeys), column: input.bankKeyColumn } : null,
      });
      const out = receiptOut(env, draft);
      const rec = out.record.reconciliation!;
      const proofs: ToolResult['proofs'] = [];
      if (rec.statementClosing) proofs.push({ kind: 'reconciled', receiptId: out.record.id });
      if (rec.matched.length) proofs.push({ kind: 'matched', receiptId: out.record.id });
      if (rec.balanced) proofs.push({ kind: 'balanced', receiptId: out.record.id });
      return {
        result: {
          receipt: out.alias, balanced: rec.balanced, closingChecked: rec.statementClosing, matched: rec.matched.length,
          paymentsWithNoBill: rec.unmatchedBank.map(item => ({ row: item.rowId, text: item.text, value: item.display })),
          billsNotPaid: rec.unmatchedBills.map(item => ({ row: item.rowId, text: item.text, value: item.display })),
          figures: out.figures,
        },
        receipts: [out.record], proofs,
      };
    },
  },
  'bills.pick': {
    name: 'bills.pick', effect: 'compute', tier: 'code', endsTurn: false,
    summary: 'Makes a bill table from PDF bills: for each bill, pick the total by its amount id (a1) and the date by its date id (d1) from files.read, and name the supplier.',
    input: { picks: { type: 'list', required: true, max: 20, about: 'One entry per bill.', item: { type: 'object', required: true, about: 'One bill.', fields: {
      file: text('The PDF, such as f2.', 12), amount: text('The amount id of the bill total, such as a3.', 8), date: text('The date id, such as d1.', 8, false),
      supplier: text('The supplier name as written on the bill.', 80), number: text('The bill number as written, if any.', 40, false),
    } } } },
    async run(env, input) {
      const rows: WorkTableRow[] = [];
      for (const [index, pick] of (input.picks as any[]).entries()) {
        const file = fileOf(env, pick.file);
        if (file.format !== 'pdf') fail(`${pick.file} is not a PDF. Bill tables in CSV or XLSX go straight to books.reconcile.`);
        const all = (await pdfPages(env.deps, file)).pages.map(page => page.text).join('\n');
        const amount = amountCandidates(all, env.currency)[parseInt(/^a(\d{1,2})$/.exec(pick.amount)?.[1] ?? '0', 10) - 1];
        if (!amount) fail(`${pick.file} has no amount ${pick.amount}. Read it again with files.read part pages.`);
        const date = pick.date ? dateCandidates(all, env.dateOrder)[parseInt(/^d(\d{1,2})$/.exec(pick.date)?.[1] ?? '0', 10) - 1] : undefined;
        if (pick.date && !date) fail(`${pick.file} has no date ${pick.date}.`);
        for (const [field, value] of [['supplier', pick.supplier], ['number', pick.number ?? '']] as const) {
          const why = value ? labelFinding(value) : null;
          if (why) fail(`The ${field} you gave for ${pick.file} ${why}. Write it as it appears, without amounts.`);
        }
        rows.push({ id: `r${index + 1}`, cells: { Supplier: pick.supplier, 'Bill number': pick.number ?? '', 'Bill date': date?.iso ?? '', Amount: amount!.text, File: pick.file } });
      }
      const table: WorkTableRecord = {
        ...base(env, 'venture-work-table', 'worktable'), name: 'Bills picked from PDFs', columns: ['Supplier', 'Bill number', 'Bill date', 'Amount', 'File'], rows,
        source: { kind: 'picked', uploadIds: [...new Set((input.picks as any[]).map(pick => fileOf(env, pick.file).id))] }, runRef: env.runRef, digest: digest(rows),
      };
      const alias = `t${env.tables.length + 1}`;
      return { result: { table: alias, columns: table.columns, rows: rowsOut(rows) }, tables: [table], proofs: [{ kind: 'file-read', tableId: table.id }] };
    },
  },
  'sandbox.transform': {
    name: 'sandbox.transform', effect: 'sandbox', tier: 'wasm-lite', endsTurn: false,
    summary: 'Runs your row program over a table in the light sandbox and makes a new table with the same row ids. See the row language below.',
    input: { table: text('The table to read, such as f1.', 12), program: text('The row program.', 4000) },
    async run(env, input) {
      const source = tableOf(env, input.table);
      const program = parseRowProgram(input.program, source.columns);
      const ran = await runRowProgram(program, source.rows.map(row => row.cells));
      return madeTable(env, source, ran.columns, ran.rows, { tier: 'wasm-lite', driver: ran.driver, programDigest: digest(input.program), moduleDigest: ran.moduleDigest });
    },
  },
  'sandbox.python': {
    name: 'sandbox.python', effect: 'sandbox', tier: 'container', endsTurn: false,
    summary: 'Runs Python with a function transform(row) -> dict over a table in a Docker container with no network. Only where Docker Desktop is set up.',
    input: { table: text('The table to read, such as f1.', 12), code: text('Python source defining transform(row).', 8000) },
    async run(env, input) {
      const source = tableOf(env, input.table);
      const ran = await runPythonTransform(env.sandbox, input.code, source.rows);
      return madeTable(env, source, ran.columns, ran.rows, { tier: 'container', driver: ran.driver, programDigest: digest(input.code), moduleDigest: null });
    },
  },
  'handoff.client': {
    name: 'handoff.client', effect: 'handoff', tier: 'code', endsTurn: true,
    summary: 'Asks the client one question you need answered before you can go on. Ends your turn; the answer comes back as a message.',
    input: { question: text('One short question, words only.', 300) },
    async run(env, input) { return { result: { asked: true, to: 'client' }, handoff: { to: 'client', question: question(env, input.question) } }; },
  },
  'handoff.owner': {
    name: 'handoff.owner', effect: 'handoff', tier: 'code', endsTurn: true,
    summary: 'Asks the business owner for a decision or a fact only they have. Ends your turn; the answer comes back as a message.',
    input: { question: text('One short question, words only.', 300) },
    async run(env, input) { return { result: { asked: true, to: 'owner' }, handoff: { to: 'owner', question: question(env, input.question) } }; },
  },
  'outbox.propose': {
    name: 'outbox.propose', effect: 'outside-write', tier: 'code', endsTurn: false,
    summary: 'Proposes an outside action (an email or a payment link) for the owner to approve. It is only recorded; nothing is sent.',
    input: { connector: { type: 'enum', required: true, values: ['mail-app', 'payment-link'], about: 'Where it would go.' }, summary: text('What would be sent, in words.', 300) },
    async run(env, input) {
      const mock: MockEffect = { connector: input.connector, operation: input.connector === 'mail-app' ? 'send-deliverable' : 'create-link', payloadDigest: digest(input.summary), recordedAt: env.now() };
      return { result: { recorded: true, sent: false, note: 'Nothing was sent. The owner approves and sends outside actions; this build only records them.' }, mock };
    },
  },
  'agent.delegate': {
    name: 'agent.delegate', effect: 'delegate', tier: 'owner-cli', endsTurn: true,
    summary: "Hands a big job to the owner's own Claude Code or Codex on this computer, with copies of the order's files. Write the brief in words; the owner approves it before anything starts. Ends your turn. The result comes back as file names, a summary with its digits hidden, and figure refs for totals the calculator worked out again.",
    input: {
      brief: text('What the tool should do, in plain words. No amounts.', 4000),
      cli: { type: 'enum', required: false, values: ['claude-code', 'codex'], about: 'Which tool, when both are set up. Defaults to the first one found.' },
      files: { type: 'list', required: false, max: 10, item: text('A file such as f1.', 12), about: 'The files to copy into its folder. Defaults to every file on the order.' },
      minutes: { type: 'enum', required: false, values: DELEGATE_MINUTES, about: 'Its time limit in minutes. Defaults to ten.' },
    },
    async run(env, input) {
      // Rehearsals and improvement runs work on made-up clients under standing consent: they never start the tool.
      if (env.runRef.kind !== 'delivery') throw new ChausarError('TIER_UNAVAILABLE', REAL_ORDER_ONLY);
      const offer = env.delegateOffer ?? [];
      const chosen = input.cli ? offer.find(item => item.cli === input.cli) : offer[0];
      if (!chosen) throw new ChausarError('TIER_UNAVAILABLE', input.cli ? `${DELEGATE_LABELS[input.cli as 'claude-code' | 'codex']} is not set up on this computer.` : 'Neither Claude Code nor Codex is set up on this computer.');
      const files = input.files ? [...new Set((input.files as string[]).map(alias => fileOf(env, alias)))] : env.files;
      if (!files.length) fail('This order has no files to hand over.');
      const draft = prepareDelegation({ offer: chosen, task: input.brief, files, minutes: input.minutes ? parseInt(input.minutes, 10) : 10, allowed: env.allowed });
      return { result: { waiting: true, tool: chosen.cli, note: 'The owner reads this brief and approves or declines it before anything starts.' }, delegate: draft };
    },
  },
};

function madeTable(env: ToolEnv, source: SourceTable, columns: string[], rows: string[][], how: { tier: ExecutionTier; driver: string; programDigest: string; moduleDigest: string | null }): ToolResult {
  const tableRows: WorkTableRow[] = source.rows.map((row, index) => ({ id: row.id, cells: Object.fromEntries(columns.map((column, c) => [column, rows[index][c]])) }));
  const table: WorkTableRecord = {
    ...base(env, 'venture-work-table', 'worktable'), name: `Made from ${source.name}`.slice(0, 120), columns, rows: tableRows,
    source: { kind: 'transform', fromTableId: source.id, ...how }, runRef: env.runRef, digest: digest(tableRows),
  };
  const alias = `t${env.tables.length + 1}`;
  return { result: { table: alias, from: tableAlias(env, source), columns, rows: tableRows.length, sample: rowsOut(tableRows.slice(0, SAMPLE_ROWS)), tier: how.tier }, tables: [table], proofs: [{ kind: 'transformed', tableId: table.id }] };
}

/** A hand-off question reaches a person, so it holds words only: an amount in it would be the model's own number. */
function question(env: ToolEnv, text: string): string {
  try { return modelWords(text, 'question', 300, { allowed: env.allowed }); } catch {
    throw new ChausarError('TOOL_INPUT_INVALID', 'The question held a number. Ask in words; amounts come from the calculator.');
  }
}

function workEnv(env: ToolEnv): WorkEnv {
  return { currency: env.currency, dateOrder: env.dateOrder, runRef: env.runRef };
}

export function toolSpec(name: string): Spec | null {
  return Object.hasOwn(TOOLS, name) ? TOOLS[name as ToolName] : null;
}

/**
 * Why a tool can't run on this host, or null. Only the hosted web server refuses any: there it runs no agent-written
 * code, no containers and no command-line tool of the owner's (the tool's tier), and picking bills from PDFs needs the
 * Python helper, which never runs there.
 */
export function hostRefusal(host: VentureHostKind | undefined, name: ToolName): string | null {
  if (host !== 'hosted-web') return null;
  if (name === 'bills.pick') return HOSTED_NO_PDF;
  return tierRefusal(host, TOOLS[name].tier);
}

/** The granted tools this host can run: what the agent is offered. A playbook's grant is never changed by the host. */
export function offeredTools(grant: readonly ToolName[], host: VentureHostKind | undefined): ToolName[] {
  return grant.filter(name => hostRefusal(host, name) === null);
}

/** The tool list a prompt carries for a grant: names, what each does and its input fields. Deny by default. */
export function toolManifest(grant: readonly ToolName[]): Json {
  return TOOL_NAMES.filter(name => grant.includes(name)).map(name => {
    const spec = TOOLS[name];
    const describe = (field: Field): Json => field.type === 'object'
      ? { type: 'object', about: field.about, fields: Object.fromEntries(Object.entries(field.fields).map(([key, inner]) => [key, describe(inner)])) }
      : field.type === 'list' ? { type: 'list', about: field.about, max: field.max, item: describe(field.item) }
        : field.type === 'enum' ? { type: 'choice', about: field.about, values: [...field.values], required: field.required }
          : { type: 'text', about: field.about, required: field.required };
    return { tool: name, does: spec.summary, endsTurn: spec.endsTurn, input: Object.fromEntries(Object.entries(spec.input).map(([key, field]) => [key, describe(field)])) };
  });
}

export const ROW_LANGUAGE = ROW_LANGUAGE_GUIDE;

function validate(fields: Record<string, Field>, value: unknown, path: string): Record<string, any> {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), 'TOOL_INPUT_INVALID', `${path} must be an object.`);
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) check(Object.hasOwn(fields, key), 'TOOL_INPUT_INVALID', `${path} has an unknown field ${key}.`);
  const out: Record<string, any> = {};
  for (const [key, field] of Object.entries(fields)) {
    const item = record[key];
    if (item === undefined || item === null || item === '') { check(!field.required, 'TOOL_INPUT_INVALID', `${path}.${key} is required.`); continue; }
    out[key] = check1(field, item, `${path}.${key}`);
  }
  return out;
}

function check1(field: Field, item: unknown, path: string): any {
  if (field.type === 'text') {
    check(typeof item === 'string' && item.length <= field.max && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(item), 'TOOL_INPUT_INVALID', `${path} must be text of at most ${field.max} characters.`);
    check((item as string).trim().length > 0, 'TOOL_INPUT_INVALID', `${path} is empty.`);
    return item;
  }
  if (field.type === 'enum') { check(typeof item === 'string' && field.values.includes(item), 'TOOL_INPUT_INVALID', `${path} must be one of ${field.values.join(', ')}.`); return item; }
  if (field.type === 'list') {
    check(Array.isArray(item) && item.length >= 1 && item.length <= field.max, 'TOOL_INPUT_INVALID', `${path} must be a list of one to ${field.max} items.`);
    return (item as unknown[]).map((entry, index) => check1(field.item, entry, `${path}[${index}]`));
  }
  return validate(field.fields, item, path);
}

const errorName = (code: string) => code.toLowerCase().split('_').map(part => part[0].toUpperCase() + part.slice(1)).join('');

function failure(code: string, message: string): ToolEnvelope {
  return { ok: false, error: { code, name: errorName(code), message: message.slice(0, 600) } };
}

export type ToolOutcome = { record: ToolCallRecord; proofs: ClaimProof[]; handoff: { to: 'client' | 'owner'; question: string } | null; mock: MockEffect | null; tables: WorkTableRecord[]; receipts: WorkReceiptRecord[]; delegate: DelegationRequest | null };

/**
 * One tool call: refused unless the tool exists and is granted, its input parses and fits its fields; otherwise run
 * with a time limit. Every result, refusal included, is an envelope the agent reads on its next turn.
 */
export async function callTool(env: ToolEnv, grant: readonly ToolName[], turn: number, index: number, call: { tool: string; input: string }): Promise<ToolOutcome> {
  const id = `t${turn}.${index + 1}`;
  const spec = toolSpec(call.tool);
  const inputText = typeof call.input === 'string' ? call.input : '';
  const outcome = (envelope: ToolEnvelope, state: ExecutionOutcome, input: Json | null, extra: Partial<ToolOutcome> = {}): ToolOutcome => ({
    record: {
      id, turn, tool: call.tool.slice(0, 60), input, inputDigest: digest(inputText), envelope, outcome: state,
      effect: spec?.effect ?? null, tier: spec?.tier ?? null, receiptIds: (extra.receipts ?? []).map(item => item.id), tableIds: (extra.tables ?? []).map(item => item.id),
    },
    proofs: extra.proofs ?? [], handoff: extra.handoff ?? null, mock: extra.mock ?? null, tables: extra.tables ?? [], receipts: extra.receipts ?? [], delegate: extra.delegate ?? null,
  });
  if (!spec) return outcome(failure('TOOL_DENIED', `There is no tool called ${call.tool.slice(0, 60)}.`), 'failed', null);
  if (!grant.includes(spec.name)) return outcome(failure('TOOL_DENIED', `${spec.name} is not granted to this agent. Use only the tools you were given.`), 'failed', null);
  // Before any input is read or anything starts: no sandbox worker, container, Docker check or Python helper.
  const refused = hostRefusal(env.deps.host, spec.name);
  if (refused) return outcome(failure('TIER_UNAVAILABLE', refused), 'failed', null);
  if (inputText.length > MAX_INPUT_CHARS) return outcome(failure('TOOL_INPUT_INVALID', 'The tool input is too long.'), 'failed', null);
  let parsed: unknown;
  try { parsed = inputText.trim() ? JSON.parse(inputText) : {}; } catch { return outcome(failure('TOOL_INPUT_INVALID', 'The tool input is not valid JSON.'), 'failed', null); }
  let input: Record<string, any>;
  try { input = validate(spec.input, parsed, 'input'); } catch (error) {
    return outcome(failure('TOOL_INPUT_INVALID', error instanceof Error ? error.message : 'The tool input does not fit.'), 'failed', parsed as Json);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      spec.run(env, input),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ChausarError('TOOL_TIMEOUT', `${spec.name} ran past its time limit.`)), TOOL_TIMEOUT_MS); }),
    ]);
    const proofs: ClaimProof[] = (result.proofs ?? []).map(proof => ({ kind: proof.kind, toolCallId: id, receiptId: proof.receiptId ?? null, tableId: proof.tableId ?? null }));
    // Records join the run only here, after the call finished in time: a call that ran past its limit and finishes
    // later never adds a table or a receipt, so the short names stay stable.
    env.tables.push(...(result.tables ?? []));
    env.receipts.push(...(result.receipts ?? []));
    const delegate: DelegationRequest | null = result.delegate ? { ...result.delegate, toolCallId: id, turn } : null;
    return outcome({ ok: true, result: result.result as Json }, 'succeeded', input as Json, { proofs, handoff: result.handoff ?? null, mock: result.mock ?? null, tables: result.tables ?? [], receipts: result.receipts ?? [], delegate });
  } catch (error) {
    const code = error instanceof ChausarError ? error.code : 'TOOL_FAILED';
    const message = error instanceof ChausarError ? error.message : 'The tool failed.';
    return outcome(failure(code, message), code === 'TOOL_TIMEOUT' ? 'timedOut' : 'failed', input as Json);
  } finally {
    clearTimeout(timer);
  }
}
