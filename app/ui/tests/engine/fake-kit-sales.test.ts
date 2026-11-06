// Chausar's sales fake follows the public proposal request and price receipt, including the engine's refusals.
// Written for Chausar; no external code or source used.
import { describe, expect, it } from 'vitest';
import { FakeKitSalesDesk } from '../../src/engine/fake-kit-sales';
import { BLUEPRINTS } from '../../src/engine/fixtures-business';
import { FakeBusinessDesk } from '../../src/engine/fake-business';
import { FakeEngine } from '../../src/engine/fake';
import type { W4DeskHost } from '../../src/engine/fake-w4';
import type { QueueRow, ReceiptLite, SalesProposalView } from '../../src/engine/types';

function salesDesk() {
  let rows: QueueRow[] = [];
  const host: W4DeskHost = {
    current: () => 'lumen', now: () => '2026-10-27T10:00:00.000Z', hosted: () => false, emit: () => {},
    rows: () => rows, setRows: (value) => { rows = value; }, digest: (value) => JSON.stringify(value),
    ask: (method) => {
      if (method === 'venture.blueprint.get') return BLUEPRINTS.lumen;
      if (method === 'venture.client.list') return [{ id: 'client', name: 'Client', email: null }];
      if (method === 'venture.order.list') return [];
      if (method === 'venture.price.quote') return { id: 'receipt', figures: [{ key: 'total', display: 'INR 15,000.00' }], totalMinor: '1500000', explanation: 'The agreed price.' };
      return null;
    },
  };
  return new FakeKitSalesDesk(host);
}

const codeOf = (fn: () => unknown) => {
  try { fn(); } catch (error) { return (error as { code?: string }).code; }
  return 'none';
};

describe('sales fake pilot terms match the engine', () => {
  it.each([
    { ownerHours: -1 }, { ownerHours: 1.5 }, { ownerHours: 61 }, { clientHours: -1 },
    { startsOn: '2026-02-30' }, { startsOn: 'tomorrow' }, { startsOn: 42 },
    { measure: { unexpected: 'value' } }, { measure: { by: '2026-02-30' } },
    { measure: { target: 10 } }, { measure: [] }, { measure: null },
    { hypothesis: 3 }, { hypothesis: 'x' }, { hypothesis: 'x'.repeat(201) },
    { reference: 'yes' }, { weeks: '2' }, { ownerHours: null },
  ])('refuses malformed agreed terms %j', (pilot) => {
    expect(codeOf(() => salesDesk().request('venture.salesProposal.draft', { clientId: 'client', offerId: 'offer_sponsor', pilot }))).toBe('INVALID_VENTURE_REQUEST');
  });

  it('preserves complete valid agreed terms and the paid pilot placeholders', () => {
    const proposal = salesDesk().request('venture.salesProposal.draft', {
      clientId: 'client', offerId: 'offer_sponsor',
      pilot: { startsOn: '2026-11-02', weeks: 2, hypothesis: 'Less admin', measure: { what: 'Time saved', target: '2 hours', by: '2026-11-16' }, ownerHours: 0, clientHours: 1, reference: false },
    }) as SalesProposalView;
    const lines = proposal.sections.find((section) => section.id === 'roadmap')!.lines;
    expect(lines).toContain('A paid pilot of Sponsor slot for 2 weeks, from 2026-11-02 to 2026-11-16.');
    expect(lines).toContain('Time needed: 1 hour a week from you, 0 hours a week from us.');
    expect(lines).toContain('You asked us not to mention you as a client.');
  });
});
it('proposal investment is the quoted total, including default quantity and sample tax', () => {
  let rows: QueueRow[] = [];
  let seq = 0;
  const business = new FakeBusinessDesk({
    current: () => 'ledgerline', businessName: () => 'Ledgerline', now: () => '2026-10-27T10:00:00.000Z',
    receiptId: () => `receipt-${++seq}`, rows: () => rows, setRows: (value) => { rows = value; },
    digest: (value) => JSON.stringify(value), settle: () => {}, emit: () => {}, business: () => null, deviceKeys: () => false,
  });
  const plan = structuredClone(BLUEPRINTS.ledgerline!);
  plan.blueprint.offers[0]!.pricing.defaultQuantity = '2';
  business.putBlueprint('ledgerline', plan);
  const sales = new FakeKitSalesDesk({
    current: () => 'ledgerline', now: () => '2026-10-27T10:00:00.000Z', hosted: () => false, emit: () => {},
    rows: () => rows, setRows: (value) => { rows = value; }, digest: (value) => JSON.stringify(value),
    ask: (method, params) => method === 'venture.client.list' ? [{ id: 'client', name: 'Client', email: null }]
      : method === 'venture.order.list' ? [] : business.request(method, params),
  });
  const result = sales.request('venture.salesProposal.draft', { clientId: 'client', offerId: 'offer_books' }) as SalesProposalView;
  expect(result.investment[0]).toMatchObject({ totalMinor: '3776000', display: '\u20b937,760.00' });
  const receipt = business.receipt(result.investment[0]!.kind === 'price' ? result.investment[0]!.receiptId : '') as ReceiptLite;
  expect(receipt).toMatchObject({ totalMinor: '3776000' });
  expect(receipt.figures.find(figure => figure.key === 'unit')?.display).toBe('\u20b916,000.00');
  expect(receipt.figures.find(figure => figure.key === 'subtotal')?.display).toBe('\u20b932,000.00');
  expect(receipt.figures.find(figure => figure.key === 'cgst')?.display).toBe('\u20b92,880.00');
});
it('Forget removes proposals for the person, their client, and proposals whose words mention them', async () => {
  const engine = new FakeEngine();
  const person = await engine.request('venture.salesProposal.draft', { personId: 'person_pooja', offerId: 'offer_sponsor' }) as SalesProposalView;
  const client = await engine.request('venture.salesProposal.draft', { clientId: 'c-nimbus', offerId: 'offer_sponsor' }) as SalesProposalView;
  const other = await engine.request('venture.client.add', { name: 'Another shop', note: 'Pooja Nair asked us to prepare this.' }) as { id: string };
  const mentions = await engine.request('venture.salesProposal.draft', { clientId: other.id, offerId: 'offer_sponsor' }) as SalesProposalView;
  const safe = await engine.request('venture.salesProposal.draft', { personId: 'person_tara', offerId: 'offer_sponsor' }) as SalesProposalView;
  await engine.request('venture.network.forget', { id: 'person_pooja' });
  for (const proposal of [person, client, mentions]) {
    await expect(engine.request('venture.salesProposal.get', { id: proposal.id })).rejects.toMatchObject({ code: 'PROPOSAL_NOT_FOUND' });
  }
  expect(await engine.request('venture.salesProposal.get', { id: safe.id })).toMatchObject({ id: safe.id });
  const queue = await engine.request('venture.queue.list', {}) as { rows: QueueRow[] };
  expect(queue.rows.filter(row => row.id.startsWith('salesprop:')).map(row => row.viewRef?.id)).toEqual([safe.id]);
});

it('import Undo removes its person proposals only after the preview is confirmed', async () => {
  const engine = new FakeEngine();
  const imported = await engine.request('venture.network.import', {
    kind: 'vcard', name: 'proposal-contact.vcf',
    text: 'BEGIN:VCARD\nVERSION:3.0\nFN:Veena Bose\nEMAIL:veena@proposal.example\nEND:VCARD',
  }) as { import: { id: string } };
  const people = await engine.request('venture.network.people', { query: 'Veena' }) as { people: { id: string }[] };
  const proposal = await engine.request('venture.salesProposal.draft', { personId: people.people[0]!.id, offerId: 'offer_sponsor' }) as SalesProposalView;
  await engine.request('venture.network.importUndo', { importId: imported.import.id, preview: true });
  expect(await engine.request('venture.salesProposal.get', { id: proposal.id })).toMatchObject({ id: proposal.id });
  await engine.request('venture.network.importUndo', { importId: imported.import.id });
  await expect(engine.request('venture.salesProposal.get', { id: proposal.id })).rejects.toMatchObject({ code: 'PROPOSAL_NOT_FOUND' });
});
it('an explicit null quote quantity is refused rather than replaced by the default', async () => {
  await expect(new FakeEngine().request('venture.price.quote', { offerId: 'offer_sponsor', quantity: null })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
});