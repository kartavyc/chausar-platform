import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { SHEETS } from '../../src/shell/places';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { RUNS, UPLOADS } from '../../src/engine/fixtures';
import { evidenceSheet } from '../../src/parts/evidence';
import { CATALOGUES } from '../../src/text';
import type { EngineClient, RunDetail } from '../../src/engine/types';
import { RUN_EVIDENCE_KINDS } from '../../../../platform/runtime/venture/views/run-evidence';

/*
 * Fix round 4 (sample-data item 1): an evidence link in a run opened an empty panel, "This can't be shown here." The run
 * sheet opened `?sheet=<kind>:<id>` with the evidence's own kind, and `file` is no sheet. On the real engine the same
 * held for a price receipt, a work table and what a heavy-work tool left (views/runs.ts names seven kinds). Each kind
 * now opens a sheet that exists, or, where the engine has nothing more to read than the words, is words and no link.
 */
const UNKNOWN = CATALOGUES.en['sheet.unknown'] as string;
const NOW = '2026-10-21T10:30:00.000Z';
afterEach(() => { cleanup(); window.location.hash = ''; });

/** A run whose steps name every kind of evidence the engine can, pointing at things the sample holds. */
const everyKind = (): RunDetail => ({
  ...structuredClone(RUNS.find((run) => run.runId === '29')!), question: undefined,
  steps: [
    { id: 's1', purpose: 'Read the files', state: 'done', evidence: [{ kind: 'file', id: 'u-brief-boat-14', label: 'boat-audio-brief-ep14.pdf' }] },
    { id: 's2', purpose: 'Worked on them', state: 'done', evidence: [
      { kind: 'work-receipt', id: 'wr-1', label: '120 of 130 rows used.' }, { kind: 'work-table', id: 'wt-1', label: 'Ranked hooks' }, { kind: 'delegate-run', id: 'dr-1', label: 'What Codex left' },
    ] },
    { id: 's3', purpose: 'Priced it', state: 'done', evidence: [{ kind: 'price-receipt', id: 'R-0415', label: 'Price receipt' }] },
    { id: 's4', purpose: 'Wrote the draft', state: 'done', evidence: [{ kind: 'draft', id: 'd-ep14-script', label: 'Episode 14' }] },
    { id: 's5', purpose: 'Checked it', state: 'done', evidence: [{ kind: 'check', id: 'file-opens', label: 'Passed: the file opens' }] },
  ],
} as RunDetail);

function start(run?: RunDetail) {
  const fake = createFakeClient(new FakeEngine({ now: () => NOW }));
  const request = fake.request.bind(fake);
  const client: EngineClient = { ...fake, request: (async (method: string, params?: unknown) => (run && method === 'venture.runs.get' ? structuredClone(run) : request(method as never, params as never))) as EngineClient['request'] };
  window.location.hash = '#/today?sheet=run:29';
  render(<App client={client} language="en" />);
}
const sheet = () => screen.findByRole('complementary');
/** The run sheet, once the run itself is on screen (the sheet is drawn anew when its answer lands). */
const runSheet = async (agent = 'Producer') => { await screen.findAllByText(`Run by ${agent}`); return sheet(); };
const press = async (name: string | RegExp) => {
  const button = await screen.findByRole('button', { name });
  await act(async () => { fireEvent.click(button); window.dispatchEvent(new HashChangeEvent('hashchange')); });
};

describe('run evidence: every kind the engine names', () => {
  it('each kind opens a sheet that exists, or is words with nothing to open', () => {
    expect([...RUN_EVIDENCE_KINDS].sort()).toEqual(['check', 'delegate-run', 'draft', 'file', 'price-receipt', 'work-receipt', 'work-table']);
    for (const kind of RUN_EVIDENCE_KINDS) {
      const opens = evidenceSheet({ kind, id: 'x-1', label: 'x' });
      if (opens) expect(Object.keys(SHEETS), kind).toContain(opens.kind);
    }
    // What can be read opens; a check is its own words, and a work table and what a tool left have no reader yet.
    expect(RUN_EVIDENCE_KINDS.filter((kind) => evidenceSheet({ kind, id: 'x-1', label: 'x' }) === null)).toEqual(['work-table', 'delegate-run', 'check']);
    expect(evidenceSheet({ kind: 'price-receipt', id: 'R-0415', label: 'Price receipt' })).toEqual({ kind: 'receipt', id: 'R-0415' });
  });

  it('in the run sheet a kind with a sheet is a link and the others are plain words; no link opens the empty panel', async () => {
    const run = everyKind();
    start(run);
    const panel = await runSheet();
    const links = ['boat-audio-brief-ep14.pdf', '120 of 130 rows used.', 'Price receipt', 'Episode 14'];
    for (const name of links) expect(within(panel).getByRole('button', { name }), name).toBeTruthy();
    for (const words of ['Ranked hooks', 'What Codex left', 'Passed: the file opens']) {
      expect(within(panel).getByText(words), words).toBeTruthy();
      expect(within(panel).queryByRole('button', { name: words }), words).toBeNull();
    }
    for (const name of links) {
      window.location.hash = '#/today?sheet=run:29';
      await act(async () => { window.dispatchEvent(new HashChangeEvent('hashchange')); });
      await runSheet();
      await press(name);
      await waitFor(() => expect(window.location.hash, name).not.toContain('sheet=run:29'));
      const opened = await sheet();
      expect(within(opened).queryByText(UNKNOWN), `${name} opened ${window.location.hash}`).toBeNull();
    }
  });

  it('a file opens with its name, kind, size and the order it belongs to', async () => {
    start(everyKind());
    await runSheet();
    await press('boat-audio-brief-ep14.pdf');
    await waitFor(() => expect(decodeURIComponent(window.location.hash)).toContain('sheet=file:u-brief-boat-14'));
    const opened = await sheet();
    expect(await within(opened).findByRole('heading', { name: 'boat-audio-brief-ep14.pdf' })).toBeTruthy();
    expect(opened.textContent).toContain('PDF');
    expect(opened.textContent).toContain('178 KB');
    expect(opened.textContent).toContain('20 Oct 2026');
    expect(within(opened).getByRole('link', { name: 'Open its order' }).getAttribute('href')).toBe('#/work?order=o-boat-14');
  });

  it('a file that is no longer kept says so, and never the empty panel', async () => {
    window.location.hash = '#/today?sheet=file:u-gone';
    render(<App client={createFakeClient(new FakeEngine({ now: () => NOW }))} language="en" />);
    const opened = await sheet();
    expect(await within(opened).findByRole('heading', { name: 'This file is no longer kept.' })).toBeTruthy();
    expect(within(opened).queryByText(UNKNOWN)).toBeNull();
  });
});

describe('run evidence: the sample answers as the engine does', () => {
  it('every sample run names only kinds the engine names, and a file is one of the business\'s own uploads, by its name', () => {
    const kinds = new Set<string>(RUN_EVIDENCE_KINDS);
    const uploads = Object.values(UPLOADS).flat();
    let files = 0;
    for (const run of RUNS) for (const step of run.steps) for (const item of step.evidence ?? []) {
      expect(kinds.has(item.kind), `run ${run.runId}: ${item.kind}`).toBe(true);
      if (item.kind !== 'file') continue;
      files++;
      const upload = (UPLOADS[run.businessId] ?? []).find((file) => file.id === item.id);
      expect(upload?.name, `run ${run.runId}: ${item.id}`).toBe(item.label);
    }
    expect(files).toBeGreaterThan(2);
    expect(uploads.length).toBeGreaterThan(4);
  });

  it('every evidence link of every sample run opens something real', async () => {
    const pressed: string[] = [];
    for (const run of RUNS) {
      const links = run.steps.flatMap((step) => step.evidence ?? []).filter((item) => evidenceSheet(item));
      for (const item of links) {
        const engine = new FakeEngine({ now: () => NOW });
        if (run.businessId !== 'lumen') await engine.request('workspace.open', { folder: run.businessId });
        window.location.hash = `#/today?sheet=run:${run.runId}`;
        render(<App client={createFakeClient(engine)} language="en" />);
        const link = await screen.findByRole('button', { name: item.label });
        await act(async () => { fireEvent.click(link); window.dispatchEvent(new HashChangeEvent('hashchange')); });
        await waitFor(() => expect(window.location.hash).not.toContain(`sheet=run:${run.runId}`));
        const opened = await sheet();
        await waitFor(() => expect(opened.querySelector('h2, h1')?.textContent ?? '').not.toBe(''));
        expect(within(opened).queryByText(UNKNOWN), `run ${run.runId}: ${item.kind}:${item.id}`).toBeNull();
        expect(opened.textContent, `run ${run.runId}: ${item.kind}:${item.id}`).not.toMatch(/not found|no longer kept/i);
        pressed.push(`${item.kind}:${item.id}`);
        cleanup();
      }
    }
    expect(pressed.length).toBeGreaterThan(3);
  });
});
