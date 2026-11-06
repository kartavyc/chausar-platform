import { describe, expect, it } from 'vitest';
import { FakeEngine } from '../../src/engine/fake';
import type { FlowsListView } from '../../src/engine/types';
import { FLOW_WORDS } from '../../../../platform/runtime/venture/flows/flow-words';

/**
 * Recorded flows (6H2, D41) need the desktop's own browser window. The fake engine is not the desktop, so it answers
 * exactly as the engine does off the desktop: an empty list, the same request checks in the same order, and
 * FLOW_BROWSER_UNAVAILABLE where the engine would open the window. The words come from the engine's own file.
 */
const ask = <T>(engine: FakeEngine, method: string, params: Record<string, unknown> = {}) => engine.request(method, params) as Promise<T>;

describe('fake engine: recorded flows (6H2)', () => {
  it('lists nothing and refuses each action the way the engine does without the desktop window', async () => {
    const engine = new FakeEngine({ now: () => '2026-11-01T10:00:00.000Z' });
    expect(await ask<FlowsListView>(engine, 'venture.flows.list')).toEqual({ flows: [], runs: [] });
    await expect(ask(engine, 'venture.flows.list', { extra: 1 })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST', message: 'Send the required fields and nothing else.' });
    await expect(ask(engine, 'venture.flows.act', { action: 'eval' })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST', message: FLOW_WORDS.action });
    await expect(ask(engine, 'venture.flows.act', { action: 'record', name: 'Timesheet' })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST', message: 'Send the required fields and nothing else.' });
    await expect(ask(engine, 'venture.flows.act', { action: 'record', name: ' ', url: 'https://forms.example/' })).rejects.toMatchObject({ code: 'FLOW_INVALID', message: FLOW_WORDS.name });
    await expect(ask(engine, 'venture.flows.act', { action: 'record', name: 'Timesheet', url: 'http://192.168.1.5/' })).rejects.toMatchObject({ code: 'FLOW_INVALID', message: FLOW_WORDS.site });
    await expect(ask(engine, 'venture.flows.act', { action: 'record', name: 'Timesheet', url: 'https://forms.example/' })).rejects.toMatchObject({ code: 'FLOW_BROWSER_UNAVAILABLE', message: FLOW_WORDS.browser });
    await expect(ask(engine, 'venture.flows.act', { action: 'run', flowId: 'flow_00000000-0000-4000-8000-000000000000', values: {} })).rejects.toMatchObject({ code: 'FLOW_NOT_FOUND', message: FLOW_WORDS.flow });
    await expect(ask(engine, 'venture.flows.act', { action: 'continue', runId: 'flowrun_1' })).rejects.toMatchObject({ code: 'FLOW_NOT_FOUND', message: FLOW_WORDS.run });
    await expect(ask(engine, 'venture.flows.act', { action: 'repair', runId: 'flowrun_1', option: 0 })).rejects.toMatchObject({ code: 'FLOW_NOT_FOUND', message: FLOW_WORDS.run });
  });
});
