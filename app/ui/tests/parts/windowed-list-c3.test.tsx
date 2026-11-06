import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { WindowedList } from '../../src/parts/WindowedList';

/** One-shot C3 task 16: a long list keeps few rows in the page, stays one list to a reader, and every row can be reached. */
const ROWS = Array.from({ length: 1000 }, (_, index) => ({ id: `p${index}`, name: `Person ${index + 1}` }));

function start() {
  render(<WindowedList items={ROWS} keyOf={(row) => row.id} rowHeight={44} label="People" renderRow={(row) => <span>{row.name}</span>} />);
  return screen.getByRole('list', { name: 'People' });
}

describe('WindowedList', () => {
  it('1,000 rows keep under 60 in the DOM, with the right set size and position', () => {
    start();
    const rows = screen.getAllByRole('listitem');
    expect(rows.length).toBeLessThan(60);
    expect(rows[0]!.getAttribute('aria-setsize')).toBe('1000');
    expect(rows[0]!.getAttribute('aria-posinset')).toBe('1');
    expect(rows[1]!.getAttribute('aria-posinset')).toBe('2');
  });

  it('End reaches the last row; the draw follows the scroll, and a focused row stays drawn', async () => {
    const list = start();
    const firstRow = screen.getAllByRole('listitem')[0]!;
    firstRow.focus();
    await act(async () => {
      fireEvent.keyDown(firstRow, { key: 'End' });
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(screen.getByText('Person 1000')).toBeTruthy();
    expect(document.activeElement?.getAttribute('aria-posinset')).toBe('1000');
    await act(async () => {
      list.scrollTop = 0;
      fireEvent.scroll(list);
    });
    expect(screen.getByText('Person 1')).toBeTruthy();
    expect(screen.getByText('Person 1000')).toBeTruthy();
    expect(screen.getAllByRole('listitem').length).toBeLessThan(62);
  });

  it('Arrow keys walk the rows', async () => {
    start();
    const firstRow = screen.getAllByRole('listitem')[0]!;
    firstRow.focus();
    await act(async () => {
      fireEvent.keyDown(firstRow, { key: 'ArrowDown' });
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(document.activeElement?.getAttribute('aria-posinset')).toBe('2');
  });
});
