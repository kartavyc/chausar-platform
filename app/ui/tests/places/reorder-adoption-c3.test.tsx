import { expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StoriesRow, type Story } from '../../src/parts/StoriesRow';
import { TextProvider } from '../../src/text';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';

it('new agents arrive while existing agent buttons keep their nodes after reorder', () => {
  const stories: Story[] = [{ id: 'editor', name: 'Editor', state: 'idle' }];
  const view = render(<TextProvider language="en"><StoriesRow stories={stories} onOpen={() => {}} /></TextProvider>);
  const editor = screen.getByRole('button', { name: /Editor/ });
  expect(view.container.querySelector('[data-arriving]')).toBeNull();
  view.rerender(<TextProvider language="en"><StoriesRow stories={[{ id: 'writer', name: 'Writer', state: 'working' }, ...stories]} onOpen={() => {}} /></TextProvider>);
  expect(screen.getByRole('button', { name: /Writer/ }).closest('li')!.hasAttribute('data-arriving')).toBe(true);
  expect(screen.getByRole('button', { name: /Editor/ })).toBe(editor);
  expect(editor.closest('li')!.dataset.flipId).toBe('editor');
});

it('Arrange moves the same keyed row and keeps its focusable controls', async () => {
  window.location.hash = '#/today?sheet=layout:today';
  render(<App client={createFakeClient(new FakeEngine())} language="en" />);
  const sheet = await screen.findByRole('complementary', { name: 'Arrange Today' });
  const earlier = await within(sheet).findByRole('listitem', { name: 'Earlier' });
  const order = () => [...earlier.parentElement!.children].map(row => row.getAttribute('aria-label'));
  const before = order().indexOf('Earlier');
  await act(async () => { fireEvent.click(within(earlier).getByRole('button', { name: 'Move Earlier up' })); });
  await waitFor(() => expect(order().indexOf('Earlier')).toBeLessThan(before));
  expect(within(sheet).getByRole('listitem', { name: 'Earlier' })).toBe(earlier);
  expect(earlier.dataset.flipId).toBe('earlier');
});

it('a new business fact arrives after it is kept', async () => {
  window.location.hash = '#/business/knowledge';
  render(<App client={createFakeClient(new FakeEngine())} language="en" />);
  const summary = await screen.findByText('Add', { selector: 'summary' });
  await act(async () => { fireEvent.click(summary); });
  const fold = summary.closest('details')!;
  fireEvent.click(within(fold).getByRole('radio', { name: 'Fact' }));
  fireEvent.change(within(fold).getByLabelText('Topic'), { target: { value: 'Calls' } });
  fireEvent.change(within(fold).getByLabelText('The fact'), { target: { value: 'After 4 pm.' } });
  await act(async () => { fireEvent.click(within(fold).getByRole('button', { name: 'Keep fact' })); });
  const fact = (await screen.findByText('After 4 pm.')).closest('li')!;
  expect(fact.hasAttribute('data-arriving')).toBe(true);
});
