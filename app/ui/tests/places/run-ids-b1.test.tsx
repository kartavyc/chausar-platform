import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { ClockProvider } from '../../src/shell/clock';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { RUNS } from '../../src/engine/fixtures';
import { RunSheetView } from '../../src/parts/RunSheet';
import { TextProvider } from '../../src/text';

/**
 * One-shot B1 (hands-on row 60 and bug 19; A4 review L9; SCREENS shots 162, 165, 270): a run's raw id never shows. A
 * running tile says when it started, a stopped or failed run lists who, where and how long, the run sheet's eyebrow
 * names the agent, and a Stop button is named by what the run is doing. The ids stay in the engine's answers.
 */
const NOW = () => new Date('2026-10-23T19:05:00.000+05:30');
const RAW_ID = /\brun (?:2[5-9]|3[01])\b|\bRun (?:2[5-9]|3[01])\b/;

async function start(hash = '#/work') {
  window.location.hash = hash;
  render(<ClockProvider now={NOW}><App client={createFakeClient(new FakeEngine())} language="en" /></ClockProvider>);
  await screen.findByRole('heading', { level: 1 });
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

describe('no raw run ids on screen (B1)', () => {
  it('Work shows no run id; running tiles say when they started; Stop is named by what the run is doing', async () => {
    await start();
    const main = screen.getByRole('main');
    expect(await within(main).findByRole('button', { name: 'Stop: Cutting shorts from episode 13' })).toBeTruthy();
    expect(within(main).getByRole('button', { name: 'Stop: Checking titles against the last 30 videos' })).toBeTruthy();
    expect(within(main).getAllByText('Started 4 min ago').length).toBeGreaterThan(0);
    expect(main.textContent).not.toMatch(RAW_ID);
    for (const button of within(main).getAllByRole('button')) expect(button.getAttribute('aria-label') ?? '', 'a label').not.toMatch(RAW_ID);
  });

  it('the Stop dialog asks "Stop this run?"', async () => {
    await start();
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Stop: Cutting shorts from episode 13' })); });
    expect(screen.getByRole('dialog', { name: 'Stop this job?' })).toBeTruthy();
  });

  it("the run sheet's eyebrow names the agent, not the run's id", () => {
    const { container } = render(<TextProvider language="en"><RunSheetView run={structuredClone(RUNS.find((r) => r.runId === '31')!)} onClose={() => {}} onEvidence={() => {}} /></TextProvider>);
    expect(screen.getByText('Run by Editor')).toBeTruthy();
    expect(container.textContent).not.toMatch(RAW_ID);
  });
});
