import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError, type MethodName, type PostingStepsView } from '../../src/engine/types';
import { CONNECTORS } from '../../src/engine/fixtures-business';

// Connections, Ink v2 wave 2 package 2B1: signing in to a platform in the Chausar browser window (venture.posting.signIn)
// on the cards whose browser posting the engine says is available. The engine opens the window; the screen says so.

type Call = { method: string; params: unknown };

function start(options: { engine?: FakeEngine; language?: 'en' | 'hi'; intercept?: Partial<Record<MethodName, (params: unknown) => unknown>> } = {}) {
  window.location.hash = '#/connections';
  const client = createFakeClient(options.engine ?? new FakeEngine());
  const calls: Call[] = [];
  const request = client.request.bind(client);
  client.request = ((method: MethodName, params?: unknown) => {
    calls.push({ method, params });
    const own = options.intercept?.[method];
    if (own) return Promise.resolve().then(() => own(params));
    return request(method, params as never);
  }) as typeof client.request;
  render(<App client={client} language={options.language ?? 'en'} />);
  return { calls };
}
// A connector's tile, by the button that names it (a text query: role queries over the whole page are slow in jsdom).
const card = async (name: string) => (await screen.findByText(name, { selector: 'button' })).closest('li')!;

describe('Connections: sign in for posting', () => {
  it('LinkedIn offers Sign in while its browser posting is available; the line after says the window opened', async () => {
    const { calls } = start();
    const linkedin = await card('LinkedIn');
    await act(async () => { fireEvent.click(within(linkedin).getByRole('button', { name: 'Sign in to LinkedIn' })); });
    expect(calls.find((c) => c.method === 'venture.posting.signIn')?.params).toEqual({ connectorId: 'linkedin' });
    await waitFor(() => expect(within(linkedin).getByRole('status').textContent).toBe('A browser window opened. Sign in there, then close it.'));
  });

  it('a card whose browser posting is planned offers no Sign in', async () => {
    start();
    const instagram = await card('Instagram');
    expect(within(instagram).queryByRole('button', { name: /Sign in/ })).toBeNull();
    const youtube = await card('YouTube');
    expect(within(youtube).queryByRole('button', { name: /Sign in/ })).toBeNull();
  });

  it("a refusal is said in the engine's words", async () => {
    start({ intercept: { 'venture.posting.signIn': () => { throw new EngineError('CHANNEL_FROZEN', 'LinkedIn blocked this account. Do not sign in again or reconnect.'); } } });
    const linkedin = await card('LinkedIn');
    await act(async () => { fireEvent.click(within(linkedin).getByRole('button', { name: 'Sign in to LinkedIn' })); });
    await waitFor(() => expect(within(linkedin).getByRole('alert').textContent).toBe("Couldn't open the sign-in window: LinkedIn blocked this account. Do not sign in again or reconnect."));
  });

  it('in Hindi too', async () => {
    start({ language: 'hi' });
    const linkedin = await card('LinkedIn');
    expect(within(linkedin).queryByRole('button', { name: 'Sign in to LinkedIn' })).toBeNull();
    expect(linkedin.querySelector('[data-posting-sign-in]')).toBeTruthy();
  });
});

describe('the fake engine signs in by the engine rules', () => {
  it('opens on the desktop, refuses on the hosted web, and for picture platforms', async () => {
    const desktop = new FakeEngine();
    expect(await desktop.request('venture.posting.signIn', { connectorId: 'linkedin' })).toEqual({ opened: true, line: 'A browser window opened. Sign in there, then close it.' });
    await expect(desktop.request('venture.posting.signIn', { connectorId: 'instagram' })).rejects.toMatchObject({ code: 'NOT_BUILT_YET' });
    await expect(desktop.request('venture.posting.signIn', { connectorId: 'stripe' })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
    const hosted = new FakeEngine({ hosted: true });
    await expect(hosted.request('venture.posting.signIn', { connectorId: 'linkedin' })).rejects.toMatchObject({ code: 'TIER_UNAVAILABLE' });
  });
});

describe('Connections: your own, stricter posting limits', () => {
  // The limits stay folded under the card until the owner opens them.
  const form = async (name: string) => {
    const row = await card(name);
    expect(within(row).queryByRole('group', { name: `Your posting limits for ${name}` })).toBeNull();
    await act(async () => { fireEvent.click(within(row).getByRole('button', { name: `Posting limits for ${name}` })); });
    const group = await within(row).findByRole('group', { name: `Your posting limits for ${name}` });
    await waitFor(() => expect((within(group).getByLabelText('Posts a day') as HTMLInputElement).value).not.toBe(''));
    return group;
  };

  it("shows the limits in use with Chausar's own as the hint, and saves only stricter numbers through the engine", async () => {
    const { calls } = start();
    const limits = await form('LinkedIn');
    const posts = within(limits).getByLabelText('Posts a day') as HTMLInputElement;
    expect(posts.value).toBe('3');
    expect(limits.textContent).toContain("Chausar's own: 3");
    expect(limits.textContent).toContain('These limits are for this business');
    fireEvent.change(posts, { target: { value: '2' } });
    fireEvent.change(within(limits).getByLabelText('Minutes between posts'), { target: { value: '120' } });
    await act(async () => { fireEvent.click(within(limits).getByRole('button', { name: 'Save limits' })); });
    // Only the boxes that differ from Chausar's own are sent; the rest stay Chausar's own.
    expect(calls.find((c) => c.method === 'venture.posting.limits.set')?.params).toEqual({ connectorId: 'linkedin', limits: { capPer24h: 2, minGapMinutes: 120 } });
    await waitFor(() => expect(within(limits).getByRole('status').textContent).toBe('Saved. These limits apply to the next post.'));
  });

  it("a looser number is refused in the engine's words", async () => {
    start();
    const limits = await form('LinkedIn');
    fireEvent.change(within(limits).getByLabelText('Posts a day'), { target: { value: '9' } });
    await act(async () => { fireEvent.click(within(limits).getByRole('button', { name: 'Save limits' })); });
    await waitFor(() => expect(within(limits).getByRole('alert').textContent).toMatch(/^Couldn't save the limits: These are looser than Chausar's own limits: posts in 24 hours\./));
  });

  it('the fake engine keeps the engine rules: tighten only, per channel', async () => {
    const engine = new FakeEngine();
    const view = await engine.request('venture.posting.limits.get', {}) as { channels: { connectorId: string; inUse: { capPer24h: number } }[] };
    expect(view.channels.map((c) => c.connectorId)).toEqual(['linkedin', 'x']);
    await expect(engine.request('venture.posting.limits.set', { connectorId: 'x', limits: { capPer24h: 5 } })).rejects.toMatchObject({ code: 'POSTING_LIMIT_LOOSER' });
    const set = await engine.request('venture.posting.limits.set', { connectorId: 'x', limits: { capPer24h: 1 } }) as typeof view;
    expect(set.channels.find((c) => c.connectorId === 'x')!.inUse.capPer24h).toBe(1);
  });
});

// Ink v2 wave 2 package 2B2: when the posting steps last worked on this computer, and checking them now
// (venture.posting.checkSteps). The engine finds each step without typing or clicking; the screen shows its date and line.
describe('Connections: the posting steps', () => {
  const NOW = () => '2026-10-23T09:00:00.000Z';
  const stepsOf = async (name: string) => (await card(name)).querySelector('[data-posting-steps]') as HTMLElement;

  it('a card says the steps are not checked yet; Check the steps asks the engine, then shows the date and its line', async () => {
    const { calls } = start({ engine: new FakeEngine({ now: NOW }) });
    const steps = await stepsOf('LinkedIn');
    expect(steps.textContent).toContain('Steps not checked yet');
    await act(async () => { fireEvent.click(within(steps).getByRole('button', { name: 'Check the posting steps on LinkedIn' })); });
    expect(calls.find((c) => c.method === 'venture.posting.checkSteps')?.params).toEqual({ connectorId: 'linkedin' });
    await waitFor(() => expect(steps.textContent).toContain('Steps last checked working on 21 Oct 2026'));
    expect(within(steps).getByRole('status').textContent).toBe('Every step was found the way Chausar knows it.');
  });

  it('a date the engine already has shows at rest', async () => {
    const cards = structuredClone(CONNECTORS).map((item) => ({
      ...item, postingOptions: item.postingOptions.map((option) => (item.id === 'linkedin' && option.mode === 'owner-browser-session' ? { ...option, stepsCheckedOn: '2026-10-20' } : option)),
    }));
    start({ intercept: { 'venture.connectors.list': () => cards } });
    const steps = await stepsOf('LinkedIn');
    expect(steps.textContent).toContain('Steps last checked working on 20 Oct 2026');
    expect(within(steps).queryByRole('status')).toBeNull();
  });

  it("a refusal is said in the engine's words", async () => {
    start({ intercept: { 'venture.posting.checkSteps': () => { throw new EngineError('POSTING_NOT_SIGNED_IN', 'Sign in to LinkedIn in the Chausar browser window first.'); } } });
    const steps = await stepsOf('LinkedIn');
    await act(async () => { fireEvent.click(within(steps).getByRole('button', { name: 'Check the posting steps on LinkedIn' })); });
    await waitFor(() => expect(within(steps).getByRole('alert').textContent).toBe("Couldn't check the steps: Sign in to LinkedIn in the Chausar browser window first."));
    expect(steps.textContent).toContain('Steps not checked yet');
  });

  it('cards without browser posting have no steps line', async () => {
    start();
    expect((await card('Instagram')).querySelector('[data-posting-steps]')).toBeNull();
    expect((await card('YouTube')).querySelector('[data-posting-steps]')).toBeNull();
  });

  it('in Hindi too', async () => {
    start({ language: 'hi' });
    const linkedin = await card('LinkedIn');
    const steps = linkedin.querySelector('[data-posting-steps]') as HTMLElement;
    expect(steps.textContent).toContain('चरण अभी जाँचे नहीं गए');
  });

  it('the fake engine checks the steps by the engine rules', async () => {
    const desktop = new FakeEngine({ now: NOW });
    const linkedin = await desktop.request('venture.posting.checkSteps', { connectorId: 'linkedin' }) as PostingStepsView;
    expect(linkedin.steps.map((step) => step.step)).toEqual(['textbox', 'submit', 'confirm']);
    expect(linkedin.stepsCheckedOn).toBe('2026-10-21');
    const x = await desktop.request('venture.posting.checkSteps', { connectorId: 'x' }) as PostingStepsView;
    expect(x.stepsCheckedOn).toBeNull();
    expect(x.line).toMatch(/confirmation/);
    await expect(desktop.request('venture.posting.checkSteps', { connectorId: 'instagram' })).rejects.toMatchObject({ code: 'NOT_BUILT_YET' });
    await expect(desktop.request('venture.posting.checkSteps', { connectorId: 'stripe' })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
    await expect(new FakeEngine({ hosted: true }).request('venture.posting.checkSteps', { connectorId: 'linkedin' })).rejects.toMatchObject({ code: 'TIER_UNAVAILABLE' });
  });
});

// 2B2 review: a dry run can check the post box and the button, not the confirmation (the first post checks it). The
// screen shows that date instead of "Steps not checked yet".
describe('Connections: the date a check can give', () => {
  const stepsOf = async (name: string) => (await card(name)).querySelector('[data-posting-steps]') as HTMLElement;
  const view = (stepsCheckedOn: string | null, boxAndButtonCheckedOn: string | null): PostingStepsView => ({
    connectorId: 'linkedin', stepsCheckedOn, boxAndButtonCheckedOn,
    steps: [
      { step: 'textbox', candidates: [{ key: 'xpath://div', kind: 'xpath', value: '//div', checkedOn: boxAndButtonCheckedOn, addedBy: 'chausar' }] },
      { step: 'submit', candidates: [{ key: 'role:alert', kind: 'role', value: 'button', checkedOn: boxAndButtonCheckedOn, addedBy: 'chausar' }] },
      { step: 'confirm', candidates: [{ key: 'role:alert', kind: 'role', value: 'alert', checkedOn: null, addedBy: 'chausar' }], response: { key: 'response:POST x', method: 'POST', path: 'x', checkedOn: null } },
    ],
    line: 'The post confirmation shows only after a post, so the first post that goes out checks it.',
  });

  it('after a clean check that cannot see the confirmation, it shows the box and button date, not "not checked"', async () => {
    start({ intercept: { 'venture.posting.checkSteps': () => view(null, '2026-10-23') } });
    const steps = await stepsOf('LinkedIn');
    await act(async () => { fireEvent.click(within(steps).getByRole('button', { name: 'Check the posting steps on LinkedIn' })); });
    await waitFor(() => expect(steps.textContent).toContain('Post box and button last checked working on 23 Oct 2026. The first post checks the confirmation.'));
    expect(steps.textContent).not.toContain('Steps not checked yet');
  });

  it('the box and button date shows at rest too', async () => {
    const cards = structuredClone(CONNECTORS).map((item) => ({
      ...item, postingOptions: item.postingOptions.map((option) => (item.id === 'linkedin' && option.mode === 'owner-browser-session' ? { ...option, stepsCheckedOn: null, boxAndButtonCheckedOn: '2026-10-20' } : option)),
    }));
    start({ intercept: { 'venture.connectors.list': () => cards } });
    expect((await stepsOf('LinkedIn')).textContent).toContain('Post box and button last checked working on 20 Oct 2026.');
  });

  it('in Hindi too', async () => {
    const cards = structuredClone(CONNECTORS).map((item) => ({
      ...item, postingOptions: item.postingOptions.map((option) => (item.id === 'linkedin' && option.mode === 'owner-browser-session' ? { ...option, boxAndButtonCheckedOn: '2026-10-20' } : option)),
    }));
    start({ language: 'hi', intercept: { 'venture.connectors.list': () => cards } });
    const linkedin = await card('LinkedIn');
    expect((linkedin.querySelector('[data-posting-steps]') as HTMLElement).textContent).toContain('पोस्ट बॉक्स और बटन');
  });

  it('the fake engine gives the box and button date after a check', async () => {
    const x = await new FakeEngine({ now: () => '2026-10-23T09:00:00.000Z' }).request('venture.posting.checkSteps', { connectorId: 'x' }) as PostingStepsView;
    expect([x.stepsCheckedOn, x.boxAndButtonCheckedOn]).toEqual([null, '2026-10-23']);
    expect(x.steps.find((step) => step.step === 'confirm')?.response?.checkedOn).toBeNull();
  });
});
