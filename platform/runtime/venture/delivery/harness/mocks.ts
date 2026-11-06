// Chausar delivery harness (Ink v2 wave 4, package 4J11, catalogue H33): typed mock tools, and the words every mock uses.
// A typed mock tool is a real tool's name, so the real fields check every call, with a hand-written result; it serves
// rehearsals, improvement runs and the shadow stage, where nothing is sent. It says it is one (mock: true and
// MOCK_TOOL_NOTE), proves nothing (no table, receipt or proof), reaches no network, and a real order at any other stage
// refuses it (MOCK_REAL_RUN), so it never fakes a capability. Mock providers (payment link, mail, posting) live in
// mock-providers.ts. The pattern follows einvoice's mock.ts and llm-space's custom function tool (2026-10-21 harvest).
import { check } from '../../../contracts.ts';
import { TOOL_NAMES } from '../../contracts.ts';
import type { Json, ToolName } from '../../contracts.ts';
import type { ToolEnv, ToolResult } from './tools.ts';

/** What every mock provider says about itself. */
export const MOCK_LABEL = 'Practice provider: nothing left this computer and nothing was sent.';
/** What a typed mock tool's result says about itself. */
export const MOCK_TOOL_NOTE = 'Practice: a hand-written result, not the real tool. It proves nothing.';
export const MOCK_REAL_RUN_LINE = 'Practice providers and hand-written tool results work only in tests and practice runs, never on a real order.';

/**
 * Whether this run may use a mock, read from its own tool environment (never from what a caller says): a rehearsal or
 * an improvement run; with shadow, also a real order at the shadow stage, where nothing is sent.
 */
export function practiceRun(env: Pick<ToolEnv, 'runRef' | 'policy'>, shadow: boolean): boolean {
  return env.runRef.kind !== 'delivery' || (shadow && env.policy?.context.posture === 'shadow');
}

/** A real tool's name, so its real fields check every call, and a hand-written result in plain data. */
export type MockTool = Readonly<{ name: ToolName; result: Json; mock: true }>;

function plainData(value: unknown, depth = 0): boolean {
  if (depth > 20) return false;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(item => plainData(item, depth + 1));
  if (typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))) return Object.values(value as object).every(item => plainData(item, depth + 1));
  return false;
}

/** A typed mock tool. The name must be a real tool; the result must be plain data (no dates, functions or classes). */
export function mockTool(name: ToolName, result: Json): MockTool {
  check((TOOL_NAMES as readonly string[]).includes(name), 'INVALID_VENTURE_REQUEST', `There is no tool called ${String(name).slice(0, 60)} to stand in for.`);
  check(plainData(result), 'INVALID_VENTURE_REQUEST', 'A hand-written result must be plain data: text, numbers, yes or no, lists and objects.');
  return Object.freeze({ name, result: structuredClone(result), mock: true as const });
}

/**
 * The typed mock tool this run uses for a tool, or null when it has none. Only a rehearsal, an improvement run or a
 * real order at the shadow stage (where nothing is sent) may use one; any other real order is refused with MOCK_REAL_RUN.
 */
export function mockToolFor(env: Pick<ToolEnv, 'mockTools' | 'runRef' | 'policy'>, name: ToolName): MockTool | null {
  const tool = env.mockTools?.find(item => item.name === name) ?? null;
  if (!tool) return null;
  check(practiceRun(env, true), 'MOCK_REAL_RUN', MOCK_REAL_RUN_LINE);
  return tool;
}

/** What a typed mock tool answers: its hand-written result, labelled, with no table, receipt or proof. */
export function runMockTool(tool: MockTool): ToolResult {
  return { result: { mock: true, note: MOCK_TOOL_NOTE, result: structuredClone(tool.result) } };
}
