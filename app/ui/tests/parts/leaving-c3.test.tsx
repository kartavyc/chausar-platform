import { afterEach, describe, expect, it } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import { useRef } from 'react';
import { staggerClass, useAfterLeave, useLeaveEnd, useLeavingList } from '../../src/parts/useLeaving';
import { flipFrom, measureRows } from '../../src/parts/flip';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** One-shot C3 task 13: an item gone from the data stays until its leave ends; arrivals stagger for the first five. */
afterEach(() => { delete document.documentElement.dataset.motion; });

const keyOf = (item: string) => item;

function List({ items }: { items: string[] }) {
  const { drawn, left } = useLeavingList(items, keyOf);
  return (
    <ul>
      {drawn.map((row) => <Row key={row.key} name={row.key} leaving={row.leaving} arriving={row.arriving} done={() => left(row.key)} />)}
    </ul>
  );
}
function Row({ name, leaving, arriving, done }: { name: string; leaving: boolean; arriving: boolean; done: () => void }) {
  const ref = useRef<HTMLLIElement>(null);
  useLeaveEnd(ref, leaving, done);
  return <li ref={ref} data-testid={name} data-leaving={leaving ? '' : undefined} data-arriving={arriving ? '' : undefined}>{name}</li>;
}

describe('useLeavingList', () => {
  it('nothing leaves or arrives at first render', () => {
    render(<List items={['a', 'b']} />);
    expect(document.querySelector('[data-leaving]')).toBeNull();
    expect(document.querySelector('[data-arriving]')).toBeNull();
  });

  it('a removed item stays where it stood, leaving, and goes when its leave ends (at once here: jsdom has no exit time)', () => {
    const { result, rerender } = renderHook(({ items }) => useLeavingList(items, keyOf), { initialProps: { items: ['a', 'b', 'c'] } });
    rerender({ items: ['a', 'c'] });
    expect(result.current.drawn.map((row) => [row.key, row.leaving])).toEqual([['a', false], ['b', true], ['c', false]]);
    act(() => result.current.left('b'));
    expect(result.current.drawn.map((row) => row.key)).toEqual(['a', 'c']);
  });

  it('with animations off it is gone at once', () => {
    document.documentElement.dataset.motion = 'off';
    const { result, rerender } = renderHook(({ items }) => useLeavingList(items, keyOf), { initialProps: { items: ['a', 'b'] } });
    rerender({ items: ['a'] });
    expect(result.current.drawn.map((row) => row.key)).toEqual(['a']);
  });

  it('an item that comes back while leaving is simply there again', () => {
    const { result, rerender } = renderHook(({ items }) => useLeavingList(items, keyOf), { initialProps: { items: ['a', 'b'] } });
    rerender({ items: ['a'] });
    expect(result.current.drawn.find((row) => row.key === 'b')?.leaving).toBe(true);
    rerender({ items: ['a', 'b'] });
    expect(result.current.drawn.find((row) => row.key === 'b')?.leaving).toBe(false);
  });

  it('an item new after the first render arrives', () => {
    const { rerender } = render(<List items={['a']} />);
    rerender(<List items={['a', 'b']} />);
    expect(screen.getByTestId('b').hasAttribute('data-arriving')).toBe(true);
    expect(screen.getByTestId('a').hasAttribute('data-arriving')).toBe(false);
  });
});

describe('the stagger and the held count', () => {
  it('the first five get a place class, and none past the fifth', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(staggerClass)).toEqual(['i0', 'i1', 'i2', 'i3', 'i4', undefined, undefined]);
  });

  it('useAfterLeave keeps the count until the leave ends', () => {
    const { result, rerender } = renderHook(({ value, holding }) => useAfterLeave(value, holding), { initialProps: { value: 5, holding: false } });
    rerender({ value: 4, holding: true });
    expect(result.current).toBe(5);
    rerender({ value: 4, holding: false });
    expect(result.current).toBe(4);
  });

  it('the CSS leaves on the exit time, closes on the settle time, rises on the sheet time, and staggers on --t-stagger', () => {
    const css = readFileSync(join(import.meta.dirname, '../../src/parts/Leave.module.css'), 'utf8');
    expect(css).toMatch(/\.row\[data-leaving\]\s*\{[^}]*opacity var\(--t-exit\) var\(--ease-exit\)[^}]*grid-template-rows var\(--t-settle\)/);
    expect(css).toMatch(/@starting-style\s*\{\s*\.row\[data-arriving\]/);
    expect(css).toMatch(/\.row\.i4\s*\{[^}]*calc\(var\(--t-stagger\) \* 4\)/);
    expect(css).not.toMatch(/\.i5/);
  });
});

describe('flip', () => {
  function rowAt(top: number, id: string) {
    const element = document.createElement('div');
    element.dataset.flipId = id;
    element.getBoundingClientRect = () => ({ top, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) });
    return element;
  }
  it('a row starts from where it stood with the inverse transform, cleared on the next frame', async () => {
    const box = document.createElement('div');
    const row = rowAt(100, 'a');
    box.append(row);
    const before = new Map([['a', { top: 40, left: 0 } as DOMRect]]);
    flipFrom(box, before);
    expect(row.style.transform).toBe('translate(0px, -60px)');
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(row.style.transform).toBe('');
    expect(measureRows(box).get('a')?.top).toBe(100);
  });
  it('none with animations off', () => {
    document.documentElement.dataset.motion = 'off';
    const box = document.createElement('div');
    const row = rowAt(100, 'a');
    box.append(row);
    flipFrom(box, new Map([['a', { top: 40, left: 0 } as DOMRect]]));
    expect(row.style.transform).toBe('');
  });
});
