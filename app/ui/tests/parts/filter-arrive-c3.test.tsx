import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FilterChips } from '../../src/parts/FilterChips';
import { TextProvider } from '../../src/text';

const styleOf = window.getComputedStyle.bind(window);
beforeEach(() => {
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
    const style = styleOf(element, pseudo);
    if (!element.hasAttribute('data-leaving')) return style;
    return new Proxy(style, { get(target, key) {
      if (key === 'transitionDuration') return '140ms';
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
  });
});
afterEach(() => { vi.restoreAllMocks(); delete document.documentElement.dataset.motion; });

const view = (ids: string[], change = () => {}) => <TextProvider language="en"><FilterChips label="Show" options={ids.map(id => ({ id, label: id }))} value="all" onChange={change} /></TextProvider>;

it('keeps a leaving choice inert until its exit ends, keeps surviving nodes and marks only new arrivals', () => {
  const change = vi.fn();
  const { container, rerender } = render(view(['all', 'a', 'b'], change));
  expect(container.querySelector('[data-arriving]')).toBeNull();
  const old = screen.getByRole('button', { name: 'a' });
  const kept = screen.getByRole('button', { name: 'b' });
  rerender(view(['all', 'b', 'c'], change));
  expect(old.isConnected).toBe(true);
  expect(old.hasAttribute('data-leaving')).toBe(true);
  expect(old.hasAttribute('inert')).toBe(true);
  expect(old.getAttribute('aria-hidden')).toBe('true');
  fireEvent.click(old);
  expect(change).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'b' })).toBe(kept);
  expect(kept.dataset.flipId).toBe('b');
  expect(screen.getByRole('button', { name: 'c' }).hasAttribute('data-arriving')).toBe(true);
  fireEvent.transitionEnd(old);
  expect(old.isConnected).toBe(false);
});

it('removes a choice immediately with animations off', () => {
  document.documentElement.dataset.motion = 'off';
  const { container, rerender } = render(view(['all', 'a']));
  const old = screen.getByRole('button', { name: 'a' });
  rerender(view(['all', 'b']));
  expect(old.isConnected).toBe(false);
  expect(container.querySelector('[data-arriving], [data-leaving]')).toBeNull();
});
