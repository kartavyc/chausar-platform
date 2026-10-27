// Chausar flagship playbooks: the five departments (Ink v2 wave 4, package 4A1; spec 5.1). The founder fixed them:
// Sales and clients, Marketing, Production, Money, Operations. Every role of every flagship playbook sits in exactly
// one, in data here; the eight fixed steps' one agent takes its department from the plan's service type. Operations
// also holds Keeper, the engine's own jobs run as code (views/keeper.ts). Which role a harness turn worked for is
// decided here by code from the tools it called, never guessed: a turn no single role can claim is the team's.
import { ChausarError } from '../../contracts.ts';
import { DEPARTMENT_IDS, type AgentTurnRecord, type DepartmentId, type PlaybookStep, type ServiceType } from '../contracts.ts';
import { CA_FIRM_ID } from './ca-firm/registration.ts';
import { SOCIAL_AGENCY_ID } from './social/registration.ts';
import { YOUTUBE_ID } from './youtube/registration.ts';
import { flagshipDelivery, type FlagshipDelivery } from './steps.ts';

/** The five departments in the order the screens show them, with their words. */
export const DEPARTMENTS: readonly { readonly id: DepartmentId; readonly name: string }[] = Object.freeze([
  Object.freeze({ id: 'sales' as const, name: 'Sales and clients' }),
  Object.freeze({ id: 'marketing' as const, name: 'Marketing' }),
  Object.freeze({ id: 'production' as const, name: 'Production' }),
  Object.freeze({ id: 'money' as const, name: 'Money' }),
  Object.freeze({ id: 'operations' as const, name: 'Operations' }),
]);

/** What spend and work no single role can claim is called: it is the team's, never split by guess. */
export const SHARED_NAME = 'Shared by the team';

/**
 * Each flagship playbook's roles, by role id, to their department. The CA firm's checks role is its auditor
 * (Operations); its calculator is code that works out tax (Money). Each playbook's code role sits with the work it does.
 */
export const ROLE_DEPARTMENTS: Readonly<Record<string, Readonly<Record<string, DepartmentId>>>> = Object.freeze({
  [YOUTUBE_ID]: Object.freeze({
    'intake-clerk': 'production', producer: 'sales', chausar: 'production', 'story-editor': 'production', packager: 'marketing',
  }),
  [CA_FIRM_ID]: Object.freeze({
    intake: 'sales', preparer: 'money', reconciler: 'money', writer: 'money', checker: 'operations', calculator: 'money',
  }),
  [SOCIAL_AGENCY_ID]: Object.freeze({
    intake: 'sales', strategist: 'marketing', writer: 'marketing', creative: 'production', checker: 'operations', code: 'operations', analyst: 'marketing',
  }),
} satisfies Record<string, Record<string, DepartmentId>>);

/** The eight fixed steps' one agent, by the plan's service type. */
export const SERVICE_DEPARTMENTS: Readonly<Record<ServiceType, DepartmentId>> = Object.freeze({
  bookkeeping: 'money', agency: 'marketing', content: 'marketing', support: 'sales',
  studio: 'production', consulting: 'production', research: 'production', other: 'production',
});

const FLAGSHIP_IDS: readonly string[] = Object.freeze([YOUTUBE_ID, CA_FIRM_ID, SOCIAL_AGENCY_ID]);
const isDepartment = (value: unknown): value is DepartmentId => typeof value === 'string' && (DEPARTMENT_IDS as readonly string[]).includes(value);

/** A department's words. */
export function departmentName(id: DepartmentId): string {
  return DEPARTMENTS.find(item => item.id === id)?.name ?? id;
}

/** The department of the eight fixed steps' one agent; Production for a type the table does not know. */
export function departmentOfService(serviceType: ServiceType | null | undefined): DepartmentId {
  return (serviceType && SERVICE_DEPARTMENTS[serviceType]) || 'production';
}

/**
 * A flagship role's department, or DEPARTMENT_MISSING naming the role. A kit playbook's role carries its own (Ink v2
 * wave 5, 5A1: the definition's role department, kept on the delivery's role by playbooks/steps.ts kitDelivery).
 */
export function departmentOfRole(delivery: Pick<FlagshipDelivery, 'id' | 'roles'>, roleId: string, map: Readonly<Record<string, Readonly<Record<string, string>>>> = ROLE_DEPARTMENTS): DepartmentId {
  const department = map[delivery.id]?.[roleId] ?? delivery.roles.find(role => role.id === roleId)?.department;
  if (isDepartment(department)) return department;
  const name = delivery.roles.find(role => role.id === roleId)?.name ?? roleId;
  throw new ChausarError('DEPARTMENT_MISSING', `${name} has no department. Every role in the ${delivery.id} playbook needs one of the five.`);
}

/**
 * Throws DEPARTMENT_MISSING for the first role, in any of the playbooks given (the three flagships by default), that
 * the map gives no department or something other than the five.
 */
export function validateDepartments(
  deliveries: readonly Pick<FlagshipDelivery, 'id' | 'roles'>[] = FLAGSHIP_IDS.map(id => flagshipDelivery(id)!),
  map: Readonly<Record<string, Readonly<Record<string, string>>>> = ROLE_DEPARTMENTS,
): void {
  for (const delivery of deliveries) for (const role of delivery.roles) departmentOfRole(delivery, role.id, map);
}

/** The roles whose steps hold a tool, by role id. People's steps belong to no role. */
function holders(delivery: Pick<FlagshipDelivery, 'roleOf'>, steps: readonly PlaybookStep[], tool: string): Set<string> {
  const roles = new Set<string>();
  for (const step of steps) {
    const role = delivery.roleOf[step.id];
    if (role && ((step.tools ?? []) as readonly string[]).includes(tool)) roles.add(role);
  }
  return roles;
}

/**
 * The role a harness turn worked for, or null when no single role can claim it (the team's, "Shared by the team"):
 * - a role the turn record names, when it is one of this team's (a later package may store it);
 * - else the one role whose steps hold every tool the turn called that any step holds (a tool no step holds says
 *   nothing about whose turn it was): youtube.hooks is the story editor's, files.read alone is two roles' and so null;
 * - else, for a write turn, the role of the order's drafting step;
 * - else null.
 */
export function roleOfTurn(
  delivery: Pick<FlagshipDelivery, 'roles' | 'roleOf'>,
  steps: readonly PlaybookStep[],
  turn: Pick<AgentTurnRecord, 'step' | 'calls' | 'role'>,
  draftStepId: string | null,
): string | null {
  if (turn.role && delivery.roles.some(role => role.id === turn.role)) return turn.role;
  let candidates = null as Set<string> | null;
  for (const call of turn.calls) {
    const held = holders(delivery, steps, call.tool);
    if (!held.size) continue;
    candidates = candidates ? new Set([...candidates].filter((role: string) => held.has(role))) : held;
  }
  if (candidates) return candidates.size === 1 ? [...candidates][0] : null;
  if (turn.step === 'write' && draftStepId) return delivery.roleOf[draftStepId] ?? null;
  return null;
}
