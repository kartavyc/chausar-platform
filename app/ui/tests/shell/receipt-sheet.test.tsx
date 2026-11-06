import { describe, expect, it } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { assertFiguresProved, assertInkRules } from '../helpers/ink-rules';

/**
 * w3 3I: a receipt sheet IS the proof. Its figures are the receipt's own lines, plain DM Mono text with no receipt chip
 * of their own (a chip there would point at the sheet it sits in), so the sheet's root carries `data-receipt-sheet` and
 * the Ink rules helper lets money text sit inside it. Everything else on the page is checked as before.
 */

async function open(hash: string, before?: (engine: FakeEngine) => Promise<unknown>) {
  const engine = new FakeEngine();
  if (before) await before(engine);
  window.location.hash = hash;
  render(<App client={createFakeClient(engine)} language="en" />);
  const sheet = await screen.findByRole('complementary');
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  return sheet;
}

describe('the receipt sheet is the proof', () => {
  // C4 T27 (83.x1): under the figure, what was counted and over which dates.
  it('shows the basis line under the figure of a money sum; a receipt with no basis shows none', async () => {
    const sheet = await open('#/money?sheet=receipt:R-0402');
    await waitFor(() => expect(sheet.textContent).toContain('₹86,200'));
    const line = sheet.querySelector('[data-basis]');
    expect(line?.textContent).toBe('Counted: payments dated 1 to 31 Oct 2026');
    const figures = sheet.querySelector('dl')!;
    expect(figures.compareDocumentPosition(line!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    cleanup();
    const other = await open('#/today?sheet=receipt:R-0415');
    await waitFor(() => expect(other.textContent).toContain('₹15,000'));
    expect(other.querySelector('[data-basis]')).toBeNull();
  });

  it('marks the receipt sheet root, and the Ink rules pass on the whole page with it open', async () => {
    const sheet = await open('#/today?sheet=receipt:R-0415');
    await waitFor(() => expect(sheet.textContent).toContain('₹15,000'));
    expect(sheet.hasAttribute('data-receipt-sheet')).toBe(true);
    expect(sheet.matches('aside[data-sheet]')).toBe(true);
    assertInkRules(document.body);
  });

  it('marks the CA calculator receipt the same way, with its steps and the page behind it checked too', async () => {
    const sheet = await open('#/business/ca?sheet=ca-receipt:w-portal-sep', (engine) => engine.request('workspace.open', { folder: 'ledgerline' }));
    await waitFor(() => expect(sheet.querySelector('[data-rederived]')).not.toBeNull());
    expect(sheet.hasAttribute('data-receipt-sheet')).toBe(true);
    assertInkRules(document.body);
  });

  it('marks no other sheet: a run sheet is checked like the page', async () => {
    const sheet = await open('#/work?sheet=run:28');
    expect(sheet.hasAttribute('data-receipt-sheet')).toBe(false);
  });
});

describe('the helper exempts a receipt sheet and nothing more', () => {
  it('lets plain money text sit inside [data-receipt-sheet] and still fails it anywhere else', () => {
    render(
      <div>
        <aside data-receipt-sheet=""><dl><dt>Total</dt><dd className="mono">₹18,880</dd></dl></aside>
        <p data-outside="">Paid ₹18,880</p>
      </div>,
    );
    expect(() => assertInkRules(document.body)).toThrow(/Paid ₹18,880/);
    document.querySelector('[data-outside]')!.remove();
    expect(() => assertInkRules(document.body)).not.toThrow();
  });

  it('still checks a figure inside a receipt sheet: a bare data-ui-number there fails', () => {
    render(<aside data-receipt-sheet=""><span data-ui-number="">₹18,880</span></aside>);
    expect(() => assertFiguresProved(document.body)).toThrow(/not inside a \[data-figure\]/);
  });
});
