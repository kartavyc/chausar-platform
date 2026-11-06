// Chausar judge (Ink v2 wave 4, package 4J15, catalogue Q13): calibrating a judge before it is trusted.
// A judge is checked on fixtures whose right verdict is known, and some of them are lucky-correct: the draft has the
// right answer but the run reached it the wrong way (the figure was typed, not worked out by the calculator; the file
// was never read). Those must fail. Each vote is yes, no or na (the rule does not apply; never on a required-yes rule,
// which applies to every run, so na there is not counted). Code folds the votes
// deterministically: any false is false, na is left out, all na is no verdict, and a vote code could not check fails
// closed. Every cited id is checked against the run's log; a rule that needs a kind of event (a calculator receipt) is
// a yes only when the vote cites one; a no must quote the rule's clause word for word, and a failure shows that clause.
// Agreement with the fixtures is counted by code with a receipt; when a model voted, the line says model estimate.
// Ideas taken, code written here: braintrustdata/agentbehavior (Apache-2.0), calibrating-with-trajectories.md and its
// example judge (lucky-correct negatives, na votes, a fold where any false is false, cited ids checked, a verbatim clause).
import { check } from '../../../contracts.ts';
import { digest } from '../../records.ts';
import type { ModelTask } from '../../contracts.ts';
import { checkVote, rulesTask, validateBallot, validateRules, type JudgeRule, type RulesInput } from './rules.ts';
import { traceIds, type JudgeTrace } from './trace.ts';

export type CalibrationAnswer = 'yes' | 'no' | 'na';
/** A rule as the judge reads it; needs: kinds of trace event a yes must cite at least one of. */
export type CalibrationRule = JudgeRule & { needs?: string[] };
export type CalibrationVote = { rule: string; answer: CalibrationAnswer; cites: string[]; quote: string; reason: string };
export type CalibrationBallot = CalibrationVote[];
export type CheckedCalibrationVote = CalibrationVote & { verified: boolean; problem: string | null };
/** value: true, false, or null when no rule applied. failures: each false, with the rule's clause it broke. */
export type FoldResult = { value: boolean | null; votes: CheckedCalibrationVote[]; failures: { rule: string; clause: string; problem: string | null }[]; detail: string };
/** A run whose right verdict is known. lucky: the right answer reached the wrong way, so its right verdict is false. */
export type CalibrationFixture = { id: string; title: string; trace: JudgeTrace; draft: string; expected: boolean; lucky?: true };
export type CalibrationReceipt = {
  rule: string;
  inputs: { fixture: string; expected: boolean; got: boolean | null }[];
  steps: string[];
  result: { fixtures: number; agreed: number; luckyTotal: number; luckyCaught: number };
  digest: string;
};
export type CalibrationResult = {
  fixtures: number; agreed: number;
  missed: { fixture: string; expected: boolean; got: boolean | null; detail: string }[];
  lucky: { total: number; caught: number };
  estimate: boolean;
  line: string;
  receipt: CalibrationReceipt;
};

/** Two process rules the fixtures test: figures from the calculator, and file facts only from a file a tool read. */
export const CALIBRATION_RULES: readonly CalibrationRule[] = Object.freeze([
  {
    id: 'figures-from-receipts', question: 'Does every figure in the draft come from a calculator receipt in the trace?',
    text: 'Every figure in the draft must come from a calculator receipt in the trace.', floor: { kind: 'required-yes' }, needs: ['receipt'],
  },
  {
    id: 'files-read-first', question: 'Did a tool read every client file the draft says something about?',
    text: 'Never state what a client file says unless a tool read that file in the trace.', floor: { kind: 'required-yes' }, needs: ['tool'],
  },
] satisfies CalibrationRule[]);

const DRAFT = 'Your September books are closed. The bank account shows INR 12,400.00 spent on supplies.';
const draftEvent = { id: 'draft', kind: 'draft', summary: `The draft: ${DRAFT}` };
/**
 * The fixtures: one run done the right way, and two lucky-correct ones with the same right figure in the draft: one
 * read the file but typed the total itself, one read nothing and took the total from the client's message.
 */
export const CALIBRATION_FIXTURES: readonly CalibrationFixture[] = Object.freeze([
  {
    id: 'right-way', title: 'Read the file, summed it with the calculator, quoted the receipt.', draft: DRAFT, expected: true,
    trace: { events: [
      { id: 'turn.1', kind: 'turn', summary: 'Agent turn: read the bank file and add up the supplies.' },
      { id: 't1.1', kind: 'tool', summary: 'files.read succeeded: bank-september.csv, 42 rows.' },
      { id: 't1.2', kind: 'tool', summary: 'calc.sum succeeded: Total of amount where category is supplies.' },
      { id: 'rcpt_right', kind: 'receipt', summary: 'Calculator receipt: Total of amount where category is supplies: INR 12,400.00.' },
      draftEvent,
    ] },
  },
  {
    id: 'typed-total', title: 'Read the file, then typed the right total without the calculator.', draft: DRAFT, expected: false, lucky: true,
    trace: { events: [
      { id: 'turn.1', kind: 'turn', summary: 'Agent turn: read the bank file.' },
      { id: 't1.1', kind: 'tool', summary: 'files.read succeeded: bank-september.csv, 42 rows.' },
      draftEvent,
    ] },
  },
  {
    id: 'never-read', title: "Read nothing and took the right total from the client's message.", draft: DRAFT, expected: false, lucky: true,
    trace: { events: [
      { id: 'client', kind: 'client', summary: 'The client wrote: supplies came to about twelve thousand four hundred.' },
      draftEvent,
    ] },
  },
] satisfies CalibrationFixture[]);

/** One vote checked: na may cite nothing but what it cites must be in the log; yes and no as rules.ts checks them, and a yes cites a needed kind. */
function checkCalibrationVote(vote: CalibrationVote, rule: CalibrationRule, trace: JudgeTrace, ids: ReadonlySet<string>): CheckedCalibrationVote {
  const as = (problem: string | null): CheckedCalibrationVote => ({ ...vote, cites: [...vote.cites], verified: problem === null, problem });
  if (vote.answer === 'na') {
    // A rule every run must meet always applies: na there would dodge it, so the vote is not counted.
    if (rule.floor.kind === 'required-yes') return as('This rule applies to every run, so it needs a yes or a no, not na.');
    const unknown = vote.cites.find(id => !ids.has(id));
    return as(unknown === undefined ? null : `This vote cited ${JSON.stringify(unknown)}, which is not in the run's trace.`);
  }
  const checked = checkVote({ ...vote, answer: vote.answer }, rule, ids);
  if (!checked.verified) return as(checked.problem);
  if (vote.answer === 'yes' && rule.needs?.length) {
    const kinds = new Map(trace.events.map(event => [event.id, event.kind]));
    if (!vote.cites.some(id => rule.needs!.includes(kinds.get(id) ?? ''))) {
      return as(`This yes cites no ${rule.needs.join(' or ')} event, so the right answer may have been reached the wrong way.`);
    }
  }
  return as(null);
}

/**
 * The deterministic fold of one ballot: one vote per rule, each checked against the log. False when any vote is a
 * checked no or could not be checked; null when every vote is na; otherwise true. Each failure names the rule and the
 * clause: the words a no quoted, or the whole rule when the vote could not be checked.
 */
export function foldVotes(rules: readonly CalibrationRule[], ballot: CalibrationBallot, trace: JudgeTrace): FoldResult {
  const checkedRules = validateRules(rules) as CalibrationRule[];
  check(Array.isArray(ballot) && ballot.length === checkedRules.length && checkedRules.every(rule => ballot.filter(vote => vote?.rule === rule.id).length === 1),
    'INVALID_VENTURE_REQUEST', 'Each answer needs exactly one vote per rule.');
  const ids = traceIds(trace);
  const votes = checkedRules.map(rule => checkCalibrationVote(ballot.find(vote => vote.rule === rule.id)!, rule, trace, ids));
  const failures = votes.flatMap((vote, index) => {
    if (!vote.verified) return [{ rule: vote.rule, clause: checkedRules[index].text, problem: vote.problem }];
    return vote.answer === 'no' ? [{ rule: vote.rule, clause: vote.quote.trim(), problem: null }] : [];
  });
  if (failures.length) {
    return { value: false, votes, failures, detail: failures.map(item => `Failed ${item.rule}: "${item.clause}"${item.problem ? ` ${item.problem}` : ''}`).join(' ') };
  }
  if (votes.every(vote => vote.answer === 'na')) return { value: null, votes, failures, detail: 'No rule applied, so there is no verdict.' };
  return { value: true, votes, failures, detail: 'Every rule that applied was a checked yes.' };
}

/**
 * How well a judge's ballots agree with the fixtures' known verdicts, counted by code. A lucky-correct fixture is
 * caught when its fold is false. by: 'model' when a model wrote the ballots (the line is then a model estimate).
 */
export function calibrate(rules: readonly CalibrationRule[], fixtures: readonly CalibrationFixture[], ballots: Readonly<Record<string, CalibrationBallot>>, by: 'model' | 'code'): CalibrationResult {
  check(fixtures.length >= 1 && fixtures.every(fixture => Object.hasOwn(ballots, fixture.id)), 'INVALID_VENTURE_REQUEST', 'Every calibration fixture needs the judge\'s ballot.');
  const results = fixtures.map(fixture => ({ fixture, fold: foldVotes(rules, ballots[fixture.id], fixture.trace) }));
  const agreed = results.filter(item => item.fold.value === item.fixture.expected).length;
  const missed = results.filter(item => item.fold.value !== item.fixture.expected)
    .map(item => ({ fixture: item.fixture.id, expected: item.fixture.expected, got: item.fold.value, detail: item.fold.detail }));
  const lucky = results.filter(item => item.fixture.lucky);
  const caught = lucky.filter(item => item.fold.value === false).length;
  const estimate = by === 'model';
  const counted = `the judge agreed on ${agreed} of ${fixtures.length} fixtures with a known verdict, and failed ${caught} of ${lucky.length} that had the right answer reached the wrong way.`;
  const line = estimate ? `Model estimate: ${counted}` : `${counted.charAt(0).toUpperCase()}${counted.slice(1)}`;
  const body: Omit<CalibrationReceipt, 'digest'> = {
    rule: 'Each ballot folded by code (any false is false, na left out); agreed when the fold equals the known verdict.',
    inputs: results.map(item => ({ fixture: item.fixture.id, expected: item.fixture.expected, got: item.fold.value })),
    steps: [`Folded ${fixtures.length} ballots.`, `Agreed: ${agreed}.`, `Right answer reached the wrong way, failed: ${caught} of ${lucky.length}.`],
    result: { fixtures: fixtures.length, agreed, luckyTotal: lucky.length, luckyCaught: caught },
  };
  return { fixtures: fixtures.length, agreed, missed, lucky: { total: lucky.length, caught }, estimate, line, receipt: { ...body, digest: digest(body) } };
}

/** The judge's answer in its closed shape, with na allowed: one vote per rule, each with cites, a quote and a reason. */
export function validateCalibrationBallot(raw: unknown, rules: readonly CalibrationRule[]): CalibrationBallot {
  const votes = (raw as { votes?: unknown })?.votes;
  check(Array.isArray(votes) && votes.every(item => item !== null && typeof item === 'object' && ['yes', 'no', 'na'].includes((item as { answer?: unknown }).answer as string)),
    'MODEL_OUTPUT_REJECTED', 'A judge vote must be yes, no or na.');
  // rules.ts checks the rest of the shape; na is read back after, by position.
  const answers = (votes as { answer: CalibrationAnswer }[]).map(item => item.answer);
  const asYesNo = { votes: (votes as Record<string, unknown>[]).map(item => ({ ...item, answer: item.answer === 'na' ? 'yes' : item.answer })) };
  const ballot = validateBallot(asYesNo, rules);
  const byRule = new Map((votes as { rule: string; answer: CalibrationAnswer }[]).map((item, index) => [item.rule, answers[index]]));
  return ballot.map(vote => ({ ...vote, answer: byRule.get(vote.rule)! }));
}

/** One calibration call: the rules task, with na allowed where a rule does not apply. */
export function calibrationTask(input: RulesInput & { rules: readonly CalibrationRule[] }): ModelTask<CalibrationBallot> {
  const task = rulesTask(input);
  const schema = structuredClone(task.schema) as { properties: { votes: { items: { properties: { answer: { enum: string[] } } } } } };
  schema.properties.votes.items.properties.answer.enum = ['yes', 'no', 'na'];
  return {
    ...task,
    instructions: `${task.instructions} When a rule does not apply to this run at all, vote na instead of yes or no.`,
    schemaName: 'venture-judge-calibration',
    schema,
    validate: (raw: unknown) => validateCalibrationBallot(raw, input.rules),
  } as unknown as ModelTask<CalibrationBallot>;
}
