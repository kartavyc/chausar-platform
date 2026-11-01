// Wave 6, 6E7: the trading journal on Work, against the fake engine (which runs the engine's own core). Charges and
// profit or loss are the engine's text with a receipt; the tax pack says check with your CA; Ink rules hold.
import { describe, expect, it } from 'vitest';
import csv from '../../../../platform/tests/fixtures/venture/trading-journal/zerodha-tradebook.csv?raw';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TextProvider } from '../../src/text';
import { EngineProvider } from '../../src/engine/context';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { TradingJournalDesk } from '../../src/places/work/desks/TradingJournalDesk';
import { deskReady } from '../../src/places/work/PlaybookDesk';
import { assertInkRules } from '../helpers/ink-rules';

describe('trading journal desk (6E7)', () => {
  it('is ready on Work', () => { expect(deskReady('trading-journal')).toBe(true); });

  it('imports a tradebook and shows each figure with its receipt, then a tax pack for the CA', async () => {
    const client = createFakeClient(new FakeEngine());
    const { container } = render(<TextProvider language="en"><EngineProvider client={client}><TradingJournalDesk /></EngineProvider></TextProvider>);
    expect(await screen.findByText(/Chausar never says what to trade/)).toBeTruthy();
    const file = new File([csv], 'zerodha.csv', { type: 'text/csv' });
    fireEvent.change(screen.getByLabelText('Tradebook CSV'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByText('INR 131.22')).toBeTruthy();
    expect(screen.getByText('All charges')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Prepare tax pack' }));
    await waitFor(() => expect(screen.getAllByText(/Check with your CA/).length).toBeGreaterThan(0));
    expect(screen.getAllByText('INR 1,436.63').length).toBeGreaterThan(0);
    assertInkRules(container);
  });
});
