import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { FAKE_DEVICE_CODE } from '../../src/engine/fake-first-run';
import type { EngineClient, ModelStatusLite } from '../../src/engine/types';
import { answerSideWork } from './first-run-steps';

/**
 * W6 first run: Connect your AI (6C1), About you as A that becomes B (6C2, DECISIONS D16a) and Connect what your
 * business needs (6C7), on the fake engine, which answers as the engine does.
 */
const CA = "I'm a CA with six years in audit and want to do books and GST for small shops near me.";

function timeZone(zone: string) {
  const original = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (this: Intl.DateTimeFormat) {
    return { ...original.call(this), timeZone: zone };
  });
}
function reducedMotion(on: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: on && query.includes('prefers-reduced-motion'), media: query, onchange: null,
    addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }) as MediaQueryList);
}
function start(engine = new FakeEngine({ fresh: true })) {
  window.location.hash = '#/today';
  const fake = createFakeClient(engine);
  const calls: [string, Record<string, unknown>][] = [];
  const client: EngineClient = { ...fake, request: ((method: string, params?: Record<string, unknown>) => { calls.push([method, structuredClone(params ?? {})]); return fake.request(method as never, params as never); }) as EngineClient['request'] };
  render(<App client={client} language="en" />);
  return { engine, calls };
}
async function press(name: string | RegExp) { const button = await screen.findByRole('button', { name }, { timeout: 4000 }); await act(async () => { fireEvent.click(button); }); }
async function skipAi() { await press('Skip for now: use templates'); }

afterEach(() => { vi.restoreAllMocks(); });

describe('first run, step 1: Connect your AI', () => {
  it('shows the three ways in, the tools as found, and the way on with templates', async () => {
    timeZone('Asia/Kolkata');
    start();
    expect(await screen.findByRole('heading', { level: 1, name: 'Connect your AI' })).toBeTruthy();
    expect(await screen.findByText('Codex installed')).toBeTruthy();
    expect(screen.getByText('Not installed yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in with Codex' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add a key' })).toBeTruthy();
    const steps = screen.getByRole('list', { name: 'Setup steps' });
    expect(within(steps).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['1Connect your AI', '2About you', '3Your business']);
  });

  it("starts Codex's own sign-in and shows its code and link, then uses the signed-in Codex", async () => {
    const { calls } = start();
    await press('Sign in with Codex');
    expect(calls.some(([method, params]) => method === 'venture.ai.login.start' && params.cli === 'codex')).toBe(true);
    expect(await screen.findByText(FAKE_DEVICE_CODE, {}, { timeout: 4000 })).toBeTruthy();
    expect(screen.getByRole('heading', { name: "Finish signing in on OpenAI's page" })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open the sign-in page again' })).toBeTruthy();
    // The fake Codex finishes after three looks; the tool's own status then says signed in.
    expect(await screen.findByText('Signed in', {}, { timeout: 8000 })).toBeTruthy();
    await press('Use Codex');
    expect(calls.some(([method, params]) => method === 'venture.ai.connect' && params.presetId === 'codex-cli' && typeof params.consentDigest === 'string')).toBe(true);
    expect(await screen.findByRole('heading', { level: 1, name: 'What do you do today?' })).toBeTruthy();
    expect(screen.getByText('Connected: ChatGPT plan')).toBeTruthy();
  }, 15000);

  it('never starts a sign-in for a tool that already says it is signed in', async () => {
    const engine = new FakeEngine({ fresh: true });
    engine.firstRun.signIn();
    const { calls } = start(engine);
    expect(await screen.findByText('Signed in')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sign in with Codex' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Use Codex' })).toBeTruthy();
    expect(calls.some(([method]) => method === 'venture.ai.login.start')).toBe(false);
  });
});

describe('first run, step 1: the Codex Chausar runs (A2)', () => {
  it('shows the owner’s own Codex as found and asks first; it can be signed in only after the owner chooses it', async () => {
    const engine = new FakeEngine({ fresh: true });
    engine.firstRun.reviewCodex();
    const { calls } = start(engine);
    expect(await screen.findByText('Codex 0.166.0 is on this computer and has what Chausar needs. Use it?')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sign in with Codex' })).toBeNull();
    await press('Use this Codex');
    expect(calls.find(([method]) => method === 'venture.ai.setup.trust')?.[1]).toEqual({ cli: 'codex', sha256: 'c'.repeat(64) });
    expect(await screen.findByRole('button', { name: 'Sign in with Codex' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Use this Codex' })).toBeNull();
  });
});

describe('first run, step 2: About you, A that becomes B', () => {
  it('opens as A: the message box, the country from the time zone, and the eleven field tiles', async () => {
    timeZone('Asia/Kolkata');
    start();
    await skipAi();
    expect(await screen.findByRole('heading', { level: 1, name: 'What do you do today?' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Tell Chausar about your work' })).toBeTruthy();
    expect(await screen.findByText('India, from your time zone')).toBeTruthy();
    expect(await screen.findByRole('button', { name: /^Money and tax/ })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^(Money and tax|Teaching and coaching|Creative work|Writing and content|Local services|Documents and reports|Research and analysis|People and careers|Shop and back office|Tech services|Licensed work)/ })).toHaveLength(11);
    expect(screen.getByRole('button', { name: /^Something else/ })).toBeTruthy();
  });

  it('does not change while the owner types; Send turns it into B with one motion, and Back to fields returns to A', async () => {
    reducedMotion(false);
    const { calls } = start();
    await skipAi();
    const box = await screen.findByRole('textbox', { name: 'Tell Chausar about your work' });
    fireEvent.change(box, { target: { value: CA.slice(0, 20) } });
    fireEvent.change(box, { target: { value: CA } });
    expect(screen.queryByRole('region', { name: 'Talk to Chausar' })).toBeNull();
    expect(calls.some(([method]) => method === 'venture.about.read')).toBe(false);
    await press('Send');
    const chat = await screen.findByRole('region', { name: 'Talk to Chausar' });
    const preview = screen.getByRole('region', { name: 'Your business, live' });
    expect(chat.closest('[data-motion]')?.getAttribute('data-motion')).toBe('once');
    expect(chat.className).toMatch(/rise/);
    expect(preview.className).toMatch(/slide/);
    expect(within(chat).getByText(CA)).toBeTruthy();
    expect(calls.find(([method]) => method === 'venture.about.read')?.[1]).toEqual({ text: CA });
    // No AI is connected: the keyword guess picks Money and tax and says so; offers carry no amount.
    expect(await within(chat).findByText('No AI is connected, so this plan comes from templates for Money and tax.')).toBeTruthy();
    expect(within(preview).getByText('Monthly books')).toBeTruthy();
    expect(preview.textContent).not.toMatch(/₹|\d/);
    await press('Back to fields');
    expect(await screen.findByRole('heading', { level: 1, name: 'What do you do today?' })).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Tell Chausar about your work' }) as HTMLTextAreaElement).value).toBe(CA);
  });

  it('moves nothing with reduced motion', async () => {
    reducedMotion(true);
    start();
    await skipAi();
    fireEvent.change(await screen.findByRole('textbox', { name: 'Tell Chausar about your work' }), { target: { value: CA } });
    await press('Send');
    const chat = await screen.findByRole('region', { name: 'Talk to Chausar' });
    expect(chat.closest('[data-motion]')?.getAttribute('data-motion')).toBe('none');
  });

  it('a tile goes straight to the plan with no chat, and the field can be corrected there', async () => {
    const { calls } = start();
    await skipAi();
    await press(/^Teaching and coaching/);
    const preview = await screen.findByRole('region', { name: 'Your business, live' });
    expect(screen.queryByRole('region', { name: 'Talk to Chausar' })).toBeNull();
    expect(within(preview).getByText('Weekly classes')).toBeTruthy();
    expect(calls.find(([method]) => method === 'venture.about.pick')?.[1]).toEqual({ familyId: 'teaching' });
    await act(async () => { fireEvent.change(within(preview).getByRole('combobox', { name: 'Field' }), { target: { value: 'creative' } }); });
    expect(await within(preview).findByText('Video edits')).toBeTruthy();
    await press('Back to fields');
    expect(await screen.findByRole('heading', { level: 1, name: 'What do you do today?' })).toBeTruthy();
  });
});

describe('first run: the side-work question (6C6, DECISIONS D5)', () => {
  it('asks it once the field is kept, locks Continue until answered, and records the answer after the business is made', async () => {
    timeZone('Asia/Kolkata');
    const { calls } = start();
    await skipAi();
    await press(/^Teaching and coaching/);
    await press('Keep this plan');
    const check = await screen.findByRole('region', { name: 'Day job and rules' }, { timeout: 4000 });
    expect(screen.getByRole('heading', { level: 1, name: 'Day job and rules' })).toBeTruthy();
    expect(within(check).getByRole('group', { name: 'Does your employment contract allow side work? This is your responsibility.' })).toBeTruthy();
    expect(within(check).getByText('Chausar does not read your contract. You decide, and you are responsible for it.')).toBeTruthy();
    expect(calls.find(([method]) => method === 'venture.compliance.get')?.[1]).toEqual({ profession: 'teaching' });
    // Nothing is kept yet: the vault waits for the answer.
    expect(calls.some(([method]) => method === 'workspace.create')).toBe(false);
    expect(within(check).getByRole('button', { name: 'Continue' }).getAttribute('aria-disabled')).toBe('true');
    await act(async () => { fireEvent.click(within(check).getByRole('radio', { name: 'I am not sure' })); });
    await act(async () => { fireEvent.click(within(check).getByRole('button', { name: 'Continue' })); });
    expect(await screen.findByRole('heading', { level: 1, name: 'Connect what your business needs' }, { timeout: 4000 })).toBeTruthy();
    const made = calls.findIndex(([method]) => method === 'venture.create');
    const set = calls.findIndex(([method]) => method === 'venture.compliance.set');
    expect(made).toBeGreaterThan(-1);
    expect(set).toBeGreaterThan(made);
    expect(calls[set]![1]).toMatchObject({ profession: 'teaching', sideWork: 'not-sure' });
  }, 20000);
});

describe('first run, step 3: Connect what your business needs', () => {
  it('keeps the plan, saves the field, lists the services with honest labels, and skipping everything opens Today', async () => {
    timeZone('Asia/Kolkata');
    const { calls } = start();
    await skipAi();
    await press(/^Teaching and coaching/);
    await press('Keep this plan');
    await answerSideWork();
    // The fake computer keeps its key: no passphrase, and the recovery code only on hosted.
    expect(await screen.findByRole('heading', { level: 1, name: 'Connect what your business needs' }, { timeout: 4000 })).toBeTruthy();
    expect(calls.find(([method]) => method === 'venture.create')?.[1]).toMatchObject({ idea: 'Tuition classes and lessons for students and adult learners', countryCode: 'IN' });
    expect(calls.find(([method]) => method === 'venture.owner.set')?.[1]).toEqual({ familyId: 'teaching' });
    const list = await screen.findByRole('list', { name: 'Services for Teaching and coaching' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((row) => row.querySelector('[class*="needName"]')?.textContent)).toEqual(['Google Calendar', 'WhatsApp', 'Razorpay', 'Tally forms', 'Telegram alerts', 'Tailscale']);
    expect(within(rows[0]!).getByText('Reads')).toBeTruthy();
    expect(within(rows[0]!).getByRole('button', { name: 'Set up' })).toBeTruthy();
    // A planned service says what it waits on and offers nothing to connect.
    expect(within(rows[4]!).getByText('Planned')).toBeTruthy();
    expect(within(rows[4]!).queryByRole('button', { name: 'Set up' })).toBeNull();
    for (const row of rows) await act(async () => { fireEvent.click(within(row).getByRole('button', { name: 'Skip' })); });
    await press('Go to Today');
    await waitFor(() => expect(window.location.hash).toBe('#/today'));
    expect(await screen.findByRole('navigation', {}, { timeout: 4000 })).toBeTruthy();
  });
});

describe('the fresh first run, walked to Today (6J4 guide walk)', () => {
  it('after Use Codex, Today has no Connect your AI card: the AI came along into the business', async () => {
    timeZone('Asia/Kolkata');
    const engine = new FakeEngine({ fresh: true });
    engine.firstRun.signIn();
    start(engine);
    await press('Use Codex');
    await press(/^Teaching and coaching/);
    await press('Keep this plan');
    await answerSideWork();
    await press('Go to Today');
    await waitFor(() => expect(window.location.hash).toBe('#/today'));
    expect((await screen.findAllByText('Your plan is ready. Read it.', {}, { timeout: 4000 })).length).toBeGreaterThan(0);
    expect(screen.queryAllByText('Connect your AI')).toEqual([]);
    // As the engine's handover does: the business has the AI, and the draft desk is wiped.
    const models = await engine.request('venture.models.status', {}) as ModelStatusLite;
    expect(models.tiers.main.presetId).toBe('codex-cli');
    expect(models.connections.filter((c) => c.status === 'connected').map((c) => c.presetId)).toEqual(['codex-cli']);
    expect(((await engine.request('venture.ai.status', {})) as ModelStatusLite).connections).toEqual([]);
  }, 20000);

  it('skipping the AI still leaves the Connect your AI card on Today', async () => {
    timeZone('Asia/Kolkata');
    start();
    await skipAi();
    await press(/^Teaching and coaching/);
    await press('Keep this plan');
    await answerSideWork();
    await press('Go to Today');
    expect((await screen.findAllByText('Connect your AI', {}, { timeout: 4000 })).length).toBeGreaterThan(0);
  }, 20000);
});

describe('Connections: the services this business needs', () => {
  it('lists the same services on their own page, with a quiet way there from Connections', async () => {
    window.location.hash = '#/connections';
    render(<App client={createFakeClient(new FakeEngine({ now: () => '2026-10-23T13:35:00.000Z' }))} language="en" />);
    const link = await screen.findByRole('link', { name: 'Services you need' }, { timeout: 4000 });
    expect(link.getAttribute('href')).toBe('#/connections/needs');
    await act(async () => { window.location.hash = '#/connections/needs'; });
    const list = await screen.findByRole('list', { name: /^Services for/ }, { timeout: 4000 });
    expect(within(list).getAllByRole('listitem').length).toBeGreaterThan(0);
    // Nothing to skip here: the list stays for later.
    expect(within(list).queryByRole('button', { name: 'Skip' })).toBeNull();
  });
});

describe('one-shot A1 row 3: the plan saved is the plan shown', () => {
  it('Keep this plan saves exactly the name and offers the card showed, with a neutral price unit', async () => {
    timeZone('Asia/Kolkata');
    const fake = createFakeClient(new FakeEngine({ fresh: true }));
    const read = {
      family: { id: 'creative', label: 'Creative work', line: 'Design, photos, video and writing.' },
      offers: [
        { name: 'Birthday party photography', line: 'Candid photos of the party, edited and shared.' },
        { name: 'Shop product photos', line: 'Clean photos of what a shop sells.' },
        { name: 'Monthly photo support', line: 'A set of photos each month for a shop.' },
      ],
      country: null, evidence: null, idea: 'Photography for parties and shops in Pune', source: 'ai' as const,
    };
    const client: EngineClient = { ...fake, request: ((method: string, params?: Record<string, unknown>) => (method === 'venture.about.read' ? Promise.resolve(structuredClone(read)) : fake.request(method as never, params as never))) as EngineClient['request'] };
    window.location.hash = '#/today';
    render(<App client={client} language="en" />);
    await skipAi();
    fireEvent.change(await screen.findByRole('textbox', { name: 'Tell Chausar about your work' }), { target: { value: 'I run a small weekend photography studio in Pune.' } });
    await press('Send');
    expect(await screen.findByText('Birthday party photography')).toBeTruthy();
    const shownName = (await screen.findByText((_, node) => node?.className?.toString().includes('name') === true && node.tagName === 'P' && node.getAttribute('data-content') === '' && (node.textContent ?? '').length > 0)).textContent;
    const keep = await screen.findByRole('button', { name: 'Keep this plan' });
    await waitFor(() => expect(keep.hasAttribute('disabled')).toBe(false));
    await act(async () => { fireEvent.click(keep); });
    await answerSideWork();
    expect(await screen.findByRole('heading', { level: 1, name: 'Connect what your business needs' }, { timeout: 4000 })).toBeTruthy();
    const plan = (await fake.request('venture.blueprint.get', {}))!;
    expect(plan.blueprint.offers.map((offer) => offer.name.value)).toEqual(['Birthday party photography', 'Shop product photos', 'Monthly photo support']);
    expect(plan.blueprint.offers[0]!.description.value).toBe('Candid photos of the party, edited and shared.');
    expect(plan.blueprint.name.value).toBe(shownName);
    // Review of A1 (row 3): no template offer is left and no per month. The reading here was scripted, so this business
    // holds no AI call that read the owner, and (A1 re-review) the words are labelled the template's, not the AI's.
    expect(plan.blueprint.source).toBe('template');
    expect(plan.blueprint.offers.every((offer) => offer.name.by === 'template' && offer.pricing.model === 'project')).toBe(true);
    expect(plan.blueprint.version).toBe(1);
  });
});
