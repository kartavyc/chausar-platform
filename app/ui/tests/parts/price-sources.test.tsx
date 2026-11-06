import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PriceGuideList, PriceRange, PriceSources } from '../../src/parts/PriceSources';
import { GalleryTile } from '../../src/parts/Gallery';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { wayData } from '../../src/places/onboarding/ways';
import type { BlueprintViewLite, WaysView } from '../../src/engine/types';
import { priceGuide, priceGuideForPlaybook } from '../../../../platform/runtime/venture/core/price-ranges';
import { assertFiguresProved } from '../helpers/ink-rules';

/**
 * W6 6C3 (D17): price ranges with sources. A sourced range shows its words with an (i) button; the popover lists the
 * sources (publisher and title, each a link), the date checked and "Your price is yours to set." A profession with no
 * credible source says "No reliable data". The guide is information only: it never fills in or changes a price.
 */
describe('PriceSources', () => {
  it('a sourced range shows its sources, the date checked and that the price is the owner\'s', () => {
    const guide = priceGuide('chartered-accountant');
    const range = guide.ranges[0]!;
    const { container } = render(<PriceRange guide={guide} range={range} />);
    const line = container.querySelector('[data-sourced-range]')!;
    expect(line.textContent).toContain('₹4,000 to ₹8,000 or more');
    const info = within(line as HTMLElement).getByRole('button', { name: 'Where this range comes from' });
    expect(info.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Your price is yours to set.', { exact: false })).toBeNull();
    fireEvent.click(info);
    expect(info.getAttribute('aria-expanded')).toBe('true');
    const pop = document.getElementById(info.getAttribute('aria-controls')!)!;
    expect(within(pop).getByText('Where this range comes from')).toBeTruthy();
    const link = within(pop).getByRole('link', { name: /ICAI Committee for Members in Practice/ });
    expect(link.getAttribute('href')).toBe(range.sources[0]!.url);
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(pop.textContent).toContain('Checked 1 Nov 2026. Your price is yours to set.');
    expect(pop.textContent).toContain(range.note);
    // A sourced range is proved by its sources, the way a receipt proves a figure.
    expect(() => assertFiguresProved(container)).not.toThrow();
    expect(pop.textContent).toContain(range.label);
    // The button is told apart by the range it explains, and Escape closes the popover and returns focus to it.
    expect(document.getElementById(info.getAttribute('aria-describedby')!)!.textContent).toBe(range.label);
    fireEvent.keyDown(link, { key: 'Escape' });
    expect(info.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(info);
  });

  it('a profession with no credible source says "No reliable data", with the reason and no amount', () => {
    const guide = priceGuide('video-editor');
    const { container } = render(<PriceGuideList guide={guide} />);
    expect(container.textContent).toContain('No reliable data');
    expect(container.textContent).not.toMatch(/[₹$]\s?\d/);
    const info = screen.getByRole('button', { name: 'Why there is no range' });
    fireEvent.click(info);
    const pop = document.getElementById(info.getAttribute('aria-controls')!)!;
    expect(pop.textContent).toContain(guide.reason!);
    expect(pop.textContent).toContain('Checked 1 Nov 2026. Your price is yours to set.');
    expect(within(pop).queryByRole('link')).toBeNull();
  });

  it('lists every range of a sourced profession, each with its own sources and city', () => {
    const guide = priceGuide('school-teacher');
    const { container } = render(<PriceGuideList guide={guide} />);
    expect(container.querySelectorAll('[data-sourced-range]')).toHaveLength(2);
    expect(container.textContent).toContain('Bengaluru');
    expect(screen.getAllByRole('button', { name: 'Where this range comes from' })).toHaveLength(2);
    expect(() => assertFiguresProved(container)).not.toThrow();
  });

  it('the (i) alone, without a guide range, refuses nothing and shows the guide\'s line', () => {
    render(<PriceSources guide={priceGuide('travel-agent')} />);
    fireEvent.click(screen.getByRole('button', { name: 'Why there is no range' }));
    expect(screen.getByText('No reliable data', { selector: 'span' })).toBeTruthy();
  });
});

describe('Gallery: a sourced range replaces the model estimate only where it fits the way', () => {
  it('bookkeeping shows its sourced monthly range with the (i); the CA way keeps its estimate with ICAI one fold away; YouTube says no data', async () => {
    const view = (await new FakeEngine().request('venture.playbooks.list', {})) as WaysView;
    const books = wayData(view.ways.find((way) => way.id === 'bookkeeping-cfo')!, 'en', view.categories);
    const { container, unmount } = render(<GalleryTile way={books} onStart={() => {}} />);
    const pay = container.querySelector('[data-sourced-range]')!;
    expect(pay.textContent).toContain('₹499 to ₹15,000');
    expect(pay.textContent).toContain('Usual pay (per month)');
    expect(within(pay as HTMLElement).queryByText('model estimate')).toBeNull();
    expect(within(pay as HTMLElement).getByRole('button', { name: 'Where this range comes from' })).toBeTruthy();
    expect(() => assertFiguresProved(container)).not.toThrow();
    unmount();
    // ICAI's figures price single tasks, not the CA way's monthly service: the estimate stays, the sources wait in the fold.
    const ca = wayData(view.ways.find((way) => way.id === 'ca-firm')!, 'en', view.categories);
    const caTile = render(<GalleryTile way={ca} onStart={() => {}} />);
    expect(caTile.container.querySelector('[data-figure-group] [data-estimate]')?.textContent).toBe('model estimate');
    const fold = caTile.container.querySelector('details[data-way-needs]')!;
    expect(fold.querySelectorAll('[data-sourced-range]')).toHaveLength(2);
    expect(fold.textContent).toContain('₹4,000 to ₹8,000 or more');
    expect(() => assertFiguresProved(caTile.container)).not.toThrow();
    caTile.unmount();
    const youtube = wayData(view.ways.find((way) => way.id === 'youtube')!, 'en', view.categories);
    const tile = render(<GalleryTile way={youtube} onStart={() => {}} />);
    expect(tile.container.querySelector('[data-sourced-range]')).toBeNull();
    expect(within(tile.container).getByText('model estimate')).toBeTruthy();
    expect(tile.container.textContent).toContain('No reliable data');
  });
});

describe('Prices: the plan\'s profession guide sits beside the offers and never sets a price', () => {
  it('the fake answers the plan with the engine\'s own guide for its playbook', async () => {
    const engine = new FakeEngine();
    await engine.request('workspace.open', { folder: 'ledgerline' });
    const view = (await engine.request('venture.blueprint.get', {})) as BlueprintViewLite;
    expect(view.priceGuide).toEqual(priceGuideForPlaybook('ca-firm'));
    const youtube = (await new FakeEngine().request('venture.blueprint.get', {})) as BlueprintViewLite;
    expect(youtube.priceGuide).toEqual(priceGuideForPlaybook('youtube'));
  });

  it('shows ICAI\'s ranges on Prices; opening the sources leaves the owner\'s price field and price as they were', async () => {
    const engine = new FakeEngine();
    await engine.request('workspace.open', { folder: 'ledgerline' });
    const before = (await engine.request('venture.blueprint.get', {})) as BlueprintViewLite;
    window.location.hash = '#/business/prices';
    render(<App client={createFakeClient(engine)} language="en" />);
    // One fold away, as the receipt's working is: open it to read the ranges.
    const guide = (await screen.findByText('Price ranges', { selector: 'summary' })).closest('details')!;
    expect(guide.open).toBe(false);
    await act(async () => { fireEvent.click(within(guide).getByText('Price ranges')); });
    expect(guide.open).toBe(true);
    expect(guide.textContent).toContain('₹4,000 to ₹8,000 or more');
    await act(async () => { fireEvent.click(within(guide).getAllByRole('button', { name: 'Where this range comes from' })[0]!); });
    expect(guide.textContent).toContain('Your price is yours to set.');
    const books = (await screen.findByText('Monthly books', { selector: '[data-offer-name]' })).closest('li')!;
    expect((within(books).getByLabelText('New price') as HTMLInputElement).value).toBe('');
    const after = (await engine.request('venture.blueprint.get', {})) as BlueprintViewLite;
    expect(after.blueprint.offers.map((offer) => offer.pricing)).toEqual(before.blueprint.offers.map((offer) => offer.pricing));
    await waitFor(() => expect(() => assertFiguresProved(screen.getByRole('main'))).not.toThrow());
  });
});
