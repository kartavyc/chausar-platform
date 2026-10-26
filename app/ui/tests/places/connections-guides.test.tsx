import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { ConnectorCardLite, ConnectorChecksView, EngineClient } from '../../src/engine/types';
import type { Language } from '../../src/text';
import { assertInkRules } from '../helpers/ink-rules';

/**
 * Connections (W4 4J21, from 4J7): each connector's sheet shows its setup guide in the engine's words (numbered steps
 * that ask for the least access, the step people skip, what the platform charges, how Chausar checks access, what it
 * sends, the agents' limits), the half-configured line when a setting is missing, and the truth ladder's words for each
 * mode; "Check connections" runs venture.connectors.check and lists its rows, with Reconnect where a connection ended.
 */

async function start(hash = '#/connections', { language = 'en', edit, ai = false }: { language?: Language; edit?: (method: string, answer: unknown) => unknown; ai?: boolean } = {}) {
  window.location.hash = hash;
  const fake = createFakeClient(new FakeEngine({ now: () => '2026-10-26T09:00:00.000Z' }));
  // The open sample business has no AI: connect the two Anthropic keys, as the owner would under Your AI.
  if (ai) {
    await fake.request('venture.models.connect', { presetId: 'anthropic-haiku-5-5', consentDigest: 'consent-anthropic', apiKey: 'sk-ant-test' });
    await fake.request('venture.models.connect', { presetId: 'anthropic-sonnet-5-5', consentDigest: 'consent-anthropic', apiKey: 'sk-ant-test' });
  }
  const calls: string[] = [];
  const client: EngineClient = {
    ...fake,
    request: (async (method: string, params?: unknown) => {
      calls.push(method);
      const answer = await fake.request(method as never, params as never);
      return edit ? edit(method, answer) : answer;
    }) as EngineClient['request'],
  };
  render(<App client={client} language={language} />);
  return { calls };
}

const go = async (hash: string) => { await act(async () => { window.location.hash = hash; window.dispatchEvent(new HashChangeEvent('hashchange')); }); };

describe('Connections: the setup guide in each connector\'s sheet', () => {
  it('GitHub: numbered least-privilege steps, the step people skip, the charges, how access is checked, what it sends, the limits', async () => {
    await start('#/connections?sheet=connector:github');
    const guide = await screen.findByRole('region', { name: 'How to connect' });
    const steps = within(guide).getByRole('list', { name: 'Steps' });
    const items = within(steps).getAllByRole('listitem').map((item) => item.textContent);
    expect(items[0]).toBe('1. On GitHub, make a fine-grained personal access token.');
    expect(items[1]).toContain('Only select repositories');
    expect(guide.querySelector('[data-guide="skipped"]')?.textContent).toMatch(/^People often skip this:/);
    expect(guide.querySelector('[data-guide="charges"]')?.textContent).toMatch(/^What it costs:/);
    expect(guide.querySelector('[data-guide="checks"]')?.textContent).toBeTruthy();
    expect(guide.querySelector('[data-guide="sends"]')?.textContent).toMatch(/^Sends: /);
    expect(guide.querySelector('[data-guide="limits"]')?.textContent).toBeTruthy();
    expect(guide.querySelector('[data-guide="missing"]')).toBeNull();
    assertInkRules();
  });

  it('a charges line the catalogue dated says when it was noted', async () => {
    await start('#/connections?sheet=connector:vercel');
    const guide = await screen.findByRole('region', { name: 'How to connect' });
    expect(guide.querySelector('[data-guide="charges"]')?.textContent).toBe('What it costs: The free Hobby plan is for personal, non-commercial sites, so a business site needs a paid plan. Noted on 16 Oct 2026.');
  });

  it('each mode says how far it is proven, by the truth ladder', async () => {
    await start('#/connections?sheet=connector:github');
    await screen.findByRole('region', { name: 'How to connect' });
    const read = document.querySelector('[data-mode="read"]')!;
    expect(read.querySelector('[data-ladder]')?.getAttribute('data-ladder')).toBe('discovered');
    expect(read.querySelector('[data-ladder]')?.textContent).toBe('Built in, not yet seen working on this business');
    await go('#/connections?sheet=connector:instagram');
    await waitFor(() => expect(document.querySelector('[data-posting-option="owner-browser-session"] [data-ladder]')?.getAttribute('data-ladder')).toBe('unavailable'));
    expect(document.querySelector('[data-posting-option="owner-browser-session"] [data-ladder]')?.textContent).toBe('Not available here');
  });

  it('a half-configured connection names its missing setting', async () => {
    await start('#/connections?sheet=connector:github', {
      edit: (method, answer) => (method === 'venture.connectors.list'
        ? (answer as ConnectorCardLite[]).map((card) => (card.id === 'github' && card.guide ? { ...card, guide: { ...card.guide, missing: 'Missing: the GitHub token. Chausar keeps it only while the app is open, so paste it again.' } } : card))
        : answer),
    });
    const guide = await screen.findByRole('region', { name: 'How to connect' });
    expect(guide.querySelector('[data-guide="missing"]')?.textContent).toBe('Missing: the GitHub token. Chausar keeps it only while the app is open, so paste it again.');
  });

  it('in Hindi the headings are Hindi and the guide stays in the engine\'s words', async () => {
    await start('#/connections?sheet=connector:bank-account', { language: 'hi' });
    const guide = await screen.findByRole('region', { name: 'कैसे जोड़ें' });
    expect(within(guide).getAllByRole('listitem')[0]!.textContent).toBe("1. Download a statement from your bank's site as a CSV file.");
  });
});

describe('Connections: Check connections', () => {
  it('runs one check and lists each row with its outcome, the health counts, and the end date', async () => {
    const { calls } = await start('#/connections', { ai: true });
    const tile = await screen.findByRole('region', { name: 'Check connections' });
    // Before a press only the last check is read (none yet here): no new read.
    await waitFor(() => expect(calls.filter((m) => m === 'venture.connectors.check')).toHaveLength(1));
    expect(within(tile).queryByRole('list', { name: 'What each check found' })).toBeNull();
    fireEvent.click(within(tile).getByRole('button', { name: 'Check now' }));
    const rows = await within(tile).findByRole('list', { name: 'What each check found' });
    // One read of the last check when the tile opens, then the one check pressed.
    expect(calls.filter((m) => m === 'venture.connectors.check')).toHaveLength(2);
    const items = within(rows).getAllByRole('listitem');
    expect(items.map((item) => item.querySelector('[data-check-name]')?.textContent)).toEqual(['Claude Haiku 5.5', 'Claude Sonnet 5.5', 'Bank: HDFC current']);
    expect(items[0]!.querySelector('[data-outcome]')?.getAttribute('data-outcome')).toBe('answered');
    expect(items[0]!.textContent).toContain('Your Claude Haiku 5.5 key answered. Listing its models is free, so this check cost nothing.');
    expect(items[2]!.querySelector('[data-outcome]')?.textContent).toBe('Skipped');
    expect(items[2]!.textContent).toContain('Ends 13 Jan 2027');
    expect(tile.querySelector('[data-health]')?.textContent).toBe('2 ready · 0 warnings · 0 blocking');
    expect(within(tile).queryByRole('link', { name: /Reconnect/ })).toBeNull();
    assertInkRules();
  });

  it('a connection whose access has ended offers Reconnect; a failed one says its fix', async () => {
    await start('#/connections', {
      edit: (method, answer) => (method === 'venture.connectors.check' && answer ? {
        ...(answer as ConnectorChecksView),
        rows: [
          { connectorId: 'bank-account', name: 'Bank: HDFC current', outcome: 'skipped', line: 'No bank provider is linked; the consent is kept for when one is.', account: 'HDFC current', expiresOn: '2026-10-20', fix: null },
          { connectorId: 'model:anthropic-sonnet-5-5', name: 'Claude Sonnet 5.5', outcome: 'failed', line: 'Anthropic refused the key.', account: null, expiresOn: null, fix: 'Make a new key in your Anthropic account and paste it under Connections, Your AI.' },
        ],
        health: { ready: 0, warnings: 0, blocking: 1 },
      } : answer),
    });
    const tile = await screen.findByRole('region', { name: 'Check connections' });
    fireEvent.click(within(tile).getByRole('button', { name: 'Check now' }));
    const rows = await within(tile).findByRole('list', { name: 'What each check found' });
    const [bank, key] = within(rows).getAllByRole('listitem');
    expect(bank!.textContent).toContain('Ended 20 Oct 2026');
    expect(within(bank!).getByRole('button', { name: 'Reconnect Bank: HDFC current' })).toBeTruthy();
    expect(key!.querySelector('[data-outcome]')?.textContent).toBe('Failed');
    expect(key!.textContent).toContain('Make a new key in your Anthropic account and paste it under Connections, Your AI.');
  });

  it('on load it shows the newest check (venture.connectors.check { last: true }), with no new read', async () => {
    window.location.hash = '#/connections';
    const engine = new FakeEngine({ now: () => '2026-10-26T09:00:00.000Z' });
    await engine.request('venture.connectors.check', {});
    const fake = createFakeClient(engine);
    const calls: unknown[] = [];
    const client: EngineClient = { ...fake, request: (async (method: string, params?: unknown) => { if (method === 'venture.connectors.check') calls.push(params); return fake.request(method as never, params as never); }) as EngineClient['request'] };
    render(<App client={client} language="en" />);
    const tile = await screen.findByRole('region', { name: 'Check connections' });
    const rows = await within(tile).findByRole('list', { name: 'What each check found' });
    expect(within(rows).getAllByRole('listitem').map((item) => item.querySelector('[data-check-name]')?.textContent)).toEqual(['Bank: HDFC current']);
    expect(tile.querySelector('[data-checked-at]')?.textContent).toMatch(/^Last checked /);
    expect(calls).toEqual([{ last: true }]);
  });

  it('nothing connected says so', async () => {
    await start('#/connections', { edit: (method, answer) => (method === 'venture.connectors.check' ? { at: '2026-10-26T09:00:00.000Z', rows: [], health: { ready: 0, warnings: 0, blocking: 0 } } : answer) });
    const tile = await screen.findByRole('region', { name: 'Check connections' });
    fireEvent.click(within(tile).getByRole('button', { name: 'Check now' }));
    expect(await within(tile).findByText('Nothing is connected yet, so there was nothing to check.')).toBeTruthy();
  });
});
