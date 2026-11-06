import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { GoalBar, GoalBarKey } from '../../src/parts/charts/GoalBar';
import { MiniBars } from '../../src/parts/charts/MiniBars';
import { BarChart } from '../../src/parts/charts/BarChart';
import { AgingBar } from '../../src/parts/charts/AgingBar';
import { SplitBar } from '../../src/parts/charts/SplitBar';
import { CashLine } from '../../src/parts/charts/CashLine';
import { ChartData } from '../../src/parts/charts/ChartData';
import type { AgingData, BarSeries, CashData, GoalBarData, SplitData } from '../../src/parts/charts/types';
import { Figure } from '../../src/parts/Figure';
import { TextProvider } from '../../src/text';
import { assertFiguresProved, assertInkRules, assertNoInlineStyles, receiptMark } from '../helpers/ink-rules';

/* Every value here is written for this test: engine-scaled integers (per mille) and engine-formatted strings. The UI
   never divides, sums money or formats a number; it only draws what it is given. */

const css = readFileSync(join(import.meta.dirname, '../../src/parts/charts/Charts.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
/** The declarations of every rule in Charts.module.css whose selector contains `fragment`, joined. */
function rulesFor(fragment: string): string {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => m[1]!.includes(fragment))
    .map((m) => m[2]!)
    .join(';');
}
/** The body of the `@container` block whose condition contains `condition`. */
function containerBlock(condition: string): string {
  const start = css.indexOf(`@container ${condition}`);
  if (start < 0) return '';
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return css.slice(start, i + 1);
  }
  return '';
}
/** A percentage attribute as a number ("24%" is 24), so a test can check bars do not overlap. */
const pct = (el: Element, name: string) => Number((el.getAttribute(name) ?? '').replace(/%$/, ''));

const goal: GoalBarData = {
  invoicedPermille: 789,
  readyPermille: 126,
  pacePermille: 742,
  label: '79% of the goal invoiced. Issuing the ready invoice takes it to 92%. Today\'s pace is 74%.',
};

describe('GoalBar', () => {
  it('draws invoiced, ready and pace on a 0 to 1000 scale, labelled by the engine sentence', () => {
    const { container } = render(<GoalBar data={goal} />);
    const bar = screen.getByRole('img', { name: goal.label });
    const svg = bar.querySelector('svg[viewBox="0 0 1000 14"]')!;
    expect(svg).not.toBeNull();
    const fill = svg.querySelector('[data-part="invoiced"]')!;
    expect(fill.getAttribute('x')).toBe('0');
    expect(fill.getAttribute('width')).toBe('789');
    const striped = svg.querySelector('[data-part="ready-stripes"]')!;
    expect(striped.getAttribute('x')).toBe('789');
    expect(striped.getAttribute('width')).toBe('126');
    const pattern = /^url\(#(.+)\)$/.exec(striped.getAttribute('fill') ?? '')![1]!;
    expect(container.querySelector(`pattern[id="${pattern}"]`)).not.toBeNull();
    const pace = bar.querySelector('[data-part="pace"]')!;
    expect(pace.getAttribute('x1')).toBe('742');
    expect(pace.getAttribute('x2')).toBe('742');
    assertNoInlineStyles();
  });

  it('draws no striped part when nothing is ready to issue', () => {
    const { container } = render(<GoalBar data={{ ...goal, readyPermille: 0 }} />);
    expect(container.querySelector('[data-part="ready"]')).toBeNull();
    expect(container.querySelector('[data-part="ready-stripes"]')).toBeNull();
  });

  it('sits on the dark goal card by default and on a light tile when asked', () => {
    const { container, rerender } = render(<GoalBar data={goal} />);
    expect(container.querySelector('[role="img"]')!.getAttribute('data-tone')).toBe('dark');
    rerender(<GoalBar data={goal} tone="light" />);
    expect(container.querySelector('[role="img"]')!.getAttribute('data-tone')).toBe('light');
  });

  it('keys the bar in words: invoiced, ready to issue with the figure it is given, and today\'s pace', () => {
    const { container } = render(<GoalBarKey ready={<Figure value="₹4,000" receiptId="R-0001" tone="dark" />} />);
    expect(container.textContent).toContain('Invoiced');
    expect(container.textContent).toContain('Ready to issue');
    expect(container.textContent).toContain('Today\'s pace');
    for (const swatch of container.querySelectorAll('svg')) expect(swatch.getAttribute('aria-hidden')).toBe('true');
    assertFiguresProved();
    assertNoInlineStyles();
  });
});

describe('MiniBars', () => {
  it('draws one bar per height, the last one current, hidden from screen readers when it has no label', () => {
    const { container } = render(<MiniBars heights={[570, 860, 710, 1000, 430, 860, 710]} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('role')).toBeNull();
    const bars = [...svg.querySelectorAll('rect')];
    expect(bars.map((bar) => bar.getAttribute('height'))).toEqual(['570', '860', '710', '1000', '430', '860', '710']);
    expect(bars.map((bar) => bar.hasAttribute('data-current'))).toEqual([false, false, false, false, false, false, true]);
    assertNoInlineStyles();
  });

  it('is an image with its label when it is given one', () => {
    render(<MiniBars heights={[300, 1000]} label="Jobs per day: 3, then 10 so far today" />);
    expect(screen.getByRole('img', { name: 'Jobs per day: 3, then 10 so far today' })).toBeTruthy();
  });

  it('marks no bar current when the bars are not a time line (one per department, W4 4A2)', () => {
    const { container } = render(<MiniBars heights={[250, 1000, 0]} current={false} />);
    expect([...container.querySelectorAll('rect')].map((bar) => bar.hasAttribute('data-current'))).toEqual([false, false, false]);
  });

  it('renders nothing for no heights, so there is never a negative width', () => {
    const { container } = render(<MiniBars heights={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('rounds only the top of each bar, never the end on the baseline', () => {
    const { container } = render(<MiniBars heights={[300, 1000]} />);
    for (const bar of container.querySelectorAll('rect')) {
      expect(bar.hasAttribute('rx')).toBe(false);
      expect(bar.hasAttribute('ry')).toBe(false);
    }
    expect(rulesFor('.miniBar')).toMatch(/clip-path:\s*inset\(0 round 0 0 2px 2px \/ 0 0 62\.5px 62\.5px\)/);
  });
});

const months: BarSeries = {
  label: 'In',
  points: [
    { key: '2026-08', label: 'Aug', valuePermille: 610, value: '₹61,000' },
    { key: '2026-09', label: 'Sep', valuePermille: 1000, value: '₹1,00,000' },
    { key: '2026-10', label: 'Oct, so far', valuePermille: 420, value: '₹42,000' },
  ],
};
const out: BarSeries = {
  label: 'Out',
  points: [
    { key: '2026-08', label: 'Aug', valuePermille: 250, value: '₹25,000' },
    { key: '2026-09', label: 'Sep', valuePermille: 270, value: '₹27,000' },
    { key: '2026-10', label: 'Oct, so far', valuePermille: 260, value: '₹26,000' },
  ],
};
const jobs: BarSeries = {
  label: 'Jobs',
  points: [
    { key: 'w1', label: '5 Oct', valuePermille: 500, value: '4' },
    { key: 'w2', label: '12 Oct', valuePermille: null, value: '' },
    { key: 'w3', label: '19 Oct', valuePermille: 1000, value: '8' },
  ],
};
const MONTHS = ['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'];
const yearIn: BarSeries = { label: 'In', points: MONTHS.map((m, i) => ({ key: m, label: m, valuePermille: 300 + i * 50, value: `₹${30 + i * 5},000` })) };
const yearOut: BarSeries = { label: 'Out', points: MONTHS.map((m) => ({ key: m, label: m, valuePermille: 250, value: '₹25,000' })) };

describe('BarChart', () => {
  it('counts with a money note under each, each note proved by its own receipt (proof "each", W4 4A2)', () => {
    const weeks: BarSeries = { label: 'Jobs', points: [
      { key: 'w1', label: '5 Oct', valuePermille: 500, value: '4', note: 'USD 0.0400', receiptId: 'R-0601' },
      { key: 'w2', label: '12 Oct', valuePermille: 1000, value: '8', note: 'USD 0.0800', receiptId: 'R-0602' },
    ] };
    const { container } = render(<BarChart kind="count" proof="each" noteLabel="Spend" series={[weeks]} label="Jobs and spend by week" />);
    const root = container.querySelector('[data-chart]')!;
    expect(root.hasAttribute('data-figure-group')).toBe(true);
    expect([...container.querySelectorAll('[data-note]')].map((note) => note.textContent)).toEqual(['USD 0.0400', 'USD 0.0800']);
    // No one receipt in the foot: each week's own is in the table.
    expect(within(container.querySelector('table')!).getAllByRole('button').map((button) => button.getAttribute('data-receipt'))).toEqual(['R-0601', 'R-0602']);
    expect(container.querySelectorAll('[data-receipt]')).toHaveLength(2);
    assertInkRules();
  });

  it('draws each bar at its per mille height and writes the engine strings above the bars', () => {
    render(<BarChart kind="money" series={[months]} label="Money in by month" proof={{ receiptId: 'R-0101' }} />);
    const plot = screen.getByRole('img', { name: 'Money in by month' });
    const bars = [...plot.querySelectorAll('rect[data-bar]')];
    expect(bars.map((bar) => bar.getAttribute('height'))).toEqual(['610', '1000', '420']);
    expect([...plot.querySelectorAll('text[data-cap]')].map((cap) => cap.textContent)).toEqual(['₹61,000', '₹1,00,000', '₹42,000']);
    expect(plot.textContent).toContain('Oct, so far');
    expect(bars.map((bar) => bar.hasAttribute('data-current'))).toEqual([false, false, true]);
    assertInkRules();
  });

  it('proves money once for the chart: one figure group whose receipt covers every amount in it', () => {
    const onReceipt = vi.fn();
    const { container } = render(<BarChart kind="money" series={[months]} label="Money in by month" proof={{ receiptId: 'R-0101' }} onReceipt={onReceipt} />);
    const groups = container.querySelectorAll('[data-figure-group]');
    expect(groups).toHaveLength(1);
    expect(groups[0]!.contains(screen.getByRole('button', { name: receiptMark('R-0101') }))).toBe(true);
    expect(groups[0]!.querySelector('text[data-cap]')!.textContent).toBe('₹61,000');
    expect(container.querySelector('[data-ui-number]')).toBeNull();
    assertFiguresProved();
    fireEvent.click(screen.getByRole('button', { name: receiptMark('R-0101') }));
    expect(onReceipt).toHaveBeenCalledWith('R-0101');
  });

  it('labels a model-written chart "model estimate" and gives it no receipt', () => {
    const { container } = render(<BarChart kind="money" series={[months]} label="Money in by month" proof={{ estimate: true }} />);
    expect(container.querySelector('[data-figure-group] [data-estimate]')!.textContent).toBe('model estimate');
    expect(container.querySelector('[data-receipt]')).toBeNull();
    assertFiguresProved();
  });

  it('cannot be a money chart without a proof (a type error), and a count chart needs none', () => {
    // @ts-expect-error a money chart must say how its amounts are proved
    const unproved = <BarChart kind="money" series={[months]} label="Money in by month" />;
    // @ts-expect-error a money note beside counts needs the chart's proof
    const unprovedNote = <BarChart kind="count" noteLabel="Spend" series={[jobs]} label="Jobs" />;
    expect(unproved).toBeTruthy();
    expect(unprovedNote).toBeTruthy();
    const { container } = render(<BarChart kind="count" series={[jobs]} label="Jobs per week" />);
    expect(container.querySelector('[data-figure-group]')).toBeNull();
    expect(container.querySelector('[data-receipt]')).toBeNull();
    expect(container.querySelectorAll('text[data-cap][data-count]')).toHaveLength(2);
    assertInkRules();
  });

  it('draws no bar for a missing value and writes nothing for it, never 0', () => {
    render(<BarChart kind="count" series={[jobs]} label="Jobs per week" />);
    const plot = screen.getByRole('img', { name: 'Jobs per week' });
    const columns = [...plot.querySelectorAll('[data-key]')];
    expect(columns.map((column) => column.getAttribute('data-key'))).toEqual(['w1', 'w2', 'w3']);
    const missing = columns[1]!;
    expect(missing.querySelector('rect[data-bar]')).toBeNull();
    expect(missing.querySelector('text[data-cap]')).toBeNull();
    expect(missing.textContent).toContain('12 Oct');
    expect(missing.textContent).not.toMatch(/\b0\b/);
  });

  it('rounds only the data end of a bar: no rx on the bar, a clip that rounds its top two corners', () => {
    const { container } = render(<BarChart kind="money" series={[months]} label="Money in by month" proof={{ receiptId: 'R-0101' }} />);
    for (const bar of container.querySelectorAll('rect[data-bar]')) {
      expect(bar.hasAttribute('rx')).toBe(false);
      expect(bar.hasAttribute('ry')).toBe(false);
    }
    // The bars stand in a flipped group, so their top on screen is the bottom of their box: round 0 0 r r.
    expect(rulesFor('.bar')).toMatch(/clip-path:\s*inset\(0 round 0 0 4px 4px \/ 0 0 25px 25px\)/);
  });

  it('places paired bars by percentages of their column, so twelve months fit a phone without overlapping', () => {
    render(<BarChart kind="money" series={[yearIn, yearOut]} label="Money in and out, twelve months" proof={{ receiptId: 'R-0103' }} />);
    const plot = screen.getByRole('img', { name: 'Money in and out, twelve months' });
    const columns = [...plot.querySelectorAll('[data-key]')];
    expect(columns).toHaveLength(12);
    for (const column of columns) {
      const [inBar, outBar] = [...column.querySelectorAll('rect[data-bar]')];
      for (const bar of [inBar!, outBar!]) {
        expect(bar.getAttribute('x')).toMatch(/%$/);
        expect(bar.getAttribute('width')).toMatch(/%$/);
      }
      expect(pct(inBar!, 'x')).toBeGreaterThanOrEqual(0);
      expect(pct(inBar!, 'x') + pct(inBar!, 'width')).toBeLessThan(pct(outBar!, 'x'));
      expect(pct(outBar!, 'x') + pct(outBar!, 'width')).toBeLessThanOrEqual(100);
    }
    // On a wide tile CSS holds the pair at D's 20 px bars, 4 px apart; on a narrow one it agrees with the percentages.
    expect(rulesFor(".chart[data-paired] .bar[data-series='0']")).toMatch(/width:\s*min\(20px, 24%\)/);
    expect(rulesFor(".chart[data-paired] .bar[data-series='1']")).toMatch(/x:\s*calc\(50% \+ min\(2px, 2%\)\)/);
  });

  it('on a narrow tile, writes only the current amount over the bars; counts all stay', () => {
    const narrow = containerBlock('(max-width: 440px)');
    // 4Z2: counts over a figure group's bars stay too; only amounts are left to the table.
    expect(narrow).toMatch(/\.chart\[data-figure-group\] \.cap:not\(\[data-current\]\):not\(\[data-count\]\)\s*\{\s*display:\s*none/);
    expect(narrow).toMatch(/\.chart\[data-figure-group\] \.column:not\(\[data-current\]\) \.note\s*\{\s*visibility:\s*hidden/);
    // Twelve months keep every other label, counted back from the current month, rather than breaking words.
    expect(narrow).toMatch(/\.columns:has\(> :nth-child\(9\)\) > \.column:nth-last-child\(even\) \.xLabel\s*\{\s*visibility:\s*hidden/);
    expect(rulesFor('.xLabel')).not.toMatch(/overflow-wrap:\s*anywhere/);
    expect(narrow).not.toMatch(/\.chart:not\(\[data-figure-group\]\)/);
  });

  it('writes level lines in a gutter sized to the longest label, so a phone keeps a scale', () => {
    const ticks = [{ permille: 0, label: '₹0' }, { permille: 500, label: '₹12,00,000' }, { permille: 1000, label: '₹24,00,000' }];
    const { container } = render(<BarChart kind="money" series={[months, out]} ticks={ticks} label="Money in and out by month" proof={{ receiptId: 'R-0102' }} />);
    const gutter = container.querySelector('svg[data-gutter]')!;
    expect(gutter.getAttribute('width')).toBe('11ch');
    const labels = [...gutter.querySelectorAll('text[data-tick]')];
    expect(labels.map((tick) => tick.textContent)).toEqual(['₹0', '₹12,00,000', '₹24,00,000']);
    for (const label of labels) expect(label.getAttribute('x')).toBe('100%');
    const first = container.querySelector('[data-key="2026-08"]')!;
    expect([...first.querySelectorAll('line[data-grid]')].map((line) => line.getAttribute('y1'))).toEqual(['500', '1000']);
    assertInkRules();
  });

  it('writes a second engine string under each month (What was left), proved by the chart', () => {
    const left: BarSeries = { ...months, points: months.points.map((p, i) => ({ ...p, note: ['+₹36,000', '+₹73,000', '+₹16,000'][i] })) };
    const { container } = render(<BarChart kind="money" noteLabel="What was left" series={[left, out]} label="Money in and out by month" proof={{ receiptId: 'R-0102' }} />);
    const column = container.querySelector('[data-key="2026-09"]')!;
    expect(column.querySelector('[data-note]')!.textContent).toBe('+₹73,000');
    const table = container.querySelector('table')!;
    expect(within(table).getByRole('columnheader', { name: 'What was left' })).toBeTruthy();
    expect(within(table).getByRole('row', { name: /Sep/ }).textContent).toContain('+₹73,000');
    assertInkRules();
  });

  it('says N/A for a missing value in ranked bars, with no bar drawn', () => {
    render(<BarChart kind="count" layout="ranked" series={[jobs]} label="Jobs by department" />);
    const plot = screen.getByRole('img', { name: 'Jobs by department' });
    const rows = [...plot.querySelectorAll('[data-key]')];
    expect(rows).toHaveLength(3);
    expect(rows[1]!.querySelector('[data-bar]')).toBeNull();
    expect(rows[1]!.textContent).toContain('N/A');
    expect(rows[1]!.textContent).not.toMatch(/\b0\b/);
    expect(rows[0]!.querySelector('[data-bar]')!.getAttribute('value')).toBe('500');
    expect(rows[2]!.textContent).toContain('8');
  });

  it('draws ranked bars as meters on a 0 to 1000 scale, rounded at the data end only', () => {
    const { container } = render(<BarChart kind="count" layout="ranked" series={[jobs]} label="Jobs by department" />);
    const meter = container.querySelector('meter[data-bar]')!;
    expect([meter.getAttribute('min'), meter.getAttribute('max'), meter.getAttribute('aria-hidden')]).toEqual(['0', '1000', 'true']);
    expect(rulesFor('.rankMeter::-webkit-meter-optimum-value')).toMatch(/border-radius:\s*0 5px 5px 0/);
  });

  it('colours ranked bars by department when a point names one', () => {
    const byDept: BarSeries = {
      label: 'Jobs',
      points: [
        { key: 'money', label: 'Money', valuePermille: 1000, value: '12', dept: 'money' },
        { key: 'prod', label: 'Production', valuePermille: 500, value: '6', dept: 'prod' },
      ],
    };
    const { container } = render(<BarChart kind="count" layout="ranked" series={[byDept]} label="Jobs by department" />);
    expect([...container.querySelectorAll('[data-key]')].map((row) => row.getAttribute('data-dept'))).toEqual(['money', 'prod']);
  });

  it('puts a money column beside ranked counts (jobs and spend), proved by the chart\'s group', () => {
    const jobsAndSpend: BarSeries = {
      label: 'Jobs',
      points: [
        { key: 'money', label: 'Money', valuePermille: 1000, value: '12', note: '₹33.00', dept: 'money' },
        { key: 'prod', label: 'Production', valuePermille: 500, value: '6', note: '₹42.00', dept: 'prod' },
      ],
    };
    const { container } = render(
      <BarChart kind="count" noteLabel="Spend this month" proof={{ receiptId: 'R-0601' }} layout="ranked" series={[jobsAndSpend]} label="Jobs and spend by department" />,
    );
    const row = container.querySelector('[data-key="prod"]')!;
    expect(row.querySelector('[data-count]')!.textContent).toBe('6');
    expect(row.querySelector('[data-note]')!.textContent).toBe('₹42.00');
    const group = container.querySelector('[data-figure-group]')!;
    expect(group.contains(screen.getByRole('button', { name: receiptMark('R-0601') }))).toBe(true);
    expect(within(container.querySelector('table')!).getByRole('columnheader', { name: 'Spend this month' })).toBeTruthy();
    assertInkRules();
  });

  it('pairs two series: two bars a column, a legend naming both, and values over the first', () => {
    const { container } = render(<BarChart kind="money" series={[months, out]} label="Money in and out by month" proof={{ receiptId: 'R-0102' }} />);
    const plot = screen.getByRole('img', { name: 'Money in and out by month' });
    const first = plot.querySelector('[data-key="2026-08"]')!;
    expect([...first.querySelectorAll('rect[data-bar]')].map((bar) => [bar.getAttribute('data-series'), bar.getAttribute('height')])).toEqual([['0', '610'], ['1', '250']]);
    expect([...plot.querySelectorAll('text[data-cap]')].map((cap) => cap.textContent)).toEqual(['₹61,000', '₹1,00,000', '₹42,000']);
    const legend = container.querySelector('[data-legend]')!;
    expect(legend.textContent).toContain('In');
    expect(legend.textContent).toContain('Out');
    assertInkRules();
  });

  it('has a text equivalent: View chart data opens a table of the engine strings', () => {
    const { container } = render(<BarChart kind="money" series={[months, out]} label="Money in and out by month" proof={{ receiptId: 'R-0102' }} />);
    const details = container.querySelector('details')!;
    expect(within(details).getByText('View chart data').tagName).toBe('SUMMARY');
    const table = within(details).getByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'In' })).toBeTruthy();
    expect(within(table).getByRole('columnheader', { name: 'Out' })).toBeTruthy();
    const row = within(table).getByRole('row', { name: /Sep/ });
    expect(row.textContent).toContain('₹1,00,000');
    expect(row.textContent).toContain('₹27,000');
  });

  it('writes N/A in the table for a missing value', () => {
    const { container } = render(<BarChart kind="count" series={[jobs]} label="Jobs per week" />);
    const row = within(container.querySelector('table')!).getByRole('row', { name: /12 Oct/ });
    expect(row.textContent).toContain('N/A');
  });

  it('gives each point its own receipt in the table when the engine sends one', () => {
    const receipted: BarSeries = { ...months, points: months.points.map((p, i) => ({ ...p, receiptId: `R-020${i}` })) };
    const { container } = render(<BarChart kind="money" series={[receipted]} label="Money in by month" proof={{ receiptId: 'R-0101' }} />);
    const table = container.querySelector('table')!;
    expect(within(table).getByRole('button', { name: receiptMark('R-0201') })).toBeTruthy();
    assertFiguresProved();
  });

  it('renders nothing at all for an empty series', () => {
    const { container } = render(<BarChart kind="money" series={[{ label: 'In', points: [] }]} label="Money in by month" proof={{ receiptId: 'R-0101' }} />);
    expect(container.innerHTML).toBe('');
  });

  it('uses the department colour for a department\'s single series', () => {
    const { container } = render(<BarChart kind="count" series={[jobs]} label="Jobs per week" dept="prod" />);
    expect(container.querySelector('[data-chart]')!.getAttribute('data-dept')).toBe('prod');
    expect(rulesFor("[data-dept='prod'] .bar")).toContain('var(--prod-line)');
    expect(rulesFor("[data-dept='prod'] .bar[data-current]")).toContain('var(--prod)');
  });
});

const aging: AgingData = {
  label: 'Owed by age: not due yet ₹40,000, 1 to 30 days late ₹12,000, 31 to 60 days late ₹6,000, 61 to 90 days late ₹3,000, over 90 days ₹0',
  proof: { receiptId: 'R-0301' },
  buckets: [
    { id: '61-90', label: '61 to 90 days late', count: '1 invoice', amount: '₹3,000', permille: 49 },
    { id: 'not-due', label: 'Not due yet', count: '2 invoices', amount: '₹40,000', permille: 656 },
    { id: 'over-90', label: 'Over 90 days', count: 'none', amount: '₹0', permille: 0 },
    { id: '1-30', label: '1 to 30 days late', count: '1 invoice', amount: '₹12,000', permille: 197 },
    { id: '31-60', label: '31 to 60 days late', count: '1 invoice', amount: '₹6,000', permille: 98 },
  ],
};

describe('AgingBar', () => {
  it('draws the buckets in age order, not due first, and skips an empty one', () => {
    render(<AgingBar data={aging} />);
    const bar = screen.getByRole('img', { name: aging.label });
    const segments = [...bar.querySelectorAll('rect[data-bucket]')];
    expect(segments.map((s) => s.getAttribute('data-bucket'))).toEqual(['not-due', '1-30', '31-60', '61-90']);
    expect(segments.map((s) => s.getAttribute('width'))).toEqual(['656', '197', '98', '49']);
  });

  it('fills not due in chart ink and each later age in its own chart token, bar and legend alike', () => {
    const fills: [string, string][] = [['not-due', '--chart-ink'], ['1-30', '--age-30'], ['31-60', '--age-60'], ['61-90', '--age-90'], ['over-90', '--age-over']];
    for (const [bucket, token] of fills) {
      expect(rulesFor(`.seg[data-bucket='${bucket}']`), bucket).toContain(`var(${token})`);
      expect(rulesFor(`.swatch[data-bucket='${bucket}']`), bucket).toContain(`var(${token})`);
    }
    expect(css).not.toMatch(/data-bucket='[\w-]+'\][^{]*\{[^}]*var\(--(?:wait|fail)/);
  });

  it('lists every bucket in words with its count and amount, an empty one with a hollow square', () => {
    const { container } = render(<AgingBar data={aging} />);
    const rows = [...container.querySelectorAll('li[data-bucket]')];
    expect(rows.map((row) => row.getAttribute('data-bucket'))).toEqual(['not-due', '1-30', '31-60', '61-90', 'over-90']);
    expect(rows[0]!.textContent).toContain('Not due yet');
    expect(rows[0]!.textContent).toContain('2 invoices');
    expect(rows[0]!.textContent).toContain('₹40,000');
    expect(rows[4]!.querySelector('[data-swatch]')!.hasAttribute('data-zero')).toBe(true);
    expect(rows[0]!.querySelector('[data-swatch]')!.hasAttribute('data-zero')).toBe(false);
    expect(rulesFor('[data-zero]')).toMatch(/background:\s*transparent/);
  });

  it('legend "held" (a tile at rest) lists only the ages that hold money, each in words with its count and amount', () => {
    const { container } = render(<AgingBar data={aging} legend="held" />);
    const rows = [...container.querySelectorAll('li[data-bucket]')];
    expect(rows.map((row) => row.getAttribute('data-bucket'))).toEqual(['not-due', '1-30', '31-60', '61-90']);
    expect(rows[1]!.textContent).toBe('1 to 30 days late1 invoice₹12,000');
    // The empty age still has its row in the chart's table.
    expect([...container.querySelectorAll('tbody tr')]).toHaveLength(5);
  });

  it('carries one receipt for the tile, which proves every amount', () => {
    const { container } = render(<AgingBar data={aging} />);
    expect(container.querySelectorAll('[data-receipt]')).toHaveLength(1);
    const group = container.querySelector('[data-figure-group]')!;
    expect(group.contains(screen.getByRole('button', { name: receiptMark('R-0301') }))).toBe(true);
    expect(group.textContent).toContain('₹40,000');
    assertInkRules();
  });

  it('can be a model estimate instead, with no receipt', () => {
    const { container } = render(<AgingBar data={{ ...aging, proof: { estimate: true } }} />);
    expect(container.querySelector('[data-figure-group] [data-estimate]')).not.toBeNull();
    expect(container.querySelector('[data-receipt]')).toBeNull();
    assertInkRules();
  });
});

const split: SplitData = {
  label: 'AI spend by department.',
  proof: { receiptId: 'R-0401' },
  // Shuffled, as an engine might send it; the bar and the legend keep their own order.
  parts: [
    { dept: 'prod', amount: '₹40.00', permille: 400 },
    { dept: 'mkt', amount: '₹0.00', permille: 0 },
    { dept: 'ops', amount: '₹5.00', permille: 50 },
    { dept: 'sales', amount: '₹25.00', permille: 250 },
    { dept: 'money', amount: '₹30.00', permille: 300 },
  ],
};

describe('SplitBar', () => {
  it('draws departments in the fixed order sales, money, ops, mkt, prod, whatever order the engine sends', () => {
    render(<SplitBar data={split} />);
    const bar = screen.getByRole('img', { name: split.label });
    const segments = [...bar.querySelectorAll('rect[data-dept]')];
    expect(segments.map((s) => [s.getAttribute('data-dept'), s.getAttribute('width')])).toEqual([['sales', '250'], ['money', '300'], ['ops', '50'], ['prod', '400']]);
    expect(rulesFor(".seg[data-dept='prod']")).toContain('var(--prod)');
  });

  it('names each department with its amount in the same order, empty ones last, proved by one receipt', () => {
    const { container } = render(<SplitBar data={split} />);
    const rows = [...container.querySelectorAll('li[data-dept]')];
    // A part with no share is left out of the legend (W4 4A2) and listed last in the table.
    expect(rows.map((row) => row.textContent)).toEqual(['Sales and clients₹25.00', 'Money₹30.00', 'Operations₹5.00', 'Production₹40.00']);
    const tableRows = within(container.querySelector('table')!).getAllByRole('rowheader').map((cell) => cell.textContent);
    expect(tableRows).toEqual(['Sales and clients', 'Money', 'Operations', 'Production', 'Marketing']);
    expect(container.querySelectorAll('[data-receipt]')).toHaveLength(1);
    assertInkRules();
  });

  it('draws the part no single department can claim last, as "Shared by the team", in grey (W4 4A2)', () => {
    const { container } = render(<SplitBar data={{ ...split, parts: [{ dept: 'shared', amount: '₹10.00', permille: 100 }, ...split.parts] }} />);
    const bar = screen.getByRole('img', { name: split.label });
    expect([...bar.querySelectorAll('rect[data-dept]')].map((s) => s.getAttribute('data-dept'))).toEqual(['sales', 'money', 'ops', 'prod', 'shared']);
    const rows = [...container.querySelectorAll('li[data-dept]')];
    expect(rows.map((row) => row.textContent)).toEqual(['Sales and clients₹25.00', 'Money₹30.00', 'Operations₹5.00', 'Production₹40.00', 'Shared by the team₹10.00']);
    expect(rulesFor(".seg[data-dept='shared']")).toContain('var(--chart-rest)');
    assertInkRules();
  });

  it('can be a model estimate instead, with no receipt', () => {
    const { container } = render(<SplitBar data={{ ...split, proof: { estimate: true } }} />);
    expect(container.querySelector('[data-figure-group] [data-estimate]')).not.toBeNull();
    expect(container.querySelector('[data-receipt]')).toBeNull();
  });
});

const cash: CashData = {
  label: 'Cash in the bank by week: ₹1,40,000 this week, then a forecast of ₹1,50,000, ₹1,30,000 and ₹1,20,000.',
  proof: { receiptId: 'R-0501' },
  axis: ['19 Oct', '26 Oct', '2 Nov', '9 Nov'],
  assumptions: ['Clients pay on the due date.', 'Costs stay at their usual weekly level.'],
  ticks: [{ permille: 0, label: '₹1,00,000' }, { permille: 1000, label: '₹12,00,000' }],
  points: [
    { key: 'w0', label: 'Week of 19 Oct', actualPermille: 400, actual: '₹1,40,000', forecastPermille: 400, forecast: '₹1,40,000' },
    { key: 'w1', label: 'Week of 26 Oct', actualPermille: null, actual: null, forecastPermille: 500, forecast: '₹1,50,000' },
    { key: 'w2', label: 'Week of 2 Nov', actualPermille: null, actual: null, forecastPermille: 300, forecast: '₹1,30,000' },
    { key: 'w3', label: 'Week of 9 Nov', actualPermille: null, actual: null, forecastPermille: 200, forecast: '₹1,20,000' },
  ],
};
/** Two weeks that have happened (actual figures, the second one today), then two weeks of forecast. */
const history: CashData = {
  ...cash,
  axis: ['12 Oct', '19 Oct', '26 Oct', '2 Nov'],
  points: [
    { key: 'w0', label: 'Week of 12 Oct', actualPermille: 400, actual: '₹1,40,000', forecastPermille: null, forecast: null },
    { key: 'w1', label: 'Week of 19 Oct', actualPermille: 450, actual: '₹1,45,000', forecastPermille: 450, forecast: '₹1,45,000' },
    { key: 'w2', label: 'Week of 26 Oct', actualPermille: null, actual: null, forecastPermille: 300, forecast: '₹1,30,000' },
    { key: 'w3', label: 'Week of 2 Nov', actualPermille: null, actual: null, forecastPermille: 200, forecast: '₹1,20,000' },
  ],
};

describe('CashLine', () => {
  it('draws the forecast as a dashed line through the engine\'s points, one column per week', () => {
    render(<CashLine data={cash} />);
    const chart = screen.getByRole('img', { name: cash.label });
    const svg = chart.querySelector('svg[viewBox="0 0 400 1000"]')!;
    const forecast = svg.querySelector('polyline[data-line="forecast"]')!;
    expect(forecast.getAttribute('points')).toBe('50,400 150,500 250,300 350,200');
    expect(forecast.getAttribute('stroke-dasharray')).toBeTruthy();
  });

  it('draws the actual line solid through the actual points only', () => {
    render(<CashLine data={history} />);
    const chart = screen.getByRole('img', { name: history.label });
    const actual = chart.querySelector('polyline[data-line="actual"]')!;
    expect(actual.getAttribute('points')).toBe('50,400 150,450');
    expect(actual.getAttribute('stroke-dasharray')).toBeNull();
  });

  it('puts today\'s dot on the last week with an actual figure, where the forecast takes over', () => {
    const { container } = render(<CashLine data={history} />);
    const today = container.querySelectorAll('[data-part="today"]');
    expect(today).toHaveLength(1);
    expect([today[0]!.getAttribute('x1'), today[0]!.getAttribute('y1')]).toEqual(['150', '450']);
    expect(container.querySelector('[data-axis] [data-current]')!.textContent).toBe('19 Oct');
  });

  it('says Forecast in words and lists the assumptions under the chart', () => {
    const { container } = render(<CashLine data={cash} />);
    const chart = screen.getByRole('img', { name: cash.label });
    expect(container.querySelector('[data-legend]')!.textContent).toContain('Forecast');
    const assumptions = screen.getByRole('list', { name: 'The forecast assumes' });
    expect(within(assumptions).getAllByRole('listitem').map((item) => item.textContent)).toEqual(cash.assumptions);
    expect(chart.compareDocumentPosition(assumptions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('writes the axis, and the tick labels in a gutter sized to the longest so ₹12,00,000 fits', () => {
    const { container } = render(<CashLine data={cash} />);
    const axis = container.querySelector('[data-axis]')!;
    expect([...axis.children].map((label) => label.textContent)).toEqual(cash.axis);
    const gutter = container.querySelector('svg[data-gutter]')!;
    expect(gutter.getAttribute('width')).toBe('11ch');
    const ticks = [...gutter.querySelectorAll('text[data-tick]')];
    expect(ticks.map((tick) => tick.textContent)).toEqual(['₹1,00,000', '₹12,00,000']);
    for (const tick of ticks) expect(tick.getAttribute('x')).toBe('100%');
  });

  it('proves every amount with its receipt and offers the weeks as a table', () => {
    const { container } = render(<CashLine data={cash} />);
    expect(container.querySelectorAll('[data-receipt]')).toHaveLength(1);
    const table = container.querySelector('details table')!;
    const row = within(table as HTMLElement).getByRole('row', { name: /Week of 26 Oct/ });
    expect(row.textContent).toContain('₹1,50,000');
    assertInkRules();
  });

  it('can be a model estimate instead, with no receipt', () => {
    const { container } = render(<CashLine data={{ ...cash, proof: { estimate: true } }} />);
    expect(container.querySelector('[data-figure-group] [data-estimate]')).not.toBeNull();
    expect(container.querySelector('[data-receipt]')).toBeNull();
    assertInkRules();
  });
});

describe('every chart, through axe', () => {
  it('has no violations, with every data table open', async () => {
    const { container } = render(
      <main>
        <GoalBar data={goal} />
        <GoalBarKey ready={<Figure value="₹4,000" receiptId="R-0001" tone="dark" />} />
        <MiniBars heights={[300, 1000]} />
        <MiniBars heights={[300, 1000]} label="Jobs per day: 3, then 10 so far today" />
        <BarChart kind="money" series={[months, out]} label="Money in and out by month" proof={{ receiptId: 'R-0102' }} ticks={[{ permille: 500, label: '₹50,000' }]} />
        <BarChart kind="count" layout="ranked" series={[jobs]} label="Jobs by department" />
        <AgingBar data={aging} />
        <SplitBar data={split} />
        <CashLine data={cash} />
      </main>,
    );
    for (const details of container.querySelectorAll('details')) details.setAttribute('open', '');
    const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } }, resultTypes: ['violations'] });
    expect(result.violations.flatMap((v) => v.nodes.map((node) => `${v.id}: ${v.help} at ${node.target.join(' ')}`))).toEqual([]);
    assertInkRules();
  });
});

describe('ChartData', () => {
  it('is a closed details whose summary says View chart data, holding a table of the strings it is given', () => {
    const { container } = render(
      <ChartData
        caption="Jobs per week"
        columns={['Jobs']}
        rows={[{ key: 'a', heading: '5 Oct', cells: ['4'] }, { key: 'b', heading: '12 Oct', cells: ['6'] }]}
      />,
    );
    const details = container.querySelector('details')!;
    expect(details.hasAttribute('open')).toBe(false);
    expect(details.querySelector('summary')!.textContent).toBe('View chart data');
    const table = within(details).getByRole('table', { name: 'Jobs per week' });
    expect(within(table).getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual(['5 Oct', '12 Oct']);
    expect(within(table).getAllByRole('cell').map((cell) => cell.textContent)).toContain('6');
  });

  it('speaks Hindi in a Hindi app', () => {
    const { container } = render(<TextProvider language="hi"><AgingBar data={aging} /></TextProvider>);
    expect(container.querySelector('summary')!.textContent).toBe('चार्ट का डेटा देखें');
  });
});
