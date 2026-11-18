import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError, type EngineClient } from '../../src/engine/types';
import { teamCardDigest } from '../../../../platform/runtime/venture/agents/team-proposal';
import { ABOUT_BOX, answerSideWork, toToday } from './first-run-steps';

/**
 * Seen in the real app on Windows (15 Nov 2026): a second business did not get the real onboarding. "New business" in
 * the business menu opened the old page ("Start a new business / Pick a way to earn / Or describe it in one sentence /
 * Make my plan"), which made a business at once from a built-in template: an AC repair technician in Lucknow got "Local
 * service business" with the offers "Monthly visits" and "Package", and the AI was never asked. Every new business now
 * goes through the same steps as the first: Connect your AI (skipped when the AI already connected on this computer
 * can be used again), What work do you do?, then the plan, kept with its name, way to earn and team.
 */
const AC = 'I repair and service air conditioners in Lucknow and I want yearly maintenance contracts from offices and housing societies.';
const agent = (name: string, job: string, duties: string[], reads: string[], department: string) => ({ name, job, duties, reads, department, digest: teamCardDigest({ name, job, duties, reads, department } as never) });
const WAY = {
  customer: 'Offices and housing societies in Lucknow that run many air conditioners.',
  reach: 'A list of societies found from public listings, then a first message you send to each secretary.',
  teamDoes: 'Finds the societies, drafts each message and quote, and keeps track of who replied.',
  youDo: 'Do the visits, set your own prices, send each message and take the calls.',
  firstWeek: ['Decide what a yearly contract covers and your price for it.', 'Approve the first list of societies.'],
};
const READ = {
  family: null, profession: null, country: null, evidence: null, idea: AC, source: 'ai',
  offers: [{ name: 'Yearly AC contract', line: 'Two services a year and priority repair visits.', unit: 'year' }, { name: 'One-time AC service', line: 'A full service of one unit.', unit: 'visit' }],
  reply: 'You service air conditioners in Lucknow. Which areas do you cover?',
  name: 'Lucknow Cool Care', way: WAY,
  team: [agent('Asha', 'Finds societies that need yearly service.', ['Lists housing societies in Lucknow from public listings', 'Tracks who replied'], ['plan', 'trackers'], 'sales')],
};

type Call = [string, Record<string, unknown>];
function start(options: { connected?: boolean } = {}) {
  const original = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (this: Intl.DateTimeFormat) { return { ...original.call(this), timeZone: 'Asia/Kolkata' }; });
  window.location.hash = '#/today';
  const engine = new FakeEngine();
  const fake = createFakeClient(engine);
  const calls: Call[] = [];
  const client: EngineClient = { ...fake, request: ((method: string, params?: Record<string, unknown>) => {
    calls.push([method, structuredClone(params ?? {})]);
    if (method === 'venture.about.read') return Promise.resolve(structuredClone(READ));
    return fake.request(method as never, params as never);
  }) as EngineClient['request'] };
  return { engine, fake, client, calls, show: () => { render(<App client={client} language="en" />); }, connected: options.connected };
}
/** The open business (Lumen Studio) connects the sample Codex, as Connections does, so it is the AI on this computer. */
async function connectCodex(env: ReturnType<typeof start>) {
  env.engine.firstRun.signIn();
  const presets = await env.fake.request('venture.models.presets', {});
  const codex = presets.find((preset) => preset.id === 'codex-cli')!;
  await env.fake.request('venture.models.connect', { presetId: 'codex-cli', consentDigest: codex.consentDigest });
}
async function newBusiness() {
  const rail = screen.getByRole('navigation', { name: 'Places' });
  await act(async () => { fireEvent.click(await within(rail).findByRole('button', { name: /Lumen Studio/ })); });
  const menu = await screen.findByRole('dialog', { name: 'Business menu for Lumen Studio' });
  await act(async () => { fireEvent.click(within(menu).getByRole('button', { name: 'New business' })); });
}
const methods = (calls: Call[]) => calls.map(([method]) => method);
afterEach(() => { vi.restoreAllMocks(); });

describe('New business: the same onboarding as the first business', () => {
  it('opens the first run steps, never the old one-sentence page, and closes the open business first', async () => {
    const env = start();
    env.show();
    await newBusiness();
    // Nothing connected in Lumen Studio that can be used again, so step 1 shows.
    expect(await screen.findByRole('heading', { name: 'Connect your AI' })).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Setup steps' })).toBeTruthy();
    for (const old of ['Pick a way to earn', 'Describe your business', 'Make my plan', 'Or describe it in one sentence', 'How starting works']) expect(screen.queryByText(old)).toBeNull();
    const sent = methods(env.calls);
    expect(sent).toContain('workspace.lock');
    expect(sent.indexOf('venture.ai.reuse')).toBeGreaterThan(sent.indexOf('workspace.lock'));
    for (const never of ['venture.country.suggest', 'venture.playbooks.list', 'venture.chief.fit', 'venture.blueprint.suggest', 'workspace.create']) expect(sent).not.toContain(never);
    // The app behind it is gone while the new business is set up: no rail, no Today.
    expect(screen.queryByRole('navigation', { name: 'Places' })).toBeNull();
  });

  it('with Codex already connected on this computer, step 1 is skipped: the AI is used again and the owner starts at "What work do you do?"', async () => {
    const env = start();
    await connectCodex(env);
    env.show();
    await newBusiness();
    expect(await screen.findByRole('heading', { name: 'What work do you do?' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Connect your AI' })).toBeNull();
    // The steps row says which AI is connected, as it does after a sign-in.
    expect(within(screen.getByRole('list', { name: 'Setup steps' })).getByText('Connected: ChatGPT plan')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: ABOUT_BOX })).toBeTruthy();
    expect(methods(env.calls)).not.toContain('venture.ai.tools');
  });

  it('the kept plan becomes the second business with its name, way to earn and team; the first business is one press away', async () => {
    const env = start();
    await connectCodex(env);
    env.show();
    await newBusiness();
    const box = await screen.findByRole('textbox', { name: ABOUT_BOX });
    fireEvent.change(box, { target: { value: AC } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
    const keep = await screen.findByRole('button', { name: 'Keep this plan' });
    await waitFor(() => expect(keep.hasAttribute('disabled')).toBe(false));
    await act(async () => { fireEvent.click(keep); });
    await answerSideWork();
    await toToday();
    // Today of the new business, named as the plan card named it.
    const rail = await screen.findByRole('navigation', { name: 'Places' }, { timeout: 4000 });
    expect(await within(rail).findByRole('button', { name: /Lucknow Cool Care/ })).toBeTruthy();
    const made = env.calls.find(([method]) => method === 'venture.create')![1];
    expect(made).toEqual({ idea: AC, countryCode: 'IN', workingName: 'Lucknow Cool Care' });
    expect(env.calls.find(([method]) => method === 'workspace.create')![1]).toMatchObject({ name: 'Lucknow Cool Care' });
    expect(env.calls.find(([method, params]) => method === 'venture.owner.set' && 'way' in params)![1]).toEqual({ way: WAY });
    expect(env.calls.find(([method]) => method === 'venture.agents.hire.team')![1]).toEqual({ agents: READ.team });
    const draft = env.calls.find(([method]) => method === 'venture.blueprint.draft')![1] as { shown: { name: string; by: string; offers: { name: string }[] } };
    expect([draft.shown.name, draft.shown.by, draft.shown.offers.map((offer) => offer.name)]).toEqual(['Lucknow Cool Care', 'model', ['Yearly AC contract', 'One-time AC service']]);
    // It uses the same AI as the first business, through the draft, and nothing of the old start was asked.
    const status = await env.fake.request('venture.models.status', {});
    expect(status.tiers.main.presetId).toBe('codex-cli');
    for (const never of ['venture.country.suggest', 'venture.playbooks.list']) expect(methods(env.calls)).not.toContain(never);
    // Both businesses are in the switcher, and the first opens again with one press.
    await act(async () => { fireEvent.click(within(rail).getByRole('button', { name: /Lucknow Cool Care/ })); });
    const menu = await screen.findByRole('dialog', { name: 'Business menu for Lucknow Cool Care' });
    await act(async () => { fireEvent.click(await within(menu).findByRole('button', { name: /Lumen Studio/ })); });
    expect(await within(await screen.findByRole('navigation', { name: 'Places' })).findByRole('button', { name: /Lumen Studio/ }, { timeout: 4000 })).toBeTruthy();
  });

  it('Back opens the business the owner came from again; "Open a business you already have" lists them all', async () => {
    const env = start();
    env.show();
    await newBusiness();
    await screen.findByRole('heading', { name: 'Connect your AI' });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Back to Lumen Studio' })); });
    expect(await within(await screen.findByRole('navigation', { name: 'Places' })).findByRole('button', { name: /Lumen Studio/ })).toBeTruthy();
    expect(env.calls.filter(([method]) => method === 'workspace.open').at(-1)![1]).toEqual({ folder: 'lumen' });

    await newBusiness();
    await screen.findByRole('heading', { name: 'Connect your AI' });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open a business you already have' })); });
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Lumen Studio/ })).toBeTruthy();
  });

  it('from Welcome back, "Start another business" uses the AI already connected here too', async () => {
    const env = start();
    await connectCodex(env);
    await env.fake.request('workspace.lock', {});
    env.show();
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Start another business' })); });
    expect(await screen.findByRole('heading', { name: 'What work do you do?' })).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Setup steps' })).getByText('Connected: ChatGPT plan')).toBeTruthy();
    // Back is the list of businesses, as before.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Back to your businesses' })); });
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeTruthy();
  });

  it('the first business on a computer is asked nothing about another one: step 1 shows at once', async () => {
    window.location.hash = '#/today';
    const fake = createFakeClient(new FakeEngine({ fresh: true }));
    const sent: string[] = [];
    const client: EngineClient = { ...fake, request: ((method: string, params?: unknown) => { sent.push(method); return fake.request(method as never, params as never); }) as EngineClient['request'] };
    render(<App client={client} language="en" />);
    expect(await screen.findByRole('heading', { name: 'Connect your AI' })).toBeTruthy();
    expect(sent).not.toContain('venture.ai.reuse');
  });

  it('a lock the engine refuses leaves the owner in the open business, with the engine\'s words in the menu', async () => {
    const env = start();
    const plain = env.client.request;
    env.client.request = ((method: string, params?: Record<string, unknown>) => (method === 'workspace.lock'
      ? Promise.reject(new EngineError('VAULT_BUSY', 'Chausar is still busy with a chat reply in this business. Wait for it to finish, then try again.'))
      : plain(method as never, params as never))) as EngineClient['request'];
    env.show();
    await newBusiness();
    expect((await screen.findByRole('alert')).textContent).toContain('still busy with a chat reply');
    expect(screen.getByRole('navigation', { name: 'Places' })).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Setup steps' })).toBeNull();
  });

  it('hosted web: New business shows the hosted start without closing the open business, and Back is the app as it was', async () => {
    window.location.hash = '#/today';
    const fake = createFakeClient(new FakeEngine({ hosted: true }));
    const sent: string[] = [];
    const client: EngineClient = { ...fake, transport: 'hosted', request: ((method: string, params?: unknown) => { sent.push(method); return fake.request(method as never, params as never); }) as EngineClient['request'] };
    render(<App client={client} language="en" />);
    await screen.findByRole('navigation', { name: 'Places' });
    await newBusiness();
    // The hosted web app adds an AI only after a business is kept: its start is the one box, as on its first run.
    expect(await screen.findByRole('textbox', { name: 'What do you want to start?' })).toBeTruthy();
    expect(sent).not.toContain('workspace.lock');
    expect(sent).not.toContain('venture.ai.reuse');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Back to Lumen Studio' })); });
    expect(await within(await screen.findByRole('navigation', { name: 'Places' })).findByRole('button', { name: /Lumen Studio/ })).toBeTruthy();
  });

  it('the address #/onboarding is no place any more: it lands on Today', async () => {
    const env = start();
    window.location.hash = '#/onboarding';
    env.show();
    expect(await screen.findByRole('heading', { level: 1, name: /Today|Good/ })).toBeTruthy();
    expect(screen.queryByText('Pick a way to earn')).toBeNull();
    expect(methods(env.calls)).not.toContain('venture.playbooks.list');
  });
});
