// Today on a phone (w3 plan, package 3H1; D-Phone-Today): every card can be swiped, right for its primary and left
// for later, and the swipe goes through the card's own path (ApprovalRow's handle), so it never skips the second ask
// or view-before-approve and never decides money alone (spec 8). The tip says so once and stays hidden for the
// session once hidden, held in memory only. Stories and filter chips scroll sideways; every card button is xl.
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { App } from '../../src/shell/App';
import { ClockProvider } from '../../src/shell/clock';
import { NARROW } from '../../src/shell/useNarrow';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { EngineClient } from '../../src/engine/types';
import { assertInkRules } from '../helpers/ink-rules';

function stubWidth(narrow: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: query === NARROW && narrow, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }) as unknown as MediaQueryList);
}

/**
 * Today on a phone (or not) with the fake engine. `hold`: every decision waits until `release()`, so a second swipe
 * can come while the first is on its way.
 */
function start({ narrow = true, hash = '#/today', hold = false }: { narrow?: boolean; hash?: string; hold?: boolean } = {}) {
  stubWidth(narrow);
  window.location.hash = hash;
  const engine = new FakeEngine();
  const fake = createFakeClient(engine);
  const request = fake.request.bind(fake);
  const held: (() => void)[] = [];
  const client: EngineClient = {
    ...fake,
    request: (async (method: string, params?: unknown) => {
      if (hold && method === 'venture.queue.decide') await new Promise<void>((resolve) => held.push(resolve));
      return request(method as never, params as never);
    }) as EngineClient['request'],
  };
  const spy = vi.spyOn(client, 'request');
  render(<ClockProvider now={() => new Date(2026, 9, 23, 19, 5)}><App client={client} language="en" /></ClockProvider>);
  const decides = () => spy.mock.calls.filter(([method]) => method === 'venture.queue.decide');
  const release = async () => { await act(async () => { held.splice(0).forEach((go) => go()); }); await settle(); };
  return { engine, client, spy, decides, release };
}

const settle = async () => { for (let i = 0; i < 4; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const hashChanged = async () => { await act(async () => { window.dispatchEvent(new HashChangeEvent('hashchange')); }); };
const needsYou = () => screen.getByRole('region', { name: 'Needs you' });
const rowIds = () => [...needsYou().querySelectorAll('[data-row]')].map((el) => el.getAttribute('data-row-id'));
const cardOf = (id: string) => needsYou().querySelector<HTMLElement>(`[data-row-id="${id}"]`)!;
const swiperOf = (id: string) => cardOf(id).closest<HTMLElement>('[data-swipe-card]')!;
const locked = (button: HTMLElement) => button.getAttribute('aria-disabled') === 'true';

async function loaded() {
  await waitFor(() => expect(rowIds().length).toBeGreaterThan(0));
  await settle();
}

/** A one-finger touch drag across the card by `dx`, let go at the end (SwipeCard acts at 96 px or more). `from`: the
 *  element under the finger when it comes down (a button inside the card, say); the card itself when left out. */
async function swipe(id: string, dx: number, from?: Element) {
  const target = from ?? swiperOf(id);
  const pointer = { pointerId: 7, button: 0, pointerType: 'touch' };
  await act(async () => {
    fireEvent.pointerDown(target, { ...pointer, clientX: 150, clientY: 100 });
    for (const part of [0.25, 0.5, 1]) fireEvent.pointerMove(target, { ...pointer, clientX: 150 + dx * part, clientY: 100 });
    fireEvent.pointerUp(target, { ...pointer, clientX: 150 + dx, clientY: 100 });
  });
  await settle();
}

/** A drag that has not let go yet: the finger is down and has moved `dx`. */
async function press(id: string, dx: number, pointerId = 7) {
  const target = swiperOf(id);
  const pointer = { pointerId, button: 0, pointerType: 'touch' };
  await act(async () => {
    fireEvent.pointerDown(target, { ...pointer, clientX: 150, clientY: 100 });
    for (const part of [0.25, 0.5, 1]) fireEvent.pointerMove(target, { ...pointer, clientX: 150 + dx * part, clientY: 100 });
  });
  return {
    letGo: async () => {
      await act(async () => { fireEvent.pointerUp(target, { ...pointer, clientX: 150 + dx, clientY: 100 }); });
      await settle();
    },
  };
}

/** The ground under a card while it moves: which side shows, if any. */
const sideOf = (id: string) => swiperOf(id).parentElement!.getAttribute('data-side');
const UNLOCK = 'Approve unlocks after you watch it';

describe('Today on a phone: swipe', () => {
  it('wraps every waiting card in a swipe card, with xl buttons', async () => {
    start();
    await loaded();
    const cards = [...needsYou().querySelectorAll<HTMLElement>('[data-row]:not([data-decided])')];
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      expect(card.closest('[data-swipe-card]'), card.getAttribute('data-row-id')!).not.toBeNull();
      for (const button of card.querySelectorAll('button[data-size]')) expect(button.getAttribute('data-size')).toBe('xl');
    }
    assertInkRules(document.body);
  });

  it('a right swipe on the price card opens its second ask and sends nothing; confirming sends one decision', async () => {
    const { decides } = start();
    await loaded();
    await swipe('q-price-sponsor', 120);
    const price = cardOf('q-price-sponsor');
    expect(price.textContent).toContain("This can't be undone. Approve?");
    expect(decides()).toHaveLength(0);
    // The click a browser sends right after a swipe is swallowed (SwipeCard); the owner's own tap comes later.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 550)); });
    await act(async () => { fireEvent.click(price.querySelector<HTMLElement>('[data-confirm]')!); });
    await waitFor(() => expect(cardOf('q-price-sponsor').hasAttribute('data-decided')).toBe(true));
    expect(decides()).toHaveLength(1);
    expect(decides()[0]![1]).toMatchObject({ id: 'q-price-sponsor', action: 'approve' });
  });

  it('a right swipe on the draft not watched yet decides nothing; the card says why once, in its own note', async () => {
    const { decides } = start();
    await loaded();
    await swipe('q-draft-ep14', 120);
    expect(decides()).toHaveLength(0);
    expect(locked(within(cardOf('q-draft-ep14')).getByRole('button', { name: 'Approve' }))).toBe(true);
    const root = swiperOf('q-draft-ep14').parentElement!.parentElement!;
    expect(root.textContent!.split(UNLOCK)).toHaveLength(2);
    expect(within(cardOf('q-draft-ep14')).getByText(UNLOCK)).toBeTruthy();
  });

  it('a new version that comes in while the finger is down is never decided by that swipe', async () => {
    const { engine, decides } = start();
    await loaded();
    const drag = await press('q-price-sponsor', 120);
    // The row changes under the finger: the engine says so and the card shows the new version.
    await act(async () => { engine.touch('q-price-sponsor'); });
    await settle();
    await waitFor(() => expect(cardOf('q-price-sponsor').textContent).toContain('Updated after the client replied.'));
    await drag.letGo();
    expect(cardOf('q-price-sponsor').textContent).not.toContain("This can't be undone");
    expect(decides()).toHaveLength(0);
    // A new swipe, on the version now on screen, goes the usual way.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 550)); });
    await swipe('q-price-sponsor', 120);
    expect(cardOf('q-price-sponsor').textContent).toContain("This can't be undone. Approve?");
    expect(decides()).toHaveLength(0);
  });

  it('a second swipe while the first decision is on its way sends nothing more', async () => {
    const { decides, release } = start({ hold: true });
    await loaded();
    await swipe('q-invoice-mehta', -120);
    expect(decides()).toHaveLength(1);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 550)); });
    await swipe('q-invoice-mehta', -120);
    await swipe('q-invoice-mehta', 120);
    expect(decides()).toHaveLength(1);
    await release();
    await waitFor(() => expect(cardOf('q-invoice-mehta').hasAttribute('data-decided')).toBe(true));
    expect(decides()).toHaveLength(1);
    expect(decides()[0]![1]).toMatchObject({ id: 'q-invoice-mehta', action: 'later' });
  });

  it('a second finger drops the swipe: nothing is pressed', async () => {
    const { decides } = start();
    await loaded();
    const first = await press('q-invoice-mehta', -60, 1);
    const second = await press('q-invoice-mehta', -120, 2);
    await second.letGo();
    await first.letGo();
    expect(decides()).toHaveLength(0);
    expect(cardOf('q-invoice-mehta').hasAttribute('data-decided')).toBe(false);
  });

  it('a swipe that starts on a button goes the swipe\'s way, and the click it leaves behind presses nothing', async () => {
    const { decides } = start();
    await loaded();
    const deny = within(cardOf('q-price-sponsor')).getByRole('button', { name: 'Deny' });
    await swipe('q-price-sponsor', 120, deny);
    expect(cardOf('q-price-sponsor').textContent).toContain("This can't be undone. Approve?");
    // The browser's click right after the swipe lands on the button the finger started on: swallowed.
    await act(async () => { fireEvent.click(within(cardOf('q-price-sponsor')).getByRole('button', { name: 'Not now' })); });
    expect(cardOf('q-price-sponsor').textContent).toContain("This can't be undone. Approve?");
    expect(decides()).toHaveLength(0);
  });

  it('a card whose button is not a decision does not swipe right: the locked business is never opened by a swipe', async () => {
    const { spy, decides } = start();
    await loaded();
    const more = screen.queryByRole('button', { name: /^Show \d+ more/ });
    if (more) await act(async () => { fireEvent.click(more); });
    const calls = spy.mock.calls.length;
    const drag = await press('q-locked-sitara', 120);
    expect(sideOf('q-locked-sitara')).toBeNull();
    await drag.letGo();
    const after = spy.mock.calls.slice(calls).map(([method]) => method);
    expect(after.filter((method) => method.startsWith('workspace.'))).toEqual([]);
    expect(decides()).toHaveLength(0);
    // Left still moves it on (it has no Later): to the end, with no engine call.
    await swipe('q-locked-sitara', -120);
    expect(rowIds().at(-1)).toBe('q-locked-sitara');
    expect(spy.mock.calls.slice(calls).map(([method]) => method).filter((method) => method.startsWith('workspace.') || method === 'venture.queue.decide')).toEqual([]);
  });

  it('"Connect your AI" does not swipe right (it would leave Today); left presses its Later', async () => {
    const { decides } = start();
    await loaded();
    const drag = await press('q-setup-ai', 120);
    expect(sideOf('q-setup-ai')).toBeNull();
    await drag.letGo();
    expect(window.location.hash).toBe('#/today');
    expect(decides()).toHaveLength(0);
    await swipe('q-setup-ai', -120);
    await waitFor(() => expect(decides()).toHaveLength(1));
    expect(decides()[0]![1]).toMatchObject({ id: 'q-setup-ai', action: 'later' });
  });

  it('the ground under a card says the words of the version on screen, read as it moves', async () => {
    start();
    await loaded();
    const drag = await press('q-invoice-mehta', 120);
    const under = swiperOf('q-invoice-mehta').parentElement!.querySelector('[data-under="right"]')!;
    expect(under.textContent).toBe('Issueasks once more');
    await drag.letGo();
  });

  it('a short drag snaps back and does nothing', async () => {
    const { decides } = start();
    await loaded();
    await swipe('q-price-sponsor', 60);
    expect(cardOf('q-price-sponsor').textContent).not.toContain("This can't be undone");
    expect(decides()).toHaveLength(0);
  });

  it('a left swipe on a card with Later decides later', async () => {
    const { decides } = start();
    await loaded();
    await swipe('q-invoice-mehta', -120);
    await waitFor(() => expect(decides()).toHaveLength(1));
    expect(decides()[0]![1]).toMatchObject({ id: 'q-invoice-mehta', action: 'later' });
  });

  it('a left swipe on a card with no Later moves it to the end for this session, with no engine call', async () => {
    const { decides, spy } = start();
    await loaded();
    // Every row shows, so its new place can be seen.
    const more = screen.queryByRole('button', { name: /^Show \d+ more/ });
    if (more) await act(async () => { fireEvent.click(more); });
    const before = rowIds();
    expect(before.indexOf('q-price-sponsor')).toBeLessThan(before.length - 1);
    const calls = spy.mock.calls.length;
    await swipe('q-price-sponsor', -120);
    const after = rowIds();
    expect(after[after.length - 1]).toBe('q-price-sponsor');
    expect([...after].sort()).toEqual([...before].sort());
    expect(decides()).toHaveLength(0);
    expect(spy.mock.calls.slice(calls).filter(([method]) => method !== 'venture.queue.list' && method !== 'venture.runs.list' && method !== 'venture.runs.get')).toEqual([]);
    // It stays there when the page draws again (another place and back).
    window.location.hash = '#/team';
    await hashChanged();
    window.location.hash = '#/today';
    await hashChanged();
    await loaded();
    const more2 = screen.queryByRole('button', { name: /^Show \d+ more/ });
    if (more2) await act(async () => { fireEvent.click(more2); });
    const again = rowIds();
    expect(again[again.length - 1]).toBe('q-price-sponsor');
  });

  it('a wide window has no swipe cards and no tip, and its cards keep their own button sizes', async () => {
    start({ narrow: false });
    await loaded();
    expect(needsYou().querySelector('[data-swipe-card]')).toBeNull();
    expect(screen.queryByText('Swipe right to approve, left for later. Big steps still ask twice.')).toBeNull();
    expect(within(cardOf('q-price-sponsor')).getByRole('button', { name: 'Approve' }).getAttribute('data-size')).toBe('lg');
  });
});

describe('Today on a phone: the tip', () => {
  const TIP = 'Swipe right to approve, left for later. Big steps still ask twice.';

  it('says how swiping works under the filter chips; hiding it lasts for the session and stores nothing', async () => {
    const stored = vi.spyOn(Storage.prototype, 'setItem');
    start();
    await loaded();
    const tip = screen.getByText(TIP).closest('[data-tip]') as HTMLElement;
    expect(tip).not.toBeNull();
    const chips = within(needsYou()).getByRole('group', { name: 'Show' });
    expect(chips.compareDocumentPosition(tip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tip.compareDocumentPosition(cardOf(rowIds()[0]!)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await act(async () => { fireEvent.click(within(tip).getByRole('button', { name: 'Hide this tip' })); });
    expect(screen.queryByText(TIP)).toBeNull();
    // Focus does not fall to the page: it goes to the first card.
    expect(document.activeElement?.getAttribute('data-row-id')).toBe(rowIds()[0]);
    window.location.hash = '#/team';
    await hashChanged();
    window.location.hash = '#/today';
    await hashChanged();
    await loaded();
    expect(screen.queryByText(TIP)).toBeNull();
    expect(stored).not.toHaveBeenCalled();
  });

  it('is not shown when nothing needs you', async () => {
    stubWidth(true);
    window.location.hash = '#/today';
    render(<App client={createFakeClient(new FakeEngine({ queue: [] }))} language="en" />);
    await screen.findByText('Nothing needs you.');
    expect(screen.queryByText(TIP)).toBeNull();
  });

  it('reads in Hindi with no key showing', async () => {
    stubWidth(true);
    window.location.hash = '#/today';
    render(<App client={createFakeClient(new FakeEngine())} language="hi" />);
    const tip = await waitFor(() => {
      const found = document.querySelector('[data-tip]');
      if (!found) throw new Error('no tip');
      return found as HTMLElement;
    });
    expect(tip.textContent).not.toMatch(/today\.|phone\./);
    expect(within(tip).getByRole('button').getAttribute('aria-label')).not.toMatch(/^today\./);
  });
});

describe('Today on a phone: rows that scroll and the goal card', () => {
  it('the stories and the filter chips are rows that scroll sideways', async () => {
    start();
    await loaded();
    expect(screen.getByRole('list', { name: 'Your agents' }).hasAttribute('data-scroll')).toBe(true);
    expect(within(needsYou()).getByRole('group', { name: 'Show' }).hasAttribute('data-scroll')).toBe(true);
  });

  it('on a wide window neither scrolls', async () => {
    start({ narrow: false });
    await loaded();
    expect(screen.getByRole('list', { name: 'Your agents' }).hasAttribute('data-scroll')).toBe(false);
    expect(within(needsYou()).getByRole('group', { name: 'Show' }).hasAttribute('data-scroll')).toBe(false);
  });

  it("the goal card's phone rules: D's 18 px padding, its foot one figure per line under the bar, a 44 px edit button", () => {
    const css = readFileSync(join(import.meta.dirname, '../../src/places/today/GoalCard.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const phone = css.slice(css.indexOf('@media (max-width: 759px)'));
    expect(phone).toMatch(/\.goal\s*\{[^}]*padding:\s*var\(--pad-panel\)/);
    expect(phone).toMatch(/\.foot\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
    expect(phone).toMatch(/\.edit\s*\{[^}]*width:\s*var\(--target\);[^}]*height:\s*var\(--target\)/);
    // The month pill stays on the heading's line: "before tax" takes the line under it.
    expect(phone).toMatch(/\.sub\s*\{[^}]*order:\s*1;[^}]*flex-basis:\s*100%/);
  });

  it('a tile head with a link keeps the link on the title\'s line on a phone; its counts take the line under it', () => {
    const css = readFileSync(join(import.meta.dirname, '../../src/parts/Tile.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const phone = css.slice(css.indexOf('@media (max-width: 759px)'));
    expect(phone).toMatch(/\.head:has\(> \.more\) \.meta\s*\{[^}]*order:\s*1;[^}]*flex-basis:\s*100%/);
  });

  it('the live tiles under the stories scroll sideways on a phone too', () => {
    const css = readFileSync(join(import.meta.dirname, '../../src/places/today/TeamAtWork.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const phone = css.slice(css.indexOf('@media (max-width: 759px)'));
    expect(phone).toMatch(/\.live\s*\{[^}]*grid-auto-flow:\s*column[^}]*overflow-x:\s*auto/);
  });
});
