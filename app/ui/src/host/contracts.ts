/** Serialized, nonsecret host context and configured-route catalogue. */
import type { ConversationPayloads } from '../bridge/conversation-contract.ts';
import type { DashboardTodayRequest, BriefTodayRequest } from '../bridge/today-host.ts';
import { ReplyValidationError } from '../bridge/validate.ts';
import type { LessonDecisionRequest, ScenarioDiscoveryRequest, ScenarioReopenRequest } from './retained-contracts.ts';
import type { TodayEnginePayloads } from '../bridge/today-engine.ts';
import type { TodayNavigationPayloads } from '../bridge/today-navigation.ts';

export interface UiContext {
  readonly workspace: { readonly id: string; readonly name: string; readonly demo: boolean };
  readonly member: { readonly id: string; readonly name: string; readonly role: 'owner' | 'cofounder' | 'accountant' | 'viewer'; readonly epoch: number; readonly branches: readonly string[] };
  readonly contextKey: string;
}
export interface UiModelRoute {
  readonly id: string;
  readonly label: string;
  readonly kind: 'codex-cli' | 'claude-cli' | 'openai-responses' | 'openai-compatible' | 'ollama' | 'managed';
  readonly model: string;
  readonly enabled: boolean;
  /** The existing catalogue explicitly does not qualify native/provider access. */
  readonly installationVerified: false;
}
export interface HostRpcPayloads extends ConversationPayloads, TodayEnginePayloads, TodayNavigationPayloads {
  'ui.context': Record<string, never>;
  'models.list': Record<string, never>;
  'dashboard.get': DashboardTodayRequest;
  'reports.brief': BriefTodayRequest;
  'receipts.get': { readonly id: string };
  'workspace.lock': Record<string, never>;
  /** Retained reader slice: bounded discovery of released what-if revisions, exact reopen of a pin,
   * current lesson views, one human decision. Discovery carries only the declared plain limit/cursor. */
  'scenarios.discover': ScenarioDiscoveryRequest;
  'scenarios.reopen': ScenarioReopenRequest;
  'memory.lessons': Record<string, never>;
  'memory.decideLesson': LessonDecisionRequest;
}
export interface HostRpcPort {
  request<M extends keyof HostRpcPayloads>(method: M, payload: HostRpcPayloads[M]): Promise<unknown>;
}
function invalid(path: string): never { throw new ReplyValidationError(path); }
function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length) invalid(path);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) invalid(path);
  }
  return value as Record<string, unknown>;
}
function exact(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  const obj = record(value, path);
  if (Object.keys(obj).length !== keys.length || keys.some(key => !Object.hasOwn(obj, key))) invalid(path);
  return obj;
}
function text(value: unknown, path: string, maximum = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u001f]/.test(value)) invalid(path);
  return value;
}
function identity(value: unknown, path: string): string {
  const id = text(value, path); if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(id)) invalid(path); return id;
}
function list(value: unknown, path: string, maximum: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum || Object.getOwnPropertySymbols(value).length) invalid(path);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.keys(descriptors).length !== value.length + 1) invalid(path);
  for (let i = 0; i < value.length; i++) if (!descriptors[String(i)]?.enumerable || !Object.hasOwn(descriptors[String(i)]!, 'value')) invalid(path);
  return value;
}
export function validateUiContext(value: unknown): UiContext {
  const obj = exact(value, ['workspace', 'member', 'contextKey'], 'ui.context');
  const workspace = exact(obj.workspace, ['id', 'name', 'demo'], 'ui.context.workspace');
  const member = exact(obj.member, ['id', 'name', 'role', 'epoch', 'branches'], 'ui.context.member');
  if (typeof workspace.demo !== 'boolean') invalid('ui.context.workspace.demo');
  if (typeof member.role !== 'string' || !['owner', 'cofounder', 'accountant', 'viewer'].includes(member.role)) invalid('ui.context.member.role');
  if (!Number.isSafeInteger(member.epoch) || (member.epoch as number) < 1) invalid('ui.context.member.epoch');
  const branches = list(member.branches, 'ui.context.member.branches', 1000).map((branch, index) => text(branch, `ui.context.member.branches[${index}]`));
  if (new Set(branches).size !== branches.length) invalid('ui.context.member.branches');
  if (typeof obj.contextKey !== 'string' || !/^[a-f0-9]{64}$/.test(obj.contextKey)) invalid('ui.context.contextKey');
  return Object.freeze({
    workspace: Object.freeze({ id: identity(workspace.id, 'ui.context.workspace.id'), name: text(workspace.name, 'ui.context.workspace.name', 100), demo: workspace.demo }),
    member: Object.freeze({ id: identity(member.id, 'ui.context.member.id'), name: text(member.name, 'ui.context.member.name', 200), role: member.role as UiContext['member']['role'], epoch: member.epoch as number, branches: Object.freeze(branches) }),
    contextKey: obj.contextKey,
  });
}
/** Select only catalogue identity/display fields; never expose credential names. */
export function validateModelRoutes(value: unknown): readonly UiModelRoute[] {
  const routes = list(value, 'models.list', 100).map((raw, index): UiModelRoute => {
    const path = `models.list[${index}]`, route = record(raw, path);
    if (typeof route.enabled !== 'boolean' || route.installationVerified !== false) invalid(path);
    const kind = text(route.kind, `${path}.kind`);
    if (!['codex-cli', 'claude-cli', 'openai-responses', 'openai-compatible', 'ollama', 'managed'].includes(kind)) invalid(`${path}.kind`);
    const model = text(route.model, `${path}.model`, 128);
    return Object.freeze({ id: identity(route.id, `${path}.id`), label: Object.hasOwn(route, 'label') ? text(route.label, `${path}.label`, 200) : model, kind: kind as UiModelRoute['kind'], model, enabled: route.enabled, installationVerified: false });
  });
  if (new Set(routes.map(route => route.id)).size !== routes.length) invalid('models.list');
  return Object.freeze(routes);
}
