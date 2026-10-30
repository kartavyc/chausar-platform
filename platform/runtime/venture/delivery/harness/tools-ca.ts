import {HEALTH_CHECK} from './tools-ca-health.ts';
// Chausar delivery harness: the AI-native CA firm's tax engines as agent tools (Ink v2 wave 2, package 2A1): income
// tax, interest on late tax, the GST working and the TDS working. The agent picks the rule, the table columns and the
// amount ids; code reads the cells (playbooks/ca-firm/tool-inputs.ts) and the engine gives every number with its CA
// receipt, so the agent never types an amount. Only the CA firm playbook's agents may hold these tools (patches.ts
// FLAGSHIP_TOOLS); they read the order's files and write and send nothing (policy/effects.ts declares them read).
//
// Each answer is a work receipt (operation 'ca.engine') whose figures are exactly the engine's, in paise, and whose ca
// field keeps the whole engine receipt with its inputs, so venture.ca.receipt can work it again on the same table
// versions. A refusal the engine gives every time (a case it does not model, a date no table covers, a table the CA
// has not confirmed) reaches the agent marked { retry: false }: asking again changes nothing, and the same call again is
// answered from the run without running (tools.ts callTool). A mistake the agent can fix (a GSTIN, a month or a date
// written wrong, a GSTIN that is not the client's) is a plain TOOL_FAILED, checked here before the engine runs. A fact
// only the client knows (the regime, residency, age band, filing date, month, a payee's kind) is left out rather than
// guessed: the engine answers NEEDS_FACTS with what is missing, and the turn ends as a question to the client in
// Chausar's words (Ink v2 4J16, playbooks/ca-firm/needs-facts.ts).
import { ChausarError } from '../../../contracts.ts';
import { gstinValid } from '../../../memory.ts';
import { numberGuard } from '../../../calculator.ts';
import { digest, findRecord, listRecords } from '../../records.ts';
import type { Json, ToolName, WorkFigure, WorkReceiptRecord } from '../../contracts.ts';
import { writingLanguage } from '../../playbooks/writing-checks.ts';
import { computeIncomeTax, type IncomeTaxInput, type NotModelledIncome } from '../../playbooks/ca-firm/income-tax.ts';
import { computeInterest234, type InterestInput } from '../../playbooks/ca-firm/interest.ts';
import { gstWorking, type GstWorking, type GstWorkingInput } from '../../playbooks/ca-firm/gst.ts';
import { tdsWorking, type TdsWorking, type TdsWorkingInput } from '../../playbooks/ca-firm/tds.ts';
import { bpsText } from '../../playbooks/ca-firm/money.ts';
import { RATE_TABLES, type RateTableKind, type RateUse } from '../../playbooks/ca-firm/rates.ts';
import type { CaReceipt } from '../../playbooks/ca-firm/receipt.ts';
import { absent, guessedFacts, requireFacts } from '../../playbooks/ca-firm/needs-facts.ts';
import {
  advancePayments, gstLines, newLog, requireRupees, sumPicks, tdsPayments, type AmountPick, type ReadLog, type RegisterMap,
} from '../../playbooks/ca-firm/tool-inputs.ts';
import { fail, receiptOut, refusal, text, type Field, type Spec, type ToolEnv, type ToolResult } from './tools.ts';
import { pdfPages, tablesOfFile } from './files.ts';
import { CITATIONS, FORM_CHOOSER, ADVANCE } from './tools-ca-rules.ts';
import { WHAT_IF } from './tools-ca-what-if.ts';
import { DOC_ENTRY } from './tools-ca-entry.ts';
import { notBuiltTool } from './tool-stub.ts';
import type { WorkReceiptDraft } from './work.ts';

type CaToolName = Extract<ToolName, 'tax.income' | 'tax.interest' | 'tax.gst' | 'tax.tds'>;

/**
 * Refusals the engines give every time for the same input: the agent is told not to ask again. TAX_INPUT_INVALID is not
 * one: an input the engine cannot take is the agent's to fix, and the tools check the common ones first.
 */
export const NO_RETRY_CODES: readonly string[] = Object.freeze(['NOT_MODELLED', 'RATE_TABLE_MISSING', 'RATE_TABLE_STALE', 'RATE_UNCONFIRMED']);
/** A table the CA has not confirmed stays refused only until the CA confirms it, so a later call may work. */
const UNTIL: Readonly<Record<string, string>> = Object.freeze({ RATE_UNCONFIRMED: 'your CA confirms the rate table' });

/** Reads the inputs and works the engine; a refusal the engine would give again is marked { retry: false }. */
export async function noRetry<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch (error) {
    if (error instanceof ChausarError && NO_RETRY_CODES.includes(error.code)) {
      throw refusal(error.code, error.message, Object.hasOwn(UNTIL, error.code) ? { retry: false, until: UNTIL[error.code] } : { retry: false });
    }
    throw error;
  }
}

const ENGINE_WORDS: Readonly<Record<CaToolName, string>> = { 'tax.income': 'income tax working', 'tax.interest': 'interest working', 'tax.gst': 'GST working', 'tax.tds': 'TDS working' };

/**
 * The language the client writes in, for a NEEDS_FACTS question (4J16): Hindi when the order's request is written in
 * Devanagari, or, with no order, when every voice the business uses is Hindi; else English.
 */
function factsLanguage(env: ToolEnv): 'en' | 'hi' {
  try {
    const state = env.deps.store.read();
    if (env.runRef.kind === 'delivery') {
      const run = findRecord(state, 'venture-delivery-run', env.runRef.runId);
      const order = run ? findRecord(state, 'venture-order', run.orderId) : undefined;
      if (order?.request) return writingLanguage(order.request);
    }
    const voices = listRecords(state, 'venture-voice', env.ventureId).filter(voice => voice.on && !voice.draft);
    return voices.length && voices.every(voice => voice.language === 'hi') ? 'hi' : 'en';
  } catch {
    return 'en';
  }
}

/**
 * Ink v2 4J16 (CA8): a tax tool's work, where the client's facts are never guessed. A fact an earlier call of this tool
 * was refused NEEDS_FACTS for may be filled in only once a question to the client since then was really answered (not
 * a timeout); else it is asked again. A NEEDS_FACTS refusal carries the client's language for the question.
 */
export async function askingClient<T>(env: ToolEnv, tool: CaToolName | 'tax.formChooser' | 'tax.advance', input: Record<string, unknown>, work: () => Promise<T>): Promise<T> {
  try {
    requireFacts(tool === 'tax.formChooser' ? 'ITR form choice' : tool === 'tax.advance' ? 'advance tax' : ENGINE_WORDS[tool], guessedFacts(env.calls ?? [], env.handoffs ?? [], tool, input));
    return await work();
  } catch (error) {
    if (error instanceof ChausarError && error.code === 'NEEDS_FACTS') {
      const held = error as ChausarError & { details?: Json };
      held.details = { ...((held.details && typeof held.details === 'object' && !Array.isArray(held.details) ? held.details : {}) as Record<string, Json>), language: factsLanguage(env) };
    }
    throw error;
  }
}

/** A real calendar date written YYYY-MM-DD, or a plain failure the agent can fix. */
function dateInput(value: string, field: string): string {
  const [y, m, d] = value.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    fail(`input.${field} is a date written YYYY-MM-DD, such as 2027-09-10.`);
  }
  return value;
}

/** The GSTIN of the order's client on record, or null (no client, no GSTIN, or a rehearsal). */
function clientGstin(env: ToolEnv): string | null {
  if (env.runRef.kind !== 'delivery') return null;
  const state = env.deps.store.read();
  const run = findRecord(state, 'venture-delivery-run', env.runRef.runId);
  const order = run ? findRecord(state, 'venture-order', run.orderId) : undefined;
  const client = order ? findRecord(state, 'venture-client', order.clientId) : undefined;
  const taxId = client?.taxId?.replace(/\s+/g, '').toUpperCase() ?? null;
  return taxId && gstinValid(taxId) ? taxId : null;
}

/** Whether any of the order's files shows the GSTIN: a cell or header of a table, or the text of a PDF. */
async function inClientFiles(env: ToolEnv, gstin: string): Promise<boolean> {
  const shows = (text: string) => text.replace(/\s+/g, '').toUpperCase().includes(gstin);
  for (const file of env.files) {
    try {
      if (file.format === 'pdf') {
        if ((await pdfPages(env.deps, file)).pages.some(page => shows(page.text))) return true;
      } else if (file.format !== 'transcript') {
        if (tablesOfFile(file).some(table => table.columns.some(shows) || table.rows.some(row => Object.values(row.cells).some(shows)))) return true;
      }
    } catch { /* a file that cannot be read shows nothing */ }
  }
  return false;
}

/**
 * The GSTIN the GST working is for: well formed, and the client's on record, or (with none on record) one a client file
 * shows. The model never brings a GSTIN of its own.
 */
async function workingGstin(env: ToolEnv, raw: string): Promise<string> {
  const gstin = raw.replace(/\s+/g, '').toUpperCase();
  if (!gstinValid(gstin)) fail(`input.gstin is not a valid GSTIN: ${JSON.stringify(raw.slice(0, 20))}. Check its fifteen characters.`);
  const onRecord = clientGstin(env);
  if (onRecord) {
    if (onRecord !== gstin) fail(`${gstin} is not the client's GSTIN on record (${onRecord}). Work the GST for the GSTIN on record, or ask the owner to correct the client's record.`);
    return gstin;
  }
  if (!(await inClientFiles(env, gstin))) fail(`The GSTIN ${gstin} is not on the client's record and appears in none of the order's files. Take it from the client's registration, or ask the owner to add it to the client's record.`);
  return gstin;
}

/** How the engines may use rate tables; a hand-built environment with none is a real client's work with no confirmations. */
const rateUseOf = (env: ToolEnv): RateUse => env.rateUse ?? { mode: 'client', confirmations: [] };

/** The years a kind of rate table is kept for, newest last: the choices a tool offers. */
function yearsOf(kind: RateTableKind, key: 'assessmentYear' | 'financialYear'): string[] {
  return [...new Set(RATE_TABLES.filter(table => table.kind === kind).map(table => String((table.payload as Record<string, unknown>)[key])))].sort();
}
const ASSESSMENT_YEARS = yearsOf('income-tax', 'assessmentYear');
const FINANCIAL_YEARS = yearsOf('tds-sections', 'financialYear');

/**
 * The engine's receipt as a work receipt: its figures exactly (rupees, money), and the whole receipt under ca, inputs
 * included. Its digest covers everything but the record fields, like every work receipt (the auditor checks it).
 */
export function caWorkReceipt(env: ToolEnv, receipt: CaReceipt, inputs: unknown, log: ReadLog): { record: WorkReceiptRecord; alias: string; figures: Json } {
  const figures: WorkFigure[] = receipt.figures.map(item => ({ key: item.key, label: item.label, minor: item.minor, display: item.display, currency: 'INR', unit: 'money' }));
  const allowed = [...new Set(figures.flatMap(item => [item.minor, item.display.slice('INR '.length).replace(/,/g, '')]))];
  const draft: WorkReceiptDraft = {
    operation: 'ca.engine', runRef: env.runRef, currency: 'INR',
    inputs: { tables: log.sources, columns: log.columns, rowIds: log.rowIds }, steps: log.steps, figures, reconciliation: null, allowedNumbers: allowed,
    explanation: figures.map(item => `${item.label}: ${item.display}.`).join(' '), digest: '',
    ca: {
      engine: receipt.engine, inputs: inputs as Json, inputsDigest: receipt.inputsDigest, caReceiptId: receipt.id, table: receipt.table, tables: receipt.tables,
      sections: receipt.sections, assumptions: receipt.assumptions, openQuestions: receipt.openQuestions, working: receipt.working as Json,
      steps: receipt.steps, explanation: receipt.explanation,
    },
  };
  numberGuard(figures.map(item => item.display).join(' '), draft);
  const { digest: _unset, ...covered } = draft;
  draft.digest = digest(covered);
  return receiptOut(env, draft);
}

/** What the agent reads back: the receipt's short name, its figures by ref, and what the engine assumed and left open. */
export function caAnswer(env: ToolEnv, receipt: CaReceipt, inputs: unknown, log: ReadLog, extra: Record<string, Json> = {}): ToolResult {
  const out = caWorkReceipt(env, receipt, inputs, log);
  return {
    result: {
      receipt: out.alias, figures: out.figures, explanation: receipt.explanation,
      rateTables: receipt.tables.map(table => ({ title: table.title, version: table.version, confirmedByYourCa: table.confirmed })),
      assumptions: receipt.assumptions, openQuestionsForTheCa: receipt.openQuestions,
      ...(log.notCounted.length ? { notCounted: log.notCounted.map(item => ({ ...item })) } : {}), ...extra,
    },
    receipts: [out.record], proofs: [{ kind: 'totals', receiptId: out.record.id }],
  };
}

// ---------------------------------------------------------------------------
// Input fields
// ---------------------------------------------------------------------------

const SKIP: Field = { type: 'list', required: false, max: 50, item: text('A row id such as r12.', 12), about: 'Rows to leave out, such as a subtotal, a total or a note. Each is logged on the receipt.' };
/** Ink v2 4J16 (CA8): what the agent does with a fact it does not know (playbooks/ca-firm/needs-facts.ts). */
const LEAVE_OUT = 'Never guess a fact about the client: leave it out, and the calculator answers NEEDS_FACTS, Chausar asks the client and your turn ends.';

const PICK: Field = {
  type: 'object', required: true, about: 'One amount: an amount id in a PDF you read (file and amount), or one table cell (table, row and column).',
  fields: {
    file: text('A PDF such as f2.', 12, false), amount: text('Its amount id from files.read part pages, such as a3.', 8, false),
    table: text('A table such as f1 or f1.s2.', 12, false), row: text('The row id, such as r4.', 12, false), column: text('The column header.', 80, false),
  },
};
const picks = (about: string, required = false): Field => ({ type: 'list', required, max: 10, item: PICK, about: `${about} Several picks are added by the calculator.` });
const yearChoice = (values: readonly string[], about: string): Field => ({ type: 'enum', required: true, values, about });
const column = (about: string, required = true) => text(about, 80, required);

const REGISTER_FIELDS: Record<string, Field> = {
  table: text('The register table, such as f1 or f1.s2.', 12),
  invoice: column('Invoice number column.'), date: column('Invoice date column.'), counterpartyGstin: column("The other party's GSTIN column, if there is one.", false),
  placeOfSupply: column('Place of supply column: a state code such as 27, or the state name.'), hsnSac: column('HSN or SAC code column.'),
  taxable: column('Taxable value column.'), rate: column('GST rate column, such as 18%.'),
  igst: column('IGST the invoice charged, if the register shows it (with cgst and sgst).', false), cgst: column('CGST the invoice charged.', false), sgst: column('SGST the invoice charged.', false),
  cess: column('Cess column, if there is one.', false), reverseCharge: column('Reverse charge mark column (yes or no), if there is one.', false),
  skipRows: SKIP,
};

// ---------------------------------------------------------------------------
// The four tools
// ---------------------------------------------------------------------------

const INCOME: Spec = {
  name: 'tax.income', effect: 'compute', tier: 'code', endsTurn: false,
  summary: `The calculator works income tax for one person for one assessment year, under the regime you choose, from amounts you pick in the client's files. It refuses what it does not model (name it in alsoHas): that goes to the CA. ${LEAVE_OUT}`,
  input: {
    assessmentYear: yearChoice(ASSESSMENT_YEARS, 'The assessment year, such as 2027-28 for income of the year to 31 March 2027.'),
    // Ink v2 4J16 (CA8): facts the files may not show are optional, so the agent leaves them out instead of guessing.
    regime: { type: 'enum', required: false, values: ['new', 'old'], about: 'The new regime, or the old one the person opted for. Leave it out when the files do not say.' },
    residency: { type: 'enum', required: false, values: ['resident', 'non-resident'], about: 'Whether the person is resident in India for the year. Leave it out when the files do not say.' },
    ageBand: { type: 'enum', required: false, values: ['below-60', '60-79', '80-plus'], about: "The person's age band. Leave it out when the files do not say." },
    salary: picks('Taxable salary after exempt allowances, before the standard deduction, as on Form 16.'),
    professionalTax: picks('Professional tax paid, as on Form 16.'),
    otherIncome: picks('Interest and other income taxed at slab rates.'),
    businessIncome: picks('Business or professional profit from the books. Use presumptive instead for 44AD or 44ADA.'),
    presumptive: {
      type: 'object', required: false, about: 'Presumptive income of a small business (44AD) or a profession (44ADA).',
      fields: {
        scheme: { type: 'enum', required: true, values: ['44AD', '44ADA'], about: 'The scheme.' },
        digitalReceipts: picks('44AD: receipts by bank or digital means.'), cashReceipts: picks('Receipts in cash.'), grossReceipts: picks('44ADA: gross receipts.'),
      },
    },
    deductions: {
      type: 'list', required: false, max: 12, about: 'Deductions claimed, each under its code.',
      item: { type: 'object', required: true, about: 'One deduction.', fields: { code: text('The deduction code, such as 80C or 80D.', 20), amount: picks('The amount claimed.', true) } },
    },
    alsoHas: {
      type: 'list', required: false, max: 6, about: 'Incomes the person has that this calculator does not model. It then refuses, and the case goes to the CA.',
      item: { type: 'enum', required: true, values: ['capital-gains', 'house-property', 'foreign-income', 'agricultural-income', 'lottery-or-winnings', 'virtual-digital-assets'], about: 'One kind of income.' },
    },
    prepaid: {
      type: 'object', required: false, about: 'Tax already paid, for the balance.',
      fields: { tds: picks('Tax deducted at source.'), tcs: picks('Tax collected at source.'), advanceTax: picks('Advance tax paid.') },
    },
  },
  async run(env, input) {
    return noRetry(() => askingClient(env, 'tax.income', input, async () => {
      requireRupees(env);
      const log = newLog();
      const amount = (list: readonly AmountPick[] | undefined, field: string) => sumPicks(env, list, field, log);
      const salary = await amount(input.salary, 'salary');
      const professionalTax = await amount(input.professionalTax, 'professional tax');
      const otherIncome = await amount(input.otherIncome, 'other income');
      const businessIncome = await amount(input.businessIncome, 'business income');
      let presumptive: IncomeTaxInput['presumptive'];
      if (input.presumptive) {
        const cash = (await amount(input.presumptive.cashReceipts, 'cash receipts')) ?? '0';
        if (input.presumptive.scheme === '44AD') {
          presumptive = { scheme: '44AD', digitalReceiptsMinor: (await amount(input.presumptive.digitalReceipts, 'digital receipts')) ?? '0', cashReceiptsMinor: cash };
        } else {
          const gross = await amount(input.presumptive.grossReceipts, 'gross receipts');
          if (gross === undefined) fail('Pick the gross receipts for 44ADA.');
          presumptive = { scheme: '44ADA', grossReceiptsMinor: gross!, cashReceiptsMinor: cash };
        }
      }
      const deductions: { code: string; claimedMinor: string }[] = [];
      for (const item of (input.deductions ?? []) as { code: string; amount: AmountPick[] }[]) {
        const code = item.code.replace(/\s+/g, '').toUpperCase();
        deductions.push({ code, claimedMinor: (await amount(item.amount, `deduction ${code}`))! });
      }
      const prepaid = input.prepaid ? {
        tds: await amount(input.prepaid.tds, 'TDS'), tcs: await amount(input.prepaid.tcs, 'TCS'), advanceTax: await amount(input.prepaid.advanceTax, 'advance tax'),
      } : null;
      const engineInput: IncomeTaxInput = {
        assessmentYear: input.assessmentYear, regime: input.regime, residency: input.residency, ageBand: input.ageBand,
        ...(salary !== undefined ? { salaryMinor: salary } : {}),
        ...(professionalTax !== undefined ? { professionalTaxMinor: professionalTax } : {}),
        ...(otherIncome !== undefined ? { otherSlabIncomeMinor: otherIncome } : {}),
        ...(businessIncome !== undefined ? { businessIncomeMinor: businessIncome } : {}),
        ...(presumptive ? { presumptive } : {}),
        ...(deductions.length ? { deductions } : {}),
        ...(input.alsoHas?.length ? { alsoHas: [...new Set(input.alsoHas as NotModelledIncome[])] } : {}),
        ...(prepaid && (prepaid.tds ?? prepaid.tcs ?? prepaid.advanceTax) !== undefined ? {
          prepaid: {
            ...(prepaid.tds !== undefined ? { tdsMinor: prepaid.tds } : {}), ...(prepaid.tcs !== undefined ? { tcsMinor: prepaid.tcs } : {}),
            ...(prepaid.advanceTax !== undefined ? { advanceTaxMinor: prepaid.advanceTax } : {}),
          },
        } : {}),
      };
      return caAnswer(env, computeIncomeTax(engineInput, rateUseOf(env)), engineInput, log);
    }));
  },
};

const INTEREST: Spec = {
  name: 'tax.interest', effect: 'compute', tier: 'code', endsTurn: false,
  summary: 'The calculator works interest for a late return (234A), short advance tax (234B) and deferred advance tax (234C), from an income tax receipt you name and a table of the advance tax paid. Tax deducted and collected come from that receipt. A payment made outside the year is listed as not counted.',
  input: {
    assessmentYear: yearChoice(ASSESSMENT_YEARS, 'The assessment year, the same as the income tax receipt.'),
    taxFrom: text('The income tax receipt to take the tax from, such as w1.', 12),
    advanceTax: {
      type: 'object', required: false, about: 'The advance tax paid, one dated payment per row. Leave it out when none was paid.',
      fields: { table: text('The table, such as f2.', 12), date: column('Payment date column.'), amount: column('Amount paid column.'), skipRows: SKIP },
    },
    filedOn: text(`The date the return was or will be filed, written YYYY-MM-DD. ${LEAVE_OUT}`, 10, false),
  },
  async run(env, input) {
    return noRetry(() => askingClient(env, 'tax.interest', input, async () => {
      requireRupees(env);
      // Ink v2 4J16 (CA8): with no filing date the calculator answers NEEDS_FACTS (interest.ts).
      const filedOn = input.filedOn === undefined ? undefined as unknown as string : dateInput(input.filedOn, 'filedOn');
      const match = /^w(\d{1,2})$/.exec(input.taxFrom);
      const from = match ? env.receipts[parseInt(match[1], 10) - 1] : undefined;
      if (!from) fail(`There is no receipt ${JSON.stringify(input.taxFrom)}. The receipts are: ${env.receipts.map((_, index) => `w${index + 1}`).join(', ') || 'none'}.`);
      if (from!.ca?.engine !== 'income-tax') fail(`${input.taxFrom} is not an income tax receipt. Work the income tax with tax.income first, then name its receipt.`);
      const taxInputs = from!.ca!.inputs as unknown as IncomeTaxInput;
      if (taxInputs.assessmentYear !== input.assessmentYear) fail(`${input.taxFrom} is for the assessment year ${taxInputs.assessmentYear}, not ${input.assessmentYear}.`);
      const liability = from!.figures.find(item => item.key === 'tax-liability');
      if (!liability) fail(`${input.taxFrom} has no tax liability figure.`);
      const log = newLog();
      log.sources.push({ id: from!.id, name: `income tax receipt ${input.taxFrom}`, digest: from!.digest });
      log.columns.taxFrom = `${input.taxFrom}.tax-liability`;
      const advanceTax = input.advanceTax ? advancePayments(env, input.advanceTax, input.assessmentYear, log) : [];
      // Tax deducted and collected, presumptive income and the senior citizen's exemption are facts of the same case:
      // they come from the income tax receipt's own inputs, never typed again.
      const senior = taxInputs.residency === 'resident' && taxInputs.ageBand !== 'below-60';
      const business = taxInputs.presumptive !== undefined || taxInputs.businessIncomeMinor !== undefined;
      const engineInput: InterestInput = {
        assessmentYear: input.assessmentYear, taxOnTotalIncomeMinor: liability!.minor,
        ...(taxInputs.prepaid?.tdsMinor !== undefined ? { tdsMinor: taxInputs.prepaid.tdsMinor } : {}),
        ...(taxInputs.prepaid?.tcsMinor !== undefined ? { tcsMinor: taxInputs.prepaid.tcsMinor } : {}),
        advanceTax, filedOn,
        ...(taxInputs.presumptive !== undefined ? { presumptive: true } : {}),
        // Business income moves the due date where the table says so (31 August from the tax year 2026-27, Ink v2 2A2).
        ...(business ? { business: true } : {}),
        ...(senior && !business ? { advanceTaxExempt: true } : {}),
      };
      const receipt = computeInterest234(engineInput, rateUseOf(env));
      return caAnswer(env, receipt, engineInput, log, { lateMonths: receipt.working.months234a, shortMonths: receipt.working.months234b });
    }));
  },
};

const GST: Spec = {
  name: 'tax.gst', effect: 'compute', tier: 'code', endsTurn: false,
  summary: 'The calculator works the GST working for one GSTIN and one month (output tax by rate and head, GSTR-1 sections, HSN summary, credit found in GSTR-2B, cash to pay) from a sales register, and a purchase register if there is one, mapped column by column. Lines it cannot count are listed with the reason.',
  input: {
    gstin: text("The business's own GSTIN, as on its registration. Leave it out to use the GSTIN on the client's record.", 15, false),
    period: text(`The month, written YYYY-MM. ${LEAVE_OUT}`, 7, false),
    outward: { type: 'object', required: true, about: 'The sales register, column by column.', fields: REGISTER_FIELDS },
    inward: {
      type: 'object', required: false, about: 'The purchase register, column by column, for the credit. Leave it out when there is none.',
      fields: {
        ...REGISTER_FIELDS,
        in2B: column('Column marking the lines found in GSTR-2B (yes or no). Without it no credit is counted.', false),
        eligible: column('Column marking credit that is not allowed (no) or allowed (yes), if there is one.', false),
      },
    },
  },
  async run(env, input) {
    return noRetry(() => askingClient(env, 'tax.gst', input, async () => {
      requireRupees(env);
      // Ink v2 4J16 (CA8): with no month, or no GSTIN given and none on the client's record, the engine asks the client,
      // after any line it does not model is refused (NOT_MODELLED comes first: that part is the CA's).
      const named = absent(input.gstin) ? clientGstin(env) : input.gstin;
      const period = absent(input.period) ? '' : input.period.trim();
      if (period && !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(period)) fail(`input.period is a month written like 2026-10, not ${JSON.stringify(period.slice(0, 20))}.`);
      const gstin = absent(named) ? '' : await workingGstin(env, named!);
      const log = newLog();
      const outward = gstLines(env, input.outward as RegisterMap, 'outward', log);
      const inward = input.inward ? gstLines(env, input.inward as RegisterMap, 'inward', log) : [];
      const engineInput: GstWorkingInput = { gstin, period, outward, inward };
      const receipt = gstWorking(engineInput, rateUseOf(env));
      const working: GstWorking = receipt.working;
      // Lines and heads by name only: every amount the draft may cite is a figure on the receipt.
      log.notCounted.push(...working.exceptions.map(item => ({ line: item.lineId, reason: item.reason })));
      return caAnswer(env, receipt, engineInput, log, {
        creditHeld: working.held.map(item => ({ line: item.lineId, reason: item.reason })),
        chargedDiffers: working.differences.map(item => ({ line: item.lineId, invoice: item.invoiceNo, head: item.head.toUpperCase() })),
      });
    }));
  },
};

const TDS: Spec = {
  name: 'tax.tds', effect: 'compute', tier: 'code', endsTurn: false,
  summary: "The calculator works the TDS working for one financial year from a payments table mapped column by column: thresholds, the rate with or without a PAN, the catch-up on earlier bills, and the challans with their due dates. Section cells are the working's codes: 194A, 194C, 194H, 194I-building, 194I-plant, 194J-professional, 194J-technical or 194T. A row that says only 194J or 194I, or is dated outside the year, is listed as not counted; ask the owner which it is.",
  input: {
    financialYear: yearChoice(FINANCIAL_YEARS, 'The financial year, such as 2026-27.'),
    payments: {
      type: 'object', required: true, about: 'The payments table, column by column.',
      fields: {
        table: text('The table, such as f1.', 12), payeeName: column("Payee's name column."), pan: column("Payee's PAN column, if there is one.", false),
        // 4J16 (CA8): with no such column, or an empty cell, the calculator asks the client (NEEDS_FACTS), never guesses.
        payeeKind: column('Kind of payee column: individual, huf, company, firm or other. Leave it out when the table has none.', false), section: column('TDS section column.'),
        date: column('Payment or credit date column.'), amount: column('Amount paid column.'), skipRows: SKIP,
      },
    },
  },
  async run(env, input) {
    return noRetry(() => askingClient(env, 'tax.tds', input, async () => {
      requireRupees(env);
      const log = newLog();
      const engineInput: TdsWorkingInput = { financialYear: input.financialYear, payments: tdsPayments(env, input.payments, input.financialYear, log) };
      const receipt = tdsWorking(engineInput, rateUseOf(env));
      const working: TdsWorking = receipt.working;
      return caAnswer(env, receipt, engineInput, log, {
        payments: working.payments.map(row => ({ id: row.id, payee: row.payee, section: row.section, rate: bpsText(row.rateBps), deductOn: row.deductOn, note: row.note })),
        challans: working.challans.map(item => ({ section: item.section, month: item.month, depositDue: item.depositDue })),
        findings: working.findings,
      });
    }));
  },
};

export const CA_TOOLS: Readonly<Record<CaToolName, Spec>> = Object.freeze({ 'tax.income': INCOME, 'tax.interest': INTEREST, 'tax.gst': GST, 'tax.tds': TDS });

/**
 * Ink v2 wave 5: package 5-0's stubs for the CA firm's tools wave 5 builds, each answering NOT_BUILT_YET. A package moves its
 * tool into the table above (and its name into that table's type) and deletes its stub line here
 * (delivery/harness/tools-playbooks.ts spreads this table).
 */
type CaW5ToolName = Extract<ToolName, 'tax.citations' | 'tax.formChooser' | 'tax.advance' | 'tax.whatIf' | 'books.healthCheck' | 'docs.entry'>;
export const CA_W5_TOOLS: Readonly<Record<CaW5ToolName, Spec>> = Object.freeze({
  'tax.citations': CITATIONS,
  'tax.formChooser': FORM_CHOOSER,
  'tax.advance': ADVANCE,
  'tax.whatIf': WHAT_IF,
  'books.healthCheck': HEALTH_CHECK,
  'docs.entry': DOC_ENTRY,
});
