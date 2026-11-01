/**
 * The fake engine's answers for recorded flows (wave 6, 6H2, D41). Flows record and run only in the desktop's own
 * browser window, and the fake engine is not the desktop, so it answers exactly as the engine does off the desktop:
 * an empty list, the same request checks in the same order with the same codes and words (flows/flow-words.ts), and
 * FLOW_BROWSER_UNAVAILABLE where the engine would open the window. It keeps nothing.
 */

import { EngineError } from './types';
import { FLOW_WORDS, originProblem } from '../../../../platform/runtime/venture/flows/flow-words';

const METHODS = new Set(['venture.flows.list', 'venture.flows.act']);
const ACTIONS = ['record', 'dry-run', 'approve', 'run', 'continue', 'repair', 'stop'];

/** The engine's exactPayload (records.ts): exact keys, a plain object. */
function exact(value: unknown, allowed: readonly string[], required: readonly string[] = []): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new EngineError('INVALID_VENTURE_REQUEST', 'Send one request object.');
  const record = value as Record<string, unknown>;
  if (!Object.keys(record).every((key) => allowed.includes(key)) || !required.every((key) => Object.hasOwn(record, key))) throw new EngineError('INVALID_VENTURE_REQUEST', 'Send the required fields and nothing else.');
  return record;
}
const noFlow = () => new EngineError('FLOW_NOT_FOUND', FLOW_WORDS.flow);
const noRun = () => new EngineError('FLOW_NOT_FOUND', FLOW_WORDS.run);

export class FakeFlowsDesk {
  handles(method: string): boolean { return METHODS.has(method); }

  request(method: string, p: Record<string, unknown>): unknown {
    if (method === 'venture.flows.list') { exact(p ?? {}, []); return { flows: [], runs: [] }; }
    const action = p?.action;
    if (typeof action !== 'string' || !ACTIONS.includes(action)) throw new EngineError('INVALID_VENTURE_REQUEST', FLOW_WORDS.action);
    if (action === 'repair') { exact(p, ['action', 'runId', 'option'], ['action', 'runId', 'option']); throw noRun(); }
    if (action === 'record') {
      const body = exact(p, ['action', 'name', 'url'], ['action', 'name', 'url']);
      if (typeof body.name !== 'string' || body.name.trim().length === 0 || body.name.length > 120) throw new EngineError('FLOW_INVALID', FLOW_WORDS.name);
      if (typeof body.url !== 'string' || body.url.length > 2048) throw new EngineError('FLOW_INVALID', FLOW_WORDS.url);
      const problem = originProblem(body.url);
      if (problem) throw new EngineError('FLOW_INVALID', problem);
      throw new EngineError('FLOW_BROWSER_UNAVAILABLE', FLOW_WORDS.browser);
    }
    if (action === 'dry-run') { exact(p, ['action', 'flowId', 'version', 'values'], ['action', 'flowId', 'version']); throw noFlow(); }
    if (action === 'approve') { exact(p, ['action', 'flowId', 'version', 'digest'], ['action', 'flowId', 'version', 'digest']); throw noFlow(); }
    if (action === 'run') { exact(p, ['action', 'flowId', 'values'], ['action', 'flowId', 'values']); throw noFlow(); }
    exact(p, ['action', 'runId', 'digest'], ['action', 'runId']);
    throw noRun();
  }
}
