import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError } from '../../src/engine/types';

function timeZone(zone: string) {
  const original = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (this: Intl.DateTimeFormat) {
    return { ...original.call(this), timeZone: zone };
  });
}

function start(engine = new FakeEngine({ fresh: true })) {
  window.location.hash = '#/today';
  const client = createFakeClient(engine);
  const request = vi.spyOn(client, 'request');
  render(<App client={client} language="en" />);
  return request;
}

async function connected() {
  const engine = new FakeEngine({ fresh: true });
  const client = createFakeClient(engine);
  const options = await client.request('venture.ai.options', {});
  const preset = options.presets.find(row => row.id === 'claude-code-cli')!;
  await client.request('venture.ai.connect', { presetId: preset.id, consentDigest: preset.consentDigest });
  return start(engine);
}

describe('wave 6 country defaults', () => {
  for (const zone of ['Asia/Kolkata', 'Asia/Calcutta']) {
    it(`uses India from ${zone}, even when the computer language names the US`, async () => {
      timeZone(zone);
      vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US');
      const request = start();
      expect(await screen.findByText('India · INR')).toBeTruthy();
      fireEvent.change(screen.getByRole('textbox', { name: 'What do you want to start?' }), { target: { value: 'Bookkeeping for small cafes and shops.' } });
      fireEvent.click(screen.getByRole('button', { name: 'Start' }));
      await waitFor(() => expect(request).toHaveBeenCalledWith('venture.create', expect.objectContaining({ countryCode: 'IN' })));
    });
  }

  it('uses the US time zone instead of an India language region', async () => {
    timeZone('America/Los_Angeles');
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-IN');
    start();
    expect(await screen.findByText('United States · USD')).toBeTruthy();
  });

  it('keeps the owner country choice when their sentence names clients elsewhere', async () => {
    timeZone('Asia/Kolkata');
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US');
    const request = start();
    await screen.findByText('India · INR');
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Country' }), { target: { value: 'GB' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'What do you want to start?' }), { target: { value: 'Bookkeeping for clients in India and Canada.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('venture.create', expect.objectContaining({ countryCode: 'GB' })));
  });
});

describe('wave 6 country suggestions', () => {
  const words = 'I live in the United Kingdom and offer bookkeeping to clients in India.';
  for (const keep of [false, true]) it(`asks before using an AI country suggestion and respects ${keep ? 'Keep' : 'Use'}`, async () => {
    timeZone('Asia/Kolkata');
    const request = await connected();
    await screen.findByText('India · INR');
    fireEvent.change(screen.getByRole('textbox', { name: 'What do you want to start?' }), { target: { value: words } });
    expect(request.mock.calls.some(([method]) => method === 'venture.country.suggest')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    const use = await screen.findByRole('button', { name: 'Use United Kingdom' });
    expect(screen.getByText('Your words suggest United Kingdom, with prices in GBP.')).toBeTruthy();
    expect(request.mock.calls.some(([method]) => method === 'workspace.create')).toBe(false);
    fireEvent.click(keep ? screen.getByRole('button', { name: 'Keep India' }) : use);
    await waitFor(() => expect(request).toHaveBeenCalledWith('venture.create', expect.objectContaining({ countryCode: keep ? 'IN' : 'GB' })));
  });

  it('does not ask AI to override a manually selected country', async () => {
    timeZone('Asia/Kolkata');
    const request = await connected();
    await screen.findByText('India · INR');
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Country' }), { target: { value: 'CA' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'What do you want to start?' }), { target: { value: words } });
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('venture.create', expect.objectContaining({ countryCode: 'CA' })));
    expect(request.mock.calls.some(([method]) => method === 'venture.country.suggest')).toBe(false);
  });

  it('shows a service failure and creates no business until the owner can retry', async () => {
    timeZone('Asia/Kolkata');
    const engine = new FakeEngine({ fresh: true });
    const original = engine.request.bind(engine);
    vi.spyOn(engine, 'request').mockImplementation((method, params) => method === 'venture.country.suggest'
      ? Promise.reject(new EngineError('MODEL_TIMEOUT', 'Your AI did not answer. Try again.')) : original(method, params));
    const request = start(engine);
    await screen.findByText('India · INR');
    fireEvent.change(screen.getByRole('textbox', { name: 'What do you want to start?' }), { target: { value: words } });
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Your AI did not answer. Try again.');
    expect(request.mock.calls.some(([method]) => method === 'workspace.create')).toBe(false);
  });

  it('the fake rejects files and invalid sentence payloads before considering AI availability', async () => {
    const engine = new FakeEngine({ fresh: true });
    for (const payload of [{ text: words, attachment: 'not sent' }, { text: 7 }, { text: 'Too short' }, { text: 'Bad control\u0000 in owner words' }]) {
      await expect(engine.request('venture.country.suggest', payload)).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
    }
  });
});
