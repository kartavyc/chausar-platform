// Chausar flagship playbooks: how each one delivers (playbook wiring, design 7.8). A business whose plan a flagship
// playbook made (playbooks/plan.ts) delivers with that playbook's own typed steps, in the harness's step shape, so the
// same validator, gates, posture and run views apply (delivery/playbook.ts). This file says, for each playbook:
// - steps: the typed steps, with layout guidance on the drafting step so the playbook's code checks can read the
//   draft (the YouTube package's labelled lines, the social posts' channel lines);
// - roles: the agents and code that do the steps, which the team shows as its agents (views/team.ts);
// - floor: the steps the playbook keeps in the always-ask floor, with its own reason;
// - draftStep: the writing step that drafts an order's reply, by the order's offer.
// Owner, client, CA and filer steps are people's work: they keep their gates but belong to no agent.
import type { PlaybookStep } from '../contracts.ts';
import { CA_STEPS, caFirmPlaybookSteps } from './ca-firm/playbook.ts';
import { CA_FIRM_ID, CA_FIRM_LABEL } from './ca-firm/registration.ts';
import { YOUTUBE_STEPS, youtubeEngineSteps } from './youtube/playbook.ts';
import { YOUTUBE_ID, YOUTUBE_LABEL } from './youtube/registration.ts';
import { SOCIAL_APPROVALS, SOCIAL_ROLES, SOCIAL_STEPS, socialPlaybookSteps, type SocialRoleId } from './social/playbook.ts';
import { SOCIAL_AGENCY_ID, SOCIAL_AGENCY_LABEL } from './social/registration.ts';

export type FlagshipRole = { id: string; name: string; job: string; kind: 'agent' | 'code' };
/**
 * One step as the plan lists it (core/blueprint.ts flagshipStepLines): its title and who does it. doneBy: you, an
 * agent (who is its role), code with no model (who is the code's name), or another person such as the CA of record
 * or the client.
 */
export type FlagshipPlanStep = { id: string; title: string; doneBy: 'you' | 'agent' | 'code' | 'person'; who: string };
export type FlagshipDelivery = {
  id: string;
  label: string;
  steps: readonly PlaybookStep[];
  /** The same steps, in order, as the plan lists them, so the plan the owner accepts names the steps that run. */
  plan: readonly FlagshipPlanStep[];
  /** The roles that do an agent or code step, in the order of their first step. */
  roles: readonly FlagshipRole[];
  /** Step id to the role id that does it; people's steps are absent. */
  roleOf: Readonly<Record<string, string>>;
  /** Step id to why the playbook asks the owner at every posture. */
  floor: Readonly<Record<string, string>>;
  /** The writing step that drafts an order's reply, by the playbook offer id (null: the playbook's usual one). */
  draftStep(offerKey: string | null | undefined): string;
};

/** How a YouTube package is laid out, so the hook, title, chapter and disclosure checks can read it (youtube/checks.ts). */
export const YOUTUBE_PACKAGE_GUIDANCE: readonly string[] = Object.freeze([
  'Start the Summary with the two best opening hooks, each in its own text part that begins with Hook and a colon.',
  'Under Title and thumbnail, write one part that begins with Title and a colon and one that begins with Thumbnail and a colon.',
  'Under Description and chapters, begin one part with Description and a colon, then give each chapter its own part: its start time, then its label.',
  'When the order uses an AI voice or presenter, say so in the description. When the clips are licensed, credit the source and its reference there.',
  'Begin a part with Pinned comment or Tags and a colon when the package has them.',
]);
/** How social posts are laid out, so the channel, disclosure and claim checks can read each post (social/checks.ts). */
export const SOCIAL_POST_GUIDANCE: readonly string[] = Object.freeze([
  'Under Drafts, give each post its own text part that begins with its channel and a colon, for example Instagram: then the post.',
  'Begin a paid post with Ad, and say Made with AI in the first line when an AI person, voice or realistic scene is in it.',
]);

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const withGuidance = (steps: PlaybookStep[], id: string, lines: readonly string[]): PlaybookStep[] =>
  steps.map(step => (step.id === id ? { ...step, guidance: [...(step.guidance ?? []), ...lines] } : step));

/** The plan's list: each engine step's own title, and who does it from the playbook's roles. */
function planOf(steps: readonly PlaybookStep[], doers: ReadonlyMap<string, Pick<FlagshipPlanStep, 'doneBy' | 'who'>>): FlagshipPlanStep[] {
  return steps.map(step => {
    const doer = doers.get(step.id) ?? fail(`The step ${step.id} has no role.`);
    return { id: step.id, title: step.title, doneBy: doer.doneBy, who: doer.who };
  });
}
const fail = (message: string): never => { throw new Error(message); };

function rolesIn(order: readonly { stepId: string; role: FlagshipRole | null }[]): { roles: FlagshipRole[]; roleOf: Record<string, string> } {
  const roles: FlagshipRole[] = [];
  const roleOf: Record<string, string> = {};
  for (const { stepId, role } of order) {
    if (!role) continue;
    if (!roles.some(item => item.id === role.id)) roles.push(role);
    roleOf[stepId] = role.id;
  }
  return { roles, roleOf };
}

const CHAUSAR_YOUTUBE: FlagshipRole = Object.freeze({
  id: 'chausar', name: 'Chausar', kind: 'code',
  job: 'Reads the transcript timings, scores the hooks, builds the edit list and runs every check, with no model.',
});

function youtube(): FlagshipDelivery {
  const { roles, roleOf } = rolesIn(YOUTUBE_STEPS.map(step => ({
    stepId: step.id,
    role: step.role.kind === 'agent' ? { id: slug(step.role.name), name: step.role.name, job: step.role.job, kind: 'agent' as const }
      : step.role.kind === 'code' ? CHAUSAR_YOUTUBE : null,
  })));
  const steps = withGuidance(youtubeEngineSteps(), 'package', YOUTUBE_PACKAGE_GUIDANCE);
  const doers = new Map(YOUTUBE_STEPS.map(step => [step.id, step.role.kind === 'agent' ? { doneBy: 'agent' as const, who: step.role.name }
    : step.role.kind === 'code' ? { doneBy: 'code' as const, who: CHAUSAR_YOUTUBE.name } : { doneBy: 'you' as const, who: 'You' }]));
  return {
    id: YOUTUBE_ID, label: YOUTUBE_LABEL, steps, plan: planOf(steps, doers), roles, roleOf,
    floor: Object.fromEntries(YOUTUBE_STEPS.filter(step => step.floor).map(step => [step.id, step.floor!])),
    draftStep: () => 'package',
  };
}

function caFirm(): FlagshipDelivery {
  const { roles, roleOf } = rolesIn(CA_STEPS.map(step => ({
    stepId: step.id,
    role: step.role.kind === 'agent' || step.role.kind === 'code' ? { id: step.role.id, name: step.role.name, job: step.role.job, kind: step.role.kind } : null,
  })));
  const steps = caFirmPlaybookSteps();
  // The CA of record and whoever files on the portal are people other than you.
  const doers = new Map(CA_STEPS.map(step => [step.id, {
    doneBy: step.role.kind === 'agent' || step.role.kind === 'code' ? step.role.kind : step.role.kind === 'owner' ? 'you' as const : 'person' as const,
    who: step.role.name,
  }]));
  return {
    id: CA_FIRM_ID, label: CA_FIRM_LABEL, steps, plan: planOf(steps, doers), roles, roleOf,
    floor: Object.fromEntries(CA_STEPS.filter(step => step.floor).map(step => [step.id, step.floor!])),
    draftStep: () => 'draft',
  };
}

/** The social agency's writing step for each offer's order: posts, replies, ad briefs, or the monthly report. */
const SOCIAL_DRAFT_STEP: Readonly<Record<string, string>> = Object.freeze({
  'content-calendar': 'drafts', 'community-replies': 'drafts', 'ugc-ads': 'creative-briefs', 'monthly-report': 'report',
});

function socialAgency(): FlagshipDelivery {
  const { roles, roleOf } = rolesIn(SOCIAL_STEPS.map(step => {
    const role = SOCIAL_ROLES[step.role as SocialRoleId];
    return { stepId: step.id, role: role.kind === 'person' ? null : { id: step.role, name: role.name, job: role.does, kind: role.kind } };
  }));
  const floor: Record<string, string> = {};
  for (const point of SOCIAL_APPROVALS) if (point.floor && !floor[point.stepId]) floor[point.stepId] = `${point.when}. This asks you at every posture.`;
  const steps = withGuidance(socialPlaybookSteps(), 'drafts', SOCIAL_POST_GUIDANCE);
  const doers = new Map(SOCIAL_STEPS.map(step => {
    const role = SOCIAL_ROLES[step.role as SocialRoleId];
    return [step.id, { doneBy: role.kind === 'person' ? (step.role === 'owner' ? 'you' as const : 'person' as const) : role.kind, who: role.name }];
  }));
  return {
    id: SOCIAL_AGENCY_ID, label: SOCIAL_AGENCY_LABEL, steps, plan: planOf(steps, doers), roles, roleOf, floor,
    draftStep: offerKey => SOCIAL_DRAFT_STEP[offerKey ?? ''] ?? 'drafts',
  };
}

const DELIVERIES: Readonly<Record<string, () => FlagshipDelivery>> = Object.freeze({ [CA_FIRM_ID]: caFirm, [YOUTUBE_ID]: youtube, [SOCIAL_AGENCY_ID]: socialAgency });

/** How a flagship playbook delivers, by its id; null for any other id. Every call returns fresh steps. */
export function flagshipDelivery(id: string | null | undefined): FlagshipDelivery | null {
  const make = id ? DELIVERIES[id] : undefined;
  return make ? make() : null;
}
