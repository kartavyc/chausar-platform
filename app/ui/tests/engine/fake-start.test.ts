import { describe, expect, it } from 'vitest';
import { FakeEngine } from '../../src/engine/fake';
import { EngineError, type VentureViewLite, type WaysView } from '../../src/engine/types';

const ROUTE = /^#\/(?:today|team|work|clients|money|connections|business|onboarding)(?:\/[a-z0-9][a-z0-9-]{0,47})*$/;

describe('fake engine: the Start gallery and the setup checklist (4J8)', () => {
  it('answers venture.playbooks.list with the engine\'s ways, the open sample business on its own way', async () => {
    const engine = new FakeEngine();
    const view = (await engine.request('venture.playbooks.list', {})) as WaysView;
    expect(view.ways.map((way) => way.playbook)).toEqual(['ca-firm', 'youtube', 'social-agency']);
    for (const way of view.ways) {
      expect(way.hoursEstimate).toBe(true);
      expect(way.clientsPay.estimate).toBe(true);
      expect(way.clientsPay.source).toMatch(/^Model estimate/);
      expect(way.needs.ai.length).toBeGreaterThan(0);
      expect(way.needs.connections.length).toBeGreaterThan(0);
      expect(way.hi.needs.connections).toMatch(/\p{Script=Devanagari}/u);
    }
    // Lumen Studio (a YouTube channel) is open in the sample.
    expect(view.ways.find((way) => way.playbook === 'youtube')!.yours).toEqual([{ businessId: 'lumen', name: 'Lumen Studio' }]);
    expect(view.ways.filter((way) => way.playbook !== 'youtube').flatMap((way) => way.yours)).toEqual([]);
    expect(view.upTo).toEqual({ maxHours: 5, label: 'Up to 5 h a week', hi: 'हफ़्ते में 5 घंटे तक', count: 0 });
    const refused = await engine.request('venture.playbooks.list', { sort: 'name' }).catch((error: unknown) => error);
    expect((refused as EngineError).code).toBe('INVALID_VENTURE_REQUEST');
  });

  it('answers before any business is open, with no "You run this"', async () => {
    const engine = new FakeEngine({ fresh: true });
    const view = (await engine.request('venture.playbooks.list', {})) as WaysView;
    expect(view.ways.flatMap((way) => way.yours)).toEqual([]);
  });

  it("carries the setup checklist on venture.get, each item with the engine's name and link", async () => {
    const engine = new FakeEngine();
    const venture = (await engine.request('venture.get', {})) as VentureViewLite;
    const checklist = venture.checklist!;
    expect(checklist).toHaveLength(12);
    expect(checklist.filter((item) => item.done)).toHaveLength(venture.done);
    for (const item of checklist) expect(item.link).toMatch(ROUTE);
    expect(checklist.find((item) => item.id === 'prices')).toMatchObject({ label: 'Set your prices', link: '#/business/prices' });
  });
});
