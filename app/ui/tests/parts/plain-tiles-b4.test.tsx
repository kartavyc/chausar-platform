import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLACE_TILES, Panel, PlaceTiles, Tile } from '../../src/parts/Tile';
import { TileSection } from '../../src/places/business/shared';
import { TextProvider } from '../../src/text';
import { rule } from '../helpers/css';

/**
 * One-shot B4 task 1: plain sections, no boxes in boxes. A plain tile keeps its head and its words and draws no
 * border, no shadow and no surface fill. Business pages are plain. Today, Team and Money follow one constant,
 * PLACE_TILES, so the founder can compare plain tiles with D's tiles by changing one line.
 */
describe('plain tiles (B4 task 1)', () => {
  it('<Tile plain> carries data-plain, and the CSS gives it no border, no shadow and no fill', () => {
    const { container } = render(<Tile plain as="section" label="Prices">words</Tile>);
    const tile = container.firstElementChild as HTMLElement;
    expect(tile.hasAttribute('data-plain')).toBe(true);
    const css = rule('Tile.module.css', '.tile[data-plain]');
    expect(css).toMatch(/border:\s*0/);
    expect(css).toMatch(/box-shadow:\s*none/);
    expect(css).toMatch(/background:\s*none/);
    expect(css).toMatch(/--ring-ground:\s*var\(--bg\)/);
  });

  it('a tile is D by default, outside any place that asks for plain tiles', () => {
    const { container } = render(<Tile>words</Tile>);
    expect((container.firstElementChild as HTMLElement).hasAttribute('data-plain')).toBe(false);
  });

  it('every business page section (TileSection) renders plain', () => {
    render(<TextProvider language="en"><TileSection title="Your prices">words</TileSection></TextProvider>);
    expect(screen.getByRole('region', { name: 'Your prices' }).hasAttribute('data-plain')).toBe(true);
  });

  it('inside PlaceTiles a tile follows PLACE_TILES, and a tile can still ask for its own look', () => {
    const { container } = render(
      <PlaceTiles>
        <Tile>follows</Tile>
        <Tile plain={false}>stays D</Tile>
        <Panel dept="prod">a department</Panel>
      </PlaceTiles>,
    );
    const [follows, own, panel] = [...container.children] as HTMLElement[];
    expect(follows!.hasAttribute('data-plain')).toBe(PLACE_TILES === 'plain');
    expect(own!.hasAttribute('data-plain')).toBe(false);
    expect(panel!.hasAttribute('data-plain')).toBe(PLACE_TILES === 'plain');
  });

  it('the default is plain tiles; D tiles stay one line away', () => {
    expect(PLACE_TILES).toBe('plain');
  });

  it('a plain department panel drops its tint, line and shadow', () => {
    const css = rule('Tile.module.css', '.panel[data-plain]');
    expect(css).toMatch(/background:\s*none/);
    expect(css).toMatch(/border-color:\s*transparent/);
    expect(css).toMatch(/box-shadow:\s*none/);
    expect(css).toMatch(/--ring-ground:\s*var\(--bg\)/);
  });

  it('the tabs have no outer frame', () => {
    const seg = rule('Tabs.module.css', '.tabs');
    expect(seg).not.toMatch(/border:\s*var\(--hair\)/);
    expect(seg).not.toMatch(/box-shadow:\s*var/);
    expect(seg).not.toMatch(/background:\s*var\(--surface\)/);
  });

  it('a split of a short card and a long list no longer stretches the short one', () => {
    const css = readFileSync(join(import.meta.dirname, '../../src/places/business/Business.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/align-items:\s*stretch/);
  });
});

describe('quiet lines under the header (B4 task 1)', () => {
  const shellCss = (file: string, selector: string) => {
    const css = readFileSync(join(import.meta.dirname, '../../src/shell', file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const at = css.indexOf(`${selector} {`);
    if (at < 0) throw new Error(`no ${selector} in ${file}`);
    return css.slice(at, css.indexOf('}', at));
  };

  it('the storage and paused lines set no border and no background', () => {
    const notice = shellCss('StorageNotice.module.css', '.notice');
    expect(notice).not.toMatch(/border:/);
    expect(notice).not.toMatch(/background:/);
  });

  it('the trial line sets no border and no background', () => {
    const banner = shellCss('TrialBanner.module.css', '.banner');
    expect(banner).not.toMatch(/border:/);
    expect(banner).not.toMatch(/background:/);
  });
});
