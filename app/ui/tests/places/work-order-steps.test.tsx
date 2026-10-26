import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { assertInkRules, assertOnePrimary } from '../helpers/ink-rules';

/*
 * W4 4J19 on Work and the run sheet: each order card draws the engine's stage steps (D-Work `.osteps`) with the state in
 * words for a screen reader and "2 wait on you: ..." in the engine's words; the run sheet of an accepted run shows the
 * Delivered card (A17): what it handed over with digests, apart from files changed by someone else, read-only, with
 * Make a copy.
 */

function start(hash: string, language: 'en' | 'hi' = 'en') {
  window.location.hash = hash;
  const client = createFakeClient(new FakeEngine({ now: () => '2026-10-23T10:00:00.000Z' }));
  const spy = vi.spyOn(client, 'request');
  render(<App client={client} language={language} />);
  return { client, spy };
}
const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });

afterEach(() => { window.location.hash = ''; });

describe('Work: order stage steps', () => {
  it('draws each stage with its state, and what waits on the owner', async () => {
    start('#/work');
    await waitFor(() => expect(document.querySelectorAll('[data-order-steps]').length).toBeGreaterThan(0));
    const card = screen.getByRole('heading', { level: 4, name: /episode 14/i }).closest('li') as HTMLElement;
    const steps = card.querySelector<HTMLElement>('[data-order-steps]')!;
    expect(steps.getAttribute('aria-label')).toBe('Steps for this order');
    const items = [...steps.querySelectorAll('li')];
    expect(items.map((li) => li.getAttribute('data-state'))).toEqual(['done', 'waits', 'waits', 'always-asks', 'not-yet', 'not-yet']);
    expect(items.map((li) => li.querySelector('span:not(.sr-only):not([aria-hidden])')!.textContent)).toEqual(['Agreed', 'Price', 'Episode', 'Publish', 'Invoice', 'Paid']);
    // The screen's own words from the codes (4J19 review), never the engine's English detail.
    expect(items[1]!.querySelector('.sr-only')!.textContent).toBe(', waits on you');
    expect(items[0]!.querySelector('.sr-only')!.textContent).toBe(', done');
    expect(items[3]!.querySelector('.sr-only')!.textContent).toBe(', always asks you');
    expect(card.querySelector('[data-waits-on-you]')!.textContent).toBe('2 wait on you: Price, Episode');
    assertInkRules(document.body);
    assertOnePrimary(document.body);
  });

  it('an order that waits on no one says nothing extra', async () => {
    start('#/work');
    await waitFor(() => expect(document.querySelectorAll('[data-order-steps]').length).toBeGreaterThan(1));
    const card = screen.getByRole('heading', { level: 4, name: /episode 12/i }).closest('li') as HTMLElement;
    expect(card.querySelector('[data-waits-on-you]')).toBeNull();
    expect([...card.querySelectorAll('[data-order-steps] li')].at(-1)!.querySelector('.sr-only')!.textContent).toBe(', not yet, due 28 Oct');
  });
});

describe('Work: order stage steps in Hindi', () => {
  it('words every stage, its state and what waits on the owner in Hindi, with no engine English', async () => {
    start('#/work', 'hi');
    await waitFor(() => expect(document.querySelectorAll('[data-order-steps]').length).toBeGreaterThan(0));
    const steps = document.querySelector<HTMLElement>('[data-order-steps]')!;
    const card = steps.closest('li[data-row]') as HTMLElement;
    expect(card.querySelector('[data-waits-on-you]')!.textContent).toBe('2 आपका इंतज़ार: दाम, एपिसोड');
    for (const li of steps.querySelectorAll('li')) expect(li.textContent ?? '', li.textContent ?? '').not.toMatch(/[A-Za-z]{3,}/);
  });
});

describe('the run sheet: the Delivered card (A17)', () => {
  it('lists what the run handed over with digests, and apart the files changed during it, read-only, with Make a copy', async () => {
    const { spy } = start('#/work?sheet=run%3A27');
    const card = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-delivered]');
      expect(found).not.toBeNull();
      return found!;
    });
    expect(within(card).getByRole('heading', { level: 3, name: 'Delivered' })).toBeTruthy();
    expect(card.textContent).toContain('Handed over 1 file.');
    const made = card.querySelector('[data-delivered-file="table"]')!;
    expect(made.textContent).toContain('September bank lines matched to invoices');
    expect(made.textContent).toContain('Made by a tool');
    expect(made.querySelector('.mono')!.textContent).toBe('3c9e5a7f1b2d');
    const changed = card.querySelector('[data-delivered-changed]')!;
    expect(changed.textContent).toContain("Changed during this run, not proven to be the agent's.");
    expect(changed.textContent).toContain('mehta-sales-register-september.xlsx');
    expect(card.textContent).toContain('This went out, so it stays as it was.');
    await act(async () => { fireEvent.click(within(card).getByRole('button', { name: 'Make a copy' })); });
    await settle();
    expect(spy.mock.calls.filter(([method]) => method === 'venture.delivery.copy').map(([, p]) => p)).toEqual([{ runId: '27' }]);
    // The sample keeps no draft reply for this run: the engine's refusal, in the screen's words for it.
    expect(within(card).getByRole('status').textContent).toBe('That draft reply was not found.');
    assertInkRules(document.body);
  });

  it('a practice run offers no Make a copy (the engine refuses a practice draft)', async () => {
    window.location.hash = '#/work?sheet=run%3Ad-practice-1';
    const client = createFakeClient(new FakeEngine({ now: () => '2026-10-23T10:00:00.000Z' }));
    const request = client.request.bind(client);
    client.request = (async (method: string, params?: unknown) => {
      if (method === 'venture.runs.get') {
        const run = await request('venture.runs.get', { runId: '27' });
        return { ...run, runId: 'd-practice-1' };
      }
      return request(method as never, params as never);
    }) as typeof client.request;
    render(<App client={client} language="en" />);
    const card = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-delivered]');
      expect(found).not.toBeNull();
      return found!;
    });
    await settle();
    expect(within(card).queryByRole('button', { name: 'Make a copy' })).toBeNull();
  });
});
