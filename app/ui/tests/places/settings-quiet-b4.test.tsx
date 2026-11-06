import { describe, expect, it } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
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
    const services = within(main).getByRole('textbox', { name: "Services you don't offer" });
    expect(name.closest('section')).not.toBe(services.closest('section'));
  });

  it('Voice starts with learning from writing', async () => {
    const main = await open('voice');
    const headings = within(main).getAllByRole('heading', { level: 2 }).filter(heading => !heading.closest('nav'));
    expect(headings[0]?.textContent).toBe('Learn from your writing');
  });

  it('Reports uses one plain section and a quiet deletion action', async () => {
    const main = await open('reports');
    expect(main.querySelectorAll('[data-tile]')).toHaveLength(0);
    expect(within(main).getByRole('button', { name: 'Delete my reports' }).getAttribute('data-variant')).toBe('quiet');
  });
});
