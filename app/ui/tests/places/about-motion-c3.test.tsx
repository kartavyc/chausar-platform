import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AboutYou } from '../../src/places/onboarding/AboutYou';
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

async function start() {
  const client = createFakeClient(new FakeEngine({ fresh: true }));
  const request = client.request.bind(client);
  client.request = ((method, params) => method === 'venture.about.read' ? Promise.resolve({
    family: { id: 'creative', label: 'Creative work', line: 'Design, photos, video and writing.' },
    offers: [{ name: 'Shop photos', line: 'Photos of what a shop sells.' }],
    country: null, evidence: null, idea: 'Photography for shops in Pune', source: 'ai',
  }) : request(method, params as never)) as typeof client.request;
  const view = render(<EngineProvider client={client}><TextProvider language="en"><AboutYou connected onKeep={() => {}} /></TextProvider></EngineProvider>);
  expect(view.container.querySelector('[data-changed]')).toBeNull();
  const box = view.container.querySelector('textarea')!;
  fireEvent.change(box, { target: { value: 'I take photos for small shops in Pune.' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
  await screen.findByRole('checkbox', { name: 'Shop photos' });
  return view;
}

it('marks the field filled by the answer once, then clears it', async () => {
  await start();
  const field = screen.getByRole('combobox', { name: 'Field' });
  expect(field.hasAttribute('data-changed')).toBe(true);
  await waitFor(() => expect(field.hasAttribute('data-changed')).toBe(false));
});

it.each(['on', 'off'])('animations %s: a removed offer closes into its Undo line and comes back in place', async motion => {
  document.documentElement.dataset.motion = motion;
  const { container } = await start();
  const checkbox = screen.getByRole('checkbox', { name: 'Shop photos' });
  const row = checkbox.closest('li')!;
  fireEvent.click(checkbox);
  expect(screen.getByText('Shop photos: removed.').closest('li')).toBe(row);
  if (motion === 'on') {
    const closing = row.querySelector('[data-open="false"]');
    expect(closing).not.toBeNull();
    expect(closing!.hasAttribute('inert')).toBe(true);
    fireEvent.transitionEnd(closing!);
  }
  expect(row.querySelector('input[type="checkbox"]')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  expect(screen.getByRole('checkbox', { name: 'Shop photos' }).closest('li')).toBe(row);
  if (motion === 'off') expect(container.querySelector('[data-changed]')).toBeNull();
});
