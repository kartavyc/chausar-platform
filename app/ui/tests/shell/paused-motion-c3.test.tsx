import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PausedNote } from '../../src/shell/PausedNote';
import { EngineProvider } from '../../src/engine/context';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { TextProvider } from '../../src/text';

const styleOf = window.getComputedStyle.bind(window);
beforeEach(() => {
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
    const style = styleOf(element, pseudo);
    if (element.getAttribute('data-open') !== 'false') return style;
    return new Proxy(style, { get(target, key) {
      if (key === 'transitionDuration') return '140ms';
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
  });
});
afterEach(() => { vi.restoreAllMocks(); delete document.documentElement.dataset.motion; });

it.each(['on', 'off'])('animations %s: the paused line closes only after the engine accepts Unpause', async motion => {
  document.documentElement.dataset.motion = motion;
  const client = createFakeClient(new FakeEngine());
  await client.request('venture.business.pause', { paused: true });
  const request = client.request.bind(client);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  client.request = (async (method, params) => {
    if (method === 'venture.business.pause') await held;
    return request(method, params as never);
  }) as typeof client.request;
  const { container } = render(<EngineProvider client={client}><TextProvider language="en"><PausedNote /></TextProvider></EngineProvider>);
  const opener = await screen.findByRole('button', { name: 'Unpause' });
  await act(async () => { fireEvent.click(opener); });
  expect(container.querySelector('[data-paused]')).not.toBeNull();
  expect(container.querySelector('[data-open="false"]')).toBeNull();
  await act(async () => { release(); });
  await screen.findByText('Unpaused. Stopped jobs stay stopped until you resume them.');
  if (motion === 'on') {
    const closing = container.querySelector('[data-open="false"]');
    expect(closing).not.toBeNull();
    expect(closing!.hasAttribute('inert')).toBe(true);
    expect(closing!.querySelector('[data-paused]')).not.toBeNull();
    fireEvent.transitionEnd(closing!);
  }
  await waitFor(() => expect(container.querySelector('[data-paused]')).toBeNull());
});
