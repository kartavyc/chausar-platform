import { afterEach, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useArrivals } from '../../src/parts/useArrivals';

afterEach(() => { delete document.documentElement.dataset.motion; });

it('waits for the first loaded keys before recognizing arrivals', () => {
  const view = renderHook(({ keys }: { keys: string[] | undefined }) => useArrivals(keys), { initialProps: { keys: undefined as string[] | undefined } });
  view.rerender({ keys: ['existing'] });
  expect([...view.result.current]).toEqual([]);
  view.rerender({ keys: ['new', 'existing'] });
  expect([...view.result.current]).toEqual(['new']);
  view.rerender({ keys: ['new', 'existing'] });
  expect([...view.result.current]).toEqual([]);
});

it('keeps new rows still with animations off', () => {
  document.documentElement.dataset.motion = 'off';
  const view = renderHook(({ keys }) => useArrivals(keys), { initialProps: { keys: ['existing'] } });
  view.rerender({ keys: ['new', 'existing'] });
  expect([...view.result.current]).toEqual([]);
});

it('a loading boundary resets the first draw for the next client or business', () => {
  const view = renderHook(({ keys }: { keys: string[] | undefined }) => useArrivals(keys), { initialProps: { keys: ['old-business'] as string[] | undefined } });
  view.rerender({ keys: undefined });
  view.rerender({ keys: ['new-business'] });
  expect([...view.result.current]).toEqual([]);
  view.rerender({ keys: ['new-row', 'new-business'] });
  expect([...view.result.current]).toEqual(['new-row']);
});
