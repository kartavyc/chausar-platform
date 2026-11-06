import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';

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

it.each(['on', 'off'])('animations %s: Today Hide closes the block and Undo grows it back', async motion => {
  document.documentElement.dataset.motion = motion;
  const engine = new FakeEngine();
  window.location.hash = '#/today';
  const { container } = render(<App client={createFakeClient(engine)} language="en" />);
  await screen.findByRole('heading', { level: 1 });
  await screen.findByRole('region', { name: 'Needs you' });
  const before = container.querySelector('[data-block="ideas"]')!;
  expect(before).not.toBeNull();
  await act(async () => { engine.layoutDesk.ai({ place: 'today', change: { op: 'hide', block: 'ideas' } }); });
  const notice = await screen.findByRole('status', { name: 'Layout change' });
  if (motion === 'on') {
    expect(before.isConnected).toBe(true);
    expect(before.hasAttribute('data-leaving')).toBe(true);
    expect(before.hasAttribute('inert')).toBe(true);
    fireEvent.transitionEnd(before);
  }
  await waitFor(() => expect(container.querySelector('[data-block="ideas"]')).toBeNull());
  await act(async () => { fireEvent.click(within(notice).getByRole('button', { name: 'Undo' })); });
  await waitFor(() => expect(container.querySelector('[data-block="ideas"]')).not.toBeNull());
  const restored = container.querySelector('[data-block="ideas"]')!;
  expect(restored.hasAttribute('data-arriving')).toBe(motion === 'on');
});
