import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
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
  it('X offers Sign in while its browser posting is available; the line after says the window opened', async () => {
    const { calls } = start();
    const linkedin = await card('X');
    await act(async () => { fireEvent.click(within(linkedin).getByRole('button', { name: 'Sign in to X' })); });
    expect(calls.find((c) => c.method === 'venture.posting.signIn')?.params).toEqual({ connectorId: 'x' });
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
    start({ intercept: { 'venture.posting.signIn': () => { throw new EngineError('CHANNEL_FROZEN', 'X blocked this account. Do not sign in again or reconnect.'); } } });
    const linkedin = await card('X');
    await act(async () => { fireEvent.click(within(linkedin).getByRole('button', { name: 'Sign in to X' })); });
    await waitFor(() => expect(within(linkedin).getByRole('alert').textContent).toBe("Couldn't open the sign-in window: X blocked this account. Do not sign in again or reconnect."));
  });

  it('in Hindi too', async () => {
    start({ language: 'hi' });
    const linkedin = await card('X');
    expect(within(linkedin).queryByRole('button', { name: 'Sign in to X' })).toBeNull();
    expect(linkedin.querySelector('[data-posting-sign-in]')).toBeTruthy();
  });
});

describe('the fake engine signs in by the engine rules', () => {
  it('opens on the desktop, refuses on the hosted web, and for picture platforms', async () => {
    const desktop = new FakeEngine();
    expect(await desktop.request('venture.posting.signIn', { connectorId: 'x' })).toEqual({ opened: true, line: 'A browser window opened. Sign in there, then close it.' });
    await expect(desktop.request('venture.posting.signIn', { connectorId: 'instagram' })).rejects.toMatchObject({ code: 'NOT_BUILT_YET' });
    await expect(desktop.request('venture.posting.signIn', { connectorId: 'stripe' })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
    const hosted = new FakeEngine({ hosted: true });
    await expect(hosted.request('venture.posting.signIn', { connectorId: 'x' })).rejects.toMatchObject({ code: 'TIER_UNAVAILABLE' });
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
    const limits = await form('X');
    const posts = within(limits).getByLabelText('Posts a day') as HTMLInputElement;
    expect(posts.value).toBe('3');
    expect(limits.textContent).toContain("Chausar's own: 3");
    expect(limits.textContent).toContain('These limits are for this business');
    fireEvent.change(posts, { target: { value: '2' } });
    fireEvent.change(within(limits).getByLabelText('Minutes between posts'), { target: { value: '120' } });
    await act(async () => { fireEvent.click(within(limits).getByRole('button', { name: 'Save limits' })); });
    // Only the boxes that differ from Chausar's own are sent; the rest stay Chausar's own.
    expect(calls.find((c) => c.method === 'venture.posting.limits.set')?.params).toEqual({ connectorId: 'x', limits: { capPer24h: 2, minGapMinutes: 120 } });
    await waitFor(() => expect(within(limits).getByRole('status').textContent).toBe('Saved. These limits apply to the next post.'));
  });

  it("a looser number is refused in the engine's words", async () => {
    start();
    const limits = await form('X');
    fireEvent.change(within(limits).getByLabelText('Posts a day'), { target: { value: '9' } });
    await act(async () => { fireEvent.click(within(limits).getByRole('button', { name: 'Save limits' })); });
    await waitFor(() => expect(within(limits).getByRole('alert').textContent).toMatch(/^Couldn't save the limits: These are looser than Chausar's own limits: posts in 24 hours\./));
  });

  it('all six posting limit views and four API settings match the native public contract exactly', async () => {
    const native = (path: string) => JSON.stringify(pathToFileURL(resolve(process.cwd(), path)).href);
    const script = `
      import { setup, owner } from ${native('platform/tests/venture-views-env.ts')};
      import { postingLimitsGet, postingLimitsSet } from ${native('platform/runtime/venture/build/posting-limits.ts')};
      const { deps } = await setup();
      const views = [await postingLimitsGet(deps, owner, {})], refusals = [];
      for (const connectorId of ['bluesky', 'mastodon', 'telegram', 'discord']) {
        views.push(await postingLimitsSet(deps, owner, { connectorId, limits: { capPer24h: 1, minGapMinutes: 180 } }));
        try { await postingLimitsSet(deps, owner, { connectorId, limits: { capPer24h: 4 } }); }
        catch (error) { refusals.push({ code: error.code, message: error.message }); }
      }
      try { await postingLimitsSet(deps, owner, { connectorId: 'stripe', limits: {} }); }
      catch (error) { refusals.push({ code: error.code, message: error.message }); }
      views.push(await postingLimitsGet(deps, owner, {}));
      process.stdout.write(JSON.stringify({ views, refusals }));
    `;
    const expected = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 30_000 }));
    const engine = new FakeEngine(), views = [await engine.request('venture.posting.limits.get', {})], refusals = [];
    for (const connectorId of ['bluesky', 'mastodon', 'telegram', 'discord']) {
      views.push(await engine.request('venture.posting.limits.set', { connectorId, limits: { capPer24h: 1, minGapMinutes: 180 } }));
      try { await engine.request('venture.posting.limits.set', { connectorId, limits: { capPer24h: 4 } }); }
      catch (error) { const e = error as EngineError; refusals.push({ code: e.code, message: e.message }); }
    }
    try { await engine.request('venture.posting.limits.set', { connectorId: 'stripe', limits: {} }); }
    catch (error) { const e = error as EngineError; refusals.push({ code: e.code, message: e.message }); }
    views.push(await engine.request('venture.posting.limits.get', {}));
    expect({ views, refusals }).toEqual(expected);
    expect(refusals).toHaveLength(5);
  });

  it('malformed posting limits match native refusal order, exact fields and numeric bounds', async () => {
    const cases: [string, unknown][] = [
      ['get', { extra: true }], ['get', []], ['set', []], ['set', null], ['set', {}],
      ['set', { connectorId: 'bluesky' }],
      ['set', { connectorId: 'stripe', limits: [], extra: true }],
      ['set', { connectorId: 'bluesky', limits: [], extra: true }],
      ['set', { connectorId: 'bluesky', limits: [] }],
      ['set', { connectorId: 'bluesky', limits: null }],
      ['set', { connectorId: 'bluesky', limits: { other: 1 } }],
      ...[{ linkStreak: 1 }, { linkStreak: 10001 }, { minGapMinutes: 10001 }, { warmUpDays: 10001 },
        { duplicatePercent: 101 }, { capPer24h: 1.5 }, { capPer24h: '1' }, { capPer24h: 0 },
        { linkStreak: 5, capPer24h: 4 }, { linkStreak: 0, capPer24h: 0 },
        { linkStreak: 2, minGapMinutes: 10000, warmUpDays: 10000 }, {}]
        .map(limits => ['set', { connectorId: 'bluesky', limits }] as [string, unknown]),
      ['get', {}],
    ];
    const native = (path: string) => JSON.stringify(pathToFileURL(resolve(process.cwd(), path)).href);
    const script = `
      import { readFileSync } from 'node:fs';
      import { setup, owner } from ${native('platform/tests/venture-views-env.ts')};
      import { postingLimitsGet, postingLimitsSet } from ${native('platform/runtime/venture/build/posting-limits.ts')};
      const { deps } = await setup(), results = [];
      for (const [method, params] of JSON.parse(readFileSync(0, 'utf8'))) {
        try { results.push({ value: await (method === 'get' ? postingLimitsGet : postingLimitsSet)(deps, owner, params) }); }
        catch (error) { results.push({ code: error.code, message: error.message }); }
      }
      process.stdout.write(JSON.stringify(results));
    `;
    const expected = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { input: JSON.stringify(cases), encoding: 'utf8', timeout: 30_000 }));
    const engine = new FakeEngine(), actual = [];
    for (const [method, params] of cases) {
      try { actual.push({ value: await engine.request('venture.posting.limits.' + method, params) }); }
      catch (error) { const e = error as EngineError; actual.push({ code: e.code, message: e.message }); }
    }
    expect(actual).toEqual(expected);
  });

  it('the fake engine keeps the engine rules: tighten only, per channel', async () => {
    const engine = new FakeEngine();
    const view = await engine.request('venture.posting.limits.get', {}) as { channels: { connectorId: string; inUse: { capPer24h: number } }[] };
    expect(view.channels.map((c) => c.connectorId)).toEqual(['linkedin', 'x', 'bluesky', 'mastodon', 'telegram', 'discord']);
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
    const steps = await stepsOf('X');
    expect(steps.textContent).toContain('Steps not checked yet');
    await act(async () => { fireEvent.click(within(steps).getByRole('button', { name: 'Check the posting steps on X' })); });
    expect(calls.find((c) => c.method === 'venture.posting.checkSteps')?.params).toEqual({ connectorId: 'x' });
    await waitFor(() => expect(steps.textContent).toContain('Post box and button last checked working on 23 Oct 2026'));
    expect(within(steps).getByRole('status').textContent).toBe('The post confirmation shows only after a post, so the first post that goes out checks it.');
  });

  it('a date the engine already has shows at rest', async () => {
    const cards = structuredClone(CONNECTORS).map((item) => ({
      ...item, postingOptions: item.postingOptions.map((option) => (item.id === 'x' && option.mode === 'owner-browser-session' ? { ...option, stepsCheckedOn: '2026-10-20' } : option)),
    }));
    start({ intercept: { 'venture.connectors.list': () => cards } });
    const steps = await stepsOf('X');
    expect(steps.textContent).toContain('Steps last checked working on 20 Oct 2026');
    expect(within(steps).queryByRole('status')).toBeNull();
  });

  it("a refusal is said in the engine's words", async () => {
    start({ intercept: { 'venture.posting.checkSteps': () => { throw new EngineError('POSTING_NOT_SIGNED_IN', 'Sign in to X in the Chausar browser window first.'); } } });
    const steps = await stepsOf('X');
    await act(async () => { fireEvent.click(within(steps).getByRole('button', { name: 'Check the posting steps on X' })); });
    await waitFor(() => expect(within(steps).getByRole('alert').textContent).toBe("Couldn't check the steps: Sign in to X in the Chausar browser window first."));
    expect(steps.textContent).toContain('Steps not checked yet');
  });

  it('cards without browser posting have no steps line', async () => {
    start();
    expect((await card('Instagram')).querySelector('[data-posting-steps]')).toBeNull();
    expect((await card('YouTube')).querySelector('[data-posting-steps]')).toBeNull();
  });

  it('in Hindi too', async () => {
    start({ language: 'hi' });
    const linkedin = await card('X');
    const steps = linkedin.querySelector('[data-posting-steps]') as HTMLElement;
    expect(steps.textContent).toContain('चरण अभी जाँचे नहीं गए');
  });

  it('the fake engine checks the steps by the engine rules', async () => {
    const desktop = new FakeEngine({ now: NOW });
    const linkedin = await desktop.request('venture.posting.checkSteps', { connectorId: 'x' }) as PostingStepsView;
    expect(linkedin.steps.map((step) => step.step)).toEqual(['textbox', 'submit', 'confirm']);
    expect(linkedin.stepsCheckedOn).toBeNull();
    const x = await desktop.request('venture.posting.checkSteps', { connectorId: 'x' }) as PostingStepsView;
    expect(x.stepsCheckedOn).toBeNull();
    expect(x.line).toMatch(/confirmation/);
    await expect(desktop.request('venture.posting.checkSteps', { connectorId: 'instagram' })).rejects.toMatchObject({ code: 'NOT_BUILT_YET' });
    await expect(desktop.request('venture.posting.checkSteps', { connectorId: 'stripe' })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
    await expect(new FakeEngine({ hosted: true }).request('venture.posting.checkSteps', { connectorId: 'x' })).rejects.toMatchObject({ code: 'TIER_UNAVAILABLE' });
  });
});

// 2B2 review: a dry run can check the post box and the button, not the confirmation (the first post checks it). The
// screen shows that date instead of "Steps not checked yet".
describe('Connections: the date a check can give', () => {
  const stepsOf = async (name: string) => (await card(name)).querySelector('[data-posting-steps]') as HTMLElement;
  const view = (stepsCheckedOn: string | null, boxAndButtonCheckedOn: string | null): PostingStepsView => ({
    connectorId: 'x', stepsCheckedOn, boxAndButtonCheckedOn,
    steps: [
      { step: 'textbox', candidates: [{ key: 'xpath://div', kind: 'xpath', value: '//div', checkedOn: boxAndButtonCheckedOn, addedBy: 'chausar' }] },
      { step: 'submit', candidates: [{ key: 'role:alert', kind: 'role', value: 'button', checkedOn: boxAndButtonCheckedOn, addedBy: 'chausar' }] },
      { step: 'confirm', candidates: [{ key: 'role:alert', kind: 'role', value: 'alert', checkedOn: null, addedBy: 'chausar' }], response: { key: 'response:POST x', method: 'POST', path: 'x', checkedOn: null } },
    ],
    line: 'The post confirmation shows only after a post, so the first post that goes out checks it.',
  });

  it('after a clean check that cannot see the confirmation, it shows the box and button date, not "not checked"', async () => {
    start({ intercept: { 'venture.posting.checkSteps': () => view(null, '2026-10-23') } });
    const steps = await stepsOf('X');
    await act(async () => { fireEvent.click(within(steps).getByRole('button', { name: 'Check the posting steps on X' })); });
    await waitFor(() => expect(steps.textContent).toContain('Post box and button last checked working on 23 Oct 2026. The first post checks the confirmation.'));
    expect(steps.textContent).not.toContain('Steps not checked yet');
  });

  it('the box and button date shows at rest too', async () => {
    const cards = structuredClone(CONNECTORS).map((item) => ({
      ...item, postingOptions: item.postingOptions.map((option) => (item.id === 'x' && option.mode === 'owner-browser-session' ? { ...option, stepsCheckedOn: null, boxAndButtonCheckedOn: '2026-10-20' } : option)),
    }));
    start({ intercept: { 'venture.connectors.list': () => cards } });
    expect((await stepsOf('X')).textContent).toContain('Post box and button last checked working on 20 Oct 2026.');
  });

  it('in Hindi too', async () => {
    const cards = structuredClone(CONNECTORS).map((item) => ({
      ...item, postingOptions: item.postingOptions.map((option) => (item.id === 'x' && option.mode === 'owner-browser-session' ? { ...option, boxAndButtonCheckedOn: '2026-10-20' } : option)),
    }));
    start({ language: 'hi', intercept: { 'venture.connectors.list': () => cards } });
    const linkedin = await card('X');
    expect((linkedin.querySelector('[data-posting-steps]') as HTMLElement).textContent).toContain('पोस्ट बॉक्स और बटन');
  });

  it('the fake engine gives the box and button date after a check', async () => {
    const x = await new FakeEngine({ now: () => '2026-10-23T09:00:00.000Z' }).request('venture.posting.checkSteps', { connectorId: 'x' }) as PostingStepsView;
    expect([x.stepsCheckedOn, x.boxAndButtonCheckedOn]).toEqual([null, '2026-10-23']);
    expect(x.steps.find((step) => step.step === 'confirm')?.response?.checkedOn).toBeNull();
  });
});

for(const language of ['en','hi'] as const)for(const connected of [false,true])it('posting heading names the actual '+(connected?'API':'browser')+' mode in '+language,async()=>{
 const engine=new FakeEngine(),client=createFakeClient(engine);
 if(connected){const base={playbook:'social-agency' as const,kind:'open-posting',id:'bluesky'},first=await client.request('venture.desk.get',base);await client.request('venture.desk.act',{...base,action:'connect',digest:first.digest,payload:{setup:{platform:'bluesky',server:'https://bsky.social',account:'owner.bsky.social',channel:''},credential:'fixture-app-password'}});}
 const original=(await client.request('venture.connectors.list',{})).find(c=>c.id==='bluesky')!;start({engine,language});const tile=await card('Bluesky'),posting=tile.querySelector('[data-posting]')!;
 expect(posting.firstElementChild!.textContent).toBe(connected?(language==='hi'?'एपीआई से पोस्ट करना':'API posting'):(language==='hi'?'ब्राउज़र से पोस्ट करना':'Browser posting'));
 expect(posting.querySelector('[data-label]')!.getAttribute('data-label')).toBe(connected?'write':'planned');expect(tile.querySelector('[data-label]')!.getAttribute('data-label')).toBe('write');expect((await client.request('venture.connectors.list',{})).find(c=>c.id==='bluesky')).toEqual(original);
});
