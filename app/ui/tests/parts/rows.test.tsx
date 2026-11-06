import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Row, StatusMark } from '../../src/parts/Row';
import { Avatar } from '../../src/parts/Avatar';
import { JobList } from '../../src/parts/JobList';
import { runKey } from '../../src/shell/keys';
import { RUNS } from '../../src/engine/fixtures';
import type { RunSummary } from '../../src/engine/types';
import { assertInkRules } from '../helpers/ink-rules';

const css = (file: string) => readFileSync(join(import.meta.dirname, '../../src/parts', file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
/** The body of the first rule whose selector is exactly `selector`. */
const rule = (text: string, selector: string) => {
  for (const [, sel, body] of text.matchAll(/([^{}]+)\{([^}]*)\}/g)) if (sel!.trim() === selector) return body!;
  throw new Error(`no rule ${selector}`);
};

describe('Row, the D list row (lrow)', () => {
  it('draws a mark (avatar or status circle) first, then the title and sub, then the aside, the actions and the end time', () => {
    const { container } = render(
      <ul>
        <Row
          id="r1" mark={<Avatar name="Editor" state="working" size={32} />} title="Cutting shorts from episode 13" line="Editor"
          aside={<span>3 of 5</span>} actions={<button type="button">Open</button>} end="4m"
        />
      </ul>,
    );
    const row = container.querySelector('li')!;
    const parts = [...row.children].map((el) => el.textContent);
    expect(parts).toEqual(['ED', 'Cutting shorts from episode 13Editor', '3 of 5', 'Open', '4m']);
    expect(row.firstElementChild!.querySelector('[aria-hidden="true"]')!.textContent).toBe('ED');
    const end = row.lastElementChild!;
    expect(end.classList.contains('mono')).toBe(true);
  });

  it('is 60 px with a soft line between rows and none above the first; a dense row is 52 px', () => {
    const { container } = render(<ul><Row id="a" title="A" /><Row id="b" title="B" dense /></ul>);
    const [a, b] = [...container.querySelectorAll('li')];
    expect(a!.hasAttribute('data-dense')).toBe(false);
    expect(b!.hasAttribute('data-dense')).toBe(true);
    const text = css('Row.module.css');
    expect(rule(text, '.row')).toMatch(/border-top:\s*var\(--hair\) solid var\(--line-soft\)/);
    expect(rule(text, '.row')).toMatch(/min-height:\s*60px/);
    expect(rule(text, '.row:first-child')).toMatch(/border-top:\s*0/);
    expect(rule(text, '.row[data-dense]')).toMatch(/min-height:\s*52px/);
  });

  it('a row whose link has no address yet shows a disabled "link not ready yet", which J, K, Enter, A and D never use', () => {
    const { container } = render(<ul><Row id="share" title="Share link for episode 14" linkPending /></ul>);
    const pending = screen.getByRole('button', { name: 'link not ready yet' });
    expect(pending).toHaveProperty('disabled', true);
    expect(pending.hasAttribute('data-open')).toBe(false);
    expect(pending.hasAttribute('data-key')).toBe(false);
    expect(container.querySelector('li')!.contains(pending)).toBe(true);
  });

  it('J, K and Enter move through rows with marks and asides as before', () => {
    const onOpen = vi.fn();
    const { container } = render(
      <main>
        <ul>
          <Row id="one" mark={<StatusMark tone="ok" />} title="First" onOpen={onOpen} end="2m" />
          <Row id="two" mark={<Avatar name="Producer" state="waiting" size={32} />} title="Second" aside={<span>Waiting on you</span>} onOpen={onOpen} linkPending />
          <Row id="three" title="Third" dense />
        </ul>
      </main>,
    );
    const main = container.querySelector('main')!;
    const focused = () => (document.activeElement as HTMLElement).dataset.rowId;
    expect(runKey('next', main, () => {})).toBe(true);
    expect(focused()).toBe('one');
    runKey('next', main, () => {});
    expect(focused()).toBe('two');
    runKey('next', main, () => {});
    expect(focused()).toBe('three');
    runKey('previous', main, () => {});
    expect(focused()).toBe('two');
    expect(runKey('open', main, () => {})).toBe(true);
    expect(onOpen).toHaveBeenCalledOnce();
    expect((onOpen.mock.calls[0]![0] as HTMLElement).textContent).toBe('Second');
  });
});

describe('StatusMark, the D status circle (.sic)', () => {
  it('is a hidden shape whose icon differs by tone, so colour never carries the state alone', () => {
    const icons = { ok: 'check', no: 'x', question: 'circle-help', estimate: 'trending-up', fail: 'triangle-alert' } as const;
    for (const [tone, icon] of Object.entries(icons)) {
      const { container, unmount } = render(<StatusMark tone={tone as keyof typeof icons} />);
      const mark = container.firstElementChild as HTMLElement;
      expect(mark.getAttribute('aria-hidden')).toBe('true');
      expect(mark.dataset.tone).toBe(tone);
      expect(mark.querySelector(`svg.lucide-${icon}`), tone).not.toBeNull();
      unmount();
    }
    const text = css('Row.module.css');
    expect(rule(text, ".mark[data-tone='ok']")).toMatch(/background:\s*var\(--accent-soft\)[^}]*color:\s*var\(--accent-text\)/);
    expect(rule(text, ".mark[data-tone='question']")).toMatch(/background:\s*var\(--wait-soft\)[^}]*color:\s*var\(--wait\)/);
    expect(rule(text, ".mark[data-tone='fail']")).toMatch(/background:\s*var\(--fail-soft\)[^}]*color:\s*var\(--fail\)/);
  });

  it('on a phone, what wraps under the words lines up with them: 28 px in under a status circle, 32 px under an avatar', () => {
    const text = css('Row.module.css');
    expect(rule(text, '.mark')).toMatch(/width:\s*var\(--av-28\)[^}]*height:\s*var\(--av-28\)/);
    expect(rule(text, '.row')).toMatch(/--lead:\s*var\(--av-32\)/);
    expect(rule(text, '.row:has(> .lead > .mark)')).toMatch(/--lead:\s*var\(--av-28\)/);
    const narrow = /@media\s*\(max-width:\s*759px\)\s*\{([\s\S]*?)\n\}/.exec(text)?.[1] ?? '';
    expect(narrow).toMatch(/padding-left:\s*calc\(var\(--lead\) \+ var\(--sp-3\)\)/);
    expect(narrow).not.toMatch(/--av-32/);
  });
});

describe('JobList in the D look', () => {
  const summaries: RunSummary[] = RUNS.map(({ steps: _s, question: _q, error: _e, ...summary }) => summary);

  it('is two tiles of list rows, each run with its agent avatar ringed by its state', () => {
    const { container } = render(<JobList runs={summaries} onOpen={() => {}} />);
    const [working, previous] = [...container.querySelectorAll('section')];
    expect(working!.hasAttribute('data-tile')).toBe(true);
    expect(previous!.hasAttribute('data-tile')).toBe(true);
    const ring = (purpose: string) => {
      const row = screen.getByRole('button', { name: purpose }).closest('li')!;
      const avatar = row.querySelector('[data-dept]')!;
      expect(avatar.getAttribute('aria-hidden')).toBe('true');
      return avatar;
    };
    expect(ring('Cutting shorts from episode 13').getAttribute('data-state')).toBe('working');
    expect(ring('Pricing the sponsor slot').getAttribute('data-state')).toBe('waiting');
    expect(ring('Rendering the thumbnail set').getAttribute('data-state')).toBe('failed');
    expect(ring('Matched September bank lines to invoices').hasAttribute('data-state')).toBe(false);
    expect(ring('Cutting shorts from episode 13').textContent).toBe('ED');
    expect(screen.getByRole('button', { name: 'Cutting shorts from episode 13' }).closest('li')!.textContent).toContain('Editor');
  });

  it('a measured run draws a still bar in its state colour; an unmeasured one a still segment and no progress element (which would animate)', () => {
    render(<JobList runs={summaries} onOpen={() => {}} />);
    const rowOf = (purpose: string) => screen.getByRole('button', { name: purpose }).closest('li')!;
    const cutting = rowOf('Cutting shorts from episode 13');
    const bar = cutting.querySelector('progress')!;
    expect(bar.getAttribute('value')).toBe('3');
    expect(bar.dataset.tone).toBe('working');
    expect(within(cutting).getByText('3 of 5').classList.contains('mono')).toBe(true);
    const waiting = rowOf('Pricing the sponsor slot');
    expect(waiting.querySelector('progress')!.dataset.tone).toBe('wait');
    expect(waiting.textContent).toContain('Waiting on you');
    const unmeasured = rowOf('Checking titles against the last 30 videos');
    expect(unmeasured.querySelector('progress')).toBeNull();
    expect(unmeasured.querySelector('[data-still]')!.getAttribute('aria-hidden')).toBe('true');
    expect(unmeasured.textContent).toContain('Working, no step count yet');
    expect(unmeasured.textContent).not.toContain('indeterminate');
  });

  it('an unmeasured run that waits on you says so in wait words, with no step count', () => {
    const runs = summaries.map((run) => (run.runId === '29' ? { ...run, progress: 'indeterminate' as const } : run));
    render(<JobList runs={runs} onOpen={() => {}} />);
    const waiting = screen.getByRole('button', { name: 'Pricing the sponsor slot' }).closest('li')!;
    const words = within(waiting).getByText('Waiting on you, no step count yet');
    expect(words.className).toMatch(/wait/);
    expect(waiting.querySelector('[data-still] [data-tone="wait"]')).not.toBeNull();
  });

  it('the progress words may wrap inside their cell (longer in Hindi), so nothing is cut off', () => {
    const progress = rule(css('JobList.module.css'), '.progress');
    expect(progress).not.toMatch(/white-space:\s*nowrap/);
    expect(progress).not.toMatch(/overflow:\s*hidden|text-overflow/);
  });

  it('previous runs: the result as the sub line, its receipt or "model estimate" at the end, a failure in fail words with Run again', () => {
    const onRunAgain = vi.fn();
    // A model-written result never carries a receipt, even when the engine sends one.
    const runs = summaries.map((run) => (run.runId === '26' ? { ...run, receiptId: 'R-9999' } : run));
    expect(runs.find((run) => run.runId === '26')!.estimate).toBe(true);
    render(<JobList runs={runs} onOpen={() => {}} onRunAgain={onRunAgain} />);
    const rowOf = (purpose: string) => screen.getByRole('button', { name: purpose }).closest('li')!;
    const books = rowOf('Matched September bank lines to invoices');
    expect(books.hasAttribute('data-dense')).toBe(true);
    expect(within(books).getByRole('button', { name: 'Receipt R-0412' })).toBeTruthy();
    const reach = rowOf('Estimated reach for episode 14');
    expect(reach.textContent).toContain('About 18,000 views in 30 days');
    expect(reach.querySelector('[data-estimate]')!.textContent).toBe('model estimate');
    expect(within(reach).queryByRole('button', { name: /Receipt/ })).toBeNull();
    const failed = rowOf('Rendering the thumbnail set');
    expect(within(failed).getByText('Stopped: ffmpeg was not found on this computer.').className).toMatch(/fail/);
    fireEvent.click(within(failed).getByRole('button', { name: 'Run again' }));
    expect(onRunAgain).toHaveBeenCalledWith(expect.objectContaining({ runId: '28' }));
    assertInkRules(document.body);
  });

  it('the bars fill with the state tokens and never move', () => {
    const text = css('JobList.module.css');
    expect(text).toMatch(/\.bar\[data-tone='working'\]::-webkit-progress-value\s*\{[^}]*background:\s*var\(--accent\)/);
    expect(text).toMatch(/\.bar\[data-tone='wait'\]::-webkit-progress-value\s*\{[^}]*background:\s*var\(--wait-ring\)/);
    expect(text).not.toMatch(/animation|transition/);
  });
});
