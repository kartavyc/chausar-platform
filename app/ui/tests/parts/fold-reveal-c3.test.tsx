import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { Reveal } from '../../src/parts/RevealBlock';
import { rule } from '../helpers/css';

/**
 * One-shot C3 task 7: folds ease their height and things open in place. tokens/motion.css gives every <details> the
 * height and fade (B4's Fold is a <details>, so it has it too) and turns a marked chevron; a Reveal keeps its child
 * while it closes. Nothing else transitions a height.
 */
const src = join(import.meta.dirname, '../../src');
const real = window.getComputedStyle.bind(window);
beforeEach(() => {
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element: Element, pseudo?: string | null) => {
    const style = real(element, pseudo);
    if (!(element instanceof HTMLElement) || !element.hasAttribute('data-open')) return style;
    return new Proxy(style, { get: (target, key) => { if (key === 'transitionDuration') return '140ms'; const value = Reflect.get(target, key) as unknown; return typeof value === 'function' ? value.bind(target) : value; } });
  });
});
afterEach(() => { delete document.documentElement.dataset.motion; });

function Holder({ open }: { open: boolean }) {
  return <Reveal open={open}><p>Inside</p></Reveal>;
}

describe('Reveal', () => {
  it('open at first render is simply there; closing keeps its child, inert, until transitionend', () => {
    const { rerender } = render(<Holder open />);
    const block = screen.getByText('Inside').closest<HTMLElement>('[data-open]')!;
    expect(block.dataset.open).toBe('true');
    rerender(<Holder open={false} />);
    expect(block.isConnected).toBe(true);
    expect(block.dataset.open).toBe('false');
    expect(block.hasAttribute('inert')).toBe(true);
    act(() => { fireEvent.transitionEnd(block); });
    expect(block.isConnected).toBe(false);
  });

  it('goes at once with animations off, and draws nothing while closed', () => {
    document.documentElement.dataset.motion = 'off';
    const { rerender } = render(<Holder open />);
    rerender(<Holder open={false} />);
    expect(screen.queryByText('Inside')).toBeNull();
  });

  it('its height moves through grid rows over the sheet time, and leaves on the exit time', () => {
    expect(rule('RevealBlock.module.css', '.reveal')).toMatch(/grid-template-rows var\(--t-sheet\)/);
    expect(rule('RevealBlock.module.css', ".reveal[data-open='false']")).toMatch(/transition-duration:\s*var\(--t-exit\)/);
  });
});

describe('folds', () => {
  const motion = readFileSync(join(src, 'tokens/motion.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  it('every <details> eases its content over the sheet time, from no height to auto, and a marked chevron turns', () => {
    expect(motion).toMatch(/details::details-content\s*\{[^}]*block-size:\s*0[^}]*transition:[^}]*block-size var\(--t-sheet\)/);
    expect(motion).toMatch(/content-visibility var\(--t-sheet\)[^;]*allow-discrete/);
    expect(motion).toMatch(/details\[open\]::details-content\s*\{[^}]*block-size:\s*auto/);
    expect(motion).toMatch(/details\[open\] > summary \[data-fold-chevron\]\s*\{[^}]*rotate\(90deg\)/);
    expect(readFileSync(join(src, 'tokens/tokens.css'), 'utf8')).toMatch(/interpolate-size:\s*allow-keywords/);
  });

  it('no height or max-height transition outside Reveal and the mini app frame', () => {
    const allowed = ['parts/RevealBlock.module.css', 'places/apps/Apps.module.css', 'parts/charts/Charts.module.css'];
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => { const path = join(dir, name); return statSync(path).isDirectory() ? walk(path) : [path]; });
    const found: string[] = [];
    for (const file of walk(src).filter((f) => f.endsWith('.css'))) {
      const name = relative(src, file).split(sep).join('/');
      if (allowed.includes(name)) continue;
      const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      if (/transition(?:-property)?:[^;}]*(?<![\w-])(?:max-)?height\b/.test(css)) found.push(name);
    }
    expect(found).toEqual([]);
  });
});
