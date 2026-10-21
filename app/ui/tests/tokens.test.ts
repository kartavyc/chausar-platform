import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string) => readFileSync(join(import.meta.dirname, path), 'utf8');

/** Spec section 5, exact values. */
const LIGHT = { bg: '#fbfbfa', surface: '#ffffff', fg: '#16181b', fg2: '#3d4146', mute: '#5c6168', dim: '#71767d', line: '#e3e5e8', hover: '#eceef0', link: '#2f5bd3', wait: '#b45309', fail: '#b42318' };
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
