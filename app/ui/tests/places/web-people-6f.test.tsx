import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { assertInkRules } from '../helpers/ink-rules';

// Connections, wave 6 (6F3, 6F8): web search and reading, and people search, inside the closed "More ways to connect"
// fold so nothing is added at rest. Web search reads the engine's line about the AI tool's own search, takes the
// owner's own key only after the consent naming the provider, and shows a read page's words in [data-content]. People
// search says fixture-tested for Happenstance and Probe42, planned for Tofler, and shows the exact lookup before any send.

const KEY = ['synthetic', 'ui', 'key', '9090'].join('-');
async function start() {
  window.location.hash = '#/connections';
  const fake = createFakeClient(new FakeEngine({ now: () => '2026-11-01T10:00:00.000Z' }));
  const spy = vi.spyOn(fake, 'request');
  render(<App client={fake} language="en" />);
  return { spy };
}
const settle = () => act(async () => { for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const type = (element: HTMLElement, value: string) => fireEvent.change(element, { target: { value } });
async function tile(name: string) {
  const all = await screen.findByRole('region', { name: 'More ways to connect' });
  const fold = all.querySelector('details')!;
  if (!fold.open) await act(async () => { fold.open = true; });
  const row = await screen.findByRole('button', { name });
  if (row.getAttribute('aria-expanded') !== 'true') await act(async () => { fireEvent.click(row); });
  return screen.findByRole('region', { name });
}

describe('Connections: web search and people search (6F3, 6F8)', { timeout: 30_000 }, () => {
  it('the fold lists both with honest labels; nothing new shows at rest', async () => {
    await start();
    const closed = await screen.findByRole('region', { name: 'More ways to connect' });
    expect(closed.querySelector('details')!.open).toBe(false);
    await act(async () => { closed.querySelector('details')!.open = true; });
    await settle();
    expect(closed.querySelector('[data-kit-part="web-search"]')!.textContent).toMatch(/Reads/i);
    expect(closed.querySelector('[data-kit-part="people-search"]')!.textContent).toContain('Not tried live yet');
  });

  it('a search key is saved only after the consent shown, its last four characters come back, and the field is cleared', async () => {
    const { spy } = await start();
    const region = await tile('Web search and reading');
    await settle();
    expect(region.textContent).toContain('own web search');
    fireEvent.click(within(region).getByRole('button', { name: 'Add a search key' }));
    expect(region.querySelector('[data-search-consent]')!.textContent).toContain('Brave Search');
    const field = within(region).getByLabelText('API key') as HTMLInputElement;
    expect(field.type).toBe('password');
    type(field, KEY);
    await act(async () => { fireEvent.click(within(region).getByRole('button', { name: 'Agree and save' })); });
    await settle();
    const call = spy.mock.calls.find(([method, params]) => method === 'venture.web.search' && (params as { key?: string }).key);
    expect(call![1]).toMatchObject({ provider: 'brave', key: KEY });
    expect(region.textContent).toContain('ending 9090');
    expect(region.textContent).not.toContain(KEY);
    assertInkRules(document.body);
  });

  it('reading a page shows its words as untrusted content with the label', async () => {
    await start();
    const region = await tile('Web search and reading');
    await settle();
    type(within(region).getByLabelText('Read a page'), 'https://leaf.example/tea');
    await act(async () => { fireEvent.click(within(region).getByRole('button', { name: 'Read' })); });
    await settle();
    const page = region.querySelector('[data-web-page]')!;
    expect(page.textContent).toContain('From a public page, not confirmed');
    expect(page.querySelector('[data-content]')).not.toBeNull();
    type(within(region).getByLabelText('Read a page'), 'https://www.linkedin.com/in/x');
    await act(async () => { fireEvent.click(within(region).getByRole('button', { name: 'Read' })); });
    await settle();
    expect(within(region).getByRole('alert').textContent).toContain("terms don't allow automated reading");
  });

  it('people search: keys, the exact lookup first, then the answer only on approval', async () => {
    const { spy } = await start();
    const region = await tile('People search');
    await settle();
    expect(region.querySelector('[data-people-service="happenstance"]')!.textContent).toContain('Not tried live yet, needs your key');
    expect(region.textContent).not.toContain('fixture');
    expect(region.querySelector('[data-people-service="tofler"]')!.textContent).toContain('Meanwhile');
    type(within(region).getByLabelText('Probe42 API key'), KEY);
    const probe = region.querySelector('[data-people-service="probe42"]') as HTMLElement;
    await act(async () => { fireEvent.click(within(probe).getByRole('button', { name: 'Save key' })); });
    await settle();
    expect(probe.textContent).toContain('ending 9090');
    type(within(region).getByLabelText('Name or company'), 'Sample Tea');
    await act(async () => { fireEvent.click(within(region).getByRole('button', { name: 'Show the exact lookup' })); });
    await settle();
    expect(region.querySelector('[data-people-quote]')!.textContent).toContain('Look up "Sample Tea"');
    expect(spy.mock.calls.filter(([method, params]) => method === 'venture.people.lookup' && (params as { digest?: string }).digest).length).toBe(0);
    await act(async () => { fireEvent.click(within(region).getByRole('button', { name: 'Approve and look up' })); });
    await settle();
    const answer = region.querySelector('[data-people-answer="done"]')!;
    expect(answer.textContent).toContain('From Probe42 (MCA records), not confirmed');
    expect(answer.querySelector('[data-content]')).not.toBeNull();
    assertInkRules(document.body);
  });
});
