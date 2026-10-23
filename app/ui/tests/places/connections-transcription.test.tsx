// Connections > Your AI: transcription on this computer (Ink v2 wave 2, 2E2). The owner sets the full paths to the
// whisper-cli program and its model file of a whisper.cpp already on this computer (venture.transcription.set), sees
// the engine's honest status (set up, not set up, files missing), and can remove the setup. Desktop only.
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError, type TranscriptionSetupView } from '../../src/engine/types';

const CLI = 'C:\\whisper.cpp\\whisper-cli.exe';
const MODEL = 'C:\\whisper.cpp\\models\\ggml-base.bin';
const TITLE = 'Transcription on this computer';

function start(engine = new FakeEngine(), options: { hosted?: boolean } = {}) {
  window.location.hash = '#/connections';
  const client = createFakeClient(engine);
  render(<App client={options.hosted ? { ...client, transport: 'hosted' } : client} language="en" />);
  return engine;
}
const part = () => screen.findByRole('group', { name: TITLE });
const sets = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.filter((call) => call[0] === 'venture.transcription.set').map((call) => call[1]);

describe('Connections > Your AI: transcription on this computer', () => {
  it('says plainly it is not set up, takes the two paths, keeps them, and can remove them', async () => {
    const engine = new FakeEngine();
    const spy = vi.spyOn(engine, 'request');
    start(engine);
    const box = await part();
    expect(await within(box).findByText('No whisper.cpp is set up on this computer.')).toBeTruthy();
    expect(within(box).getByText('Uses a whisper.cpp already on this computer. Chausar never installs it or downloads a model.')).toBeTruthy();
    expect(within(box).queryByRole('button', { name: 'Remove' })).toBeNull();
    fireEvent.change(within(box).getByLabelText('whisper-cli program'), { target: { value: CLI } });
    fireEvent.change(within(box).getByLabelText('Model file'), { target: { value: MODEL } });
    await act(async () => { fireEvent.click(within(box).getByRole('button', { name: 'Save' })); });
    expect(sets(spy)).toEqual([{ command: CLI, model: MODEL }]);
    expect(await within(box).findByText('whisper.cpp is set up on this computer.')).toBeTruthy();
    await act(async () => { fireEvent.click(within(box).getByRole('button', { name: 'Remove' })); });
    expect(sets(spy)).toEqual([{ command: CLI, model: MODEL }, { clear: true }]);
    expect(await within(box).findByText('No whisper.cpp is set up on this computer.')).toBeTruthy();
    expect((within(box).getByLabelText('whisper-cli program') as HTMLInputElement).value).toBe('');
  });

  it("shows the paths kept and the files-missing status in the engine's words, and its refusals", async () => {
    const engine = new FakeEngine();
    const real = engine.request.bind(engine);
    const missing: TranscriptionSetupView = { status: 'files-missing', command: CLI, model: MODEL, ffmpeg: true, line: 'The whisper model file is not where it was set up on this computer. Chausar never downloads one.' };
    vi.spyOn(engine, 'request').mockImplementation(async (method: string, params?: unknown) => {
      if (method === 'venture.transcription.get') return missing;
      if (method === 'venture.transcription.set') throw new EngineError('INVALID_VENTURE_REQUEST', 'The model file is not at that path on this computer. Chausar never downloads one.');
      return real(method, params);
    });
    start(engine);
    const box = await part();
    expect(await within(box).findByText(missing.line)).toBeTruthy();
    await waitFor(() => expect((within(box).getByLabelText('whisper-cli program') as HTMLInputElement).value).toBe(CLI));
    expect((within(box).getByLabelText('Model file') as HTMLInputElement).value).toBe(MODEL);
    await act(async () => { fireEvent.click(within(box).getByRole('button', { name: 'Save' })); });
    expect(await within(box).findByText("Couldn't save this: The model file is not at that path on this computer. Chausar never downloads one.")).toBeTruthy();
  });

  it('is not shown on the hosted server, which reads no file on your computer', async () => {
    start(new FakeEngine({ hosted: true }), { hosted: true });
    const section = await screen.findByRole('region', { name: 'Your AI' });
    await waitFor(() => expect(section.textContent).toContain('USD 0.0000'));
    expect(screen.queryByRole('group', { name: TITLE })).toBeNull();
  });

  it('the fake engine keeps the rules: a network path, a program not named whisper-cli, and the hosted server are refused', async () => {
    const engine = new FakeEngine();
    await expect(engine.request('venture.transcription.set', { command: '\\\\nas\\tools\\whisper-cli.exe', model: MODEL })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
    await expect(engine.request('venture.transcription.set', { command: 'C:\\whisper.cpp\\main.exe', model: MODEL })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
    await expect(engine.request('venture.transcription.set', { command: 'whisper-cli', model: MODEL })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
    const set = (await engine.request('venture.transcription.set', { command: CLI, model: MODEL })) as TranscriptionSetupView;
    expect([set.status, set.command, set.model]).toEqual(['set-up', CLI, MODEL]);
    expect(((await engine.request('venture.transcription.get', {})) as TranscriptionSetupView).status).toBe('set-up');
    await expect(new FakeEngine({ hosted: true }).request('venture.transcription.set', { command: CLI, model: MODEL })).rejects.toMatchObject({ code: 'TIER_UNAVAILABLE' });
  });
});
