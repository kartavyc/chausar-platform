// Chausar venture launcher, delivery package (P5): deterministic checks on a draft reply.
// Code checks run before any judge. Each returns a plain sentence the owner can read.
// Two checks come from the judge package (judge/): claims-grounded matches every figure, date, name and certification
// in the draft's own words against the run's sources with no model, and rules-judge turns the rules judge's votes,
// counted by code, into a result. The judge is asked only behind the code checks (judgeDraftRules in rehearsal). On a
// real order its call carries the client's words, so it goes through the action journal with the owner's approval or
// the business's standing consent (judge-run.ts), never from here.
// preferDraft is the pairwise comparison the improvement gate uses when two versions tie on every score.
// The receipts check (judge/claim-check.ts checkReceipts) runs on every draft: a number with no receipt is labelled a
// model estimate (or fails, where the playbook allows none: estimateRule), a file or link must be in the run's
// evidence, and a figure the calculator refutes fails; correctDraft puts the calculator's figure in its place first,
// and summaryReceipts does the same for a run summary.
import { assertNoMoney, doneClaimMatches, houseStyleFindings, modelNumbers } from '../records.ts';
import { REQUIRED_SECTIONS } from '../contracts.ts';
import type {
  CheckId, CheckResult, ClaimProof, DateOrder, Deliverable, GatePreference, HarnessState, MockEffect, ServiceType, TextPart, WorkReceiptRecord,
} from '../contracts.ts';
import { CA_FIRM_ID } from '../playbooks/ca-firm/registration.ts';
import { promptLeakLine, promptLeaks } from '../playbooks/prompt-leak.ts';
import { draftWords, modelWordsOf, type AnyReceipt, type DraftTimes } from './deliverable.ts';
import { claimBacked } from './harness/claims.ts';
import type { FileLike } from './harness/files.ts';
import {
  checkClaims, checkReceipts, deliverableWords, receiptsVerdict, sourcesFromFiles, sourcesFromRun,
  prepareEvidence, type CalculatorFigure, type DraftNumber, type DraftReference, type EstimateMode, type EvidenceFile, type EvidenceLink,
  type PreparedEvidence, type ReceiptCorrection, type ReceiptOptions, type ReceiptsCheck, type SourceText,
} from './judge/claim-check.ts';
import { comparePair, type PairAsk } from './judge/pairwise.ts';
import { DRAFT_RULES, judgeByRules, notRuled, type JudgeRule, type RulesAsk, type RulesInput, type RulesVerdict } from './judge/rules.ts';
import { traceFromHarness } from './judge/trace.ts';
import { errorCode, quote } from './shared.ts';

export const MIN_DRAFT_CHARS = 40;
export const MAX_DRAFT_CHARS = 12000;

export type CheckInput = {
  checks: readonly CheckId[];
  deliverable: Deliverable;
  renderedText: string;
  serviceType: ServiceType;
  /** Tokens with a letter and a digit copied from the client's message and the idea (copiedTokens). */
  allowed: readonly string[];
  /** Every price receipt of this venture, and the work receipts of this run. */
  receipts: readonly AnyReceipt[];
  ventureId: string;
  /** Outside effects of the episode, and the mock mode each connector operation was given. */
  mocks: readonly MockEffect[];
  mockModes: Readonly<Record<string, 'record-only'>>;
  agentTurns: number;
  turnLimit: number;
  /** True when at least one agent draft in the episode asked the client a question. */
  askedQuestions: boolean;
  /** The headings the draft needed: the service type's reply headings unless the run reported proven work. */
  sections?: readonly string[];
  /** What tool runs proved. A done claim passes only when a proof of its kind exists; none means the client's message only. */
  proofs?: readonly ClaimProof[];
  /** What claims-grounded matches the draft's own words against, beside this business's receipts. Absent: the receipts alone. */
  grounding?: Grounding;
  /** The rules judge's verdict on this draft (judgeDraftRules). Absent: no judge ruled, so rules-judge is left out, never passed. */
  rules?: RulesVerdict | null;
  /** 'forbid': money, a rate or tax with no receipt fails receipts (estimateRule). Absent: the flagship's rule, else 'label'. */
  estimates?: EstimateMode;
  /**
   * The flagship playbook of the draft's playbook (PlaybookRecord.flagship), or null. Its own checks lint the draft for
   * prompt leaks (playbooks/draft-checks.ts), so prompt-leak is left out here; it also picks estimates when absent.
   */
  flagship?: string | null;
  /** Figures the calculator put in place of refuted numbers before these checks (correctDraft); receipts notes each one. */
  corrections?: readonly ReceiptCorrection[];
  /** The chapter time codes code worked out in the run and their heading (youtube.chapters); no-numeric-prose leaves them out. */
  times?: DraftTimes | null;
};

/** The sources of a draft's claims. Each field left out adds nothing. */
export type Grounding = {
  clientRequest: string;
  /** Answers to the agent's questions, from the owner or the practice client. */
  answers?: readonly string[];
  /** The agent loop: every tool result that succeeded is a source. */
  harness?: HarnessState | null;
  /** The client's spreadsheet files, whole, even rows the agent never read. */
  files?: readonly FileLike[];
  /** Engine-verified generated artifact identities. Never supplied by model prose. */
  outputFiles?: readonly EvidenceFile[];
  /** Names that are never claims: the business, its offers, the client. */
  known?: readonly string[];
  dateOrder?: DateOrder;
  /** The owner's own words that may hold the business's links (the idea, the client's record, the plan): a link there is held. */
  ownerWords?: readonly string[];
};

/** Chausar's own name is never a claim a draft has to back. */
const ALWAYS_KNOWN = ['Chausar'];
/** Model errors that say how the judge answered; they leave the rules unsettled instead of stopping the run. */
const JUDGE_BEHAVIOUR = new Set(['MODEL_OUTPUT_REJECTED', 'MODEL_REFUSAL', 'MODEL_INCOMPLETE']);

/** The names a draft may use without a source: the business, its plan's name, its offers and the client. */
export function knownNames(...names: (string | null | undefined)[]): string[] {
  return [...new Set(names.map(name => (name ?? '').trim()).filter(name => name.length >= 2))];
}

const wordPieces = draftWords;

/**
 * Model numbers pass as model estimates (no receipt); an amount of money in the words fails, because a price, tax or
 * invoice figure comes only from a receipt. A chapter time code the run worked out, at the start of a part under its
 * heading, is code's and not counted (modelWordsOf).
 */
function noNumericProse(input: CheckInput): CheckResult {
  const pieces = modelWordsOf(input.deliverable, input.times);
  for (const piece of pieces) {
    try { assertNoMoney(piece, 'draft', input.allowed); } catch {
      return { check: 'no-numeric-prose', passed: false, detail: `This line states an amount of money the calculator did not make: "${quote(piece)}"` };
    }
  }
  if (pieces.some(piece => modelNumbers(piece, input.allowed))) {
    return { check: 'no-numeric-prose', passed: true, detail: 'Numbers in the words are model estimates with no receipt. Every price comes from a receipt.' };
  }
  return { check: 'no-numeric-prose', passed: true, detail: 'Every number in the draft comes from a receipt.' };
}

function figuresResolve(input: CheckInput): CheckResult {
  let count = 0;
  for (const section of input.deliverable.sections) for (const part of section.parts) {
    if (part.kind !== 'figure') continue;
    count += 1;
    const receipt = input.receipts.find(item => item.id === part.receiptId && item.ventureId === input.ventureId);
    if (!receipt || !receipt.figures.some(figure => figure.key === part.figureKey)) {
      return { check: 'figures-resolve', passed: false, detail: 'A price in the draft does not match any receipt in this business.' };
    }
  }
  return { check: 'figures-resolve', passed: true, detail: count ? 'Every price in the draft opens a receipt.' : 'The draft quotes no price.' };
}

function requiredSections(input: CheckInput): CheckResult {
  const present = new Set(input.deliverable.sections.map(section => section.heading));
  const missing = (input.sections ?? REQUIRED_SECTIONS[input.serviceType]).filter(heading => !present.has(heading));
  return missing.length
    ? { check: 'required-sections', passed: false, detail: `Missing sections: ${missing.join(', ')}.` }
    : { check: 'required-sections', passed: true, detail: 'Every required section is there.' };
}

function noOutsideWrites(input: CheckInput): CheckResult {
  const outside = input.mocks.filter(effect => input.mockModes[`${effect.connector}.${effect.operation}`] !== 'record-only');
  return outside.length
    ? { check: 'no-outside-writes', passed: false, detail: `Something tried to act outside Chausar: ${outside[0].connector}.` }
    : { check: 'no-outside-writes', passed: true, detail: 'Nothing was sent anywhere. In this build every outside effect is only recorded, never carried out.' };
}

function houseStyle(input: CheckInput): CheckResult {
  const findings = houseStyleFindings(input.renderedText);
  if (!findings.length) return { check: 'house-style', passed: true, detail: 'No long dashes and no words on the avoid list.' };
  const first = findings[0];
  return { check: 'house-style', passed: false, detail: first.rule === 'em-dash' ? 'The draft uses a long dash.' : `The draft uses a word on the avoid list: ${first.match}.` };
}

/**
 * Words meant for the AI, not the reader (playbooks/prompt-leak.ts), in every piece the agent wrote: the title, the
 * text and the questions. A flagship playbook's own checks run the same lint on its drafts, so it is left out there.
 */
function promptLeak(input: CheckInput): CheckResult | null {
  if (input.flagship) return null;
  const line = promptLeakLine(draftWords(input.deliverable).flatMap(words => promptLeaks(words)));
  return line ? { check: 'prompt-leak', passed: false, detail: line } : { check: 'prompt-leak', passed: true, detail: 'The draft has no words meant for the AI.' };
}

function lengthBounds(input: CheckInput): CheckResult {
  const size = input.renderedText.length;
  if (size < MIN_DRAFT_CHARS) return { check: 'length-bounds', passed: false, detail: 'The draft is too short to send.' };
  if (size > MAX_DRAFT_CHARS) return { check: 'length-bounds', passed: false, detail: 'The draft is too long to send.' };
  return { check: 'length-bounds', passed: true, detail: 'The draft length is within bounds.' };
}

function turnLimit(input: CheckInput): CheckResult {
  return input.agentTurns <= input.turnLimit
    ? { check: 'turn-limit', passed: true, detail: 'The agent stayed within its turns.' }
    : { check: 'turn-limit', passed: false, detail: 'The agent needed more turns than allowed.' };
}

function questionsRaised(input: CheckInput): CheckResult {
  return input.askedQuestions
    ? { check: 'questions-raised', passed: true, detail: 'The agent asked the client about what was missing.' }
    : { check: 'questions-raised', passed: false, detail: 'The agent never asked the client about what was missing.' };
}

function noDoneClaims(input: CheckInput): CheckResult {
  const proofs = input.proofs ?? [];
  let backed = 0;
  for (const piece of wordPieces(input.deliverable)) {
    for (const claim of doneClaimMatches(piece)) {
      if (!claimBacked(claim, proofs)) return { check: 'no-done-claims', passed: false, detail: `The draft claims work that was not done: "${quote(claim)}"` };
      backed += 1;
    }
  }
  return backed
    ? { check: 'no-done-claims', passed: true, detail: 'Every claim of finished work matches a tool run that proves it.' }
    : { check: 'no-done-claims', passed: true, detail: 'The draft describes work ahead and never claims it is done.' };
}

/**
 * Every figure, date, name and certification in the model's words must be in a source: the client's message and
 * answers, the client's files, the run's tool results, or this business's receipts. Figures code rendered from a
 * receipt are not model words, so they are never claims. No model is asked.
 */
function claimsGrounded(input: CheckInput): CheckResult {
  const grounding = input.grounding;
  const result = checkClaims(deliverableWords(input.deliverable), groundingSources(input.receipts, input.ventureId, grounding), {
    known: [...ALWAYS_KNOWN, ...(grounding?.known ?? [])],
    dateOrder: grounding?.dateOrder === 'month-day-year' ? 'month-day-year' : 'day-month-year',
  });
  return { check: 'claims-grounded', passed: result.passed, detail: result.detail };
}

/** The sources of a draft's claims and numbers: the client's words and files, the tool results and this business's receipts. */
function groundingSources(receipts: readonly AnyReceipt[], ventureId: string, grounding: Partial<Grounding> | undefined): SourceText[] {
  return sourcesFromRun({
    clientRequest: grounding?.clientRequest,
    harness: grounding?.harness ?? null,
    receipts: receipts.filter(receipt => receipt.ventureId === ventureId),
    extra: [
      ...(grounding?.answers ?? []).map((answer, index) => ({ id: `answer.${index + 1}`, text: answer })),
      ...sourcesFromFiles(grounding?.files ?? []),
    ],
  });
}

// ---------------------------------------------------------------------------
// Receipts (catalogue Q3)
// ---------------------------------------------------------------------------

/** Flagship playbooks whose papers carry no model estimate: every number needs a receipt. The CA firm's tax papers do. */
const NO_ESTIMATES: ReadonlySet<string> = new Set([CA_FIRM_ID]);

/** How a playbook treats a number with no receipt: the CA firm forbids it; every other playbook labels it a model estimate. */
export function estimateRule(flagship: string | null | undefined): EstimateMode {
  return flagship && NO_ESTIMATES.has(flagship) ? 'forbid' : 'label';
}

const isWorkReceipt = (receipt: AnyReceipt): receipt is WorkReceiptRecord => receipt.operation.startsWith('work.');

/** The checks every draft runs, whatever its stored playbook says: a playbook stored before them never lists them. */
export const ALWAYS_DRAFT_CHECKS: readonly CheckId[] = ['receipts', 'prompt-leak'];

/** A playbook step's or practice case's checks with the always-on ones added after them. */
export function withDraftChecks(checks: readonly CheckId[]): CheckId[] {
  return [...checks, ...ALWAYS_DRAFT_CHECKS.filter(id => !checks.includes(id))];
}

/**
 * The calculator's figures a number may be compared with: the receipts in cited (the ones a draft's figure parts
 * open) and the run's work receipts; every receipt of this business when cited is null (a run summary, whose caller
 * passes the run's own receipts). Prices of other offers stay out, so "the total" means this order's total.
 */
function calculatorFigures(receipts: readonly AnyReceipt[], cited: ReadonlySet<string> | null): CalculatorFigure[] {
  return receipts.filter(receipt => !cited || cited.has(receipt.id) || isWorkReceipt(receipt)).flatMap(receipt =>
    (receipt.figures as readonly { key: string; label: string; display: string; unit?: string }[]).map(figure => ({
      receiptId: receipt.id, figureKey: figure.key, label: figure.label, display: figure.display, unit: figure.unit === 'count' ? 'count' as const : 'money' as const,
      kind: isWorkReceipt(receipt) ? 'work' as const : 'price' as const,
    })));
}

/** The files a run holds: the client's files and the tables the calculator read for its work receipts. */
function evidenceFiles(receipts: readonly AnyReceipt[], files: readonly FileLike[]): EvidenceFile[] {
  const tables = receipts.flatMap(receipt => isWorkReceipt(receipt) ? receipt.inputs.tables : []);
  return [...files.map(file => ({ id: file.id, name: file.name, digest: file.digest })), ...tables.map(table => ({ id: table.id, name: table.name, digest: table.digest }))];
}

type EvidenceInput = { receipts: readonly AnyReceipt[]; ventureId: string; grounding?: Partial<Grounding>; cited: ReadonlySet<string> | null };

/** The client's own sources: the message, the answers and the files. Their figures stand; the calculator never refutes them. */
function clientSourceIds(grounding: Partial<Grounding> | undefined): string[] {
  return [
    ...(grounding?.clientRequest ? ['client-message'] : []), ...(grounding?.answers ?? []).map((_, index) => `answer.${index + 1}`),
    ...sourcesFromFiles(grounding?.files ?? []).map(source => source.id),
  ];
}

/** The owner's own links (the idea, the client's record, the plan) are held, with no digest. */
function ownerLinks(grounding: Partial<Grounding> | undefined): EvidenceLink[] {
  return (grounding?.ownerWords ?? []).flatMap(words => [...words.matchAll(/\b(?:https?:\/\/|www\.)[^\s<>"'`]+/giu)].map(match => ({
    url: match[0].replace(/[.,;:!?)\]]+$/, ''), digest: null, sourceId: 'owner',
  })));
}

/** The run's evidence, read and indexed once for every piece of words checked against it. */
function receiptEvidence(input: EvidenceInput): PreparedEvidence {
  const ours = input.receipts.filter(receipt => receipt.ventureId === input.ventureId);
  return prepareEvidence({
    sources: groundingSources(ours, input.ventureId, input.grounding), clientIds: clientSourceIds(input.grounding),
    figures: calculatorFigures(ours, input.cited), files: [...evidenceFiles(ours, input.grounding?.files ?? []),...(input.grounding?.outputFiles??[])], links: ownerLinks(input.grounding),
  }, input.grounding?.dateOrder === 'month-day-year' ? 'month-day-year' : 'day-month-year');
}

function citedReceipts(deliverable: Deliverable): Set<string> {
  return new Set(deliverable.sections.flatMap(section => section.parts.flatMap(part => part.kind === 'figure' ? [part.receiptId] : [])));
}

function receiptOptions(input: { allowed?: readonly string[]; estimates?: EstimateMode; flagship?: string | null; grounding?: Partial<Grounding> }, subject: string): ReceiptOptions {
  return {
    known: [...ALWAYS_KNOWN, ...(input.grounding?.known ?? [])], allowed: input.allowed ?? [], estimates: input.estimates ?? estimateRule(input.flagship), subject,
    dateOrder: input.grounding?.dateOrder === 'month-day-year' ? 'month-day-year' : 'day-month-year',
  };
}

/**
 * Every number, file and link in the draft's words against the run's receipts and evidence. A question for the client
 * may name a file it asks for, so questions are checked for numbers only. Corrections made before the checks keep the
 * check failed, each with its note, until the owner checks them: the owner's edit settles the draft.
 */
function receiptsCheck(input: CheckInput): CheckResult {
  const evidence = receiptEvidence({ receipts: input.receipts, ventureId: input.ventureId, grounding: input.grounding, cited: citedReceipts(input.deliverable) });
  const options = receiptOptions(input, 'draft');
  const numbers: DraftNumber[] = [];
  const references: DraftReference[] = [];
  const pieces = draftWords(input.deliverable);
  const questions = new Set(input.deliverable.questionsForClient);
  for (const piece of pieces) {
    const result = checkReceipts(piece, evidence, { ...options, references: !questions.has(piece) });
    numbers.push(...result.numbers);
    references.push(...result.references);
  }
  const verdict = receiptsVerdict(numbers, references, options);
  const corrections = input.corrections ?? [];
  if (!corrections.length) return { check: 'receipts', passed: verdict.passed, detail: verdict.detail };
  const count = corrections.length === 1 ? 'one figure' : `${corrections.length} figures`;
  return { check: 'receipts', passed: false, detail: `Chausar corrected ${count}; check them. ${corrections.map(item => item.note).join(' ')} ${verdict.detail}` };
}

/** What correctDraft reads: the draft and its checks, this business's receipts with the run's work receipts, and the run's sources. */
export type DraftEvidence = Pick<CheckInput, 'checks' | 'deliverable' | 'receipts' | 'ventureId' | 'allowed' | 'grounding'>;

/** Text around a replaced number; a punctuation tail is kept, so the figure reads "INR 449.82." when rendered. */
function keepText(parts: TextPart[], value: string) {
  const text = value.trim();
  if (text) parts.push({ kind: 'text', text });
}

/**
 * The calculator's figure in place of each number it refutes in the draft's text parts: the text is split around the
 * number and a figure part opens the receipt, so the owner sees the receipt's label and display. Each correction
 * carries a note; pass them to the checks (CheckInput.corrections). The estimate mark is worked out again, since the
 * refuted number may have been the only number the model wrote. A draft with nothing to correct, or whose checks do
 * not include receipts, comes back as it was.
 */
export function correctDraft(input: DraftEvidence): { deliverable: Deliverable; corrections: ReceiptCorrection[] } {
  // A draft whose checks leave out receipts is never changed: nothing would show the owner what changed.
  if (!input.checks.includes('receipts')) return { deliverable: input.deliverable, corrections: [] };
  const evidence = receiptEvidence({ receipts: input.receipts, ventureId: input.ventureId, grounding: input.grounding, cited: citedReceipts(input.deliverable) });
  const options = { ...receiptOptions(input, 'draft'), references: false };
  const corrections: ReceiptCorrection[] = [];
  const sections = input.deliverable.sections.map(section => ({
    heading: section.heading,
    parts: section.parts.flatMap((part): TextPart[] => {
      if (part.kind !== 'text') return [part];
      const refuted = checkReceipts(part.text, evidence, options).corrections;
      if (!refuted.length) return [part];
      const parts: TextPart[] = [];
      let from = 0;
      for (const correction of refuted) {
        keepText(parts, part.text.slice(from, correction.at));
        parts.push({ kind: 'figure', receiptId: correction.receiptId, figureKey: correction.figureKey });
        from = correction.at + correction.said.length;
      }
      keepText(parts, part.text.slice(from));
      corrections.push(...refuted);
      return parts;
    }),
  }));
  if (!corrections.length) return { deliverable: input.deliverable, corrections };
  const next: Deliverable = { ...input.deliverable, sections };
  delete next.estimate;
  return { deliverable: draftWords(next).some(words => modelNumbers(words, input.allowed)) ? { ...next, estimate: true } : next, corrections };
}

/** What a run summary is checked against: the run's own receipts, the client's words and files, and the tool results. */
export type SummaryInput = Partial<Grounding> & {
  receipts: readonly AnyReceipt[];
  ventureId: string;
  allowed?: readonly string[];
  estimates?: EstimateMode;
};

/**
 * The receipts check on a run summary or any other words an agent writes about a run. labelled is the summary as the
 * owner sees it: each number with no receipt labelled "model estimate", each refuted number replaced by the
 * calculator's figure with its receipt.
 */
export function summaryReceipts(text: string, input: SummaryInput): ReceiptsCheck {
  return summaryChecker(input)(text);
}

/** summaryReceipts for many pieces of words about one run: the run's evidence is read and indexed once. */
export function summaryChecker(input: SummaryInput): (text: string) => ReceiptsCheck {
  const { receipts, ventureId, allowed, estimates, ...grounding } = input;
  const evidence = receiptEvidence({ receipts, ventureId, grounding, cited: null });
  const options = receiptOptions({ allowed, estimates, grounding }, 'summary');
  return text => checkReceipts(text, evidence, options);
}

/**
 * The rules judge's verdict as a result. Left out when no judge ruled: the check never claims a pass it did not get.
 * A rule settled by no checked vote is not a pass, so an unsettled verdict does not pass.
 */
function rulesJudge(input: CheckInput): CheckResult | null {
  return input.rules ? rulesJudgeResult(input.rules) : null;
}

/** The rules judge's verdict as a check result; a real order's judge (judge-run.ts) stores it beside the code checks. */
export function rulesJudgeResult(verdict: RulesVerdict): CheckResult {
  if (verdict.outcome === 'pass') return { check: 'rules-judge', passed: true, detail: `${verdict.detail} Each yes cited something code found in the run.` };
  const first = verdict.rules.find(rule => rule.outcome === verdict.outcome);
  const said = verdict.outcome === 'fail' ? first?.votes.find(vote => vote.verified && vote.answer === 'no')?.reason : undefined;
  const why = first && first.detail !== verdict.detail ? ` ${first.detail}` : '';
  return {
    check: 'rules-judge', passed: false, detail: `${verdict.detail}${why}${said ? ` The judge said: "${quote(said, 160)}"` : ''}`,
    // No rule settled with checked evidence: nothing was checked, so the screens say so instead of calling it a failure.
    ...(verdict.outcome === 'unverified' ? { notChecked: true as const } : {}),
  };
}

const RUNNERS: Readonly<Record<CheckId, (input: CheckInput) => CheckResult | null>> = {
  'no-numeric-prose': noNumericProse,
  'figures-resolve': figuresResolve,
  'required-sections': requiredSections,
  'no-outside-writes': noOutsideWrites,
  'house-style': houseStyle,
  'prompt-leak': promptLeak,
  'length-bounds': lengthBounds,
  'turn-limit': turnLimit,
  'questions-raised': questionsRaised,
  'no-done-claims': noDoneClaims,
  'claims-grounded': claimsGrounded,
  receipts: receiptsCheck,
  'rules-judge': rulesJudge,
};

/** One result per requested check, in the order asked. rules-judge is left out until a judge has ruled. */
export function runChecks(input: CheckInput): CheckResult[] {
  return input.checks.flatMap(id => {
    const result = RUNNERS[id](input);
    return result ? [result] : [];
  });
}

export type DraftRulesInput = {
  /** The draft as the judge may see it: prices and dates as placeholders (renderForJudge). */
  draft: string;
  clientRequest: string;
  harness?: HarnessState | null;
  receipts?: readonly { id: string; explanation?: string }[];
  /** Who the client is and what the reply should achieve, in plain words. */
  context: string;
  containsClientData: boolean;
  /** The rules to ask: a flagship playbook's own (playbooks/draft-checks.ts flagshipJudgeRules), else the draft rules. */
  rules?: readonly JudgeRule[] | null;
};

/**
 * Asks the judge once to vote on the draft rules, citing ids from the run's trace (each tool call, file, table and
 * receipt, the client's message and the draft), and lets code count. A judge answer refused for its shape leaves
 * every rule unsettled; any other error (a spend limit, no AI) stops the caller as any model call would.
 */
export async function judgeDraftRules(ask: RulesAsk, input: DraftRulesInput): Promise<RulesVerdict & { callIds: (string | null)[] }> {
  const asked = draftRulesInput(input);
  try {
    return await judgeByRules(ask, asked);
  } catch (error) {
    if (!judgeAnswerRefused(error)) throw error;
    return { ...refusedVerdict(asked.rules, error), callIds: [] };
  }
}

/**
 * What the rules judge reads on a draft: the rules to ask (the playbook's own, else the draft rules) and the run's
 * trace, each tool call, file, table and receipt, then the client's message and the draft, which a vote may cite.
 */
export function draftRulesInput(input: DraftRulesInput): RulesInput {
  const trace = traceFromHarness(input.harness ?? null, {
    receipts: input.receipts,
    extra: [{ id: 'client-message', kind: 'client', summary: input.clientRequest }, { id: 'draft', kind: 'draft', summary: input.draft }],
  });
  return { rules: input.rules ?? DRAFT_RULES, trace, draft: input.draft, containsClientData: input.containsClientData, ...(input.context ? { context: input.context } : {}) };
}

/** True for a judge answer refused for how the model behaved (its shape, a refusal, a cut-off answer). */
export function judgeAnswerRefused(error: unknown): boolean {
  return JUDGE_BEHAVIOUR.has(errorCode(error));
}

/** A refused judge answer as a verdict: every rule unsettled, with why. Never a pass. */
export function refusedVerdict(rules: readonly JudgeRule[], error: unknown): RulesVerdict {
  const reason = `The judge's answer was refused, so no rule is settled: ${quote(error instanceof Error ? error.message : 'no reason given', 200)}`;
  return { ...notRuled(rules, reason), detail: reason };
}

/** The question the improvement gate asks when the old and the new version tie on every score. */
export const PREFER_QUESTION = 'Which reply better serves this client and the expected outcome, within the plan and the policy?';

/**
 * Pairwise preference between the old version's draft and the new one's: one round, asked in both orders, so a judge
 * that favours whatever it sees first prefers nothing. A refused answer, or no AI to judge, is no preference.
 */
export async function preferDraft(
  ask: PairAsk,
  input: { question: string; criteria?: readonly string[]; parent: string; candidate: string; containsClientData?: boolean },
): Promise<GatePreference & { callIds: (string | null)[] }> {
  try {
    const result = await comparePair(ask, {
      question: input.question, criteria: input.criteria, containsClientData: input.containsClientData ?? false,
      a: { id: 'parent', text: input.parent }, b: { id: 'candidate', text: input.candidate },
    }, { rounds: 1, random: () => 0 });
    const winner = result.winner === 'parent' || result.winner === 'candidate' ? result.winner : null;
    const detail = winner
      ? `The judge preferred the ${winner === 'candidate' ? 'new' : 'old'} version's draft with the order swapped.`
      : 'The judge preferred neither draft once the order was swapped, so the tie stands.';
    return { winner, detail, callIds: result.rounds.flatMap(round => round.callIds) };
  } catch (error) {
    if (!JUDGE_BEHAVIOUR.has(errorCode(error)) && errorCode(error) !== 'NO_MODEL_CONNECTED') throw error;
    return { winner: null, detail: `The comparison was refused, so the tie stands: ${quote(error instanceof Error ? error.message : 'no reason given', 160)}`, callIds: [] };
  }
}

export function firstFailedCheck(results: readonly CheckResult[]): CheckId | null {
  return results.find(result => !result.passed)?.check ?? null;
}
