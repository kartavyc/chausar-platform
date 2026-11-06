// C5 tasks 27, 28: Business > Reports. Export diagnostics shows what's inside first, and saves by the preview's id; crash
// files only when ticked, with the warning. Diagnostics in plain words: the engine's line, code sums.
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { EngineProvider } from '../../src/engine/context';
import { TextProvider } from '../../src/text';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { ReportsView } from '../../src/places/business/ReportsView';

const PREVIEW = {
  id: 'preview-1',
  files: [{ name: 'startup.jsonl', bytes: 2048 }, { name: 'rpc.jsonl', bytes: 512 }],
  dumps: [], dumpsThere: 1, leftOut: 0, text: '{"format":"chausar.diagnostics.v1"}', bytes: 35,
};

function mount(bridge: Record<string, unknown> = {}) {
  const client = Object.assign(createFakeClient(new FakeEngine()), bridge);
  const request = vi.spyOn(client, 'request');
  render(<TextProvider language="en"><EngineProvider client={client as never}><ReportsView /></EngineProvider></TextProvider>);
  return { client, request };
}

describe('task 27: Export diagnostics', () => {
  it('needs the desktop: the browser rehearsal shows no button', async () => {
    mount();
    await screen.findByText(/Reports are off/);
    expect(screen.queryByRole('button', { name: 'Export diagnostics' })).toBeNull();
  });

  it('shows the list, the sizes and the text first, then saves that preview; nothing is saved before the press', async () => {
    const previewDiagnostics = vi.fn(async () => PREVIEW);
    const saveDiagnostics = vi.fn(async () => ({ saved: true, name: 'chausar-diagnostics-2026-11-06.json', line: 'Saved chausar-diagnostics-2026-11-06.json. Chausar did not send it anywhere.' }));
    mount({ previewDiagnostics, saveDiagnostics });
    fireEvent.click(await screen.findByRole('button', { name: 'Export diagnostics' }));
    await waitFor(() => expect(previewDiagnostics).toHaveBeenCalledWith(false));
    const section = screen.getByRole('heading', { name: 'Diagnostics' }).parentElement!;
    await within(section).findByText(/startup\.jsonl/);
    expect(within(section).getByText(/startup.jsonl, 2 KB/)).toBeTruthy();
    expect(section.querySelector('pre')?.textContent).toBe(PREVIEW.text);
    expect(saveDiagnostics).not.toHaveBeenCalled();
    fireEvent.click(within(section).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saveDiagnostics).toHaveBeenCalledWith('preview-1'));
    expect(await screen.findByText(/did not send it anywhere/)).toBeTruthy();
    expect(section.querySelector('pre')).toBeNull();
  });

  it('crash files come in only by the tick, with the warning, and the preview is read again', async () => {
    const withDumps = { ...PREVIEW, id: 'preview-2', dumps: [{ name: 'a1.dmp', bytes: 4096 }], text: 'with the dump' };
    const previewDiagnostics = vi.fn(async (dumps: boolean) => (dumps ? withDumps : PREVIEW));
    const saveDiagnostics = vi.fn(async () => null);
    mount({ previewDiagnostics, saveDiagnostics });
    fireEvent.click(await screen.findByRole('button', { name: 'Export diagnostics' }));
    const section = screen.getByRole('heading', { name: 'Diagnostics' }).parentElement!;
    const tick = await within(section).findByRole('checkbox', { name: /Add crash files/ }) as HTMLInputElement;
    expect(tick.checked).toBe(false);
    expect(within(section).getByText('A crash file can hold parts of what was on screen.')).toBeTruthy();
    fireEvent.click(tick);
    await waitFor(() => expect(previewDiagnostics).toHaveBeenLastCalledWith(true));
    await within(section).findByText(/a1\.dmp/);
    expect(section.querySelector('pre')?.textContent).toBe('with the dump');
    fireEvent.click(within(section).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saveDiagnostics).toHaveBeenCalledWith('preview-2'));
    // Cancelled in the system dialog: the preview stays.
    await act(async () => {});
    expect(section.querySelector('pre')).toBeTruthy();
  });

  it('with no crash files there is no tick; a refusal says so in the page', async () => {
    const previewDiagnostics = vi.fn(async () => ({ ...PREVIEW, dumpsThere: 0 }));
    const saveDiagnostics = vi.fn(async () => { throw Object.assign(new Error('Read the preview again, then save.'), { code: 'DIAGNOSTICS_PREVIEW_GONE' }); });
    mount({ previewDiagnostics, saveDiagnostics });
    fireEvent.click(await screen.findByRole('button', { name: 'Export diagnostics' }));
    const section = screen.getByRole('heading', { name: 'Diagnostics' }).parentElement!;
    await within(section).findByText(/startup\.jsonl/);
    expect(within(section).queryByRole('checkbox')).toBeNull();
    fireEvent.click(within(section).getByRole('button', { name: 'Save' }));
    expect((await within(section).findByRole('alert')).textContent).toMatch(/Read the preview again/);
  });
});

describe('task 28: diagnostics in plain words', () => {
  it('says the engine\'s line; with nothing today it says so, and the fake answers the same words', async () => {
    const { request } = mount();
    const section = (await screen.findByRole('heading', { name: 'Diagnostics' })).parentElement!;
    expect(await within(section).findByText('Nothing ran today.')).toBeTruthy();
    expect(request).toHaveBeenCalledWith('venture.diagnostics.today', {});
    expect(within(section).queryByText('How this was counted')).toBeNull();
  });

  it('shows the engine\'s sentence, and how each sum was counted in a fold', async () => {
    const view = { day: '2026-11-06', line: 'Today Chausar spent most of its time waiting for Claude Code (3 min) and writing drafts (40 s).', modelCalls: 2, rows: [
      { key: 'job:claude', label: 'waiting for Claude Code', ms: 180_000, display: '3 min', receipt: { source: 'agent-jobs', items: [{ id: 'run_a', ms: 180_000 }], sumMs: 180_000 } },
      { key: 'tool:writing drafts', label: 'writing drafts', ms: 40_000, display: '40 s', receipt: { source: 'tool-calls', items: [{ id: 'tc_a', ms: 20_000 }, { id: 'tc_b', ms: 20_000 }], sumMs: 40_000 } },
    ] };
    const client = createFakeClient(new FakeEngine());
    const real = client.request.bind(client);
    vi.spyOn(client, 'request').mockImplementation(((method: string, params: never) => (method === 'venture.diagnostics.today' ? Promise.resolve(view) : real(method as never, params))) as never);
    render(<TextProvider language="en"><EngineProvider client={client}><ReportsView /></EngineProvider></TextProvider>);
    expect(await screen.findByText(view.line)).toBeTruthy();
    expect(screen.getByText('How this was counted')).toBeTruthy();
    expect(screen.getByText('writing drafts: 40 s, from 2 records')).toBeTruthy();
  });
});
