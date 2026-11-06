// The rail in the direction D look (w3 plan, package 3A2): the brand link, the business button with its initials
// square, the seven places with their icons, and Today's count. W4 4C2 added Chats, second.
import { describe, expect, it } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';

function start(hash = '#/today', language: 'en' = 'en') {
  window.location.hash = hash;
  render(<App client={createFakeClient(new FakeEngine())} language={language} />);
  return screen.getByRole('navigation', { name: language === 'en' ? 'Places' : 'जगहें' });
}
const go = async (hash: string) => { await act(async () => { window.location.hash = hash; window.dispatchEvent(new HashChangeEvent('hashchange')); }); };

describe('the rail', () => {
  it('starts with the brand: a link to Today named "Chausar, Today", the mark hidden, the lowercase wordmark', () => {
    const rail = start();
    const brand = within(rail).getAllByRole('link')[0]!;
    expect(brand.getAttribute('href')).toBe('#/today');
    expect(within(rail).getByRole('link', { name: 'Chausar, Today' })).toBe(brand);
    const mark = brand.querySelector('svg')!;
    expect(mark.getAttribute('aria-hidden')).toBe('true');
    expect(mark.querySelectorAll('rect')).toHaveLength(2);
    expect(brand.textContent).toBe('chausar');
    // The brand is a way home, not the current place: only the Today item says it is current.
    expect(brand.hasAttribute('aria-current')).toBe(false);
  });

  it('draws the brand with the Logo part and its own wordmark; a phone draws its top bar instead of the rail (3H1)', () => {
    const rail = start();
    const brand = within(rail).getByRole('link', { name: 'Chausar, Today' });
    expect(brand.children).toHaveLength(1);
    const logo = brand.firstElementChild!;
    expect(logo.querySelector('svg')).toBe(brand.querySelector('svg'));
    expect(logo.textContent).toBe('chausar');
    const css = readFileSync(join(import.meta.dirname, '../../src/shell/Rail.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/\.word\s*\{/);
    expect(css).not.toMatch(/max-width: 759px/);
  });

  it('shows the business as an initials square, its name and its kind line, with a way to switch', async () => {
    const rail = start();
    const button = await within(rail).findByRole('button', { name: /Lumen Studio/ });
    await waitFor(() => expect(button.textContent).toContain('YouTube channel'));
    const square = button.querySelector('[data-initials]')!;
    expect(square.textContent).toBe('LS');
    expect(square.getAttribute('aria-hidden')).toBe('true');
    expect(button.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    expect(within(button).getByText('Switch business').className).toBe('sr-only');
    expect(button.textContent).not.toContain(' · ');
  });

  it('lists Today, Chats, Team, Work, Clients, Money, Apps and Connections, each with its icon and word (W4 4C2 added Chats, W6 6H1 Apps)', async () => {
    const rail = start('#/team');
    const places = within(within(rail).getAllByRole('list')[0]!).getAllByRole('link');
    expect(places.map((a) => a.getAttribute('href'))).toEqual(['#/today', '#/chats', '#/team', '#/work', '#/clients', '#/money', '#/apps', '#/connections']);
    const icons = places.map((a) => {
      const svg = a.querySelector('svg')!;
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      return [...svg.classList].find((c) => c.startsWith('lucide-'));
    });
    expect(icons).toEqual(['lucide-sun', 'lucide-messages-square', 'lucide-users', 'lucide-briefcase', 'lucide-contact', 'lucide-wallet', 'lucide-layout-grid', 'lucide-plug']);
    expect(places.map((a) => a.textContent!.replace(/\d.*$/, '').replace(/New, new$/, ''))).toEqual(['Today', 'Chats', 'Team', 'Work', 'Clients', 'Money', 'Apps', 'Connections']);
    expect(places.map((a) => a.getAttribute('aria-current'))).toEqual([null, null, 'page', null, null, null, null, null]);
    // W4 4C2 flipped this line: Chats is a real place now.
    expect(within(rail).getByRole('link', { name: /^Chats/ }).getAttribute('href')).toBe('#/chats');
  });

  it("carries Today's count in the same badge before and after opening Today", async () => {
    const rail = start('#/team');
    const today = within(rail).getByRole('link', { name: /^Today/ });
    await waitFor(() => expect(today.textContent).toBe('Today12, 12 need you'));
    const count = today.querySelector('[data-count]')!;
    expect(count.textContent).toBe('12');
    expect(count.closest('[data-tone]')?.getAttribute('data-tone')).toBe('wait');
    expect(count.parentElement?.getAttribute('aria-hidden')).toBe('true');
    expect(count.parentElement!.nextElementSibling!.className).toBe('sr-only');
    expect(count.parentElement!.nextElementSibling!.textContent).toBe(', 12 need you');
    await go('#/today');
    await waitFor(() => expect(within(rail).getByRole('link', { name: /^Today/ }).getAttribute('aria-current')).toBe('page'));
    expect(within(rail).getByRole('link', { name: /^Today/ }).querySelector('[data-tone]')!.getAttribute('data-tone')).toBe('wait');
  });

});

describe('the rail: Settings has a home, and the rail folds to icons (C1 task 8)', () => {
  const cssOf = (file: string) => readFileSync(join(import.meta.dirname, '../../src/shell', file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  /** Every block of the folded-rail rule in a stylesheet, joined. */
  const media = (css: string) => {
    const head = '@media (min-width: 760px) and (max-width: 959px)';
    expect(css.indexOf(head), 'the compact rule').toBeGreaterThanOrEqual(0);
    let out = '';
    for (let at = css.indexOf(head); at >= 0; at = css.indexOf(head, at + 1)) {
      let depth = 0;
      for (let i = css.indexOf('{', at); i < css.length; i += 1) {
        if (css[i] === '{') depth += 1;
        else if (css[i] === '}') { depth -= 1; if (depth === 0) { out += css.slice(at, i + 1); break; } }
      }
    }
    return out;
  };

  it('the places list is unchanged, and a second list holds one link, Settings, to #/business, current on Settings pages only', async () => {
    const rail = start('#/business/goals');
    const [places, foot] = within(rail).getAllByRole('list');
    expect(within(places!).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['#/today', '#/chats', '#/team', '#/work', '#/clients', '#/money', '#/apps', '#/connections']);
    const links = within(foot!).getAllByRole('link');
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([['Settings', '#/business']]);
    expect(links[0]!.getAttribute('aria-current')).toBe('page');
    expect(within(places!).getAllByRole('link').filter((a) => a.hasAttribute('aria-current'))).toEqual([]);
    await go('#/today');
    expect(within(rail).getByRole('link', { name: 'Settings' }).hasAttribute('aria-current')).toBe(false);
  });

  it('every place link keeps its name and has a title', () => {
    const rail = start('#/today');
    for (const name of ['Chats', 'Team', 'Work', 'Clients', 'Money', 'Apps', 'Connections', 'Settings']) {
      const link = within(rail).getByRole('link', { name: new RegExp(`^${name}`) });
      expect(link.getAttribute('title')).toBe(name);
    }
  });

  it('from 760 to 959 px the grid column is --rail-compact and the words are hidden visually, never with display: none', () => {
    expect(media(cssOf('App.module.css'))).toMatch(/grid-template-columns:\s*var\(--rail-compact\)\s+minmax\(0, 1fr\)/);
    const rail = media(cssOf('Rail.module.css'));
    expect(rail).toMatch(/\.label\s*\{[^}]*clip-path:\s*inset\(50%\)/);
    expect(rail).not.toMatch(/\.label\s*\{[^}]*display:\s*none/);
    const menu = media(cssOf('BusinessMenu.module.css'));
    expect(menu).toMatch(/\.words[\s\S]*clip-path:\s*inset\(50%\)/);
    const tokens = readFileSync(join(import.meta.dirname, '../../src/tokens/tokens.css'), 'utf8');
    expect(tokens).toMatch(/--rail-compact:\s*64px;/);
  });
});

describe('one count (B3)', () => {
  it('the rail and Today together make one request for what needs you at start', async () => {
    window.location.hash = '#/today';
    const fake = createFakeClient(new FakeEngine());
    const asked: unknown[] = [];
    const client = { ...fake, request: ((method: string, params?: unknown) => { if (method === 'venture.queue.list') asked.push(params); return fake.request(method as never, params as never); }) as typeof fake.request };
    render(<App client={client} language="en" />);
    await screen.findByRole('region', { name: 'Needs you' });
    await act(async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(asked.filter((params) => JSON.stringify(params) === JSON.stringify({ scope: 'all' }))).toHaveLength(1);
  });
});

describe('the app icon', () => {
  // One-shot A7: the favicon is the founder's logo file as given: a dark tile with a grey square and a green one. It
  // carries its own tile, so it reads on a light tab and a dark one alike and does not follow the theme. Its green is
  // the logo's own, not the app's Jade, and neither changes the other.
  const LOGO_SQUARES = [[112, 112, 144, 144, 36], [264, 264, 144, 144, 36]];
  it('is the founder\'s logo: the dark tile, the grey square top left and the green square bottom right', () => {
    const app = join(import.meta.dirname, '../..');
    const icon = readFileSync(join(app, 'public/icon.svg'), 'utf8');
    const rects = [...icon.matchAll(/<rect\b([^>]*)\/>/g)].map((m) => Object.fromEntries([...m[1]!.matchAll(/([a-z]+)="([^"]*)"/g)].map((a) => [a[1], a[2]])));
    expect(icon).toMatch(/viewBox="0 0 520 520"/);
    expect(rects).toEqual([
      { width: '520', height: '520', rx: '48', fill: '#070809' },
      ...LOGO_SQUARES.map(([x, y, w, h, r], i) => ({ x: String(x), y: String(y), width: String(w), height: String(h), rx: String(r), fill: ['#e8ebee', '#46f09b'][i] })),
    ]);
    expect(icon).not.toMatch(/<style|prefers-color-scheme|#2fb67c/i);
    const tokens = readFileSync(join(app, 'src/tokens/tokens.css'), 'utf8');
    expect(tokens).toMatch(/--accent:\s*#2fb67c/i);
  });

  it('the mark in the app is the logo\'s two squares, less the tile\'s margin, at an eighth of the size, in the theme\'s colours', () => {
    const app = join(import.meta.dirname, '../..');
    const logo = readFileSync(join(app, 'src/parts/Logo.tsx'), 'utf8');
    expect(logo).toMatch(/viewBox="0 0 37 37"/);
    const squares = [...logo.matchAll(/<rect className=\{[^}]+\} x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)" rx="([\d.]+)" \/>/g)].map((m) => m.slice(1).map(Number));
    expect(squares).toEqual(LOGO_SQUARES.map(([x, y, w, h, r]) => [(x! - 112) / 8, (y! - 112) / 8, w! / 8, h! / 8, r! / 8]));
  });
});
