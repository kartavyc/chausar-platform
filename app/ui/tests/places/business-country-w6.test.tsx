import { expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';

const client = () => createFakeClient(new FakeEngine());
async function changeCountry(engine: ReturnType<typeof client>, countryCode: string) {
  return engine.request('venture.blueprint.update', { patch: { countryCode } } as never);
}
async function accept(engine: ReturnType<typeof client>, id: string) {
  const rows = await engine.request('venture.queue.list', {});
  const row = rows.rows.find(item => item.viewRef?.kind === 'plan' && item.viewRef.id === id)!;
  expect(row).toBeTruthy();
  return engine.request('venture.queue.decide', { id: row.id, digest: row.digest, action: 'approve', viewed: true });
}

it('country changes are a priced-again draft until the owner accepts the exact plan', async () => {
  const engine = client();
  const prior = await engine.request('venture.blueprint.get', {});
  const draft = await changeCountry(engine, 'US');
  expect((draft.blueprint as any).country.code).toBe('US');
  expect(draft.blueprint.backOffice.currency).toBe('USD');
  expect(draft.blueprint.backOffice.taxRegistered.value).toBe(false);
  expect(draft.blueprint.offers.every(offer => offer.pricing.unitPriceMinor === null && !offer.pricing.share)).toBe(true);
  expect((await engine.request('venture.get', {}))?.venture.country?.code).toBe('IN');
  await expect(engine.request('venture.queue.decide', { id: `q-plan-lumen-v${draft.blueprint.version}`, digest: 'changed', action: 'approve', viewed: true })).resolves.toMatchObject({ outcome: 'stale' });
  await accept(engine, draft.blueprint.id);
  expect((await engine.request('venture.get', {}))?.venture.country?.code).toBe('US');
  await expect(engine.request('venture.order.create', { clientId: 'c-boat', offerId: prior!.blueprint.offers[0]!.id, request: 'A fresh sponsor slot.' })).rejects.toMatchObject({ code: 'PRICE_REQUIRED' });
});

it('selecting the same country preserves the owner prices and tax settings', async () => {
  const engine = client();
  const before = await engine.request('venture.blueprint.get', {});
  const draft = await changeCountry(engine, 'IN');
  expect(draft.blueprint.offers).toEqual(before!.blueprint.offers);
  expect(draft.blueprint.backOffice).toEqual(before!.blueprint.backOffice);
});

it('new prices use the draft country before acceptance and old invoices keep their original country', async () => {
  const engine = client();
  const before = await engine.request('venture.invoice.get', { invoiceId: 'inv-0039' });
  await changeCountry(engine, 'US');
  const priced = await engine.request('venture.blueprint.update', { patch: { offers: [{ id: 'offer_sponsor', unitPrice: '201.50' }] } });
  const quote = await engine.request('venture.price.quote', { offerId: 'offer_sponsor' });
  expect(quote.figures.find(figure => figure.key === 'total')?.display).toMatch(/^\$201\.50$/);
  expect((await engine.request('venture.get', {}))?.venture.country?.code).toBe('IN');
  await accept(engine, priced.blueprint.id);
  const second = await changeCountry(engine, 'GB');
  await accept(engine, second.blueprint.id);
  const old = await engine.request('venture.invoice.get', { invoiceId: 'inv-0039' });
  expect((old as any).country.code).toBe('IN');
  expect(old.invoice.currency).toBe('INR');
  expect(old.documentText).toBe(before.documentText);
  expect(old.figures).toEqual(before.figures);
});

it('the existing Change plan form offers country with the reset and history warning', async () => {
  window.location.hash = '#/business/plan';
  const engine = client();
  render(<App client={engine} language="en" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Change plan' }));
  const country = await screen.findByRole('combobox', { name: 'Business country' });
  await waitFor(() => expect((country as HTMLSelectElement).value).toBe('IN'));
  fireEvent.change(country, { target: { value: 'US' } });
  expect(screen.getByText('Changing country clears prices and tax settings. Set new prices before taking orders. Earlier orders and invoices keep their original currency.')).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save changes' })); });
  await waitFor(async () => expect((await engine.request('venture.blueprint.get', {}))!.blueprint.backOffice.currency).toBe('USD'));
  expect((await engine.request('venture.get', {}))?.venture.country?.code).toBe('IN');
});

it('a JPY order keeps its exact zero-decimal price when the business moves again', async () => {
  const engine = client();
  await changeCountry(engine, 'JP');
  await expect(engine.request('venture.blueprint.update', { patch: { offers: [{ id: 'offer_sponsor', unitPrice: '1200.50' }] } })).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
  const plan = await engine.request('venture.blueprint.update', { patch: { offers: [{ id: 'offer_sponsor', unitPrice: '1200' }] } });
  expect(plan.blueprint.offers[0]!.pricing.unitPriceMinor).toBe('1200');
  await accept(engine, plan.blueprint.id);
  const order = await engine.request('venture.order.create', { clientId: 'c-boat', offerId: 'offer_sponsor', request: 'A new sponsor slot.' });
  const moved = await changeCountry(engine, 'US');
  await accept(engine, moved.blueprint.id);
  const invoice = await engine.request('venture.invoice.prepare', { orderId: order.id });
  expect(invoice.country?.code).toBe('JP');
  expect(invoice.invoice.currency).toBe('JPY');
  expect(invoice.figures.find(figure => figure.key === 'total')?.display).toBe('JPY 1,200');
  const issued = await engine.request('venture.invoice.issue', { invoiceId: invoice.invoice.id, digest: invoice.invoice.digest });
  await expect(engine.request('venture.payment.record', { invoiceId: issued.invoice.id, amount: '100.50', method: 'bank-transfer', receivedOn: '2026-10-21' })).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
  const paid = await engine.request('venture.payment.record', { invoiceId: issued.invoice.id, amount: '1200', method: 'bank-transfer', receivedOn: '2026-10-21' });
  expect(paid.invoice.status).toBe('paid');
  expect(paid.figures.find(figure => figure.key === 'paid')?.display).toBe('JPY 1,200');
});

it('old bank alert amounts keep INR while new Japanese accounts use whole yen', async () => {
  const engine = client();
  const plan = await changeCountry(engine, 'JP');
  await accept(engine, plan.blueprint.id);
  const old = await engine.request('venture.bank.alerts.set', { account: 'HDFC current', rules: [{ kind: 'large-debit', amount: '125.50' }] });
  expect(old.accounts.find(account => account.account === 'HDFC current')?.rules[0]).toMatchObject({ minor: '12550' });
  const fresh = await engine.request('venture.bank.alerts.set', { account: 'Tokyo account', rules: [{ kind: 'large-debit', amount: '1200' }] });
  expect(fresh.accounts.find(account => account.account === 'Tokyo account')?.rules[0]).toMatchObject({ minor: '1200' });
  expect(fresh.accounts.find(account => account.account === 'Tokyo account')?.ruleLines[0]).toContain('JPY 1,200');
});

it('forecasts exclude old-currency quotes and accept a new quote after enough history', async () => {
  const engine = client();
  const text = Array.from({ length: 10 }, (_, index) => `BEGIN:VCARD\nVERSION:3.0\nFN:Forecast Person ${index}\nEMAIL:forecast${index}@sample.example\nEND:VCARD`).join('\n');
  await engine.request('venture.network.import', { kind: 'vcard', name: 'forecast.vcf', text });
  const people = await engine.request('venture.network.people', { query: 'Forecast Person' });
  for (const person of people.people) {
    const { card } = await engine.request('venture.pipeline.add', { personId: person.id, trigger: { kind: 'owner' } });
    await engine.request('venture.pipeline.move', { id: card.id, stage: 'lost', reason: 'no-budget' });
  }
  expect((await engine.request('venture.pipeline.list', {})).forecast).toMatchObject({ label: 'forecast in INR only, from your last 90 days' });
  const moved = await changeCountry(engine, 'US');
  await accept(engine, moved.blueprint.id);
  expect((await engine.request('venture.pipeline.list', {})).forecast).toEqual({ line: 'No open card has a quote in USD. Other currencies are excluded.' });
  await engine.request('venture.blueprint.update', { patch: { offers: [{ id: 'offer_sponsor', unitPrice: '100' }] } });
  const quote = await engine.request('venture.price.quote', { offerId: 'offer_sponsor' });
  await engine.request('venture.pipeline.move', { id: 'opp_seed_vikram', stage: 'proposal', evidence: { kind: 'quote', id: quote.id } });
  const forecast = (await engine.request('venture.pipeline.list', {})).forecast;
  expect(forecast).toMatchObject({ label: 'forecast in USD only, from your last 90 days' });
  expect(forecast && 'value' in forecast && forecast.value).toMatch(/^[$][0-9]/); // the owner form, as the engine's planDisplay writes it (B2)
  const receipt = await engine.request('venture.receipt.get', { id: forecast && 'receiptId' in forecast ? forecast.receiptId : '' });
  expect(receipt.explanation).toContain('Other currencies are excluded.');
  await engine.request('workspace.open', { folder: 'ledgerline' });
  await expect(engine.request('venture.receipt.get', { id: receipt.id })).rejects.toMatchObject({ code: 'RECEIPT_NOT_FOUND' });
  await engine.request('workspace.open', { folder: 'lumen' });
  expect((await engine.request('venture.receipt.get', { id: receipt.id })).figures).toEqual(receipt.figures);
});

it('rewriting after a country draft keeps the latest owner prices and cleared offers', async () => {
  const engine = createFakeClient(new FakeEngine({ fresh: true }));
  await engine.request('workspace.create', { name: 'Country rewrite', pack: 'services' });
  await engine.request('venture.create', { idea: 'video editing', countryCode: 'IN' });
  for (const [questionId, answer] of [['q_1', { skipped: true }], ['q_pricing_model', { choiceId: 'project' }], ['q_price', { text: '1500' }], ['q_tax', { yes: false }]] as const) {
    await engine.request('venture.interview.answer', { questionId, answer });
  }
  const original = await engine.request('venture.blueprint.draft', { useTemplate: true });
  const id = original.blueprint.offers[0]!.id;
  await engine.request('venture.blueprint.update', { patch: { offers: [{ id, unitPrice: '1500' }] } });
  await changeCountry(engine, 'JP');
  await engine.request('venture.blueprint.update', { patch: { offers: [{ id, unitPrice: '1200' }] } });
  await engine.request('venture.blueprint.draft', { useTemplate: true });
  const rewritten = await engine.request('venture.blueprint.get', {});
  expect(rewritten?.blueprint.country?.code).toBe('JP');
  expect(rewritten?.blueprint.backOffice.currency).toBe('JPY');
  expect(rewritten?.blueprint.offers.find(offer => offer.id === id)?.pricing.unitPriceMinor).toBe('1200');
  expect(rewritten?.blueprint.offers.filter(offer => offer.id !== id).every(offer => offer.pricing.unitPriceMinor === null)).toBe(true);
});
