import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { assertInkRules } from '../helpers/ink-rules';
import { ClockProvider } from '../../src/shell/clock';

// W6 6G3 and 6G4 (D44): the client sheet's company (two-way, with the company sheet), timeline with "Log a call or
// message", lists (pipelines with their own stages, from the Pipeline tab's Lists), the field history with who and when,
// and the dated facts (since when, source, who may see them; replace keeps the old one; Forget asks once more).

const NOW = '2026-11-01T10:00:00.000Z';
function start(hash: string) {
  window.location.hash = hash;
  const client = createFakeClient(new FakeEngine({ now: () => NOW }));
  const spy = vi.spyOn(client, 'request');
  // The screen's clock matches the fake engine's, so dates the form fills in are the engine's today on any run day.
  render(<ClockProvider now={() => new Date(NOW)}><App client={client} language="en" /></ClockProvider>);
  return { client, spy };
}
async function click(element: HTMLElement) {
  await act(async () => { fireEvent.click(element); window.dispatchEvent(new HashChangeEvent('hashchange')); });
}
const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const section = (root: HTMLElement, name: string) => within(root).getByRole('heading', { level: 3, name }).closest('section') as HTMLElement;
const fold = (root: HTMLElement, name: string) => within(root).getByText(name, { selector: 'summary' }).closest('details') as HTMLDetailsElement;
async function openFold(root: HTMLElement, name: string) {
  const details = fold(root, name);
  await act(async () => { details.open = true; fireEvent(details, new Event('toggle')); });
  return details;
}
const type = (input: HTMLElement, value: string) => fireEvent.change(input, { target: { value } });
const calls = (spy: { mock: { calls: unknown[][] } }, method: string) => spy.mock.calls.filter(([m]) => m === method).map(([, p]) => p);
async function boatSheet() {
  const sheet = await screen.findByRole('complementary', { name: 'Boat Audio' });
  await settle();
  return sheet;
}

describe('the client sheet: CRM (6G3)', () => {
  it('puts the client in a new company, and the company sheet lists the client back', async () => {
    const { spy } = start('#/clients?sheet=client:c-boat');
    const sheet = await boatSheet();
    expect(within(sheet).queryByRole('heading', { name: 'Company' })).toBeNull();
    const company = await openFold(sheet, 'Add details');
    const pick = await openFold(company, 'Put in a company');
    fireEvent.change(within(pick).getByLabelText('Choose a company'), { target: { value: 'new' } });
    type(within(pick).getByRole('textbox', { name: 'New company name' }), 'Boat Group');
    await click(within(pick).getByRole('button', { name: 'Put in' }));
    await settle();
    expect(calls(spy, 'venture.crm.company.save')).toEqual([{ name: 'Boat Group' }]);
    const opener = within(section(sheet, 'Company')).getByRole('button', { name: 'Boat Group' });
    await click(opener);
    const companySheet = await screen.findByRole('complementary', { name: 'Boat Group' });
    await settle();
    const members = section(companySheet, 'Clients and people');
    expect(within(members).getByRole('button', { name: 'Boat Audio' })).toBeTruthy();
    assertInkRules();
  });

  it('logs a call on the timeline in the owner\'s words, and says WhatsApp is logged by hand', async () => {
    const { spy } = start('#/clients?sheet=client:c-boat');
    const sheet = await boatSheet();
    const details = await openFold(sheet, 'Add details');
    const log = await openFold(details, 'Log a call or message');
    expect(within(log).getByText(/Chausar has no WhatsApp connection/)).toBeTruthy();
    fireEvent.change(within(log).getByLabelText('What happened'), { target: { value: 'whatsapp' } });
    type(within(log).getByRole('textbox', { name: 'In your words' }), 'Sent the rate card.');
    await click(within(log).getByRole('button', { name: 'Log it' }));
    await settle();
    expect(calls(spy, 'venture.crm.log')).toEqual([{ clientId: 'c-boat', kind: 'whatsapp', on: '2026-11-01', text: 'Sent the rate card.' }]);
    const entry = section(sheet, 'Timeline').querySelector('[data-kind="whatsapp"]') as HTMLElement;
    expect(entry.textContent).toContain('You logged a WhatsApp message');
    expect(within(entry).getByText('Sent the rate card.').hasAttribute('data-content')).toBe(true);
  });

  it('a change of details is in Changes with who changed it and what it was', async () => {
    start('#/clients?sheet=client:c-boat');
    const sheet = await boatSheet();
    const edit = await openFold(sheet, 'Edit details');
    fireEvent.change(within(edit).getByLabelText('What to change'), { target: { value: 'email' } });
    type(within(edit).getByRole('textbox', { name: 'Change it to' }), 'team@boataudio.in');
    await click(within(edit).getByRole('button', { name: 'Save' }));
    await settle();
    const history = await openFold(sheet, 'History');
    const rows = [...history.querySelectorAll('[data-history] li')].map((row) => row.textContent);
    expect(rows[0]).toContain('You changed Email: team@boataudio.in (was partners@boataudio.in)');
    expect(rows.at(-1)).toContain('Added to Clients');
  });
});

describe('lists: pipelines with their own stages (6G3)', () => {
  it('makes a list from the Pipeline tab and places a client at a stage', async () => {
    const { spy } = start('#/clients/pipeline');
    const lists = await screen.findByRole('button', { name: 'Lists' });
    await click(lists);
    const sheet = await screen.findByRole('complementary', { name: 'Lists' });
    await settle();
    expect(within(sheet).getByText('No lists yet.')).toBeTruthy();
    const make = await openFold(sheet, 'New list');
    type(within(make).getByRole('textbox', { name: 'List name' }), 'Sponsors');
    type(within(make).getByRole('textbox', { name: 'Stages, one per line' }), 'To ask\nAsked\nSigned');
    await click(within(make).getByRole('button', { name: 'Make list' }));
    await settle();
    expect(calls(spy, 'venture.crm.list.save')).toEqual([{ name: 'Sponsors', stages: ['To ask', 'Asked', 'Signed'] }]);
    const list = await screen.findByRole('complementary', { name: 'Sponsors' });
    await settle();
    const add = await openFold(list, 'Add to this list');
    fireEvent.change(within(add).getByLabelText('Who'), { target: { value: 'client:c-boat' } });
    fireEvent.change(within(add).getByLabelText('Stage'), { target: { value: 'Asked' } });
    await click(within(add).getByRole('button', { name: 'Put in' }));
    await settle();
    expect(within(section(list, 'Asked')).getByRole('button', { name: 'Boat Audio' })).toBeTruthy();
    expect(within(section(list, 'To ask')).getByText('No one at this stage.')).toBeTruthy();
    assertInkRules();
  });
});

describe('dated facts (6G4)', () => {
  it('a client fact shows since when, its source and who may see it; replacing keeps the earlier fact; Forget asks once more', async () => {
    const { spy } = start('#/clients?sheet=client:c-boat');
    const sheet = await boatSheet();
    expect(within(sheet).queryByRole('heading', { name: 'What Chausar remembers' })).toBeNull();
    const add = await openFold(sheet, 'Edit details');
    fireEvent.change(within(add).getByLabelText('What to change'), { target: { value: 'fact' } });
    type(within(add).getByRole('textbox', { name: 'Topic' }), 'Best time');
    type(within(add).getByRole('textbox', { name: 'Change it to' }), 'Calls after 4 pm.');
    type(within(add).getByLabelText('True since'), '2026-10-01');
    await click(within(add).getByRole('button', { name: 'Keep fact' }));
    await settle();
    expect(calls(spy, 'venture.memory.add')).toEqual([{ subject: 'client:c-boat', topic: 'Best time', text: 'Calls after 4 pm.', since: '2026-10-01', visibility: 'ai' }]);
    const row = section(sheet, 'What Chausar remembers').querySelector('[data-fact]') as HTMLElement;
    expect(within(row).getByText('Calls after 4 pm.').hasAttribute('data-content')).toBe(true);
    expect(row.textContent).toContain('since 1 Oct 2026');
    expect(row.textContent).toContain('You told Chausar. Your AI can read this.');

    await click(within(row).getByRole('button', { name: 'Only me' }));
    await settle();
    expect(calls(spy, 'venture.memory.visibility')).toHaveLength(1);
    const hidden = section(sheet, 'What Chausar remembers').querySelector('[data-fact]') as HTMLElement;
    expect(hidden.textContent).toContain('Only you see this.');

    await click(within(hidden).getByRole('button', { name: 'Replace' }));
    type(within(hidden).getByRole('textbox', { name: 'Replace with' }), 'Calls after 5 pm.');
    await click(within(hidden).getByRole('button', { name: 'Save new fact' }));
    await settle();
    const now = section(sheet, 'What Chausar remembers');
    expect(within(now).getByText('Calls after 5 pm.')).toBeTruthy();
    const earlier = await openFold(now, 'Earlier facts');
    expect(within(earlier).getByText('Calls after 4 pm.')).toBeTruthy();
    expect(earlier.textContent).toContain('replaced 1 Nov 2026');

    const current = now.querySelector('[data-fact]') as HTMLElement;
    await click(within(current).getByRole('button', { name: 'Forget' }));
    expect(within(current).getByText(/every earlier version/)).toBeTruthy();
    expect(calls(spy, 'venture.memory.forget')).toHaveLength(0);
    await click(within(current).getByRole('button', { name: 'Forget it' }));
    await settle();
    expect(calls(spy, 'venture.memory.forget')).toHaveLength(1);
    expect(within(sheet).queryByRole('heading', { name: 'What Chausar remembers' })).toBeNull();
    assertInkRules();
  });

  it('the business facts sit on What the AI knows', async () => {
    const { spy } = start('#/business/knowledge');
    const heading = await screen.findByRole('heading', { name: 'What Chausar knows' });
    const tile = heading.closest('section') as HTMLElement;
    await settle();
    const add = await openFold(tile, 'Add');
    await click(within(add).getByRole('radio', { name: 'Fact' }));
    type(within(add).getByRole('textbox', { name: 'Topic' }), 'Episode rate');
    type(within(add).getByRole('textbox', { name: 'The fact' }), 'Rs 15000 an episode.');
    await click(within(add).getByRole('button', { name: 'Keep fact' }));
    await settle();
    expect(calls(spy, 'venture.memory.add')[0]).toMatchObject({ subject: 'business', topic: 'Episode rate' });
    expect(within(tile).getByText('Rs 15000 an episode.')).toBeTruthy();
  });
});
