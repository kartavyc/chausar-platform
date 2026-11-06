import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SettingsList } from '../../src/places/business/SettingsList';
import { SETTINGS } from '../../src/shell/settings';
import { ChiefThread } from '../../src/places/chats/ChiefThread';
import { EngineProvider } from '../../src/engine/context';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { TextProvider } from '../../src/text';
import { ClockProvider } from '../../src/shell/clock';

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

it.each(['on', 'off'])('animations %s: Settings search retires old links and restores arrivals without replacing matches', motion => {
  document.documentElement.dataset.motion = motion;
  const { container } = render(<TextProvider language="en"><SettingsList groups={SETTINGS} current="plan" /></TextProvider>);
  expect(container.querySelector('[data-arriving]')).toBeNull();
  const removed = container.querySelector('a[href="#/business/owner"]')!.closest('li')!;
  const kept = container.querySelector('a[href="#/business/prices"]')!.closest('li')!;
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'prices' } });
  expect(container.querySelector('a[href="#/business/prices"]')!.closest('li')).toBe(kept);
  if (motion === 'on') {
    expect(removed.isConnected).toBe(true);
    expect(removed.hasAttribute('data-leaving')).toBe(true);
    expect(removed.hasAttribute('inert')).toBe(true);
    fireEvent.transitionEnd(removed);
  }
  expect(removed.isConnected).toBe(false);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
  const restored = container.querySelector('a[href="#/business/owner"]')!.closest('li')!;
  expect(restored.hasAttribute('data-arriving')).toBe(motion === 'on');
});

it.each(['on', 'off'])('animations %s: a handoff highlights the unsent composer once without sending', async motion => {
  document.documentElement.dataset.motion = motion;
  const client = createFakeClient(new FakeEngine());
  const request = vi.spyOn(client, 'request');
  const view = (ask: { words: string; n: number; send: boolean } | null) => <EngineProvider client={client}><TextProvider language="en"><ClockProvider now={() => new Date('2026-11-06T12:00:00Z')}><ChiefThread threadId={undefined} ask={ask} onAskTaken={() => {}} onListChanged={() => {}} phone={false} /></ClockProvider></TextProvider></EngineProvider>;
  const { container, rerender } = render(view(null));
  expect(container.querySelector('[data-changed]')).toBeNull();
  rerender(view({ words: 'Help me plan the next week.', n: 1, send: false }));
  const box = await screen.findByRole('textbox', { name: 'Ask Chausar' });
  await waitFor(() => expect((box as HTMLTextAreaElement).value).toBe('Help me plan the next week.'));
  expect(box.closest('[data-changed]') !== null).toBe(motion === 'on');
  expect(request.mock.calls.some(([method]) => method === 'venture.chief.thread.send')).toBe(false);
  await waitFor(() => expect(container.querySelector('[data-changed]')).toBeNull());
});
