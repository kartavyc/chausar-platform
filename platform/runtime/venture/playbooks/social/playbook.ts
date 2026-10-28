// Chausar flagship playbook, social media agency: the data (design 7.8). Offers, the fourteen typed steps with the agent
// role behind each, the approval points (owner first, then the client through a share link record), the connectors
// with honest labels, the draft-before-schedule rule and what is never built. Words here describe what the owner and
// the agents will do, never what was done; a test runs every string through the house style and done-claim checks.
// The steps are engine PlaybookSteps plus a role and notes, so the engine's own validator passes them.
//
// Ideas taken, code written here: postmill-ai/postmill-app (AGPL-3.0, so ideas only): approved before promoted,
// refused with a reason per post; charlesdove977/UGC-Factory (MIT): confirm the brief before spending, fixed beats.
import type { CheckId, PlaybookStep, ServiceType } from '../../contracts.ts';
import { SOCIAL_CHECK_IDS, type SocialCheckId } from './check-ids.ts';
import { SOCIAL_AGENCY_REGISTRATION } from './registration.ts';

export type SocialRoleId = 'intake' | 'strategist' | 'writer' | 'creative' | 'checker' | 'analyst' | 'owner' | 'client' | 'code';
export type SocialRole = { name: string; does: string; kind: 'agent' | 'person' | 'code' };

/** Who does each step. The checker is the read-only auditor of design 7.7: it reads the real output, never writes it. */
export const SOCIAL_ROLES: Readonly<Record<SocialRoleId, SocialRole>> = Object.freeze({
  intake: { name: 'Intake', kind: 'agent', does: "Reads the client's onboarding form, brand files and proof files, and lists what is missing." },
  strategist: { name: 'Strategist', kind: 'agent', does: 'Writes the voice sheet and content pillars, then fills topics and hooks into the calendar slots code made.' },
  writer: { name: 'Writer', kind: 'agent', does: 'Drafts captions, alt text, hashtags and reply drafts for each channel, in the voice the owner approved.' },
  creative: { name: 'Creative', kind: 'agent', does: 'Writes briefs for pictures, video and creator-style ads, each with the disclosure it needs.' },
  checker: { name: 'Checker', kind: 'agent', does: 'Runs the code checks, then the yes or no judge, and reads the real output before a draft counts as ready.' },
  analyst: { name: 'Analyst', kind: 'agent', does: 'Writes the report narrative from the figures code computed, citing receipts only.' },
  owner: { name: 'You', kind: 'person', does: 'Approve the voice sheet, every draft, every post, any spend and the report.' },
  client: { name: 'Your client', kind: 'person', does: 'Approves the drafts you approved, through a share link, and uploads the platform exports.' },
  code: { name: 'Chausar', kind: 'code', does: 'Makes calendar slots, splits threads, runs the checks and computes report figures with receipts.' },
});

export type SocialStep = PlaybookStep & {
  role: SocialRoleId;
  /** What the step hands to the next one, in plain words. */
  produces: string;
  /** For approval steps: who approves, in order. */
  approvers?: ('owner' | 'client')[];
  /** Parts code fills, never the model. */
  codeOwns?: string[];
  /** The social checks this step runs, on top of the engine checks. */
  socialChecks?: SocialCheckId[];
  /** The step may call a paid tool, only after the owner sees the cost from code. */
  paidTool?: boolean;
};

const READ_TOOLS = ['files.list', 'files.read', 'handoff.client', 'handoff.owner', 'evidence.record'] as const;
const WRITE_CHECKS: CheckId[] = ['required-sections', 'house-style', 'length-bounds', 'no-done-claims'];
const ALL_SOCIAL_CHECKS = [...SOCIAL_CHECK_IDS];

/** The fourteen steps, in order. Kinds and tiers follow the engine's rules: code, approval and operator steps never use a model. */
export const SOCIAL_STEPS: readonly SocialStep[] = Object.freeze([
  {
    id: 'intake', kind: 'gather', role: 'intake', title: "Read the client's onboarding form, brand files and proof files",
    tier: 'actor', model: 'fast', doneBy: 'agent', requiredSections: [], checks: [], tools: [...READ_TOOLS, 'social.report', 'social.inventory', 'social.formats', 'social.slots'],
    guidance: ["When the client sent the month's platform exports, call social.report on them. The report cites the figure refs it returns, never a figure of its own."],
    produces: 'A list of channels, audience, competitors, banned words and topics, and the claims the client can prove with a file.',
  },
  {
    id: 'clarify', kind: 'question', role: 'intake', title: 'Ask what is still unclear, one topic at a time',
    tier: 'actor', model: 'fast', doneBy: 'agent', requiredSections: [], checks: ['questions-raised'], tools: ['handoff.client', 'handoff.owner'],
    guidance: ['Ask at most five rounds, one topic per round, most important first, then use the defaults.'],
    produces: 'Answers, or the defaults the owner accepts.',
  },
  {
    id: 'voice', kind: 'write', role: 'strategist', title: 'Write the brand voice sheet and content pillars',
    tier: 'actor', model: 'main', doneBy: 'agent', requiredSections: ['Voice', 'Pillars', 'Words to avoid'], checks: [...WRITE_CHECKS], tools: [], guidance: [],
    produces: 'A voice sheet and pillars in fixed slots.',
  },
  {
    id: 'approve-voice', kind: 'approve', role: 'owner', title: 'You approve the voice sheet and pillars',
    tier: 'code', model: null, doneBy: 'you', requiredSections: [], checks: [], tools: [], guidance: [], approvers: ['owner'],
    produces: 'The approved voice sheet every later draft follows.',
  },
  {
    id: 'calendar', kind: 'write', role: 'strategist', title: 'Fill topics and hooks into the calendar slots code made',
    tier: 'actor', model: 'main', doneBy: 'agent', requiredSections: ['Calendar', 'Topics and hooks'], checks: [...WRITE_CHECKS], tools: [],
    guidance: ['Give each slot code made one topic, one pillar and one hook. Never add, move or date a slot: code owns the dates.'],
    codeOwns: ['dates', 'channels', 'counts from the offer'],
    produces: 'A month of post slots, each with a topic, a pillar and a hook.',
  },
  {
    id: 'drafts', kind: 'write', role: 'writer', title: 'Draft each post for each channel, and reply drafts when the offer includes them',
    tier: 'actor', model: 'main', doneBy: 'agent', requiredSections: ['Drafts', 'Alt text', 'Hashtags'], checks: [...WRITE_CHECKS], tools: [], guidance: [],
    codeOwns: ['thread splits', 'character counts'],
    produces: 'Captions, alt text and hashtags per channel, and reply drafts.',
  },
  {
    id: 'creative-briefs', kind: 'write', role: 'creative', title: 'Write briefs for pictures, video and creator-style ads',
    tier: 'actor', model: 'main', doneBy: 'agent', requiredSections: ['Briefs', 'Disclosure', 'Cost before generation'], checks: [...WRITE_CHECKS], tools: [], guidance: [],
    paidTool: true,
    produces: 'Briefs with beats from hook to call to action. Generation waits until you see the cost from code.',
  },
  {
    id: 'check', kind: 'verify', role: 'checker', title: 'Run the code checks, then the yes or no judge',
    tier: 'code', model: null, doneBy: 'agent', requiredSections: [], checks: ['required-sections', 'house-style', 'length-bounds', 'no-done-claims', 'no-outside-writes', 'receipts'],
    tools: [], guidance: [], socialChecks: ALL_SOCIAL_CHECKS,
    produces: 'Each draft marked ready, or blocked with the reason and the rule it rests on.',
  },
  {
    id: 'approve-drafts', kind: 'approve', role: 'owner', title: 'You approve each draft, then your client approves it through a share link',
    tier: 'code', model: null, doneBy: 'you', requiredSections: [], checks: [], tools: [], guidance: [], approvers: ['owner', 'client'],
    produces: 'Drafts approved for their exact text.',
  },
  {
    id: 'publish', kind: 'operator', role: 'owner', title: 'Post or schedule the approved drafts, approving each post',
    tier: 'code', model: null, doneBy: 'you', requiredSections: [], checks: ['no-outside-writes'], tools: [], guidance: [],
    produces: 'Posts that went out, each one a journal entry, or a calendar file you import into your own tool.',
  },
  {
    id: 'collect-exports', kind: 'gather', role: 'client', title: 'Your client uploads the platform exports for the month',
    tier: 'code', model: null, doneBy: 'you', requiredSections: [], checks: [], tools: [], guidance: [],
    produces: 'The exports, kept as the order files.',
  },
  {
    id: 'figures', kind: 'compute', role: 'code', title: 'Compute the report figures from the exports, each with a receipt',
    tier: 'code', model: null, doneBy: 'agent', requiredSections: [], checks: ['figures-resolve'], tools: [], guidance: [],
    codeOwns: ['every figure', 'every rate', 'the top post'],
    produces: 'Figures in whole numbers with receipts naming the file, the rows and the columns.',
  },
  {
    id: 'report', kind: 'write', role: 'analyst', title: 'Write the report narrative from the receipts',
    tier: 'actor', model: 'main', doneBy: 'agent', requiredSections: ['Summary', 'What the figures show', 'What we will try next'],
    checks: ['no-numeric-prose', 'figures-resolve', ...WRITE_CHECKS], tools: [],
    guidance: ['Cite each figure as a figure part with its reference from social.report. Write no figure, rate or change of your own in the words.'],
    produces: 'A short narrative that cites receipts and never a figure of its own.',
  },
  {
    id: 'approve-report', kind: 'approve', role: 'owner', title: 'You approve the report; the invoice comes from the books',
    tier: 'code', model: null, doneBy: 'you', requiredSections: [], checks: [], tools: [], guidance: [], approvers: ['owner'],
    produces: 'The report for the client and the invoice for the month.',
  },
] satisfies SocialStep[]);

/** The steps as the engine stores them: engine fields only, so validatePlaybook and the harness read them as they are. */
export function socialPlaybookSteps(): PlaybookStep[] {
  return SOCIAL_STEPS.map(step => ({
    id: step.id, kind: step.kind, title: step.title, tier: step.tier, model: step.model, doneBy: step.doneBy,
    requiredSections: [...step.requiredSections], checks: [...step.checks], tools: [...(step.tools ?? [])], guidance: [...(step.guidance ?? [])],
  }));
}

export type SocialOffer = {
  id: 'content-calendar' | 'community-replies' | 'monthly-report' | 'ugc-ads' | 'repurpose-pack' | 'linkedin-ghostwriting';
  name: string;
  description: string;
  charge: 'monthly' | 'project';
  /** The owner sets every price; code makes the quote and the receipt. */
  price: 'owner-sets';
  steps: string[];
  includes: string[];
  disclosure: ('paid' | 'ai')[];
};

export const SOCIAL_OFFERS: readonly SocialOffer[] = Object.freeze([
  {
    id: 'content-calendar', name: 'Content calendar and posts', charge: 'monthly', price: 'owner-sets', disclosure: [],
    description: 'A monthly calendar and the posts for it, drafted for each channel and approved by you and your client.',
    steps: ['intake', 'clarify', 'voice', 'approve-voice', 'calendar', 'drafts', 'creative-briefs', 'check', 'approve-drafts', 'publish'],
    includes: ['Post slots set by code from the offer', 'Captions, alt text and hashtags for each channel', 'You approve each draft, then your client does'],
  },
  {
    id: 'community-replies', name: 'Community reply drafts', charge: 'monthly', price: 'owner-sets', disclosure: [],
    description: 'Replies to comments and messages drafted in the brand voice, for you to approve one by one.',
    steps: ['intake', 'clarify', 'voice', 'approve-voice', 'drafts', 'check', 'approve-drafts', 'publish'],
    includes: ['Reply drafts in the approved voice', 'Nothing is sent without your approval', 'Questions about money, health or a named person come to you'],
  },
  {
    id: 'monthly-report', name: 'Monthly report', charge: 'monthly', price: 'owner-sets', disclosure: [],
    description: 'Figures computed by code from the platform exports your client uploads, each with a receipt, and a short narrative.',
    steps: ['collect-exports', 'figures', 'report', 'approve-report'],
    includes: ['Reach, views, engagement and follows from the exports', 'A receipt for every figure', 'A narrative that cites receipts only'],
  },
  {
    id: 'ugc-ads', name: 'Creator-style ads with disclosure', charge: 'project', price: 'owner-sets', disclosure: ['paid', 'ai'],
    description: 'Short ad scripts and briefs in a creator style, labelled as ads, with any AI creator or voice labelled as AI.',
    steps: ['intake', 'clarify', 'voice', 'approve-voice', 'creative-briefs', 'check', 'approve-drafts', 'publish'],
    includes: [
      'Scripts in beats from hook to call to action',
      'An AI creator or voice is labelled as AI and never speaks as a real customer',
      'A real creator appears only with their consent and the rights recorded',
      'You see the cost from code before any paid generation',
    ],
  },
  { id: 'repurpose-pack', name: 'One source, a week of posts', charge: 'monthly', price: 'owner-sets', disclosure: [], description: 'A client source becomes drafts for three to five channels and a newsletter blurb. Every fact stays in the source.', steps: ['intake','voice','approve-voice','drafts','check','approve-drafts','publish'], includes: ['Source inventory with counts', 'A format and rule trace for each channel', 'Client approval before copy and open'] },
  { id: 'linkedin-ghostwriting', name: 'LinkedIn ghostwriting', charge: 'monthly', price: 'owner-sets', disclosure: [], description: 'Eight or twelve posts each month, with two revision rounds per post. You or your client copy and post the approved words.', steps: ['intake','voice','approve-voice','calendar','drafts','check','approve-drafts','publish'], includes: ['Five writing structures', 'Two revision rounds per post', 'Your price and approval for each extra round', 'LinkedIn is copy-and-open only'] },
] satisfies SocialOffer[]);

export type ApprovalPoint = { id: string; when: string; who: ('owner' | 'client')[]; stepId: string; floor: boolean };

/**
 * Where a person decides. The owner always decides first; the client only sees what the owner approved. floor marks
 * the always-ask actions of design 7.3: they need approval at every posture.
 */
export const SOCIAL_APPROVALS: readonly ApprovalPoint[] = Object.freeze([
  { id: 'voice-and-pillars', when: 'The voice sheet and pillars, once per client and on any change', who: ['owner'], stepId: 'approve-voice', floor: false },
  { id: 'spend-before-generation', when: 'Any spend on generation or tools, after you see the cost from code', who: ['owner'], stepId: 'creative-briefs', floor: true },
  { id: 'every-draft', when: 'Every draft: you first, then your client through a share link', who: ['owner', 'client'], stepId: 'approve-drafts', floor: true },
  { id: 'every-reply', when: "Every reply to a comment or message on a client's account", who: ['owner'], stepId: 'approve-drafts', floor: true },
  { id: 'every-post', when: 'Every post before it goes out, one at a time', who: ['owner'], stepId: 'publish', floor: true },
  { id: 'sensitive-words', when: 'Anything that mentions prices, discounts, health, money, results or a named person', who: ['owner'], stepId: 'check', floor: false },
  { id: 'report-and-invoice', when: 'The monthly report and the invoice', who: ['owner'], stepId: 'approve-report', floor: true },
] satisfies ApprovalPoint[]);

/** The rule the scheduler and the posting step follow (approvals.ts enforces it). */
export const DRAFT_BEFORE_SCHEDULE = 'A post is scheduled or posted only from a draft that passed the checks, that you approved, and that your client approved when the offer asks for it. The approval is for that exact text: an edit after approval needs a new approval.';

export type SocialConnector = {
  id: string;
  name: string;
  label: 'handoff' | 'read' | 'write' | 'planned' | 'planned: handoff' | 'planned: read' | 'planned: write';
  note: string;
};

/** Connectors with labels that match what the code does today. Posting per channel is in channels.ts. */
export const SOCIAL_CONNECTORS: readonly SocialConnector[] = Object.freeze([
  { id: 'chausar-books', name: 'Chausar books', label: 'write', note: 'Clients, orders and the monthly invoice, already in Chausar.' },
  { id: 'client-files', name: 'Client files', label: 'read', note: 'Brand kit, proof files and platform exports, through the order files.' },
  { id: 'mail-app', name: 'Your mail app', label: 'handoff', note: 'Client emails and invoices are drafted; you send them.' },
  { id: 'calendar-export', name: 'Calendar file', label: 'handoff', note: 'Approved posts written to a file you import into your scheduler or copy from.' },
  { id: 'posting', name: 'Posting', label: 'planned: write', note: 'Per channel and mode, from the posting connector. The API waits for app review. LinkedIn is copy-and-open only. Text posts on X can go from your own browser session when Playwright is on this computer, after you approve each post, with the risk line. Pictures and video are planned.' },
  { id: 'share-link-page', name: 'Client share page', label: 'planned', note: 'The share link record and its rules exist; no page serves it yet.' },
  { id: 'scheduler-tools', name: 'Buffer, Later and other schedulers', label: 'planned: handoff', note: 'Until then, import the calendar file.' },
  { id: 'generators', name: 'Image and video generators', label: 'planned: handoff', note: 'Briefs go out and files come back; the cost is shown by code before any paid call.' },
  { id: 'platform-analytics', name: 'Platform analytics', label: 'planned: read', note: 'Until then, your client uploads the exports and code computes the report.' },
  { id: 'payments', name: 'Razorpay or Stripe', label: 'planned: handoff', note: 'Payment links come from the books.' },
] satisfies SocialConnector[]);

/** What Chausar never builds for this playbook. */
export const SOCIAL_NOT_BUILT: readonly string[] = Object.freeze([
  'Proxy or VPN rotation to get around platform limits',
  'Hiding the automation or faking a browser fingerprint',
  "Posting to an account you did not sign in to yourself",
  'Buying followers, likes or comments',
  'Automated likes, follows or direct messages',
  'An AI creator presented as a real customer',
  'Clips of footage nobody recorded the rights to',
]);

export const SOCIAL_SERVICE_TYPE: ServiceType = 'agency';

/** Every string shown to people, for the word checks in tests. */
export function socialWords(): string[] {
  return [
    SOCIAL_AGENCY_REGISTRATION.label, SOCIAL_AGENCY_REGISTRATION.summary,
    ...Object.values(SOCIAL_ROLES).flatMap(role => [role.name, role.does]),
    ...SOCIAL_STEPS.flatMap(step => [step.title, step.produces, ...(step.guidance ?? []), ...step.requiredSections, ...(step.codeOwns ?? [])]),
    ...SOCIAL_OFFERS.flatMap(offer => [offer.name, offer.description, ...offer.includes]),
    ...SOCIAL_APPROVALS.map(point => point.when),
    DRAFT_BEFORE_SCHEDULE,
    ...SOCIAL_CONNECTORS.flatMap(connector => [connector.name, connector.note]),
    ...SOCIAL_NOT_BUILT,
  ];
}
