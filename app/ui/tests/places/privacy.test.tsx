import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { EngineClient, ModelStatusLite, Transport } from '../../src/engine/types';

/**
 * What may leave this computer (trust.update { send }), the old Trust & access page's model disclosure rule, now beside
 * Your AI: the engine checks it before every AI call. A change is saved only on Save, and the page shows the engine's
 * setting afterwards.
 */
type Calls = [string, Record<string, unknown>][];
function start(engine = new FakeEngine(), transport?: Transport) {
  window.location.hash = '#/connections/ai';
  const fake = createFakeClient(engine);
  const calls: Calls = [];
  const client: EngineClient = {
    ...fake,
    transport: transport ?? fake.transport,
    request: ((method: string, params?: Record<string, unknown>) => {
      calls.push([method, structuredClone(params ?? {})]);
      return fake.request(method as never, params as never);
    }) as EngineClient['request'],
  };
  render(<App client={client} language="en" />);
  return { engine, calls };
}

describe('Your AI: what may leave this computer', () => {
  it("shows the engine's setting; a new one is sent only on Save, and then the engine's setting shows", async () => {
    const { engine, calls } = start();
    // The known load flake: wait for each step of the page in turn (the tile, the engine's AI status, then the rule)
    // with cheap text queries; a role query over the whole page is slow in jsdom. The rule is the group its legend
    // names: the legend is found by its words, and checked to be the fieldset's own, which gives the group that name.
    await screen.findByText('Your AI', { selector: 'h2' });
    await screen.findByText(/^This month:/);
    const rule = async () => {
      const legend = await screen.findByText('What may leave this computer', { selector: 'legend' });
      const group = legend.closest('fieldset') as HTMLElement;
      expect(group.querySelector('legend')).toBe(legend);
      return group;
    };
    const group = await rule();
    expect((within(group).getByRole('radio', { name: 'The shape of each question' }) as HTMLInputElement).checked).toBe(true);
    await act(async () => { fireEvent.click(within(group).getByRole('radio', { name: 'Nothing leaves this computer' })); });
    expect(calls.some(([m]) => m === 'trust.update')).toBe(false);
    // Save is enabled only once the new choice has rendered; under load the click could land on the disabled button.
    await waitFor(() => expect((within(group).getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false));
    await act(async () => { fireEvent.click(within(group).getByRole('button', { name: 'Save' })); });
    expect(calls.filter(([m]) => m === 'trust.update').map(([, p]) => p)).toEqual([{ send: 'nothing' }]);
    expect(await screen.findByText('Your privacy setting sends nothing to AI, so every call is stopped.')).toBeTruthy();
    expect(((await engine.request('venture.models.status', {})) as ModelStatusLite).sendPolicy).toBe('nothing');
    expect((within(await rule()).getByRole('radio', { name: 'Nothing leaves this computer' }) as HTMLInputElement).checked).toBe(true);
  });

  it('is not offered on hosted, where the server keeps the rule', async () => {
    start(new FakeEngine({ hosted: true }), 'hosted');
    await screen.findByText('Your AI', { selector: 'h2' });
    expect(screen.queryByRole('group', { name: 'What may leave this computer' })).toBeNull();
  });
});
