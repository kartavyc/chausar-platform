import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { CONNECTORS } from '../../src/engine/fixtures';
import { EngineError, type ConnectorCardLite, type ModelStatusLite, type BuildStatusView } from '../../src/engine/types';

type Bridged = Window & { chausar?: unknown };

function start(hash = '#/connections', engine = new FakeEngine(), language: 'en' | 'hi' = 'en') {
  window.location.hash = hash;
  const client = createFakeClient(engine);
  render(<App client={client} language={language} />);
  return { client, engine };
}
/** The desktop preload: its safe external open is the only way the desktop opens a link. */
function desktop() {
  const openExternal = vi.fn(async (_url: string) => {});
  (window as Bridged).chausar = { request: vi.fn(), openExternal };
  return openExternal;
}
// A connector's tile, by the button that names it. A text query with a selector: a role query over the whole page is
// slow in jsdom (each one walks every element), and the page holds many tiles.
const row = async (name: string) => (await screen.findByText(name, { selector: 'button' })).closest('li')!;
const go = async (hash: string) => { await act(async () => { window.location.hash = hash; window.dispatchEvent(new HashChangeEvent('hashchange')); }); };

afterEach(() => { delete (window as Bridged).chausar; });

describe('fake engine connectors match the engine', () => {
  it('every card has the engine shape, and Instagram browser posting is planned, not available', async () => {
    const cards = (await new FakeEngine().request('venture.connectors.list', {})) as ConnectorCardLite[];
    for (const card of cards) {
      expect(Array.isArray(card.postingOptions), card.id).toBe(true);
      expect(Array.isArray(card.chips), card.id).toBe(true);
      expect(typeof card.starter, card.id).toBe('boolean');
      if (card.postingOptions.length > 0) {
        expect(card.postingOptions.map((o) => o.mode)).toEqual(['api', 'owner-browser-session', 'handoff']);
        const summary = card.postingOptions.find((o) => o.status === 'available') ?? card.postingOptions.find((o) => o.mode === 'owner-browser-session');
        expect(card.posting).toEqual(summary);
      } else expect(card.posting).toBeUndefined();
    }
    const instagram = cards.find((c) => c.id === 'instagram')!;
    expect(instagram.postingOptions.every((o) => o.status === 'planned')).toBe(true);
    expect(instagram.posting).toMatchObject({ mode: 'owner-browser-session', status: 'planned', risk: 'The platform may restrict this account.', reason: 'Posting a picture or video through the browser is not built yet.' });
    expect(instagram.modes.every((m) => m.status === 'planned')).toBe(true);
    expect(cards.find((c) => c.id === 'x')!.posting).toMatchObject({ mode: 'owner-browser-session', status: 'available', reason: null });
    // W4 4J21: the list adds each connector's truth (4J7): the ladder on every mode, the capability set and the guide.
    const plain = cards.map(({ guide: _g, capabilities: _c, ...card }) => ({
      ...card,
      modes: card.modes.map(({ ladder: _l, ...mode }) => mode),
      postingOptions: card.postingOptions.map(({ ladder: _l, ...option }) => option),
      ...(card.posting ? { posting: (({ ladder: _l, ...option }) => option)(card.posting) } : {}),
    }));
    expect(CONNECTORS).toEqual(plain);
  });
});

describe('Connections', () => {
  it('groups every connector under its category, each with its honest label', async () => {
    start();
    expect(await screen.findByRole('heading', { level: 1, name: 'Connections' })).toBeTruthy();
    const build = (await screen.findByRole('heading', { level: 2, name: 'Build' })).closest('section')!;
    for (const name of ['GitHub', 'Lovable', 'Bolt', 'Replit']) expect(within(build).getByRole('button', { name })).toBeTruthy();
    const label = async (name: string) => (await row(name)).querySelector('[data-connector-label] [data-label]')?.getAttribute('data-label');
    expect(await label('Lovable')).toBe('handoff');
    expect(await label('GitHub')).toBe('read');
    expect(await label('Chausar back office')).toBe('write');
    expect(await label('Razorpay')).toBe('planned');
    expect((await row('Razorpay')).textContent).toContain('Planned');
    expect(screen.getByRole('heading', { level: 2, name: 'Marketing and social' })).toBeTruthy();
  });

  it('shows posting as the engine says it: Instagram planned with its risk and reason, X through your browser', async () => {
    start();
    const instagram = await row('Instagram');
    const posting = instagram.querySelector('[data-posting]')!;
    expect(posting.querySelector('[data-label]')!.getAttribute('data-label')).toBe('planned');
    // Ink v2 (3B5b review): a planned connector says only "Planned" and the engine's reason, never how it would post
    // or what that risks, so it cannot read like a live channel.
    expect(posting.textContent).not.toContain('Through your own browser session');
    expect(posting.textContent).not.toContain('The platform may restrict this account.');
    expect(posting.textContent).toContain('Posting a picture or video through the browser is not built yet.');
    const linkedin = (await row('X')).querySelector('[data-posting]')!;
    expect(linkedin.querySelector('[data-label]')!.getAttribute('data-label')).toBe('write');
    expect(linkedin.textContent).toContain('The platform may restrict this account.');
    expect((await row('GitHub')).querySelector('[data-posting]')).toBeNull();
  });

  it("imports a bank statement file: the engine's own words for what it added, skipped as already there, or could not read", async () => {
    const { engine } = start();
    const bank = await row('Bank account (read only)');
    // The import works today, so the chip says Reads (w3 3G1 review); only reading the bank directly is Planned.
    expect(bank.querySelector('[data-connector-label] [data-label]')?.getAttribute('data-label')).toBe('read');
    expect(bank.querySelector('[data-bank-direct] [data-label]')?.getAttribute('data-label')).toBe('planned');
    fireEvent.click(within(bank).getByRole('button', { name: 'Import a statement' }));
    await act(async () => { window.dispatchEvent(new HashChangeEvent('hashchange')); });
    // The one import path opens the bank account sheet, with the import form inside it (Ink v2 wave 2, 2D).
    const sheet = await screen.findByRole('complementary', { name: 'Bank account' });
    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Import' })); });
    expect(within(sheet).getByRole('alert').textContent).toBe('Choose the statement file first.');
    const csv = 'Date,Amount,Description\n2026-10-01,-1200.00,Office rent\n2026-10-02,26200.00,Boat Audio\n2026-10-03,abc,Unknown\n';
    const spy = vi.spyOn(engine, 'request');
    fireEvent.change(within(sheet).getByLabelText('Account'), { target: { value: 'HDFC current' } });
    fireEvent.change(within(sheet).getByLabelText('Statement file (CSV)'), { target: { files: [new File([csv], 'october.csv', { type: 'text/csv' })] } });
    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Import' })); });
    await waitFor(() => expect(within(sheet).getByText('Added 2 transactions to HDFC current. 1 line was not read.')).toBeTruthy());
    expect(spy.mock.calls.find(([method]) => method === 'venture.bank.import')![1]).toEqual({ csv, account: 'HDFC current' });
    expect(within(sheet).getByText('Line 4: The amount is not a number.')).toBeTruthy();
    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Import' })); });
    await waitFor(() => expect(within(sheet).getByText('Added 0 transactions to HDFC current. 2 were already here, so they were skipped. 1 line was not read.')).toBeTruthy());
  });

  it('on the web, Visit site is a normal link that opens apart from Chausar', async () => {
    start();
    const link = within(await row('Razorpay')).getByRole('link', { name: /Visit site/ });
    expect(link.getAttribute('href')).toBe('https://razorpay.com/');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(within(await row('Your own mail app')).queryByRole('link', { name: /Visit site/ })).toBeNull();
  });

  it("on the desktop, Visit site goes through the preload's safe external open", async () => {
    const openExternal = desktop();
    start();
    const visit = within(await row('Razorpay')).getByRole('button', { name: /Visit site/ });
    await act(async () => { fireEvent.click(visit); });
    expect(openExternal).toHaveBeenCalledWith('https://razorpay.com/');
  });

  it("Open on Lovable hands the brief over through the engine's link, then marks it opened", async () => {
    const openExternal = desktop();
    const { engine } = start();
    const lovable = await row('Lovable');
    await act(async () => { fireEvent.click(within(lovable).getByRole('button', { name: 'Open Lovable' })); });
    await waitFor(() => expect(openExternal).toHaveBeenCalledTimes(1));
    expect(openExternal.mock.calls[0]![0]).toMatch(/^https:\/\/lovable\.dev\/#prompt=/);
    await waitFor(() => expect(lovable.textContent).toContain('Lovable opened in your browser.'));
    const status = (await engine.request('venture.build.status', {})) as BuildStatusView;
    expect(status.handoffs[0]).toMatchObject({ builder: 'lovable' });
    expect(status.handoffs[0]!.openedAt).not.toBeNull();
  });

  it("says the engine's reason when there is no brief to hand over yet, with the way to Website build", async () => {
    const openExternal = desktop();
    const engine = new FakeEngine();
    await engine.request('workspace.open', { folder: 'ledgerline' });
    start('#/connections', engine);
    const lovable = await row('Lovable');
    await act(async () => { fireEvent.click(within(lovable).getByRole('button', { name: 'Open Lovable' })); });
    await waitFor(() => expect(lovable.textContent).toContain('Write the build brief first.'));
    expect(within(lovable).getByRole('link', { name: 'Go to website build' }).getAttribute('href')).toBe('#/business/build');
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('GitHub is followed from Website build, where the engine links one repo', async () => {
    start();
    expect(within(await row('GitHub')).getByRole('link', { name: 'Follow a repo' }).getAttribute('href')).toBe('#/business/build');
  });

  it('opens a connector beside the page with every mode and posting option the engine lists', async () => {
    start();
    const title = await screen.findByRole('button', { name: 'Instagram' });
    await act(async () => { fireEvent.click(title); window.dispatchEvent(new HashChangeEvent('hashchange')); });
    const sheet = await screen.findByRole('complementary', { name: 'Instagram' });
    expect(window.location.hash).toBe('#/connections?sheet=connector%3Ainstagram');
    for (const words of ['Meta app review', "Planned until the platform's review of the app is done.", 'Posting a picture or video through the browser is not built yet.', 'The engine prepares it, but no screen opens it yet.', 'Instagram sign-in', 'Planned: writing to Instagram. Not in this build.']) {
      expect(sheet.textContent, words).toContain(words);
    }
    expect(within(sheet).queryByText('Works today')).toBeNull();
  });

  it('speaks Hindi', async () => {
    start('#/connections', new FakeEngine(), 'hi');
    expect(await screen.findByRole('heading', { level: 1, name: 'कनेक्शन' })).toBeTruthy();
  });
});

describe('Connections: Your AI', () => {
  const ai = async () => screen.findByRole('region', { name: 'Your AI' });

  it("with nothing connected, says templates do the work, and shows this month's spend as the engine writes it", async () => {
    start();
    const section = await ai();
    await waitFor(() => expect(section.textContent).toContain('No AI connected; using built-in templates'));
    expect(section.textContent).toContain('USD 0.0000');
  });

  it('connects Claude with one key for both jobs; the key is sent once, cleared, and never shown', async () => {
    const { engine } = start();
    const spy = vi.spyOn(engine, 'request');
    const section = await ai();
    const recommended = (await within(section).findByText('Claude Haiku 5.5 and Sonnet 5.5')).closest('li')!;
    fireEvent.click(within(recommended).getByRole('button', { name: 'Connect' }));
    const key = within(recommended).getByLabelText('Your Anthropic key') as HTMLInputElement;
    expect(key.type).toBe('password');
    expect(key.getAttribute('autocomplete')).toBe('off');
    fireEvent.change(key, { target: { value: 'sk-ant-secret-123' } });
    const connect = within(recommended).getByRole('button', { name: 'Connect' });
    expect((connect as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(recommended).getByRole('checkbox', { name: 'I agree' }));
    await act(async () => { fireEvent.click(connect); });
    await waitFor(() => expect(section.textContent).toContain('Quick work: Claude Haiku 5.5'));
    expect(section.textContent).toContain('Plans and drafts: Claude Sonnet 5.5');
    expect(key.value).toBe('');
    expect(document.body.textContent).not.toContain('sk-ant-secret-123');
    const sent = spy.mock.calls.filter(([method]) => method === 'venture.models.connect').map(([, params]) => params as Record<string, unknown>);
    expect(sent.map((p) => [p.presetId, p.tiers])).toEqual([['anthropic-haiku-5-5', ['fast']], ['anthropic-sonnet-5-5', ['main']]]);
    const status = (await engine.request('venture.models.status', {})) as ModelStatusLite;
    expect(status.connections.filter((c) => c.status === 'connected')).toHaveLength(2);
  });

  it('the key field sits outside any form, is sent from a button, and is cleared when Connect fails too', async () => {
    const engine = new FakeEngine();
    const real = engine.request.bind(engine);
    vi.spyOn(engine, 'request').mockImplementation(async (method: string, params?: unknown) => {
      if (method === 'venture.models.connect') throw new EngineError('MODEL_KEY_REJECTED', 'Anthropic refused this key.');
      return real(method, params);
    });
    start('#/connections', engine);
    const section = await ai();
    const recommended = (await within(section).findByText('Claude Haiku 5.5 and Sonnet 5.5')).closest('li')!;
    fireEvent.click(within(recommended).getByRole('button', { name: 'Connect' }));
    const key = within(recommended).getByLabelText('Your Anthropic key') as HTMLInputElement;
    expect(key.closest('form')).toBeNull();
    expect(section.querySelector('form input[type="password"]')).toBeNull();
    expect(key.getAttribute('autocomplete')).toBe('off');
    fireEvent.change(key, { target: { value: 'sk-ant-secret-123' } });
    fireEvent.click(within(recommended).getByRole('checkbox', { name: 'I agree' }));
    const connect = within(recommended).getByRole('button', { name: 'Connect' });
    expect(connect.getAttribute('type')).toBe('button');
    await act(async () => { fireEvent.click(connect); });
    await waitFor(() => expect(within(recommended).getByRole('alert').textContent).toContain('Anthropic refused this key.'));
    expect(key.value).toBe('');
    expect(document.body.textContent).not.toContain('sk-ant-secret-123');
    expect((within(recommended).getByRole('button', { name: 'Connect' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("a preset that needs setup shows the engine's reason and offers no Connect", async () => {
    start();
    const section = await ai();
    const claudeCode = (await within(section).findByText('Claude Code on this computer')).closest('li')!;
    expect(claudeCode.textContent).toContain("Chausar hasn't yet accepted Anthropic's terms for running Claude Code.");
    expect(claudeCode.textContent).toContain('Needs setup');
    expect(within(claudeCode).queryByRole('button', { name: 'Connect' })).toBeNull();
  });

  it('disconnects a connected AI, and the job falls back to templates', async () => {
    const engine = new FakeEngine();
    await engine.request('workspace.open', { folder: 'ledgerline' });
    start('#/connections', engine);
    const section = await ai();
    await waitFor(() => expect(section.textContent).toContain('USD 0.0420 (estimate, price unconfirmed)'));
    const connected = within(section).getByRole('list', { name: 'Connected' });
    const haiku = within(connected).getByText('Claude Haiku 5.5').closest('li')!;
    await act(async () => { fireEvent.click(within(haiku).getByRole('button', { name: 'Disconnect' })); });
    await waitFor(() => expect(within(connected).queryByText('Claude Haiku 5.5')).toBeNull());
    expect(section.textContent).toContain('Quick work: No AI connected; using built-in templates');
    const status = (await engine.request('venture.models.status', {})) as ModelStatusLite;
    expect(status.tiers.fast.presetId).toBe('built-in-templates');
  });

  it('before the business itself exists (a kept vault, no plan yet), uses the draft desk (venture.ai.*)', async () => {
    const engine = new FakeEngine({ fresh: true });
    await engine.request('workspace.create', { name: 'Kite Studio', pack: 'services' });
    const spy = vi.spyOn(engine, 'request');
    start('#/connections', engine);
    const section = await ai();
    await waitFor(() => expect(section.textContent).toContain('No AI connected; using built-in templates'));
    expect(section.textContent).toContain('No business is open yet');
    const methods = spy.mock.calls.map(([method]) => method);
    expect(methods).toContain('venture.ai.status');
    expect(methods).not.toContain('venture.models.status');
  });

  it('Today\'s "Connect your AI" lands here', async () => {
    start('#/connections/ai');
    const section = await ai();
    await waitFor(() => expect(document.activeElement).toBe(within(section).getByRole('heading', { level: 2, name: 'Your AI' })));
    await go('#/connections');
    expect(screen.getByRole('region', { name: 'Your AI' })).toBeTruthy();
  });
});
