import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { ClientAiConsentView, EngineClient, ModelStatusLite, QueueRow } from '../../src/engine/types';
import { PRACTICE_REASON, STAGE_PLACE } from '../../../../platform/runtime/venture/core/launch-stage';
import { assertInkRules, assertOnePrimary } from '../helpers/ink-rules';

/*
 * Found on Windows, 16 Nov 2026 (screens 175 to 192): New order said nothing about the client's AI permission, and
 * Start then failed with "Allow this client's data to reach your AI before starting their work." The sheet now says
 * it up front, in one line, with the permission's own words and Allow beside it: one recorded consent per client, on
 * the owner's press, never assumed. And the practice draft's card said "set How much it asks you to Approve each",
 * a setting the app no longer shows by that name, with no way there: it now says to go live, and carries the way.
 */

type Fake = ReturnType<typeof createFakeClient>;
const calls = (spy: { mock: { calls: unknown[][] } }, method: string) => spy.mock.calls.filter((call) => call[0] === method).map((call) => call[1]);
const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });

/** The fake engine with an AI connected or not: the permission matters only when an AI will read the client's data. */
function start(hash: string, options: { ai?: boolean; prepare?: (client: Fake) => Promise<void> } = {}) {
  window.location.hash = hash;
  const client = createFakeClient(new FakeEngine());
  const request = client.request.bind(client);
  const spy = vi.fn(async (method: string, params?: unknown) => {
    const answer = await request(method as never, params as never);
    if (method !== 'venture.models.status' || options.ai === undefined) return answer;
    const status = answer as ModelStatusLite;
    const tier = (now: ModelStatusLite['tiers']['main']) => (options.ai ? { ...now, presetId: 'codex-cli', usable: true } : { ...now, presetId: 'built-in-templates', model: null });
    return { ...status, tiers: { fast: tier(status.tiers.fast), main: tier(status.tiers.main) } };
  });
  client.request = spy as unknown as EngineClient['request'];
  return { client, spy, ready: (async () => { await options.prepare?.(client); render(<App client={client} language="en" />); })() };
}
afterEach(() => { window.location.hash = ''; });

describe('New order: the client\'s AI permission, said up front', () => {
  it('a client not yet allowed: one line, the permission\'s exact words, and Allow, which records it on that press', async () => {
    const { client, spy, ready } = start('#/work?sheet=new-order:c-boat', { ai: true });
    await ready;
    const sheet = await screen.findByRole('complementary', { name: 'New order' });
    const block = await waitFor(() => { const found = sheet.querySelector<HTMLElement>('[data-order-ai="needed"]'); expect(found).not.toBeNull(); return found!; });
    expect(block.textContent).toContain("Boat Audio's work can start only after you allow their data to reach your AI.");
    const view = await client.request('venture.client.aiConsent.get', { clientId: 'c-boat' }) as ClientAiConsentView;
    expect(block.querySelector('[data-content]')?.textContent).toBe(view.disclosure);
    // Reading the sheet grants nothing.
    expect(calls(spy, 'venture.client.aiConsent.agree')).toEqual([]);
    assertInkRules(sheet);
    assertOnePrimary(sheet);
    await act(async () => { fireEvent.click(within(block).getByRole('button', { name: 'Allow AI access' })); });
    await settle();
    expect(calls(spy, 'venture.client.aiConsent.agree')).toEqual([{ clientId: 'c-boat', disclosureDigest: view.disclosureDigest }]);
    await waitFor(() => expect(sheet.querySelector('[data-order-ai="allowed"]')?.textContent).toBe("Allowed. Boat Audio's data can reach your AI."));
    expect(sheet.querySelector('[data-order-ai="needed"]')).toBeNull();
    expect((await client.request('venture.client.aiConsent.get', { clientId: 'c-boat' }) as ClientAiConsentView).status).toBe('agreed');
  });

  it('says nothing for a client already allowed, or when no AI is connected to read anything', async () => {
    const allowed = start('#/work?sheet=new-order:c-boat', { ai: true, prepare: async (client) => {
      const view = await client.request('venture.client.aiConsent.get', { clientId: 'c-boat' }) as ClientAiConsentView;
      await client.request('venture.client.aiConsent.agree', { clientId: 'c-boat', disclosureDigest: view.disclosureDigest });
    } });
    await allowed.ready;
    const sheet = await screen.findByRole('complementary', { name: 'New order' });
    await settle();
    expect(sheet.querySelector('[data-order-ai]')).toBeNull();
    document.body.innerHTML = '';
    const none = start('#/work?sheet=new-order:c-boat', { ai: false });
    await none.ready;
    const plain = await screen.findByRole('complementary', { name: 'New order' });
    await settle();
    expect(plain.querySelector('[data-order-ai]')).toBeNull();
  });

  it('a new client: one line up front, and once the order is added the sheet stays to offer the same Allow', async () => {
    const { client, spy, ready } = start('#/work?sheet=new-order:new', { ai: true });
    await ready;
    const sheet = await screen.findByRole('complementary', { name: 'New order' });
    await settle();
    fireEvent.change(within(sheet).getByRole('combobox', { name: 'Client' }), { target: { value: '+new' } });
    await waitFor(() => expect(sheet.querySelector('[data-order-ai="new"]')?.textContent).toBe("Before a new client's work starts, you are asked to allow their data to reach your AI."));
    fireEvent.change(within(sheet).getByRole('textbox', { name: "Client's name" }), { target: { value: 'Example Softworks' } });
    const service = within(sheet).getByRole('combobox', { name: 'Service' }) as HTMLSelectElement;
    const priced = [...service.options].find((option) => option.value && !/no price/i.test(option.textContent ?? ''))!;
    fireEvent.change(service, { target: { value: priced.value } });
    await settle();
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'What they asked for' }), { target: { value: 'A birthday cake for Friday.' } });
    const add = within(sheet).getByRole('button', { name: 'Add order' }) as HTMLButtonElement;
    expect(add.disabled, `Add order is held: ${add.getAttribute('title') ?? sheet.textContent}`).toBe(false);
    await act(async () => { fireEvent.click(add); });
    await settle();
    const created = calls(spy, 'venture.order.create');
    expect(created).toHaveLength(1);
    const made = (await client.request('venture.client.list', {})).find((item) => item.name === 'Example Softworks')!;
    const after = await waitFor(() => { const found = document.querySelector<HTMLElement>('[data-order-added]'); expect(found).not.toBeNull(); return found!; });
    expect(after.textContent).toContain('Order added.');
    const view = await client.request('venture.client.aiConsent.get', { clientId: made.id }) as ClientAiConsentView;
    expect(after.querySelector('[data-content]')?.textContent).toBe(view.disclosure);
    expect(calls(spy, 'venture.client.aiConsent.agree')).toEqual([]);
    await act(async () => { fireEvent.click(within(after).getByRole('button', { name: 'Allow AI access' })); });
    await settle();
    expect(calls(spy, 'venture.client.aiConsent.agree')).toEqual([{ clientId: made.id, disclosureDigest: view.disclosureDigest }]);
  });
});

describe('Today: a practice draft\'s card carries the way to the setting it names', () => {
  type Seed = Omit<QueueRow, 'digest'>;
  const NOW = '2026-10-21T12:00:00.000Z';
  const row = (line: string): Seed => ({
    id: 'run:d-ep14-script:review-blocked', businessId: 'lumen', businessName: 'Lumen Studio', agent: 'Producer', kind: 'draft', createdAt: '2026-10-21T08:30:00.000Z',
    title: 'Draft reply for Boat Audio', line, viewRef: { kind: 'draft', id: 'd-ep14-script' },
    actions: [{ id: 'deny', label: 'Reject', primary: false }, { id: 'read', label: 'Read', primary: true }],
  });
  const card = async () => (await screen.findByRole('heading', { level: 3, name: 'Draft reply for Boat Audio' })).closest('article') as HTMLElement;

  it('the engine\'s words name going live, and the card links to the Stage setting', async () => {
    expect(PRACTICE_REASON).toBe('This is a practice draft, so it never goes to a client. To use drafts, go live.');
    expect(PRACTICE_REASON).not.toMatch(/How much it asks you/);
    window.location.hash = '#/today';
    render(<App client={createFakeClient(new FakeEngine({ now: () => NOW, queue: [row(PRACTICE_REASON)] }))} language="en" />);
    const link = await within(await card()).findByRole('link', { name: 'Open the stage setting' });
    expect(link.getAttribute('href')).toBe(STAGE_PLACE);
    expect(STAGE_PLACE).toBe('#/business/practice');
  });

  // Round 7 (re-check 036 and 041): with Hindi on, the practice line is said from the pack, and the link that was decided
  // from the English sentence vanished. Words in another language never take a control away: every action and link
  // a card has in English is there in Hindi, in the same order and to the same place.
  it('in Hindi the card keeps every action and link it has in English, the Stage link included', async () => {
    const controls = async (language: 'en' | 'hi') => {
      // The language is in place before Today opens, as when the owner chose it in Settings and came back.
      window.location.hash = '#/settings';
      const engine = new FakeEngine({ now: () => NOW, queue: [row(PRACTICE_REASON)] });
      if (language === 'hi') await engine.request('app.preferences.set', { language: 'hi' });
      const view = render(<App client={createFakeClient(engine)} language="en" />);
      await waitFor(() => expect(document.documentElement.lang).toBe(language));
      await act(async () => { window.location.hash = '#/today'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
      const found = await waitFor(() => { const article = document.querySelector<HTMLElement>('article[data-row-id="run:d-ep14-script:review-blocked"]'); expect(article).not.toBeNull(); return article!; });
      await settle();
      // The card's words in its language first (the Hindi pack loads when it is chosen), then its controls.
      await waitFor(() => expect(found.textContent).toContain(language === 'hi' ? 'नामंज़ूर करें' : 'Reject'));
      const list = [...found.querySelectorAll<HTMLElement>('button, a[href]')].map((item) => `${item.tagName}:${item.getAttribute('href') ?? item.getAttribute('data-action') ?? ''}`);
      const stage = found.querySelector('a[data-stage-link]')?.textContent ?? null;
      view.unmount();
      return { list, stage };
    };
    const en = await controls('en');
    const hi = await controls('hi');
    expect(en.stage).toBe('Open the stage setting');
    expect(hi.list).toEqual(en.list);
    expect(hi.stage).toBe('स्टेज की सेटिंग खोलें');
  });

  it('every card on Today keeps in Hindi each action and link it has in English', async () => {
    const cards = async (language: 'en' | 'hi') => {
      window.location.hash = '#/settings';
      const engine = new FakeEngine({ now: () => NOW });
      if (language === 'hi') await engine.request('app.preferences.set', { language: 'hi' });
      const view = render(<App client={createFakeClient(engine)} language="en" />);
      await waitFor(() => expect(document.documentElement.lang).toBe(language));
      await act(async () => { window.location.hash = '#/today'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
      await waitFor(() => expect(document.querySelectorAll('article[data-row-id]').length).toBeGreaterThan(0));
      await settle();
      const out = Object.fromEntries([...document.querySelectorAll<HTMLElement>('article[data-row-id]')].map((card) => [card.getAttribute('data-row-id'),
        [...card.querySelectorAll<HTMLElement>('button, a[href]')].map((item) => `${item.tagName}:${item.getAttribute('href') ?? ''}`)]));
      view.unmount();
      return out;
    };
    const en = await cards('en');
    expect(Object.keys(en).length).toBeGreaterThan(0);
    expect(await cards('hi')).toEqual(en);
  });

  it('a draft held for any other reason carries no such link', async () => {
    window.location.hash = '#/today';
    render(<App client={createFakeClient(new FakeEngine({ now: () => NOW, queue: [row('AI work must finish before you can approve this draft.')] }))} language="en" />);
    const found = await card();
    await settle();
    expect(within(found).queryByRole('link', { name: 'Open the stage setting' })).toBeNull();
  });
});
