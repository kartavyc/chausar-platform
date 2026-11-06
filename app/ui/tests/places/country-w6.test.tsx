import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError } from '../../src/engine/types';
import { answerSideWork } from './first-run-steps';

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

// W6 6C2: the country now shows on About you (the first run's step 2); the plan is kept from there.
const BOX = 'Tell Chausar about your work';
async function aboutYou() {
  fireEvent.click(await screen.findByRole('button', { name: 'Skip for now: use templates' }, { timeout: 4000 }));
  return screen.findByRole('textbox', { name: BOX });
}
async function sendAndKeep(text: string, beforeKeep?: () => Promise<void>) {
  fireEvent.change(screen.getByRole('textbox', { name: BOX }), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  const keep = await screen.findByRole('button', { name: 'Keep this plan' });
  await waitFor(() => expect(keep.hasAttribute('disabled')).toBe(false));
  if (beforeKeep) await beforeKeep();
  fireEvent.click(screen.getByRole('button', { name: 'Keep this plan' }));
  await answerSideWork();
}

describe('wave 6 country defaults', () => {
  for (const zone of ['Asia/Kolkata', 'Asia/Calcutta']) {
    it(`uses India from ${zone}, even when the computer language names the US`, async () => {
      timeZone(zone);
      vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US');
      const request = start();
      await aboutYou();
      expect(await screen.findByText('India, from your time zone')).toBeTruthy();
      expect(screen.getByText('INR')).toBeTruthy();
      await sendAndKeep('Bookkeeping for small cafes and shops.');
      await waitFor(() => expect(request).toHaveBeenCalledWith('venture.create', expect.objectContaining({ countryCode: 'IN' })));
      // A4 fix round: the first run never asks to reuse another business's AI; only the Start gallery does.
      expect(request.mock.calls.find(([method]) => method === 'venture.create')![1]).not.toHaveProperty('reuseAi');
    });
  }

  it('uses the US time zone instead of an India language region', async () => {
    timeZone('America/Los_Angeles');
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-IN');
    start();
    await aboutYou();
    expect(await screen.findByText('United States, from your time zone')).toBeTruthy();
    expect(screen.getByText('USD')).toBeTruthy();
  });

  it('keeps the owner country choice when their sentence names clients elsewhere', async () => {
    timeZone('Asia/Kolkata');
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US');
    const request = start();
    await aboutYou();
    await screen.findByText('India, from your time zone');
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Country' }), { target: { value: 'GB' } });
    await sendAndKeep('Bookkeeping for clients in India and Canada.');
    await waitFor(() => expect(request).toHaveBeenCalledWith('venture.create', expect.objectContaining({ countryCode: 'GB' })));
  });
});

describe('wave 6 country suggestions', () => {
  const words = 'I live in the United Kingdom and offer bookkeeping to clients in India.';
  for (const keep of [false, true]) it(`asks before using an AI country suggestion and respects ${keep ? 'Keep' : 'Use'}`, async () => {
    timeZone('Asia/Kolkata');
    const request = await connected();
    await aboutYou();
    await screen.findByText('India, from your time zone');
    fireEvent.change(screen.getByRole('textbox', { name: BOX }), { target: { value: words } });
    expect(request.mock.calls.some(([method]) => method === 'venture.about.read' || method === 'venture.country.suggest')).toBe(false);
    await sendAndKeep(words, async () => {
      const use = await screen.findByRole('button', { name: 'Use United Kingdom' });
      expect(screen.getByText('Your words suggest United Kingdom, with prices in GBP.')).toBeTruthy();
      expect(request.mock.calls.some(([method]) => method === 'workspace.create')).toBe(false);
      fireEvent.click(keep ? screen.getByRole('button', { name: 'Keep India' }) : use);
    });
    await waitFor(() => expect(request).toHaveBeenCalledWith('venture.create', expect.objectContaining({ countryCode: keep ? 'IN' : 'GB' })));
  });

  it('does not ask AI to override a manually selected country', async () => {
    timeZone('Asia/Kolkata');
    const request = await connected();
    await aboutYou();
    await screen.findByText('India, from your time zone');
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Country' }), { target: { value: 'CA' } });
    await sendAndKeep(words, async () => { expect(screen.queryByRole('button', { name: 'Use United Kingdom' })).toBeNull(); });
    await waitFor(() => expect(request).toHaveBeenCalledWith('venture.create', expect.objectContaining({ countryCode: 'CA' })));
    expect(request.mock.calls.some(([method]) => method === 'venture.country.suggest')).toBe(false);
  });

  it('shows a service failure and creates no business until the owner can retry', async () => {
    timeZone('Asia/Kolkata');
    const engine = new FakeEngine({ fresh: true });
    const original = engine.request.bind(engine);
    vi.spyOn(engine, 'request').mockImplementation((method, params) => method === 'venture.about.read'
      ? Promise.reject(new EngineError('MODEL_TIMEOUT', 'Your AI did not answer. Try again.')) : original(method, params));
    const request = start(engine);
    await aboutYou();
    fireEvent.change(screen.getByRole('textbox', { name: BOX }), { target: { value: words } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
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
