import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../src/shell/App';
import { ClockProvider } from '../src/shell/clock';
import { NARROW } from '../src/shell/useNarrow';
import { FakeEngine, createFakeClient } from '../src/engine/fake';
import type { QueueRow } from '../src/engine/types';
import { ApprovalRow } from '../src/parts/ApprovalRow';
import { Figure } from '../src/parts/Figure';
import { cssOf, rule } from './helpers/css';
import { assertInkRules } from './helpers/ink-rules';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * What the real-browser walk (scripts/ui-shots/walk.mjs, w3 3I) found that jsdom could not, each held by a test here
 * once fixed. jsdom has no layout, so the CSS ones read the module's own text.
 */

function phone() {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: query === NARROW, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }) as unknown as MediaQueryList);
}

describe('found by the walk', () => {
  it('on a phone the live tiles scroll sideways, so their row takes focus and is named, even when no tile has a button', async () => {
    // axe in Chrome, Today with nothing waiting at 390: "scrollable-region-focusable" (serious). The waiting tile's
    // "Answer below" is the only button a live tile can hold, and it is gone when no card answers the run.
    phone();
    window.location.hash = '#/today';
    render(<ClockProvider now={() => new Date(2026, 9, 23, 19, 5)}><App client={createFakeClient(new FakeEngine({ queue: [] }))} language="en" /></ClockProvider>);
    const tile = await screen.findByRole('article', { name: 'Editor, working' });
    const row = tile.parentElement!;
    await waitFor(() => expect(row.querySelectorAll('article').length).toBeGreaterThan(1));
    expect(row.querySelector('button')).toBeNull();
    expect(row.getAttribute('tabindex')).toBe('0');
    expect(row.getAttribute('role')).toBe('group');
    expect(screen.getByRole('group', { name: 'Team at work' })).toBe(row);
  });

  it('on a wide screen the live tiles wrap, so their row is not a stop for the Tab key', async () => {
    window.location.hash = '#/today';
    render(<App client={createFakeClient(new FakeEngine({ queue: [] }))} language="en" />);
    const row = (await screen.findByRole('article', { name: 'Editor, working' })).parentElement!;
    expect(row.hasAttribute('tabindex')).toBe(false);
    expect(row.hasAttribute('role')).toBe(false);
  });

  it("the invoices table's scroller is positioned, so the screen-reader words inside it scroll with it", () => {
    // Chrome, Money > Invoices with an invoice sheet open at 1280: the table scrolls inside its tile, but its
    // visually hidden words (absolutely placed) took the page as their box and let the whole place scroll sideways.
    expect(rule('../places/money/Money.module.css', '.tableTile')).toMatch(/position:\s*relative/);
  });

  it('the money table really sits in that scroller', () => {
    const source = readFileSync(join(import.meta.dirname, '../src/places/money/Invoices.tsx'), 'utf8');
    expect(source).toMatch(/<Tile pad="none" className=\{s\.tableTile\}>\s*<table/);
  });
});

/** The body of the first `@container <name> (...)` block in a stylesheet's text. */
function containerBlock(css: string, name: string): string {
  const start = css.indexOf(`@container ${name}`);
  if (start < 0) throw new Error(`no @container ${name}`);
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}' && (depth -= 1) === 0) return css.slice(css.indexOf('{', start) + 1, i);
  }
  throw new Error(`@container ${name} is not closed`);
}

const settle = async () => { for (let i = 0; i < 4; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };

describe('listed by the walk, fixed before wave 3 ships (the integrator, 26 Oct)', () => {
  it('1. on a phone a sheet that covers the screen is a modal dialog named by its title, around the sheet itself', async () => {
    phone();
    window.location.hash = '#/team?sheet=agent:editor';
    render(<App client={createFakeClient(new FakeEngine())} language="en" />);
    const sheet = await screen.findByRole('complementary', { name: 'Editor' });
    const dialog = await screen.findByRole('dialog', { name: 'Editor' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.contains(sheet)).toBe(true);
    expect(dialog.hasAttribute('data-cover')).toBe(true);
  });

  it('1. while the sheet covers the phone, the place, the top bar, the tabs and the skip link are inert; closing it frees them and focus goes back to the opener', async () => {
    phone();
    window.location.hash = '#/team';
    const { container } = render(<App client={createFakeClient(new FakeEngine())} language="en" />);
    const opener = await screen.findByRole('button', { name: 'Editor' });
    opener.focus();
    await act(async () => { fireEvent.click(opener); window.dispatchEvent(new HashChangeEvent('hashchange')); });
    await screen.findByRole('dialog', { name: 'Editor' });
    const behind = () => [
      container.querySelector('main'),
      container.querySelector('[data-phone] > [class*="top"]'),
      container.querySelector('[data-phone] > [class*="tabs"]'),
      screen.getByText('Skip to the page', { exact: false }).closest('button'),
    ];
    for (const el of behind()) { expect(el).not.toBeNull(); expect(el!.hasAttribute('inert')).toBe(true); }
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Close Editor' })); window.dispatchEvent(new HashChangeEvent('hashchange')); });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    for (const el of behind()) expect(el!.hasAttribute('inert')).toBe(false);
    await waitFor(() => expect(document.activeElement?.textContent?.trim()).toBe('Editor'));
  });

  it('1. beside the page on a wide screen the sheet is not a dialog: the page stays usable', async () => {
    window.location.hash = '#/team?sheet=agent:editor';
    render(<App client={createFakeClient(new FakeEngine())} language="en" />);
    await screen.findByRole('complementary', { name: 'Editor' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('2. the business menu is a labelled, non-modal dialog the button says it opens, so it needs no landmark', async () => {
    window.location.hash = '#/today';
    render(<App client={createFakeClient(new FakeEngine())} language="en" />);
    const button = await screen.findByRole('button', { name: /Switch business/ });
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    await act(async () => { fireEvent.click(button); });
    const menu = await screen.findByRole('dialog', { name: 'Business menu for Lumen Studio' });
    expect(menu.hasAttribute('aria-modal')).toBe(false);
    expect(button.getAttribute('aria-controls')).toBe(menu.id);
  });

  it('3. a lock note names a one-word action as D does, and leaves a longer one to its button, so a card stays within 12 words', () => {
    const row = (label: string, view: 'watch' | 'read' | undefined): QueueRow => ({
      id: `q-${label}`, businessId: 'lumen', businessName: 'Lumen Studio', agent: 'Bookkeeper', kind: 'signoff', createdAt: '2026-10-21T08:40:00.000Z',
      digest: 'd', title: 'GST working for September', viewRef: { kind: 'file', id: 'f' },
      actions: [...(view ? [{ id: view, label: view === 'watch' ? 'Watch' : 'Read', primary: false }] : []), { id: 'approve', label, primary: true, requiresView: true }],
    });
    const { unmount } = render(<ApprovalRow layout="card" row={row('Approve', 'watch')} onDecide={vi.fn()} />);
    expect(document.querySelector('[data-note]')!.textContent).toBe('Approve unlocks after you watch it');
    unmount();
    const ca = render(<ApprovalRow layout="card" row={row('Send to CA', 'read')} onDecide={vi.fn()} />);
    expect(document.querySelector('[data-note]')!.textContent).toBe('Unlocks after you read it');
    expect(screen.getByRole('button', { name: 'Send to CA' }).getAttribute('title')).toBe('Unlocks after you read it');
    ca.unmount();
    render(<ApprovalRow layout="compact" row={row('Approve and post', undefined)} onDecide={vi.fn()} />);
    expect(document.querySelector('[data-note]')!.textContent).toBe('Unlocks after you open it');
  });

  it('4. the invoices table turns into stacked rows when its tile is narrow (a sheet beside it at 1280), so Action stays in view', () => {
    expect(rule('../places/money/Money.module.css', '.tableTile')).toMatch(/container-type:\s*inline-size/);
    expect(rule('../places/money/Money.module.css', '.tableTile')).toMatch(/container-name:\s*invoices/);
    const narrow = containerBlock(cssOf('../places/money/Money.module.css'), 'invoices');
    expect(narrow).toMatch(/\.table thead\s*\{[^}]*position:\s*absolute/);
    expect(narrow).toMatch(/\.tr\s*\{[^}]*grid-template-areas/);
    expect(narrow).toMatch(/\.cellAction\s*\{\s*grid-area:\s*action/);
  });

  it('5. cards in Needs you take their own height, so a card with no preview leaves no blank space', () => {
    expect(rule('../places/today/NeedsYou.module.css', '.cards')).toMatch(/align-items:\s*start/);
  });

  it('6. words that hold a second amount are never split off: the whole value stays the one proved figure', () => {
    const { container } = render(<Figure value="₹60.10, plus ₹18.00 held" receiptId="R-0431" />);
    expect(container.querySelector('[data-figure-words]')).toBeNull();
    expect(container.querySelector('[data-ui-number]')!.textContent).toBe('₹60.10, plus ₹18.00 held');
    assertInkRules(container);
  });

  it("6. the Ink rules fail an amount hidden in a figure's words", () => {
    const { container } = render(
      <span data-figure=""><span data-ui-number="">₹60.10</span><span data-figure-words="">, plus ₹18.00 held</span><button type="button" data-receipt="R-0431">R-0431</button></span>,
    );
    expect(() => assertInkRules(container)).toThrow(/words.*plus ₹18\.00 held/);
  });

  it('6. a figure the engine wrote with words after it keeps the amount in mono and sets the words in the body face', () => {
    const { container } = render(<Figure value="₹60.10, includes estimates" receiptId="R-0431" />);
    const number = container.querySelector('[data-ui-number]')!;
    expect(number.textContent).toBe('₹60.10');
    expect(number.classList.contains('mono')).toBe(true);
    const words = container.querySelector('[data-figure-words]')!;
    expect(words.textContent).toBe(', includes estimates');
    expect(words.classList.contains('mono')).toBe(false);
    expect(container.querySelector('[data-figure]')!.textContent).toContain('₹60.10, includes estimates');
    assertInkRules(container);
    const plain = render(<Figure value="₹18,880.00" receiptId="R-0419" />);
    expect(plain.container.querySelector('[data-ui-number]')!.textContent).toBe('₹18,880.00');
    expect(plain.container.querySelector('[data-figure-words]')).toBeNull();
    expect(cssOf('Figure.module.css')).toMatch(/\.words\s*\{[^}]*font-family:\s*var\(--font\)/);
  });

  it('6. on Team the AI spend tile shows the amount as the figure and the engine\'s words beside it', async () => {
    window.location.hash = '#/team';
    render(<App client={createFakeClient(new FakeEngine())} language="en" />);
    const glance = await screen.findByRole('region', { name: 'Team at a glance' });
    await waitFor(() => expect(glance.querySelector('[data-figure] [data-ui-number]')?.textContent).toBe('₹60.10'));
    expect(glance.querySelector('[data-figure] [data-figure-words]')?.textContent).toBe(', includes estimates');
  });

  it('7. an order says it is priced on its receipt, never a bare "Price" with no amount', async () => {
    window.location.hash = '#/work';
    render(<App client={createFakeClient(new FakeEngine())} language="en" />);
    const order = (await screen.findByRole('heading', { name: 'Two mentions in episode 14' })).closest('li')!;
    await settle();
    const meta = within(order).getByText('Priced on receipt').closest('p')!;
    expect(within(meta).getByRole('button', { name: 'Receipt R-0415' })).toBeTruthy();
    expect(within(order).queryByText(/^Price$/)).toBeNull();
  });

  it("8. Today's count badge sits on the tab icon's corner, so the 22 px icon stays readable", () => {
    const badge = rule('BottomTabs.module.css', '.badge');
    expect(badge).toMatch(/left:\s*50%/);
    // The icon reaches 11 px right of the middle: a badge that starts 8 px or more right of it covers at most its corner.
    expect(badge).toMatch(/margin-left:\s*var\(--sp-(2|3)\)/);
  });
});
