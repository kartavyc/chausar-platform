import { describe, expect, it } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { App } from '../src/shell/App';
import { FakeEngine, createFakeClient } from '../src/engine/fake';

/**
 * w3 3I: in Hindi a count label mixes digits and words ("5 में से 3"). In DM Mono the Devanagari falls back to the body
 * face while the digits and spaces keep mono widths, so the label looks loosely spaced. Under `:lang(hi)` a Count
 * (`[data-count]`) uses the body face with tabular figures instead, and every step count the places draw ("3 of 5"
 * under a story, beside a bar, in a job list) is marked a Count so the rule reaches it. The walk (scripts/ui-shots)
 * checks the computed face in a real browser; this checks the rule is there and outranks `.mono`, and that the labels
 * carry the mark.
 */

const base = readFileSync(join(import.meta.dirname, '../src/tokens/base.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function declarations(selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = base.match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`no rule "${selector}" in base.css`);
  return Object.fromEntries(match[1]!.split(';').map((d) => d.split(':').map((p) => p.trim())).filter(([k, v]) => k && v).map(([k, v]) => [k!, v!]));
}

/** "5 में से 3": a step count in Hindi, written as the eye reads it. */
const HINDI_COUNT = /\d+\s*में से\s*\d+/;

describe('Hindi counts', () => {
  it('set a Count in the body face with tabular figures, at normal spacing', () => {
    const rule = declarations(':lang(hi) [data-count]');
    expect(rule['font-family']).toBe('var(--font)');
    expect(rule['font-variant-numeric']).toBe('tabular-nums');
    expect(rule['letter-spacing']).toBe('normal');
  });

  it('come after .mono, with a selector that outranks it (a pseudo-class and an attribute against one class)', () => {
    expect(base.indexOf(':lang(hi) [data-count]')).toBeGreaterThan(base.indexOf('.mono'));
  });

  for (const hash of ['#/today', '#/team']) {
    it(`every step count drawn on ${hash} in Hindi is a Count, so it takes the body face`, async () => {
      window.location.hash = hash;
      render(<App client={createFakeClient(new FakeEngine())} language="hi" />);
      await waitFor(() => expect(screen.getByRole('main').querySelector('h1')).not.toBeNull());
      for (let i = 0; i < 6; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
      const shown: Element[] = [];
      const walker = document.createTreeWalker(screen.getByRole('main'), NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement;
        if (parent && HINDI_COUNT.test(node.textContent ?? '') && !parent.closest('.sr-only')) shown.push(parent);
      }
      expect(shown.length, `${hash} draws a step count`).toBeGreaterThan(0);
      for (const label of shown) expect(label.closest('[data-count]'), `"${label.textContent}" in <${label.tagName.toLowerCase()} class="${label.className}">`).not.toBeNull();
    });
  }
});
