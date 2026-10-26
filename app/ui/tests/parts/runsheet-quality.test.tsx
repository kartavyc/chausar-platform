import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import { RunSheetView } from '../../src/parts/RunSheet';
import { ClockProvider } from '../../src/shell/clock';
import { TextProvider } from '../../src/text';
import { RUNS } from '../../src/engine/fixtures';
import type { CoverageView, DeliverableReport, RunDetail } from '../../src/engine/types';
import { assertInkRules } from '../helpers/ink-rules';

/*
 * W4 4J22a on the run sheet (from 4J13 and 4J14): coverage as a fraction counted by code ("1,204 of 1,210 lines
 * matched"), the checks that could not run, the outcome of a run that acted outside (Success, Not checked or Failed),
 * the draft's three-column report (measured, looked at, needs you), a question's expiry ("Expires in 3 h") and a run
 * Chausar was interrupted in ("Interrupted: nothing was sent again."). Every word is the screen's own, from the codes;
 * the engine's lines show beside them as its words.
 */

const run = (id: string): RunDetail => structuredClone(RUNS.find((r) => r.runId === id)!);
const NOW = new Date('2026-10-21T10:00:00.000Z');

function show(detail: RunDetail, extra: { questionExpiresAt?: string } = {}, language: 'en' | 'hi' = 'en') {
  return render(
    <TextProvider language={language}>
      <ClockProvider now={() => NOW}>
        <RunSheetView run={detail} onClose={() => {}} {...extra} />
      </ClockProvider>
    </TextProvider>,
  );
}

const coverage = (over: Partial<CoverageView> = {}): CoverageView => ({
  done: 1204, total: 1210, unit: 'lines', verb: 'matched', complete: false, line: '1,204 of 1,210 lines matched.', ...over,
});

const report = (over: Partial<DeliverableReport> = {}): DeliverableReport => ({
  measured: [
    { id: 'figures-resolve', outcome: 'pass', line: 'Passed: every figure has a receipt.', detail: 'every figure has a receipt.' },
    { id: 'youtube:chapters', outcome: 'not-run', line: 'Not run: chapters need a transcript.', detail: 'chapters need a transcript.' },
  ],
  lookedAt: [
    { id: 'tone-fits', outcome: 'pass', line: 'Passed: the tone fits.', detail: 'the tone fits.', judgment: 'fair' },
    { id: 'hook', outcome: 'fail', line: 'Failed: the hook is slow.', detail: 'the hook is slow.', judgment: 'weak', drop: 'Dropped: weak is below the keep line, fair.' },
  ],
  needsHuman: [{ code: 'creative', line: 'Whether the opening joke lands is yours to judge.' }],
  findings: [{ class: 'hard-error', id: 'figures-resolve', line: 'A figure has no receipt.' }],
  verdict: null, verdictLine: 'Review incomplete: this is not a review.',
  review: { complete: false, line: 'Review incomplete: this is not a review.' },
  generatedBy: ['code', 'judge'], at: '2026-10-21T09:00:00.000Z', stale: false, staleLine: null,
  ...over,
});

describe('run sheet: coverage, outcomes, the report, expiry and interruptions (4J22a)', () => {
  it('leads with coverage as a fraction counted by code, says when it is partial, and lists the checks that did not run', () => {
    const detail = run('27');
    detail.steps[0]!.coverage = coverage();
    detail.steps[detail.steps.length - 1]!.notRun = [{ id: 'youtube:chapters', line: 'Not run: chapters need a transcript.' }];
    const { container } = show(detail);
    const cover = container.querySelector('[data-coverage]')!;
    expect(cover.textContent).toBe('1,204 of 1,210 lines matched · Partial');
    expect(cover.querySelectorAll('[data-count]')).toHaveLength(2);
    const notRun = screen.getByRole('region', { name: 'Not run' });
    expect(within(notRun).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Not run: chapters need a transcript.']);
    assertInkRules(container);
  });

  it('an unobserved count is never 0: it says code did not count it', () => {
    const detail = run('27');
    detail.steps[0]!.coverage = coverage({ done: null, total: 1210, complete: false });
    const { container } = show(detail);
    expect(container.querySelector('[data-coverage]')!.textContent).toBe('Lines matched: not counted by code · Partial');
    expect(container.querySelector('[data-coverage]')!.textContent).not.toMatch(/\b0\b/);
  });

  it('a complete count has no partial mark', () => {
    const detail = run('27');
    detail.steps[0]!.coverage = coverage({ done: 212, total: 212, unit: 'bank-lines', complete: true });
    const { container } = show(detail);
    expect(container.querySelector('[data-coverage]')!.textContent).toBe('212 of 212 bank lines matched');
  });

  it('words the outcome of a run that acted outside: Success, Not checked or Failed, with the engine line', () => {
    const detail = run('27');
    detail.outcome = { outcome: 'not-checked', line: 'Posted, but no code check looked at the real result.' };
    const { container, unmount } = show(detail);
    const outcome = container.querySelector('[data-outcome]')!;
    expect(outcome.textContent).toBe('Not checked · Posted, but no code check looked at the real result.');
    unmount();
    const ok = run('27');
    ok.outcome = { outcome: 'success', line: 'The page shows the post.' };
    expect(show(ok).container.querySelector('[data-outcome]')!.textContent).toBe('Success · The page shows the post.');
  });

  it('folds the three-column report: measured, looked at and needs you, with each item in the screen words', () => {
    const detail = run('27');
    detail.report = report();
    const { container } = show(detail);
    const fold = container.querySelector('details[data-fold="report"]') as HTMLDetailsElement;
    expect(fold.open).toBe(false);
    expect(fold.querySelector('summary')!.textContent).toBe('Report: review incomplete');
    const columns = within(fold).getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(columns).toEqual(['Measured', 'Looked at', 'Needs you']);
    expect([...fold.querySelectorAll('[data-column="measured"] li')].map((li) => li.textContent)).toEqual([
      'Passed: every figure has a receipt.', 'Not run: chapters need a transcript.',
    ]);
    expect([...fold.querySelectorAll('[data-column="looked-at"] li')].map((li) => li.textContent)).toEqual([
      'Fair: the tone fits.', 'Weak: the hook is slow. Dropped: weak is below the keep line, fair.',
    ]);
    expect([...fold.querySelectorAll('[data-column="needs-you"] li')].map((li) => li.textContent)).toEqual(['Whether the opening joke lands is yours to judge.']);
    expect(fold.querySelector('[data-review]')!.textContent).toBe('Review incomplete: this is not a review.');
    expect([...fold.querySelectorAll('[data-finding]')].map((li) => li.textContent)).toEqual(['Must fix: A figure has no receipt.']);
    assertInkRules(container);
  });

  it('a verdict leads the report; a stale report says the draft changed after it', () => {
    const detail = run('27');
    detail.report = report({ verdict: 'rewrite', verdictLine: 'REWRITE: 1 check failed.', review: { complete: true, line: null }, stale: true, staleLine: 'Stale: the draft changed after these checks ran. They describe an earlier version.' });
    const { container } = show(detail);
    const fold = container.querySelector('details[data-fold="report"]')!;
    expect(fold.querySelector('summary')!.textContent).toBe('Report: Rewrite');
    expect(fold.querySelector('[data-review]')).toBeNull();
    expect(fold.querySelector('[data-stale]')!.textContent).toBe('Stale: the draft changed after these checks ran. They describe an earlier version.');
  });

  it("says when a run's question expires, from the clock", () => {
    show(run('29'), { questionExpiresAt: '2026-10-21T13:00:00.000Z' });
    const question = screen.getByRole('region', { name: 'The run asks' });
    expect(within(question).getByText('Expires in 3 h')).toBeTruthy();
  });

  it('a question under an hour from its end says minutes, and one past it says it expired', () => {
    const { unmount } = show(run('29'), { questionExpiresAt: '2026-10-21T10:40:00.000Z' });
    expect(screen.getByText('Expires in 40 min')).toBeTruthy();
    unmount();
    show(run('29'), { questionExpiresAt: '2026-10-21T09:00:00.000Z' });
    expect(screen.getByText('Expired')).toBeTruthy();
  });

  it('a run Chausar was interrupted in says nothing was sent again', () => {
    const detail = run('29');
    detail.interrupted = { at: '2026-10-21T09:50:00.000Z', line: 'Interrupted: Chausar stopped while this ran. Nothing was sent again.', steps: [] };
    const { container } = show(detail);
    expect(container.querySelector('[data-interrupted]')!.textContent).toBe('Interrupted: nothing was sent again.');
  });

  it('in Hindi, the words are the screen own and the counts stay as counted', () => {
    const detail = run('27');
    detail.steps[0]!.coverage = coverage();
    detail.outcome = { outcome: 'success', line: 'The page shows the post.' };
    const { container } = show(detail, {}, 'hi');
    expect(container.querySelector('[data-coverage]')!.textContent).toMatch(/1,210 में से 1,204/);
    expect(container.querySelector('[data-outcome]')!.textContent).toMatch(/^सफल/);
  });

  it('an items count names the units it adds up, never a bare "items"', () => {
    const detail = run('27');
    detail.steps[0]!.coverage = coverage({ done: 40, total: 42, unit: 'items', verb: 'read', units: ['rows', 'pages'], complete: false });
    const { container } = show(detail);
    expect(container.querySelector('[data-coverage]')!.textContent).toBe('40 of 42 rows and pages read · Partial');
  });

  it('the expiry line is read again on the minute while the sheet is open', () => {
    vi.useFakeTimers();
    try {
      let now = Date.parse('2026-10-21T10:00:00.000Z');
      render(
        <ClockProvider now={() => new Date(now)}>
          <RunSheetView run={run('29')} onClose={() => {}} questionExpiresAt="2026-10-21T10:02:00.000Z" />
        </ClockProvider>,
      );
      expect(screen.getByText('Expires in 2 min')).toBeTruthy();
      now += 60_000;
      act(() => { vi.advanceTimersByTime(60_000); });
      expect(screen.getByText('Expires in 1 min')).toBeTruthy();
    } finally { vi.useRealTimers(); }
  });

  it('a run with none of these shows none of them', () => {
    const { container } = show(run('31'));
    expect(container.querySelector('[data-coverage], [data-outcome], [data-fold="report"], [data-interrupted]')).toBeNull();
  });
});
