// The rail in the direction D look (w3 plan, package 3A2): the brand link, the business button with its initials
// square, the six places with their icons, and Today's count. There is no Chats item until W4 4C adds it.
import { describe, expect, it } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';

function start(hash = '#/today', language: 'en' | 'hi' = 'en') {
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

  it('lists Today, Team, Work, Clients, Money and Connections, each with its icon and word, and no Chats yet', async () => {
    const rail = start('#/team');
    const places = within(within(rail).getByRole('list')).getAllByRole('link');
    expect(places.map((a) => a.getAttribute('href'))).toEqual(['#/today', '#/team', '#/work', '#/clients', '#/money', '#/connections']);
    const icons = places.map((a) => {
      const svg = a.querySelector('svg')!;
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      return [...svg.classList].find((c) => c.startsWith('lucide-'));
    });
    expect(icons).toEqual(['lucide-sun', 'lucide-users', 'lucide-briefcase', 'lucide-contact', 'lucide-wallet', 'lucide-plug']);
    expect(places.map((a) => a.textContent!.replace(/\d.*$/, ''))).toEqual(['Today', 'Team', 'Work', 'Clients', 'Money', 'Connections']);
    expect(places.map((a) => a.getAttribute('aria-current'))).toEqual([null, 'page', null, null, null, null]);
    // W4 4C adds Chats (and flips this line); until then there is no dead item.
    expect(within(rail).queryByRole('link', { name: /Chats/ })).toBeNull();
  });

  it("carries Today's count in DM Mono, hidden from screen readers but said in words, amber when Today is not open", async () => {
    const rail = start('#/team');
    const today = within(rail).getByRole('link', { name: /^Today/ });
    await waitFor(() => expect(today.textContent).toBe('Today12, 12 need you'));
    const count = today.querySelector('[aria-hidden="true"].mono')!;
    expect(count.textContent).toBe('12');
    expect(count.getAttribute('data-tone')).toBe('wait');
    expect(count.nextElementSibling!.className).toBe('sr-only');
    expect(count.nextElementSibling!.textContent).toBe(', 12 need you');
    await go('#/today');
    await waitFor(() => expect(within(rail).getByRole('link', { name: /^Today/ }).getAttribute('aria-current')).toBe('page'));
    expect(within(rail).getByRole('link', { name: /^Today/ }).querySelector('.mono')!.hasAttribute('data-tone')).toBe(false);
  });

  it('speaks Hindi, the brand keeping its own name', async () => {
    const rail = start('#/today', 'hi');
    expect(within(rail).getByRole('link', { name: 'Chausar, आज' })).toBeTruthy();
    await waitFor(() => expect(within(rail).getByRole('button', { name: /Lumen Studio/ }).textContent).toContain('बिज़नेस बदलें'));
  });
});

describe('the app icon', () => {
  it('is the two-square mark: ink square and the accent square, the same values as the tokens', () => {
    const app = join(import.meta.dirname, '../..');
    const icon = readFileSync(join(app, 'public/icon.svg'), 'utf8');
    const tokens = readFileSync(join(app, 'src/tokens/tokens.css'), 'utf8');
    const light = tokens.slice(0, tokens.indexOf('@media (prefers-color-scheme: dark)'));
    const dark = tokens.slice(tokens.indexOf('@media (prefers-color-scheme: dark)'));
    const token = (css: string, name: string) => new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css)?.[1]?.toLowerCase();
    const fills = [...icon.matchAll(/fill(?:="|:\s*)(#[0-9a-fA-F]{6})/g)].map((m) => m[1]!.toLowerCase());
    expect(icon).toContain('#2FB67C');
    expect(token(light, '--accent')).toBe('#2fb67c');
    expect(icon.match(/<rect\b/g)).toHaveLength(2);
    // The ink square is --fg: dark on a light tab, light on a dark one (the theme follows the computer).
    expect(fills).toEqual([token(light, '--fg'), token(light, '--accent'), token(dark, '--fg')]);
  });
});
