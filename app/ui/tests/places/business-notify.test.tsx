// Business > Notifications (Ink v2 wave 4, package 4G4; spec 5.7 and 8, catalogue O12, O13, W3's U18): pause until a
// date (30 days at most), quiet hours, the digest hour, push on or off on the hosted app through a walkthrough that asks
// the browser only on that press and follows its permission live, the tray and the relay on this computer, and what
// keeps running while Chausar is closed. Every state shown is the engine's or the browser's; nothing is assumed.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { ClockProvider } from '../../src/shell/clock';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { BrowserPushContext, startHostedPush, type BrowserPush, type PushPermission } from '../../src/shell/push';
import { EngineError, type EngineClient, type PushSubscriptionInput } from '../../src/engine/types';
import { assertInkRules } from '../helpers/ink-rules';

const NOW = '2026-10-23T13:35:00.000Z';
const SUB: PushSubscriptionInput = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123', keys: { p256dh: 'BKey', auth: 'auth' }, expirationTime: null };

/** A browser with push, its permission as given; ask() answers `answer` and records that it was asked. */
function fakeBrowser(permission: PushPermission = 'default', answer: PushPermission = 'granted') {
  const state = { permission, subscription: null as PushSubscriptionInput | null, listeners: new Set<() => void>() };
  const browser = {
    supported: () => true,
    permission: () => state.permission,
    onPermission: (cb: () => void) => { state.listeners.add(cb); return () => { state.listeners.delete(cb); }; },
    ask: vi.fn(async () => { state.permission = answer; return answer; }),
    current: vi.fn(async () => state.subscription),
    subscribe: vi.fn(async (_key: string) => { state.subscription = SUB; return SUB; }),
    unsubscribe: vi.fn(async () => { const endpoint = state.subscription?.endpoint ?? null; state.subscription = null; return endpoint; }),
    register: vi.fn(async () => {}),
  } satisfies BrowserPush;
  const change = (to: PushPermission) => act(() => { state.permission = to; for (const cb of [...state.listeners]) cb(); });
  return { browser, state, change };
}

function start(options: { hosted?: boolean; browser?: BrowserPush; language?: 'en' | 'hi'; refuse?: Record<string, EngineError> } = {}) {
  window.location.hash = '#/business/notifications';
  const engine = new FakeEngine({ now: () => NOW, hosted: options.hosted ?? false });
  const client = createFakeClient(engine);
  const calls: [string, unknown][] = [];
  const request = client.request.bind(client);
  client.request = (async (method: string, params?: unknown) => {
    calls.push([method, params]);
    const refused = options.refuse?.[method];
    if (refused) throw refused;
    return request(method as never, params as never);
  }) as EngineClient['request'];
  render(
    <ClockProvider now={() => new Date(NOW)}>
      <BrowserPushContext.Provider value={options.browser ?? fakeBrowser().browser}>
        <App client={client} language={options.language ?? 'en'} />
      </BrowserPushContext.Provider>
    </ClockProvider>,
  );
  return { client, engine, calls };
}
async function region(title: string): Promise<HTMLElement> {
  const heading = await screen.findByText(title, { selector: 'h2' });
  const section = heading.closest('section') as HTMLElement;
  expect(section.getAttribute('aria-labelledby')).toBe(heading.id);
  return section;
}
const said = (calls: [string, unknown][], method: string) => calls.filter(([m]) => m === method).map(([, p]) => p);

afterEach(() => { vi.restoreAllMocks(); });

describe('Business > Notifications on this computer', () => {
  it('is a business page that says what the engine says, and that phone alerts need the hosted app', async () => {
    start();
    expect(await screen.findByRole('heading', { level: 1, name: 'Notifications' })).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Business pages' });
    expect(within(nav).getByRole('link', { name: 'Notifications' }).getAttribute('aria-current')).toBe('page');
    await screen.findByText('The tray shows how many things need you. Quiet hours: 22:00 to 07:00. Daily digest at 08:00.');
    const reach = await region('How alerts reach you');
    await within(reach).findByText('Phone alerts need the hosted app. On this computer the tray shows the count.');
    expect(within(reach).queryByRole('button', { name: 'Turn on phone alerts' })).toBeNull();
    expect((within(reach).getByRole('checkbox', { name: 'Show the count in the tray' }) as HTMLInputElement).checked).toBe(true);
    assertInkRules(document.body);
  });

  it('the tray switch and the relay go to the engine, which answers with its own words', async () => {
    const { calls } = start();
    const reach = await region('How alerts reach you');
    fireEvent.click(await within(reach).findByRole('checkbox', { name: 'Show the count in the tray' }));
    await waitFor(() => expect(said(calls, 'venture.notify.settings')).toContainEqual({ tray: false }));
    await screen.findByText(/^The tray count is off\. The bell still lists everything\./);
    await within(reach).findByText('No relay is set. The tray on this computer shows the count.');
    fireEvent.change(within(reach).getByLabelText('Your relay address'), { target: { value: 'http://ntfy.sh/my-topic' } });
    fireEvent.click(within(reach).getByRole('button', { name: 'Save relay' }));
    await within(reach).findByText(/^Couldn't save: Give the relay as one https address/);
    fireEvent.change(within(reach).getByLabelText('Your relay address'), { target: { value: 'https://ntfy.sh/my-topic' } });
    fireEvent.click(within(reach).getByRole('button', { name: 'Save relay' }));
    await within(reach).findByText('Each alert sends ntfy.sh a count only, never names or figures.');
    expect(said(calls, 'venture.notify.relay')).toContainEqual({ url: 'https://ntfy.sh/my-topic' });
    fireEvent.click(within(reach).getByRole('button', { name: 'Remove relay' }));
    await waitFor(() => expect(said(calls, 'venture.notify.relay')).toContainEqual({ url: null }));
  });

  it('quiet hours and the digest hour are saved together, or turned off', async () => {
    const { calls } = start();
    const quiet = await region('Quiet times');
    const box = await within(quiet).findByRole('checkbox', { name: 'Quiet hours' }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect((within(quiet).getByLabelText('From') as HTMLInputElement).value).toBe('22:00');
    expect((within(quiet).getByLabelText('To') as HTMLInputElement).value).toBe('07:00');
    fireEvent.change(within(quiet).getByLabelText('From'), { target: { value: '21:30' } });
    fireEvent.change(within(quiet).getByLabelText('Daily digest'), { target: { value: '9' } });
    fireEvent.click(within(quiet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(said(calls, 'venture.notify.settings')).toContainEqual({ quietHours: { from: '21:30', to: '07:00' }, digest: { hour: 9 } }));
    await screen.findByText(/Quiet hours: 21:30 to 07:00\. Daily digest at 09:00\.$/);
    fireEvent.click(within(quiet).getByRole('checkbox', { name: 'Quiet hours' }));
    expect(within(quiet).queryByLabelText('From')).toBeNull();
    fireEvent.change(within(quiet).getByLabelText('Daily digest'), { target: { value: 'off' } });
    fireEvent.click(within(quiet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(said(calls, 'venture.notify.settings')).toContainEqual({ quietHours: null, digest: null }));
    await screen.findByText(/No quiet hours\. No daily digest\.$/);
  });

  it('pauses until a date at most 30 days ahead, and resumes', async () => {
    const { calls } = start();
    const quiet = await region('Quiet times');
    const until = await within(quiet).findByLabelText('Pause alerts until') as HTMLInputElement;
    expect(until.min).toBe('2026-10-24');
    expect(until.max).toBe('2026-11-22');
    fireEvent.change(until, { target: { value: '2026-10-30' } });
    fireEvent.click(within(quiet).getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(said(calls, 'venture.notify.settings').some((p) => typeof (p as { pausedUntil?: unknown }).pausedUntil === 'string')).toBe(true));
    const sent = said(calls, 'venture.notify.settings').find((p) => typeof (p as { pausedUntil?: unknown }).pausedUntil === 'string') as { pausedUntil: string };
    expect(sent.pausedUntil.startsWith('2026-10-29T') || sent.pausedUntil.startsWith('2026-10-30T')).toBe(true);
    await screen.findByText(/^Alerts outside the app are paused until 30 Oct 2026/);
    fireEvent.click(await within(quiet).findByRole('button', { name: 'Resume alerts now' }));
    await waitFor(() => expect(said(calls, 'venture.notify.settings')).toContainEqual({ pausedUntil: null }));
    await within(quiet).findByLabelText('Pause alerts until');
  });

  it('a pause the engine refuses says so in the engine\'s words', async () => {
    start();
    const quiet = await region('Quiet times');
    const until = await within(quiet).findByLabelText('Pause alerts until');
    fireEvent.change(until, { target: { value: '2026-12-30' } });
    fireEvent.click(within(quiet).getByRole('button', { name: 'Pause' }));
    await within(quiet).findByText("Couldn't save: Pause alerts for 30 days at most.");
  });

  it('lists what keeps running while Chausar is closed, from the engine', async () => {
    start();
    const running = await region('Keeps running while Chausar is closed');
    await within(running).findByText('Backups, by Keeper');
    expect(within(running).getAllByRole('listitem')).toHaveLength(3);
  });
});

describe('Business > Notifications: what each setting means, and what the engine does not offer', () => {
  it('says what quiet hours, the digest and a pause do', async () => {
    start();
    const quiet = await region('Quiet times');
    await within(quiet).findByText("During quiet hours, alerts outside the app wait, then one count comes when they end. Items that expire soon still come. Times are in the business's time zone.");
    expect(within(quiet).getByText('The digest stays in the bell: its words never go to your phone or the tray.')).toBeTruthy();
    expect(within(quiet).getByText('30 days at most. Nothing is replayed after it ends. The bell still lists everything.')).toBeTruthy();
  });

  it('shows the tray and the relay only when the engine answers for the relay', async () => {
    start({ refuse: { 'venture.notify.relay': new EngineError('NOT_BUILT_YET', 'Not built yet.') } });
    const reach = await region('How alerts reach you');
    await within(reach).findByText('Phone alerts need the hosted app. On this computer the tray shows the count.');
    await within(reach).findByText("Couldn't load this: Not built yet.");
    expect(within(reach).queryByRole('checkbox', { name: 'Show the count in the tray' })).toBeNull();
    expect(within(reach).queryByLabelText('Your relay address')).toBeNull();
  });

  it('a hosted server without push keys says phone alerts are not set up, in the engine words', async () => {
    const words = 'Phone alerts are not set up on this server yet. The bell still lists everything.';
    start({ hosted: true, refuse: { 'venture.notify.push.key': new EngineError('TIER_UNAVAILABLE', words) } });
    const reach = await region('How alerts reach you');
    await within(reach).findByText(words);
    expect(within(reach).queryByRole('button', { name: 'Turn on phone alerts' })).toBeNull();
    expect(within(reach).queryByRole('checkbox', { name: 'Show the count in the tray' })).toBeNull();
    const running = await region('Keeps running while Chausar is closed');
    await within(running).findByText('Nothing. On the hosted app, Chausar sleeps while nobody has it open.');
  });
});

describe('Business > Notifications on the hosted app', () => {
  it('says phone alerts come only while Chausar is awake, and asks the browser only when Turn on is pressed', async () => {
    const { browser } = fakeBrowser();
    const { calls } = start({ hosted: true, browser });
    const reach = await region('How alerts reach you');
    await within(reach).findByText(/phone alerts come only while Chausar is awake for this business/);
    expect(within(reach).queryByRole('checkbox', { name: 'Show the count in the tray' })).toBeNull();
    expect(within(reach).queryByLabelText('Your relay address')).toBeNull();
    const on = await within(reach).findByRole('button', { name: 'Turn on phone alerts' });
    expect(browser.ask).not.toHaveBeenCalled();
    fireEvent.click(on);
    await within(reach).findByText('Phone alerts are on for this browser. They carry a count only, never names or figures.');
    expect(browser.ask).toHaveBeenCalledTimes(1);
    expect(browser.subscribe).toHaveBeenCalledWith(expect.stringMatching(/^B/));
    expect(said(calls, 'venture.notify.push.subscribe')).toEqual([{ subscription: SUB }]);
    expect(said(calls, 'venture.notify.settings')).not.toContainEqual({ push: true });
    await screen.findByText(/^Phone alerts are on, with a count only, and come while Chausar is awake for this business\./);
    fireEvent.click(within(reach).getByRole('button', { name: 'Turn off phone alerts' }));
    await waitFor(() => expect(said(calls, 'venture.notify.push.unsubscribe')).toEqual([{ endpoint: SUB.endpoint }]));
    await within(reach).findByRole('button', { name: 'Turn on phone alerts' });
    assertInkRules(document.body);
  });

  it('a browser that blocks it: "Push is off" and the bell still works, with nothing sent to the engine', async () => {
    const { browser } = fakeBrowser('default', 'denied');
    const { calls } = start({ hosted: true, browser });
    const reach = await region('How alerts reach you');
    fireEvent.click(await within(reach).findByRole('button', { name: 'Turn on phone alerts' }));
    await within(reach).findByText('Push is off: your browser blocked it. The bell still works.');
    expect(said(calls, 'venture.notify.push.subscribe')).toEqual([]);
    expect(within(reach).queryByRole('button', { name: 'Turn on phone alerts' })).toBeNull();
  });

  it('follows the browser\'s permission live while the page is open', async () => {
    const fake = fakeBrowser('granted');
    start({ hosted: true, browser: fake.browser });
    const reach = await region('How alerts reach you');
    await within(reach).findByRole('button', { name: 'Turn on phone alerts' });
    fake.change('denied');
    await within(reach).findByText('Push is off: your browser blocked it. The bell still works.');
    fake.change('default');
    await within(reach).findByRole('button', { name: 'Turn on phone alerts' });
  });

  it('a browser without push says so, and the bell still works', async () => {
    const browser = { ...fakeBrowser().browser, supported: () => false };
    start({ hosted: true, browser });
    const reach = await region('How alerts reach you');
    await within(reach).findByText("This browser can't show phone alerts. The bell still works.");
  });

  it('keeps running: nothing, because the hosted app sleeps while nobody has it open', async () => {
    start({ hosted: true });
    const running = await region('Keeps running while Chausar is closed');
    await within(running).findByText('Nothing. On the hosted app, Chausar sleeps while nobody has it open.');
  });

  it('in Hindi', async () => {
    start({ hosted: true, language: 'hi' });
    expect(await screen.findByRole('heading', { level: 1, name: 'सूचनाएँ' })).toBeTruthy();
    await screen.findByRole('button', { name: 'फ़ोन अलर्ट चालू करें' });
  });
});

describe('phone alerts at every load of the hosted app', () => {
  const hostedClient = () => {
    const client = createFakeClient(new FakeEngine({ now: () => NOW, hosted: true }));
    const request = vi.fn(client.request.bind(client));
    return { ...client, transport: 'hosted' as const, request: request as unknown as EngineClient['request'], calls: request };
  };

  it('registers the service worker and sends this browser\'s subscription again, so it carries the current session', async () => {
    const fake = fakeBrowser('granted');
    fake.state.subscription = SUB;
    const client = hostedClient();
    await startHostedPush(client, fake.browser);
    expect(fake.browser.register).toHaveBeenCalledTimes(1);
    expect(client.calls).toHaveBeenCalledWith('venture.notify.push.subscribe', { subscription: SUB });
    expect(fake.browser.ask).not.toHaveBeenCalled();
  });

  it('sends nothing when this browser has no subscription or never allowed it, and does nothing off the hosted app', async () => {
    const client = hostedClient();
    await startHostedPush(client, fakeBrowser('granted').browser);
    await startHostedPush(client, fakeBrowser('default').browser);
    expect(client.calls).not.toHaveBeenCalled();
    const desktop = { ...hostedClient(), transport: 'desktop' as const };
    const fake = fakeBrowser('granted');
    fake.state.subscription = SUB;
    await startHostedPush(desktop, fake.browser);
    expect(fake.browser.register).not.toHaveBeenCalled();
    expect(desktop.calls).not.toHaveBeenCalled();
  });
});
