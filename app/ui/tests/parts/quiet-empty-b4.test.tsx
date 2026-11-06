// B4 task 6: nothing to filter, count or chart draws nothing. A row of zeros, a zero count and a lone bar are noise; an
// empty state says so in one line and may hold the one filled button. The proof rule is untouched: these parts leave a
// figure out together with its mark, never one without the other.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { FilterChips, type FilterOption } from '../../src/parts/FilterChips';
import { CountChip } from '../../src/parts/Chip';
import { Tabs } from '../../src/parts/Tabs';
import { BarChart, hasBars } from '../../src/parts/charts/BarChart';
import { MiniBars } from '../../src/parts/charts/MiniBars';
import { AgingBar, agingHasBars } from '../../src/parts/charts/AgingBar';
import { EmptyState } from '../../src/parts/EmptyState';
import type { AgingData, BarSeries } from '../../src/parts/charts/types';
import { TextProvider } from '../../src/text';
import { assertOnePrimary } from '../helpers/ink-rules';

const draw = (node: ReactNode) => render(<TextProvider language="en">{node}</TextProvider>);
const chips = (options: FilterOption[], value = 'all', more: { minItems?: number; drawCounts?: boolean } = {}) =>
  draw(<FilterChips label="Show" options={options} value={value} onChange={() => {}} {...more} />);
const names = () => within(screen.getByRole('group', { name: 'Show' })).getAllByRole('button').map((button) => button.textContent);

describe('FilterChips', () => {
  const zero: FilterOption[] = [{ id: 'all', label: 'All', count: 0 }, { id: 'done', label: 'Done', count: 0 }, { id: 'failed', label: 'Failed', count: '0' }];

  it('with every count zero, renders nothing', () => {
    const { container } = chips(zero);
    expect(container.querySelector('[role="group"]')).toBeNull();
  });

  it('with one non-zero, All and that chip only', () => {
    chips([{ id: 'all', label: 'All', count: 2 }, { id: 'done', label: 'Done', count: 2 }, { id: 'failed', label: 'Failed', count: 0 }]);
    expect(names()).toEqual(['All 2', 'Done 2']);
  });

  it('All alone, with everything else at zero, has nothing to choose between: no row', () => {
    const { container } = chips([{ id: 'all', label: 'All', count: 2 }, { id: 'failed', label: 'Failed', count: 0 }]);
    expect(container.querySelector('[role="group"]')).toBeNull();
  });

  it('a chip that is on stays while it is on, so the owner can see and leave it; its zero is not drawn', () => {
    chips([{ id: 'all', label: 'All', count: 2 }, { id: 'done', label: 'Done', count: 2 }, { id: 'failed', label: 'Failed', count: 0 }], 'failed');
    expect(names()).toEqual(['All 2', 'Done 2', 'Failed']);
  });

  it('options with no counts are all kept', () => {
    chips([{ id: 'a', label: 'October' }, { id: 'b', label: 'November' }], 'a');
    expect(names()).toEqual(['October', 'November']);
  });

  it('a chip with no count of its own keeps the row (a locked business, a page)', () => {
    chips([{ id: 'all', label: 'All', count: 0 }, { id: 'done', label: 'Done', count: 0 }, { id: 'ideas', label: 'Ideas' }]);
    expect(names()).toEqual(['All', 'Ideas']);
  });

  it('fewer than minItems items hides the row', () => {
    const options: FilterOption[] = [{ id: 'all', label: 'All', count: 2 }, { id: 'done', label: 'Done', count: 1 }, { id: 'failed', label: 'Failed', count: 1 }];
    const { container, unmount } = chips(options, 'all', { minItems: 3 });
    expect(container.querySelector('[role="group"]')).toBeNull();
    unmount();
    chips(options, 'all', { minItems: 2 });
    expect(names()).toEqual(['All 2', 'Done 1', 'Failed 1']);
  });

  it('counts can decide what shows without being drawn', () => {
    chips([{ id: 'all', label: 'All' }, { id: 'done', label: 'Done', count: 2 }, { id: 'failed', label: 'Failed', count: 0 }], 'all', { drawCounts: false });
    expect(names()).toEqual(['All', 'Done']);
  });

  it('a press still reaches the place', () => {
    const onChange = vi.fn();
    draw(<FilterChips label="Show" options={[{ id: 'all', label: 'All', count: 2 }, { id: 'done', label: 'Done', count: 2 }]} value="all" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Done 2' }));
    expect(onChange).toHaveBeenCalledWith('done');
  });
});

describe('counts', () => {
  it('CountChip 0 renders nothing, as a number or as words', () => {
    expect(render(<CountChip value={0} />).container.textContent).toBe('');
    expect(render(<CountChip value="0" label="0 people" />).container.textContent).toBe('');
    expect(render(<CountChip value={3} />).container.textContent).toBe('3');
  });

  it('Tabs draw no zero count on a tab', () => {
    draw(<Tabs mode="buttons" label="Tabs" value="runs" onChange={() => {}} items={[{ id: 'runs', label: 'Runs', count: 0 }, { id: 'notes', label: 'Notes', count: 2 }]} />);
    expect(screen.getByRole('button', { name: 'Runs' }).textContent).toBe('Runs');
    expect(screen.getByRole('button', { name: 'Notes 2' })).toBeTruthy();
  });
});

describe('charts with nothing to compare', () => {
  const series = (values: (number | null)[]): BarSeries => ({ label: 'Jobs', points: values.map((valuePermille, i) => ({ key: `k${i}`, label: `Week ${i}`, value: String(valuePermille), valuePermille })) });

  it('BarChart all zero renders nothing', () => {
    const { container } = draw(<BarChart kind="count" label="Jobs" series={[series([0, 0, 0])]} />);
    expect(container.textContent).toBe('');
    expect(hasBars(series([0, 0, 0]))).toBe(false);
  });

  it('BarChart with a single bucket renders nothing, in either layout', () => {
    const { container, unmount } = draw(<BarChart kind="count" label="Jobs" series={[series([1000])]} />);
    expect(container.textContent).toBe('');
    unmount();
    expect(draw(<BarChart kind="count" layout="ranked" label="Jobs" series={[series([1000])]} />).container.textContent).toBe('');
  });

  it('BarChart with no values at all renders nothing; with two buckets and one bar, it draws', () => {
    expect(hasBars(series([null, null]))).toBe(false);
    expect(hasBars(series([0, 500]))).toBe(true);
    const { container } = draw(<BarChart kind="count" label="Jobs" series={[series([0, 500])]} />);
    expect(container.querySelectorAll('[data-bar]').length).toBeGreaterThan(0);
  });

  it('two series: a bar in either one counts', () => {
    expect(hasBars(series([0, 0]), series([0, 300]))).toBe(true);
  });

  it('MiniBars all zero or a single bar renders nothing', () => {
    expect(render(<MiniBars heights={[0, 0, 0]} />).container.querySelector('svg')).toBeNull();
    expect(render(<MiniBars heights={[800]} />).container.querySelector('svg')).toBeNull();
    expect(render(<MiniBars heights={[800, 0]} />).container.querySelector('svg')).toBeTruthy();
  });

  const aging = (permilles: Partial<Record<'not-due' | '1-30' | '31-60', number>>): AgingData => ({
    label: 'Who owes you',
    proof: { receiptId: 'r-1' },
    buckets: (['not-due', '1-30', '31-60'] as const).map((id) => ({ id, label: id, permille: permilles[id] ?? 0, count: String(permilles[id] ? 1 : 0), amount: 'INR 10' })),
  });

  it('AgingBar with one bucket holding money renders nothing: one segment says nothing', () => {
    const data = aging({ 'not-due': 1000 });
    expect(agingHasBars(data)).toBe(false);
    expect(draw(<AgingBar data={data} />).container.textContent).toBe('');
  });

  it('AgingBar with nothing owed renders nothing; with two ages, it draws', () => {
    expect(draw(<AgingBar data={aging({})} />).container.textContent).toBe('');
    const data = aging({ 'not-due': 600, '1-30': 400 });
    expect(agingHasBars(data)).toBe(true);
    expect(draw(<AgingBar data={data} />).container.querySelectorAll('[data-bucket]').length).toBeGreaterThan(0);
  });
});

describe('EmptyState', () => {
  it('with `primary` holds one filled button, which acts', () => {
    const onSelect = vi.fn();
    const { container } = draw(<div data-card=""><EmptyState title="No bills yet." primary={{ label: 'Add a bill', onSelect }} /></div>);
    const button = screen.getByRole('button', { name: 'Add a bill' });
    expect(button.getAttribute('data-variant')).toBe('primary');
    expect(container.querySelectorAll('[data-variant="primary"]')).toHaveLength(1);
    assertOnePrimary(container);
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('with no `primary` holds no filled button', () => {
    const { container } = draw(<EmptyState title="No bills yet." actions={[{ label: 'Read more', href: '#/x' }]} />);
    expect(container.querySelector('[data-variant="primary"]')).toBeNull();
  });
});
