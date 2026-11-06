import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { BlueprintViewLite, EngineClient, QueueList } from '../../src/engine/types';
import business from '../../src/text/en/business.json';

/**
 * One-shot B4 task 3: a button that can't be pressed says why, under it and in its description; a button that destroys
 * or stops something carries the danger tone, never the accent fill. One test per site, on the fake engine.
 */

const NOW = '2026-10-23T13:35:00.000Z';
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); window.dispatchEvent(new HashChangeEvent('hashchange')); }); };
const press = async (element: Element) => { await act(async () => { fireEvent.click(element); }); await settle(); };
const type = (element: Element, value: string) => fireEvent.change(element, { target: { value } });

async function start(hash: string, options: { engine?: FakeEngine; answers?: Readonly<Record<string, unknown>> } = {}) {
  window.location.hash = hash;
  const fake = createFakeClient(options.engine ?? new FakeEngine({ now: () => NOW }));
  const request = fake.request.bind(fake) as unknown as (method: string, params: unknown) => Promise<unknown>;
  const spy = vi.fn(async (method: string, params?: unknown) => {
    const answer = options.answers?.[method];
    return answer === undefined ? request(method, params) : structuredClone(answer);
  });
  const client: EngineClient = { ...fake, request: spy as unknown as EngineClient['request'] };
  render(<App client={client} language="en" />);
  await settle();
  return { spy };
}

/** A dim button: disabled, its reason printed and in its description. */
function dim(name: string | RegExp, reason: string, scope: HTMLElement = document.body): HTMLButtonElement {
  const button = within(scope).getByRole('button', { name, description: reason }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  expect(within(button.parentElement!).getByText(reason).hidden).toBe(false);
  return button;
}
function live(name: string | RegExp, scope: HTMLElement = document.body): HTMLButtonElement {
  const button = within(scope).getByRole('button', { name }) as HTMLButtonElement;
  expect(button.disabled).toBe(false);
  expect(button.hasAttribute('aria-describedby')).toBe(false);
  return button;
}
const fold = async (name: string) => {
  const summary = await screen.findByText(name, { selector: 'summary' });
  const details = summary.closest('details')!;
  await act(async () => { details.open = true; fireEvent(details, new Event('toggle')); });
  await settle();
  return details as HTMLElement;
};

describe('Buttons that say why', () => {
  it('Away: Set the days until both days are picked', async () => {
    await start('#/business/away');
    await screen.findByLabelText('First day away');
    dim('Set the days', 'Pick both days first');
    type(screen.getByLabelText('First day away'), '2026-11-01');
    dim('Set the days', 'Pick both days first');
    type(screen.getByLabelText('Last day away'), '2026-11-05');
    live('Set the days');
  });

  it('Voice: Learn says it needs three texts, right under it', async () => {
    await start('#/business/voice');
    const learn = (await screen.findByRole('heading', { name: 'Learn from your writing' })).closest('section') as HTMLElement;
    dim('Learn', business['business.voice.needTexts'], learn);
    expect(within(learn).getAllByText(business['business.voice.needTexts'])).toHaveLength(1);
  });

  it('Keep: Done until the box is ticked', async () => {
    await start('#/business/keep');
    await press(await screen.findByRole('button', { name: 'Make a new one' }));
    await screen.findByRole('group', { name: 'Recovery code' });
    dim('Done', 'Tick the box first');
    fireEvent.click(screen.getByRole('checkbox', { name: "I've saved it somewhere safe" }));
    live('Done');
  });

  it('Reports: Turn on reports until one is ticked', async () => {
    await start('#/business/reports');
    const usage = await screen.findByRole('checkbox', { name: /Usage reports/ });
    await waitFor(() => dim('Turn on reports', 'Tick one first'));
    fireEvent.click(usage);
    live('Turn on reports');
  });

  it('About you: Save says to change something, and greys again after saving', async () => {
    const { spy } = await start('#/business/owner');
    const name = await screen.findByLabelText('Your first name');
    dim('Save', 'Change something first');
    type(name, 'Meera');
    await press(live('Save'));
    expect(spy.mock.calls.some(([method]) => method === 'venture.owner.set')).toBe(true);
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText('Change something first')).toBeNull();
  });

  it('What AI knows: Add says what is missing for each kind', async () => {
    await start('#/business/knowledge');
    const add = (await screen.findByRole('heading', { name: 'Add a source' })).closest('section') as HTMLElement;
    dim('Add', 'Add a title and the words first', add);
    fireEvent.click(within(add).getByRole('radio', { name: 'Web page' }));
    dim('Add', 'Add the link first', add);
  });

  it('Routines: Save routine names the first thing missing', async () => {
    await start('#/business/routines');
    const form = await screen.findByRole('form', { name: 'Add a routine' });
    dim('Save routine', 'Name the routine first', form);
    type(within(form).getByLabelText('Name'), 'Monday check');
    dim('Save routine', 'Say what to ask first', form);
    type(within(form).getByLabelText('What to ask'), 'What is due this week?');
    dim('Save routine', 'Pick a day first', form);
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Monday' }));
    live('Save routine', form);
  });

  it('Notifications: Save relay and Pause', async () => {
    await start('#/business/notifications');
    const relay = await screen.findByLabelText('Your relay address');
    dim('Save relay', 'Add the address first');
    type(relay, 'https://ntfy.sh/topic');
    live('Save relay');
    await screen.findByLabelText('Pause alerts until');
    dim('Pause', 'Pick a date');
    type(screen.getByLabelText('Pause alerts until'), '2026-10-30');
    live('Pause');
  });

  it('Notifications: Save bot until the token and chat id are there', async () => {
    await start('#/business/notifications');
    // C4 task 39: one group, open while nothing is set up; Telegram is a part under its own heading.
    const telegram = (await screen.findByRole('heading', { name: 'Telegram alerts' })).closest('section') as HTMLElement;
    const token = await within(telegram).findByLabelText('Bot token');
    dim('Save bot', 'Add the token and your chat id first', telegram);
    type(token, 'a-token');
    type(within(telegram).getByLabelText('Your chat id'), '7000123456');
    live('Save bot', telegram);
  });

  it('New order: Add order says what is missing, in order', async () => {
    await start('#/work');
    await press(await screen.findByRole('button', { name: 'New order' }));
    const sheet = await screen.findByRole('complementary', { name: 'New order' });
    const client = await within(sheet).findByLabelText('Client');
    await within(client).findByRole('option', { name: 'Boat Audio' });
    // Lumen has one priced service, so it is chosen already.
    dim('Add order', 'Pick a client first', sheet);
    await press(within(sheet).getByRole('button', { name: '+ New client' }));
    dim('Add order', "Add the client's name first", sheet);
    type(client, 'c-boat');
    dim('Add order', 'Say what they asked for first', sheet);
    type(within(sheet).getByLabelText('What they asked for'), 'One mention in episode 16');
    live('Add order', sheet);
  });

  it('New order: with two services to choose from, it asks for the client and the service together', async () => {
    const engine = new FakeEngine({ now: () => NOW });
    const priced = await engine.request('venture.blueprint.update', { patch: { offers: [{ id: 'offer_shorts', unitPrice: '8000' }] } }) as BlueprintViewLite;
    const queue = await engine.request('venture.queue.list', {}) as QueueList;
    const row = queue.rows.find((one) => one.viewRef?.kind === 'plan' && one.viewRef.id === priced.blueprint.id)!;
    await engine.request('venture.queue.decide', { id: row.id, digest: row.digest, action: 'approve', viewed: true });
    await start('#/work', { engine });
    await press(await screen.findByRole('button', { name: 'New order' }));
    const sheet = await screen.findByRole('complementary', { name: 'New order' });
    const client = await within(sheet).findByLabelText('Client');
    await within(client).findByRole('option', { name: 'Boat Audio' });
    dim('Add order', 'Pick a client and a service', sheet);
    await press(within(sheet).getByRole('button', { name: '+ New client' }));
    dim('Add order', "Add the client's name and a service", sheet);
  });

  it('Bills: Add bill says what is missing', async () => {
    await start('#/money/bills');
    await press(await screen.findByRole('button', { name: 'Add a bill' }));
    const add = await screen.findByRole('region', { name: 'Add a bill' });
    dim('Add bill', 'Add who it is from and the amount', add);
    type(within(add).getByLabelText('Who it is from'), 'Cloud Host');
    dim('Add bill', 'Add who it is from and the amount', add);
    type(within(add).getByLabelText('Amount'), '1180');
    live('Add bill', add);
  });

  it('Bank import: Import until the account and the file are there', async () => {
    await start('#/connections?sheet=bank:new');
    const sheet = await screen.findByRole('complementary', { name: 'Bank account' });
    dim('Import', 'Name the account and choose the statement file.', sheet);
    type(within(sheet).getByLabelText('Account'), 'HDFC current');
    dim('Import', 'Choose the statement file first.', sheet);
    fireEvent.change(within(sheet).getByLabelText('Statement file (CSV)'), { target: { files: [new File(['Date,Amount\n'], 'october.csv', { type: 'text/csv' })] } });
    live('Import', sheet);
  });

  it('Record a payment: Record payment says to enter the amount', async () => {
    await start('#/money/invoices?sheet=payment:inv-0039');
    const sheet = await screen.findByRole('complementary', { name: 'Record a payment' });
    const amount = await within(sheet).findByLabelText('Amount received');
    dim('Record payment', 'Enter the amount', sheet);
    type(amount, '2000');
    live('Record payment', sheet);
  });

  it('What AI knows: Keep fact says what is missing', async () => {
    await start('#/business/knowledge');
    const add = await fold('Add a fact');
    dim('Keep fact', 'Add the topic and the fact first', add);
    type(within(add).getByRole('textbox', { name: 'Topic' }), 'Best time');
    type(within(add).getByRole('textbox', { name: 'The fact' }), 'Calls after 4 pm.');
    live('Keep fact', add);
  });

  it('Network import: Import with 0 people says so, and another file is the main action', async () => {
    await start('#/clients/network?sheet=network-import:contacts-csv', {
      answers: { 'venture.network.import': { mode: 'check', kept: 0, dropped: [{ what: 'Rows with no email, phone or profile link', count: 3 }], people: 0, merged: 0, samples: [], line: 'Nobody to add.' } },
    });
    const sheet = await screen.findByRole('complementary');
    const input = sheet.querySelector<HTMLInputElement>('input[type="file"]')!;
    await act(async () => { fireEvent.change(input, { target: { files: [new File(['a,b\n1,2\n'], 'Connections.csv', { type: 'text/csv' })] } }); });
    await settle();
    await waitFor(() => dim('Import', '0 people to import. Choose another file', sheet));
    const again = within(sheet).getByRole('button', { name: 'Choose another file' });
    expect(again.getAttribute('data-variant')).toBe('primary');
    expect(within(sheet).getByRole('button', { name: 'Import' }).getAttribute('data-variant')).toBe('secondary');
  });

  it('Apps: Pin to Today and Export wait for Allow, with one line for both', async () => {
    await start('#/apps');
    const box = await screen.findByRole('textbox', { name: 'Describe the app' });
    await act(async () => { fireEvent.change(box, { target: { value: 'A list of who is due this week' } }); });
    await act(async () => { fireEvent.keyDown(box, { key: 'Enter' }); });
    await settle();
    const allow = await screen.findByRole('button', { name: 'Allow' }).catch(() => null);
    expect(allow).not.toBeNull();
    const pin = screen.getByRole('button', { name: 'Pin to Today', description: 'Allow it first' }) as HTMLButtonElement;
    const exported = screen.getByRole('button', { name: 'Export', description: 'Allow it first' }) as HTMLButtonElement;
    expect([pin.disabled, exported.disabled]).toEqual([true, true]);
    expect(screen.getAllByText('Allow it first')).toHaveLength(1);
  });
});

describe('Buttons that destroy or stop something', () => {
  it('Delete this business: danger tone, red in its fold, and dim until the name matches exactly', async () => {
    await start('#/business/keep');
    const box = await fold('Delete this business');
    expect(box.querySelector('summary')!.getAttribute('data-tone')).toBe('danger');
    const name = await within(box).findByLabelText('Type Lumen Studio to delete it');
    const button = dim('Delete this business', 'Type the business name to delete it', box);
    expect(button.dataset.tone).toBe('danger');
    expect(button.dataset.variant).not.toBe('primary');
    type(name, 'lumen studio');
    dim('Delete this business', 'Type the business name to delete it', box);
    type(name, 'Lumen Studio');
    expect(live('Delete this business', box).dataset.tone).toBe('danger');
  });

  it('Delete app: the danger tone, and so does its second ask', async () => {
    await start('#/apps?app=miniapp_sample');
    const remove = await screen.findByRole('button', { name: 'Delete app' });
    expect(remove.dataset.tone).toBe('danger');
    await press(remove);
    const ask = screen.getByRole('group', { name: 'Delete app' });
    expect(within(ask).getByRole('button', { name: 'Delete' }).dataset.tone).toBe('danger');
  });

  it('Stop all: its ask is the danger tone, not a green fill; Pause all stays the filled one', async () => {
    await start('#/today');
    const open = document.querySelector<HTMLElement>('[aria-haspopup="dialog"]')!;
    await press(open);
    const menu = await screen.findByRole('dialog');
    await press(within(menu).getByRole('button', { name: 'Stop all' }));
    const ask = menu.querySelector<HTMLElement>('[data-confirm]')!;
    expect(ask.textContent).toBe('Stop all');
    expect(ask.dataset.tone).toBe('danger');
    expect(ask.dataset.variant).toBe('secondary');
    await press(within(menu).getByRole('button', { name: 'Pause all' }));
    const pause = menu.querySelector<HTMLElement>('[data-confirm]')!;
    expect(pause.dataset.tone).toBeUndefined();
    expect(pause.dataset.variant).toBe('primary');
  });
});
