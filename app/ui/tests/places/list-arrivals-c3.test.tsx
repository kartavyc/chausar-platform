import { expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { HistoryList, TimelineList } from '../../src/places/clients/CrmParts';
import { TextProvider } from '../../src/text';
import type { FieldChangeView, TimelineEntryView } from '../../src/engine/types';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';

const history = (id: string): FieldChangeView => ({ id, subject: 'c-boat', field: 'name', label: 'Name', who: 'you', at: '2026-11-06T10:00:00Z', line: `Changed ${id}`, before: null, after: id });
const entry = (id: string): TimelineEntryView => ({ id, kind: 'call', on: '2026-11-06', at: '2026-11-06T10:00:00Z', line: `Logged ${id}`, text: null, clientId: 'c-boat' });

it('client field history stays still at first load and marks only a newly recorded row', () => {
  const view = render(<TextProvider language="en"><HistoryList rows={[history('old')]} /></TextProvider>);
  const old = view.container.querySelector('li')!;
  expect(view.container.querySelector('[data-arriving]')).toBeNull();
  view.rerender(<TextProvider language="en"><HistoryList rows={[history('new'), history('old')]} /></TextProvider>);
  expect(view.container.querySelector('[data-arriving]')?.textContent).toContain('Changed new');
  expect(view.container.querySelectorAll('[data-arriving]')).toHaveLength(1);
  expect(view.container.querySelectorAll('li')[1]).toBe(old);
});

it('a new timeline entry arrives without replaying the existing entries', () => {
  const view = render(<TextProvider language="en"><TimelineList entries={[entry('old')]} /></TextProvider>);
  const old = view.container.querySelector('li')!;
  expect(view.container.querySelector('[data-arriving]')).toBeNull();
  view.rerender(<TextProvider language="en"><TimelineList entries={[entry('new'), entry('old')]} /></TextProvider>);
  expect(view.container.querySelector('[data-arriving]')?.textContent).toContain('Logged new');
  expect(view.container.querySelectorAll('[data-arriving]')).toHaveLength(1);
  expect(view.container.querySelectorAll('li')[1]).toBe(old);
});

it('a new backup arrives after the engine records it', async () => {
  window.location.hash = '#/business/keep';
  render(<App client={createFakeClient(new FakeEngine())} language="en" />);
  const button = await screen.findByRole('button', { name: 'Back up now' });
  expect(document.querySelector('[data-backup][data-arriving]')).toBeNull();
  await act(async () => { fireEvent.click(button); });
  await waitFor(() => expect(document.querySelector('[data-backup][data-arriving]')).not.toBeNull());
});

it('a business source arrives after Add without replaying older sources', async () => {
  window.location.hash = '#/business/knowledge';
  render(<App client={createFakeClient(new FakeEngine())} language="en" />);
  const summary = await screen.findByText('Add', { selector: 'summary' });
  await act(async () => { fireEvent.click(summary); });
  const fold = summary.closest('details')!;
  fireEvent.change(within(fold).getByLabelText('Title'), { target: { value: 'Opening hours' } });
  fireEvent.change(within(fold).getByLabelText('The words'), { target: { value: 'Calls after 4 pm.' } });
  await act(async () => { fireEvent.click(within(fold).getByRole('button', { name: 'Add' })); });
  const source = (await screen.findByText('Opening hours', { selector: '[data-source-title]' })).closest('li')!;
  expect(source.hasAttribute('data-arriving')).toBe(true);
});
