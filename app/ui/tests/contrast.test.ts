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

/**
 * Ink v2 (the w3 plan's token table, last column). Theme-invariant tokens (the accent, its ink, the rings) are set once
 * in :root, so the dark theme reads them from there.
 */
const DEPTS = ['sales', 'mkt', 'prod', 'money', 'ops'] as const;
const themes = [['light', light], ['dark', { ...light, ...dark }]] as const;

/** [text, ground]: words a person reads, so 4.5:1 in both themes. */
const TEXT_PAIRS: [string, string][] = [
  ['accent-ink', 'accent'],
  ['accent-text', 'surface'],
  ['accent-text', 'bg'],
  ['accent-text', 'inner'],
  ['accent-text', 'accent-soft'],
  ['mute', 'accent-soft'],
  ['wait', 'wait-soft'],
  ...DEPTS.map((d): [string, string] => ['wait-strong', `${d}-tint`]),
  ['fail', 'fail-soft'],
  ...DEPTS.map((d): [string, string] => ['fail', `${d}-tint`]),
  ['on-selected', 'selected'],
  ['on-selected', 'count-on-selected'],
  ...(['wash', 'inner', 'desk'] as const).flatMap((g): [string, string][] => [['fg', g], ['fg2', g], ['mute', g]]),
  ['link', 'inner'],
  ['link-hover', 'surface'],
  ['link-hover', 'bg'],
  ...DEPTS.flatMap((d): [string, string][] => [[d, `${d}-tint`], ['fg2', `${d}-tint`]]),
  ...(['goal-fg', 'goal-fg2', 'goal-mute', 'goal-link', 'goal-link-hover', 'accent'] as const).map((t): [string, string] => [t, 'goal-bg']),
  ['goal-fg2', 'goal-chip'],
  // Money's "changed since" on the dark goal card (3C).
  ['wait-ring', 'goal-bg'],
];
/** [mark, ground]: shapes whose meaning is also in words, so 3:1 (WCAG 1.4.11). */
const NON_TEXT_PAIRS: [string, string][] = [
  ...DEPTS.map((d): [string, string] => ['dept-on', d]),
  ['fail-ring', 'surface'],
  ['accent', 'goal-track'],
  ['chart-ink', 'surface'],
  // The resting bars and the shared part of a split (4A2 review): marks whose meaning the legend and table also say.
  ['chart-rest', 'surface'],
  ['chart-rest', 'inner'],
  ...(['age-30', 'age-60', 'age-90', 'age-over'] as const).map((a): [string, string] => [a, 'surface']),
];
/**
 * The one mark allowed under 3:1, by theme. --age-30 (the 1 to 30 days bucket, amber like the waiting ring) reads 2.00:1
 * on the light surface. The w3 plan carries it another way: the aging chart's legend names every bucket in words with
 * its count and amount, and "View chart data" gives the same figures as a table, so the colour is never the only cue.
 * The test below proves the exception is still needed; if the colour ever reaches 3:1, drop it from this list.
 */
const NON_TEXT_EXCEPTIONS: [theme: string, mark: string, ground: string][] = [['light', 'age-30', 'surface']];
const excepted = (theme: string, mark: string, ground: string) => NON_TEXT_EXCEPTIONS.some(([t, m, g]) => t === theme && m === mark && g === ground);
/**
 * Pairs no part may use: each reads under 4.5:1 in at least one theme. That is why --dim may sit only on --bg and
 * --surface, and plain --wait only on --bg, --surface and --wait-soft (amber words on a tint use --wait-strong).
 * source-rules.test.ts holds both allowlists in every stylesheet.
 */
const FORBIDDEN_PAIRS: [string, string][] = [
  ...(['inner', 'wash', 'desk', 'hover', 'line-soft', 'accent-soft', 'wait-soft', 'fail-soft'] as const).map((g): [string, string] => ['dim', g]),
  ...DEPTS.map((d): [string, string] => ['dim', `${d}-tint`]),
  ...DEPTS.map((d): [string, string] => ['wait', `${d}-tint`]),
  ...(['accent-soft', 'fail-soft', 'hover'] as const).map((g): [string, string] => ['wait', g]),
];

describe('Ink v2 contrast from the tokens', () => {
  it('reads the only light block and the only dark blocks, so no later block can change a checked value', () => {
    const count = (re: RegExp) => css.match(re)?.length ?? 0;
    expect(count(/(?<![\w\])-]):root\s*\{/g)).toBe(1);
    expect(count(/:root:not\(\[data-theme="light"\]\)\s*\{/g)).toBe(1);
    expect(count(/:root\[data-theme="dark"\]\s*\{/g)).toBe(1);
  });

  for (const [theme, tokens] of themes) {
    for (const [text, ground] of TEXT_PAIRS) {
      it(`${theme}: ${text} on ${ground} is at least 4.5:1`, () => {
        const ratio = contrast(tokens[text]!, tokens[ground]!);
        expect(ratio, `${tokens[text]} on ${tokens[ground]} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      });
    }
    for (const [mark, ground] of NON_TEXT_PAIRS.filter(([m, g]) => !excepted(theme, m, g))) {
      it(`${theme}: ${mark} on ${ground} is at least 3:1`, () => {
        const ratio = contrast(tokens[mark]!, tokens[ground]!);
        expect(ratio, `${tokens[mark]} on ${tokens[ground]} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
      });
    }
  }

  for (const [theme, mark, ground] of NON_TEXT_EXCEPTIONS) {
    it(`${theme}: ${mark} on ${ground} is the documented exception, still under 3:1, and a listed pair`, () => {
      const tokens = themes.find(([t]) => t === theme)![1];
      expect(NON_TEXT_PAIRS).toContainEqual([mark, ground]);
      expect(contrast(tokens[mark]!, tokens[ground]!)).toBeLessThan(3);
    });
  }

  for (const [text, ground] of FORBIDDEN_PAIRS) {
    it(`${text} on ${ground} stays forbidden: under 4.5:1 in at least one theme`, () => {
      const ratios = themes.map(([, tokens]) => contrast(tokens[text]!, tokens[ground]!));
      expect(Math.min(...ratios), ratios.map((r) => r.toFixed(2)).join(' / ')).toBeLessThan(4.5);
    });
  }
});
