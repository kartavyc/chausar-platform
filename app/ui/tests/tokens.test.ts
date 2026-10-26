import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string) => readFileSync(join(import.meta.dirname, path), 'utf8');

/** Spec section 5, exact values, except light dim: #71767d read at 4.42:1 on bg, so it moved to #6e737a (contrast.test.ts). */
const LIGHT = { bg: '#fbfbfa', surface: '#ffffff', fg: '#16181b', fg2: '#3d4146', mute: '#5c6168', dim: '#6e737a', line: '#e3e5e8', hover: '#eceef0', link: '#2f5bd3', wait: '#b45309', fail: '#b42318' };
const DARK = { bg: '#111214', surface: '#17181a', fg: '#eceef0', fg2: '#c4c8cc', mute: '#9aa0a6', dim: '#858b92', line: '#2a2d31', hover: '#1f2123', link: '#8fb4ff', wait: '#e5a54b', fail: '#f97066' };

/** The declarations inside every block whose selector matches. */
function blocks(css: string, selector: RegExp): Record<string, string>[] {
  const found: Record<string, string>[] = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (!selector.test(m[1]!.trim())) continue;
    const decls: Record<string, string> = {};
    for (const part of m[2]!.split(';')) {
      const i = part.indexOf(':');
      if (i > 0) decls[part.slice(0, i).trim()] = part.slice(i + 1).trim().toLowerCase();
    }
    found.push(decls);
  }
  return found;
}
const colours = (decls: Record<string, string>, expected: Record<string, string>) =>
  Object.fromEntries(Object.keys(expected).map((k) => [k, decls[`--${k}`]]));

describe('Ink tokens', () => {
  const css = read('../src/tokens/tokens.css');

  it('light values are exactly the spec values', () => {
    const [root] = blocks(css, /^:root$/);
    expect(root).toBeDefined();
    expect(colours(root!, LIGHT)).toEqual(LIGHT);
  });

  it('dark values apply for prefers-color-scheme and for data-theme=dark', () => {
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)/);
    const media = blocks(css, /^:root:not\(\[data-theme="light"\]\)$/);
    const forced = blocks(css, /^:root\[data-theme="dark"\]$/);
    expect(media).toHaveLength(1);
    expect(forced).toHaveLength(1);
    expect(colours(media[0]!, DARK)).toEqual(DARK);
    expect(colours(forced[0]!, DARK)).toEqual(DARK);
  });

  it('type never goes below 12 px, radius is 6 and spacing is on the 4 px scale', () => {
    const [root] = blocks(css, /^:root$/);
    const sizes = Object.entries(root!).filter(([k]) => k.startsWith('--text-')).map(([, v]) => Number.parseFloat(v));
    expect(sizes.length).toBeGreaterThan(4);
    for (const size of sizes) expect(size).toBeGreaterThanOrEqual(12);
    expect(root!['--text-title']).toBe('28px');
    expect(root!['--text-row']).toBe('15px');
    expect(root!['--text-body']).toBe('14px');
    expect(root!['--text-read']).toBe('13px');
    expect(root!['--text-label']).toBe('12px');
    expect(root!['--radius']).toBe('6px');
    for (const [k, v] of Object.entries(root!)) if (k.startsWith('--sp-')) expect(Number.parseFloat(v) % 4).toBe(0);
  });

  it('reduced motion sets every duration to zero and no motion lasts past 400 ms', () => {
    const motion = read('../src/tokens/motion.css');
    const [root] = blocks(css, /^:root$/);
    const durations = Object.entries(root!).filter(([k]) => k.startsWith('--t-'));
    expect(durations.length).toBeGreaterThan(1);
    for (const [, v] of durations) expect(Number.parseFloat(v)).toBeLessThanOrEqual(400);
    const reduced = motion.match(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*:root\s*\{([^}]*)\}/);
    expect(reduced).not.toBeNull();
    for (const [k] of durations) expect(reduced![1]).toMatch(new RegExp(`${k}:\\s*0ms`));
    expect(motion).not.toMatch(/infinite/);
  });

  it('base styles: figures in DM Mono sit a little tighter, and every engine number has tabular digits', () => {
    const base = read('../src/tokens/base.css');
    const [mono] = blocks(base, /^\.mono$/);
    expect(mono!['letter-spacing']).toBe('-0.01em');
    expect(mono!['font-variant-numeric']).toBe('tabular-nums');
    const [number] = blocks(base, /^\[data-ui-number\]$/);
    expect(number!['font-variant-numeric']).toBe('tabular-nums');
  });

  it('motion.css has the swipe snap, and nothing in it loops', () => {
    const motion = read('../src/tokens/motion.css');
    expect(motion).toMatch(/@keyframes ink-snap\s*\{/);
    expect(motion).not.toMatch(/infinite|iteration-count/);
  });

  it('fonts are local files that exist, never fetched from the network', () => {
    const fonts = read('../src/tokens/fonts.css');
    const files = readdirSync(join(import.meta.dirname, '../assets/fonts'));
    const urls = [...fonts.matchAll(/url\('([^']+)'\)/g)].map((m) => m[1]!);
    expect(urls).toHaveLength(7);
    for (const url of urls) {
      expect(url).not.toMatch(/^https?:/);
      expect(files).toContain(url.split('/').pop());
    }
    for (const family of ['Instrument Sans', 'DM Mono', 'Noto Sans Devanagari']) expect(fonts).toContain(`font-family: '${family}'`);
  });
});

/**
 * Ink v2 colours, exactly as the w3 plan's token table (docs/superpowers/plans/2026-10-23-chausar-ink-v2-w3.md,
 * "Tokens"), whose contrast tests/contrast.test.ts checks. The accent is Jade, the founder's pick of 23 October.
 */
const DEPTS = {
  sales: ['#2f5bd3', '#e8eefc', '#d5e0fa', '#8aa8f5', '#1b2337', '#2a3756'],
  mkt: ['#7c3aed', '#f1eafe', '#e4d6fc', '#b99af7', '#251c37', '#3a2d57'],
  prod: ['#0f766e', '#e3f4f2', '#cbe8e4', '#5fcdbf', '#14282a', '#214043'],
  money: ['#0b7a45', '#e6f6ec', '#cdebd8', '#5fcf94', '#152a20', '#224232'],
  ops: ['#475467', '#eef0f3', '#dde1e7', '#848e9d', '#1f2329', '#30363f'],
} as const;
const deptColours = (dark: boolean) =>
  Object.fromEntries(Object.entries(DEPTS).flatMap(([d, v]) => [[d, v[dark ? 3 : 0]], [`${d}-tint`, v[dark ? 4 : 1]], [`${d}-line`, v[dark ? 5 : 2]]]));
/** The aging buckets of a chart (3B2 review): chart-only, so the ring and text tokens stay as they are. */
const AGING = { 'age-30': '#f2a93b', 'age-60': '#b45309', 'age-90': '#ff5065', 'age-over': '#bd3b26' };
const PREVIEW = {
  'pv-video-1': '#25433f',
  'pv-video-2': '#132523',
  'pv-video-3': '#0a1213',
  'pv-scrim': 'rgb(0 0 0 / 0.45)',
  'pv-scrim-strong': 'rgb(0 0 0 / 0.72)',
  'pv-play': 'rgb(255 255 255 / 0.95)',
  'pv-text-2': 'rgb(255 255 255 / 0.6)',
};
const V2_LIGHT: Record<string, string> = {
  'line-soft': '#eceef0', wash: '#f3f4f5', inner: '#f6f7f8', desk: '#f3f4f2', 'btn-line': '#d5d8dc', dash: '#b9bec4', 'receipt-line': '#dbe2f3', 'link-hover': '#1f45b0',
  selected: '#16181b', 'on-selected': '#ffffff', 'count-on-selected': '#3b3d3f',
  accent: '#2fb67c', 'accent-ink': '#0b0d0e', 'accent-soft': '#e6f6ef', 'accent-text': '#0b7a45', 'accent-line': '#cee4da',
  'wait-ring': '#f2a93b', 'wait-soft': '#fdf1e3', 'wait-strong': '#a84d08', 'fail-ring': '#f04438', 'fail-soft': '#feecea', 'fail-line': '#f4c7c1',
  'goal-bg': '#111214', 'goal-track': '#2a2d31', 'goal-fg': '#ffffff', 'goal-fg2': '#d6d9dc', 'goal-mute': '#9aa0a6', 'goal-chip': '#242527', 'goal-line': '#292a2c', 'goal-link': '#8fb4ff', 'goal-link-hover': '#b5ccff',
  ...deptColours(false), 'dept-on': '#ffffff',
  'chart-ink': '#16181b', 'chart-rest': '#d5d8dc', 'chart-forecast': '#9aa0a6',
  ...AGING,
  ...PREVIEW,
  'shadow-tile': '0 1px 2px rgb(16 24 40 / 0.06)',
  'shadow-lift': '0 1px 2px rgb(16 24 40 / 0.07), 0 0 0 1px rgb(16 24 40 / 0.04)',
  'shadow-goal': '0 1px 2px rgb(16 24 40 / 0.10), 0 12px 28px -12px rgb(16 24 40 / 0.45)',
  'shadow-swipe': '-12px 0 28px rgb(16 24 40 / 0.18)',
  'shadow-paper': '0 1px 2px rgb(16 24 40 / 0.08), 0 10px 24px -8px rgb(16 24 40 / 0.22)',
};
const V2_DARK: Record<string, string> = {
  'line-soft': '#222427', wash: '#232528', inner: '#1d1f21', desk: '#1d1f1e', 'btn-line': '#3a3e43', dash: '#5f646b', 'receipt-line': '#2c3a5c', 'link-hover': '#b5ccff',
  selected: '#eceef0', 'on-selected': '#111214', 'count-on-selected': '#c9cbcd',
  accent: '#2fb67c', 'accent-ink': '#0b0d0e', 'accent-soft': '#1b312a', 'accent-text': '#2fb67c', 'accent-line': '#1f4f3c',
  'wait-ring': '#f2a93b', 'wait-soft': '#362c1f', 'wait-strong': '#e5a54b', 'fail-ring': '#f04438', 'fail-soft': '#3a1f1f', 'fail-line': '#6e2a26',
  'goal-bg': '#1f2124', 'goal-track': '#363a3f', 'goal-fg': '#ffffff', 'goal-fg2': '#d6d9dc', 'goal-mute': '#a3a9af', 'goal-chip': '#313336', 'goal-line': '#35373a', 'goal-link': '#8fb4ff', 'goal-link-hover': '#b5ccff',
  ...deptColours(true), 'dept-on': '#111214',
  'chart-ink': '#eceef0', 'chart-rest': '#4a4f56', 'chart-forecast': '#7d838a',
  ...AGING,
  ...PREVIEW,
  'shadow-tile': '0 1px 2px rgb(0 0 0 / 0.4)',
  'shadow-lift': '0 0 0 1px #2a2d31',
  'shadow-goal': '0 0 0 1px #2a2d31',
  'shadow-swipe': '-12px 0 28px rgb(0 0 0 / 0.5)',
  'shadow-paper': '0 0 0 1px #2a2d31',
};
/** The same in both themes, so they are set once in :root and never in a dark block. */
const THEME_INVARIANT = (name: string) => ['accent', 'accent-ink', 'wait-ring', 'fail-ring', ...Object.keys(AGING)].includes(name) || name.startsWith('pv-');
const isColour = (value: string) => /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/.test(value);

/** Type, shape and spacing of the w3 plan's second table. */
const V2_SIZES: Record<string, string> = {
  'text-hello': '24px', 'text-section': '19px', 'text-tile': '16px',
  'text-title': '28px', 'text-row': '15px', 'text-body': '14px', 'text-read': '13px', 'text-label': '12px',
  'fig-goal': '40px', 'fig-goal-phone': '30px', 'fig-pct': '32px', 'fig-stat': '30px', 'fig-hero': '24px', 'fig-tile': '20px', 'fig-dept': '17px',
  'r-tile': '16px', 'r-card': '12px', 'r-chip': '999px',
  'r-button-sm': '9px', 'r-button': '10px', 'r-button-lg': '12px', 'r-button-xl': '14px',
  'av-24': '24px', 'av-28': '28px', 'av-32': '32px', 'av-36': '36px', 'av-40': '40px', 'av-52': '52px', 'av-60': '60px',
  'control-sm': '30px', control: '36px', target: '44px', 'control-xl': '48px',
  'gap-grid': '16px', 'gap-cards': '12px', 'gap-section': '32px',
  'pad-tile': '20px', 'pad-tile-compact': '16px', 'pad-panel': '18px', 'pad-card': '14px',
  gutter: '32px', 'gutter-phone': '16px', 'page-max': '984px', panel: '440px', 'top-bar': '56px', tabs: '56px',
  radius: '6px', rail: '232px',
};

describe('Ink v2 tokens', () => {
  const css = read('../src/tokens/tokens.css');
  const [root] = blocks(css, /^:root$/);
  const media = blocks(css, /^:root:not\(\[data-theme="light"\]\)$/)[0]!;
  const forced = blocks(css, /^:root\[data-theme="dark"\]$/)[0]!;

  it('tokens.css holds exactly one light block, one of each dark block and the bare light switch, and nothing else', () => {
    const selectors = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{[^{}]*\}/g)].map((m) => m[1]!.replace(/@media \(prefers-color-scheme: dark\)\s*\{/, '').trim());
    expect(selectors).toEqual([':root', ':root:not([data-theme="light"])', ':root[data-theme="dark"]', ':root[data-theme="light"]']);
    expect(blocks(css, /^:root$/)).toHaveLength(1);
    expect(blocks(css, /^:root\[data-theme="light"\]$/)[0]).toEqual({ 'color-scheme': 'light' });
  });

  it('the accent is Jade #2fb67c, with near-black ink on it', () => {
    expect(root!['--accent']).toBe('#2fb67c');
    expect(root!['--accent-ink']).toBe('#0b0d0e');
  });

  it('light colours are exactly the table values', () => {
    expect(colours(root!, V2_LIGHT)).toEqual(V2_LIGHT);
  });

  it('dark colours are exactly the table values, the same under prefers-color-scheme and data-theme=dark', () => {
    const dark = Object.fromEntries(Object.entries(V2_DARK).filter(([k]) => !THEME_INVARIANT(k)));
    expect(colours(media, dark)).toEqual(dark);
    expect(colours(forced, dark)).toEqual(dark);
    expect(media).toEqual(forced);
  });

  it('theme-invariant colours are set once, in :root, and are the same in the table for both themes', () => {
    const invariant = Object.keys(V2_LIGHT).filter(THEME_INVARIANT);
    expect(invariant.length).toBeGreaterThan(8);
    for (const name of invariant) {
      expect(V2_DARK[name], name).toBe(V2_LIGHT[name]);
      expect(media[`--${name}`], name).toBeUndefined();
      expect(forced[`--${name}`], name).toBeUndefined();
    }
  });

  it('every colour token in :root has a value in both dark blocks, except the theme-invariant list', () => {
    const named = Object.entries(root!).filter(([k, v]) => k.startsWith('--') && isColour(v)).map(([k]) => k.slice(2));
    expect(named.length).toBeGreaterThan(70);
    for (const name of named.filter((n) => !THEME_INVARIANT(n))) {
      expect(media[`--${name}`], `--${name} under prefers-color-scheme: dark`).toBeDefined();
      expect(forced[`--${name}`], `--${name} under data-theme=dark`).toBeDefined();
    }
  });

  it('every --text-* and --fig-* is at least 12 px, and type, shape and spacing hold the table values', () => {
    const type = Object.entries(root!).filter(([k]) => k.startsWith('--text-') || k.startsWith('--fig-'));
    expect(type.length).toBeGreaterThanOrEqual(16);
    for (const [k, v] of type) {
      expect(v, k).toMatch(/^\d+px$/);
      expect(Number.parseFloat(v), k).toBeGreaterThanOrEqual(12);
    }
    expect(colours(root!, V2_SIZES)).toEqual(V2_SIZES);
    for (const [k, v] of Object.entries(root!)) if (k.startsWith('--sp-')) expect(Number.parseFloat(v) % 4, k).toBe(0);
  });

  it('a ring has a ground by default, the surface, which tiles, inner cards and panels override', () => {
    expect(root!['--ring-ground']).toBe('var(--surface)');
  });
});
