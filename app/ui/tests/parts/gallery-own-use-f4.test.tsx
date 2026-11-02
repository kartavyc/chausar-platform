import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { GalleryTile, type GalleryWay } from '../../src/parts/Gallery';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { wayData } from '../../src/places/onboarding/ways';
import type { WaysView } from '../../src/engine/types';
import { assertInkRules } from '../helpers/ink-rules';

/**
 * W6 founder follow-up F4 (2 November 2026): a desk the owner runs for themselves (the trading journal today) shows what
 * it saves the owner, the hours a month as a model estimate and what it keeps straight in words, never a "clients pay"
 * range. The engine sends `saves` in place of `clientsPay`; the fake engine answers the same.
 */
const OWN: GalleryWay = {
  id: 'trading-journal',
  name: 'Trading journal',
  line: 'Tradebooks become charges, profit or loss and a tax pack for your CA.',
  icon: 'receipt-text',
  category: 'Money and tax',
  hours: '1 to 4 h a week',
  youDo: 'Import tradebooks and share the pack with your CA.',
  team: { names: ['Writer'], line: 'Code works every charge; notes for your CA.' },
  saves: { range: '2 to 6 h a month', line: 'Charges, profit or loss and tax records kept straight for your CA.', source: 'Model estimate, not measured.' },
};

describe('F4: an own-use desk tile', () => {
  it('shows what it saves the owner as a model estimate, and no clients pay range', () => {
    const { container } = render(<GalleryTile way={OWN} onStart={() => {}} />);
    const tile = screen.getByRole('article', { name: 'Trading journal' });
    expect(within(tile).queryByText(/Clients usually pay/)).toBeNull();
    expect(container.textContent).not.toContain('₹');
    const label = within(tile).getByText('Saves you');
    const group = label.closest('[data-figure-group]') as HTMLElement;
    expect(group).not.toBeNull();
    expect(label.parentElement!.querySelector('[data-estimate]')!.textContent).toBe('model estimate');
    expect(within(group).getByText('2 to 6 h a month')).toBeTruthy();
    expect(container.querySelector('[data-receipt]')).toBeNull();
    // What it keeps straight and the estimate's basis are one fold away.
    const fold = tile.querySelector('details') as HTMLDetailsElement;
    expect(within(fold).getByText('Charges, profit or loss and tax records kept straight for your CA.')).toBeTruthy();
    expect(within(fold).getByText('Model estimate, not measured.')).toBeTruthy();
    assertInkRules(document.body);
  });

  it('the fake engine lists the trading journal with saves and no clientsPay, and the onboarding maps it onto the tile', async () => {
    const client = createFakeClient(new FakeEngine());
    const view = await client.request('venture.playbooks.list', {}) as WaysView;
    const journal = view.ways.find((way) => way.playbook === 'trading-journal')!;
    expect(journal.clientsPay).toBeUndefined();
    expect(journal.saves).toEqual({ text: '2 to 6 h a month', line: 'Charges, profit or loss and tax records kept straight for your CA.', estimate: true, source: expect.stringMatching(/^Model estimate/) });
    const tile = wayData(journal, 'en', view.categories);
    expect(tile.pay).toBeUndefined();
    expect(tile.saves).toEqual({ range: '2 to 6 h a month', line: journal.saves!.line, source: journal.saves!.source });
    for (const other of view.ways.filter((way) => way.playbook !== 'trading-journal')) {
      expect(other.saves, other.id).toBeUndefined();
      expect(wayData(other, 'en', view.categories).pay, other.id).toBeDefined();
    }
  });
});
