import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError, type EngineClient } from '../../src/engine/types';
import { assertInkRules } from '../helpers/ink-rules';

/*
 * Apps (wave 6 package 6H1, D39; reference-ui/AppsA and AppsB). The Apps place lists the owner's mini apps with what
 * each reads, a box to make one and what every app can and cannot do. Making one opens it beside its permission
 * screen; nothing runs before Allow, and then it runs in a frame with scripts but no same origin, loaded from the
 * sandbox proxy. Versions with Use and Undo, Pin to Today with Undo (Today then lists it), Export, Turn off, Delete.
 */

async function start(hash = '#/apps') {
  window.location.hash = hash;
  const base = createFakeClient(new FakeEngine());
  const spy = vi.fn();
  const client: EngineClient = {
    ...base,
    request: ((method: string, params?: Record<string, unknown>) => {
      spy(method, params);
      return base.request(method as never, params as never);
    }) as EngineClient['request'],
  };
  const view = render(<App client={client} language="en" />);
  return { base, spy, ...view };
}

const hashChanged = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); hashChanged(); }); };
const click = async (element: HTMLElement) => { await act(async () => { fireEvent.click(element); }); await settle(); };
const calls = (spy: ReturnType<typeof vi.fn>, method: string) => spy.mock.calls.filter(([m]) => m === method).map(([, p]) => p as Record<string, unknown>);

async function send(label: string, text: string) {
  const box = screen.getByRole('textbox', { name: label });
  await act(async () => { fireEvent.change(box, { target: { value: text } }); });
  await act(async () => { fireEvent.keyDown(box, { key: 'Enter' }); });
  await settle();
}

describe('Apps (6H1)', () => {
  // C4 task 29 (founder decision 3): the button only when the app has no data; the banner while on sample rows; every call says sample.
  it('an app with no data offers Preview with sample data; the banner stays while it runs on it; Back to your data returns', async () => {
    window.location.hash = '#/apps?app=miniapp_sample';
    const base = createFakeClient(new FakeEngine());
    const client: EngineClient = {
      ...base,
      request: (async (method: string, params?: Record<string, unknown>) => {
        const answer = await base.request(method as never, params as never);
        return method === 'venture.apps.get' ? { app: { ...(answer as { app: object }).app, empty: true } } : answer;
      }) as EngineClient['request'],
    };
    render(<App client={client} language="en" />);
    const go = await screen.findByRole('button', { name: 'Preview with sample data' });
    expect(screen.queryByText('Sample data, not your records')).toBeNull();
    const frame = () => document.querySelector('iframe[data-mini-app]') as HTMLIFrameElement;
    const live = frame();
    await click(go);
    expect(screen.getByText('Sample data, not your records')).toBeTruthy();
    expect(frame()).not.toBe(live);
    expect(frame().getAttribute('data-sample')).toBe('');
    expect(screen.queryByRole('button', { name: 'Preview with sample data' })).toBeNull();
    await click(screen.getByRole('button', { name: 'Back to your data' }));
    expect(screen.queryByText('Sample data, not your records')).toBeNull();
    expect(frame().hasAttribute('data-sample')).toBe(false);
    expect(screen.getByRole('button', { name: 'Preview with sample data' })).toBeTruthy();
  });

  it('an app with data of its own offers no preview', async () => {
    await start('#/apps?app=miniapp_sample');
    await screen.findByRole('button', { name: 'Pin to Today' });
    expect(screen.queryByRole('button', { name: 'Preview with sample data' })).toBeNull();
  });

  it('the rail has Apps between Money and Connections; the place lists the sample app, the make box and the rules', async () => {
    await start();
    const rail = screen.getByRole('navigation', { name: 'Places' });
    const hrefs = within(within(rail).getAllByRole('list')[0]!).getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs.slice(5, 8)).toEqual(['#/money', '#/apps', '#/connections']);
    expect(await screen.findByRole('heading', { level: 1, name: 'Apps' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Make an app' })).toBeTruthy();
    const card = await screen.findByRole('article', { name: 'Who owes me' });
    expect(within(card).getByText('Reads: Clients')).toBeTruthy();
    expect(within(card).getByRole('link', { name: 'Open Who owes me' }).getAttribute('href')).toBe('#/apps?app=miniapp_sample');
    const rules = screen.getByRole('region', { name: "What every app can and can't do" });
    expect(within(rules).getByText('Never')).toBeTruthy();
    assertInkRules();
  });

  // C5 task 8: each idea shows its preview line under it; a press still fills the box with the idea's words.
  it('each app idea shows its preview line, and pressing one fills the box', async () => {
    await start();
    const ideas = await screen.findByRole('group', { name: 'Ideas to start from' });
    const first = within(ideas).getByRole('button', { name: /Who owes me, by client/ });
    expect(first.textContent).toContain('A table of unpaid invoices grouped by client, with what each owes.');
    await click(first);
    expect((screen.getByRole('textbox', { name: 'Describe the app' }) as HTMLTextAreaElement).value).toBe('Who owes me, by client');
  });

  // One-shot A4 (hands-on row 75, bug 15): the wait only while a make is on its way. C3 task 11: "Writing your app" with
  // its elapsed time, where it said "Your AI is writing it.".
  it('says the AI is writing only while the app is being made, never at rest or after a refusal', async () => {
    window.location.hash = '#/apps';
    const base = createFakeClient(new FakeEngine());
    let release: (() => void) | null = null;
    let refuse = false;
    const client: EngineClient = {
      ...base,
      request: (async (method: string, params?: Record<string, unknown>) => {
        if (method === 'venture.apps.make') {
          await new Promise<void>((done) => { release = done; });
          if (refuse) throw Object.assign(new Error('Connect your AI first.'), { code: 'NO_MODEL_CONNECTED' });
        }
        return base.request(method as never, params as never);
      }) as EngineClient['request'],
    };
    render(<App client={client} language="en" />);
    await screen.findByRole('article', { name: 'Who owes me' });
    expect(screen.queryByText('Writing your app')).toBeNull();
    expect(screen.queryByText('Your AI is writing it.')).toBeNull();
    refuse = true;
    const box = screen.getByRole('textbox', { name: 'Describe the app' });
    await act(async () => { fireEvent.change(box, { target: { value: 'A list of who is due' } }); });
    await act(async () => { fireEvent.keyDown(box, { key: 'Enter' }); });
    expect(await screen.findByText(/^Writing your app/)).toBeTruthy();
    expect(screen.queryByText('Your AI is writing it.')).toBeNull();
    await act(async () => { release!(); });
    await screen.findByText(/Connect your AI first\./);
    expect(screen.queryByText(/^Writing your app/)).toBeNull();
  });

  it('no AI connected is a known state: muted words, Connect in the line, the words kept (B4)', async () => {
    window.location.hash = '#/apps';
    const client = createFakeClient(new FakeEngine());
    const base = client.request.bind(client);
    client.request = ((method: string, params?: unknown) => (method === 'venture.apps.make'
      ? Promise.reject(new EngineError('APP_NEEDS_AI', 'Connect your AI first. Your AI writes the app; Chausar checks it and runs it in a locked box.'))
      : base(method as never, params as never))) as EngineClient['request'];
    render(<App client={client} language="en" />);
    const box = await screen.findByRole('textbox', { name: 'Describe the app' }) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'A sheet of my batches' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
    const line = await screen.findByText(/^Connect your AI first\./);
    expect(line.closest('[data-tone]')!.getAttribute('data-tone')).toBe('expected');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(box.value).toBe('A sheet of my batches');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Connect your AI' })); });
    expect(window.location.hash).toBe('#/connections');
  });

  it('making an app opens it beside its permission screen; it runs only after Allow, in a locked frame', async () => {
    const { spy } = await start();
    await screen.findByRole('article', { name: 'Who owes me' });
    await send('Describe the app', 'A sheet of my batches and who is due');
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/apps\?app=miniapp_\d+$/));
    expect(calls(spy, 'venture.apps.make')).toEqual([{ ask: 'A sheet of my batches and who is due' }]);
    expect(await screen.findByText('A sheet of my batches and who is due')).toBeTruthy();
    expect(screen.getByText(/^Here's a first version\./)).toBeTruthy();
    const side = screen.getByRole('region', { name: /^Allow "/ });
    expect(within(side).getByText('First time only')).toBeTruthy();
    expect(within(side).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Read Clients: their names', 'Read Invoices: number, status and what is owed, each with a receipt', 'Keep its own notes in Chausar', 'Propose cards on Today. You approve each one.',
    ]);
    expect(document.querySelector('iframe[data-mini-app]')).toBeNull();
    expect(screen.getByText('Allow this app to run it.')).toBeTruthy();
    assertInkRules();
    await click(within(side).getByRole('button', { name: 'Allow' }));
    const made = calls(spy, 'venture.apps.make').length;
    expect(made).toBe(1);
    const grant = calls(spy, 'venture.apps.grant')[0]!;
    expect(grant.digest).toMatch(/^[0-9a-f]+$/);
    const frame = await waitFor(() => { const found = document.querySelector('iframe[data-mini-app]'); expect(found).not.toBeNull(); return found as HTMLIFrameElement; });
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('src')).toBe('mini-frame.html');
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(frame.getAttribute('allow')).toMatch(/camera 'none'/);
    expect(screen.getByText(/can run now, with only what you allowed\./)).toBeTruthy();
  });

  it('an opened app: pin to Today with Undo, and Today then lists it', async () => {
    const { spy } = await start('#/apps?app=miniapp_sample');
    expect(await screen.findByRole('heading', { name: 'What it may do' })).toBeTruthy();
    expect(document.querySelector('iframe[data-mini-app="miniapp_sample"]')).not.toBeNull();
    await click(screen.getByRole('button', { name: 'Pin to Today' }));
    expect(calls(spy, 'venture.apps.pin')).toEqual([{ app: 'miniapp_sample', pinned: true }]);
    expect(screen.getByText('Pinned to Today.')).toBeTruthy();
    await click(screen.getByRole('button', { name: 'Undo' }));
    expect(calls(spy, 'venture.apps.pin').at(-1)).toEqual({ app: 'miniapp_sample', pinned: false });
    await click(screen.getByRole('button', { name: 'Pin to Today' }));
    window.location.hash = '#/today';
    await settle();
    const pinned = await screen.findByRole('region', { name: 'Pinned apps' });
    expect(within(pinned).getByRole('link', { name: 'Open Who owes me' })).toBeTruthy();
  });

  it('a change is a new version; Use goes back with Undo; Turn off locks it; Delete asks first', async () => {
    const { spy } = await start('#/apps?app=miniapp_sample');
    await screen.findByRole('heading', { name: 'What it may do' });
    await send('Ask for a change', 'Add a column for the phone number');
    expect(calls(spy, 'venture.apps.make')).toEqual([{ ask: 'Add a column for the phone number', app: 'miniapp_sample' }]);
    expect(await screen.findByText(/^Here's version 2\./)).toBeTruthy();
    await click(screen.getByRole('button', { name: 'Use version 1' }));
    expect(calls(spy, 'venture.apps.restore')).toEqual([{ app: 'miniapp_sample', version: 1 }]);
    expect(screen.getByText('Now on version 1. Undo goes back.')).toBeTruthy();
    await click(screen.getByRole('button', { name: 'Undo' }));
    expect(calls(spy, 'venture.apps.restore').at(-1)).toEqual({ app: 'miniapp_sample', version: 2 });
    await click(screen.getByRole('button', { name: 'Turn off' }));
    expect(await screen.findByText('Allow this app to run it.')).toBeTruthy();
    expect(screen.getByRole('region', { name: /^Allow "/ })).toBeTruthy();
    await click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(window.location.hash).toBe('#/apps'));
  });

  it('Delete asks first, then removes the app and its notes', async () => {
    const { spy } = await start('#/apps?app=miniapp_sample');
    await screen.findByRole('heading', { name: 'What it may do' });
    await click(screen.getByRole('button', { name: 'Delete app' }));
    expect(screen.getByText('Delete Who owes me and its notes? This cannot be undone.')).toBeTruthy();
    await click(screen.getByRole('button', { name: 'Delete' }));
    expect(calls(spy, 'venture.apps.remove')).toEqual([{ app: 'miniapp_sample' }]);
    await waitFor(() => expect(window.location.hash).toBe('#/apps'));
    expect(await screen.findByText('No apps yet. Describe one and your AI writes it.')).toBeTruthy();
  });
});
