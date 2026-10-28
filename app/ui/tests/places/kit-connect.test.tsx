import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { TEST_ITEM_TEXT } from '../../src/places/connections/Webhooks';
import { assertInkRules } from '../helpers/ink-rules';

// Connections, the shared connectors of Ink v2 wave 5 (package 5A6): pages you watch, mail files, apps on this
// computer, your n8n or Make, speech from text. Each tile carries the engine's honest label and one action at rest;
// forms are one step away; a webhook address is kept like a key; the engine's refusals are worded in both languages.

async function start(language: 'en' | 'hi' = 'en') {
  window.location.hash = '#/connections';
  const fake = createFakeClient(new FakeEngine({ now: () => '2026-10-27T10:00:00.000Z' }));
  const spy = vi.spyOn(fake, 'request');
  render(<App client={fake} language={language} />);
  return { spy };
}
const settle = () => act(async () => { for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const calls = (spy: { mock: { calls: unknown[][] } }, method: string) => spy.mock.calls.filter(([m]) => m === method) as [string, unknown][];
const type = (element: HTMLElement, value: string) => fireEvent.change(element, { target: { value } });
/** The closed fold at rest, opened. */
async function openFold() {
  const all = await screen.findByRole('region', { name: /More ways to connect|जुड़ने के और तरीके/ });
  const fold = all.querySelector('details')!;
  if (!fold.open) await act(async () => { fold.open = true; });
  return all;
}
/** One connector opened from its row (simple first: at rest only the names and their labels show). */
async function tile(name: string) {
  await openFold();
  const row = await screen.findByRole('button', { name });
  if (row.getAttribute('aria-expanded') !== 'true') await act(async () => { fireEvent.click(row); });
  return screen.findByRole('region', { name });
}

describe('Connections: the shared connectors (5A6)', { timeout: 30_000 }, () => {
  it('at rest one fold names six connectors with honest labels and keeps all five original connections', async () => {
    await start();
    const closed = await screen.findByRole('region', { name: 'More ways to connect' });
    expect(closed.querySelector('details')!.open).toBe(false);
    const all = await openFold();
    await settle();
    expect([...all.querySelectorAll('[data-kit-part]')].map(row => row.getAttribute('data-kit-part'))).toEqual(['seo-publishing', 'monitors', 'mail', 'apps', 'webhook', 'speech']);
    expect(all.querySelector('[data-kit-part="seo-publishing"]')!.textContent).toMatch(/Writes/i);
    expect(all.querySelector('[data-kit-part="apps"]')!.textContent).toMatch(/Writes/i);
    expect(all.querySelector('[data-kit-part="speech"]')!.textContent).toMatch(/Planned/i);
    expect(all.querySelector('[role="region"]')).toBeNull();
    assertInkRules(document.body);
    const watch = await tile('Pages you watch');
    expect(watch.textContent).toContain('once an hour');
    const apps = await tile('Apps on this computer');
    await settle();
    const kimo = apps.querySelector('[data-local-app="kimo"]')!;
    const baocut = apps.querySelector('[data-local-app="baocut"]')!;
    expect(kimo.textContent).toMatch(/Writes/i);
    expect(baocut.textContent).toContain('Install it yourself; Chausar never installs it.');
    const speech = await tile('Speech from text');
    await settle();
    expect(speech.querySelectorAll('[data-speech-provider]').length).toBe(3);
    expect(await tile('Mail files')).toBeTruthy();
    expect(await tile('Your n8n or Make')).toBeTruthy();
    assertInkRules(document.body);
  });

  it('watching a page sends the owner\'s rupee text for the engine to read', async () => {
    const { spy } = await start();
    const card = await tile('Pages you watch');
    await act(async () => { fireEvent.click(within(card).getByRole('button', { name: 'Watch a page' })); });
    type(within(card).getByLabelText('Page address'), 'https://chai-supplies.example/darjeeling');
    fireEvent.click(within(card).getByLabelText('The price falls'));
    type(within(card).getByLabelText('The part that shows the price'), '#price');
    type(within(card).getByLabelText('Below this many rupees'), '1,200.50');
    await act(async () => { fireEvent.click(within(card).getByRole('button', { name: 'Start watching' })); });
    await settle();
    expect(calls(spy, 'venture.monitors.add')[0]![1]).toEqual({ url: 'https://chai-supplies.example/darjeeling', kind: 'price-below', selector: '#price', belowRupees: '1,200.50' });
    expect(card.querySelectorAll('[data-monitor]').length).toBe(2);
    assertInkRules(document.body);
  });

  it('a site whose terms bar automated reading is refused in the owner\'s words', async () => {
    await start();
    const card = await tile('Pages you watch');
    await act(async () => { fireEvent.click(within(card).getByRole('button', { name: 'Watch a page' })); });
    type(within(card).getByLabelText('Page address'), 'https://www.justdial.com/Pune/Cafes');
    await act(async () => { fireEvent.click(within(card).getByRole('button', { name: 'Start watching' })); });
    await settle();
    expect(within(card).getByRole('alert').textContent).toBe("This site's terms don't allow automated reading. Paste the text instead.");
  });

  it('the webhook address is kept like a key, and the test item is shown exactly as it is sent', async () => {
    const { spy } = await start();
    const card = await tile('Your n8n or Make');
    await act(async () => { fireEvent.click(within(card).getByRole('button', { name: 'Set a webhook' })); });
    const field = within(card).getByLabelText('Webhook address') as HTMLInputElement;
    expect(field.type).toBe('password');
    expect(field.getAttribute('autocomplete')).toBe('off');
    expect(field.closest('form')).toBeNull();
    expect(card.querySelector('[data-test-item]')!.textContent).toBe(TEST_ITEM_TEXT);
    expect(TEST_ITEM_TEXT).toBe(JSON.stringify({ from: 'Chausar', line: 'A test item from Chausar. You can ignore it.', test: true }));
    fireEvent.click(within(card).getByLabelText('Make'));
    type(field, 'https://hook.example.com/abc');
    await act(async () => { fireEvent.click(within(card).getByRole('button', { name: 'Save and send the test' })); });
    await settle();
    expect(calls(spy, 'venture.webhook.set')[0]![1]).toEqual({ kind: 'make', url: 'https://hook.example.com/abc', test: true });
    expect(card.textContent).toContain('The test item reached your Make webhook.');
    expect(card.textContent).not.toContain('/abc');
    assertInkRules(document.body);
  });

  it('a mail file is read in the page and imported; the threads show their subjects as quoted content', async () => {
    const { spy } = await start();
    const card = await tile('Mail files');
    await settle();
    expect(card.querySelector('[data-manual-path]')!.textContent).toBe('Forward the mails, or export them as .eml files');
    const eml = ['From: Ravi <ravi@other.example>', 'Subject: New order', 'Message-ID: <n1@other.example>', '', 'I want 20 boxes.', ''].join('\r\n');
    const input = card.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => { fireEvent.change(input, { target: { files: [new File([eml], 'order.eml', { type: 'message/rfc822' })] } }); });
    await settle();
    const [, params] = calls(spy, 'venture.mail.import')[0]! as [string, { name: string; contentBase64: string }];
    expect(params.name).toBe('order.eml');
    expect(atob(params.contentBase64)).toBe(eml);
    expect(card.textContent).toContain('1 message imported from order.eml.');
    expect(card.querySelectorAll('[data-thread] [data-content]').length).toBeGreaterThan(0);
  });

  it('reads in Hindi', async () => {
    await start('hi');
    expect(await screen.findByRole('region', { name: 'जुड़ने के और तरीके' })).toBeTruthy();
    expect(await tile('जिन पेजों पर आप नज़र रखते हैं')).toBeTruthy();
  });
});
