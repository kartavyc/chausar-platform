import { act, render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { LoadingPlace, useArrived } from '../../src/parts/Skeleton';

it('marks arrival when content lands after the skeleton timer at the same deadline', () => {
  vi.useFakeTimers();
  const timeout = globalThis.setTimeout;
  let timers = 0;
  vi.spyOn(globalThis, 'setTimeout').mockImplementation((handler, delay, ...args) => timeout(handler, delay === 150 && ++timers === 2 ? 151 : delay, ...args));
  function Page({ loading }: { loading: boolean }) {
    const arrived = useArrived(loading);
    return <div data-arrived={arrived ? '' : undefined}><LoadingPlace loading={loading} shape="cards" /></div>;
  }
  try {
    const { container, rerender } = render(<Page loading />);
    act(() => { vi.advanceTimersToNextTimer(); });
    expect(container.querySelector('[data-skeleton]')).not.toBeNull();
    rerender(<Page loading={false} />);
    expect(container.querySelector('[data-arrived]')).not.toBeNull();
  } finally { vi.restoreAllMocks(); vi.useRealTimers(); }
});


it('a quick load never marks arrival, including after an earlier slow load', () => {
  vi.useFakeTimers();
  function Page({ loading }: { loading: boolean }) {
    const arrived = useArrived(loading);
    return <div data-arrived={arrived ? '' : undefined}><LoadingPlace loading={loading} shape="cards" /></div>;
  }
  try {
    const { container, rerender } = render(<Page loading />);
    act(() => { vi.advanceTimersByTime(100); });
    rerender(<Page loading={false} />);
    expect(container.querySelector('[data-arrived]')).toBeNull();
    rerender(<Page loading />);
    act(() => { vi.advanceTimersByTime(151); });
    rerender(<Page loading={false} />);
    expect(container.querySelector('[data-arrived]')).not.toBeNull();
    rerender(<Page loading />);
    act(() => { vi.advanceTimersByTime(100); });
    rerender(<Page loading={false} />);
    expect(container.querySelector('[data-arrived]')).toBeNull();
  } finally { vi.useRealTimers(); }
});
