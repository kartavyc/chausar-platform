// Chausar venture launcher, delivery package (P5): deterministic checks on a draft reply.
// Code checks run before any judge. Each returns a plain sentence the owner can read.
// Two checks come from the judge package (judge/): claims-grounded matches every figure, date, name and certification
// in the draft's own words against the run's sources with no model, and rules-judge turns the rules judge's votes,
// counted by code, into a result. The judge is asked only behind the code checks (judgeDraftRules), and only in
// rehearsal: on a real order its call would carry the client's words, which needs the owner's approval of each call.
// preferDraft is the pairwise comparison the improvement gate uses when two versions tie on every score.
import { assertNoMoney, doneClaimMatches, houseStyleFindings, modelNumbers } from '../records.ts';
import { REQUIRED_SECTIONS } from '../contracts.ts';
import type { CheckId, CheckResult, ClaimProof, DateOrder, Deliverable, GatePreference, HarnessState, MockEffect, ServiceType } from '../contracts.ts';
import { draftWords, type AnyReceipt } from './deliverable.ts';
import { claimBacked } from './harness/claims.ts';
import type { FileLike } from './harness/files.ts';
import { checkClaims, deliverableWords, sourcesFromFiles, sourcesFromRun } from './judge/claim-check.ts';
import { comparePair, type PairAsk } from './judge/pairwise.ts';
import { DRAFT_RULES, judgeByRules, notRuled, type RulesAsk, type RulesVerdict } from './judge/rules.ts';
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
  /** Names that are never claims: the business, its offers, the client. */
  known?: readonly string[];
  dateOrder?: DateOrder;
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
 * invoice figure comes only from a receipt.
 */
function noNumericProse(input: CheckInput): CheckResult {
  const pieces = wordPieces(input.deliverable);
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
  const sources = sourcesFromRun({
    clientRequest: grounding?.clientRequest,
    harness: grounding?.harness ?? null,
    receipts: input.receipts.filter(receipt => receipt.ventureId === input.ventureId),
    extra: [
      ...(grounding?.answers ?? []).map((answer, index) => ({ id: `answer.${index + 1}`, text: answer })),
      ...sourcesFromFiles(grounding?.files ?? []),
    ],
  });
  const result = checkClaims(deliverableWords(input.deliverable), sources, {
    known: [...ALWAYS_KNOWN, ...(grounding?.known ?? [])],
    dateOrder: grounding?.dateOrder === 'month-day-year' ? 'month-day-year' : 'day-month-year',
  });
  return { check: 'claims-grounded', passed: result.passed, detail: result.detail };
}

/**
 * The rules judge's verdict as a result. Left out when no judge ruled: the check never claims a pass it did not get.
 * A rule settled by no checked vote is not a pass, so an unsettled verdict does not pass.
 */
function rulesJudge(input: CheckInput): CheckResult | null {
  const verdict = input.rules;
  if (!verdict) return null;
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
  'length-bounds': lengthBounds,
  'turn-limit': turnLimit,
  'questions-raised': questionsRaised,
  'no-done-claims': noDoneClaims,
  'claims-grounded': claimsGrounded,
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
};

/**
 * Asks the judge once to vote on the draft rules, citing ids from the run's trace (each tool call, file, table and
 * receipt, the client's message and the draft), and lets code count. A judge answer refused for its shape leaves
 * every rule unsettled; any other error (a spend limit, no AI) stops the caller as any model call would.
 */
export async function judgeDraftRules(ask: RulesAsk, input: DraftRulesInput): Promise<RulesVerdict & { callIds: (string | null)[] }> {
  const trace = traceFromHarness(input.harness ?? null, {
    receipts: input.receipts,
    extra: [{ id: 'client-message', kind: 'client', summary: input.clientRequest }, { id: 'draft', kind: 'draft', summary: input.draft }],
  });
  try {
    return await judgeByRules(ask, { rules: DRAFT_RULES, trace, draft: input.draft, containsClientData: input.containsClientData, ...(input.context ? { context: input.context } : {}) });
  } catch (error) {
    if (!JUDGE_BEHAVIOUR.has(errorCode(error))) throw error;
    const reason = `The judge's answer was refused, so no rule is settled: ${quote(error instanceof Error ? error.message : 'no reason given', 200)}`;
    return { ...notRuled(DRAFT_RULES, reason), detail: reason, callIds: [] };
  }
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
