import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError, type AssetView, type AssetsView, type MethodName } from '../../src/engine/types';

// Ink v2 wave 5 package 5A4 (P7, P8, P9): the client's brand kit on the client sheet, and the order's delivered files
// and the voices with consent on Work. Every word of state comes from the engine; refusals are worded from the
// engine's codes, in English and Hindi.

type Call = { method: string; params: unknown };
interface StartOptions { language?: 'en' | 'hi'; intercept?: Partial<Record<MethodName, (params: unknown) => unknown>> }

function start(hash: string, options: StartOptions = {}) {
  window.location.hash = hash;
  const client = createFakeClient(new FakeEngine());
  const calls: Call[] = [];
  const request = client.request.bind(client);
  client.request = ((method: MethodName, params?: unknown) => {
    calls.push({ method, params });
    const own = options.intercept?.[method];
    if (own) return Promise.resolve().then(() => own(params));
    return request(method, params as never);
  }) as typeof client.request;
  render(<App client={client} language={options.language ?? 'en'} />);
  return { calls };
}

const settle = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const press = async (element: HTMLElement) => { await act(async () => { fireEvent.click(element); }); await settle(); };

const ORDER = '#/work?order=o-boat-12';
const base = { orderId: 'o-boat-12', clientId: 'c-boat', runId: null, toolCallId: null, attribution: null, consentId: null, derived: null, supersededBy: null, supersedes: null, reusedFrom: null, stale: false, at: '2026-10-03T10:00:00.000Z' } as const;
const ASSETS: AssetsView = {
  line: '2 files. 1 needs you before it can go out.',
  assets: [
    { ...base, id: 'asset_1', name: 'thumbnail.png', fileDigest: 'ab'.repeat(32), source: { kind: 'generated', model: 'image-model-2', prompt: 'A desk' }, licence: 'Yours to use', cost: { kind: 'not-measured' }, state: 'ready', hygiene: { state: 'not-media', removed: [] }, blocked: null, sourceLine: 'Made by image-model-2', costLine: 'Cost not measured' },
    { ...base, id: 'asset_2', name: 'music.mp3', fileDigest: null, source: { kind: 'unknown' }, licence: null, cost: { kind: 'not-measured' }, state: 'ready', hygiene: { state: 'not-media', removed: [] }, blocked: { code: 'ASSET_LICENCE_UNKNOWN', line: 'music.mp3 has no known licence. Record where it came from, or take it out.' }, sourceLine: 'Source unknown', costLine: 'Cost not measured' },
  ] as AssetView[],
};

describe('kit media: the order\'s files on Work', () => {
  it('lists each file with where it came from and its licence, words why one blocks Accept, and runs a generated file again', async () => {
    const { calls } = start(ORDER, { intercept: { 'venture.assets.list': () => ASSETS } });
    await settle();
    const tile = screen.getByRole('region', { name: 'Files and voices' });
    const list = within(tile).getByRole('list', { name: 'Files this order delivers' });
    expect(within(list).getByText('thumbnail.png')).toBeTruthy();
    expect(within(list).getByText('Made by image-model-2')).toBeTruthy();
    expect(within(list).getByText('Licence unknown')).toBeTruthy();
    expect(within(list).getByText('No known licence. Record where it came from, or take it out.')).toBeTruthy();
    await press(within(list).getByRole('button', { name: 'Run again' }));
    expect(calls.some((call) => call.method === 'venture.assets.rerun' && (call.params as { id: string }).id === 'asset_1')).toBe(true);
  });

  it('words a refusal from its code, in Hindi too', async () => {
    start(ORDER, {
      language: 'hi',
      intercept: {
        'venture.assets.list': () => ASSETS,
        'venture.assets.rerun': () => { throw new EngineError('ASSET_REFUSED', 'thumbnail.png was already made again.'); },
      },
    });
    await settle();
    const tile = screen.getByRole('region', { name: 'फ़ाइलें और आवाज़ें' });
    await press(within(tile).getByRole('button', { name: 'फिर से बनाएं' }));
    expect(within(tile).getByRole('alert').textContent).toBe('यह फ़ाइल इस तरह इस्तेमाल नहीं हो सकती।');
  });
});

describe('kit media: the client\'s brand kit', () => {
  it('shows the kit with each field\'s source, and saves an edit as a new version', async () => {
    const { calls } = start('#/clients?sheet=client:c-boat');
    await settle();
    const kit = document.querySelector('[data-brand-kit]') as HTMLElement;
    expect(kit).toBeTruthy();
    expect(within(kit).getByText('Brand kit')).toBeTruthy();
    expect(within(kit).getByText('Version 1. Every creative step reads it.')).toBeTruthy();
    expect(within(kit).getByText('Warm, short sentences, Speaks to families')).toBeTruthy();
    await press(within(kit).getByRole('button', { name: /brand kit|Edit kit/ }));
    const form = within(kit).getByRole('form', { name: 'Brand kit' });
    fireEvent.change(within(form).getByLabelText('Colours'), { target: { value: '#1F6F43, #fff' } });
    fireEvent.change(within(form).getByLabelText('Banned words'), { target: { value: 'cheap, best ever' } });
    await press(within(form).getByRole('button', { name: 'Save kit' }));
    const set = calls.find((call) => call.method === 'venture.brandKit.set')!;
    expect(set.params).toMatchObject({ clientId: 'c-boat', kit: { colours: ['#1F6F43', '#fff'], bannedWords: ['cheap', 'best ever'] } });
    expect(within(kit).getByText('#1f6f43, #ffffff')).toBeTruthy();
    expect(within(kit).getByText(/Version \d+\. Every creative step reads it\./)).toBeTruthy();
  });

  it('a client with no kit reads your own voice and house style, and offers to add one', async () => {
    start('#/clients?sheet=client:c-nimbus');
    await settle();
    const kit = document.querySelector('[data-brand-kit]') as HTMLElement;
    expect(within(kit).getByText('This client has no brand kit yet. Steps use your own voice and house style.')).toBeTruthy();
    expect(within(kit).getAllByText(/^(From your voice|House style)$/).length).toBeGreaterThan(0);
    expect(within(kit).getByRole('button', { name: 'Add a brand kit' }).getAttribute('data-variant')).toBe('primary');
  });

  it('words a key refused in the kit, and keeps the form open', async () => {
    start('#/clients?sheet=client:c-boat', { intercept: { 'venture.brandKit.set': () => { throw new EngineError('CHAT_KEY_REFUSED', 'That looks like a key.'); } } });
    await settle();
    const kit = document.querySelector('[data-brand-kit]') as HTMLElement;
    await press(within(kit).getByRole('button', { name: /brand kit|Edit kit/ }));
    await press(within(kit).getByRole('button', { name: 'Save kit' }));
    expect(within(kit).getByRole('alert').textContent).toBe('The kit was not saved. That looks like a key or an id number. Chausar never keeps those here, so nothing was saved.');
    expect(within(kit).getByRole('form', { name: 'Brand kit' })).toBeTruthy();
  });
});
