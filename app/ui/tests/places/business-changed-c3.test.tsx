import { expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';

function open(page: string) {
  window.location.hash = `#/business/${page}`;
  const client = createFakeClient(new FakeEngine());
  render(<App client={client} language="en" />);
  return client;
}
const press = async (button: HTMLElement) => { await act(async () => { fireEvent.click(button); }); };

it('a saved price marks its existing offer only after the answer lands', async () => {
  open('prices');
  const field = (await screen.findAllByRole('textbox', { name: 'New price' }))[0]!;
  const row = field.closest('li')!;
  expect(row.hasAttribute('data-changed')).toBe(false);
  fireEvent.change(field, { target: { value: '12500' } });
  expect(row.hasAttribute('data-changed')).toBe(false);
  await press(within(row).getByRole('button', { name: 'Save price' }));
  await waitFor(() => expect(row.hasAttribute('data-changed')).toBe(true));
  expect(document.querySelectorAll('li[data-changed]')).toHaveLength(1);
});

it('a changed plan line is marked once while unchanged lines stay still', async () => {
  open('plan');
  const button = await screen.findByRole('button', { name: 'Change plan' });
  expect(document.querySelector('[data-changed]')).toBeNull();
  await press(button);
  fireEvent.change(screen.getByLabelText('One line'), { target: { value: 'Audio reviews every Friday.' } });
  await press(screen.getByRole('button', { name: 'Save changes' }));
  const line = await screen.findByText('Audio reviews every Friday.');
  await waitFor(() => expect(line.hasAttribute('data-changed')).toBe(true));
  expect(document.getElementById('business-plan-name')!.hasAttribute('data-changed')).toBe(false);
});

it('a question marks the source answer when the test returns', async () => {
  const client = open('knowledge');
  const request = client.request.bind(client);
  vi.spyOn(client, 'request').mockImplementation(((method: string, params: never) => method === 'venture.knowledge.test'
    ? Promise.resolve({ line: 'One source answered.', hits: [{ sourceId: 'source-test', title: 'Opening hours', line: 'Calls after 4 pm.' }] })
    : request(method as never, params)) as typeof client.request);
  const question = await screen.findByLabelText('A question a client might ask');
  expect(document.querySelector('[data-changed]')).toBeNull();
  fireEvent.change(question, { target: { value: 'When can we call?' } });
  await press(screen.getByRole('button', { name: 'Test' }));
  const answer = (await screen.findByText('Calls after 4 pm.')).closest('li')!;
  expect(answer.hasAttribute('data-changed')).toBe(true);
});
