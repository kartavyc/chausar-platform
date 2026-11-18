import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { EngineClient } from '../../src/engine/types';
import { skipAi } from './first-run-steps';

/**
 * "Which of these are you?" is skipped when the AI already read work that fits none of the field's listed professions
 * (founder, 14 Nov 2026: a potter filed under Creative work had to pick "None of these"). The engine says so on the
 * read (ownKind); the rules step then reads the field, exactly as "None of these" did. A field with a profession that
 * switches a tool off (an advocate) never says it, so that owner is still asked.
 */
const POTTER = 'I make pottery by hand, mostly mugs and bowls, and I want bulk orders from cafes in Pune.';
const READ = {
  family: { id: 'creative', label: 'Creative work', line: 'Design, photos, video and writing.' }, profession: null, country: null, evidence: null, idea: POTTER, source: 'ai',
  offers: [{ name: 'Cafe mug sets', line: 'Handmade mugs in bulk for cafes' }], reply: 'You make pottery by hand. Where are you based?',
};

type Call = [string, Record<string, unknown>];
function start(read: unknown) {
  const original = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (this: Intl.DateTimeFormat) { return { ...original.call(this), timeZone: 'Asia/Kolkata' }; });
  window.location.hash = '#/today';
  const fake = createFakeClient(new FakeEngine({ fresh: true }));
  const calls: Call[] = [];
  const client: EngineClient = { ...fake, request: ((method: string, params?: Record<string, unknown>) => {
    calls.push([method, structuredClone(params ?? {})]);
    if (method === 'venture.about.read') return Promise.resolve(structuredClone(read));
    return fake.request(method as never, params as never);
  }) as EngineClient['request'] };
  render(<App client={client} language="en" />);
  return { calls };
}
async function keep() {
  const box = await skipAi();
  fireEvent.change(box, { target: { value: POTTER } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
  const button = await screen.findByRole('button', { name: 'Keep this plan' });
  await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
  await act(async () => { fireEvent.click(button); });
}

afterEach(() => { vi.restoreAllMocks(); });

describe('first run: the profession question', () => {
  it('is skipped when the AI read work that fits none of the listed professions; the rules step reads the field', async () => {
    const { calls } = start({ ...READ, ownKind: true });
    await keep();
    const check = await screen.findByRole('region', { name: 'Day job and rules' }, { timeout: 4000 });
    expect(screen.queryByRole('heading', { name: 'Which of these are you?' })).toBeNull();
    expect(calls.find(([method]) => method === 'venture.compliance.get')?.[1]).toEqual({ profession: 'creative' });
    expect(check.getAttribute('data-compliance')).toBe('creative');
  });

  it('is still asked when the read does not say so', async () => {
    start(READ);
    await keep();
    expect(await screen.findByRole('heading', { level: 1, name: 'Which of these are you?' }, { timeout: 4000 })).toBeTruthy();
  });
});

describe('fake About you: work that fits no listed profession', () => {
  async function withAi() {
    const client = createFakeClient(new FakeEngine({ fresh: true }));
    const options = await client.request('venture.ai.options', {});
    const preset = options.presets.find((row) => row.id === 'claude-code-cli')!;
    await client.request('venture.ai.connect', { presetId: preset.id, consentDigest: preset.consentDigest });
    return client;
  }
  it('says so as the engine does: only on an AI read with a field and no pick, and never where a profession switches a tool off', async () => {
    const client = await withAi();
    const studio = await client.request('venture.about.read', { text: 'I run a small weekend photography studio in Pune.' });
    expect(studio.family?.id).toBe('creative');
    expect(studio.profession).toBeNull();
    expect(studio.ownKind).toBe(true);
    const picked = await client.request('venture.about.read', { text: 'I am an advocate in Pune and want to help small firms with contracts.' });
    expect(picked.profession?.id).toBe('advocate');
    expect(picked.ownKind).toBeUndefined();
    const vague = await client.request('venture.about.read', { text: 'I do some legal work for people near me.' });
    expect(vague.family?.id).toBe('licensed');
    expect(vague.profession).toBeNull();
    expect(vague.ownKind).toBeUndefined();
    const plain = createFakeClient(new FakeEngine({ fresh: true }));
    expect((await plain.request('venture.about.read', { text: 'I run a small weekend photography studio in Pune.' })).ownKind).toBeUndefined();
    expect((await plain.request('venture.about.pick', { familyId: 'creative' })).ownKind).toBeUndefined();
  });
});
