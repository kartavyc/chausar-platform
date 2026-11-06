// C5 task 36: one language preference, chosen by the owner: a Language row in About you and a small link on Welcome back.
// The computer's language never decides; Settings says plainly the Hindi is machine-translated.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { pickLanguage } from '../../src/text';
import type { EngineClient, MethodName } from '../../src/engine/types';

type Call = { method: string; params: unknown };

function start(hash: string, engine = new FakeEngine(), change: (client: EngineClient) => void = () => {}) {
  window.location.hash = hash;
  const client = createFakeClient(engine);
  const calls: Call[] = [];
  const request = client.request.bind(client);
  client.request = ((method: MethodName, params?: unknown) => { calls.push({ method, params }); return request(method, params as never); }) as typeof client.request;
  change(client);
  render(<App client={client} language="en" />);
  return { calls, engine, client };
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); document.documentElement.lang = 'en'; });

describe('the language preference', () => {
  it('the row reads the preference, sets it on a press, and says the Hindi is machine-translated', async () => {
    const { calls, engine } = start('#/business/app');
    const row = await screen.findByRole('region', { name: 'Language' });
    expect(row.textContent).toContain('Hindi is machine-translated');
    expect(row.textContent).toContain('stay in English');
    const select = within(row).getByLabelText('Language') as HTMLSelectElement;
    await waitFor(() => expect(calls.some((call) => call.method === 'app.preferences.get')).toBe(true));
    expect(select.value).toBe('en');
    await act(async () => { fireEvent.change(select, { target: { value: 'hi' } }); });
    await waitFor(() => expect(calls.filter((call) => call.method === 'app.preferences.set').map((call) => call.params)).toEqual([{ language: 'hi' }]));
    expect(await engine.request('app.preferences.get', {})).toMatchObject({ language: 'hi' });
  });

  it('Welcome back has a small link to the other language, with no business open', async () => {
    const engine = new FakeEngine();
    await engine.request('workspace.lock', {});
    const { calls } = start('#/', engine);
    const link = await screen.findByRole('button', { name: 'हिन्दी' });
    expect(link.getAttribute('lang')).toBe('hi');
    await act(async () => { fireEvent.click(link); });
    await waitFor(() => expect(calls.filter((call) => call.method === 'app.preferences.set').map((call) => call.params)).toEqual([{ language: 'hi' }]));
  });

  it('a failed save says so and leaves the choice as it was', async () => {
    start('#/business/app', new FakeEngine(), (client) => {
      const request = client.request.bind(client);
      client.request = ((method: MethodName, params?: unknown) => (method === 'app.preferences.set' ? Promise.reject(new Error('The disk is full.')) : request(method, params as never))) as typeof client.request;
    });
    const row = await screen.findByRole('region', { name: 'Language' });
    const select = within(row).getByLabelText('Language') as HTMLSelectElement;
    await act(async () => { fireEvent.change(select, { target: { value: 'hi' } }); });
    await waitFor(() => expect(row.textContent).toContain('The disk is full.'));
    expect(select.value).toBe('en');
  });

  it('an engine that has no preference (hosted, an older one) stays in English with no row or link', async () => {
    start('#/business/app', new FakeEngine(), (client) => { (client as { transport: string }).transport = 'hosted'; });
    await screen.findByRole('heading', { name: 'This app' });
    expect(screen.queryByRole('region', { name: 'Language' })).toBeNull();
  });

  it('a phone or paired browser reads the preference, with no row: only the computer changes it', async () => {
    const engine = new FakeEngine();
    await engine.request('app.preferences.set', { language: 'hi' });
    const { calls } = start('#/business/app', engine, (client) => { (client as { transport: string }).transport = 'web'; });
    await waitFor(() => expect(document.documentElement.lang).toBe('hi'));
    expect(calls.some((call) => call.method === 'app.preferences.get')).toBe(true);
    await screen.findByRole('heading', { name: '\u0906\u092a\u0915\u0947 \u092c\u093e\u0930\u0947 \u092e\u0947\u0902' });
    expect(screen.queryByRole('region', { name: '\u092d\u093e\u0937\u093e' })).toBeNull();
  });

  it('never picks from the computer', () => {
    expect(pickLanguage(['hi-IN', 'hi'])).toBe('en');
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['hi-IN']);
    expect(pickLanguage()).toBe('en');
  });
});
