import { expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { HistoryList, TimelineList } from '../../src/places/clients/CrmParts';
import { TextProvider } from '../../src/text';
import type { FieldChangeView, TimelineEntryView } from '../../src/engine/types';

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
