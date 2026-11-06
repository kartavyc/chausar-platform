import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { motionOff, scrollToView, useMotionOff, usePresence, withViewTransition } from '../../src/parts/motion';

/** A matchMedia stand-in whose reduce-motion answer a test can change, with its change listeners. */
function stubReduce(initial: boolean) {
  let matches = initial;
  const listeners = new Set<() => void>();
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    get matches() { return query.includes('prefers-reduced-motion') ? matches : false; },
    media: query, onchange: null,
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
    addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }) as unknown as MediaQueryList);
  return { set(next: boolean) { matches = next; for (const l of listeners) l(); } };
}

type Doc = { startViewTransition?: unknown };
function stubTransitions() {
  const calls: number[] = [];
  (document as unknown as Doc).startViewTransition = (update: () => void) => {
    calls.push(1);
    update();
    return { finished: Promise.resolve(), updateCallbackDone: Promise.resolve() };
  };
  return calls;
}

beforeEach(() => {
  delete document.documentElement.dataset.motion;
});
afterEach(() => {
  delete (document as unknown as Doc).startViewTransition;
  delete document.documentElement.dataset.motion;
  vi.useRealTimers();
});

describe('motionOff (one-shot C3 task 2)', () => {
  it('is off under the computer’s reduce-motion setting and under the owner’s data-motion="off"', () => {
    stubReduce(false);
    expect(motionOff()).toBe(false);
    document.documentElement.dataset.motion = 'off';
    expect(motionOff()).toBe(true);
    delete document.documentElement.dataset.motion;
    stubReduce(true);
    expect(motionOff()).toBe(true);
  });

  it('useMotionOff follows both settings as they change', async () => {
    const reduce = stubReduce(false);
    const { result } = renderHook(() => useMotionOff());
    expect(result.current).toBe(false);
    act(() => reduce.set(true));
    expect(result.current).toBe(true);
    act(() => reduce.set(false));
    expect(result.current).toBe(false);
    await act(async () => {
      document.documentElement.dataset.motion = 'off';
      await Promise.resolve();
    });
    expect(result.current).toBe(true);
  });
});

describe('withViewTransition', () => {
  it('runs the update inside one view transition when motion is on', async () => {
    stubReduce(false);
    const calls = stubTransitions();
    const update = vi.fn();
    await withViewTransition(update);
    expect(calls).toHaveLength(1);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('runs the update directly and starts nothing when motion is off, or when the browser has no transitions', async () => {
    stubReduce(false);
    const calls = stubTransitions();
    document.documentElement.dataset.motion = 'off';
    const update = vi.fn();
    await withViewTransition(update);
    expect(update).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
    delete document.documentElement.dataset.motion;
    delete (document as unknown as Doc).startViewTransition;
    await withViewTransition(update);
    expect(update).toHaveBeenCalledTimes(2);
  });
});

describe('scrollToView', () => {
  it('is smooth only when motion is on', () => {
    stubReduce(false);
    const element = document.createElement('div');
    const scroll = vi.fn();
    element.scrollIntoView = scroll;
    scrollToView(element);
    expect(scroll).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: 'smooth' }));
    document.documentElement.dataset.motion = 'off';
    scrollToView(element);
    expect(scroll).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: 'auto' }));
  });
});

/** A box that closes with a 140 ms exit (an inline time, which jsdom computes like a stylesheet's). */
function Box({ initial = true }: { initial?: boolean }) {
  const [open, setOpen] = useState(initial);
  const ref = useRef<HTMLDivElement>(null);
  const { mounted, state } = usePresence(open, ref);
  return (
    <>
      <button type="button" onClick={() => setOpen((o) => !o)}>Toggle</button>
      {mounted && <div ref={ref} data-testid="box" data-state={state} style={{ transitionDuration: '140ms' }}>Inside</div>}
    </>
  );
}

describe('usePresence', () => {
  it('keeps the child while it closes and drops it on its transitionend', () => {
    stubReduce(false);
    render(<Box />);
    fireEvent.click(screen.getByText('Toggle'));
    const box = screen.getByTestId('box');
    expect(box.dataset.state).toBe('closing');
    fireEvent.transitionEnd(box);
    expect(screen.queryByTestId('box')).toBeNull();
  });

  it('drops it at once when motion is off', () => {
    stubReduce(false);
    document.documentElement.dataset.motion = 'off';
    render(<Box />);
    fireEvent.click(screen.getByText('Toggle'));
    expect(screen.queryByTestId('box')).toBeNull();
  });

  it('drops it on the fallback timer when the end event never comes', () => {
    vi.useFakeTimers();
    stubReduce(false);
    render(<Box />);
    fireEvent.click(screen.getByText('Toggle'));
    expect(screen.getByTestId('box').dataset.state).toBe('closing');
    act(() => { vi.advanceTimersByTime(100); });
    expect(screen.getByTestId('box')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.queryByTestId('box')).toBeNull();
  });

  it('opening again while it closes keeps the same element, open', () => {
    stubReduce(false);
    render(<Box />);
    const before = screen.getByTestId('box');
    fireEvent.click(screen.getByText('Toggle'));
    fireEvent.click(screen.getByText('Toggle'));
    expect(screen.getByTestId('box')).toBe(before);
    expect(before.dataset.state).toBe('open');
  });

  it('never moves at first render: a thing that starts open is simply there', () => {
    stubReduce(false);
    render(<Box />);
    expect(screen.getByTestId('box').dataset.state).toBe('open');
  });
});
