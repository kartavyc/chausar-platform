// Chausar 5B1 regression tests. Tomada (AGPL, ideas only), Kimo (MIT), FilmCraft (MIT/Apache-2.0); original tests.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { YoutubeDesk } from '../../src/places/work/desks/YoutubeDesk';
import { EngineProvider } from '../../src/engine/context';
import { TextProvider } from '../../src/text';
import { createFakeClient, FakeEngine } from '../../src/engine/fake';
import { fakeYoutubeDesk } from '../../src/engine/fake-youtube';
import type { W4DeskHost } from '../../src/engine/fake-w4';
import type { EngineClient } from '../../src/engine/types';
const source = { label: 'words.json', durationMs: 10000, words: [
  { id: 'w1', text: 'We', startMs: 0, endMs: 1000 }, { id: 'w2', text: 'make', startMs: 1000, endMs: 2000 }, { id: 'w3', text: 'coffee', startMs: 2000, endMs: 3000 },
] };
afterEach(() => vi.unstubAllGlobals());
function start(language: 'en' | 'hi' = 'en') {
  let sourceFingerprint = 'source-bytes';
  const orders = [{ id: 'order1', request: 'Our coffee video', status: 'open', intake: { rights: { basis: 'own-footage', holder: 'Asha' } } }];
  const host = { current: () => 'b1', now: () => '2026-10-27T10:00:00Z', hosted: () => false, uploadFingerprint: () => sourceFingerprint, digest: (value: unknown) => JSON.stringify(value), emit: () => {}, ask: (method: string) => method === 'venture.files.list' ? [{id:'upload_source',name:'source.srt',at:'2026-10-27',bytes:30,format:'transcript',scope:{kind:'order',orderId:'order1'}}] : method === 'venture.assets.list' ? {assets:[]} : orders } as unknown as W4DeskHost;
  const desks = fakeYoutubeDesk(host).kinds; const desk = desks.edit!;
  desk.act!({ playbook: 'youtube', kind: 'edit', id: 'new', action: 'create', payload: { orderId: 'order1', source, sourceRef: { kind: 'transcript', orderId: 'order1' } } });
  const client = createFakeClient(new FakeEngine());
  client.request = ((method: string, p: Record<string, unknown>) => Promise.resolve().then(() => {
    if (method === 'venture.order.list') return orders;
    if (method === 'venture.files.list' || method === 'venture.assets.list') return host.ask(method, p);
    if (method.startsWith('venture.desk.')) { const op = method.slice(13) as 'list' | 'get' | 'act'; return desks[String(p.kind)]![op]!(p); }
    throw new Error(method);
  })) as EngineClient['request'];
  render(<TextProvider language={language}><EngineProvider client={client}><YoutubeDesk /></EngineProvider></TextProvider>);
  return { staleSource: () => { sourceFingerprint = 'changed-bytes'; } };
}
describe('YouTube word editor', () => {
  it('checks source freshness again before exporting cached captions', async () => {
    const makeUrl = vi.fn(() => 'blob:test-captions');
    vi.stubGlobal('URL', class extends URL { static createObjectURL = makeUrl; static revokeObjectURL = vi.fn(); });
    const { staleSource } = start();
    fireEvent.click(await screen.findByRole('button', { name: 'Open edit' }));
    fireEvent.click(await screen.findByText('Captions'));
    fireEvent.click(screen.getByRole('button', { name: 'Make captions' }));
    const save = await screen.findByRole('button', { name: 'Save SRT' });
    staleSource();
    fireEvent.click(save);
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeNull());
    expect(makeUrl).not.toHaveBeenCalled();
  });
  it('imports measured words only after choosing their real source file', async () => {
    start();
    const chosen = await screen.findByLabelText('Source of these word times');
    expect(chosen).not.toBeNull();
    fireEvent.change(chosen, { target: { value: 'transcript' } });
    fireEvent.change(screen.getByLabelText('Measured word-time JSON file'), { target: { files: [{ name: 'fresh-words.json', size: 200, text: async () => JSON.stringify(source) }] } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Import word times' }).getAttribute('aria-disabled')).not.toBe('true'));
    fireEvent.click(screen.getByRole('button', { name: 'Import word times' }));
    expect(await screen.findByRole('heading', { name: 'Review the edit' })).not.toBeNull();
    expect(screen.getAllByText('fresh-words.json').length).toBeGreaterThan(0);
  });
  it('shows each typed operation, a large-edit second ask and one Undo for the request', async () => {
    start();
    fireEvent.click(await screen.findByRole('button', { name: 'Open edit' }));
    fireEvent.change(await screen.findByLabelText('Ask for a change'), { target: { value: 'Cut the opening' } });
    fireEvent.click(screen.getByText('Typed operations'));
    fireEvent.change(screen.getByLabelText('Operations as JSON'), { target: { value: JSON.stringify([{ kind: 'cut', from: 'w1', to: 'w3' }]) } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply request' }));
    expect(await screen.findByRole('button', { name: 'Confirm this large edit' })).not.toBeNull();
    expect(screen.getByText('This removes 30% of the footage. Read the preview, then confirm.')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm this large edit' }));
    expect(await screen.findByText('Cut 1 passage, 3 s shorter.')).not.toBeNull();
    expect(screen.getByText('Applied')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Undo request' }));
    await waitFor(() => expect(screen.queryByText('Cut 1 passage, 3 s shorter.')).toBeNull());
  });
  it('shows the desk and its import path in Hindi', async () => {
    start('hi');
    expect(await screen.findByRole('heading', { name: 'शब्दों से वीडियो संपादित करें' })).not.toBeNull();
    expect(screen.getByLabelText('मापे गए शब्द समय की जेएसओएन फ़ाइल')).not.toBeNull();
  });
});
