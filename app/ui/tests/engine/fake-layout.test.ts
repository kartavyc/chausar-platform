import { describe, expect, it } from 'vitest';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError } from '../../src/engine/types';

// W6 6H3 (D40): the fake answers venture.layout.get and venture.layout.change as views/layout.ts does: the same order,
// lines, Undo shapes and refusals as platform/tests/venture-layout-w6.test.ts pins for the engine.

function setup() {
  const engine = new FakeEngine({ now: () => '2026-10-23T10:00:00.000Z' });
  const client = createFakeClient(engine);
  const change = (place: 'today' | 'money', c: unknown) => client.request('venture.layout.change', { place, change: c } as never);
  const refused = async (work: Promise<unknown>) => {
    try { await work; } catch (error) { return error instanceof EngineError ? error.code : 'NOT_ENGINE_ERROR'; }
    return 'NOT_REFUSED';
  };
  return { engine, client, change, refused };
}

const ids = (view: { blocks: { id: string }[] }) => view.blocks.map((block) => block.id);

describe('fake layout parity', () => {
  it('starts from the library and refuses what the engine refuses', async () => {
    const { client, change, refused } = setup();
    const today = await client.request('venture.layout.get', { place: 'today' });
    expect(ids(today)).toEqual(['greeting', 'notices', 'goal', 'team', 'needs', 'working', 'earlier', 'ideas', 'apps']);
    expect(today.ai).toBeNull();
    expect(today.go).toBeNull();
    expect(await refused(client.request('venture.layout.get', { place: 'onboarding' } as never))).toBe('LAYOUT_UNKNOWN_PLACE');
    expect(await refused(client.request('venture.layout.get', { place: 'today', extra: 1 } as never))).toBe('INVALID_VENTURE_REQUEST');
    expect(await refused(change('today', { op: 'hide', block: 'needs' }))).toBe('LAYOUT_LOCKED');
    expect(await refused(change('money', { op: 'hide', block: 'glance' }))).toBe('LAYOUT_LOCKED');
    expect(await refused(change('money', { op: 'rename', block: 'flow', name: 'Profit' }))).toBe('LAYOUT_FIGURE_NAME');
    expect(await refused(change('today', { op: 'rename', block: 'team', name: 'Profit' }))).toBe('LAYOUT_NAME');
    expect(await refused(change('today', { op: 'hide', block: 'script' }))).toBe('LAYOUT_UNKNOWN_BLOCK');
    expect(await refused(change('today', { op: 'style', block: 'team' }))).toBe('INVALID_VENTURE_REQUEST');
    expect(await refused(change('today', { op: 'use-view', view: 'v9' }))).toBe('LAYOUT_UNKNOWN_VIEW');
  });

  it('owner changes answer the engine\'s lines and Undo', async () => {
    const { client, change } = setup();
    const hid = await change('today', { op: 'hide', block: 'ideas' });
    expect(hid.line).toBe('You hid Ideas.');
    expect(hid.undo).toEqual({ place: 'today', change: { op: 'restore', to: 'default' } });
    const moved = await change('today', { op: 'move', block: 'earlier', to: 0 });
    expect(ids(moved.layout)).toEqual(['greeting', 'notices', 'goal', 'earlier', 'needs', 'team', 'working', 'ideas', 'apps']);
    const renamed = await change('today', { op: 'rename', block: 'earlier', name: 'History' });
    expect(renamed.line).toBe('You renamed Earlier to History.');
    const undone = await client.request('venture.layout.change', renamed.undo);
    expect(undone.line).toBe('You undid the change.');
    expect(undone.layout.blocks.find((block) => block.id === 'earlier')!.name).toBe('Earlier');
    const saved = await change('today', { op: 'save-view', name: 'Mornings' });
    expect(saved.line).toBe('You saved the view Mornings.');
    expect(saved.layout.views).toEqual([{ id: 'v1', name: 'Mornings' }]);
  });

  it('the AI stand-in is labelled, listed with one Undo, and cannot keep its own changes', async () => {
    const { engine, client, change } = setup();
    expect(engine.layoutDesk.ai({ place: 'today', change: { op: 'hide', block: 'ideas' } }).line).toBe('Your AI hid Ideas.');
    expect(engine.layoutDesk.ai({ place: 'today', change: { op: 'rename', block: 'team', name: 'My team' } }).line).toBe('Your AI renamed Team at work to My team.');
    expect(() => engine.layoutDesk.ai({ place: 'today', change: { op: 'keep' } })).toThrow("Only the owner can keep the AI's changes.");
    const view = await client.request('venture.layout.get', { place: 'today' });
    expect(view.ai).toEqual({ count: 2, lines: ['Your AI hid Ideas.', 'Your AI renamed Team at work to My team.'], undo: { place: 'today', change: { op: 'restore', to: 'default' } } });
    const kept = await change('today', { op: 'keep' });
    expect(kept.line).toBe("You kept your AI's changes.");
    expect(kept.layout.ai).toBeNull();
    expect(engine.layoutDesk.go('money', 'invoices')).toEqual({ href: '#/money/invoices', line: 'Your AI opened Money.' });
    expect((await client.request('venture.layout.get', { place: 'today' })).go?.href).toBe('#/money/invoices');
  });
});
