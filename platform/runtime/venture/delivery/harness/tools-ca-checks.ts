// Chausar delivery harness: the AI-native CA firm's checks as agent tools (Ink v2 wave 2, package 2A2): matching the
// books to AIS, 26AS and Form 16 tables the agent maps column by column (tax.statements), and comparing the portal's
// figures with the run's receipts by key (tax.portal). Code reads every cell and finds every difference; the agent
// only names the tables, the columns, the receipts and how the portal writes its fields. The official file formats
// (AIS, 26AS, Form 16, the ITR JSON) are not read: the client's tables are. Only the CA firm playbook's agents may hold
// these tools (patches.ts FLAGSHIP_TOOLS); they read the order's files and write and send nothing.
//
// Each answer is a work receipt (operation 'ca.engine', engine 'reconcile' or 'portal-diff') whose figures are exactly
// the engine's and whose ca field keeps its inputs, so venture.ca.receipt can work it again (stored-receipt.ts).
import type { Json, ToolName, WorkReceiptRecord } from '../../contracts.ts';
import { reconcileTaxStatements, type StatementCategory, type StatementEntry, type StatementSource } from '../../playbooks/ca-firm/reconcile.ts';
import { portalDiffReceipt, type OurFigure, type PortalDiff, type PortalFigure } from '../../playbooks/ca-firm/portal.ts';
import { amountTable, cellOf, columnOf, moneyCell, newLog, noteSource, requireRupees, type ReadLog } from '../../playbooks/ca-firm/tool-inputs.ts';
import { caAnswer, noRetry } from './tools-ca.ts';
import { fail, text, type Spec, type ToolEnv } from './tools.ts';

type CaCheckToolName = Extract<ToolName, 'tax.statements' | 'tax.portal'>;

const SOURCES: readonly StatementSource[] = ['books', 'ais', '26as', 'form16'];
const CATEGORIES: readonly StatementCategory[] = ['salary', 'interest', 'dividend', 'rent', 'professional-fees', 'contract', 'commission', 'sale-of-securities', 'other'];
const SOURCE_WORDS: Readonly<Record<StatementSource, string>> = { books: 'the books', ais: 'AIS', '26as': '26AS', form16: 'Form 16' };
const column = (about: string, required = true) => text(about, 80, required);

/** A label as a category: "Professional fees" reads professional-fees; plural words read as the category. */
function categoryOf(raw: string, own: ReadonlyMap<string, StatementCategory>): StatementCategory | null {
  const mapped = own.get(raw.trim().toLowerCase());
  if (mapped) return mapped;
  const slug = raw.trim().toLowerCase().replace(/[\s_]+/g, '-');
  const found = CATEGORIES.find(item => item === slug || `${item}s` === slug || (item.endsWith('s') && item.slice(0, -1) === slug));
  return found ?? null;
}

type StatementMap = { table: string; source: StatementSource; category: string; payer: string; gross: string; tds?: string; categories?: { written: string; category: StatementCategory }[] };

/** One statement table's entries, every amount read from its cells; a row with no gross amount is refused. */
function statementEntries(env: ToolEnv, map: StatementMap, log: ReadLog): StatementEntry[] {
  const alias = map.table;
  const table = amountTable(env, alias);
  const words = SOURCE_WORDS[map.source];
  const columns = {
    category: columnOf(table, alias, map.category, `the category in ${words}`), payer: columnOf(table, alias, map.payer, `the payer in ${words}`),
    gross: columnOf(table, alias, map.gross, `the gross amount in ${words}`), tds: map.tds === undefined ? null : columnOf(table, alias, map.tds, `the tax deducted in ${words}`),
  };
  const own = new Map((map.categories ?? []).map(item => [item.written.trim().toLowerCase(), item.category]));
  noteSource(log, table);
  for (const [key, header] of Object.entries(columns)) if (header) log.columns[`${map.source}.${key}`] = header;
  const where = (rowId: string, header: string) => `In ${alias}, row ${rowId}, the ${header} cell`;
  const entries = table.rows.map(row => {
    const written = cellOf(row, columns.category);
    const category = categoryOf(written, own);
    if (!category) {
      fail(`${where(row.id, columns.category)} is not a category the calculator matches: ${JSON.stringify(written.slice(0, 40))}. Use ${CATEGORIES.join(', ')}, or map the table's own words with categories.`);
    }
    const payer = cellOf(row, columns.payer);
    if (!payer) fail(`${where(row.id, columns.payer)} is empty.`);
    const gross = moneyCell(env, alias, row.id, columns.gross, cellOf(row, columns.gross));
    if (gross === null) fail(`${where(row.id, columns.gross)} is empty.`);
    const tds = columns.tds ? moneyCell(env, alias, row.id, columns.tds, cellOf(row, columns.tds)) ?? 0n : 0n;
    if (gross! < 0n || tds < 0n) fail(`In ${alias}, row ${row.id}, an amount is negative. A refund or a reversal goes to your CA.`);
    log.rowIds.push(`${alias}.${row.id}`);
    return { source: map.source, category: category!, payer: payer.slice(0, 120), grossMinor: String(gross), tdsMinor: String(tds), ref: `${alias}.${row.id}` };
  });
  log.steps.push({ op: 'count', inputs: table.rows.map(row => `${alias}.${row.id}`), result: String(entries.length), rule: `${words} entries read from ${alias}` });
  return entries;
}

const STATEMENTS: Spec = {
  name: 'tax.statements', effect: 'compute', tier: 'code', endsTurn: false,
  summary: 'The calculator matches the books to AIS, 26AS and Form 16, payer by payer and category by category, from tables you map column by column, and lists every difference with its amount on a receipt. Quote each difference by its figure ref in the open items.',
  input: {
    entries: {
      type: 'list', required: true, max: 8, about: 'Each table, which statement it is, and its columns. Include the books.',
      item: {
        type: 'object', required: true, about: 'One table.',
        fields: {
          table: text('The table, such as f1 or f1.s2.', 12),
          source: { type: 'enum', required: true, values: SOURCES, about: 'Which statement the table is: books, ais, 26as or form16.' },
          category: column(`Category column: ${CATEGORIES.join(', ')}.`), payer: column("Payer column: the payer's TAN, or the name."),
          gross: column('Gross amount column.'), tds: column('Tax deducted column, if there is one.', false),
          categories: {
            type: 'list', required: false, max: 30, about: "The table's own words for a category, when they are not the calculator's.",
            item: {
              type: 'object', required: true, about: 'One word and its category.',
              fields: { written: text('The category cell as the table writes it.', 80), category: { type: 'enum', required: true, values: CATEGORIES, about: 'The category it is.' } },
            },
          },
        },
      },
    },
  },
  async run(env, input) {
    return noRetry(async () => {
      requireRupees(env);
      const maps = input.entries as StatementMap[];
      if (!maps.some(item => item.source === 'books')) fail('Include the books: every statement is matched against them.');
      if (!maps.some(item => item.source !== 'books')) fail('Include AIS, 26AS or Form 16 to match the books against.');
      const log = newLog();
      const entries = maps.flatMap(map => statementEntries(env, map, log));
      const engineInput = { entries };
      const receipt = reconcileTaxStatements(engineInput);
      const alias = `w${env.receipts.length + 1}`;
      const keys = new Set(receipt.figures.map(item => item.key));
      return caAnswer(env, receipt, engineInput, log, {
        differences: receipt.working.differences.map(item => ({
          against: SOURCE_WORDS[item.against], kind: item.kind, line: item.line,
          amount: keys.has(`${item.id}-amount`) ? `${alias}.${item.id}-amount` : `${alias}.${item.id}-tds`,
        })),
        ties: receipt.working.ties.map(item => ({ against: SOURCE_WORDS[item.against], field: item.field, ties: item.ties })),
      } as Record<string, Json>);
    });
  },
};

// ---------------------------------------------------------------------------
// tax.portal
// ---------------------------------------------------------------------------

/** A figure key the portal diff takes: lower case, with any other mark written as a hyphen. */
function keyOf(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

/** The receipt a short name points at: one of the calculator's tax workings in this run. */
function calculatorReceipt(env: ToolEnv, name: string): WorkReceiptRecord {
  const match = /^w(\d{1,2})$/.exec(name);
  const found = match ? env.receipts[parseInt(match[1], 10) - 1] : undefined;
  if (!found) fail(`There is no receipt ${JSON.stringify(name)}. The receipts are: ${env.receipts.map((_, index) => `w${index + 1}`).join(', ') || 'none'}.`);
  if (found!.operation !== 'ca.engine' || !found!.ca || found!.ca.engine === 'portal-diff') fail(`${name} is not a tax working of the calculator. Name the receipts tax.income, tax.interest, tax.gst, tax.tds or tax.statements made.`);
  return found!;
}

const PORTAL: Spec = {
  name: 'tax.portal', effect: 'compute', tier: 'code', endsTurn: false,
  summary: "The calculator compares the portal's own figures (a table from the return the portal prepared) with the receipts you name, key by key, to the paisa, and lists every difference. Your CA accepts or explains each one before anything is filed.",
  input: {
    portal: {
      type: 'object', required: true, about: "The portal's figures, one field per row.",
      fields: { table: text('The table, such as f2.', 12), key: column("Column with the portal's field name."), amount: column('Amount column.') },
    },
    ours: { type: 'list', required: true, max: 10, item: text('A receipt such as w1.', 12), about: 'The receipts to compare with, such as w1 and w2.' },
    keys: { type: 'list', required: false, max: 60, item: text('A figure key of the receipts, such as net-payable.', 80), about: 'Only these figures of the receipts. Leave it out to compare every one.' },
    rename: {
      type: 'list', required: false, max: 60, about: 'A portal field written differently from the figure key it is.',
      item: { type: 'object', required: true, about: 'One field.', fields: { field: text('The field as the portal writes it.', 80), key: text('The figure key it is, such as net-payable.', 80) } },
    },
  },
  async run(env, input) {
    return noRetry(async () => {
      requireRupees(env);
      const log = newLog();
      const ours: OurFigure[] = [];
      const from = new Map<string, string>();
      for (const name of [...new Set(input.ours as string[])]) {
        const receipt = calculatorReceipt(env, name);
        log.sources.push({ id: receipt.id, name: `receipt ${name}`, digest: receipt.digest });
        for (const figure of receipt.figures) {
          const key = keyOf(figure.key);
          if (from.has(key)) fail(`${from.get(key)} and ${name} both have a figure ${key}. Compare them one at a time, or name the keys.`);
          from.set(key, name);
          ours.push({ key, label: figure.label, minor: figure.minor, receiptId: receipt.id });
        }
      }
      let chosen = ours;
      if (input.keys?.length) {
        const wanted = [...new Set((input.keys as string[]).map(keyOf))];
        const missing = wanted.filter(key => !ours.some(item => item.key === key));
        if (missing.length) fail(`${(input.ours as string[]).join(' and ')} ${missing.length === 1 ? 'has no figure' : 'have no figures'} ${missing.join(', ')}. Their figures are: ${ours.map(item => item.key).join(', ')}.`);
        chosen = ours.filter(item => wanted.includes(item.key));
      }
      log.columns['ours.keys'] = chosen.map(item => item.key).join(', ');

      const alias = input.portal.table as string;
      const table = amountTable(env, alias);
      const keyColumn = columnOf(table, alias, input.portal.key, "the portal's field name");
      const amountColumn = columnOf(table, alias, input.portal.amount, "the portal's amount");
      const renamed = new Map(((input.rename ?? []) as { field: string; key: string }[]).map(item => [item.field.trim().toLowerCase(), keyOf(item.key)]));
      noteSource(log, table);
      log.columns['portal.key'] = keyColumn;
      log.columns['portal.amount'] = amountColumn;
      const portal: PortalFigure[] = [];
      const skipped: string[] = [];
      for (const row of table.rows) {
        const field = cellOf(row, keyColumn);
        if (!field) {
          // An amount with no field name is never compared, and never dropped silently: the agent reads it back.
          if (cellOf(row, amountColumn)) skipped.push(`${alias}.${row.id}`);
          continue;
        }
        const key = renamed.get(field.toLowerCase()) ?? keyOf(field);
        if (!key) fail(`In ${alias}, row ${row.id}, the field ${JSON.stringify(field.slice(0, 40))} has no letters or digits to use as a key.`);
        if (portal.some(item => item.key === key)) fail(`${alias} has the field ${key} twice. Rename one of them.`);
        const amount = moneyCell(env, alias, row.id, amountColumn, cellOf(row, amountColumn));
        if (amount === null) fail(`In ${alias}, row ${row.id}, the ${amountColumn} cell is empty.`);
        portal.push({ key, minor: String(amount) });
        log.rowIds.push(`${alias}.${row.id}`);
      }
      if (skipped.length) {
        log.notCounted.push(...skipped.map(line => ({ line, reason: 'The field name is empty, so this amount was not compared. Name the field and compare again.' })));
        log.steps.push({ op: 'count', inputs: skipped, result: String(skipped.length), rule: `rows in ${alias} with an amount and no field name, not compared` });
      }
      log.steps.push({ op: 'compare', inputs: [...log.rowIds], result: String(portal.length), rule: `the portal's fields read from ${alias}, compared by key with ${chosen.length} receipt figures` });
      const engineInput = { ours: chosen, portal };
      const receipt = portalDiffReceipt(engineInput);
      const diff: PortalDiff = receipt.working;
      const self = `w${env.receipts.length + 1}`;
      return caAnswer(env, receipt, engineInput, log, {
        rows: diff.rows.map(row => ({ key: row.key, state: row.state, difference: `${self}.${row.key}` })),
        forYourCa: diff.clean ? 'The portal agrees with the receipts on every key.' : 'Your CA accepts or explains each difference in Chausar before anything is filed.',
      });
    });
  },
};

export const CA_CHECK_TOOLS: Readonly<Record<CaCheckToolName, Spec>> = Object.freeze({ 'tax.statements': STATEMENTS, 'tax.portal': PORTAL });
