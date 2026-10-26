import { describe, expect, it } from 'vitest';
import { FakeEngine } from '../../src/engine/fake';
import type { AcrossMoneyView, AcrossRunsView, ReceiptLite } from '../../src/engine/types';

/**
 * The fake engine answers venture.money.across and venture.runs.across as the engine does (money/across.ts and
 * views/across.ts, 4J6): the open business "Open now.", Ledgerline from what Chausar saved at 18:00 on 22 Oct in Kolkata,
 * Sitara Events locked with a passphrase, each figure with a receipt, and a total in one currency.
 */
const NOW = '2026-10-23T10:00:00.000Z';
const engineAt = (hosted = false) => new FakeEngine({ now: () => NOW, ...(hosted ? { hosted: true } : {}) });
const ask = <T>(engine: FakeEngine, method: string, params: Record<string, unknown> = {}) => engine.request(method, params) as Promise<T>;

describe('fake engine: money and runs across businesses (4J6)', () => {
  it('money: the open business, the saved one as of when, the locked one with nothing, and the total with its receipt', async () => {
    const engine = engineAt();
    const view = await ask<AcrossMoneyView>(engine, 'venture.money.across');
    const [open, ledger, sitara] = view.businesses;
    expect([open!.businessId, open!.line, open!.lineKey, open!.invoiced]).toEqual(['lumen', 'Open now.', 'open', '₹1,12,400.00']);
    expect([ledger!.line, ledger!.lineKey, ledger!.asOf, ledger!.invoiced]).toEqual(['As of 22 Oct 2026, 18:00, when you last opened it.', 'as-of', '2026-10-22T12:30:00.000Z', '₹26,200.00']);
    expect([sitara!.locked, sitara!.lineKey, sitara!.invoiced, sitara!.line]).toEqual([true, 'locked', null, 'Sitara Events is locked with a passphrase, so Chausar shows nothing about it until you open it.']);
    // The open business reads its own ledger (4J20): 11240000 + 2620000 = 13860000.
    expect(view.total?.display).toBe('₹1,38,600.00');
    expect(view.line).toBe('Invoiced in October 2026 across 2 businesses. Not counted: Sitara Events (locked).');
    expect([view.lineKey, view.month, view.counted, view.currencies]).toEqual(['counted', '2026-10', 2, ['INR']]);
    expect(view.notCounted).toEqual([{ businessId: 'sitara', name: 'Sitara Events', why: 'locked', month: null }]);
    const total = await ask<ReceiptLite>(engine, 'venture.receipt.get', { id: view.total!.receiptId });
    expect(total.figures[0]!.display).toBe('₹1,38,600.00');
    const saved = await ask<ReceiptLite>(engine, 'venture.receipt.get', { id: ledger!.receipts!.invoiced! });
    expect(saved.explanation).toBe('1 saved figure: Ledgerline, as saved on 22 Oct 2026, 18:00 ₹26,200.00. Added together: ₹26,200.00.');
    await expect(ask(engine, 'venture.money.across', { scope: 'all' })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
  });

  it('runs: counts with their totals; the locked one shows none; the hosted app shows the open business only', async () => {
    const view = await ask<AcrossRunsView>(engineAt(), 'venture.runs.across');
    const [open, ledger, sitara] = view.businesses;
    expect([open!.working, ledger!.waiting, sitara!.working, sitara!.lineKey]).toEqual([1, 1, null, 'locked']);
    expect(view.totals).toEqual({ working: 1, waiting: 3, stopped: 0, needsYou: open!.needsYou! + 1, businesses: 2 });
    expect(view.line).toBe(`1 running, 3 waiting and ${open!.needsYou! + 1} need you across 2 businesses. Not counted: Sitara Events (locked).`);
    const hosted = await ask<AcrossMoneyView>(engineAt(true), 'venture.money.across');
    expect(hosted.businesses).toHaveLength(1);
  });
});
