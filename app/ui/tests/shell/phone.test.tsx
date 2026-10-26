// The phone layout (w3 plan, package 3H1; D-Phone-Today and D-Phone-Team): under 760 px the rail gives way to a top
// bar (the mark and the business) and bottom tabs (Today, Team, Work, Clients, More); More opens a sheet with the
// rest; every sheet covers the screen; Team's department toggle is a row of filter chips. Plus the web app's
// manifest, its icons and the theme colours. jsdom has no media queries, so each phone test stubs matchMedia.
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { App } from '../../src/shell/App';
import { NARROW, useNarrow } from '../../src/shell/useNarrow';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { AgentView, DepartmentView, EngineClient, TeamListView } from '../../src/engine/types';

type Listener = (event: { matches: boolean }) => void;

/** matchMedia as a phone (or not) answers it: the narrow query matches; a change can be sent to its listeners. */
function stubWidth(narrow: boolean) {
  const state = { narrow, listeners: new Set<Listener>() };
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    get matches() { return query === NARROW && state.narrow; },
    media: query, onchange: null,
    addEventListener: (_type: string, listener: Listener) => { if (query === NARROW) state.listeners.add(listener); },
    removeEventListener: (_type: string, listener: Listener) => { state.listeners.delete(listener); },
    addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }) as unknown as MediaQueryList);
  return {
    resize: (to: boolean) => act(() => { state.narrow = to; for (const listener of [...state.listeners]) listener({ matches: to }); }),
  };
}

function start(hash = '#/today', client?: EngineClient) {
  window.location.hash = hash;
  return render(<App client={client ?? createFakeClient(new FakeEngine())} language="en" />);
}

const hashChanged = async () => { await act(async () => { window.dispatchEvent(new HashChangeEvent('hashchange')); }); };
const go = async (hash: string) => { await act(async () => { window.location.hash = hash; }); await hashChanged(); };
const settle = async () => { for (let i = 0; i < 3; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const tabs = () => screen.getByRole('navigation', { name: 'Places' });
const appRoot = (container: HTMLElement) => container.firstElementChild as HTMLElement;
/** The phone's top bar (a header outside main; every card and sheet head is a header too). */
const topBar = () => document.querySelector<HTMLElement>('header[data-top-bar]');

describe('useNarrow', () => {
  function Probe() {
    return <p>{useNarrow() ? 'phone' : 'wide'}</p>;
  }

  it('asks for the 759 px query and follows the window as it changes', () => {
    expect(NARROW).toBe('(max-width: 759px)');
    const width = stubWidth(false);
    render(<Probe />);
    expect(screen.getByText('wide')).toBeTruthy();
    width.resize(true);
    expect(screen.getByText('phone')).toBeTruthy();
    width.resize(false);
    expect(screen.getByText('wide')).toBeTruthy();
  });
});

describe('the phone frame', () => {
  // On Team, the lighter page: the first test of the file also pays for warming jsdom up.
  it('has no rail: a top bar with the mark linking to Today and the business button, and no bell or account button', async () => {
    stubWidth(true);
    const { container } = start('#/team');
    const bar = topBar()!;
    expect(bar.closest('main')).toBeNull();
    const home = within(bar).getByRole('link', { name: 'Chausar, Today' });
    expect(home.getAttribute('href')).toBe('#/today');
    expect(home.textContent).toBe('');
    expect(home.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    const business = await within(bar).findByRole('button', { name: /Lumen Studio/ });
    expect(business.getAttribute('aria-expanded')).toBe('false');
    // The phone's business button is the name alone (D's `.bizb`), never the kind line under it.
    await settle();
    expect(business.textContent).not.toContain('YouTube channel');
    expect(screen.queryByRole('button', { name: /Notifications/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /account/i })).toBeNull();
    // One navigation named Places: the bottom tabs, after the page.
    expect(screen.getAllByRole('navigation', { name: 'Places' })).toHaveLength(1);
    expect(within(tabs()).queryByRole('link', { name: 'Money' })).toBeNull();
    expect(appRoot(container).hasAttribute('data-phone')).toBe(true);
    const main = screen.getByRole('main');
    expect(main.compareDocumentPosition(tabs()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }, 15_000);

  it('the bottom tabs are Today with its count, Team, Work, Clients and More', async () => {
    stubWidth(true);
    start();
    const links = within(tabs()).getAllByRole('link');
    expect(links.map((a) => a.textContent?.replace(/\d+, \d+ needs? you$/, ''))).toEqual(['Today', 'Team', 'Work', 'Clients', 'More']);
    expect(links.slice(0, 4).map((a) => a.getAttribute('href'))).toEqual(['#/today', '#/team', '#/work', '#/clients']);
    const today = links[0]!;
    await waitFor(() => expect(today.querySelector('[data-badge]')?.textContent).toBe('12'));
    expect(today.querySelector('[data-badge]')?.getAttribute('aria-hidden')).toBe('true');
    expect(within(today).getByText(', 12 need you').className).toBe('sr-only');
    expect(today.getAttribute('aria-current')).toBe('page');
  });

  it.each([
    ['#/team', 'Team'], ['#/work?state=failed', 'Work'], ['#/clients/pipeline', 'Clients'],
    ['#/money', 'More'], ['#/money/invoices', 'More'], ['#/connections', 'More'], ['#/business/plan', 'More'], ['#/onboarding', 'More'],
  ])('at %s the current tab is %s', async (hash, tab) => {
    stubWidth(true);
    start(hash);
    const current = within(tabs()).getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page');
    expect(current.map((a) => a.textContent)).toEqual([tab]);
    expect(current[0]!.hasAttribute('data-current')).toBe(true);
  });

  it('More opens a sheet "More" with Money, Connections, Business and Start a new business; a link closes it', async () => {
    stubWidth(true);
    start('#/team');
    const more = within(tabs()).getByRole('link', { name: 'More' });
    expect(more.getAttribute('href')).toBe('#/team?sheet=more%3Aplaces');
    await act(async () => { more.focus(); fireEvent.click(more); });
    await hashChanged();
    expect(window.location.hash).toBe('#/team?sheet=more%3Aplaces');
    const sheet = await screen.findByRole('complementary', { name: 'More' });
    const list = within(sheet).getByRole('navigation', { name: 'More places' });
    const links = within(list).getAllByRole('link');
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Money', '#/money'], ['Connections', '#/connections'], ['Business', '#/business/plan'], ['Start a new business', '#/onboarding'],
    ]);
    for (const link of links) expect(link.querySelectorAll('svg[aria-hidden="true"]').length).toBeGreaterThan(0);
    await act(async () => { fireEvent.click(links[0]!); window.location.hash = '#/money'; });
    await hashChanged();
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'More' })).toBeNull());
    expect(within(tabs()).getByRole('link', { name: 'More' }).getAttribute('aria-current')).toBe('page');
    // Closing it puts focus back on the More tab that opened it.
    expect(document.activeElement).toBe(within(tabs()).getByRole('link', { name: 'More' }));
  });

  it('marks the place you are on in More, and Esc closes it', async () => {
    stubWidth(true);
    start('#/connections?sheet=more:places');
    const sheet = await screen.findByRole('complementary', { name: 'More' });
    expect(within(sheet).getByRole('link', { name: 'Connections' }).getAttribute('aria-current')).toBe('page');
    expect(within(sheet).getByRole('link', { name: 'Money' }).hasAttribute('aria-current')).toBe(false);
    await act(async () => { fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' }); });
    await hashChanged();
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'More' })).toBeNull());
    expect(window.location.hash).toBe('#/connections');
  });

  it('a sheet covers the screen: its holder says so, and the top bar, page and tabs under it take no focus', async () => {
    stubWidth(true);
    const { container } = start('#/team?sheet=agent:editor');
    const panel = await screen.findByRole('complementary', { name: 'Editor' });
    const holder = panel.parentElement!;
    expect(holder.hasAttribute('data-cover')).toBe(true);
    // The skip link too: it would only lead behind the sheet.
    const skip = screen.getByRole('button', { name: 'Skip to the page', hidden: true });
    for (const under of [skip, topBar()!.parentElement!, screen.getByRole('main'), tabs().parentElement!.parentElement!]) {
      expect(under.hasAttribute('inert'), under.outerHTML.slice(0, 60)).toBe(true);
    }
    expect(appRoot(container).hasAttribute('data-sheet-open')).toBe(true);
    // Closed, everything is live again.
    await go('#/team');
    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
    expect(screen.getByRole('main').hasAttribute('inert')).toBe(false);
    expect(tabs().parentElement!.parentElement!.hasAttribute('inert')).toBe(false);
    expect(screen.getByRole('button', { name: 'Skip to the page' }).hasAttribute('inert')).toBe(false);
  });

  it('a wide window keeps the rail, has no top bar or tabs, and its sheet lies beside the page', async () => {
    stubWidth(false);
    const { container } = start('#/team?sheet=agent:editor');
    const panel = await screen.findByRole('complementary', { name: 'Editor' });
    expect(panel.parentElement!.hasAttribute('data-cover')).toBe(false);
    expect(topBar()).toBeNull();
    expect(within(screen.getByRole('navigation', { name: 'Places' })).getAllByRole('link').map((a) => a.getAttribute('href'))).toContain('#/money');
    expect(appRoot(container).hasAttribute('data-phone')).toBe(false);
    expect(screen.getByRole('main').hasAttribute('inert')).toBe(false);
  });

  it('turning the phone into a wide window swaps the frame without losing the place', async () => {
    const width = stubWidth(true);
    start('#/work');
    expect(topBar()).not.toBeNull();
    width.resize(false);
    await settle();
    expect(topBar()).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Work' })).toBeTruthy();
  });

  it('the frame CSS lays the phone out from data-phone: top bar, page, tabs, and a covering sheet', () => {
    const css = readFileSync(join(import.meta.dirname, '../../src/shell/App.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(/\.app\[data-phone\][^{]*\{[^}]*'top'[^}]*'main'[^}]*'tabs'/);
    expect(css).toMatch(/\.sheet\[data-cover\]\s*\{[^}]*grid-row:\s*2\s*\/\s*-1/);
    // The 440 px agent panel fills the phone.
    expect(css).toMatch(/\[data-cover\] \[data-width='panel'\]\s*\{[^}]*max-inline-size:\s*none/);
    // The rail's own phone menu is gone: the phone never draws the rail.
    const rail = readFileSync(join(import.meta.dirname, '../../src/shell/Rail.module.css'), 'utf8');
    expect(rail).not.toMatch(/max-width: 759px/);
  });
});

/** The engine's department views (W4 4A1's TeamListView shape), given in the test: the fake sends none yet. */
const DEPARTMENT_OF: Record<string, AgentView['department']> = { editor: 'production', researcher: 'marketing', producer: 'sales', publisher: 'marketing' };
const department = (id: DepartmentView['id']): DepartmentView => ({
  id, name: id, counts: { working: 0, waiting: 0, stopped: 0, idle: 0 }, doneThisWeek: { count: 0, receiptId: 'R-0402' },
  spendThisMonth: { display: '₹0.00', receiptId: 'R-0402' }, series: { jobs: [], spend: [] },
});
function withDepartments(): EngineClient {
  const base = createFakeClient(new FakeEngine());
  return {
    ...base,
    request: ((method: string, params?: unknown) => method === 'venture.team.list'
      ? base.request('venture.team.list', {}).then((view): TeamListView => ({
          agents: view.agents.map((agent) => ({ ...agent, department: DEPARTMENT_OF[agent.id] })),
          departments: (['sales', 'marketing', 'production', 'money', 'operations'] as const).map(department),
        }))
      : base.request(method as never, params as never)) as EngineClient['request'],
  };
}

describe('Team on a phone', () => {
  it('the department toggle is a row of filter chips that scrolls sideways, with the same choices, held in the address', async () => {
    stubWidth(true);
    start('#/team', withDepartments());
    const toggle = await screen.findByRole('group', { name: 'Show departments' });
    expect(toggle.hasAttribute('data-scroll')).toBe(true);
    expect(within(toggle).getAllByRole('button').map((b) => b.textContent)).toEqual(['All departments', 'Sales and clients', 'Marketing', 'Production', 'Money', 'Operations']);
    await act(async () => { fireEvent.click(within(toggle).getByRole('button', { name: 'Production' })); });
    await hashChanged();
    expect(window.location.hash).toBe('#/team?dept=prod');
    expect(within(screen.getByRole('group', { name: 'Show departments' })).getByRole('button', { name: 'Production' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('a wide window keeps the segmented toggle', async () => {
    stubWidth(false);
    start('#/team', withDepartments());
    const toggle = await screen.findByRole('group', { name: 'Show departments' });
    expect(toggle.hasAttribute('data-scroll')).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The web app's manifest, its icons and the theme colours (index.html, public/)
// ---------------------------------------------------------------------------------------------------------------

const ui = join(import.meta.dirname, '../..');
const tokens = readFileSync(join(ui, 'src/tokens/tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
/** A token's value in the light :root block and in the dark block the computer's setting picks. */
function token(name: string, theme: 'light' | 'dark'): string {
  const block = theme === 'light'
    ? tokens.slice(tokens.indexOf(':root {'), tokens.indexOf('}', tokens.indexOf(':root {')))
    : tokens.slice(tokens.indexOf(':root[data-theme="dark"]'), tokens.indexOf('}', tokens.indexOf(':root[data-theme="dark"]')));
  const found = new RegExp(`${name}:\\s*([^;]+);`).exec(block);
  if (!found) throw new Error(`no ${name} in the ${theme} block`);
  return found[1]!.trim().toLowerCase();
}

/** A PNG's width, height and colour type, read from its IHDR chunk. */
function png(path: string) {
  const bytes = readFileSync(path);
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(bytes.subarray(12, 16).toString('latin1')).toBe('IHDR');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), depth: bytes[24], colourType: bytes[25] };
}

describe('the web app manifest and the theme colours', () => {
  const html = readFileSync(join(ui, 'index.html'), 'utf8');
  type Manifest = Record<string, unknown> & { icons: { src: string; sizes: string; type: string; purpose?: string }[] };
  const read = () => JSON.parse(readFileSync(join(ui, 'public/manifest.webmanifest'), 'utf8')) as Manifest;

  it('index.html has a theme-color for light and for dark, each the page ground of that theme', () => {
    const metas = [...html.matchAll(/<meta name="theme-color" media="\(prefers-color-scheme: (light|dark)\)" content="(#[0-9a-f]{6})">/gi)];
    expect(metas.map((m) => m[1])).toEqual(['light', 'dark']);
    expect(metas[0]![2]!.toLowerCase()).toBe(token('--bg', 'light'));
    expect(metas[1]![2]!.toLowerCase()).toBe(token('--bg', 'dark'));
  });

  it('index.html asks for the manifest with credentials, as the hosted server writes it, and keeps theme.js before the app', () => {
    expect(html).toContain('<link rel="manifest" href="./manifest.webmanifest" crossorigin="use-credentials">');
    expect(html).toContain('<link rel="icon" type="image/svg+xml" href="./icon.svg">');
    expect(html.indexOf('./theme.js')).toBeGreaterThan(-1);
    expect(html.indexOf('./theme.js')).toBeLessThan(html.indexOf('src/main.tsx'));
    const theme = readFileSync(join(ui, 'public/theme.js'), 'utf8');
    expect(theme).toMatch(/setAttribute\('data-theme'/);
  });

  it('the manifest is Chausar, standalone from this folder, in the light page colour', () => {
    const manifest = read();
    expect(manifest).toMatchObject({ name: 'Chausar', short_name: 'Chausar', start_url: './', scope: './', display: 'standalone' });
    expect(String(manifest.background_color).toLowerCase()).toBe(token('--bg', 'light'));
    expect(String(manifest.theme_color).toLowerCase()).toBe(token('--bg', 'light'));
  });

  it('lists opaque PNG app icons, 192 and 512 and a maskable 512, never the transparent favicon', () => {
    const manifest = read();
    expect(manifest.icons).toEqual([
      { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ]);
    for (const icon of manifest.icons) {
      const size = Number(icon.sizes.split('x')[0]);
      // Colour type 2 is RGB with no alpha channel: opaque by construction.
      expect(png(join(ui, 'public', icon.src)), icon.src).toEqual({ width: size, height: size, depth: 8, colourType: 2 });
    }
    expect(manifest.icons.some((icon) => icon.src.endsWith('.svg'))).toBe(false);
  });
});
