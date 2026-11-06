import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient, type FakeOptions } from '../../src/engine/fake';
import { createStatusStore } from '../../src/engine/client';
import { EngineError, type EngineClient, type Transport } from '../../src/engine/types';
import { ABOUT_BOX, answerSideWork, confirmProfession, keepPlan, skipAi, toToday } from './first-run-steps';

const IDEA = 'Monthly bookkeeping for cafes and small shops in Pune.';
function timeZone(zone: string) {
  const original = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (this: Intl.DateTimeFormat) {
    return { ...original.call(this), timeZone: zone };
  });
}

/** The fake engine behind a client that writes down every request, and can refuse the next call of a method once. */
function start(options: FakeOptions = { fresh: true }, { hash = '#/today', language = 'en', transport }: { hash?: string; language?: 'en'; transport?: Transport } = {}) {
  window.location.hash = hash;
  const engine = new FakeEngine(options);
  const fake = createFakeClient(engine);
  const calls: [string, Record<string, unknown>][] = [];
  const refusals = new Map<string, EngineError>();
  /** C4: a method answered by the test in place of the fake. */
  const answers = new Map<string, (params: Record<string, unknown>) => unknown>();
  const client: EngineClient = {
    ...fake,
    transport: transport ?? fake.transport,
    request: ((method: string, params?: Record<string, unknown>) => {
      calls.push([method, structuredClone(params ?? {})]);
      const refusal = refusals.get(method);
      if (refusal) { refusals.delete(method); return Promise.reject(refusal); }
      const answer = answers.get(method);
      if (answer) return Promise.resolve(answer(params ?? {}));
      return fake.request(method as never, params as never);
    }) as EngineClient['request'],
  };
  const view = render(<App client={client} language={language} />);
  /** The onboarding calls only, from the preview on. */
  const flow = () => calls.slice(calls.findIndex(([m]) => m === 'venture.preview')).filter(([m]) => /^(venture\.(preview|create|interview|blueprint)|workspace\.(status|create|lock))/.test(m));
  return { engine, client, calls, flow, answers, refuse: (method: string, error: EngineError) => refusals.set(method, error), ...view };
}

// Inside the app the engine lists ways to earn (W4 4J21), so the box there is "Or describe it in one sentence".
const box = () => screen.findByRole('textbox', { name: /^(What do you want to start\?|Or describe it in one sentence)$/ });
async function type(text: string) { fireEvent.change(await box(), { target: { value: text } }); }
async function press(name: string | RegExp) { await act(async () => { fireEvent.click(screen.getByRole('button', { name })); }); }
// A card's own title, not the next best step tile above the cards that repeats the first one (W4 4I2, an h2).
const cardTitle = (title: string) => screen.getAllByText(title).filter((node) => !node.closest('h2, [aria-hidden="true"], [inert]'));
const titles = (titlesInOrder: string[]) => titlesInOrder.map((title) => {
  const [node, ...more] = cardTitle(title);
  expect(more, title).toHaveLength(0);
  return node!;
});
function inOrder(nodes: HTMLElement[]) {
  for (let i = 1; i < nodes.length; i++) expect(nodes[i - 1]!.compareDocumentPosition(nodes[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
}

describe('onboarding: first run', () => {
  // W6 6C1/6C2: the first run opens on Connect your AI; About you holds the box and the country from the time zone.
  it('opens on Connect your AI, then About you with one box and the country and currency from the time zone', async () => {
    timeZone('Asia/Kolkata');
    start();
    expect(await screen.findByRole('heading', { level: 1, name: 'Connect your AI' }, { timeout: 4000 })).toBeTruthy();
    expect(screen.getByText('Chausar')).toBeTruthy();
    expect(screen.queryByRole('navigation')).toBeNull();
    const main = screen.getByRole('main');
    // A computer with no business yet also offers one quiet way to a business that exists elsewhere (moved, restored).
    expect(within(main).getByRole('button', { name: 'Open a business you already have' })).toBeTruthy();
    await skipAi();
    expect(await screen.findByText('India, from your time zone')).toBeTruthy();
    expect(screen.getByText('INR')).toBeTruthy();
    expect(within(main).getByRole('heading', { level: 1 }).textContent).toBe('What work do you do?');
  });

  it('lets the owner change the country, and uses "another country" for an unsupported time zone', async () => {
    timeZone('America/Sao_Paulo');
    const { flow } = start();
    await skipAi();
    expect(await screen.findByText('Another country (prices in US dollars)')).toBeTruthy();
    await press('Change');
    const country = screen.getByRole('combobox', { name: 'Country' }) as HTMLSelectElement;
    expect(country.value).toBe('XX');
    fireEvent.change(country, { target: { value: 'GB' } });
    await keepPlan(IDEA);
    await toToday();
    await screen.findByRole('navigation', { name: 'Places' });
    expect(flow()[0]).toEqual(['venture.preview', { idea: IDEA, countryCode: 'GB' }]);
  });

  it('on Keep this plan: preview, the vault, create, the template interview and the plan, in the engine order; then Today with the plan first', async () => {
    timeZone('Asia/Kolkata');
    const { flow } = start();
    await skipAi();
    await screen.findByText('India, from your time zone');
    await keepPlan(`  ${IDEA}  `);
    await toToday();
    await screen.findByRole('navigation', { name: 'Places' });
    expect(window.location.hash).toBe('#/today');
    // About you names the plan with the engine's preview; keeping it keeps that name (one-shot A1 row 3), then makes the vault.
    expect(flow()).toEqual([
      ['venture.preview', { idea: IDEA, countryCode: 'IN' }],
      ['workspace.status', {}],
      ['workspace.create', { name: 'Bookkeeping studio', pack: 'services', folder: null }],
      ['venture.create', { idea: IDEA, countryCode: 'IN', workingName: 'Bookkeeping studio' }],
      ['venture.interview.next', { useTemplate: true }],
      ['venture.interview.answer', { questionId: 'q_1', answer: { skipped: true } }],
      ['venture.interview.answer', { questionId: 'q_pricing_model', answer: { choiceId: 'monthly' } }],
      ['venture.interview.answer', { questionId: 'q_price', answer: { skipped: true } }],
      ['venture.interview.answer', { questionId: 'q_tax', answer: { yes: false, assumed: true } }],
      // The first plan is the one the card showed (review of A1, row 3), its words the template's here.
      ['venture.blueprint.draft', { useTemplate: true, shown: expect.objectContaining({ name: 'Bookkeeping studio', by: 'template' }) }],
      ...flow().slice(10),
    ]);
    expect(flow().slice(10).some(([m]) => m === 'workspace.create' || m === 'venture.create' || m === 'venture.blueprint.update')).toBe(false);
    await screen.findAllByText('Your plan is ready. Read it.');
    inOrder(titles(['Your plan is ready. Read it.', 'Connect your AI', 'Confirm your prices and tax', 'Keep this business']));
    await waitFor(() => expect(screen.getByRole('button', { name: /Bookkeeping studio/ })).toBeTruthy());
  });

  it('Enter in the About you box sends; Shift+Enter does not', async () => {
    const { calls } = start();
    const about = await skipAi();
    fireEvent.change(about, { target: { value: IDEA } });
    fireEvent.keyDown(about, { key: 'Enter', shiftKey: true });
    expect(calls.some(([m]) => m === 'venture.about.read')).toBe(false);
    await act(async () => { fireEvent.keyDown(about, { key: 'Enter' }); });
    expect(await screen.findByRole('region', { name: 'Talk to Chausar' })).toBeTruthy();
    expect(calls.some(([m]) => m === 'venture.about.read')).toBe(true);
  });
});

describe('onboarding: an engine that is still starting', () => {
  it('shows the app with its status line, then the first run once the engine answers', async () => {
    window.location.hash = '#/today';
    const fake = createFakeClient(new FakeEngine({ fresh: true }));
    const status = createStatusStore({ state: 'starting' });
    let up = false;
    const client: EngineClient = {
      ...fake,
      transport: 'desktop',
      status: () => status.get(),
      onStatus: (listener) => status.subscribe(listener),
      request: ((method: string, params?: unknown) => (up ? fake.request(method as never, params as never) : Promise.reject(new EngineError('ENGINE_STARTING', 'Chausar is starting.')))) as EngineClient['request'],
    };
    render(<App client={client} language="en" />);
    expect((await screen.findByRole('status')).textContent).toBe('Chausar is starting.');
    expect(screen.queryByRole('heading', { name: 'Connect your AI' })).toBeNull();
    up = true;
    await act(async () => { status.set({ state: 'ok' }); });
    expect(await screen.findByRole('heading', { level: 1, name: 'Connect your AI' }, { timeout: 4000 })).toBeTruthy();
    expect(screen.queryByRole('navigation')).toBeNull();
  });
});

describe('onboarding: errors in plain words under the box', () => {
  it('checks the sentence before asking the engine', async () => {
    const { calls } = start();
    const about = await skipAi();
    // B4: Send waits for words; Enter on the empty box still says what to do.
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(about, { key: 'Enter' });
    expect(screen.getByRole('alert').textContent).toBe('Write one sentence about what you want to start.');
    fireEvent.change(about, { target: { value: 'Dogs' } });
    await press('Send');
    expect(screen.getByRole('alert').textContent).toBe('Say a little more: at least 10 characters.');
    fireEvent.change(about, { target: { value: 'x'.repeat(2001) } });
    await press('Send');
    expect(screen.getByRole('alert').textContent).toBe('Keep it shorter: at most 2000 characters.');
    expect(calls.some(([m]) => m === 'venture.about.read' || m === 'venture.preview')).toBe(false);
    expect(screen.getByRole('textbox', { name: ABOUT_BOX }).getAttribute('aria-invalid')).toBe('true');
  });

  it("shows the engine's own words, and Start works again", async () => {
    const { refuse } = start();
    refuse('workspace.create', new EngineError('VAULT_BUSY', 'A workspace operation is in progress. Wait for it to finish.'));
    await keepPlan(IDEA);
    expect((await screen.findByRole('alert')).textContent).toBe('A workspace operation is in progress. Wait for it to finish.');
    await press('Start');
    await toToday();
    await screen.findByRole('navigation', { name: 'Places' });
  });

  it('a failure after the vault exists keeps the sentence, and Try again never makes a second vault', async () => {
    const { refuse, flow } = start();
    refuse('venture.blueprint.draft', new EngineError('VAULT_BUSY', 'A workspace operation is in progress. Wait for it to finish.'));
    await keepPlan(IDEA);
    expect((await screen.findByRole('alert')).textContent).toBe('A workspace operation is in progress. Wait for it to finish.');
    await press('Try again');
    await toToday();
    await screen.findByRole('navigation', { name: 'Places' });
    expect(flow().filter(([m]) => m === 'workspace.create')).toHaveLength(1);
    expect(flow().filter(([m]) => m === 'venture.interview.answer')).toHaveLength(4);
  });
});

describe('onboarding: what the engine forces before a vault', () => {
  it('no protected storage: one passphrase step under the box, then the recovery code once, then Today', async () => {
    const { flow } = start({ fresh: true, deviceKeys: false });
    await keepPlan(IDEA);
    const reason = await screen.findByText(/This computer has no keyring Chausar can use/);
    expect(reason.textContent).toBe('This computer has no keyring Chausar can use, so Chausar asks for a passphrase. Choose one of at least 12 characters. Nobody can reset it.');
    const first = screen.getByLabelText('Passphrase') as HTMLInputElement;
    const again = screen.getByLabelText('Type it again') as HTMLInputElement;
    expect(first.type).toBe('password');
    fireEvent.change(first, { target: { value: 'short' } });
    fireEvent.change(again, { target: { value: 'short' } });
    await press('Lock and start');
    expect(screen.getByRole('alert').textContent).toBe('Use a passphrase of at least 12 characters.');
    fireEvent.change(first, { target: { value: 'correct horse battery' } });
    fireEvent.change(again, { target: { value: 'correct horse batterY' } });
    await press('Lock and start');
    expect(screen.getByRole('alert').textContent).toBe("The two passphrases don't match.");
    fireEvent.change(again, { target: { value: 'correct horse battery' } });
    await press('Lock and start');
    const code = await screen.findByRole('group', { name: 'Recovery code' });
    expect(code.textContent).toBe('K7QM4X2D9PLR8T3WNB6Y5HJC');
    expect(within(code).getAllByText(/^.{4}$/)).toHaveLength(6);
    expect(screen.queryByLabelText('Passphrase')).toBeNull();
    // Save as file takes the exact code, on its own line, only when the owner asks.
    let file: Blob | null = null;
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: (value: Blob) => { file = value; return 'blob:chausar/1'; } });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => {} });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await press('Save as file');
    expect(click.mock.contexts.map((link) => (link as HTMLAnchorElement).download)).toEqual(['chausar-recovery-code.txt']);
    expect((await (file as unknown as Blob).text()).split('\n')).toContain('K7QM4X2D9PLR8T3WNB6Y5HJC');
    Reflect.deleteProperty(URL, 'createObjectURL');
    Reflect.deleteProperty(URL, 'revokeObjectURL');
    expect(flow().filter(([m]) => m === 'workspace.create').map(([, p]) => p)).toEqual([
      { name: 'Bookkeeping studio', pack: 'services', folder: null },
      { name: 'Bookkeeping studio', pack: 'services', folder: null, passphrase: 'correct horse battery' },
    ]);
    expect(flow().some(([m]) => m === 'venture.create')).toBe(false);
    // Locked (aria-disabled, still reachable and saying why) until the owner ticks that the code is saved.
    const go = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement;
    expect(go.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(screen.getByRole('checkbox', { name: 'I saved it somewhere safe' }));
    expect(go.hasAttribute('aria-disabled')).toBe(false);
    await press('Continue');
    await toToday();
    await screen.findByRole('navigation', { name: 'Places' });
    await screen.findAllByText('Your plan is ready. Read it.');
    // Review of A1 (finding 5): the kept plan stays ahead of Connect your AI, which shows once, as its own card.
    expect(screen.getByText('Connect your AI')).toBeTruthy();
    expect(screen.queryByText('Keep this business')).toBeNull();
  });

  it('hosted web: the server keeps the key, sends no folder, and the recovery code shows once', async () => {
    const { flow } = start({ fresh: true, hosted: true }, { transport: 'hosted' });
    await type(IDEA);
    await press('Start');
    await screen.findByRole('group', { name: 'Recovery code' });
    expect(flow().filter(([m]) => m === 'workspace.create').map(([, p]) => p)).toEqual([{ name: 'Bookkeeping studio', pack: 'services' }]);
    expect(flow().some(([m]) => m === 'workspace.lock')).toBe(false);
    fireEvent.click(screen.getByRole('checkbox', { name: 'I saved it somewhere safe' }));
    await press('Continue');
    await screen.findByRole('navigation', { name: 'Places' });
  });
});

describe('onboarding: New business from the business menu', () => {
  it('reuses the same view inside the app, closes the open business first, and lands on Today with the new one open', async () => {
    const { flow } = start({}, { hash: '#/onboarding' });
    expect(await box()).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Places' })).toBeTruthy();
    await type(IDEA);
    // Inside the app the box's button says what it does (w3 3G2, D-Start); the first run keeps "Start".
    await press('Make my plan');
    await waitFor(() => expect(window.location.hash).toBe('#/today'));
    expect(flow().map(([m]) => m).slice(0, 4)).toEqual(['venture.preview', 'workspace.status', 'workspace.lock', 'workspace.create']);
    // Ledgerline's plan waits too; the queue spans every business, oldest first.
    await waitFor(() => expect(cardTitle('Your plan is ready. Read it.')).toHaveLength(2));
    // The business switcher, not Today's filter chip for the same business (Today shows one per business, w3 3C).
    await waitFor(() => expect(screen.getByRole('button', { name: /Bookkeeping studio.*Switch business/ })).toBeTruthy());
  });
});

/*
 * One-shot C4 task 1: the plan card on About you. The name is a field with the suggested name in it, each offer a row
 * with a tick (kept by default) and a rename in place, and "Add an offer" at the end. At least one offer stays kept. A
 * rename asked in the chat that code could not read gets one fixed line.
 */
describe('onboarding: the plan card (C4 task 1)', () => {
  const READ3 = {
    family: { id: 'creative', label: 'Creative work', line: 'Design, photos, video and writing.' },
    offers: [
      { name: 'Birthday party photography', line: 'Candid photos of the party, edited and shared.' },
      { name: 'Shop product photos', line: 'Clean photos of what a shop sells.' },
      { name: 'Monthly photo support', line: 'A set of photos each month for a shop.' },
    ],
    country: null, evidence: null, idea: 'Photography for parties and shops in Pune', source: 'ai' as const,
  };
  function withRead(read: typeof READ3) {
    const reads: unknown[] = [];
    const run = start();
    run.answers.set('venture.about.read', (params) => { reads.push(params); return structuredClone(read); });
    return { ...run, reads };
  }
  async function toCard() {
    fireEvent.change(await skipAi(), { target: { value: 'I run a small weekend photography studio in Pune.' } });
    await press('Send');
    await screen.findByRole('checkbox', { name: 'Birthday party photography' }, { timeout: 4000 });
  }
  async function keepAndSave(engine: FakeEngine) {
    const keep = await screen.findByRole('button', { name: 'Keep this plan' });
    await waitFor(() => expect(keep.hasAttribute('disabled')).toBe(false));
    await act(async () => { fireEvent.click(keep); });
    await answerSideWork();
    await screen.findByRole('heading', { level: 1, name: 'Connect what your business needs' }, { timeout: 4000 });
    return (await createFakeClient(engine).request('venture.blueprint.get', {}))!.blueprint;
  }

  it('a typed name and an unticked offer are what the plan keeps', async () => {
    timeZone('Asia/Kolkata');
    const { engine } = withRead(READ3);
    await toCard();
    const name = screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'Asha Frames' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Shop product photos' }));
    expect(screen.getByText('Shop product photos: removed.')).toBeTruthy();
    const plan = await keepAndSave(engine);
    expect(plan.name.value).toBe('Asha Frames');
    expect(plan.offers.map((offer) => offer.name.value)).toEqual(['Birthday party photography', 'Monthly photo support']);
  });

  it('Undo brings a removed offer back; a rename in place is kept', async () => {
    timeZone('Asia/Kolkata');
    const { engine } = withRead(READ3);
    await toCard();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Shop product photos' }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect((screen.getByRole('checkbox', { name: 'Shop product photos' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Rename Monthly photo support' }));
    const box = screen.getByRole('textbox', { name: 'Rename Monthly photo support' });
    fireEvent.change(box, { target: { value: 'Photo support for shops' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(screen.getByRole('checkbox', { name: 'Photo support for shops' })).toBeTruthy();
    const plan = await keepAndSave(engine);
    expect(plan.offers.map((offer) => offer.name.value)).toEqual(['Birthday party photography', 'Shop product photos', 'Photo support for shops']);
  });

  it('"Add an offer" adds a row that keeps', async () => {
    timeZone('Asia/Kolkata');
    const { engine } = withRead({ ...READ3, offers: READ3.offers.slice(0, 2) });
    await toCard();
    fireEvent.click(screen.getByRole('button', { name: 'Add an offer' }));
    const box = screen.getByRole('textbox', { name: 'New offer' });
    fireEvent.change(box, { target: { value: 'Wedding albums' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect((screen.getByRole('checkbox', { name: 'Wedding albums' }) as HTMLInputElement).checked).toBe(true);
    const plan = await keepAndSave(engine);
    expect(plan.offers.map((offer) => offer.name.value)).toEqual(['Birthday party photography', 'Shop product photos', 'Wedding albums']);
  });

  it('with no offer kept, Keep this plan is locked and says why', async () => {
    timeZone('Asia/Kolkata');
    withRead(READ3);
    await toCard();
    for (const offer of READ3.offers) fireEvent.click(screen.getByRole('checkbox', { name: offer.name }));
    const keep = screen.getByRole('button', { name: 'Keep this plan' });
    expect(keep.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Keep at least one offer.')).toBeTruthy();
  });

  it('a rename asked in the chat that code cannot read gets one fixed line, and no AI read', async () => {
    timeZone('Asia/Kolkata');
    const { reads } = withRead(READ3);
    await toCard();
    const say = screen.getByRole('textbox', { name: 'Message Chausar' });
    fireEvent.change(say, { target: { value: 'call it something nicer please' } });
    await act(async () => { fireEvent.submit(say.closest('form')!); });
    expect(await screen.findByText("I couldn't rename it here. Type the name on the right.")).toBeTruthy();
    expect(reads).toHaveLength(1);
  });
});

/* One-shot C4 task 3: "I don't have a day job" is the first answer of the day-job step, and it is recorded. */
describe('onboarding: the day-job step (C4 task 3)', () => {
  it("lists the no day job answer first; picking it unlocks Continue, says so, and records it", async () => {
    timeZone('Asia/Kolkata');
    const { engine } = start();
    fireEvent.change(await skipAi(), { target: { value: IDEA } });
    await press('Send');
    const keep = await screen.findByRole('button', { name: 'Keep this plan' }, { timeout: 4000 });
    await waitFor(() => expect(keep.hasAttribute('disabled')).toBe(false));
    await act(async () => { fireEvent.click(keep); });
    await confirmProfession();
    const radios = await screen.findAllByRole('radio', {}, { timeout: 4000 });
    expect(radios[0]!.getAttribute('value')).toBe('no-day-job');
    expect(screen.getByRole('radio', { name: "I don't have a day job" })).toBe(radios[0]);
    const go = screen.getByRole('button', { name: 'Continue' });
    expect(go.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(radios[0]!);
    expect(screen.getByText("You don't have a day job, so no contract limits this business.")).toBeTruthy();
    expect(go.getAttribute('aria-disabled')).toBeNull();
    await act(async () => { fireEvent.click(go); });
    await screen.findByRole('heading', { level: 1, name: 'Connect what your business needs' }, { timeout: 4000 });
    const view = await createFakeClient(engine).request('venture.compliance.get', {} as never);
    expect(view.recorded?.sideWork).toBe('no-day-job');
  });
});
