import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { Sheet } from '../../src/parts/Sheet';
import { Steps } from '../../src/parts/Steps';
import { RunSheetView } from '../../src/parts/RunSheet';
import { evidenceLabel } from '../../src/parts/evidence';
import { JobList } from '../../src/parts/JobList';
import { RUNS } from '../../src/engine/fixtures';
import type { RunDetail, RunSummary } from '../../src/engine/types';

const run = (id: string): RunDetail => structuredClone(RUNS.find((r) => r.runId === id)!);

describe('Sheet', () => {
  it('sits beside the page as a labelled region, focuses its title on open and returns focus on close', () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open run</button>
          {open && <Sheet label="Run" eyebrow="Editor · run 31" title="Cutting shorts" onClose={() => setOpen(false)}>body</Sheet>}
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open run' });
    opener.focus();
    fireEvent.click(opener);
    const region = screen.getByRole('complementary', { name: 'Cutting shorts' });
    expect(region).toBeTruthy();
    expect(region.getAttribute('aria-modal')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Cutting shorts' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});

describe('Steps', () => {
  it('marks done, current, pending, waiting and failed steps, with words for each and times in mono', () => {
    const steps: RunDetail['steps'] = [
      { id: 'a', purpose: 'Read the transcript', state: 'done', elapsed: '12s' },
      { id: 'b', purpose: 'Rendering 3 of 6', state: 'current', elapsed: 'now' },
      { id: 'c', purpose: 'Asking you', state: 'waiting' },
      { id: 'd', purpose: 'Render', state: 'failed', error: 'ffmpeg was not found on this computer.' },
      { id: 'e', purpose: 'Send drafts to you', state: 'pending' },
    ];
    const { container } = render(<Steps steps={steps} />);
    const items = [...container.querySelectorAll('li')];
    expect(items.map((li) => li.dataset.state)).toEqual(['done', 'current', 'waiting', 'failed', 'pending']);
    expect(items[0]!.querySelector('[aria-hidden="true"]')!.textContent).toBe('✓');
    expect(items[1]!.querySelector('[aria-hidden="true"]')!.textContent).toBe('○');
    expect(items[0]!.textContent).toContain('done');
    expect(items[2]!.textContent).toContain('Waiting on you');
    expect(items[3]!.textContent).toContain('ffmpeg was not found on this computer.');
    expect(items[0]!.querySelector('.mono')!.textContent).toBe('12s');
  });

  it('says "indeterminate" in words instead of drawing a bar, and counts otherwise', () => {
    const { container, rerender } = render(<Steps steps={[]} progress="indeterminate" />);
    expect(container.textContent).toContain('indeterminate');
    expect(container.querySelector('progress')).toBeNull();
    rerender(<Steps steps={[]} progress={{ done: 3, total: 5 }} />);
    expect(container.textContent).toContain('3 of 5');
  });

  it('folds tool lines under each step', () => {
    const { container } = render(<Steps steps={run('31').steps} showTools />);
    const fold = container.querySelector('details')!;
    expect(fold.open).toBe(false);
    expect(fold.querySelector('summary')!.textContent).toBe('1 tool call');
  });
});

describe('RunSheet', () => {
  it('shows the header, steps, evidence links and the question box', async () => {
    const onEvidence = vi.fn();
    const onAnswer = vi.fn(async () => {});
    render(<RunSheetView run={run('29')} onClose={() => {}} onEvidence={onEvidence} onAnswer={onAnswer} />);
    expect(screen.getByText('Producer · run 29')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Pricing the sponsor slot' })).toBeTruthy();
    expect(screen.getByText('Started 6m ago')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'sponsor brief' }));
    expect(onEvidence).toHaveBeenCalledWith({ kind: 'file', id: 'f-brief-sponsor', label: 'sponsor brief' });
    expect(screen.getByText(/Share a private preview link/)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Yes, share a private link' })); });
    expect(onAnswer).toHaveBeenCalledWith('Yes, share a private link');
  });

  it('a finished run folds to "Worked for" with its result and receipt', () => {
    const { container } = render(<RunSheetView run={run('27')} onClose={() => {}} />);
    const fold = container.querySelector('details[data-fold="worked"]') as HTMLDetailsElement;
    expect(fold.open).toBe(false);
    expect(fold.querySelector('summary')!.textContent).toBe('Worked for 4m');
    expect(container.textContent).toContain('Matched 212 of 214 lines. 2 need your data.');
    expect(screen.getAllByRole('button', { name: 'Receipt R-0412' }).length).toBeGreaterThan(0);
  });

  it('a rules judge that settled nothing reads "Not checked", never "Failed", and a check is text, not a link', () => {
    const { container } = render(<RunSheetView run={run('27')} onClose={() => {}} />);
    const evidence = container.querySelector('p[class*="evidence"]')!;
    expect(evidence.textContent).toContain('Not checked: Not settled: cites-source.');
    expect(evidence.textContent).not.toContain('Failed');
    expect(screen.queryByRole('button', { name: /Not settled/ })).toBeNull();
    const settled = { kind: 'check', id: 'rules-judge', label: 'Failed: The draft broke rule 2.' };
    expect(evidenceLabel(settled, (d) => `Not checked: ${d}`)).toBe('Failed: The draft broke rule 2.');
  });

  it('a model-written result says "model estimate" and has no receipt', () => {
    const { container } = render(<RunSheetView run={run('26')} onClose={() => {}} />);
    expect(container.textContent).toContain('About 18,000 views in 30 days model estimate');
    expect(screen.queryByRole('button', { name: /^Receipt/ })).toBeNull();
  });

  it('a failed run shows the real error and Run again', () => {
    const onRunAgain = vi.fn();
    const { container } = render(<RunSheetView run={run('28')} onClose={() => {}} onRunAgain={onRunAgain} />);
    expect(container.textContent).toContain('ffmpeg was not found on this computer. Install ffmpeg');
    fireEvent.click(screen.getByRole('button', { name: 'Run again' }));
    expect(onRunAgain).toHaveBeenCalled();
  });
});

describe('JobList', () => {
  const summaries: RunSummary[] = RUNS.map(({ steps: _s, question: _q, error: _e, ...summary }) => summary);
  it('lists active work above previous work, with per-stage progress or the word indeterminate', () => {
    const { container } = render(<JobList runs={summaries} onOpen={() => {}} />);
    const sections = [...container.querySelectorAll('section')];
    expect(sections.map((s) => s.querySelector('h2')!.textContent)).toEqual(['Working now', 'Previous']);
    expect(sections[0]!.textContent).toContain('Cutting shorts from episode 13');
    expect(sections[0]!.querySelector('progress')!.getAttribute('max')).toBe('5');
    expect(sections[0]!.textContent).toContain('indeterminate');
    expect(sections[0]!.textContent).toContain('Waiting on you');
    expect(sections[1]!.textContent).toContain('Matched September bank lines to invoices');
  });

  it('a failed job shows its failure text and Run again; opening a job passes it up', () => {
    const onRunAgain = vi.fn();
    const onOpen = vi.fn();
    render(<JobList runs={summaries} onOpen={onOpen} onRunAgain={onRunAgain} />);
    expect(screen.getByText('Stopped: ffmpeg was not found on this computer.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Run again' }));
    expect(onRunAgain).toHaveBeenCalledWith(expect.objectContaining({ runId: '28' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cutting shorts from episode 13' }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ runId: '31' }), expect.anything());
  });

  it('says so when nothing runs', () => {
    render(<JobList runs={[]} onOpen={() => {}} />);
    expect(screen.getByText('Nothing is running.')).toBeTruthy();
  });
});
