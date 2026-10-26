import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProgressRing } from '../../src/parts/ProgressRing';
import { ProgressBar } from '../../src/parts/ProgressBar';
import { CATALOGUES, TextProvider, format } from '../../src/text';
import { assertNoInlineStyles } from '../helpers/ink-rules';
import { rule } from '../helpers/css';

const hi = (key: string, values?: Record<string, string | number>) => format(CATALOGUES.hi, 'hi', key, values);

describe('ProgressRing with long counts and no count', () => {
  it('past 9 steps the hole shows only the steps done; the name still says the whole', () => {
    render(<ProgressRing progress={{ done: 10, total: 12 }} />);
    const ring = screen.getByRole('img', { name: '10 of 12 steps done' });
    expect(ring.querySelector('[data-label]')!.textContent).toBe('10');
    expect(ring.querySelector('circle[data-arc]')!.getAttribute('stroke-dasharray')).toBe('10 12');
  });

  it('up to 9 steps it shows done and total', () => {
    render(<ProgressRing progress={{ done: 9, total: 9 }} />);
    expect(screen.getByRole('img', { name: '9 of 9 steps done' }).querySelector('[data-label]')!.textContent).toBe('9/9');
  });

  it('a total of 0 is no step count: words, never "0 of 0"', () => {
    const { container } = render(<ProgressRing progress={{ done: 0, total: 0 }} />);
    const ring = screen.getByRole('img', { name: 'Working, no step count yet' });
    expect(ring.querySelectorAll('circle[data-dot]')).toHaveLength(3);
    expect(container.textContent).not.toMatch(/\d/);
  });
});

describe('ProgressBar with many steps', () => {
  it('up to 12 steps it draws segments', () => {
    render(<ProgressBar progress={{ done: 7, total: 12 }} />);
    const bar = screen.getByRole('img', { name: '7 of 12 steps done' });
    expect(bar.querySelectorAll('[data-segment]')).toHaveLength(12);
    expect(bar.querySelector('svg')).toBeNull();
  });

  it('at 40 steps it draws one scaled svg: a track and a fill as wide as the steps done, by attributes alone', () => {
    const { container } = render(<ProgressBar progress={{ done: 20, total: 40 }} />);
    const bar = screen.getByRole('img', { name: '20 of 40 steps done' });
    expect(bar.querySelectorAll('[data-segment]')).toHaveLength(0);
    const svg = bar.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 40 1');
    expect(svg.getAttribute('preserveAspectRatio')).toBe('none');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.querySelector('rect[data-track]')!.getAttribute('width')).toBe('40');
    expect(svg.querySelector('rect[data-done]')!.getAttribute('width')).toBe('20');
    expect(container.querySelector('[data-label]')!.textContent).toBe('20 of 40');
    assertNoInlineStyles(container);
  });

  it('at 120 steps, waiting, the same svg in the waiting tone', () => {
    const { container } = render(<ProgressBar progress={{ done: 50, total: 120 }} tone="waiting" />);
    const svg = screen.getByRole('img', { name: '50 of 120 steps done, waiting on you' }).querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 120 1');
    expect(svg.querySelector('rect[data-done]')!.getAttribute('width')).toBe('50');
    expect(container.firstElementChild!.getAttribute('data-tone')).toBe('waiting');
    expect(rule('ProgressBar.module.css', ".bar[data-tone='waiting'] .fill")).toMatch(/fill:\s*var\(--wait-ring\)/);
    assertNoInlineStyles(container);
  });

  it('nothing done at 40 steps draws the track alone', () => {
    render(<ProgressBar progress={{ done: 0, total: 40 }} />);
    const bar = screen.getByRole('img', { name: '0 of 40 steps done' });
    expect(bar.querySelector('rect[data-track]')).not.toBeNull();
    expect(bar.querySelector('rect[data-done]')).toBeNull();
  });

  it('a total of 0 is no step count: words, never "0 of 0"', () => {
    const { container } = render(<ProgressBar progress={{ done: 0, total: 0 }} />);
    expect(screen.getByRole('img', { name: 'No step count yet' }).querySelector('[data-still]')).not.toBeNull();
    expect(container.textContent).not.toMatch(/\d/);
  });
});

describe('ProgressRing', () => {
  it('3 of 5 is an image named in words, shows 3/5, and draws the arc with pathLength and a dash, so nothing is divided', () => {
    const { container } = render(<ProgressRing progress={{ done: 3, total: 5 }} />);
    const ring = screen.getByRole('img', { name: '3 of 5 steps done' });
    expect(ring.dataset.tone).toBe('working');
    const shown = ring.querySelector('[data-label]')!;
    expect(shown.textContent).toBe('3/5');
    expect(shown.getAttribute('aria-hidden')).toBe('true');
    const arc = ring.querySelector('circle[data-arc]')!;
    expect(arc.getAttribute('pathLength')).toBe('5');
    expect(arc.getAttribute('stroke-dasharray')).toBe('3 5');
    expect(ring.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    assertNoInlineStyles(container);
  });

  it('waiting on the owner says so in words and takes the waiting tone', () => {
    render(<ProgressRing progress={{ done: 2, total: 3 }} tone="waiting" />);
    const ring = screen.getByRole('img', { name: '2 of 3 steps done, waiting on you' });
    expect(ring.dataset.tone).toBe('waiting');
    expect(ring.querySelector('circle[data-arc]')!.getAttribute('stroke-dasharray')).toBe('2 3');
  });

  it('a failed run says so in words and takes the failed tone', () => {
    render(<ProgressRing progress={{ done: 1, total: 4 }} tone="failed" />);
    expect(screen.getByRole('img', { name: '1 of 4 steps done, failed' }).dataset.tone).toBe('failed');
  });

  it('unmeasured work says "Working, no step count yet" with three dots and no numbers', () => {
    const { container } = render(<ProgressRing progress="indeterminate" />);
    const ring = screen.getByRole('img', { name: 'Working, no step count yet' });
    expect(ring.querySelectorAll('circle[data-dot]')).toHaveLength(3);
    expect(ring.querySelector('[data-label]')).toBeNull();
    expect(ring.textContent).not.toMatch(/\d/);
    const arc = ring.querySelector('circle[data-arc]')!;
    expect(arc.getAttribute('pathLength')).toBe('4');
    expect(arc.getAttribute('stroke-dasharray')).toBe('1 4');
    assertNoInlineStyles(container);
  });

  it('unmeasured and waiting, or unmeasured and failed, say that', () => {
    render(<><ProgressRing progress="indeterminate" tone="waiting" /><ProgressRing progress="indeterminate" tone="failed" /></>);
    expect(screen.getByRole('img', { name: 'Waiting on you, no step count yet' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Failed, no step count yet' })).toBeTruthy();
  });

  it('nothing done draws no arc; all done draws the whole ring; one step reads "step"', () => {
    const { container } = render(<ProgressRing progress={{ done: 0, total: 3 }} />);
    expect(screen.getByRole('img', { name: '0 of 3 steps done' })).toBeTruthy();
    expect(container.querySelector('circle[data-arc]')).toBeNull();
    render(<ProgressRing progress={{ done: 1, total: 1 }} />);
    const one = screen.getByRole('img', { name: '1 of 1 step done' });
    expect(one.querySelector('circle[data-arc]')!.getAttribute('stroke-dasharray')).toBe('1 1');
  });

  it('the ring colours are the ring tokens on the line track', () => {
    expect(rule('ProgressRing.module.css', '.track')).toMatch(/stroke:\s*var\(--line\)/);
    expect(rule('ProgressRing.module.css', ".ring[data-tone='working']")).toMatch(/--ring-colour:\s*var\(--accent\)/);
    expect(rule('ProgressRing.module.css', ".ring[data-tone='waiting']")).toMatch(/--ring-colour:\s*var\(--wait-ring\)/);
    expect(rule('ProgressRing.module.css', ".ring[data-tone='failed']")).toMatch(/--ring-colour:\s*var\(--fail-ring\)/);
    expect(rule('ProgressRing.module.css', '.arc')).toMatch(/stroke:\s*var\(--ring-colour\)/);
  });

  it('speaks Hindi', () => {
    render(<TextProvider language="hi"><ProgressRing progress={{ done: 3, total: 5 }} tone="waiting" /></TextProvider>);
    expect(screen.getByRole('img', { name: hi('ring.stepsWaiting', { done: 3, total: 5, count: 5 }) })).toBeTruthy();
  });
});

describe('axe on rings and bars', () => {
  it('finds nothing to fix', async () => {
    const { default: axe } = await import('axe-core');
    const { container } = render(
      <main>
        <ProgressRing progress={{ done: 3, total: 5 }} />
        <ProgressRing progress="indeterminate" tone="waiting" />
        <ProgressBar progress={{ done: 1, total: 6 }} tone="failed" />
        <ProgressBar progress="indeterminate" />
      </main>,
    );
    const result = await axe.run(container, { resultTypes: ['violations'], rules: { 'color-contrast': { enabled: false } } });
    expect(result.violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${v.help} at ${n.target.join(' ')}`))).toEqual([]);
  });
});

describe('ProgressBar', () => {
  it('draws one segment per step, the done ones filled, named in words, with the count beside it', () => {
    const { container } = render(<ProgressBar progress={{ done: 3, total: 5 }} />);
    const bar = screen.getByRole('img', { name: '3 of 5 steps done' });
    const segments = bar.querySelectorAll('[data-segment]');
    expect(segments).toHaveLength(5);
    expect([...segments].map((s) => s.hasAttribute('data-filled'))).toEqual([true, true, true, false, false]);
    const shown = container.querySelector('[data-label]')!;
    expect(shown.textContent).toBe('3 of 5');
    expect(shown.getAttribute('aria-hidden')).toBe('true');
    expect(container.firstElementChild!.getAttribute('data-tone')).toBe('working');
    assertNoInlineStyles(container);
  });

  it('unmeasured work draws one still segment labelled "No step count yet", with no numbers', () => {
    const { container } = render(<ProgressBar progress="indeterminate" />);
    const bar = screen.getByRole('img', { name: 'No step count yet' });
    const segments = bar.querySelectorAll('[data-segment]');
    expect(segments).toHaveLength(1);
    expect(segments[0]!.hasAttribute('data-still')).toBe(true);
    expect(container.querySelector('[data-label]')).toBeNull();
    expect(container.textContent).not.toMatch(/\d/);
    assertNoInlineStyles(container);
  });

  it('waiting and failed bars say so and take their tone', () => {
    const { container } = render(<><ProgressBar progress={{ done: 2, total: 3 }} tone="waiting" /><ProgressBar progress={{ done: 1, total: 6 }} tone="failed" /></>);
    expect(screen.getByRole('img', { name: '2 of 3 steps done, waiting on you' })).toBeTruthy();
    expect(screen.getByRole('img', { name: '1 of 6 steps done, failed' })).toBeTruthy();
    expect([...container.children].map((c) => c.getAttribute('data-tone'))).toEqual(['waiting', 'failed']);
  });

  it('can leave the count out when the place says it itself', () => {
    const { container } = render(<ProgressBar progress={{ done: 3, total: 5 }} showCount={false} />);
    expect(container.querySelector('[data-label]')).toBeNull();
    expect(screen.getByRole('img', { name: '3 of 5 steps done' })).toBeTruthy();
  });

  it('filled segments take the tone colour on the line track', () => {
    expect(rule('ProgressBar.module.css', '.segment')).toMatch(/background:\s*var\(--line\)/);
    expect(rule('ProgressBar.module.css', ".bar[data-tone='working'] .segment[data-filled]")).toMatch(/background:\s*var\(--accent\)/);
    expect(rule('ProgressBar.module.css', ".bar[data-tone='waiting'] .segment[data-filled]")).toMatch(/background:\s*var\(--wait-ring\)/);
    expect(rule('ProgressBar.module.css', ".bar[data-tone='failed'] .segment[data-filled]")).toMatch(/background:\s*var\(--fail-ring\)/);
  });

  it('speaks Hindi', () => {
    render(<TextProvider language="hi"><ProgressBar progress="indeterminate" /></TextProvider>);
    expect(screen.getByRole('img', { name: hi('bar.indeterminate') })).toBeTruthy();
  });
});
