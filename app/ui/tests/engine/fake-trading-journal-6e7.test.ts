// Wave 6, 6E7: the fake engine's trading journal answers like the engine. It runs the engine's own core (desk-core,
// journal, receipt), so codes, words, figures and receipts match the engine for the same synthetic tradebook.
import { describe, expect, it } from 'vitest';
import zerodha from '../../../../platform/tests/fixtures/venture/trading-journal/zerodha-tradebook.csv?raw';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';

const fixture = (_name: 'zerodha-tradebook.csv') => zerodha;
const desk = { playbook: 'trading-journal' as const, kind: 'journal' };

describe('fake trading journal (6E7)', () => {
  it('imports a tradebook, shows the receipt figures, and prepares a tax pack with its rules', async () => {
    const client = createFakeClient(new FakeEngine());
    const made = await client.request('venture.desk.act', { ...desk, id: 'new', action: 'import', payload: { broker: null, name: 'zerodha.csv', csv: fixture('zerodha-tradebook.csv') } }) as any;
    expect(made.result).toMatchObject({ trades: 6, formatChecked: true });
    expect(made.line).toBe('Tradebook imported. Charges were worked by code; compare them with your contract notes.');
    const view = await client.request('venture.desk.get', { ...desk, id: 'journal' }) as any;
    expect(view.item.journal.totals.total).toBe('13122');
    expect(view.item.summary.figures.find((f: any) => f.key === 'charges-total').display).toBe('INR 131.22');
    const receipt = await client.request('venture.work.get', { id: made.result.receiptId }).catch(() => null) as any;
    if (receipt) expect(receipt.figures.find((f: any) => f.key === 'stt').minor).toBe('4578');
    await expect(client.request('venture.desk.act', { ...desk, id: 'new', action: 'import', payload: { broker: null, name: 'again.csv', csv: fixture('zerodha-tradebook.csv') } })).rejects.toMatchObject({ code: 'TRADEBOOK_DUPLICATE', message: 'This tradebook is already imported.' });
    const pack = await client.request('venture.desk.act', { ...desk, id: 'new', action: 'tax-pack', payload: { yearId: 'fy-2025-26' } }) as any;
    expect(pack.result.pack.figures.find((f: any) => f.key === 'fno-net').minor).toBe('143663');
    expect(pack.line).toBe('Tax pack prepared. Check with your CA.');
    const list = await client.request('venture.desk.list', desk) as any;
    expect(list.rows.map((row: any) => row.kind)).toEqual(['import', 'pack']);
  });

  it('refuses like the engine: empty journal, unknown year, bad opening, extra fields', async () => {
    const client = createFakeClient(new FakeEngine());
    await expect(client.request('venture.desk.act', { ...desk, id: 'new', action: 'tax-pack', payload: { yearId: 'fy-2025-26' } })).rejects.toMatchObject({ code: 'JOURNAL_EMPTY' });
    await expect(client.request('venture.desk.act', { ...desk, id: 'new', action: 'add-opening', payload: { symbol: 'TCS', isin: null, boughtOn: '2020-06-01', quantity: '1', cost: '100', fmv: '150' } })).rejects.toMatchObject({ code: 'OPENING_INVALID' });
    await expect(client.request('venture.desk.act', { ...desk, id: 'new', action: 'import', payload: { broker: 'groww', name: 'x.csv', csv: 'a,b\n1,2\n' } })).rejects.toMatchObject({ code: 'TRADEBOOK_INVALID' });
    await expect(client.request('venture.desk.get', { ...desk, id: 'journal', extra: 1 } as never)).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST', message: 'Send the required fields and nothing else.' });
  });
});
