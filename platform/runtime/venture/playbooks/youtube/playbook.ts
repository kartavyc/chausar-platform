// Chausar flagship playbook, YouTube channel (design 7.8): the playbook as data. Three offers, ten typed delivery steps
// with their roles, four approvals, the always-ask floor, the intake form, and connectors labelled with what the code
// does today. Footage is cut only under rights recorded at intake (delivery/rights.ts). Prices are the owner's, set on
// the plan and turned into receipts; nothing here holds a price.
//
// Built from the research cards of 21 October 2026. Ideas taken, code written here: Jakeschincariol/youtube-agent-skill
// (MIT) for the split between writing and scoring; diffusionstudio/editor (MPL-2.0, ideas only) for the order of work,
// a cheap audio pass before anything else; bridge-mind/bridgeclip (MIT) for choosing moments by transcript segment ids
// only; veedstudio/open-edit (Apache-2.0) for the quote, approve and spend shape of paid generation.
import { check } from '../../../contracts.ts';
import type { CheckId, ExecutionTier, ModelTier, PlaybookStep, PostingOption, PricingModel, StepKind, ToolName } from '../../contracts.ts';
import { DRAFT_CHECKS, VERIFY_CHECKS } from '../../delivery/check-lists.ts';
import { RIGHTS_INTAKE_FIELD, type RightsBasis } from '../../delivery/rights.ts';
import { NOT_PROBED, postingOptions, type PostingEnvironment } from '../../build/posting.ts';
import { YOUTUBE_ID, YOUTUBE_LABEL } from './registration.ts';

// ---------------------------------------------------------------------------
// Offers
// ---------------------------------------------------------------------------

export type YoutubeOfferId = 'episode-package' | 'shorts-from-own-video' | 'licensed-clips';
export type YoutubeOffer = {
  id: YoutubeOfferId;
  name: string;
  description: string;
  /** How the owner charges it by default; the owner sets the price. */
  pricing: PricingModel;
  unit: string;
  /** The rights bases this offer accepts at intake. */
  rightsBases: readonly RightsBasis[];
  deliverables: readonly string[];
};

export const YOUTUBE_OFFERS: readonly YoutubeOffer[] = Object.freeze([
  {
    id: 'episode-package', name: 'Episode package', pricing: 'project', unit: 'per video',
    description: "From the client's raw footage or idea: a script with scored hooks, an edit list and first cut, a title and thumbnail pair, a description with chapters, and a pinned comment.",
    rightsBases: Object.freeze(['own-footage', 'licence'] as RightsBasis[]),
    deliverables: Object.freeze(['Script with two scored hooks', 'Edit list and first cut', 'Title and thumbnail text', 'Description with chapters', 'Pinned comment']),
  },
  {
    id: 'shorts-from-own-video', name: 'Shorts from your own video', pricing: 'project', unit: 'per batch',
    description: 'From one long video the client owns: self-contained vertical clips with captions and a title for each.',
    rightsBases: Object.freeze(['own-footage'] as RightsBasis[]),
    deliverables: Object.freeze(['Vertical clips with captions', 'A title for each clip', 'Where each clip came from in the long video']),
  },
  {
    id: 'licensed-clips', name: 'Clips under a licence or clip programme', pricing: 'monthly', unit: 'per month',
    description: "Clips from another creator's show, only under a licence or the creator's clip programme recorded at intake, each crediting the source.",
    rightsBases: Object.freeze(['licence', 'creator-clip-programme'] as RightsBasis[]),
    deliverables: Object.freeze(['Clips with captions', 'A title for each clip', 'A source credit line in every description']),
  },
] satisfies YoutubeOffer[]).map(offer => Object.freeze(offer));

export function youtubeOffer(id: YoutubeOfferId): YoutubeOffer {
  const offer = YOUTUBE_OFFERS.find(item => item.id === id);
  check(offer, 'INVALID_VENTURE_REQUEST', 'That is not one of the YouTube channel offers.');
  return offer;
}

export function offerAcceptsRights(id: YoutubeOfferId, basis: RightsBasis): boolean {
  return youtubeOffer(id).rightsBases.includes(basis);
}

// ---------------------------------------------------------------------------
// Steps, approvals and the floor
// ---------------------------------------------------------------------------

export type ApprovalId = 'rights-at-intake' | 'quote-before-paid-generation' | 'draft-after-viewing' | 'owner-publishes';
export type StepRole =
  | { kind: 'agent'; name: string; job: string }
  | { kind: 'code'; job: string }
  | { kind: 'owner'; job: string };
/** The deterministic checks a step runs (checks.ts and finishing.ts). */
export type YoutubeCheckId =
  | 'hook-score' | 'title-thumbnail' | 'metadata-limits' | 'chapters' | 'retention-risk' | 'ai-disclosure'
  | 'paid-promotion' | 'rights-recorded' | 'source-credit' | 'finishing';

export type YoutubeStep = {
  id: string;
  kind: StepKind;
  title: string;
  role: StepRole;
  tier: ExecutionTier;
  model: ModelTier | null;
  tools: readonly ToolName[];
  /** The harness checks (delivery/checks.ts) the step runs. */
  checks: readonly CheckId[];
  youtubeChecks: readonly YoutubeCheckId[];
  requiredSections: readonly string[];
  /** True for the one step that cuts footage. It calls requireRights before it starts. */
  clipping: boolean;
  /** The approval that holds this step until the owner answers. */
  gate: ApprovalId | null;
  /** Why this step asks the owner at every posture, or null. */
  floor: string | null;
};

export const PACKAGE_SECTIONS: readonly string[] = Object.freeze(['Summary', 'Title and thumbnail', 'Description and chapters', 'Next steps']);
const FLOOR = Object.freeze({
  rights: 'Footage is cut only after you confirm the rights to it, at every posture.',
  money: 'Paid generation spends money, so it asks you first at every posture.',
  send: 'Sending to a client always asks you first.',
  publish: 'Publishing is always yours. Chausar never posts a video.',
});

const agent = (name: string, job: string): StepRole => ({ kind: 'agent', name, job });
const code = (job: string): StepRole => ({ kind: 'code', job });
const owner = (job: string): StepRole => ({ kind: 'owner', job });
const none: readonly never[] = Object.freeze([]);

export const YOUTUBE_STEPS: readonly YoutubeStep[] = Object.freeze([
  {
    id: 'intake', kind: 'gather', title: "Read the order and the client's files, and record the rights to the footage",
    role: agent('Intake clerk', 'Reads the order, the footage notes, the transcript and the brief, and lists what is missing.'),
    tier: 'actor', model: 'fast', tools: ['files.list', 'files.read', 'handoff.client', 'handoff.owner'], checks: none, youtubeChecks: ['rights-recorded'],
    requiredSections: none, clipping: false, gate: 'rights-at-intake', floor: FLOOR.rights,
  },
  {
    id: 'clarify', kind: 'question', title: 'Ask about the length, the audience, the one ask at the end and what to avoid',
    role: agent('Producer', 'Asks the client about anything the brief leaves open. Asking ends the turn.'),
    tier: 'actor', model: 'fast', tools: ['handoff.client', 'handoff.owner'], checks: ['questions-raised'], youtubeChecks: none,
    requiredSections: none, clipping: false, gate: null, floor: null,
  },
  {
    id: 'probe', kind: 'compute', title: 'Read the transcript timings, the silences and the likely drop points',
    role: code('Reads the transcript the client sent and finds dead air, filler, restarts and slow openings. No model.'),
    tier: 'code', model: null, tools: none, checks: none, youtubeChecks: ['retention-risk'],
    requiredSections: none, clipping: false, gate: null, floor: null,
  },
  {
    id: 'find', kind: 'work', title: 'Write the hooks, or pick the moments by transcript segment',
    role: agent('Story editor', 'Writes five opening hooks, or proposes clip moments only as transcript segment ids. Never invents speech or times.'),
    tier: 'actor', model: 'main', tools: ['files.read', 'handoff.owner'], checks: none, youtubeChecks: none,
    requiredSections: none, clipping: false, gate: null, floor: null,
  },
  {
    id: 'score', kind: 'compute', title: 'Score the hooks and keep the best two',
    role: code('Scores each hook on five properties and ranks them. A low score is a reason to look again, never a forecast.'),
    tier: 'code', model: null, tools: none, checks: none, youtubeChecks: ['hook-score'],
    requiredSections: none, clipping: false, gate: null, floor: null,
  },
  {
    id: 'assemble', kind: 'compute', title: 'Build the edit list from the chosen segments, with any paid voice quoted first',
    role: code('Builds the edit list from segment ids and snaps it to frames. A paid AI voice or presenter waits for your approval of its quote.'),
    tier: 'code', model: null, tools: none, checks: none, youtubeChecks: ['rights-recorded'],
    requiredSections: none, clipping: true, gate: 'quote-before-paid-generation', floor: FLOOR.money,
  },
  {
    id: 'package', kind: 'write', title: 'Draft the title, thumbnail text, description, chapters and pinned comment',
    role: agent('Packager', 'Writes the title and thumbnail pair, the description with chapters, the pinned comment and any disclosure line.'),
    tier: 'actor', model: 'main', tools: none, checks: DRAFT_CHECKS, youtubeChecks: ['title-thumbnail', 'metadata-limits', 'chapters', 'ai-disclosure', 'paid-promotion', 'source-credit'],
    requiredSections: PACKAGE_SECTIONS, clipping: false, gate: null, floor: null,
  },
  {
    id: 'verify', kind: 'verify', title: 'Check the package and the finished cut',
    role: code('Runs every check above again, then the finishing check on the cut when ffmpeg is on this computer.'),
    tier: 'code', model: null, tools: none, checks: VERIFY_CHECKS,
    youtubeChecks: ['hook-score', 'title-thumbnail', 'metadata-limits', 'chapters', 'retention-risk', 'ai-disclosure', 'paid-promotion', 'rights-recorded', 'source-credit', 'finishing'],
    requiredSections: none, clipping: false, gate: null, floor: null,
  },
  {
    id: 'review', kind: 'approve', title: 'You watch the cut and read the package',
    role: owner('Watches the cut and reads the package before anything reaches the client.'),
    tier: 'code', model: null, tools: none, checks: none, youtubeChecks: none,
    requiredSections: none, clipping: false, gate: 'draft-after-viewing', floor: FLOOR.send,
  },
  {
    id: 'publish', kind: 'operator', title: 'You or the client upload and publish in YouTube Studio',
    role: owner('Uploads in YouTube Studio, ticks the AI use and paid promotion settings when the order needs them, and publishes.'),
    tier: 'code', model: null, tools: none, checks: ['no-outside-writes'], youtubeChecks: none,
    requiredSections: none, clipping: false, gate: 'owner-publishes', floor: FLOOR.publish,
  },
] satisfies YoutubeStep[]).map(step => Object.freeze(step));

export type YoutubeApproval = {
  id: ApprovalId;
  step: string;
  words: string;
  /** The owner must open the item before the approve action works. */
  requiresView: boolean;
  /** A second confirm inside the row; a keyboard shortcut never runs it. */
  secondAsk: boolean;
  /** How long an approval holds before it must be asked again; null for no limit. */
  expiresAfterMinutes: number | null;
};

export const YOUTUBE_APPROVALS: readonly YoutubeApproval[] = Object.freeze([
  { id: 'rights-at-intake', step: 'intake', words: 'Confirm the footage is the client\'s own, licensed, or covered by the creator\'s clip programme. No rights, no order.', requiresView: true, secondAsk: false, expiresAfterMinutes: null },
  { id: 'quote-before-paid-generation', step: 'assemble', words: 'Approve the quote for any AI voice, presenter or generated footage before it is paid for. One approval buys one run of that exact script.', requiresView: true, secondAsk: true, expiresAfterMinutes: 60 },
  { id: 'draft-after-viewing', step: 'review', words: 'Watch the cut and read the package before it reaches the client.', requiresView: true, secondAsk: false, expiresAfterMinutes: null },
  { id: 'owner-publishes', step: 'publish', words: 'You or the client publish in YouTube Studio. Chausar never says a video was posted.', requiresView: false, secondAsk: false, expiresAfterMinutes: null },
] satisfies YoutubeApproval[]).map(item => Object.freeze(item));

// ---------------------------------------------------------------------------
// Intake, hard lines
// ---------------------------------------------------------------------------

export type IntakeField = { id: string; label: string; help: string; kind: 'rights' | 'choice' | 'yes-no' | 'text'; options?: readonly { id: string; label: string }[] };

export const YOUTUBE_INTAKE_FIELDS: readonly IntakeField[] = Object.freeze([
  { id: 'rights', label: RIGHTS_INTAKE_FIELD.label, help: RIGHTS_INTAKE_FIELD.help, kind: 'rights', options: RIGHTS_INTAKE_FIELD.options.map(option => ({ id: option.id, label: option.label })) },
  { id: 'offer', label: 'What the client ordered', help: 'Picks the steps and the rights this order needs.', kind: 'choice', options: YOUTUBE_OFFERS.map(offer => ({ id: offer.id, label: offer.name })) },
  { id: 'format', label: 'Long video or Shorts', help: 'Shorts are checked for a vertical or square frame and their length.', kind: 'choice', options: [{ id: 'long', label: 'Long video' }, { id: 'short', label: 'Shorts' }] },
  { id: 'audience', label: 'Who the video is for', help: 'In the client\'s words.', kind: 'text' },
  { id: 'the-ask', label: 'The one ask at the end', help: 'For example, subscribe, book a call, or nothing.', kind: 'text' },
  { id: 'avoid', label: 'Topics or people to leave out', help: 'The agents never mention them.', kind: 'text' },
  { id: 'ai-voice', label: 'Uses an AI voice', help: 'If yes, the description says so and the AI use setting is ticked at upload.', kind: 'yes-no' },
  { id: 'ai-presenter', label: 'Uses an AI presenter', help: 'If yes, the description says so and the AI use setting is ticked at upload.', kind: 'yes-no' },
  { id: 'paid-promotion', label: 'Includes paid promotion', help: 'If yes, the paid promotion setting is ticked at upload.', kind: 'yes-no' },
] satisfies IntakeField[]).map(field => Object.freeze(field));

export const YOUTUBE_HARD_LINES: readonly string[] = Object.freeze([
  "Footage is cut only under rights recorded at intake: the client's own, a licence, or the creator's clip programme, with its reference.",
  'Any AI voice or AI presenter is disclosed, in the description and with the AI use setting at upload, every time.',
  'Nothing is posted without the owner. The owner or the client publishes in YouTube Studio.',
  'Scores and retention figures come from code. A number a model writes is shown as a model estimate, never with a receipt.',
  'No offer makes videos in bulk from a template, and nothing hides that it was automated.',
]);

// ---------------------------------------------------------------------------
// Connectors with honest modes
// ---------------------------------------------------------------------------

export type YoutubeConnectorMode = { mode: 'handoff' | 'read' | 'write'; status: 'available' | 'planned'; what: string; reason: string | null };
export type YoutubeConnector = { id: string; name: string; modes: YoutubeConnectorMode[]; posting: PostingOption[] };
export type YoutubeConnectorEnv = { ffmpeg: boolean; posting?: PostingEnvironment };

const planned = (mode: YoutubeConnectorMode['mode'], what: string, reason: string): YoutubeConnectorMode => ({ mode, status: 'planned', what, reason });
const available = (mode: YoutubeConnectorMode['mode'], what: string): YoutubeConnectorMode => ({ mode, status: 'available', what, reason: null });

/** The connectors this playbook uses, labelled with what this build does. Upload modes come from the posting module. */
export function youtubeConnectors(env: YoutubeConnectorEnv): YoutubeConnector[] {
  const posting = postingOptions('youtube', env.posting ?? NOT_PROBED);
  return [
    { id: 'client-files', name: 'Client files', posting: [], modes: [available('read', 'Reads the transcripts (SRT or VTT) and YouTube Studio exports the client uploads.')] },
    {
      id: 'ffmpeg', name: 'ffmpeg on this computer', posting: [],
      modes: [env.ffmpeg
        ? available('read', 'Runs the finishing check on the cut: black, frozen and silent spans, sound levels, length and frame.')
        : planned('read', 'Runs the finishing check on the cut.', 'ffmpeg not found on this computer. Chausar never installs it; the check reports that it did not run.')],
    },
    { id: 'youtube-upload', name: 'YouTube upload', posting, modes: [] },
    {
      id: 'youtube-comments', name: 'YouTube comments', posting: [],
      modes: [
        planned('handoff', 'The pinned comment and replies are drafts you post in YouTube Studio.', 'The engine drafts them, but no screen opens YouTube Studio for them yet.'),
        planned('write', 'Posts replies through the YouTube Data API after you approve each one.', "Planned until Google's review of the app and a client in this build."),
      ],
    },
    {
      id: 'messages', name: 'Messages to rights holders and collaborators', posting: [],
      modes: [
        planned('handoff', 'Licence and clip programme requests are drafts you send yourself.', 'The engine drafts them, but no screen opens them yet.'),
        planned('write', 'Sends messages after you approve each one.', 'Planned until the platform reviews the app; drafts only until then.'),
      ],
    },
    {
      id: 'youtube-data', name: 'YouTube Data API (public videos, the client\'s own channel)', posting: [],
      modes: [planned('read', 'Reads public video data and the client\'s channel list with the client\'s own Google key.', 'No YouTube Data API client ships in this build.')],
    },
    {
      id: 'youtube-analytics', name: 'YouTube Analytics (the client\'s channel)', posting: [],
      modes: [planned('read', 'Reads retention for the channel review with read-only access the channel owner grants.', 'Not built. Until then the client uploads the Studio retention export, which the checks read.')],
    },
    {
      id: 'transcription', name: 'Transcription with word timings', posting: [],
      modes: [planned('read', 'Makes a transcript with word timings from the footage on this computer.', 'Not built. Until then the client sends an SRT or VTT file.')],
    },
    {
      id: 'paid-generation', name: 'AI voice, presenter and video models', posting: [],
      modes: [planned('write', 'Generates a voice, a presenter or footage, only through a quote you approve, recorded before it is paid for.', 'No generation provider is wired in this build.')],
    },
    {
      id: 'editor-handoff', name: 'Your video editor', posting: [],
      modes: [planned('handoff', 'Hands the edit list to the editor you open, so you finish the cut there.', 'The edit list is built, but no export for an editor is in this build yet.')],
    },
  ];
}

// ---------------------------------------------------------------------------
// The playbook, its validation and the harness adapter
// ---------------------------------------------------------------------------

export type YoutubePlaybook = {
  id: string;
  label: string;
  serviceType: 'studio';
  offers: readonly YoutubeOffer[];
  steps: readonly YoutubeStep[];
  approvals: readonly YoutubeApproval[];
  intake: readonly IntakeField[];
  hardLines: readonly string[];
};

export const YOUTUBE_PLAYBOOK: YoutubePlaybook = Object.freeze({
  id: YOUTUBE_ID, label: YOUTUBE_LABEL, serviceType: 'studio', offers: YOUTUBE_OFFERS, steps: YOUTUBE_STEPS, approvals: YOUTUBE_APPROVALS,
  intake: YOUTUBE_INTAKE_FIELDS, hardLines: YOUTUBE_HARD_LINES,
});

const AGENT_KINDS: readonly StepKind[] = ['gather', 'question', 'work', 'write'];
const fail = (message: string): never => { throw new Error(message); };

/**
 * The playbook's own rules on top of the harness's: one cutting step, gated by the rights confirmed at intake;
 * clips of other shows never accept own footage; every gate names a listed approval; publishing comes after review;
 * and the steps that confirm rights, spend money, send to the client or publish stay in the always-ask floor.
 */
export function validateYoutubePlaybook(playbook: YoutubePlaybook): void {
  const steps = playbook.steps;
  const approvals = new Map(playbook.approvals.map(item => [item.id, item]));
  if (steps.length !== 10) fail('The YouTube channel playbook has ten steps.');
  const rights = approvals.get('rights-at-intake');
  if (!rights || steps[0].gate !== 'rights-at-intake') fail('The first step must ask the owner to confirm the rights to the footage.');
  const cutting = steps.filter(step => step.clipping);
  if (cutting.length !== 1 || cutting[0].id !== 'assemble') fail('Only the assemble step may clip footage.');
  for (const step of steps) {
    if (step.role.kind === 'agent' && !AGENT_KINDS.includes(step.kind)) fail(`The step ${step.id} gives an agent a step only code or the owner does.`);
    if (step.role.kind !== 'agent' && (step.model !== null || step.tools.length)) fail(`The step ${step.id} is done by code or the owner and uses no model or tools.`);
    if (step.role.kind === 'owner' && step.kind !== 'approve' && step.kind !== 'operator') fail(`The owner's step ${step.id} must be an approval or the publishing step.`);
    if (step.gate !== null && approvals.get(step.gate)?.step !== step.id) fail(`The step ${step.id} names an approval that does not belong to it.`);
  }
  for (const approval of playbook.approvals) if (!steps.some(step => step.gate === approval.id)) fail(`The approval ${approval.id} gates no step.`);
  const reviewAt = steps.findIndex(step => step.id === 'review' && step.kind === 'approve');
  const publishAt = steps.findIndex(step => step.kind === 'operator');
  if (reviewAt < 0 || publishAt < reviewAt) fail('Publishing must come after you review the draft and approve it.');
  const clips = playbook.offers.find(offer => offer.id === 'licensed-clips');
  if (!clips || clips.rightsBases.includes('own-footage') || !clips.rightsBases.length) fail('Clips of another show need a licence or a clip programme, never own footage.');
  for (const id of ['intake', 'assemble', 'review', 'publish']) if (!steps.find(step => step.id === id)?.floor) fail(`The step ${id} must stay in the always-ask floor.`);
}

/** The steps that ask the owner at every posture. */
export function floorSteps(playbook: YoutubePlaybook = YOUTUBE_PLAYBOOK): YoutubeStep[] {
  return playbook.steps.filter(step => step.floor !== null);
}

/** The steps in the delivery harness's own shape, so validatePlaybook and the run loop can use them. */
export function youtubeEngineSteps(playbook: YoutubePlaybook = YOUTUBE_PLAYBOOK): PlaybookStep[] {
  return playbook.steps.map(step => ({
    id: step.id, kind: step.kind, title: step.title, tier: step.tier, model: step.model,
    doneBy: step.role.kind === 'owner' ? 'you' : 'agent',
    requiredSections: [...step.requiredSections], checks: [...step.checks], tools: [...step.tools], guidance: [],
  }));
}
