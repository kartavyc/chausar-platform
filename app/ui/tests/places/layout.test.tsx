import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { NARROW } from '../../src/shell/useNarrow';
import { assertInkRules } from '../helpers/ink-rules';

// UI as data (wave 6, package 6H3, D40): Today and Money draw their blocks from the owner's layout. The owner arranges a
// page from its Arrange sheet; the owner's AI changes it through Chausar's MCP tools (here the fake's stand-in), and the
// page says so with Undo and Keep. Approvals, questions, stops and money totals always show. The AI can offer a place;
// the app shows Open and Not now and never opens it by itself. A changed layout never shows more words at rest than the library's own.

const NOW = '2026-10-23T10:00:00.000Z';

async function start(hash: string) {
  window.location.hash = hash;
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: query === NARROW ? false : false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }) as unknown as MediaQueryList);
  const engine = new FakeEngine({ now: () => NOW });
  const fake = createFakeClient(engine);
  const spy = vi.spyOn(fake, 'request');
  const view = render(<App client={fake} language="en" />);
  await screen.findByRole('heading', { level: 1 });
  await settle();
  return { engine, spy, view };
}

const settle = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const calls = (spy: { mock: { calls: unknown[][] } }, method: string) => spy.mock.calls.filter(([m]) => m === method).map(([, p]) => p);
const main = () => screen.getByRole('main');
/** The blocks of the page in the order they are drawn. */
const blocks = () => [...main().querySelectorAll('[data-block]')].map((node) => node.getAttribute('data-block'));

/** The words a reader sees (tests/budgets.test.tsx's rule): not screen-reader-only text, hidden nodes or closed folds. */
function words(root: Element): number {
  let count = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || parent.closest('.sr-only, [hidden], script, style, title')) continue;
    const option = parent.closest('option');
    if (option && !option.selected) continue;
    const summary = parent.closest('summary');
    let closed = false;
    for (let fold = parent.closest('details'); fold; fold = fold.parentElement?.closest('details') ?? null) {
      if (!fold.open && !(summary !== null && summary.parentElement === fold)) closed = true;
    }
    if (closed) continue;
    count += (node.textContent ?? '').split(/\s+/).filter(Boolean).length;
  }
  return count;
}

describe('Today and Money draw their blocks from the layout', () => {
  it('Today at rest draws every block in the library order', async () => {
    await start('#/today');
    expect(blocks()).toEqual(['greeting', 'notices', 'goal', 'team', 'needs', 'working', 'earlier', 'ideas', 'apps']);
  });

  it('a change by the AI shows at once, says it was the AI, and Undo puts the page back', async () => {
    const { engine, spy } = await start('#/today');
    await act(async () => { engine.layoutDesk.ai({ place: 'today', change: { op: 'hide', block: 'ideas' } }); });
    await act(async () => { engine.layoutDesk.ai({ place: 'today', change: { op: 'move', block: 'earlier', to: 0 } }); });
    await settle();
    await waitFor(() => expect(blocks()).toEqual(['greeting', 'notices', 'goal', 'earlier', 'needs', 'team', 'working', 'apps']));
    const notice = screen.getByRole('status', { name: 'Layout change' });
    expect(notice.textContent).toContain('Your AI hid Ideas.');
    expect(notice.textContent).toContain('Your AI moved Earlier.');
    await act(async () => { fireEvent.click(within(notice).getByRole('button', { name: 'Undo' })); });
    await settle();
    expect(calls(spy, 'venture.layout.change')).toEqual([{ place: 'today', change: { op: 'restore', to: 'default' } }]);
    await waitFor(() => expect(blocks()).toEqual(['greeting', 'notices', 'goal', 'team', 'needs', 'working', 'earlier', 'ideas', 'apps']));
    expect(screen.queryByRole('status', { name: 'Layout change' })).toBeNull();
  });

  it('Keep keeps what the AI did, and a renamed block shows its new name', async () => {
    const { engine, spy } = await start('#/today');
    await act(async () => { engine.layoutDesk.ai({ place: 'today', change: { op: 'rename', block: 'team', name: 'My team' } }); });
    await settle();
    expect(within(main().querySelector('[data-block="team"]')!).getByRole('heading', { level: 2 }).textContent).toBe('My team');
    const notice = screen.getByRole('status', { name: 'Layout change' });
    await act(async () => { fireEvent.click(within(notice).getByRole('button', { name: 'Keep' })); });
    await settle();
    expect(calls(spy, 'venture.layout.change')).toEqual([{ place: 'today', change: { op: 'keep' } }]);
    expect(screen.queryByRole('status', { name: 'Layout change' })).toBeNull();
    expect(within(main().querySelector('[data-block="team"]')!).getByRole('heading', { level: 2 }).textContent).toBe('My team');
  });

  it('Money: the AI can hide a fold, never the money totals', async () => {
    const { engine } = await start('#/money');
    expect(blocks()).toEqual(['glance', 'owed', 'flow', 'weeks']);
    await act(async () => { engine.layoutDesk.ai({ place: 'money', change: { op: 'hide', block: 'flow' } }); });
    await settle();
    await waitFor(() => expect(blocks()).toEqual(['glance', 'owed', 'weeks']));
    expect(() => engine.layoutDesk.ai({ place: 'money', change: { op: 'hide', block: 'glance' } })).toThrow('Money totals always show.');
    expect(screen.getByRole('status', { name: 'Layout change' }).textContent).toContain('Your AI hid In and out.');
  });

  it('a changed layout never shows more words at rest than the library\'s own', async () => {
    const { engine } = await start('#/today');
    const before = words(main());
    await act(async () => {
      engine.layoutDesk.ai({ place: 'today', change: { op: 'rename', block: 'team', name: 'Helpers on duty' } });
      engine.layoutDesk.ai({ place: 'today', change: { op: 'rename', block: 'working', name: 'Running jobs' } });
      engine.layoutDesk.ai({ place: 'today', change: { op: 'move', block: 'ideas', to: 0 } });
    });
    // Keep is the owner's alone: the AI cannot keep its own changes; the owner presses Keep in the app.
    expect(() => engine.layoutDesk.ai({ place: 'today', change: { op: 'keep' } })).toThrow("Only the owner can keep the AI's changes.");
    await settle();
    await act(async () => { fireEvent.click(within(screen.getByRole('status', { name: 'Layout change' })).getByRole('button', { name: 'Keep' })); });
    await settle();
    expect(blocks()[3]).toBe('ideas');
    expect(words(main())).toBeLessThanOrEqual(before);
  });
});

describe('the Arrange sheet', () => {
  it('lists the blocks; locked ones say why; Hide answers with the engine\'s line and Undo', async () => {
    const { spy, view } = await start('#/today');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Arrange Today' })); });
    const sheet = await screen.findByRole('complementary', { name: 'Arrange Today' });
    // B4 task 13: what always shows is one line, not a row of its own.
    expect(within(sheet).queryByRole('listitem', { name: 'Needs you' })).toBeNull();
    expect(within(sheet).getByText(/^Always shows: .*Needs you/)).toBeTruthy();
    const ideas = within(sheet).getByRole('listitem', { name: 'Ideas' });
    await act(async () => { fireEvent.click(within(ideas).getByRole('button', { name: 'Hide Ideas' })); });
    await settle();
    expect(calls(spy, 'venture.layout.change')).toEqual([{ place: 'today', change: { op: 'hide', block: 'ideas' } }]);
    const line = within(sheet).getByRole('status', { name: 'Layout change' });
    expect(line.textContent).toContain('You hid Ideas.');
    await waitFor(() => expect(blocks()).not.toContain('ideas'));
    await act(async () => { fireEvent.click(within(line).getByRole('button', { name: 'Undo' })); });
    await settle();
    await waitFor(() => expect(blocks()).toContain('ideas'));
    // Move and rename from the sheet.
    const earlier = within(sheet).getByRole('listitem', { name: 'Earlier' });
    await act(async () => { fireEvent.click(within(earlier).getByRole('button', { name: 'Move Earlier up' })); });
    await settle();
    expect(blocks().indexOf('earlier')).toBeLessThan(blocks().indexOf('working'));
    const team = within(sheet).getByRole('listitem', { name: 'Team at work' });
    // C4 task 6: the name is text with a pencil; the field opens for this part only.
    await act(async () => { fireEvent.click(within(team).getByRole('button', { name: 'Rename Team at work' })); });
    const field = within(team).getByRole('textbox', { name: 'Name for Team at work' });
    fireEvent.change(field, { target: { value: 'Profit' } });
    await act(async () => { fireEvent.click(within(team).getByRole('button', { name: 'Rename' })); });
    await settle();
    expect(within(sheet).getByRole('alert').textContent).toContain('cannot sound like money');
    assertInkRules(view.container);
  });

  it('C4 task 6: names are text with a pencil; Enter renames, Escape puts the name back', async () => {
    const { spy } = await start('#/today');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Arrange Today' })); });
    const sheet = await screen.findByRole('complementary', { name: 'Arrange Today' });
    // At rest the only box is the saved view's name.
    expect(within(sheet).getAllByRole('textbox').map((box) => box.getAttribute('aria-label') ?? (box as HTMLInputElement).labels?.[0]?.textContent)).toEqual(['View name']);
    const team = within(sheet).getByRole('listitem', { name: 'Team at work' });
    await act(async () => { fireEvent.click(within(team).getByRole('button', { name: 'Rename Team at work' })); });
    const field = within(team).getByRole('textbox', { name: 'Name for Team at work' });
    fireEvent.change(field, { target: { value: 'Helpers' } });
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(within(team).queryByRole('textbox')).toBeNull();
    expect(calls(spy, 'venture.layout.change')).toEqual([]);
    await act(async () => { fireEvent.click(within(team).getByRole('button', { name: 'Rename Team at work' })); });
    const again = within(team).getByRole('textbox', { name: 'Name for Team at work' });
    expect((again as HTMLInputElement).value).toBe('Team at work');
    fireEvent.change(again, { target: { value: 'Helpers' } });
    await act(async () => { fireEvent.keyDown(again, { key: 'Enter' }); });
    await settle();
    expect(calls(spy, 'venture.layout.change')).toEqual([{ place: 'today', change: { op: 'rename', block: 'team', name: 'Helpers' } }]);
  });

  it('saves a view and switches to it', async () => {
    const { spy } = await start('#/today');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Arrange Today' })); });
    const sheet = await screen.findByRole('complementary', { name: 'Arrange Today' });
    await act(async () => { fireEvent.click(within(within(sheet).getByRole('listitem', { name: 'Team at work' })).getByRole('button', { name: 'Hide Team at work' })); });
    await settle();
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'View name' }), { target: { value: 'Quiet' } });
    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Save view' })); });
    await settle();
    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Reset' })); });
    await settle();
    expect(blocks()).toContain('team');
    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Use Quiet' })); });
    await settle();
    expect(calls(spy, 'venture.layout.change').at(-1)).toEqual({ place: 'today', change: { op: 'use-view', view: 'v1' } });
    await waitFor(() => expect(blocks()).not.toContain('team'));
  });
});

describe('the AI offers a place (founder, 2 November 2026: offer a link, never open)', () => {
  it('shows an Open button and stays on the page; only the owner\'s click opens it', async () => {
    const { engine } = await start('#/today');
    await act(async () => { engine.layoutDesk.go('money', 'invoices'); });
    await settle();
    const offer = await screen.findByRole('status', { name: 'Your AI suggests a page' });
    expect(offer.textContent).toContain('Your AI suggests Money.');
    await settle();
    expect(window.location.hash).toBe('#/today');
    await act(async () => { fireEvent.click(within(offer).getByRole('button', { name: 'Open Money' })); });
    await settle();
    expect(window.location.hash).toBe('#/money/invoices');
    expect(screen.queryByRole('status', { name: 'Your AI suggests a page' })).toBeNull();
  });

  it('Not now puts the offer away without opening anything, and an old request is never offered again', async () => {
    const { engine, view } = await start('#/today');
    await act(async () => { engine.layoutDesk.go('clients'); });
    await settle();
    const offer = await screen.findByRole('status', { name: 'Your AI suggests a page' });
    await act(async () => { fireEvent.click(within(offer).getByRole('button', { name: 'Not now' })); });
    await settle();
    expect(screen.queryByRole('status', { name: 'Your AI suggests a page' })).toBeNull();
    expect(window.location.hash).toBe('#/today');
    view.unmount();
    render(<App client={createFakeClient(engine)} language="en" />);
    await screen.findByRole('heading', { level: 1 });
    await settle();
    expect(screen.queryByRole('status', { name: 'Your AI suggests a page' })).toBeNull();
    expect(window.location.hash).toBe('#/today');
  });
});
