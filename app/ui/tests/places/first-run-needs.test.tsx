import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { EngineClient } from '../../src/engine/types';
import { CURATED_MCP_SERVERS } from '../../../../platform/runtime/venture/agent-runtime/mcp-registry';
import { assertInkRules } from '../helpers/ink-rules';
import { confirmProfession, skipAi } from './first-run-steps';

/**
 * Step 3 follows the plan the owner just kept (founder, 14 Nov 2026: "simplify the UI", and connect email, Monid,
 * Canva and the like for lead finding and documents during setup). The owner's AI names what the business needs beside
 * the way to earn; keeping the plan keeps those needs; the step then lists, per need and in the owner's words, the
 * ways Chausar can meet it today. Each row has its honest label, one line and one action: Set up where a real connect
 * flow exists (it opens in place, and setup stays where it was), "Nothing to set up" where it already works, or the
 * manual path where it is planned. Go to Today is always there, and skipping is that one click.
 */
const POTTER = 'I make pottery by hand, mostly mugs and bowls, and I want bulk orders from cafes and hotels in Pune.';
const CANVA = CURATED_MCP_SERVERS.find((entry) => entry.id === 'canva')!;
const READ = {
  family: null, profession: null, country: null, evidence: null, idea: POTTER, source: 'ai',
  offers: [{ name: 'Cafe mug sets', line: 'Handmade mugs in bulk for cafes' }],
  reply: 'You make pottery by hand and want bulk orders. Where are you based?',
  way: {
    customer: 'Independent cafes and small hotels in Pune that buy tableware in bulk.',
    reach: 'A list of cafes found from public listings, then a first message you send to each owner.',
    teamDoes: 'Finds the cafes, drafts each message and quote, and keeps track of who replied.',
    youDo: 'Make the samples, set the prices, send each message and take the calls.',
    firstWeek: ['Decide the set sizes and your price for each offer.', 'Approve the first list of cafes.'],
  },
  needs: ['find-customers', 'write-to-customers', 'designs-documents', 'payments'],
};
const TITLE = 'Connect what your business needs';

type Call = [string, Record<string, unknown>];
/** The Google Calendar card as the engine lists it (build/catalogue.ts and build/guides.ts); the fake's sample cards do not hold it. */
const CALENDAR_STEPS = ['In Google Calendar, open Settings, then your calendar, then Integrate calendar.', 'Copy the Secret address in iCal format.', 'Use the desktop app: paste it under Connections, as your calendar address.'];
function start(read: unknown = READ) {
  const original = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (this: Intl.DateTimeFormat) { return { ...original.call(this), timeZone: 'Asia/Kolkata' }; });
  window.location.hash = '#/today';
  const fake = createFakeClient(new FakeEngine({ fresh: true }));
  const calls: Call[] = [];
  const client: EngineClient = { ...fake, request: ((method: string, params?: Record<string, unknown>) => {
    calls.push([method, structuredClone(params ?? {})]);
    if (method === 'venture.about.read') return Promise.resolve(structuredClone(read));
    if (method === 'venture.connectors.list') {
      return fake.request('venture.connectors.list', {}).then((cards) => {
        const sample = cards.find((card) => card.guide)!;
        return [...cards, { ...structuredClone(sample), id: 'google-calendar', name: 'Google Calendar', guide: { ...structuredClone(sample.guide!), steps: [...CALENDAR_STEPS] } }];
      });
    }
    return fake.request(method as never, params as never);
  }) as EngineClient['request'] };
  render(<App client={client} language="en" />);
  return { calls, fake };
}

/** The sentence, Keep this plan, the side-work question; then step 3. field: the read named a listed field, so "Which of these are you?" comes first. */
async function toStepThree(field = false) {
  const box = await skipAi();
  fireEvent.change(box, { target: { value: POTTER } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
  const keep = await screen.findByRole('button', { name: 'Keep this plan' });
  await waitFor(() => expect(keep.hasAttribute('disabled')).toBe(false));
  await act(async () => { fireEvent.click(keep); });
  if (field) await confirmProfession();
  const check = await screen.findByRole('region', { name: 'Day job and rules' }, { timeout: 4000 });
  await act(async () => { fireEvent.click(within(check).getByRole('radio', { name: 'I am not sure' })); });
  await act(async () => { fireEvent.click(within(check).getByRole('button', { name: 'Continue' })); });
  await screen.findByRole('heading', { level: 1, name: TITLE }, { timeout: 4000 });
  await screen.findByRole('list', { name: 'To find customers' }, { timeout: 4000 });
}
const names = (list: HTMLElement) => within(list).getAllByRole('listitem').map((row) => row.querySelector('[data-need-name]')?.textContent);
const row = (name: string) => screen.getAllByRole('listitem').find((item) => item.querySelector('[data-need-name]')?.textContent === name)!;

afterEach(() => { vi.restoreAllMocks(); });

describe('first run, step 3: customers who are not places on a map', () => {
  it('says in one plain line that the public map lists places only, above the ways to find customers', async () => {
    const translator = {
      ...READ, idea: 'I translate between Hindi and English and make video subtitles for YouTube creators.',
      offers: [{ name: 'Video subtitles', line: 'Hindi or English subtitles for videos' }],
      way: { ...READ.way, customer: 'YouTube creators and small production houses pay for Hindi-English translation and video subtitles.', reach: 'Find potential YouTube creators through public sources and contacts you provide.' },
      needs: ['find-customers', 'write-to-customers'],
    };
    start(translator);
    const box = await skipAi();
    fireEvent.change(box, { target: { value: translator.idea } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
    const keep = await screen.findByRole('button', { name: 'Keep this plan' });
    await waitFor(() => expect(keep.hasAttribute('disabled')).toBe(false));
    await act(async () => { fireEvent.click(keep); });
    const check = await screen.findByRole('region', { name: 'Day job and rules' }, { timeout: 4000 });
    await act(async () => { fireEvent.click(within(check).getByRole('radio', { name: 'I am not sure' })); });
    await act(async () => { fireEvent.click(within(check).getByRole('button', { name: 'Continue' })); });
    await screen.findByRole('list', { name: 'To find customers' }, { timeout: 4000 });
    const note = document.querySelector('[data-need-note]');
    expect(note?.textContent).toBe('The public map lists places only, and your customers are not a kind of place on it. For now, add people you already know in Clients, or use a lead tool once you connect one.');
    // The ways stay listed with their honest labels: the owner may still use them.
    expect(names(screen.getByRole('list', { name: 'To find customers' }))).toEqual(['Public map', 'Monid']);
    assertInkRules();
  }, 20000);
});

describe('first run, step 3: the list follows the kept plan', () => {
  it('keeps the needs with the way, and lists them grouped by need in the owner\'s words', async () => {
    const { calls } = start();
    await toStepThree();
    const at = (method: string, has: string) => calls.findIndex(([name, params]) => name === method && has in params);
    expect(calls.find(([method, params]) => method === 'venture.owner.set' && 'needs' in params)?.[1]).toEqual({ needs: READ.needs });
    expect(at('venture.owner.set', 'needs')).toBeGreaterThan(at('venture.owner.set', 'way'));
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual(['To find customers', 'To write to customers', 'To make designs and documents', 'To get paid']);
    expect(names(screen.getByRole('list', { name: 'To find customers' }))).toEqual(['Public map', 'Monid']);
    // WhatsApp stands beside Gmail (15 Nov 2026: a tradesman's customers reply on WhatsApp), with its honest label.
    expect(names(screen.getByRole('list', { name: 'To write to customers' }))).toEqual(['Gmail', 'WhatsApp']);
    // Cafes are places on the public map, so the need to find customers says nothing more.
    expect(document.querySelector('[data-need-note]')).toBeNull();
    expect(names(screen.getByRole('list', { name: 'To make designs and documents' }))).toEqual(['Canva']);
    expect(names(screen.getByRole('list', { name: 'To get paid' }))).toEqual(['Razorpay']);
    // What a potter was offered before, by the field alone, is gone.
    const words = screen.getByRole('main').textContent ?? '';
    for (const gone of ['Google Drive', 'Sunra', 'YouTube', 'Telegram alerts']) expect(words).not.toContain(gone);
    assertInkRules();
  }, 20000);

  it('gives each row its honest label, one line, and one action by what is real', async () => {
    start();
    await toStepThree();
    // It already works and needs nothing: no button.
    const map = within(row('Public map'));
    expect(map.getByText('Reads')).toBeTruthy();
    expect(map.getByText('Nothing to set up')).toBeTruthy();
    expect(map.queryByRole('button')).toBeNull();
    const gmail = within(row('Gmail'));
    expect(gmail.getByText('You send it')).toBeTruthy();
    expect(gmail.getByText('Nothing to set up')).toBeTruthy();
    expect(gmail.queryByRole('button')).toBeNull();
    // Planned with a real connect flow (your own account): it says what it waits on, and offers Set up.
    for (const name of ['Monid', 'Canva']) {
      const tool = within(row(name));
      expect(tool.getByText('Planned')).toBeTruthy();
      expect(tool.getByText(new RegExp(`^Needs your own ${name} account.*Not tried on a live account yet\\.`))).toBeTruthy();
      expect(tool.getAllByRole('button').map((button) => button.textContent)).toEqual(['Set up']);
    }
    // WhatsApp is planned: Chausar drafts, the owner sends from their own WhatsApp. Nothing to press, nothing claimed.
    const whatsapp = within(row('WhatsApp'));
    expect(whatsapp.getByText('Planned')).toBeTruthy();
    expect(whatsapp.getByText('For customers who reply on WhatsApp. Chausar drafts each message, and you send it from your own WhatsApp.')).toBeTruthy();
    expect(whatsapp.getByText("Chausar's WhatsApp link is coming later. Use WhatsApp on its own until then.")).toBeTruthy();
    expect(whatsapp.queryByRole('button')).toBeNull();
    expect(whatsapp.queryByText('Nothing to set up')).toBeNull();
    // Planned with nothing to connect: the manual path, and nothing to press.
    const pay = within(row('Razorpay'));
    expect(pay.getByText('Planned')).toBeTruthy();
    expect(pay.getByText("Chausar's Razorpay link is coming later. For now, share your UPI or bank details and mark payments yourself.")).toBeTruthy();
    expect(pay.queryByRole('button')).toBeNull();
    expect(pay.queryByText('Nothing to set up')).toBeNull();
    // One action a row at most, no Skip on any, and the one filled button is the way on.
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
    expect([...document.querySelectorAll('main [data-variant="primary"]')].map((button) => button.textContent)).toEqual(['Go to Today']);
  }, 20000);

  it('Set up opens the connect flow in place: the server is saved with the owner\'s exact approval, and setup stays', async () => {
    const { calls, fake } = start();
    await toStepThree();
    const login = screen.queryByRole('checkbox', { name: /Start Chausar when/ }) as HTMLInputElement | null;
    const canva = row('Canva');
    await act(async () => { fireEvent.click(within(canva).getByRole('button', { name: 'Set up' })); });
    const flow = await within(canva).findByRole('group', { name: 'Set up Canva' });
    // The exact connection the approval is for, with the registry's own words for it.
    expect(within(flow).getByText((CANVA.server as { url: string }).url).closest('[data-content]')).not.toBeNull();
    expect(within(flow).getByText(CANVA.about)).toBeTruthy();
    expect(within(flow).getByText("Uses the service's own sign-in. Can change things, so calls ask you.")).toBeTruthy();
    const add = await within(flow).findByRole('button', { name: 'Add Canva' });
    expect(add.getAttribute('aria-disabled')).toBe('true');
    expect(calls.some(([method]) => method === 'venture.agentSettings.set')).toBe(false);
    await act(async () => { fireEvent.click(within(flow).getByRole('checkbox', { name: 'Let your agents use exactly what is shown here in future jobs. Anything that can change something still asks you first.' })); });
    await act(async () => { fireEvent.click(within(flow).getByRole('button', { name: 'Add Canva' })); });
    // Its own sign-in is the next step, in the same place. Nothing here signs in.
    expect(await within(flow).findByRole('button', { name: 'Sign in' })).toBeTruthy();
    const saved = calls.filter(([method]) => method === 'venture.agentSettings.set');
    expect(saved).toHaveLength(1);
    expect(saved[0]![1].approveMcpConfiguration).toBe(true);
    expect((saved[0]![1].settings as { mcpServers: unknown[] }).mcpServers).toEqual([CANVA.server]);
    expect(((await fake.request('venture.agentSettings.get', {})) as { settings: { mcpServers: unknown[] } }).settings.mcpServers).toEqual([CANVA.server]);
    expect(calls.some(([method]) => method === 'venture.mcpOAuth.start')).toBe(false);
    // Setup did not move: the same step, the same address, the same answers.
    expect(screen.getByRole('heading', { level: 1, name: TITLE })).toBeTruthy();
    expect(window.location.hash).toBe('#/today');
    expect(screen.queryByRole('navigation')).toBeNull();
    if (login) expect((screen.getByRole('checkbox', { name: /Start Chausar when/ }) as HTMLInputElement).checked).toBe(login.checked);
    assertInkRules();
    // Close puts the row back as it was, and the way on is still one click.
    await act(async () => { fireEvent.click(within(flow).getByRole('button', { name: 'Close' })); });
    expect(within(canva).queryByRole('group', { name: 'Set up Canva' })).toBeNull();
    expect(within(canva).getByRole('button', { name: 'Set up' }).getAttribute('aria-expanded')).toBe('false');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Go to Today' })); });
    await waitFor(() => expect(window.location.hash).toBe('#/today'));
    expect(await screen.findByRole('navigation', {}, { timeout: 4000 })).toBeTruthy();
  }, 20000);

  it('skipping everything is one click, with a connect flow open or not, and connects nothing', async () => {
    const { calls } = start();
    await toStepThree();
    await act(async () => { fireEvent.click(within(row('Monid')).getByRole('button', { name: 'Set up' })); });
    expect(await within(row('Monid')).findByRole('group', { name: 'Set up Monid' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Go to Today' })).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Go to Today' })); });
    await waitFor(() => expect(window.location.hash).toBe('#/today'));
    expect(await screen.findByRole('navigation', {}, { timeout: 4000 })).toBeTruthy();
    expect(calls.some(([method]) => method === 'venture.agentSettings.set' || method === 'venture.mcpOAuth.start')).toBe(false);
  }, 20000);

  it('after setup, Connections shows the same grouped list first', async () => {
    start();
    await toStepThree();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Go to Today' })); });
    await screen.findByRole('navigation', {}, { timeout: 4000 });
    await act(async () => { window.location.hash = '#/connections'; });
    const list = await screen.findByRole('list', { name: 'To find customers' }, { timeout: 4000 });
    expect(names(list)).toEqual(['Public map', 'Monid']);
    const ai = await screen.findByRole('heading', { name: 'Your AI' }, { timeout: 4000 });
    expect(list.compareDocumentPosition(ai) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The list stays for later: nothing to leave from here.
    expect(screen.queryByRole('button', { name: 'Go to Today' })).toBeNull();
  }, 20000);

  it('says fewer words than the field\'s list did for the same potter, filed under Creative work', async () => {
    const { fake } = start({ ...READ, family: { id: 'creative', label: 'Creative work', line: 'Design, photos, video and writing.' } });
    await toStepThree(true);
    const count = (text: string) => text.split(/\s+/).filter(Boolean).length;
    const section = screen.getByRole('heading', { level: 1, name: TITLE }).closest('section')!;
    const now = count([...section.querySelectorAll('h2, li')].map((part) => part.textContent ?? '').join(' '));
    // The same business with no need kept is offered the field's list. Before, each of its rows also had Skip, and
    // Set up where it worked: seven rows for Creative work, six of them planned.
    await fake.request('venture.owner.set', { needs: null });
    const field = await fake.request('venture.needs.list', {});
    expect(field.needs.map((need) => need.name)).toEqual(['Google Drive', 'Sunra', 'YouTube', 'Razorpay', 'Gmail', 'WhatsApp', 'Telegram alerts']);
    const chip = { write: 'Writes', read: 'Reads', handoff: 'You send it', planned: 'Planned' };
    const before = field.needs.reduce((sum, need) => sum + count([need.name, chip[need.label], need.why, need.label === 'planned' ? `${need.waitsOn} ${need.meanwhile}` : 'Set up', 'Skip'].join(' ')), 0);
    expect(now).toBeLessThan(before);
    expect(section.querySelectorAll('li').length).toBeLessThan(field.needs.length);
  }, 20000);
});

describe('first run, step 3: with no need kept, the field\'s list in the same rows', () => {
  const FIELD = { family: { id: 'teaching', label: 'Teaching and coaching', line: 'Classes, tuition and coaching.' }, profession: null, country: null, evidence: null, idea: 'Tuition classes for school students in Pune.', source: 'ai', offers: [{ name: 'Weekly classes', line: 'Small batches with practice work' }] };

  it('lists what the field would use, ungrouped, and a card\'s Set up shows its own guide in place', async () => {
    const { calls } = start(FIELD);
    const box = await skipAi();
    fireEvent.change(box, { target: { value: POTTER } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
    const keep = await screen.findByRole('button', { name: 'Keep this plan' });
    await waitFor(() => expect(keep.hasAttribute('disabled')).toBe(false));
    await act(async () => { fireEvent.click(keep); });
    await confirmProfession();
    const check = await screen.findByRole('region', { name: 'Day job and rules' }, { timeout: 4000 });
    await act(async () => { fireEvent.click(within(check).getByRole('radio', { name: 'I am not sure' })); });
    await act(async () => { fireEvent.click(within(check).getByRole('button', { name: 'Continue' })); });
    const list = await screen.findByRole('list', { name: 'Services for Teaching and coaching' }, { timeout: 4000 });
    // No way was proposed, so no need was kept, and nothing is grouped.
    expect(calls.some(([method, params]) => method === 'venture.owner.set' && 'needs' in params)).toBe(false);
    expect(screen.queryAllByRole('heading', { level: 2 })).toEqual([]);
    expect(names(list)).toEqual(['Google Calendar', 'WhatsApp', 'Razorpay', 'Tally forms', 'Telegram alerts', 'Phone approvals']);
    const calendar = row('Google Calendar');
    expect(within(calendar).getByText('Reads')).toBeTruthy();
    await act(async () => { fireEvent.click(within(calendar).getByRole('button', { name: 'Set up' })); });
    const flow = await within(calendar).findByRole('group', { name: 'Set up Google Calendar' });
    for (const step of CALENDAR_STEPS) expect(await within(flow).findByText(step)).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: TITLE })).toBeTruthy();
    expect(window.location.hash).toBe('#/today');
    expect(screen.queryByRole('navigation')).toBeNull();
    // A planned row shows its manual path and nothing to press.
    expect(within(row('WhatsApp')).getByText("Chausar's WhatsApp link is coming later. Use WhatsApp on its own until then.")).toBeTruthy();
    expect(within(row('WhatsApp')).queryByRole('button')).toBeNull();
    assertInkRules();
  }, 20000);
});

describe('step 3 on a phone', () => {
  const css = readFileSync(join(import.meta.dirname, '../../src/places/onboarding/FirstRun.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (selector: string) => new RegExp(`\\${selector} \\{([^}]*)\\}`).exec(css)?.[1] ?? '';
  it('a row wraps, and its connect flow takes the whole row with words that break, so nothing scrolls sideways at 390 px', () => {
    expect(rule('.need')).toMatch(/flex-wrap:\s*wrap/);
    expect(rule('.needText')).toMatch(/min-width:\s*0/);
    expect(rule('.needFlow')).toMatch(/flex:\s*1 1 100%/);
    expect(rule('.needFlow')).toMatch(/min-width:\s*0/);
    expect(rule('.needFlow')).toMatch(/overflow-wrap:\s*anywhere/);
    expect(css).not.toMatch(/\.need[A-Za-z]* \{[^}]*(?:white-space:\s*nowrap|min-width:\s*[1-9]\d{2,}px)/);
  });
});
