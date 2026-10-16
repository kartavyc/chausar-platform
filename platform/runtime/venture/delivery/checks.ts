// Chausar venture launcher, delivery package (P5): deterministic checks on a draft reply.
// Code checks run before any judge. Each returns a plain sentence the owner can read.
import { assertNoNumbers, doneClaimMatches, houseStyleFindings } from '../records.ts';
import { REQUIRED_SECTIONS } from '../contracts.ts';
import type { CheckId, CheckResult, ClaimProof, Deliverable, MockEffect, ServiceType } from '../contracts.ts';
import type { AnyReceipt } from './deliverable.ts';
import { claimBacked } from './harness/claims.ts';
import { quote } from './shared.ts';

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
};

/** Every piece of model words in a draft: the title, each text part and each question. */
function wordPieces(d: Deliverable): string[] {
  const pieces = [d.title];
  for (const section of d.sections) for (const part of section.parts) if (part.kind === 'text') pieces.push(part.text);
  return [...pieces, ...d.questionsForClient];
}

function noNumericProse(input: CheckInput): CheckResult {
  for (const piece of wordPieces(input.deliverable)) {
    try { assertNoNumbers(piece, 'draft', input.allowed); } catch {
      return { check: 'no-numeric-prose', passed: false, detail: `This line holds a number the calculator did not make: "${quote(piece)}"` };
    }
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

const RUNNERS: Readonly<Record<CheckId, (input: CheckInput) => CheckResult>> = {
  'no-numeric-prose': noNumericProse,
  'figures-resolve': figuresResolve,
  'required-sections': requiredSections,
  'no-outside-writes': noOutsideWrites,
  'house-style': houseStyle,
  'length-bounds': lengthBounds,
  'turn-limit': turnLimit,
  'questions-raised': questionsRaised,
  'no-done-claims': noDoneClaims,
};

/** One result per requested check, in the order asked. */
export function runChecks(input: CheckInput): CheckResult[] {
  return input.checks.map(id => RUNNERS[id](input));
}

export function firstFailedCheck(results: readonly CheckResult[]): CheckId | null {
  return results.find(result => !result.passed)?.check ?? null;
}
