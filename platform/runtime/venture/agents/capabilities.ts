// Chausar venture launcher, agents (Ink v2 wave 4, package 4J18, catalogue A16): the capability page, what one agent can
// see, what it can do, and what is off ("If it is off here, it can't do it"). Everything on it is worked out by code
// from what a run really obeys. A run has one act loop whose grant is the union of its act steps' tools
// (delivery/harness/loop.ts playbookGrant), offered as this host can run them and with agent.delegate only when the
// owner's Claude Code or Codex is set up here; so every AI role that owns an act step shows that one team list, and the
// page says the team shares it. What each turn carries (the client's request, file names, the dictionary, answers,
// notes and sources from what the AI knows, which can hold other clients' work) is on "can see"; each turn going to the
// owner's own AI provider is on "can do". Steps say what they really do: the fixed steps' hands-on work is the owner's
// (STEP_PLAN; an agent doing it is planned outside bookkeeping), a step whose floor spends on something not built is
// planned and counts money as reached, a check step says when an AI judge reads the draft (the business's judge
// setting), and a step that needs a connector mode this build lacks is planned. Every line carries its state: works,
// reads, records, hands off, planned or off. An empty list never means everything. The words are typed against the
// engine's own lists, so a new tool or effect cannot ship without them. Reads only; no model is asked.
import { check, type Context, type State } from '../../contracts.ts';
import { STEP_PLAN, TOOL_NAMES } from '../contracts.ts';
import type {
  CapabilityItemView, CapabilityPageView, PlaybookStep, ServiceType, ToolName, VentureDeps, VentureHostKind, VentureRecord,
} from '../contracts.ts';
import { exactPayload, identifier } from '../records.ts';
import { acceptedBlueprintOrNull, readAs } from '../delivery/shared.ts';
import { currentPlaybook, deliveryFlagship, playbookSteps } from '../delivery/playbook.ts';
import { playbookGrant } from '../delivery/harness/loop.ts';
import { hostRefusal } from '../delivery/harness/tools.ts';
import { delegateOffer } from '../delivery/harness/delegate.ts';
import { judgeAutoOf } from '../delivery/judge-run.ts';
import { flagshipDelivery } from '../playbooks/steps.ts';
import { YOUTUBE_STEPS } from '../playbooks/youtube/playbook.ts';
import { YOUTUBE_ID } from '../playbooks/youtube/registration.ts';
import { SOCIAL_STEPS } from '../playbooks/social/playbook.ts';
import { SOCIAL_AGENCY_ID } from '../playbooks/social/registration.ts';
import { CA_FIRM_ID } from '../playbooks/ca-firm/registration.ts';
import { classifyEffects, EFFECT_KINDS, toolDeclaration, type EffectKind } from '../policy/effects.ts';
import { catalogueEntry, connectorName } from '../build/catalogue.ts';
import { connectorModes } from '../build/connectors.ts';
import { AGENT_ID, agentName } from '../views/shared.ts';
import { KEEPER_ID } from './roles.ts';

/** What each of Chausar's tools lets an agent see or do, in the owner's words. Typed against TOOL_NAMES. */
export const TOOL_WORDS: Readonly<Record<ToolName, string>> = Object.freeze({
  'files.list': 'The list of files the client sent with the order.',
  'files.read': 'The files the client sent with the order: tables, PDF text and transcript lines.',
  'dictionary.browse': 'Your business dictionary: its terms, offers, steps and settings.',
  'dictionary.resolve': 'What a word or name means in your business dictionary.',
  'calc.sum': "Totals the calculator works out from the order's tables, each with a receipt.",
  'calc.totals': "Totals by group the calculator works out from the order's tables, each with a receipt.",
  'books.reconcile': 'A bank statement matched to bills by the calculator, with a receipt.',
  'bills.pick': 'Bill totals and dates picked from PDF bills by their ids.',
  'sandbox.transform': "New tables it makes from the order's tables in the light sandbox, which has no network.",
  'sandbox.python': 'New tables made by Python in a container with no network, where Docker Desktop is set up.',
  'handoff.client': 'Ask the client a question. You pass it on: nothing reaches the client without you.',
  'handoff.owner': 'Ask you a question and wait for your answer.',
  'outbox.propose': 'Propose an outside action for your approval. Nothing is sent.',
  'agent.delegate': 'Hand a big job to your own Claude Code or Codex on this computer, only after you approve its brief.',
  'tax.income': "Income tax worked out by the calculator from amounts in the client's files, with a receipt.",
  'tax.interest': 'Interest for a late return or short advance tax worked out by the calculator, with a receipt.',
  'tax.gst': "A month's GST working worked out by the calculator from the sales and purchase registers, with a receipt.",
  'tax.tds': "A year's TDS working worked out by the calculator from a payments table, with a receipt.",
  'tax.statements': 'The books matched to AIS, 26AS and Form 16 by the calculator, with every difference on a receipt.',
  'tax.portal': "The portal's own figures compared with Chausar's receipts, to the paisa.",
  'youtube.hooks': 'Its opening hooks scored by code, keeping the best two.',
  'youtube.editList': 'An edit list built by code from transcript segments it picks.',
  'youtube.chapters': 'Chapters drafted by code from the pauses in the transcript.',
  'youtube.retention': 'A YouTube Studio audience retention export, read by code.',
  'social.report': "A month's report figures worked out by code from the client's platform exports, with a receipt.",
  'evidence.record': 'Note one fact about the client or your business and where it came from, as a suggestion you apply.',
  // Ink v2 wave 5 (package 5-0; each package keeps its own lines)
  // the kit (5A3, 5A4, 5A6)
  'ideas.add': 'Add a suggestion to your ideas list, marked with the role that made it. Nothing else changes.',
  'assets.record': 'Record where a file it delivers came from: its source, licence, credit and cost.',
  'media.clean': 'Remove location and camera data from the order\'s clip on this computer, into a new file beside it. Photos are cleaned when they are added.',
  'localapp.run': 'Run an app you installed on this computer, only the exact command you approved.',
  'mail.read': "Read this order's client's mail, imported or from your read-only mailbox, screened first.",
  'speech.say': 'Quote turning text into speech with your own provider and a licensed voice. It spends nothing.',
  // YouTube (5B1 to 5B3)
  'youtube.editOps': 'Typed edits on the transcript\'s word ids, each applied whole or refused with a reason.',
  'youtube.clean': 'Silences and fillers to cut, found by code from the word times and the audio.',
  'youtube.captions': 'Captions grouped by code from the stored word times, with findings for each cue.',
  'youtube.coverage': 'How much of the script was said, the missing passages and the retakes, worked out by code.',
  'youtube.dictionary': 'Fixes to names in the transcript, applied only where your names list matches.',
  'youtube.style': 'The cut rate, shot length, loudness and pace of your own videos, measured by code.',
  'youtube.clips': 'Clips that start and end on a sentence and fit the length rules, checked by code.',
  'youtube.broll': 'A b-roll plan placed on the words, from owned or licensed footage only.',
  'youtube.beats': 'Timecodes for the lines it wrote, set by code at the speaking rate.',
  'youtube.export': 'The edit list as files your editor opens, written to the order\'s folder.',
  'youtube.afterPublish': 'What to change next, from the Studio export, with its receipts.',
  'youtube.outliers': 'The videos that did best against the channel\'s own median, worked out by code.',
  'youtube.niche': 'Medians, ages and coverage for a niche report, worked out by code.',
  'youtube.comments': 'The comments from an export, sorted into piles with counts first.',
  'youtube.publicStats': 'Public video and channel stats, read with your own API key, counting the quota.',
  'youtube.archive': 'Your own past transcripts, searched in short windows. Speech only.',
  // the CA firm (5C1, 5C2)
  'tax.citations': 'Each section a draft cites, checked against the citations table your CA confirmed.',
  'tax.formChooser': 'The ITR form for the year, picked by dated rules from the client\'s facts.',
  'tax.advance': 'Advance tax instalment dates and shares from a dated table, the estimate labelled as the client\'s.',
  'tax.whatIf': 'Tax under the other regime, at a cliff or for a target, worked out by the calculator.',
  'books.healthCheck': 'Every ledger and bank line read for duplicates, missing GSTINs and cash limits.',
  'docs.entry': 'A bank statement or bill read into entries that must tie, page by page.',
  // social (5D1 to 5D3)
  'social.formats': 'Each channel\'s format, picked by code rules with the rule trace.',
  'social.inventory': 'The claims, numbers, stories and quotes a source holds, with counts.',
  'social.slots': 'Value and selling slots for the month, with the selling share checked by code.',
  'social.montage': 'A reel cut plan from the client\'s clips, on the beat grid.',
  'social.inbox': 'Comments and messages from an export or paste, sorted with counts first.',
  'social.diagnose': 'A post\'s export run through a code checklist before any view of it.',
  'social.health': 'The account\'s followers, age and posts, each tagged by its source.',
  'social.adStyle': 'The video ad\'s style, picked by code from the product category.',
  'social.fairPrice': 'A creator\'s fair price from comparable posts, with a receipt, under your cap.',
  'social.keywords': 'Keyword groups for the influencer search, competitor terms kept apart.',
  // seo-visibility (5E1, 5E2)
  'seo.diagnose': 'The client\'s site checked on eight fixed dimensions, robots respected.',
  'seo.aiAccess': 'What search and AI fetchers may read on the site, rule by rule.',
  'seo.panel': 'The answer panel figures with their counts, missing slots kept in.',
  'seo.siteCheck': 'The website check you installed, run on the public site.',
  'seo.corroborate': 'A second, independent source for each number an article states.',
  'seo.lint': 'An article checked for AI-tell words and doorway pages.',
  'seo.meta': 'Titles, descriptions and structured data from fields seen on the page.',
  'seo.impact': 'What a change did, read from the Search Console export after it settled.',
  'seo.refresh': 'A plan of which pages to refresh and how, never an edit to a live post.',
  'seo.local': 'The business\'s name, address and phone checked across the listings you named.',
  // online-seller (5F1, 5F2, 5F3)
  'seller.unitEconomics': 'The profit on each item after fees, shipping and returns, worked out by code.',
  'seller.ads': 'The ads report read into spend and sales by product.',
  'seller.settlement': 'Marketplace payouts checked against the orders and the fee card.',
  'seller.listing': 'Listings checked against the marketplace rules and the India checks.',
  'seller.stage': 'A listing or price change staged for you to approve. Nothing goes live.',
  'seller.alerts': 'What needs attention today, from the latest exports.',
  'seller.stock': 'Stock counted from the movements, by code.',
  'seller.shortlist': 'Products to research, shortlisted from the data you added.',
  'seller.catalogueSheet': 'A marketplace\'s bulk upload sheet, filled for you to check and upload.',
  'seller.multiStore': 'Your stores compared side by side from their exports.',
  // support-desk (5G)
  'support.match': 'The answer in the shop\'s own sources that matches a customer\'s question.',
  'support.ticket': 'A support ticket\'s state and due time, kept by code.',
  // recruiting-desk (5H)
  'recruit.criteria': 'A role turned into clear screening rules.',
  'recruit.ledger': 'The candidate ledger, each decision with quoted proof.',
  'recruit.slots': 'Interview times that fit both calendars.',
  // job-search-desk (5I)
  'career.facts': 'The client\'s own facts, each with where it came from.',
  'career.capture': 'A job listing the client pasted, saved with its source.',
  'career.shortlist': 'Jobs shortlisted against the client\'s facts.',
  'career.score': 'How well a job fits the client\'s facts, by code.',
  // translation-studio (5J1, 5J2)
  'translate.check': 'A translation checked segment by segment by code.',
  'translate.terms': 'Every term checked against the client\'s locked glossary.',
  'subtitle.check': 'Subtitles checked for timing, length and reading speed.',
  'dub.align': 'The dub lined up with the video, segment by segment.',
  'dub.verify': 'The dub heard back and scored against its text.',
  // bookkeeping-cfo (5K1, 5K2)
  'cfo.ratios': 'Days to get paid, days to pay and the cash cycle, worked out by code.',
  'cfo.scenarios': 'Cash under each scenario, worked out by code with receipts.',
  'collections.ladder': 'The reminders for what is owed, as drafts the client sends.',
  'money.checkup': 'A check-up of the client\'s money, every figure a receipt.',
  'books.write': 'The exact saved accounting proposal for owner review. This tool sends nothing.',
  'vouchers.draft': 'Vouchers drafted for the books, for you to approve.',
  'seller.books': 'Monthly seller source reconciliation and separate tax-credit receipts for CA review.',
  'books.setup': 'Client customers, vendors, categories and balanced opening entries for bookkeeper review.',
  // podcast-to-article (5L)
  'article.ledger': 'Each sentence of the article tied to where the transcript says it.',
  'article.style': 'The article checked against the client\'s style.',
  // lead-generation (5M)
  'leads.osm': 'Local businesses from OpenStreetMap, whose terms allow it.',
  'leads.enrich': 'A business\'s public details from its own site.',
  'leads.dedupe': 'Duplicate leads merged by code.',
  'community.vote': 'Community evidence scores checked by code; never votes or posts online.',
  // newsletter-studio (5N)
  'newsletter.presend': 'An issue checked before it goes: links, size and the unsubscribe line.',
  'newsletter.import': 'The subscriber list from an export, with consent kept.',
  'newsletter.slices': 'The list split into groups by code.',
  'newsletter.stats': 'An issue\'s opens and clicks from its export.',
  // tender-desk (5O)
  'tender.questions': 'Every question in the tender, listed by code.',
  'tender.ground': 'Each answer found in the client\'s own documents, with where.',
  // website-studio (5P)
  'site.requirements': 'The site\'s requirements from the brief, each checkable.',
  'site.uiReport': 'The site\'s screens checked against the requirements.',
  'site.flow': 'The screen flow checked step by step.',
  'site.preview': 'A preview of the client\'s site, read as a visitor sees it.',
  // narration-studio (5Q)
  'narration.markup': 'The script marked up for reading: pauses, names and numbers.',
  'narration.verify': 'Each narrated sentence heard back and scored against its text.',
  // virtual-assistant (5R1)
  'va.brief': 'The client\'s brief for the week from their room.',
  // data-entry-desk (5R2)
  'forms.map': 'The record\'s fields matched to the client\'s form.',
  'forms.readBack': 'A saved record read back from the client\'s system and compared.',
  // app-testing (5R3)
  'apptest.logcat': 'The test app\'s logs from the emulator on this computer.',
  'demo.plan': 'The demo video planned scene by scene.',
  // dev-agency (5R4)
  'qa.verdict': 'The verdict from the test run, by code.',
  'security.scan': 'The code scanned for security problems, with the owner of the code allowing it.',
  // monitored-data (5R5)
  'monitor.extract': 'Values from a watched page, only from the elements you picked.',
  // it-triage (5R5)
  'triage.summary': 'A triage summary of the team\'s help channel.',
  // phone-receptionist (5R6)
  'calls.cost': 'The calls\' cost worked out by code from the provider\'s dated prices.',
  'calls.log': 'A call logged with what was said and who it was handed to.',
});

/** What a turn carries without a tool, by what it is: an act turn's input, a writing turn's, and what code steps read. */
export const INPUT_WORDS = Object.freeze({
  request: "The client's request on the order and the offer it is for.",
  files: 'The names and kinds of the files on the order.',
  dictionary: "A list of your business dictionary's terms, offers and steps.",
  answers: 'Your answers to the questions the team asked, and the client answers you passed on.',
  notes: 'The notes of the agents working on the order, as background that grants nothing.',
  knowledge: 'Sources from what the AI knows that share words with the order, as background. They can include work you accepted for other clients.',
  proven: "What the team's tools proved on the order, and the team's note on each step.",
  compute: "The order's files and the work earlier steps made, read by code.",
  verify: 'The draft, to run its checks.',
} as const);
type InputKey = keyof typeof INPUT_WORDS;

/** What is off when nothing it does reaches an effect. Typed against EFFECT_KINDS. */
export const EFFECT_OFF_WORDS: Readonly<Record<EffectKind, string>> = Object.freeze({
  read: "Can't open the order's files or your business dictionary.",
  'private-read': "Can't read beyond this order: your other clients, your books, your mail or your keys.",
  write: "Can't change your records, files or connected services.",
  send: "Can't send anything to a client, a contact or the public.",
  egress: "Can't take data off this computer or hand it to another program.",
  money: "Can't move money or ask for it.",
});

const APPROVAL = 'Anything that sends, spends, posts or changes a price still waits for your approval.';
/** The line of a role that owns an act step: the team's one tool list. */
export const TEAM_LINE = "The order's AI team shares one tool list: every agent that works on the order's files can use each tool here, and Chausar's code refuses any other. Whatever is on, anything that sends, spends, posts or changes a price still waits for your approval.";
/** The line of an AI role with no act step: it holds no tools. */
export const NO_TOOLS_LINE = `It holds no tools of its own: it works from what the team found. ${APPROVAL}`;
const CODE_LINE = (name: string) => `${name} is code, not AI: it does the same steps the same way every time. ${APPROVAL}`;
/** Why agent.delegate is off when neither CLI is set up on this computer. */
export const NO_CLI = 'neither Claude Code nor Codex is set up on this computer.';
const PROVIDER = 'Send each step, with what it reads, to your own AI provider: your key or the CLI you set up.';
const JUDGE_PROVIDER = 'The AI judge sends each draft it reads to your own AI provider.';
const NOTHING_SEEN = 'Nothing: none of its steps gives it anything to read.';
const NOTHING_DONE = 'Nothing: none of its steps lets it work, ask or propose anything.';
const NOTHING_OFF = `Nothing is off: every kind of action is open to it. ${APPROVAL}`;
const WRITE_TAIL = 'You check the draft before anything leaves Chausar.';
const CODE_TAIL = 'Code does this, with no AI.';
const JUDGE_ON = 'Code runs the checks, then an AI judge reads the draft on your own AI.';
const JUDGE_OFF = 'Code runs the checks. The AI judge is off for this business.';
/** judge-run.ts judgeAudience: papers gathered for the CA of record are an internal note, never judged. */
const JUDGE_CA = 'Code runs the checks. Papers for your CA of record never go to the AI judge; only a draft that goes to a client does, on your own AI.';
const SPEND_PLANNED = "Paying for it is planned: Chausar can't buy it yet, so nothing is spent.";
const OUTBOX_MAIL = 'Propose an email for your approval. Nothing is sent: Chausar records it, and you send it yourself from your own mail app.';
const OUTBOX_LINK = 'Propose a payment link for your approval. Planned: no payment link connector is built, so the proposal is only recorded.';
const ACT_KINDS: ReadonlySet<PlaybookStep['kind']> = new Set(['gather', 'question', 'work']);
const ACT_INPUTS: readonly InputKey[] = ['request', 'files', 'dictionary', 'answers', 'notes', 'knowledge'];
const WRITE_INPUTS: readonly InputKey[] = ['request', 'proven', 'answers', 'knowledge'];
/** The steps people do (you, the client, a CA): they keep their gates but belong to no agent. */
const PEOPLE: ReadonlySet<PlaybookStep['doneBy']> = new Set(['you']);
/** The fixed steps' hands-on work step and the plan step it comes from (STEP_PLAN step_2: the owner's work). */
const FIXED_WORK_STEP = 'work';
const HANDS_ON_PLAN = STEP_PLAN.find(entry => entry.id === 'step_2')!;

/** One agent as the page reads it: its steps in playbook order, and whether it is AI or code. */
export type CapabilityRole = { id: string; name: string; kind: 'agent' | 'code'; steps: readonly PlaybookStep[] };
/**
 * The whole team as the run sees it: every step (the run's grant is theirs), the floor reasons, the steps whose floor
 * spends on something this build cannot buy, the service type (the fixed steps' bookkeeping reconciles for real), and
 * whether a flagship playbook delivers.
 */
export type CapabilityTeam = {
  steps: readonly PlaybookStep[];
  floor: Readonly<Record<string, string>>;
  spends: ReadonlySet<string>;
  serviceType: ServiceType | null;
  flagship: boolean;
  /** The flagship playbook's id: the CA firm's papers for its CA of record never go to the AI judge (judge-run.ts). */
  flagshipId?: string | null;
};
/** This computer: the host, whether Claude Code or Codex is set up here, and whether the AI judge is on. */
export type CapabilityOptions = { host: VentureHostKind | undefined; delegate: boolean; judge: boolean };

const item = (list: CapabilityItemView['list'], key: string, state: CapabilityItemView['state'], line: string): CapabilityItemView => ({ list, key, state, line });
const sentence = (text: string) => { const words = text.trim(); return /[.!?]$/.test(words) ? words : `${words}.`; };

/** Whether this build has a connector mode (build/connectors.ts, the connector truth). */
function modeAvailable(connector: string, mode: 'handoff' | 'read' | 'write'): boolean {
  const entry = catalogueEntry(connector);
  return !!entry && connectorModes(entry).some(found => found.mode === mode && found.status === 'available');
}

/** One step as a thing the agent does: what it really does, who does it, and its floor reason when it always asks. */
function stepItem(step: PlaybookStep, team: CapabilityTeam, options: CapabilityOptions): CapabilityItemView {
  const key = `step:${step.id}`;
  if (!team.flagship && step.id === FIXED_WORK_STEP) {
    // The owner's own hands-on work (STEP_PLAN): an agent reconciles for bookkeeping; anything else is planned.
    return item('do', key, team.serviceType === 'bookkeeping' ? 'works' : 'planned', `${sentence(step.title)} ${HANDS_ON_PLAN.note}`);
  }
  const lines = [sentence(step.title)];
  if (step.kind === 'write') lines.push(WRITE_TAIL);
  if (step.kind === 'verify') lines.push(!options.judge ? JUDGE_OFF : team.flagshipId === CA_FIRM_ID ? JUDGE_CA : JUDGE_ON);
  else if (step.model === null) lines.push(CODE_TAIL);
  const missing = (step.needs ?? []).find(need => !modeAvailable(need.connector, need.mode));
  if (missing) {
    lines.push(`Planned: it needs ${connectorName(missing.connector)} to ${missing.mode}, which this build does not do yet.`);
    return item('do', key, 'planned', lines.join(' '));
  }
  if (team.floor[step.id]) lines.push(sentence(team.floor[step.id]));
  if (team.spends.has(step.id)) return item('do', key, 'planned', [...lines, SPEND_PLANNED].join(' '));
  return item('do', key, 'works', lines.join(' '));
}

/** The page for one agent, by code, as described at the top. A grant that is absent counts as none (deny by default). */
export function capabilityPage(role: CapabilityRole, team: CapabilityTeam, options: CapabilityOptions): CapabilityPageView {
  const acts = role.steps.some(step => ACT_KINDS.has(step.kind));
  const writes = role.steps.some(step => step.kind === 'write');
  const thinks = role.steps.some(step => step.model !== null);
  const judged = options.judge && role.steps.some(step => step.kind === 'verify');
  // The run's one grant, the team's: only a role that owns an act step works in the loop that holds it.
  const grant = acts ? new Set<ToolName>(playbookGrant({ steps: [...team.steps] })) : new Set<ToolName>();
  const tools = TOOL_NAMES.filter(name => grant.has(name));
  const refusal = (name: ToolName) => hostRefusal(options.host, name) ?? (name === 'agent.delegate' && !options.delegate ? NO_CLI : null);
  const usable = tools.filter(name => refusal(name) === null);
  const reached = new Set<EffectKind>();
  const seeing: CapabilityItemView[] = [];
  const doing: CapabilityItemView[] = [];

  for (const name of usable) {
    if (name === 'outbox.propose') {
      for (const connector of ['mail-app', 'payment-link']) {
        for (const kind of classifyEffects({ name, input: { connector } }).effects) reached.add(kind);
        doing.push(connector === 'mail-app' && modeAvailable(connector, 'handoff')
          ? item('do', `outbox:${connector}`, 'records', OUTBOX_MAIL)
          : item('do', `outbox:${connector}`, 'planned', OUTBOX_LINK));
      }
      continue;
    }
    for (const kind of classifyEffects({ name }).effects) reached.add(kind);
    const asks = name === 'handoff.client' || name === 'handoff.owner';
    if (!asks && toolDeclaration(name)?.effects.every(kind => kind === 'read')) seeing.push(item('see', `tool:${name}`, 'reads', TOOL_WORDS[name]));
    else doing.push(item('do', `tool:${name}`, name === 'handoff.client' ? 'hands-off' : 'works', TOOL_WORDS[name]));
  }
  // What each turn carries without a tool, once each: the act loop's input, the writing turn's, and code's reading.
  const inputs: InputKey[] = [];
  if (acts) inputs.push(...ACT_INPUTS);
  if (writes) inputs.push(...WRITE_INPUTS);
  if (role.steps.some(step => step.kind === 'compute' && step.model === null)) inputs.push('compute');
  if (role.steps.some(step => step.kind === 'verify')) inputs.push('verify');
  for (const key of [...new Set(inputs)]) seeing.push(item('see', `input:${key}`, 'reads', INPUT_WORDS[key]));
  if (acts || inputs.includes('compute')) reached.add('read');
  // Sources from what the AI knows can carry work for other clients into the order's act and writing turns.
  if (acts || writes) reached.add('private-read');
  if (thinks || judged) reached.add('egress');
  if (role.steps.some(step => team.spends.has(step.id))) reached.add('money');

  const items: CapabilityItemView[] = [...(seeing.length ? seeing : [item('see', 'nothing', 'off', NOTHING_SEEN)])];
  const steps = role.steps.map(step => stepItem(step, team, options));
  // Steps first, then tools, then where each step is sent: the owner's own AI provider.
  const provider = thinks || judged ? [item('do', 'model:provider', 'works', thinks ? PROVIDER : JUDGE_PROVIDER)] : [];
  items.push(...(steps.length || doing.length ? [...steps, ...doing, ...provider] : [item('do', 'nothing', 'off', NOTHING_DONE)]));

  const off = EFFECT_KINDS.filter(kind => !reached.has(kind)).map(kind => item('off', `effect:${kind}`, 'off', EFFECT_OFF_WORDS[kind]));
  for (const name of tools) {
    const why = refusal(name);
    if (why) off.push(item('off', `${hostRefusal(options.host, name) ? 'host' : 'cli'}:${name}`, 'off', `${TOOL_WORDS[name]} Off here: ${why}`));
  }
  items.push(...(off.length ? off : [item('off', 'nothing', 'works', NOTHING_OFF)]));

  const of = (list: CapabilityItemView['list']) => items.filter(entry => entry.list === list).map(entry => entry.line);
  return {
    agent: role.id, canSee: of('see'), canDo: of('do'), off: of('off'), items,
    line: role.kind === 'code' ? CODE_LINE(role.name) : acts ? TEAM_LINE : NO_TOOLS_LINE,
  };
}

/** The steps of a flagship playbook whose floor spends on something this build cannot buy (the playbooks' own marks). */
function spendingSteps(flagship: string | null): Set<string> {
  if (flagship === YOUTUBE_ID) return new Set(YOUTUBE_STEPS.filter(step => step.gate === 'quote-before-paid-generation').map(step => step.id));
  if (flagship === SOCIAL_AGENCY_ID) return new Set(SOCIAL_STEPS.filter(step => step.paidTool).map(step => step.id));
  return new Set();
}

/** The team the business delivers with now: the playbook in use's steps, else the accepted plan's; null before a plan. */
export function capabilityTeam(state: State, venture: VentureRecord): (CapabilityTeam & { delivery: ReturnType<typeof flagshipDelivery> }) | null {
  const playbook = currentPlaybook(state, venture);
  const plan = acceptedBlueprintOrNull(state, venture);
  let steps: PlaybookStep[], id: string | null;
  if (playbook) { steps = playbook.steps; id = playbook.flagship ?? null; }
  else {
    if (!plan) return null;
    id = deliveryFlagship(venture, plan);
    try { steps = playbookSteps(plan, id); } catch { return null; }
  }
  const delivery = flagshipDelivery(id);
  return {
    steps, floor: delivery?.floor ?? {}, spends: spendingSteps(delivery ? id : null), serviceType: playbook?.serviceType ?? plan?.serviceType ?? null,
    flagship: !!delivery, flagshipId: delivery ? id : null, delivery,
  };
}

/**
 * The agent a page is for, with the steps it does: a flagship playbook's role (AI or code), else the one delivery agent
 * of the fixed steps. Keeper is AGENT_IS_CODE (its jobs are on Team); anyone else not on the team is AGENT_NOT_FOUND.
 */
export function capabilityRole(state: State, venture: VentureRecord, agentId: string): { role: CapabilityRole; team: CapabilityTeam } {
  check(agentId !== KEEPER_ID, 'AGENT_IS_CODE', 'Keeper is code, not AI. It holds no tools; its jobs are on Team.');
  const team = capabilityTeam(state, venture);
  check(team, 'AGENT_NOT_FOUND', 'That agent was not found.');
  const flagship = team.delivery;
  if (!flagship) {
    check(agentId === AGENT_ID, 'AGENT_NOT_FOUND', 'That agent was not found.');
    return { role: { id: AGENT_ID, name: agentName(state, venture), kind: 'agent', steps: team.steps.filter(step => !PEOPLE.has(step.doneBy)) }, team };
  }
  const role = flagship.roles.find(entry => entry.id === agentId);
  const own = team.steps.filter(step => flagship.roleOf[step.id] === agentId);
  check(role && own.length, 'AGENT_NOT_FOUND', 'That agent was not found.');
  return { role: { id: role.id, name: role.name, kind: role.kind, steps: own }, team };
}

/**
 * venture.agents.capabilities { agent } (read): the agent's capability page, from the playbook in use, Chausar's tool
 * declarations, the connector catalogue, this host, the owner's CLI found here and the judge setting. Changes nothing.
 */
export async function agentsCapabilitiesHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<CapabilityPageView> {
  const body = exactPayload(payload, ['agent'], ['agent']);
  const agentId = identifier(body.agent, 'Agent');
  const { state, venture } = readAs(deps, ctx, 'read');
  const { role, team } = capabilityRole(state, venture, agentId);
  const delegate = (await delegateOffer(deps)).length > 0;
  return capabilityPage(role, team, { host: deps.host, delegate, judge: judgeAutoOf(state, venture.id).auto });
}
