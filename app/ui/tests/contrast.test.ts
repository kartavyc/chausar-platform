import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * WCAG 2.2 contrast for every text colour on the page and sheet backgrounds, in light and dark, computed from the
 * values in tokens.css. jsdom cannot compute colours, so the axe check (a11y.test.tsx) leaves colour contrast to this.
 * All Ink text is under 18 px (24 px for regular weight counts as large), so every pair needs 4.5:1. That includes
 * --dim: struck old values and pending steps are text the owner reads.
 */

const css = readFileSync(join(import.meta.dirname, '../src/tokens/tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function block(selector: string): Record<string, string> {
  const at = css.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  return Object.fromEntries(body.split(';').map((part) => part.split(':').map((x) => x.trim())).filter(([k, v]) => k?.startsWith('--') && v).map(([k, v]) => [k!.slice(2), v!.toLowerCase()]));
}

/** Relative luminance of a #rrggbb colour (WCAG 2.2, 1.4.3). */
function luminance(hex: string): number {
  expect(hex).toMatch(/^#[0-9a-f]{6}$/);
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const light = block(':root');
const dark = block(':root[data-theme="dark"]');
const TEXT = ['fg', 'fg2', 'mute', 'dim', 'link', 'wait', 'fail'] as const;
const GROUNDS = ['bg', 'surface'] as const;

describe('text contrast from the tokens', () => {
  it('computes ratios the way WCAG does', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });

  for (const [theme, tokens] of [['light', light], ['dark', dark]] as const) {
    for (const ground of GROUNDS) {
      for (const text of TEXT) {
        it(`${theme}: ${text} on ${ground} is at least 4.5:1`, () => {
          const ratio = contrast(tokens[text]!, tokens[ground]!);
          expect(ratio, `${tokens[text]} on ${tokens[ground]} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
  }

  it('the dark values under prefers-color-scheme are the same as data-theme=dark', () => {
    expect(block(':root:not([data-theme="light"])')).toEqual(dark);
  });
});
