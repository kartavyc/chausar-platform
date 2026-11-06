import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError, type EngineClient } from '../../src/engine/types';
import { assertInkRules } from '../helpers/ink-rules';

/*
 * W4 4J22a on the agent panel (from 4J15, catalogue Q10 and Q11; the founder's "auto with spot checks built but
 * locked"): Auto with spot checks is never offered as available. Its choice stays locked with the reason ("Built but
 * locked. It opens after two clean drill runs and the founder's yes."), and the engine refuses it AUTO_LOCKED whatever
 * the readiness says. The shadow summary counts what the agent's shadow drafts would have done, with a dash where a
 * figure is unknown; the readiness list says each item met or not, folded one step away.
 */

type Intercept = (method: string, params: Record<string, unknown>) => Promise<unknown> | undefined;

function start(options: { language?: 'en' | 'hi'; intercept?: Intercept } = {}) {
  window.location.hash = '#/team';
  const base = createFakeClient(new FakeEngine());
  const client: EngineClient = options.intercept
    ? { ...base, request: ((method: string, params?: Record<string, unknown>) => options.intercept!(method, params ?? {}) ?? base.request(method as never, params as never)) as EngineClient['request'] }
    : base;
  render(<App client={client} language={options.language ?? 'en'} />);
  return { base };
}

const LOCKED = "Built but locked. It opens after two clean drill runs and the founder's yes.";

async function openEditor() {
  const open = await within(screen.getByRole('main')).findByRole('button', { name: 'Editor' });
  await act(async () => {
    fireEvent.click(open);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  return screen.findByRole('complementary', { name: 'Editor' });
}

describe('Team: auto is built but locked (4J22a)', () => {
  it('the engine refuses auto AUTO_LOCKED in its own words, whatever the readiness', async () => {
    const engine = createFakeClient(new FakeEngine());
    await expect(engine.request('venture.team.posture', { agentId: 'editor', posture: 'auto-spot-check' })).rejects.toMatchObject({
      code: 'AUTO_LOCKED', message: "Auto with spot checks is built but locked. It opens after two clean drill runs and the founder's yes.",
    });
    const readiness = await engine.request('venture.auto.readiness', { agent: 'editor' });
    expect(readiness.locked).toBe(true);
  });

  it('the Auto choice is locked with the reason, and choosing it asks nothing', async () => {
    const { base } = start();
    const spy = vi.spyOn(base.engine, 'request');
    const sheet = await openEditor();
    const group = within(sheet).getByRole('group', { name: 'Posture' });
    const auto = within(group).getByRole('radio', { name: 'Auto with spot checks' }) as HTMLInputElement;
    expect(auto.getAttribute('aria-disabled')).toBe('true');
    const reason = auto.closest('[data-choice]')!.querySelector('[data-locked]')!;
    expect(reason.textContent).toBe(LOCKED);
    expect(auto.getAttribute('aria-describedby')).toContain(reason.id);
    // It looks locked: a lock chip as a floor step has, beside the name (hidden from the name; the reason says it).
    expect(auto.closest('[data-choice]')!.querySelector('[data-lock-chip]')!.textContent).toBe('Locked');
    // Under the steps: Auto on a step runs alone only at the locked posture; until then it asks.
    expect(sheet.querySelector('[data-auto-note]')!.textContent).toBe('Auto steps run on their own only at Auto with spot checks, which is locked. Until then they ask you.');
    await act(async () => { fireEvent.click(auto); });
    expect(spy).not.toHaveBeenCalledWith('venture.team.posture', expect.anything());
    expect(auto.checked).toBe(false);
    expect((within(group).getByRole('radio', { name: 'Approve each' }) as HTMLInputElement).checked).toBe(true);
    assertInkRules(sheet);
  });

  it('an AUTO_LOCKED answer from the engine reads the same lock words, never "available"', async () => {
    // Some other way in (a stale panel) sends auto; the refusal is worded by the screen.
    start({ intercept: (method) => (method === 'venture.team.posture' ? Promise.reject(new EngineError('AUTO_LOCKED', 'Auto with spot checks is built but locked.')) : undefined) });
    const sheet = await openEditor();
    await act(async () => { fireEvent.click(within(sheet).getByRole('radio', { name: 'Shadow' })); });
    await waitFor(() => expect(within(sheet).getByRole('alert').textContent).toBe(LOCKED));
  });

  it('shows the shadow summary with a dash where a figure is unknown', async () => {
    start({
      intercept: (method) => (method === 'venture.shadow.summary'
        ? Promise.resolve({ agent: 'editor', wouldHaveGone: 14, held: 3, changed: null, offers: [], line: 'Would have gone out 14, held 3, you would have changed -' }) : undefined),
    });
    const sheet = await openEditor();
    const line = await waitFor(() => within(sheet).getByText((_, el) => el?.hasAttribute('data-shadow') ?? false));
    expect(line.textContent).toBe('In shadow: would have gone out 14, held 3, you would have changed -');
  });

  it('folds what auto would need: each item met or not, in the engine words, and the lock', async () => {
    start();
    const sheet = await openEditor();
    const fold = await waitFor(() => sheet.querySelector('details[data-fold="readiness"]') as HTMLDetailsElement);
    expect(fold.open).toBe(false);
    expect(fold.querySelector('summary')!.textContent).toBe('What auto would need');
    await waitFor(() => expect(fold.querySelectorAll('li[data-item]').length).toBeGreaterThan(4));
    const spend = fold.querySelector('li[data-item="spend-log"]')!;
    expect(spend.textContent).toBe('Met: The spend log is complete. Every paid call is settled in the spend log.');
    const drills = fold.querySelector('li[data-item="drills"]')!;
    expect(drills.textContent).toMatch(/^Not yet: Two clean drill runs/);
    expect(fold.querySelector('[data-lock]')!.textContent).toBe(LOCKED);
  });
});
