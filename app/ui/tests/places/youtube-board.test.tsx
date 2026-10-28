// Chausar 5B2 review workflow, original tests; Tomada (AGPL) interaction idea only.
import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { YoutubeBoardChecks } from '../../src/places/work/desks/YoutubeBoardChecks';
import { YoutubeBoard } from '../../src/places/work/desks/YoutubeBoard';
import { EngineProvider } from '../../src/engine/context';
import { TextProvider } from '../../src/text';
import { createFakeClient, FakeEngine } from '../../src/engine/fake';
import { fakeYoutubeDesk } from '../../src/engine/fake-youtube';
import type { W4DeskHost } from '../../src/engine/fake-w4';
import type { EngineClient } from '../../src/engine/types';

function start(language: 'en' | 'hi' = 'en', desktop = true) {
  const orders = [{ id: 'o1', request: 'Coffee video', status: 'open', intake: { cutFile: 'C:\\Videos\\coffee.mp4', rights: { basis: 'own-footage', holder: 'Asha' } } }];
  const host = { current: () => 'b1', now: () => '2026-10-28T10:00:00Z', hosted: () => false, digest: (value: unknown) => JSON.stringify(value), emit: () => {}, uploadFingerprint: () => 'source', ask: (method: string) => method === 'venture.files.list' ? [{ id: 'u1', name: 'words.srt', format: 'transcript', bytes: 50, at: '2026-10-28', scope: { kind: 'order', orderId: 'o1' } }] : method === 'venture.assets.list' ? { assets: [] } : orders } as unknown as W4DeskHost;
  const desks = fakeYoutubeDesk(host).kinds;
  const made = desks.edit!.act!({ playbook: 'youtube', kind: 'edit', id: 'new', action: 'create', payload: { orderId: 'o1', source: { label: 'Coffee words', durationMs: 60000, words: [{ id: 'w1', text: 'A useful coffee tip.', startMs: 0, endMs: 30000 }] }, sourceRef: { kind: 'transcript', orderId: 'o1' } } }) as { id: string };
  const client = createFakeClient(new FakeEngine());
  client.request = vi.fn((method: string, p: Record<string, unknown>) => Promise.resolve().then(() => {
    if (method === 'venture.order.list') return orders;
    if (method === 'venture.assets.list') return { assets: [] };
    const op = method.slice(13) as 'list' | 'get' | 'act';
    return desks[String(p.kind)]![op]!(p);
  })) as EngineClient['request'];
  const save = vi.fn(async () => ({ saved: true as const, savedId: 'safe-handle', folder: 'o1', line: 'Saved.' }));
  const open = vi.fn(async () => ({ opened: true as const }));
  if (desktop) { client.saveYoutubeProject = save; client.openYoutubeProject = open; }
  render(<TextProvider language={language}><EngineProvider client={client}><YoutubeBoard editId={made.id} /></EngineProvider></TextProvider>);
  return { client, save, open };
}
async function prepare() {
  fireEvent.change(await screen.findByLabelText('YouTube publishing text'), { target: { value: 'A useful coffee tip' } });
  fireEvent.click(screen.getByRole('button', { name: 'Prepare outputs' }));
  await screen.findByRole('region', { name: 'metadata/youtube.txt' });
}
it('requires every exact output decision, invalidates edited text, and opens only the saved folder handle', async () => {
  const { save, open } = start(); await prepare();
  expect(screen.getByRole('button', { name: 'Save project folder' }).getAttribute('aria-disabled')).toBe('true');
  for (const button of screen.getAllByRole('button', { name: 'Approve output' })) { fireEvent.click(button); await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false)); }
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save project folder' }).getAttribute('aria-disabled')).not.toBe('true'));
  const card = screen.getByRole('region', { name: 'metadata/youtube.txt' });
  fireEvent.change(within(card).getByLabelText('Publishing text'), { target: { value: 'Changed coffee tip' } });
  expect(screen.getByRole('button', { name: 'Save project folder' }).getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(within(card).getByRole('button', { name: 'Save publishing text' }));
  await waitFor(() => expect(within(card).getByText('Awaiting your decision')).not.toBeNull());
  fireEvent.click(within(card).getByRole('button', { name: 'Approve output' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save project folder' }).getAttribute('aria-disabled')).not.toBe('true'));
  fireEvent.click(screen.getByRole('button', { name: 'Save project folder' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Open folder to post' }));
  await waitFor(() => expect(open).toHaveBeenCalledWith('safe-handle'));
  expect(save).toHaveBeenCalledOnce();
});
it('records a change request without claiming a model already made it', async () => {
  const { client } = start(); await prepare();
  const card = screen.getByRole('region', { name: 'edl/cut.edl' });
  fireEvent.click(within(card).getByText('Ask for a change'));
  fireEvent.change(within(card).getByLabelText('Describe the change'), { target: { value: 'Use a gentler opening' } });
  fireEvent.click(within(card).getByRole('button', { name: 'Keep change request' }));
  expect(await within(card).findByText('Use a gentler opening')).not.toBeNull();
  expect(client.request).toHaveBeenCalledWith('venture.desk.act', expect.objectContaining({ action: 'request', payload: { outputId: 'interchange-edl', words: 'Use a gentler opening' } }));
});
it('labels web folder saving honestly and renders the output controls in Hindi', async () => {
  start('hi', false);
  expect(await screen.findByText('प्रोजेक्ट फ़ोल्डर के लिए डेस्कटॉप ऐप खोलें।')).not.toBeNull();
  expect(screen.getByRole('button', { name: 'आउटपुट तैयार करें' })).not.toBeNull();
});
it('runs speaking-time checks and exposes local tools as unavailable without fake measurements', async () => {
  const { client } = start(); await prepare();
  fireEvent.click(screen.getByText('Checks and editor handoff'));
  fireEvent.click(screen.getByText('Speaking beats'));
  fireEvent.change(screen.getByLabelText('One spoken line per row'), { target: { value: 'Make this today.\nTry a simple step.' } });
  fireEvent.change(screen.getByLabelText('Loop back to this opening line'), { target: { value: 'Make this today.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Check speaking time' }));
  expect(await screen.findByText('Speaking checks passed')).not.toBeNull();
  expect(client.request).toHaveBeenCalledWith('venture.desk.act', expect.objectContaining({ action: 'beats', payload: { lines: ['Make this today.', 'Try a simple step.'], wordsPerMinute: 180, bucket: 4, loopBack: 'Make this today.' } }));
  fireEvent.click(screen.getByText('Local editor command'));
  fireEvent.change(screen.getByLabelText('One command argument per row'), { target: { value: 'render\nproject.fcpxml' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review command' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Approve and run this command' }));
  expect((await screen.findByRole('alert')).textContent).toContain('This editor is not installed.');
});

it('records a clip page and keeps audio extraction honest in the browser',async()=>{start();await prepare();fireEvent.change(screen.getByLabelText('Clip page name'),{target:{value:'Coffee lesson'}});fireEvent.click(screen.getByRole('button',{name:'Prepare clip page'}));await screen.findByRole('region',{name:'metadata/clip-1.html'});fireEvent.change(screen.getByLabelText('Audio source file'),{target:{value:'C:\\Videos\\coffee.mp4'}});fireEvent.click(screen.getByRole('button',{name:'Extract audio'}));await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('ffmpeg'));});

it('requires finishing checks again after input edits and ignores an old in-flight measurement', async () => {
  const { client } = start(); await prepare();
  for (const button of screen.getAllByRole('button', { name: 'Approve output' })) { fireEvent.click(button); await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false)); }
  const original = client.request;
  let release: (value: unknown) => void = () => {};
  let delayed = false;
  client.request = vi.fn(async (method: string, args: any) => {
    if (method === 'venture.desk.act' && args.action === 'finishing') {
      const source: any = await original('venture.desk.get', { playbook: 'youtube', kind: 'board', id: args.id });
      const response = { result: { ...source.item, board: { ...source.item.board, finishing: [{ id: 'commentary-share', outcome: 'pass' }], finishingBinding: { file: args.payload.file } } } };
      if (delayed) return new Promise(resolve => { release = () => resolve(response); });
      return response;
    }
    return original(method as any, args);
  }) as EngineClient['request'];
  fireEvent.change(screen.getByLabelText('Local finished video file'), { target: { value: 'C:\\a.mp4' } });
  fireEvent.click(screen.getByRole('button', { name: 'Measure finished video' }));
  await screen.findByText('Commentary share: Passed');
  expect(screen.getByRole('button', { name: 'Save project folder' }).getAttribute('aria-disabled')).not.toBe('true');
  fireEvent.change(screen.getByLabelText('Local finished video file'), { target: { value: 'C:\\b.mp4' } });
  expect(screen.queryByText('Commentary share: Passed')).toBeNull();
  expect(screen.getByRole('button', { name: 'Save project folder' }).getAttribute('aria-disabled')).toBe('true');
  delayed = true;
  fireEvent.click(screen.getByRole('button', { name: 'Measure finished video' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Measure finished video' }).hasAttribute('disabled')).toBe(true));
  fireEvent.change(screen.getByLabelText('Your commentary duration, seconds'), { target: { value: '12' } });
  release(undefined);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Measure finished video' }).hasAttribute('disabled')).toBe(false));
  expect(screen.queryByText('Commentary share: Passed')).toBeNull();
  expect(screen.getByRole('button', { name: 'Save project folder' }).getAttribute('aria-disabled')).toBe('true');
});


it('requires fresh owner answers when the frame grid changes', async () => {
  const client = createFakeClient(new FakeEngine());
  client.request = vi.fn(async (method: string) => method === 'venture.desk.get' ? { item: { orderId: 'o1', document: { words: [] } } } : method === 'venture.assets.list' ? { assets: [] } : { rows: [] }) as EngineClient['request'];
  const board = { outputs: [], broll: { beats: [], windows: [], digest: 'plan', approvedDigest: 'plan', assetBindings: [{ id: 'a1' }] }, grids: { a1: { digest: 'grid-a', contentBase64: '' } } } as any;
  const show = (value: typeof board) => <TextProvider language="en"><EngineProvider client={client}><YoutubeBoardChecks editId="e1" board={value} busy={false} act={vi.fn()} onFinishingDirty={vi.fn()} /></EngineProvider></TextProvider>;
  const view = render(show(board));
  const questions = ['Are captions already burned into the image?', 'Are another creator’s lower-third labels visible?', 'Are watermarks visible?'];
  for (const question of questions) fireEvent.change(await screen.findByLabelText(question), { target: { value: 'no' } });
  expect(screen.getByRole('button', { name: 'Record my grid review' }).getAttribute('aria-disabled')).not.toBe('true');
  view.rerender(show({ ...board, grids: { a1: { digest: 'grid-b', contentBase64: '' } } }));
  expect(screen.getByRole('button', { name: 'Record my grid review' }).getAttribute('aria-disabled')).toBe('true');
  for (const question of questions) expect((screen.getByLabelText(question) as HTMLSelectElement).value).toBe('');
});
