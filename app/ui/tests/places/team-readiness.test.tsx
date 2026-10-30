import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { type EngineClient } from '../../src/engine/types';
import { assertInkRules } from '../helpers/ink-rules';

type Intercept = (method: string, params: Record<string, unknown>) => Promise<unknown> | undefined;

function start(options: { language?: 'en'; intercept?: Intercept } = {}) {
  window.location.hash = '#/team';
  const base = createFakeClient(new FakeEngine());
  const client: EngineClient = options.intercept
    ? { ...base, request: ((method: string, params?: Record<string, unknown>) => options.intercept!(method, params ?? {}) ?? base.request(method as never, params as never)) as EngineClient['request'] }
    : base;
  render(<App client={client} language={options.language ?? 'en'} />);
  return { base };
}

async function openEditor() {
  const open = await within(screen.getByRole('main')).findByRole('button', { name: 'Editor' });
  await act(async () => {
    fireEvent.click(open);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  return screen.findByRole('complementary', { name: 'Editor' });
}

describe('Team: native AI review settings', () => {
  it('links to owner AI settings without the retired lock, readiness or posture controls', async () => {
    const {base}=start(),spy=vi.spyOn(base.engine,'request'),sheet=await openEditor();
    expect(within(sheet).getByRole('link',{name:'AI review settings'}).getAttribute('href')).toBe('#/connections');
    expect(within(sheet).queryByRole('radio')).toBeNull();
    expect(sheet.querySelector('[data-fold="readiness"]')).toBeNull();
    expect(sheet.textContent).not.toContain('Routine-step approval is not available yet.');
    expect(sheet.textContent).not.toContain('Until then they ask you');
    expect(spy).not.toHaveBeenCalledWith('venture.auto.readiness',expect.anything());
    assertInkRules(sheet);
  });
  it('keeps step descriptions but offers no inert per-turn gate switches', async () => {
    const {base}=start(),spy=vi.spyOn(base.engine,'request'),sheet=await openEditor();
    const steps=within(sheet).getByRole('list',{name:'Steps'});
    expect(within(steps).getByText('Cut the episode')).toBeTruthy();
    expect(within(steps).queryByRole('switch')).toBeNull();
    expect(sheet.textContent).toContain('Outside actions always need your approval.');
    expect(spy).not.toHaveBeenCalledWith('venture.team.gate',expect.anything());
  });
});
