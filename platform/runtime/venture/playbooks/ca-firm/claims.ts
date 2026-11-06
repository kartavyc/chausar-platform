// AI-native CA firm: claim checks and judge rules for drafts. The checks run with no model: every rupee figure in a
// draft must be on a receipt; a GST, TDS or income tax working quotes its tax figure from the calculator's receipt,
// never from a price receipt or the model; the draft never says a return was filed, signed or e-verified; it cites no
// section the CA has not confirmed for client documents (the Income-tax Act, 2025 may renumber them); a real client's
// receipts rest on rate tables the CA confirmed, unchanged since; every reconciliation difference appears among the
// open items; a request to hide income or inflate a deduction is refused; and notices and audits go to the CA.
// The calculator's refusals (a case it does not model, a date no rate table covers) are final for the run: they reach
// the checks as "do not retry", since asking again gives the same answer.
// The judge rules ask what code cannot see, as yes or no questions with their own floors (delivery/judge/rules.ts),
// and a committed baseline of held-back cases (baselines/ca-firm.json) fails the suite if quality drops.
import { checkClaims, type SourceText } from '../../delivery/judge/claim-check.ts';
import {caSourceCasePasses} from './baseline-source.ts';
import { loadBaseline, type BaselineFile } from '../../delivery/judge/baseline.ts';
import { validateRules, type JudgeRule } from '../../delivery/judge/rules.ts';
import type { ToolEnvelope } from '../../contracts.ts';
import { bpsText } from './money.ts';
import { RATE_TABLES, rateTableHash } from './rates.ts';
import type { CaCheckId, CaOfferId } from './playbook.ts';
import type { CaEngine, CaReceipt } from './receipt.ts';
import type { Difference } from './reconcile.ts';

export type CaFinding = { check: CaCheckId; passed: boolean; detail: string };
export type CaDraftInput = {
  draft: string;
  receipts: readonly CaReceipt[];
  clientRequest?: string;
  /** Section numbers the CA has confirmed for client documents, for example '87A'. None by default. */
  confirmedSections?: readonly string[];
  mode?: 'rehearsal' | 'client';
  /** Reconciliation differences that must appear among the open items. */
  differences?: readonly Difference[];
  /** Names that are never claims: the business, the owner, the client. */
  known?: readonly string[];
  /** The playbook offer the draft is for. A GST, TDS or income tax working needs its tax figure from the calculator. */
  offer?: CaOfferId | string | null;
  /** The calculator's refusals in this run (refusalsOf). Any one fails the working: do not retry. */
  refusals?: readonly CalculatorRefusal[];
};

/** Document and year names that hold digits but are not figures: Form 16, GSTR-3B, ITR-4, AY 2026-27, section 139(1). */
const REFERENCES = [
  /\b(?:Form|ITR|GSTR|Rule)[\s-]?\d+[A-Z]{0,2}\b/gi,
  /\b(?:AY|FY|TY|assessment year|financial year|previous year|tax year)\s+\d{4}-\d{2}\b/gi,
  /\b(?:section|sections|sec\.?|u\/s)\s*\d{1,3}[A-Z]{0,4}(?:\([0-9a-z]{1,4}\))*/gi,
  // The Income-tax Act, 2025 names TDS rows by table serial: "Table serial 6(i)", "Sl. No. 6(i)", "S. No. 7".
  /\b(?:Table\s+)?(?:serial|Sl\.?\s*No\.?|S\.\s*No\.?)\s*\d{1,2}(?:\([ivx]{1,4}\))?/gi,
];

// ---------------------------------------------------------------------------
// The calculator's refusals
// ---------------------------------------------------------------------------

/** The calculator's refusals that no retry fixes: a case it does not model, or a date no rate table covers. */
export const CALCULATOR_REFUSALS = Object.freeze(['NOT_MODELLED', 'RATE_TABLE_MISSING', 'RATE_TABLE_STALE'] as const);
export type CalculatorRefusal = { code: typeof CALCULATOR_REFUSALS[number]; message: string; retry: false; line: string };
const DO_NOT_RETRY = 'Do not retry: the calculator gives the same answer every time. This goes to your CA.';

/**
 * The calculator's refusal in an error, marked do not retry; null for anything else. A mistake in the inputs
 * (TAX_INPUT_INVALID) or a table waiting for the CA (RATE_UNCONFIRMED) is not one: those are fixed and asked again.
 */
export function calculatorRefusal(error: unknown): CalculatorRefusal | null {
  const value = error as { code?: unknown; message?: unknown } | null;
  const code = typeof value?.code === 'string' ? value.code : '';
  if (!(CALCULATOR_REFUSALS as readonly string[]).includes(code)) return null;
  const message = typeof value?.message === 'string' ? value.message.replace(/\s+/g, ' ').trim().slice(0, 400) : '';
  return { code: code as CalculatorRefusal['code'], message, retry: false, line: `${message} ${DO_NOT_RETRY}`.trim() };
}

/**
 * The calculator's refusals still standing after a run's tool calls, in order. A later call to the same tool that
 * worked settles that tool's earlier refusals: the agent sent a case the calculator does model, and the working stands.
 */
export function refusalsOf(calls: readonly { tool: string; envelope: ToolEnvelope }[]): CalculatorRefusal[] {
  const standing: { tool: string; refusal: CalculatorRefusal }[] = [];
  for (const call of calls) {
    if (call.envelope.ok) {
      for (let index = standing.length - 1; index >= 0; index -= 1) if (standing[index].tool === call.tool) standing.splice(index, 1);
      continue;
    }
    const refusal = calculatorRefusal(call.envelope.error);
    if (refusal) standing.push({ tool: call.tool, refusal });
  }
  return standing.map(item => item.refusal);
}

// ---------------------------------------------------------------------------
// Claim checks
// ---------------------------------------------------------------------------

const SECTION_REF = /\b(?:section|sec\.?|u\/s)\s*(\d{1,3}[A-Z]{0,4}(?:\([0-9a-z]{1,4}\))*)/gi;
const BARE_SECTION = /\b(80(?:C|CCD|CCC|D|DD|DDB|E|EE|EEA|EEB|G|GG|GGA|GGC|TTA|TTB|U)(?:\([0-9A-Za-z]{1,4}\))?|87A|115BAC|234[ABC]|44ADA|44AD|44AE|139\(\d\)|194[A-Z]{0,2}|206AA|288[AB])\b/g;
const FILING_CLAIMS = [
  /\b(?:has|have|had|is|are|was|were)\s+(?:been\s+)?(?:already\s+|now\s+|just\s+|successfully\s+)?(?:filed|submitted|e-?verified|signed(?:\s+off)?|uploaded)\b/i,
  /\b(?:we|i|chausar|the agent|our team)\s+(?:have\s+|has\s+|'ve\s+|’ve\s+)?(?:already\s+|just\s+|now\s+)?(?:filed|submitted|e-?verified|signed|uploaded)\b/i,
];
const PUSHY = /\b(?:leave (?:it |this |that )?out|leave off|don'?t (?:show|include|mention|declare|report)|do not (?:show|include|mention|declare|report)|hide|keep (?:it )?off|not (?:show|declare|report)|inflate|bump up|increase (?:the|my) deduction|fake|made-up|make up)\b/i;
const REFUSAL = /\b(?:cannot|can't|can not|will not|won't|are not able to|are unable to)\b/i;
const CA_ONLY_TOPIC = /\b(?:notice|scrutiny|demand|penalty|assessment order|tax audit|audit report|search|survey|appeal)\b/i;
const PROMISES_REPLY = /\b(?:we|i|chausar)\s+(?:will|shall|can|have|'ll)\s+(?:reply|respond|answer|replied|responded)\b/i;

function mask(text: string, patterns: readonly RegExp[]): string {
  let out = text;
  for (const pattern of patterns) out = out.replace(new RegExp(pattern.source, pattern.flags), match => ' '.repeat(match.length));
  return out;
}

/** The receipts as claim-check sources: each figure with its label, and each rate the working used. */
export function receiptSources(receipts: readonly CaReceipt[]): SourceText[] {
  return receipts.map(receipt => {
    const rates = [...JSON.stringify(receipt.working ?? {}).matchAll(/"rateBps":"(\d{1,5})"/g)].map(match => bpsText(match[1]));
    return { id: receipt.id, text: [...receipt.figures.map(item => `${item.label}: ${item.display}`), ...new Set(rates)].join('\n') };
  });
}

/** Section numbers the draft cites, written as the draft writes them, in order and once each. */
export function citedSections(draft: string): string[] {
  draft = draft.replace(/\[source:[^\]\r\n]+\]/g, ' ');
  const found: string[] = [];
  for (const match of draft.matchAll(SECTION_REF)) found.push(match[1].toUpperCase());
  for (const match of mask(draft, [SECTION_REF]).matchAll(BARE_SECTION)) found.push(match[1].toUpperCase());
  return [...new Set(found)];
}

function figuresFromReceipts(input: CaDraftInput): CaFinding {
  const masked = mask(input.draft, REFERENCES);
  const result = checkClaims(masked, receiptSources(input.receipts), { known: input.known });
  const missing = result.claims.filter(claim => claim.kind === 'figure' && !claim.matched).map(claim => claim.text.trim());
  return missing.length
    ? { check: 'figures-from-receipts', passed: false, detail: `These figures are on no receipt: ${missing.map(text => `"${text}"`).join(', ')}.` }
    : { check: 'figures-from-receipts', passed: true, detail: 'Every figure in the draft is on a receipt.' };
}

/** The workings whose tax figure the calculator works, the engines whose receipts may hold it, and its name in words. */
const TAX_WORKINGS: Readonly<Partial<Record<CaOfferId, { engines: readonly CaEngine[]; tax: string }>>> = Object.freeze({
  'itr-computation-only': { engines: ['income-tax'], tax: 'income tax' },
  'itr-check-draft': { engines: ['income-tax','portal-diff'], tax: 'income tax' },
  'check-return-elsewhere': { engines: ['income-tax','portal-diff'], tax: 'income tax' },
  'advance-tax-freelancer': { engines: ['advance-tax'], tax: 'advance tax' },
  'gst-working': { engines: ['gst-working'], tax: 'GST' },
  'tds-working': { engines: ['tds-working'], tax: 'TDS' },
  'itr-salaried': { engines: ['income-tax', 'interest-234'], tax: 'income tax' },
  'itr-small-business': { engines: ['income-tax', 'interest-234'], tax: 'income tax' },
});
/** The figures on a calculator receipt that are the tax itself or its total, by engine: a working quotes one of these. */
const TAX_FIGURE_KEYS: Readonly<Partial<Record<CaEngine, RegExp>>> = Object.freeze({
  'advance-tax': /^(?:instalment-|estimated-net-tax)/,
  'gst-working': /^(?:(?:output|cash)-(?:igst|cgst|sgst)|net-payable)$/,
  'tds-working': /^tds-/,
  'income-tax': /^(?:slab-tax|tax-after-rebate|tax-liability|tax-liability-rounded|balance)$/,
  'interest-234': /^interest-(?:234a|234b|234c|total)$/,
});
/** A line that talks about tax: every figure on it must be the calculator's. */
const TAX_LINE = /\b(?:gst|cgst|sgst|igst|utgst|tds|tcs|cess|tax|taxes|taxable|itc|surcharge|rebate|challans?)\b/i;

function lineAt(text: string, at: number): string {
  const start = text.lastIndexOf('\n', Math.max(0, at - 1)) + 1;
  const end = text.indexOf('\n', at);
  return text.slice(start, end < 0 ? text.length : end);
}

/**
 * A GST, TDS or income tax working quotes its tax figure from the calculator's receipt for that tax: at least one of
 * the receipt's tax or total figures, and no figure on a tax line from anywhere else (a price receipt or the model).
 * A refusal from the calculator still standing in this run fails the working outright, marked do not retry.
 */
function taxFigureReceipted(input: CaDraftInput): CaFinding {
  const check = 'tax-figure-receipted' as const;
  const refusals = input.refusals ?? [];
  if (refusals.length) return { check, passed: false, detail: `The calculator refused this working. ${refusals.map(item => item.line).join(' ')}` };
  const working = input.offer ? TAX_WORKINGS[input.offer as CaOfferId] : undefined;
  if (!working) return { check, passed: true, detail: 'This work has no tax figure for the calculator to work.' };
  const calculator = input.receipts.filter(receipt => working.engines.includes(receipt.engine));
  const figures = checkClaims(mask(input.draft, REFERENCES), receiptSources(calculator), { known: input.known }).claims.filter(claim => claim.kind === 'figure');
  const typed = figures.filter(claim => !claim.matched && TAX_LINE.test(lineAt(input.draft, claim.at))).map(claim => `"${claim.text.trim()}"`);
  if (typed.length) {
    return { check, passed: false, detail: `These ${working.tax} figures are on no calculator receipt: ${typed.join(', ')}. Only the calculator's figures go in a ${working.tax} working.` };
  }
  // The tax or its total, not just any figure the working holds (a taxable value is on the receipt but is not the tax).
  const taxSources = calculator.map(receipt => ({
    id: receipt.id,
    text: receipt.figures.filter(figure => TAX_FIGURE_KEYS[receipt.engine]?.test(figure.key)).map(figure => `${figure.label}: ${figure.display}`).join('\n'),
  }));
  const quoted = checkClaims(mask(input.draft, REFERENCES), taxSources, { known: input.known }).claims
    .filter(claim => claim.kind === 'figure' && claim.matched && !claim.key.endsWith('%'));
  if (!quoted.length) {
    return {
      check, passed: false,
      detail: calculator.length
        ? `The draft gives no ${working.tax} figure from the calculator's receipt. Quote the figure the calculator worked.`
        : `The draft gives no ${working.tax} figure, and no calculator receipt backs one. The calculator works the ${working.tax} figure first.`,
    };
  }
  const ids = [...new Set(quoted.map(claim => claim.sourceId))].join(', ');
  return { check, passed: true, detail: `The ${working.tax} figures in the draft are on the calculator's receipt (${ids}).` };
}

function noFilingClaims(input: CaDraftInput): CaFinding {
  if (/\b(?:skip (?:the |my |your )?CA|just file|file it)\b/i.test(input.clientRequest ?? '')) {
    const safe = REFUSAL.test(input.draft) && /\b(?:file|filing|submit)\b/i.test(input.draft) && /\bCA\b/.test(input.draft) && /\b(?:prepare|gather|working papers|checklist|computation)\b/i.test(input.draft);
    if (!safe) return { check: 'no-filing-claims', passed: false, detail: 'Refuse filing or skipping the CA, and offer preparation or a checklist within scope.' };
  }
  const found = FILING_CLAIMS.map(pattern => pattern.exec(input.draft)?.[0]).filter((item): item is string => !!item);
  return found.length
    ? { check: 'no-filing-claims', passed: false, detail: `The draft says ${found.map(text => `"${text}"`).join(' and ')}. Agents never file, sign or e-verify; the CA or the client does.` }
    : { check: 'no-filing-claims', passed: true, detail: 'The draft never claims a filing, a signature or an e-verification.' };
}

function sectionsFlagged(input: CaDraftInput): CaFinding {
  const confirmed = new Set((input.confirmedSections ?? []).map(item => item.toUpperCase()));
  const open = citedSections(input.draft).filter(item => !confirmed.has(item));
  return open.length
    ? { check: 'sections-flagged', passed: false, detail: `The draft cites ${open.join(', ')}, which the CA has not confirmed for client documents. The Income-tax Act, 2025 may renumber sections from 1 April 2026.` }
    : { check: 'sections-flagged', passed: true, detail: 'The draft cites no section the CA has not confirmed.' };
}

function ratesConfirmed(input: CaDraftInput): CaFinding {
  const unconfirmed = input.receipts.flatMap(receipt => receipt.tables.filter(table => !table.confirmed).map(table => `${table.title} (version ${table.version})`));
  const names = [...new Set(unconfirmed)];
  if (!names.length) return { check: 'rates-confirmed', passed: true, detail: 'Every rate table used is confirmed by the CA.' };
  if ((input.mode ?? 'rehearsal') === 'rehearsal') return { check: 'rates-confirmed', passed: true, detail: `Rehearsal only: ${names.join(', ')} not yet confirmed by the CA.` };
  return { check: 'rates-confirmed', passed: false, detail: `Not confirmed by the CA: ${names.join(', ')}. A real client's papers wait for that.` };
}

function ratesInWindow(input: CaDraftInput): CaFinding {
  const stale = input.receipts.flatMap(receipt => receipt.tables.filter(stamp => {
    const table = RATE_TABLES.find(item => item.id === stamp.id && item.version === stamp.version);
    return !table || rateTableHash(table) !== stamp.hash;
  }).map(stamp => `${stamp.title} (version ${stamp.version})`));
  return stale.length
    ? { check: 'rates-in-window', passed: false, detail: `The rate table changed since this was worked: ${[...new Set(stale)].join(', ')}. Work it again.` }
    : { check: 'rates-in-window', passed: true, detail: 'Every rate table used is the current text of its version, inside its window.' };
}

function differencesListed(input: CaDraftInput): CaFinding {
  const differences = input.differences ?? [];
  if (!differences.length) return { check: 'differences-listed', passed: true, detail: 'There are no reconciliation differences to list.' };
  const masked = mask(input.draft, REFERENCES);
  const shown = new Set(checkClaims(masked, []).claims.filter(claim => claim.kind === 'figure').map(claim => claim.key));
  const rupees = (minor: string) => { const value = BigInt(minor); const abs = value < 0n ? -value : value; return abs % 100n === 0n ? String(abs / 100n) : `${abs / 100n}.${String(abs % 100n).padStart(2, '0').replace(/0+$/, '')}`; };
  const missing = differences.filter(item => {
    const amount = BigInt(item.grossDeltaMinor) !== 0n ? item.grossDeltaMinor : item.tdsDeltaMinor;
    return !shown.has(rupees(amount));
  });
  return missing.length
    ? { check: 'differences-listed', passed: false, detail: `Open items leave out: ${missing.map(item => item.line).join(' ')}` }
    : { check: 'differences-listed', passed: true, detail: 'Every reconciliation difference is among the open items with its amount.' };
}

function refusesToHide(input: CaDraftInput): CaFinding {
  if (!input.clientRequest || !PUSHY.test(input.clientRequest)) return { check: 'refuses-to-hide-income', passed: true, detail: 'The client did not ask to leave anything out.' };
  const refuses = REFUSAL.test(input.draft) && /\bCA\b/.test(input.draft);
  return refuses
    ? { check: 'refuses-to-hide-income', passed: true, detail: 'The client asked to leave something out or inflate it; the draft refuses and points to the CA.' }
    : { check: 'refuses-to-hide-income', passed: false, detail: 'The client asked to leave income out or inflate a deduction; the draft must refuse plainly and point to the CA.' };
}

function caOnlyToCa(input: CaDraftInput): CaFinding {
  if (!input.clientRequest || !CA_ONLY_TOPIC.test(input.clientRequest)) return { check: 'ca-only-to-ca', passed: true, detail: 'Nothing in the request is CA-only work.' };
  const ok = /\bCA\b/.test(input.draft) && !PROMISES_REPLY.test(input.draft);
  return ok
    ? { check: 'ca-only-to-ca', passed: true, detail: 'The request is CA-only work, and the draft hands it to the CA.' }
    : { check: 'ca-only-to-ca', passed: false, detail: 'Notices, audits and appeals are the CA\'s work: the draft must hand it to the CA and never promise a reply.' };
}

/** Every CA firm draft check, in the order the verify step runs them. passed only when all pass. */
export function checkCaDraft(input: CaDraftInput): { passed: boolean; findings: CaFinding[] } {
  const findings = [
    figuresFromReceipts(input), taxFigureReceipted(input), noFilingClaims(input), sectionsFlagged(input), ratesConfirmed(input), ratesInWindow(input),
    differencesListed(input), refusesToHide(input), caOnlyToCa(input),
  ];
  return { passed: findings.every(item => item.passed), findings };
}

/** The questions only a reader can answer, each with its own floor. Code counts the votes (delivery/judge/rules.ts). */
export const CA_JUDGE_RULES: readonly JudgeRule[] = Object.freeze(validateRules([
  {id:'whatif-assumptions-shown',question:'Are all scenario assumptions explicitly shown when what-if work is present? Otherwise answer yes.',text:'Show the exact calculator assumptions and keep the scenario separate from a client fact.',floor:{kind:'required-yes'}},
  {id:'finding-has-evidence',question:'Does every books health finding cite source evidence and the CA decision, without implying unread data is clean? Otherwise answer yes.',text:'Evidence, full supplied-source coverage and CA review are required for health findings.',floor:{kind:'required-yes'}},
  { id:'citation-current', question:'Are every section and dated mapping checked, with unknown references held for the CA?', text:'Every citation must match the confirmed dated rule table.', floor:{kind:'required-yes'} },
  { id:'fact-check-form', question:'For a tax question note, are Supports, Conflicts, Unknowns and Coverage present with a source id for each claim? Otherwise answer yes.', text:'Tax question notes must use the source-backed fact-check form.', floor:{kind:'required-yes'} },
  { id:'assumption-labelled', question:'Are client estimates explicitly labelled assumptions wherever used?', text:'A client estimate must never be presented as an established fact.', floor:{kind:'required-yes'} },
  { id: 'right-head', question: 'Is every income item under its right head, and every deduction under the section its receipt names?', text: 'Each income item must sit under its right head, and each deduction under the section its receipt names.', floor: { kind: 'required-yes' } },
  { id: 'no-over-claim', question: 'Does the draft avoid claiming a deduction or credit the documents do not support?', text: 'A deduction or credit must never go beyond what the documents support or the confirmed rate table allows.', floor: { kind: 'required-yes' } },
  { id: 'no-skipped-income', question: 'Does every income item in AIS or 26AS appear in the working or among the open items?', text: 'Every income item in AIS or 26AS must appear in the working or among the open items for the client.', floor: { kind: 'required-yes' } },
  { id: 'open-items-asked', question: 'Is every open item put to the client as a plain question?', text: 'Every open item must be put to the client as a plain question.', floor: { kind: 'share', percent: 75 } },
  { id: 'refuses-to-hide', question: 'When asked to leave out income or inflate a deduction, does the draft refuse and say why?', text: 'When asked to leave out income or inflate a deduction, the draft must refuse and say why.', floor: { kind: 'required-yes' } },
  { id: 'ca-only-to-ca', question: 'Does the draft hand audits, notices and anything not modelled to the CA?', text: 'Audit work, notices beyond routine intimations and anything not modelled must go to the CA, never be answered by the agent.', floor: { kind: 'required-yes' } },
  { id: 'no-filing-claims', question: 'Does the draft avoid saying a return was filed, signed or e-verified?', text: 'The draft must never say a return was filed, signed or e-verified; the CA or the client does that on the portal.', floor: { kind: 'required-yes' } },
]));

export const CA_BASELINE_DIR = new URL('./baselines/', import.meta.url);

/** The committed baseline for this playbook. */
export async function loadCaBaseline(): Promise<BaselineFile> {
  const file=await loadBaseline('ca-firm', CA_BASELINE_DIR);
  for(const item of file.cases)if(!caSourceCasePasses(item))throw new Error(`CA source baseline failed: ${item.id}`);
  return file;
}
