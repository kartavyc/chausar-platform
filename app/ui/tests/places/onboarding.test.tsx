import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient, type FakeOptions } from '../../src/engine/fake';
import { createStatusStore } from '../../src/engine/client';
import { EngineError, type EngineClient, type Transport } from '../../src/engine/types';

const IDEA = 'Monthly bookkeeping for cafes and small shops in Pune.';

/** The fake engine behind a client that writes down every request, and can refuse the next call of a method once. */
function start(options: FakeOptions = { fresh: true }, { hash = '#/today', language = 'en', transport }: { hash?: string; language?: 'en' | 'hi'; transport?: Transport } = {}) {
  window.location.hash = hash;
  const engine = new FakeEngine(options);
  const fake = createFakeClient(engine);
  const calls: [string, Record<string, unknown>][] = [];
  const refusals = new Map<string, EngineError>();
  const client: EngineClient = {
    ...fake,
    transport: transport ?? fake.transport,
    request: ((method: string, params?: Record<string, unknown>) => {
      calls.push([method, structuredClone(params ?? {})]);
      const refusal = refusals.get(method);
      if (refusal) { refusals.delete(method); return Promise.reject(refusal); }
      return fake.request(method as never, params as never);
    }) as EngineClient['request'],
  };
  const view = render(<App client={client} language={language} />);
  /** The onboarding calls only, from the preview on. */
  const flow = () => calls.slice(calls.findIndex(([m]) => m === 'venture.preview')).filter(([m]) => /^(venture\.(preview|create|interview|blueprint)|workspace\.(status|create|lock))/.test(m));
  return { engine, client, calls, flow, refuse: (method: string, error: EngineError) => refusals.set(method, error), ...view };
}

const box = () => screen.findByRole('textbox', { name: 'What do you want to start?' });
async function type(text: string) { fireEvent.change(await box(), { target: { value: text } }); }
async function press(name: string | RegExp) { await act(async () => { fireEvent.click(screen.getByRole('button', { name })); }); }
const titles = (titlesInOrder: string[]) => titlesInOrder.map((title) => screen.getByText(title));
function inOrder(nodes: HTMLElement[]) {
  for (let i = 1; i < nodes.length; i++) expect(nodes[i - 1]!.compareDocumentPosition(nodes[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
}

describe('onboarding: first run', () => {
  it('shows only the name, one box, the country from the browser and Start', async () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-IN');
    start();
    expect(await box()).toBeTruthy();
    expect(screen.getByText('Chausar')).toBeTruthy();
    expect(await screen.findByText('Based in India')).toBeTruthy();
    expect(screen.queryByRole('navigation')).toBeNull();
    const main = screen.getByRole('main');
    expect(within(main).getAllByRole('button').map((b) => b.textContent)).toEqual(['Change', 'Start']);
    expect(within(main).getByRole('heading', { level: 1 }).textContent).toBe('What do you want to start?');
  });

  it('lets the owner change the country, and uses "another country" when the browser is somewhere Chausar has no table for', async () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('pt-BR');
    const { flow } = start();
    expect(await screen.findByText('Based in Another country (prices in US dollars)')).toBeTruthy();
    await press('Change');
    const country = screen.getByRole('combobox', { name: 'Country' }) as HTMLSelectElement;
    expect(country.value).toBe('XX');
    fireEvent.change(country, { target: { value: 'GB' } });
    await type(IDEA);
    await press('Start');
    await screen.findByRole('navigation', { name: 'Places' });
    expect(flow()[0]).toEqual(['venture.preview', { idea: IDEA, countryCode: 'GB' }]);
  });

  it('on Start: preview, the vault, create, the template interview and the plan, in the engine order; then Today with the plan first', async () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-IN');
    const { flow } = start();
    await screen.findByText('Based in India');
    await type(`  ${IDEA}  `);
    await press('Start');
    await screen.findByRole('navigation', { name: 'Places' });
    expect(window.location.hash).toBe('#/today');
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
      ['venture.blueprint.draft', { useTemplate: true }],
      ...flow().slice(10),
    ]);
    expect(flow().slice(10).some(([m]) => m === 'workspace.create' || m === 'venture.create')).toBe(false);
    await screen.findByText('Your plan is ready. Read it.');
    inOrder(titles(['Your plan is ready. Read it.', 'Connect your AI', 'Confirm your prices and tax', 'Keep this business']));
    await waitFor(() => expect(screen.getByRole('button', { name: /Bookkeeping studio/ })).toBeTruthy());
  });

  it('Enter in the box starts; Shift+Enter does not', async () => {
    const { calls } = start();
    await type(IDEA);
    fireEvent.keyDown(await box(), { key: 'Enter', shiftKey: true });
    expect(calls.some(([m]) => m === 'venture.preview')).toBe(false);
    await act(async () => { fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' }); });
    await screen.findByRole('navigation', { name: 'Places' });
    expect(calls.some(([m]) => m === 'venture.preview')).toBe(true);
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
      request: ((method: string, params?: unknown) => (up ? fake.request(method as never, params as never) : Promise.reject(new EngineError('ENGINE_STARTING', 'The engine is starting.')))) as EngineClient['request'],
    };
    render(<App client={client} language="en" />);
    expect((await screen.findByRole('status')).textContent).toBe('The engine is starting.');
    expect(screen.queryByRole('textbox', { name: 'What do you want to start?' })).toBeNull();
    up = true;
    await act(async () => { status.set({ state: 'ok' }); });
    expect(await box()).toBeTruthy();
    expect(screen.queryByRole('navigation')).toBeNull();
  });
});

describe('onboarding: errors in plain words under the box', () => {
  it('checks the sentence before asking the engine', async () => {
    const { calls } = start();
    await box();
    await press('Start');
    expect(screen.getByRole('alert').textContent).toBe('Write one sentence about what you want to start.');
    await type('Dogs');
    await press('Start');
    expect(screen.getByRole('alert').textContent).toBe('Say a little more: at least 10 characters.');
    await type('x'.repeat(2001));
    await press('Start');
    expect(screen.getByRole('alert').textContent).toBe('Keep it shorter: at most 2000 characters.');
    expect(calls.some(([m]) => m === 'venture.preview')).toBe(false);
    expect(screen.getByRole('textbox').getAttribute('aria-invalid')).toBe('true');
  });

  it("shows the engine's own words, and Start works again", async () => {
    const { refuse } = start();
    refuse('workspace.create', new EngineError('VAULT_BUSY', 'A workspace operation is in progress. Wait for it to finish.'));
    await type(IDEA);
    await press('Start');
    expect((await screen.findByRole('alert')).textContent).toBe('A workspace operation is in progress. Wait for it to finish.');
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(IDEA);
    await press('Start');
    await screen.findByRole('navigation', { name: 'Places' });
  });

  it('a failure after the vault exists keeps the sentence, and Try again never makes a second vault', async () => {
    const { refuse, flow } = start();
    refuse('venture.blueprint.draft', new EngineError('VAULT_BUSY', 'A workspace operation is in progress. Wait for it to finish.'));
    await type(IDEA);
    await press('Start');
    expect((await screen.findByRole('alert')).textContent).toBe('A workspace operation is in progress. Wait for it to finish.');
    expect(screen.getByRole('textbox').hasAttribute('readonly')).toBe(true);
    await press('Try again');
    await screen.findByRole('navigation', { name: 'Places' });
    expect(flow().filter(([m]) => m === 'workspace.create')).toHaveLength(1);
    expect(flow().filter(([m]) => m === 'venture.interview.answer')).toHaveLength(4);
  });
});

describe('onboarding: what the engine forces before a vault', () => {
  it('no protected storage: one passphrase step under the box, then the recovery code once, then Today', async () => {
    const { flow } = start({ fresh: true, deviceKeys: false });
    await type(IDEA);
    await press('Start');
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
    expect(flow().filter(([m]) => m === 'workspace.create').map(([, p]) => p)).toEqual([
      { name: 'Bookkeeping studio', pack: 'services', folder: null },
      { name: 'Bookkeeping studio', pack: 'services', folder: null, passphrase: 'correct horse battery' },
    ]);
    expect(flow().some(([m]) => m === 'venture.create')).toBe(false);
    const go = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'I saved it somewhere safe' }));
    expect(go.disabled).toBe(false);
    await press('Continue');
    await screen.findByRole('navigation', { name: 'Places' });
    await screen.findByText('Your plan is ready. Read it.');
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
    await press('Start');
    await waitFor(() => expect(window.location.hash).toBe('#/today'));
    expect(flow().map(([m]) => m).slice(0, 4)).toEqual(['venture.preview', 'workspace.status', 'workspace.lock', 'workspace.create']);
    // Ledgerline's plan waits too; the queue spans every business, oldest first.
    await waitFor(() => expect(screen.getAllByText('Your plan is ready. Read it.')).toHaveLength(2));
    await waitFor(() => expect(screen.getByRole('button', { name: /Bookkeeping studio/ })).toBeTruthy());
  });
});

describe('onboarding: Hindi', () => {
  it('speaks Hindi on the first run', async () => {
    start({ fresh: true }, { language: 'hi' });
    expect(await screen.findByRole('textbox', { name: 'आप क्या शुरू करना चाहते हैं?' })).toBeTruthy();
    expect(screen.getByText('चौसर')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'शुरू करें' })).toBeTruthy();
  });
});
