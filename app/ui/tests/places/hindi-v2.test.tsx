import { describe, expect, it } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { ClockProvider } from '../../src/shell/clock';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { CATALOGUES } from '../../src/text';

/**
 * w3 3H2: every place in Hindi with the fake engine. A missing Hindi string shows its key (text/index.tsx `format`),
 * and a value nobody filled shows its `{name}`; neither may reach the owner. Visible text and the words assistive
 * technology reads (aria-label, title, placeholder, alt) are both checked.
 */

const MORNING = () => new Date(2026, 9, 23, 10, 0);

/** The first word of every text key (today, state, ring, ...): a word.word that starts with one of these is a key. */
const PREFIXES = new Set(Object.keys(CATALOGUES.en).map((key) => key.split('.')[0]!));
const KEYS = new Set(Object.keys(CATALOGUES.en));
const KEYLIKE = /(?<![\w.@/-])([a-z]+(?:\.[a-zA-Z0-9-]+)+)(?![\w@/-])/g;
/** Every loading line in Hindi, so the check waits for the content and not the line that stands in for it. */
const LOADING = new Set(Object.entries(CATALOGUES.hi).filter(([key]) => /(?:^|\.)loading$/.test(key)).map(([, message]) => message as string));

function leaks(text: string): string[] {
  const found: string[] = [];
  const trimmed = text.trim().replace(/[.:]$/, '');
  if (KEYS.has(trimmed)) found.push(trimmed);
  for (const [, word] of text.matchAll(KEYLIKE)) {
    const clean = word!.replace(/\.$/, '');
    if (PREFIXES.has(clean.split('.')[0]!) && clean.includes('.') && !found.includes(clean)) found.push(clean);
  }
  for (const [placeholder] of text.matchAll(/\{\w+\}/g)) found.push(placeholder);
  return found;
}

/** What the page shows and says: its text nodes and the named attributes, each with where it sits. */
function words(root: HTMLElement): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? '';
    if (text.trim()) out.push({ where: node.parentElement?.tagName.toLowerCase() ?? 'text', text });
  }
  for (const element of root.querySelectorAll('[aria-label], [title], [placeholder], [alt], [aria-description], [aria-valuetext]')) {
    for (const name of ['aria-label', 'title', 'placeholder', 'alt', 'aria-description', 'aria-valuetext']) {
      const value = element.getAttribute(name);
      if (value) out.push({ where: `${element.tagName.toLowerCase()}[${name}]`, text: value });
    }
  }
  return out;
}

async function settle(hash: string, engine = new FakeEngine()): Promise<HTMLElement> {
  window.location.hash = hash;
  const { container } = render(<ClockProvider now={MORNING}><App client={createFakeClient(engine)} language="hi" /></ClockProvider>);
  await waitFor(() => {
    expect(container.querySelector('[data-boot]')).toBeNull();
    expect(container.querySelector('h1')).not.toBeNull();
    if (hash.includes('sheet=')) expect(LOADING.has(container.querySelector('aside h2')?.textContent ?? '')).toBe(false);
    for (const node of container.querySelectorAll('p, h2')) expect(LOADING.has(node.textContent ?? '')).toBe(false);
  });
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  return document.body;
}

const CASES: { name: string; hash: string }[] = [
  { name: 'Today', hash: '#/today' },
  { name: 'Team', hash: '#/team' },
  { name: 'Team, an agent panel', hash: '#/team?sheet=agent:editor' },
  { name: 'Work', hash: '#/work' },
  { name: 'Work, failed runs and a failed run sheet', hash: '#/work?state=failed&sheet=run:28' },
  { name: 'Work, one order', hash: '#/work?order=o-boat-12' },
  { name: 'Clients', hash: '#/clients' },
  { name: 'Clients, pipeline', hash: '#/clients/pipeline' },
  { name: 'Money', hash: '#/money' },
  { name: 'Money, invoices', hash: '#/money/invoices' },
  { name: 'Connections', hash: '#/connections' },
  { name: 'Connections, your AI', hash: '#/connections/ai' },
  { name: 'Start', hash: '#/onboarding' },
];

describe('every place in Hindi shows no key and no unfilled value', () => {
  it('the leak check catches what it should, on samples', () => {
    expect(leaks('today.goal.edit')).toEqual(['today.goal.edit']);
    expect(leaks('Editor · state.run.nope · 4m')).toEqual(['state.run.nope']);
    expect(leaks('{count} आपका इंतज़ार कर रहे हैं')).toEqual(['{count}']);
    expect(leaks('pocketaudio.in पर सभी · index.html · https://example.in/team · 1.5 MB · R-0415')).toEqual([]);
  });

  for (const each of CASES) {
    it(each.name, async () => {
      const root = await settle(each.hash);
      const shown = words(root);
      expect(shown.length, 'the place drew its content').toBeGreaterThan(15);
      const found = shown.flatMap(({ where, text }) => leaks(text).map((leak) => `${where}: ${leak} in "${text.trim()}"`));
      expect(found).toEqual([]);
      // The page really is in Hindi: its title is a Hindi word.
      expect(root.querySelector('h1')!.textContent).toMatch(/[ऀ-ॿ]/);
    }, each.hash.startsWith('#/today') ? 15_000 : 10_000);
  }
});
