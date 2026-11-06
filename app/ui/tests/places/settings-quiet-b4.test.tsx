import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';

async function open(page: string, emptyDecisions = false) {
  const client = createFakeClient(new FakeEngine());
  if (emptyDecisions) {
    const request = client.request.bind(client);
    client.request = (async (method, params) => method === 'venture.decisions.list'
      ? { decisions: [] } : request(method, params as never)) as typeof client.request;
  }
  window.location.hash = `#/business/${page}`;
  render(<App client={client} language="en" />);
  for (let index = 0; index < 6; index++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  return screen.getByRole('main');
}

describe('B4 task 22: quiet settings', () => {
  it('Notifications omits the repeated settings sentence and folds the relay under Advanced', async () => {
    const main = await open('notifications');
    expect(main.querySelector('[data-settings-line]')).toBeNull();
    const advanced = within(main).getByText('Advanced', { selector: 'summary' }).closest('details')!;
    expect(advanced.open).toBe(false);
    expect(advanced.querySelector('input[type="url"]')).toBeTruthy();
  });

  it('empty Decisions does not promise an ordering', async () => {
    await open('decisions', true);
    expect(screen.queryByText('Newest first')).toBeNull();
  });

  it('About you separates the name from excluded services', async () => {
    const main = await open('owner');
    const name = within(main).getByRole('textbox', { name: 'Your first name' });
    const services = within(main).getByRole('textbox', { name: 'Services you do not sell' });
    expect(name.closest('section')).not.toBe(services.closest('section'));
  });

  it('Voice starts with learning from writing', async () => {
    const main = await open('voice');
    const headings = within(main).getAllByRole('heading', { level: 2 }).filter(heading => !heading.closest('nav'));
    expect(headings[0]?.textContent).toBe('Learn from your writing');
  });

  it('Reports uses one plain section and a quiet deletion action', async () => {
    const main = await open('reports');
    expect(within(main).getAllByRole('region').filter(region => !region.closest('nav'))).toHaveLength(1);
    expect(within(main).getByRole('button', { name: 'Delete my reports' }).getAttribute('data-variant')).toBe('quiet');
  });

  it('Keep shows three newest backup rows before opening older copies', async () => {
    const main = await open('keep');
    const backups = within(main).getByRole('region', { name: 'Backups' });
    const restore = within(backups).getAllByRole('button', { name: 'Restore' });
    expect(restore).toHaveLength(3);
    expect(restore.every(button => !button.closest('details'))).toBe(true);
  });

  it('Go or no go folds its form after making a card', async () => {
    await open('go-no-go');
    await act(async () => { fireEvent.change(screen.getByLabelText('What you are deciding'), { target: { value: 'Product photos' } }); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Make the card' })); });
    expect(await screen.findByRole('region', { name: 'Product photos' })).toBeTruthy();
    expect(screen.queryByLabelText('What you are deciding')).toBeNull();
    expect(screen.getByRole('button', { name: 'Make another' })).toBeTruthy();
  });

  it('Knowledge is one source list with one Add action', async () => {
    const main = await open('knowledge');
    expect(within(main).getByRole('region', { name: 'What Chausar knows' })).toBeTruthy();
    expect(within(main).getAllByRole('button', { name: 'Add' })).toHaveLength(1);
  });

  it('Voice keeps language and channel choices inside Learn from your writing', async () => {
    const main = await open('voice');
    const learn = within(main).getByRole('region', { name: 'Learn from your writing' });
    expect(within(learn).getByRole('combobox', { name: 'Language' })).toBeTruthy();
    expect(within(learn).getByRole('combobox', { name: 'Channel' })).toBeTruthy();
  });

  it('Away has one plain outer card for its settings and running work', async () => {
    const main = await open('away');
    const regions = within(main).getAllByRole('region');
    expect(regions).toHaveLength(1);
    expect(within(regions[0]!).getByRole('heading', { name: 'Keeps running' })).toBeTruthy();
    expect(within(regions[0]!).getAllByRole('list').length).toBeGreaterThan(0);
  });

  it('Keep asks for one passphrase after its action is picked', async () => {
    const main = await open('keep');
    expect(main.querySelectorAll('input[type="password"]')).toHaveLength(0);
    await act(async () => { fireEvent.click(within(main).getByText('Lock it with a passphrase instead', { selector: 'summary' })); });
    expect(main.querySelectorAll('input[type="password"]')).toHaveLength(1);
    expect(within(main).getByLabelText('Passphrase')).toBeTruthy();
  });

  it('Decisions uses its page title once and time-only rows under day headings', async () => {
    const main = await open('decisions');
    expect(within(main).queryByRole('heading', { name: 'Who decided what' })).toBeNull();
    const rows = main.querySelectorAll('[data-decisions] li');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.querySelector('time')?.textContent).toMatch(/^\d{1,2}:\d{2} [ap]m$/);
    expect(within(main).getAllByRole('heading', { level: 2 }).filter(heading => !heading.closest('nav')).length).toBeGreaterThan(0);
  });

  it('settings does not repeat the business name below its page title', async () => {
    const main = await open('notifications');
    expect(within(main).queryByText('Lumen Studio')).toBeNull();
  });

  it('the open routine form is titled Add a routine', async () => {
    const main = await open('routines');
    await act(async () => { fireEvent.click(within(main).getByText('Add a routine', { selector: 'summary' })); });
    const form = within(main).getByRole('form', { name: 'Add a routine' });
    expect(within(form).getByRole('heading', { name: 'Add a routine' })).toBeTruthy();
  });
});
