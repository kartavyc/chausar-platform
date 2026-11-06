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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { preprocessCSS, resolveConfig } from 'vite';
import axe from 'axe-core';

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
    // Ink v2 (3B5a) draws the marks as shapes, not the v1 glyphs ✓ and ○: a check, a still arc (see the look tests below).
    expect(items[0]!.querySelector('[aria-hidden="true"]')!.getAttribute('data-mark')).toBe('done');
    expect(items[1]!.querySelector('[aria-hidden="true"]')!.getAttribute('data-mark')).toBe('current');
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

  it('says in one line what the screen noted in outside content, and nothing when it noted nothing', () => {
    const line = 'Screen noted 2 things in outside content: words aimed at the agent, an id number.';
    const { container, unmount } = render(<RunSheetView run={{ ...run('29'), screen: line }} onClose={() => {}} />);
    expect(container.querySelector('[data-screen]')!.textContent).toBe(line);
    unmount();
    const quiet = render(<RunSheetView run={run('29')} onClose={() => {}} />);
    expect(quiet.container.querySelector('[data-screen]')).toBeNull();
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
  it('lists active work above previous work, with per-stage progress or the words for no step count', () => {
    const { container } = render(<JobList runs={summaries} onOpen={() => {}} />);
    const sections = [...container.querySelectorAll('section')];
    expect(sections.map((s) => s.querySelector('h2')!.textContent)).toEqual(['Working now', 'Previous']);
    expect(sections[0]!.textContent).toContain('Cutting shorts from episode 13');
    expect(sections[0]!.querySelector('progress')!.getAttribute('max')).toBe('5');
    // 3B5b's plain words for unmeasured progress (ring.indeterminate) replaced "indeterminate".
    expect(sections[0]!.textContent).toContain('Working, no step count yet');
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

// Ink v2 wave 3, package 3B5a: the D look of the sheet head, the agent panel width, the step marks (D-TeamDept `.sr`)
// and the run sheet's failure box (D-Work `.why`). Every test above still holds.
describe('Ink v2 look', () => {
  it('a sheet at panel width says so, draws the avatar it is given in its head, and names its close button after itself', () => {
    render(
      <Sheet label="Agent" title="Editor" name="Editor" width="panel" avatar={<span data-testid="avatar" aria-hidden="true">ED</span>} onClose={() => {}}>
        body
      </Sheet>,
    );
    const region = screen.getByRole('complementary', { name: 'Editor' });
    expect(region.dataset.width).toBe('panel');
    expect(region.querySelector('header')!.contains(screen.getByTestId('avatar'))).toBe(true);
    expect(screen.getByRole('button', { name: 'Close Editor' })).toBeTruthy();
  });

  it('a sheet without a name keeps the plain Close, and no width means the usual sheet', () => {
    render(<Sheet label="Run" title="Cutting shorts" onClose={() => {}}>body</Sheet>);
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
    expect(screen.getByRole('complementary').hasAttribute('data-width')).toBe(false);
  });

  it('marks each step with a shape that differs beyond colour: a check, a still arc, a dashed circle, an x, a clock', () => {
    const steps: RunDetail['steps'] = [
      { id: 'a', purpose: 'Read the transcript', state: 'done', elapsed: '12s' },
      { id: 'b', purpose: 'Rendering 3 of 6', state: 'current', elapsed: 'now' },
      { id: 'c', purpose: 'Asking you', state: 'waiting' },
      { id: 'd', purpose: 'Render', state: 'failed', error: 'ffmpeg was not found on this computer.' },
      { id: 'e', purpose: 'Send drafts to you', state: 'pending' },
    ];
    const { container } = render(<Steps steps={steps} />);
    const mark = (state: string) => container.querySelector(`li[data-state="${state}"] [data-mark]`)!;
    expect(mark('done').querySelector('svg.lucide-check')).not.toBeNull();
    const arc = mark('current').querySelector('svg[data-arc]')!;
    expect(arc).not.toBeNull();
    expect(arc.querySelector('animate, animateTransform')).toBeNull();
    expect(mark('pending').children).toHaveLength(0);
    expect(mark('failed').querySelector('svg.lucide-x')).not.toBeNull();
    expect(mark('waiting').querySelector('svg.lucide-clock')).not.toBeNull();
    for (const state of ['done', 'current', 'waiting', 'failed', 'pending']) expect(mark(state).getAttribute('aria-hidden')).toBe('true');
    // The words still say each state: the sr words of v1, and the waiting step's visible words.
    expect(container.querySelector('li[data-state="current"]')!.textContent).toContain('now');
    expect(container.querySelector('li[data-state="failed"]')!.textContent).toContain('failed');
    expect(container.querySelector('li[data-state="pending"]')!.textContent).toContain('next');
  });

  it('a failed run shows what went wrong in its own box, in the engine\'s words, with Run again after it', () => {
    const onRunAgain = vi.fn();
    const { container } = render(<RunSheetView run={run('28')} onClose={() => {}} onRunAgain={onRunAgain} />);
    const box = container.querySelector('[data-failure]')!;
    expect(box.textContent).toContain('What went wrong');
    expect(box.textContent).toContain(run('28').error!);
    const again = screen.getByRole('button', { name: 'Run again' });
    expect(again.dataset.variant).toBe('primary');
    expect(box.compareDocumentPosition(again) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('the run sheet head carries the agent\'s avatar with the run\'s ring', () => {
    const { container } = render(<RunSheetView run={run('28')} onClose={() => {}} />);
    const avatar = container.querySelector('header [aria-hidden="true"][data-size]')!;
    expect(avatar.textContent).toBe('ED');
    expect(avatar.getAttribute('data-state')).toBe('failed');
    expect(screen.getByRole('button', { name: 'Close Editor' })).toBeTruthy();
  });

  it('axe finds nothing on a sheet with its avatar, every kind of step and an open tool fold', async () => {
    const { container } = render(
      <div>
        <Sheet label="Run" eyebrow="Editor · run 28" title="Rendering" name="Editor" onClose={() => {}} avatar={<span aria-hidden="true">ED</span>}>
          <Steps
            steps={[
              { id: '1', purpose: 'Read the transcript', state: 'done', elapsed: '2s', tools: [{ name: 'transcript.read', line: 'read 412 lines' }] },
              { id: '2', purpose: 'Rendering', state: 'current' },
              { id: '3', purpose: 'Render', state: 'failed', error: 'ffmpeg was not found on this computer.' },
              { id: '4', purpose: 'Asking you', state: 'waiting' },
              { id: '5', purpose: 'Send drafts to you', state: 'pending' },
            ]}
            progress={{ done: 1, total: 5 }}
            showTools
          />
        </Sheet>
        <RunSheetView run={run('28')} onClose={() => {}} onRunAgain={() => {}} />
      </div>,
    );
    for (const fold of container.querySelectorAll('details')) fold.open = true;
    const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`)).toEqual([]);
  });

  // CSS modules rename a bare keyframe name to a hashed one that no stylesheet defines, so the motion would never run.
  // The keyframes live once, globally, in tokens/motion.css; each module names them through global(...). This compiles
  // the modules the way Vite does and reads the animation they end up with.
  it('the sheet and a decided card run the keyframes motion.css defines once compiled, not a renamed copy', async () => {
    const config = await resolveConfig({ configFile: join(import.meta.dirname, '../../vite.config.ts'), logLevel: 'silent' }, 'serve');
    const keyframes = readFileSync(join(import.meta.dirname, '../../src/tokens/motion.css'), 'utf8');
    for (const [file, name] of [['Sheet.module.css', 'ink-sheet-in'], ['ApprovalRow.module.css', 'ink-settle']] as const) {
      expect(keyframes, name).toContain(`@keyframes ${name} `);
      const path = join(import.meta.dirname, '../../src/parts', file);
      const { code } = await preprocessCSS(readFileSync(path, 'utf8'), path, config);
      const animations = [...code.matchAll(/animation:\s*([^;}]+)/g)].map((m) => m[1]!.trim());
      expect(animations.length, file).toBeGreaterThan(0);
      for (const animation of animations) expect(animation.split(/\s+/)[0], `${file}: ${animation}`).toBe(name);
    }
  }, 30000);
});
