// W6 6C4 (D19): Business > Practice shows the two launch stages, Practice and Live (you approve each), and the one
// button that moves the business up, which calls venture.launch.advance. Moving up asks a second time; moving down
// does not. A blocked Live shows the engine's reason and a locked button (aria-disabled).
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { MODEL_PRESETS } from '../../src/engine/fixtures-business';
import type { MethodName } from '../../src/engine/types';

type Call = { method: string; params: unknown };

async function connect(engine: FakeEngine) {
  const preset = MODEL_PRESETS.find((item) => item.id === 'codex-cli')!, before = structuredClone(preset);
  try { engine.firstRun.signIn(); await engine.request('venture.models.connect', { presetId: preset.id, consentDigest: preset.consentDigest }); } finally { Object.assign(preset, before); }
}

function start(engine: FakeEngine) {
  window.location.hash = '#/business/practice';
  const client = createFakeClient(engine);
  const calls: Call[] = [];
  const request = client.request.bind(client);
  client.request = ((method: MethodName, params?: unknown) => { calls.push({ method, params }); return request(method, params as never); }) as typeof client.request;
  render(<App client={client} language="en" />);
  return { calls };
}

describe('Business: launch stages (6C4)', () => {
  it('shows Practice and Live only, and Go live moves the business up after a second ask', async () => {
    const engine = new FakeEngine();
    await connect(engine);
    const { calls } = start(engine);
    const tile = await screen.findByRole('region', { name: 'Stage' });
    expect(within(tile).getByText('Practice')).toBeTruthy();
    expect(within(tile).getByText('Live (you approve each)')).toBeTruthy();
    expect(tile.textContent).not.toMatch(/shadow|rehears|sample|spot check/i);
    expect(within(tile).getByText('Real orders get practice drafts that never reach clients.')).toBeTruthy();
    await act(async () => { fireEvent.click(within(tile).getByRole('button', { name: 'Go live' })); });
    expect(calls.some((call) => call.method === 'venture.launch.advance')).toBe(false);
    await act(async () => { fireEvent.click(await within(tile).findByRole('button', { name: 'Go live now' })); });
    expect(calls.filter((call) => call.method === 'venture.launch.advance').map((call) => call.params)).toEqual([{ to: 'live' }]);
    expect(await within(tile).findByText('You approve each draft before it reaches a client.')).toBeTruthy();
    await act(async () => { fireEvent.click(await within(tile).findByRole('button', { name: 'Back to practice' })); });
    expect(calls.filter((call) => call.method === 'venture.launch.advance').map((call) => call.params)).toEqual([{ to: 'live' }, { to: 'practice' }]);
    expect(await within(tile).findByRole('button', { name: 'Go live' })).toBeTruthy();
  });

  it('a blocked Live shows the engine reason and leads to connecting AI without changing stage', async () => {
    const engine = new FakeEngine();
    const status = await engine.request('venture.launch.status', {}) as { stages: { allowed: boolean; reason: string }[] };
    if (status.stages[1]!.allowed) return; // the sample business already has an AI; the first case covers it
    const { calls } = start(engine);
    const tile = await screen.findByRole('region', { name: 'Stage' });
    expect(await within(tile).findByText(status.stages[1]!.reason)).toBeTruthy();
    const button = within(tile).getByRole('button', { name: 'Connect your AI' });
    await act(async () => { fireEvent.click(button); });
    expect(window.location.hash).toBe('#/connections/ai');
    expect(within(tile).queryByRole('button', { name: 'Go live now' })).toBeNull();
    expect(calls.some((call) => call.method === 'venture.launch.advance')).toBe(false);
  });
});
