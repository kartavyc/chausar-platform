// Chausar delivery (Ink v2 wave 4, package 4J16, catalogue Q15): learning from the owner's corrections, by code.
// - Each edit or send-back of a draft (a review signal, or an edit made on Today) becomes a regression case with typed
//   expectations: mentions, doesn't mention, hands off, uses a tool, cites. They come from the review and from fixed
//   lists only: AI-tell words and done claims the owner took out, required headings the owner put in, and the reason
//   they gave (a missing fact means ask the client; a wrong number means cite figures from receipts and use the tool the
//   run used). Never the client's own words: practice clients are made up, and rehearsal stays free of client data.
// - The case joins rehearsal (scenarios.ts signalScenario), where a practice draft that breaks an expectation fails
//   (withExpectations, from simulate.ts rehearse). A template outline is not the agent's draft: it is not checked.
// - A part of the drafts corrected in at least 60 percent of at least 3 reviews is flagged "Fix the rule".
// Nothing here changes a playbook or a prompt. A lasting rule comes only from the owner's own words in the agent's
// chat ("from now on ..."), as a 4B1 proposal the owner accepts, which lands as a versioned owner patch they can undo
// (agents/proposals.ts). The flag points there, with a starter the screen prefills and never sends.
// Ideas taken, code written here: opendesk internal/ai/agent_review.go and agent_tests.go (corrections as tests with
// typed expectations), py-idp hitl/triage.py (the share of reviews a field is corrected in; idea only), agentbehavior
// deciding-what-to-save.md, podcast-shorts-factory trainer.py.
import type { State } from '../../contracts.ts';
import type { CorrectionExpectation, DeliveryRunRecord, Episode, ExpectationResult, FixTheRuleView, Scenario, SignalRecord } from '../contracts.ts';
import { doneClaimMatches, findRecord, listRecords } from '../records.ts';
import { tellsIn } from '../playbooks/writing-checks.ts';
import { flagshipDelivery } from '../playbooks/steps.ts';
import { roleOfStep } from '../agents/roles.ts';
import { deliverableWords } from './judge/claim-check.ts';
import { currentPlaybook } from './playbook.ts';

export type Expectation = CorrectionExpectation;

/** A field is flagged when it was corrected in at least this share of at least this many reviews. */
export const CORRECTION_SHARE = 0.6;
export const CORRECTION_REVIEWS = 3;
/** The field a send-back or an edit with no headings corrects. */
export const WHOLE_DRAFT = 'whole draft';

/** A correction as a regression case. source: the review signal, or an edit made on Today (4J2's venture-draft-edit). */
export type RegressionCase = {
  id: string; runId: string; signalId: string | null; source: SignalRecord['source'] | 'draft-edit'; at: string;
  /** The parts of the draft the owner corrected: section headings, or the whole draft. */
  fields: string[];
  expectations: Expectation[];
};

const REASON_ASKS: readonly string[] = ['missing-fact', 'questions-raised'];
const REASON_FIGURES: readonly string[] = ['wrong-number', 'figures-resolve', 'no-numeric-prose', 'receipts'];
const REASON_FILES: readonly string[] = ['wrong-fact', 'claims-grounded'];
/** Tools whose answers are figures with receipts: a wrong number points at using one. */
const FIGURE_TOOLS = /^(?:calc\.|books\.|bills\.|tax\.|social\.report$|youtube\.hooks$)/;

const lower = (text: string) => text.toLowerCase();
/** The headings of a draft as text, from its "## Heading" lines. */
const headingsOf = (text: string) => [...text.matchAll(/^##\s+(.+?)\s*$/gm)].map(match => match[1]);

/** The words of each section of a rendered draft, by heading; null when the text has no headings. */
function sectionsOf(text: string): Map<string, string> | null {
  const blocks = text.split(/^##\s+/m).slice(1);
  if (!blocks.length) return null;
  return new Map(blocks.map(block => {
    const [heading, ...rest] = block.split('\n');
    return [heading.trim(), rest.join(' ').replace(/\s+/g, ' ').trim().toLowerCase()];
  }));
}

/** The draft's own text as the owner first saw it: its rendered text, else its words. */
function draftText(run: Pick<DeliveryRunRecord, 'renderedText' | 'deliverable'>): string {
  return run.renderedText ?? (run.deliverable ? deliverableWords(run.deliverable) : '');
}

/** The parts of the draft an edit changed: each section whose words differ, or the whole draft when either has no headings. */
export function changedFields(run: Pick<DeliveryRunRecord, 'renderedText' | 'deliverable'>, edited: string): string[] {
  const before = run.renderedText ? sectionsOf(run.renderedText) : null;
  const after = sectionsOf(edited);
  if (!before || !after) return [WHOLE_DRAFT];
  const headings = [...new Set([...before.keys(), ...after.keys()])];
  const changed = headings.filter(heading => before.get(heading) !== after.get(heading));
  return changed.length ? changed : [];
}

/**
 * The typed expectations a correction makes, in a fixed order: the AI-tell words and done claims the edit took out
 * (not-mentions), the required headings it put in (mentions), then what the reason asks (hands-off, cites, uses-tool).
 */
export function expectationsFor(run: DeliveryRunRecord, signal: Pick<SignalRecord, 'source' | 'reason'> | null, requiredSections: readonly string[], edited: string | null = run.editedText): Expectation[] {
  const out: Expectation[] = [];
  const draft = run.deliverable ? deliverableWords(run.deliverable) : draftText(run);
  if (edited) {
    const kept = lower(edited);
    for (const word of tellsIn(draft)) if (!tellsIn(edited).includes(word)) out.push({ kind: 'not-mentions', text: word });
    for (const claim of doneClaimMatches(draft)) if (!kept.includes(lower(claim))) out.push({ kind: 'not-mentions', text: lower(claim) });
    const had = new Set((run.deliverable?.sections ?? []).map(section => section.heading));
    for (const heading of headingsOf(edited)) if (requiredSections.includes(heading) && !had.has(heading)) out.push({ kind: 'mentions', text: heading });
  }
  const reason = signal?.reason ?? null;
  if (reason && REASON_ASKS.includes(reason)) out.push({ kind: 'hands-off', to: 'client' });
  const used = (run.harness?.toolCalls ?? []).filter(call => call.outcome === 'succeeded').map(call => call.tool);
  if (reason && REASON_FIGURES.includes(reason)) {
    out.push({ kind: 'cites', what: 'figure' });
    const tool = used.find(name => FIGURE_TOOLS.test(name));
    if (tool) out.push({ kind: 'uses-tool', tool });
  }
  if (reason && REASON_FILES.includes(reason) && used.includes('files.read')) out.push({ kind: 'uses-tool', tool: 'files.read' });
  const seen = new Set<string>();
  return out.filter(item => { const key = JSON.stringify(item); if (seen.has(key)) return false; seen.add(key); return true; });
}

/** The headings the playbook's writing step requires, for the business's playbook in use. */
function requiredOf(state: State, ventureId: string): string[] {
  const venture = findRecord(state, 'venture-record', ventureId);
  const playbook = venture ? currentPlaybook(state, venture) : null;
  return (playbook?.steps ?? []).filter(step => step.kind === 'write').flatMap(step => step.requiredSections);
}

/** Every correction of the business as a regression case, oldest first: review signals, then edits made on Today. */
export function correctionCases(state: State, ventureId: string): RegressionCase[] {
  const required = requiredOf(state, ventureId);
  const cases: RegressionCase[] = [];
  for (const signal of listRecords(state, 'venture-signal', ventureId)) {
    if (signal.source !== 'owner-edited' && signal.source !== 'owner-rejected') continue;
    const run = findRecord(state, 'venture-delivery-run', signal.runId);
    if (!run) continue;
    const edited = signal.source === 'owner-edited' ? run.editedText : null;
    cases.push({
      id: `correction-${signal.id}`, runId: run.id, signalId: signal.id, source: signal.source, at: signal.at,
      fields: edited ? changedFields(run, edited) : [WHOLE_DRAFT], expectations: expectationsFor(run, signal, required, edited),
    });
  }
  for (const edit of listRecords(state, 'venture-draft-edit', ventureId)) {
    if (edit.undoneAt) continue;
    const run = findRecord(state, 'venture-delivery-run', edit.runId);
    if (!run) continue;
    cases.push({ id: `correction-${edit.id}`, runId: run.id, signalId: null, source: 'draft-edit', at: edit.at, fields: changedFields(run, edit.text), expectations: expectationsFor(run, null, required, edit.text) });
  }
  return cases.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

/** The expectations a signal's rehearsal case carries, or none (scenarios.ts). */
export function signalExpectations(state: State, signal: SignalRecord): Expectation[] {
  return correctionCases(state, signal.ventureId).find(item => item.signalId === signal.id)?.expectations ?? [];
}

const has = (words: string, text: string) => new RegExp(`(?<![\\p{L}\\p{N}])${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu').test(words);

/** Each expectation checked on a practice draft. A template outline, or a draft that ran no tools for uses-tool, is not checked. */
export function checkExpectations(expectations: readonly Expectation[], episode: Episode): ExpectationResult[] {
  const byAgent = episode.turns.some(turn => turn.by === 'agent' && turn.author === 'model') || (episode.harness?.turns ?? []).some(turn => turn.by === 'model');
  const words = episode.renderedText ?? (episode.deliverable ? deliverableWords(episode.deliverable) : '');
  return expectations.map(expectation => {
    const result = (outcome: ExpectationResult['outcome'], detail: string): ExpectationResult => ({ expectation, outcome, detail });
    if (!byAgent || !episode.deliverable) return result('not-checked', 'Not checked: a template outline is not the agent\'s draft.');
    switch (expectation.kind) {
      case 'mentions':
        return has(words, expectation.text) ? result('pass', `The draft has "${expectation.text}", as your correction did.`) : result('fail', `The draft should have "${expectation.text}", as your correction did.`);
      case 'not-mentions':
        return has(words, expectation.text) ? result('fail', `The draft says "${expectation.text}", which you took out before.`) : result('pass', `The draft does not say "${expectation.text}".`);
      case 'hands-off': {
        const asked = (episode.harness?.handoffs ?? []).some(item => item.to === expectation.to) || (expectation.to === 'client' && episode.deliverable.questionsForClient.length > 0);
        return asked ? result('pass', `The draft asks the ${expectation.to} first.`) : result('fail', `The draft should ask the ${expectation.to}, as your correction asked.`);
      }
      case 'uses-tool': {
        if (!episode.harness) return result('not-checked', 'Not checked: this practice draft ran no tools.');
        const ran = episode.harness.toolCalls.some(call => call.tool === expectation.tool && call.outcome === 'succeeded');
        return ran ? result('pass', `The agent used ${expectation.tool}.`) : result('fail', `The agent should use ${expectation.tool}, as the corrected run did.`);
      }
      case 'cites': {
        const cited = episode.deliverable.sections.some(section => section.parts.some(part => part.kind === 'figure'));
        return cited ? result('pass', 'The draft gives its figures from receipts.') : result('fail', 'The draft should give its figures from receipts, as your correction asked.');
      }
    }
  });
}

/** A practice episode with its case's expectations checked; the first one that fails fails an episode that passed. */
export function withExpectations(scenario: Pick<Scenario, 'expectations'>, episode: Episode): Episode {
  if (!scenario.expectations?.length) return episode;
  const expectations = checkExpectations(scenario.expectations, episode);
  const failed = expectations.find(item => item.outcome === 'fail');
  return { ...episode, expectations, ...(failed && episode.passed ? { passed: false, firstFailure: `correction:${failed.expectation.kind}` } : {}) };
}

/**
 * The parts of the drafts the owner corrected in at least 60 percent of at least 3 reviews, most corrected first. A
 * review is a draft of the version in use that the owner accepted, edited or sent back (a new version starts the
 * count again); a section counts in the reviews of drafts that had it, and a send-back corrects the whole draft. Each
 * flag names the agent whose writing step it is and a starter for its chat.
 */
export function fixTheRule(state: State, ventureId: string): FixTheRuleView[] {
  const venture = findRecord(state, 'venture-record', ventureId);
  const playbook = venture ? currentPlaybook(state, venture) : null;
  const reviews = listRecords(state, 'venture-delivery-run', ventureId).filter(run => run.verdict !== null && (!playbook || run.playbookId === playbook.id));
  const counts = new Map<string, { corrected: number; reviews: number }>();
  const bump = (field: string, corrected: boolean) => {
    const item = counts.get(field) ?? { corrected: 0, reviews: 0 };
    item.reviews += 1;
    if (corrected) item.corrected += 1;
    counts.set(field, item);
  };
  const edits = listRecords(state, 'venture-draft-edit', ventureId).filter(edit => !edit.undoneAt);
  for (const run of reviews) {
    const edited = run.verdict!.choice === 'edited' ? run.editedText : edits.findLast(edit => edit.runId === run.id)?.text ?? null;
    const corrected = new Set(run.verdict!.choice === 'rejected' ? [WHOLE_DRAFT] : edited ? changedFields(run, edited) : []);
    for (const heading of new Set([...(run.deliverable?.sections ?? []).map(section => section.heading), ...corrected])) if (heading !== WHOLE_DRAFT) bump(heading, corrected.has(heading));
    bump(WHOLE_DRAFT, corrected.has(WHOLE_DRAFT));
  }
  const write = playbook?.steps.find(step => step.kind === 'write') ?? null;
  const agent = playbook && write ? roleOfStep(flagshipDelivery(playbook.flagship ?? null), write.id) : null;
  return [...counts.entries()]
    .filter(([, item]) => item.reviews >= CORRECTION_REVIEWS && item.corrected / item.reviews >= CORRECTION_SHARE)
    .sort((a, b) => b[1].corrected / b[1].reviews - a[1].corrected / a[1].reviews || b[1].corrected - a[1].corrected)
    .map(([field, item]) => ({
      field, stepId: write?.id ?? null, agent, corrected: item.corrected, reviews: item.reviews,
      line: `Fix the rule: ${field === WHOLE_DRAFT ? 'the whole draft' : `"${field}"`} was corrected in ${item.corrected} of ${item.reviews} reviews. Say how it should be done from now on, in the agent's chat; nothing changes until you accept the change.`,
      starter: field === WHOLE_DRAFT ? 'From now on,' : `From now on, in ${field},`,
    }));
}
