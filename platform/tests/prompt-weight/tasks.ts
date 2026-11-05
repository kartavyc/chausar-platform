// D2 task 14: the registry of AI task builders (platform/runtime/venture), each called with two fixture contexts that
// differ in the owner's name, the client's name, dates, amounts and ids. prompt-weight-d2.test.ts checks that the fixed
// prompt (the instructions) is the same for both, and scripts/prompt-weight.mjs prints what each call carries.
// Sites whose instructions the static scan (static.ts) proves fixed need no entry here; a site whose instructions go
// through a reviewed wrapper (WRAPPERS) must have one, so the wrapper runs with both contexts.
import type { Json, ModelPurpose, ModelTask } from '../../runtime/venture/contracts.ts';
import { aboutTask } from '../../runtime/venture/core/about.ts';
import { countrySuggestionTask } from '../../runtime/venture/core/country-suggestion.ts';
import { interviewTask } from '../../runtime/venture/core/interview.ts';
import { composeTask, decideTask } from '../../runtime/venture/core/compose.ts';
import { countryProfile } from '../../runtime/venture/core/countries.ts';
import { suggestRepairTask, suggestTask } from '../../runtime/venture/core/suggest.ts';
import { briefFillTask, briefTask } from '../../runtime/venture/build/brief.ts';
import { deliveryTask } from '../../runtime/venture/delivery/deliverable.ts';
import { actTask, DEFAULT_LIMITS, newHarnessState, writeTask } from '../../runtime/venture/delivery/harness/loop.ts';
import { judgeTask } from '../../runtime/venture/delivery/judge.ts';
import { pairwiseTask } from '../../runtime/venture/delivery/judge/pairwise.ts';
import { clientSimTask } from '../../runtime/venture/delivery/simulate.ts';
import { triageTask } from '../../runtime/venture/views/triage.ts';
import { makeTask } from '../../runtime/venture/apps/make.ts';
import { goalSuggestTask } from '../../runtime/venture/money/goals.ts';
import { instructionsFor as outreachInstructions } from '../../runtime/venture/network/outreach.ts';

/** The two contexts. Every changing value differs between them; none is in any fixed prompt. */
export type Fixture = { owner: string; client: string; date: string; time: string; amount: string; id: string; idea: string; ask: string; problem: string; month: string };
export const FIXTURES: Readonly<Record<'A' | 'B', Fixture>> = {
  A: { owner: 'Asha Mehra', client: 'Ravi Kapoor Traders', date: '2026-11-05', time: '2026-11-05T09:30:00.000Z', amount: '125000', id: 'order_7f3a9c21',
    idea: 'Bookkeeping for small cafes in Pune, run by Asha Mehra', ask: 'Add a weekly ledger check for Ravi Kapoor Traders', problem: 'The offer named Weekly Ledger Review was not in the plan.', month: '2026-11' },
  B: { owner: 'Kiran Desai', client: 'Meera Joshi Studio', date: '2026-12-19', time: '2026-12-19T16:05:00.000Z', amount: '480750', id: 'order_c41b8e09',
    idea: 'Tax filing help for freelance designers in Kochi, run by Kiran Desai', ask: 'Offer a quarterly filing review for Meera Joshi Studio', problem: 'The step called Quarterly Filing Pass had no title.', month: '2026-12' },
};

/** What a builder gives back: the task, or only the instructions where the task itself is built inside a larger flow. */
export type Built = Pick<ModelTask<unknown>, 'instructions'> & Partial<Pick<ModelTask<unknown>, 'input' | 'schema' | 'schemaName' | 'purpose'>>;
export type Builder = {
  name: string;
  purpose: ModelPurpose;
  site: string; // the file under platform/runtime/venture that builds it
  build(fixture: Fixture): Built;
  /** A builder whose fixed text is chosen by a flag lists every text it may send; both contexts must give one of them. */
  variants?(): readonly string[];
};

/** Reviewed wrappers: functions a task's instructions go through. 'text' ones add to a fixed text; 'builder' ones make it from flags. */
export const WRAPPERS: ReadonlyMap<string, 'text' | 'builder'> = new Map([
  ['withNotes', 'text'], ['withKnowledge', 'text'], ['withKnowledgeLine', 'text'], ['withAwaiting', 'text'], ['withUnconfirmed', 'text'],
  ['withOwnerWords', 'text'], ['withRunWords', 'text'], ['redactSecrets', 'text'], ['instructionsFor', 'builder'],
]);
/** Sites that only pass a task through (they never build one), with the reason. */
export const PASS_THROUGH: readonly { file: string; reason: string }[] = [
  { file: 'models/port.ts', reason: 'the port redacts secret-shaped text from the task it was given before sending it; it builds no task' },
];

const template = () => ({}) as never;
const venture = (fx: Fixture) => ({ id: `venture_${fx.id}`, idea: fx.idea, country: { code: 'IN', name: 'India', currency: 'INR' } }) as never;
const blueprint = (fx: Fixture) => ({
  id: `blueprint_${fx.id}`, serviceType: 'bookkeeping', name: { value: `${fx.owner} Books` }, oneLiner: { value: `Monthly books for ${fx.client}` },
  customer: { value: `Owners like ${fx.client}` }, deliverySteps: [{ id: 'step_1', title: { value: 'Collect the bills' }, doneBy: 'agent' }],
  offers: [{ id: 'offer_1', name: { value: `${fx.owner} monthly books` }, description: { value: `Books closed by ${fx.date}` }, pricing: { model: 'fixed' } }],
}) as never;
const country = () => countryProfile('IN');
const refs = (fx: Fixture) => ({ figures: [{ ref: 'offer_1.total', label: `Total for ${fx.client}`, receiptId: `receipt_${fx.id}`, figureKey: 'total' }],
  dates: [{ ref: 'order.due', label: 'Due date', iso: fx.date }] }) as never;
const decision = (fx: Fixture) => ({ text: fx.idea, country: country(), kind: 'service', family: { value: 'bookkeeping' }, reading: { value: `Books for ${fx.client}` },
  views: ['offers-first', 'pages'] }) as never;

/** An act turn with everything that may change in it: calls waiting for the owner, a repair, notes and sources. */
function harnessState(fx: Fixture) {
  const state = newHarnessState(['outbox.propose'] as never, DEFAULT_LIMITS, []) as Record<string, unknown> & ReturnType<typeof newHarnessState>;
  state.toolCalls = [{ id: `call_${fx.id}`, turn: 1, tool: 'outbox.propose', input: { to: fx.client }, outcome: 'succeeded',
    envelope: { ok: true, result: { proposed: true } }, at: fx.time }] as never;
  state.repairs = [{ turn: 1, reason: `The field for ${fx.client} was not a list.` }] as never;
  state.alreadyTried = [{ tool: 'outbox.propose', summary: `Tried to reach ${fx.client} on ${fx.date}` }] as never;
  return state;
}
const loopContext = (fx: Fixture) => ({
  serviceType: 'bookkeeping', offer: { name: `${fx.owner} monthly books`, description: `Books closed by ${fx.date}` }, clientRequest: `Close the books for ${fx.client} by ${fx.date}`,
  playbook: { steps: [] }, dictionaryManifest: 'm', files: [], containsClientData: true, allowed: [], host: 'desktop',
  notes: [{ id: `note_${fx.id}`, agent: 'books', text: `${fx.client} pays late` }], knowledge: [{ id: `source_${fx.id}`, text: `${fx.owner} prefers short replies` }],
}) as never;

export const REGISTRY: readonly Builder[] = [
  { name: 'about', purpose: 'decide', site: 'core/about.ts', build: fx => aboutTask({ text: fx.idea, file: null }) },
  { name: 'country-suggestion', purpose: 'decide', site: 'core/country-suggestion.ts', build: fx => countrySuggestionTask(fx.idea) },
  { name: 'interview', purpose: 'interview', site: 'core/interview.ts', build: fx => interviewTask(venture(fx), template) },
  { name: 'decide', purpose: 'decide', site: 'core/compose.ts', build: fx => decideTask(fx.idea, country()) },
  { name: 'decide-repair', purpose: 'decide', site: 'core/compose.ts', build: fx => decideTask(fx.idea, country(), fx.problem) },
  { name: 'compose', purpose: 'compose', site: 'core/compose.ts', build: fx => composeTask(decision(fx)) },
  { name: 'compose-repair', purpose: 'compose', site: 'core/compose.ts', build: fx => composeTask(decision(fx), fx.problem) },
  { name: 'plan-suggest', purpose: 'plan-suggest', site: 'core/suggest.ts', build: fx => suggestTask({ venture: venture(fx), blueprint: blueprint(fx), words: fx.ask, file: null }) },
  { name: 'plan-suggest-repair', purpose: 'plan-suggest', site: 'core/suggest.ts',
    build: fx => suggestRepairTask(suggestTask({ venture: venture(fx), blueprint: blueprint(fx), words: fx.ask, file: null }), fx.problem) },
  { name: 'brief', purpose: 'brief', site: 'build/brief.ts', build: fx => briefTask(venture(fx), blueprint(fx), template) },
  { name: 'brief-fill', purpose: 'brief', site: 'build/brief.ts', build: fx => {
    const base = briefTask(venture(fx), blueprint(fx), template);
    return briefFillTask(base, ['whoItIsFor', 'lookAndFeel'], { whatToBuild: `A booking page for ${fx.client}`, whoItIsFor: '', lookAndFeel: '', pages: [] } as never, template);
  } },
  { name: 'delivery', purpose: 'delivery', site: 'delivery/deliverable.ts', build: fx => deliveryTask({
    serviceType: 'bookkeeping', offer: { name: `${fx.owner} monthly books`, description: `Books closed by ${fx.date}` }, clientRequest: `Close the books for ${fx.client}`,
    idea: fx.idea, refs: refs(fx), containsClientData: true, templateTotalRef: 'offer_1.total',
    knowledge: [{ id: `source_${fx.id}`, text: `${fx.owner} prefers short replies` }] as never,
  }) },
  { name: 'agent-turn', purpose: 'agent-turn', site: 'delivery/harness/loop.ts', build: fx => actTask(loopContext(fx), harnessState(fx)) },
  { name: 'harness-write', purpose: 'delivery', site: 'delivery/harness/loop.ts', build: fx => writeTask({
    ...(loopContext(fx) as object), proven: [`Ledger for ${fx.client} matched on ${fx.date}`], priceRefs: refs(fx), idea: fx.idea, templateTotalRef: 'offer_1.total', writeKnowledge: [{ id: `source_${fx.id}`, text: fx.owner }],
  } as never, { ...harnessState(fx), phase: 'write' } as never, []) },
  { name: 'judge', purpose: 'judge', site: 'delivery/judge.ts', build: fx => judgeTask({ expectedOutcome: `Books for ${fx.client} closed`, persona: fx.client,
    draft: `Dear ${fx.client}, your books to ${fx.date} are closed.`, figureLabels: [`total ${fx.amount}`] }) },
  { name: 'judge-pairwise', purpose: 'judge', site: 'delivery/judge/pairwise.ts', build: fx => pairwiseTask({ question: `Which reply suits ${fx.client}?`,
    first: `Reply one for ${fx.client}`, second: `Reply two dated ${fx.date}`, containsClientData: true }) },
  { name: 'client-sim', purpose: 'client-sim', site: 'delivery/simulate.ts', build: fx => clientSimTask({ persona: fx.client, brief: `Close my books by ${fx.date}` } as never,
    'bookkeeping', [{ from: 'agent', text: `Hello ${fx.client}` }] as never) },
  { name: 'triage-rule', purpose: 'triage-rule', site: 'views/triage.ts', build: fx => triageTask(`Show ${fx.client} first, then orders over ${fx.amount}`) },
  { name: 'app-make', purpose: 'chief-chat', site: 'apps/make.ts', build: fx => makeTask(`A page for ${fx.client}`, { name: `${fx.owner} app`, html: `<p>${fx.date}</p>` }) },
  { name: 'goal-suggest', purpose: 'goal-suggest', site: 'money/goals.ts', build: fx => goalSuggestTask(fx.month, 'INR', [{ name: `${fx.owner} books`, per: 'month', price: fx.amount }] as never) },
  { name: 'outreach-draft', purpose: 'outreach-draft', site: 'network/outreach.ts',
    build: fx => ({ instructions: outreachInstructions({ language: 'en', channel: 'email', kind: 'follow-up' }) }),
    variants: () => (['en', 'hi'] as const).flatMap(language => (['email', 'linkedin', 'whatsapp'] as const).flatMap(channel => (['intro-request', 'double-opt-in', 'connection-note', 'follow-up', 'reply', 'cold-email'] as const).map(kind => outreachInstructions({ language, channel, kind })))) },
];

/** The input as JSON text, the way the routes send it. */
export const inputText = (built: Built): string => JSON.stringify(built.input ?? null);
export const schemaText = (built: Built): string => JSON.stringify(built.schema ?? null);
export type { Json };
