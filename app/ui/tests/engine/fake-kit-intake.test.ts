// Chausar fake kit order boundary (5M). Original parity checks at the public desk method.
import { expect, it } from 'vitest';
import { FakeWorkDesk } from '../../src/engine/fake-work';
import type { BlueprintViewLite } from '../../src/engine/types';
const view = {
  blueprint: { offers: [{ id: 'service', name: { value: 'Pipeline' }, pricing: { unitPriceMinor: '100', defaultQuantity: '1' } }] },
  offerReceipts: {}, intake: { service: { rights: [], fields: [], kit: [
    { id: 'city', label: 'City', help: '', kind: 'text', required: true },
    { id: 'budget', label: 'Budget', help: '', kind: 'money', required: false },
    { id: 'yes', label: 'Client consent', help: '', kind: 'consent', required: true },
  ] } },
} as unknown as BlueprintViewLite;
function desk() { return new FakeWorkDesk({ current: () => 'business', now: () => '2026-10-27T10:00:00.000Z', clients: () => [{ id: 'client', name: 'Shop' }] as never, plan: () => view, runs: () => [], agentName: () => 'Writer', emit: () => {} }, { fresh: true }); }
const params = { clientId: 'client', offerId: 'service', request: 'Local pipeline' };
it('refuses missing kit fields rather than accepting a request the engine refuses', () => {
  expect(() => desk().request('venture.order.create', params)).toThrowError(expect.objectContaining({ code: 'INTAKE_FIELD_REQUIRED' }));
});
it('normalizes rupees in the fake engine and refuses conflicting or extra answers', () => {
  const made = desk().request('venture.order.create', { ...params, intake: { fields: { city: '  Mumbai ', yes: true }, moneyRupees: { budget: '125.50' } } });
  expect(made).toMatchObject({ intake: { fields: { city: 'Mumbai', yes: true, budget: '12550' } } });
  for (const intake of [
    { fields: { city: 'Mumbai', yes: false } },
    { fields: { city: 'Mumbai', yes: true, extra: 'anything' } },
    { fields: { city: 'Mumbai', yes: true, budget: '12550' }, moneyRupees: { budget: '125.50' } },
    { fields: { city: 'Mumbai', yes: true }, moneyRupees: { budget: '-1' } },
  ]) expect(() => desk().request('venture.order.create', { ...params, intake })).toThrow();
});
it('attaches a new required kit file atomically in the fake order API', () => {
 const schema = structuredClone(view);
 schema.intake!.service!.kit!.push({ id: 'ledger', label: 'Ledger', help: '', kind: 'file', required: true });
 const work = new FakeWorkDesk({ current: () => 'business', now: () => '2026-10-27T10:00:00.000Z', clients: () => [{ id: 'client', name: 'Shop' }] as never, plan: () => schema, runs: () => [], agentName: () => 'Writer', emit: () => {} }, { fresh: true });
 const made = work.request('venture.order.create', { ...params, intake: { fields: { city: 'Mumbai', yes: true } }, intakeFiles: { ledger: { name: 'ledger.csv', contentBase64: btoa('item,amount\nsale,125.50') } } }) as { id: string; intake: { fields: { ledger: string } } };
 const files = work.request('venture.files.list', { orderId: made.id }) as { id: string; name: string }[];
 expect(files).toHaveLength(1);
 expect(made.intake.fields.ledger).toBe(files[0]!.id);
 const before = work.request('venture.order.list', {});
 expect(() => work.request('venture.order.create', { ...params, intake: { fields: { city: 'Mumbai', yes: true } }, intakeFiles: { ledger: { name: 'bad.exe', contentBase64: btoa('bad') } } })).toThrow();
 expect(work.request('venture.order.list', {})).toEqual(before);
});

it('keeps normalized rights and engine flags on a rights-bearing kit order', () => {
 const schema = structuredClone(view);
 schema.intake!.service!.rights = ['licence'];
 const work = new FakeWorkDesk({ current: () => 'business', now: () => '2026-10-27T10:00:00.000Z', clients: () => [{ id: 'client', name: 'Shop' }] as never, plan: () => schema, runs: () => [], agentName: () => 'Writer', emit: () => {} }, { fresh: true });
 const made = work.request('venture.order.create', { ...params, intake: { rights: { basis: 'licence', holder: '  Owner ', reference: ' Permission ', expiresOn: '2026-11-30' }, fields: { city: 'Mumbai', yes: true } } });
 expect(made).toMatchObject({ intake: { rights: { basis: 'licence', holder: 'Owner', reference: 'Permission', scope: null, expiresOn: '2026-11-30', recordedAt: '2026-10-27T10:00:00.000Z', recordedBy: 'owner' }, format: 'long', aiVoice: false, aiPresenter: false, paidPromotion: false, cutFile: null } });
 expect(() => work.request('venture.order.create', { ...params, intake: { rights: { basis: 'licence', holder: 'Owner', reference: 'Permission', expiresOn: '2026-10-26' }, fields: { city: 'Mumbai', yes: true } } })).toThrowError(expect.objectContaining({ code: 'RIGHTS_REQUIRED' }));
});

it('refuses made-up or another order\'s intake upload IDs without leaving an order', () => {
 const schema = structuredClone(view);
 schema.intake!.service!.kit!.push({ id: 'ledger', label: 'Ledger', help: '', kind: 'file', required: true });
 const work = new FakeWorkDesk({ current: () => 'business', now: () => '2026-10-27T10:00:00.000Z', clients: () => [{ id: 'client', name: 'Shop' }] as never, plan: () => schema, runs: () => [], agentName: () => 'Writer', emit: () => {} }, { fresh: true });
 const first = work.request('venture.order.create', { ...params, intake: { fields: { city: 'Mumbai', yes: true } }, intakeFiles: { ledger: { name: 'ledger.csv', contentBase64: btoa('item,amount\nsale,125.50') } } }) as { intake: { fields: { ledger: string } } };
 const before = work.request('venture.order.list', {});
 for (const ledger of ['upload_missing', first.intake.fields.ledger]) expect(() => work.request('venture.order.create', { ...params, intake: { fields: { city: 'Mumbai', yes: true, ledger } } })).toThrowError(expect.objectContaining({ code: 'UPLOAD_NOT_FOUND' }));
 expect(work.request('venture.order.list', {})).toEqual(before);
});

it('omits intake for a kit offer that asks nothing and received no intake', () => {
 const schema = structuredClone(view);
 schema.intake!.service!.kit = [];
 const work = new FakeWorkDesk({ current: () => 'business', now: () => '2026-10-27T10:00:00.000Z', clients: () => [{ id: 'client', name: 'Shop' }] as never, plan: () => schema, runs: () => [], agentName: () => 'Writer', emit: () => {} }, { fresh: true });
 expect(work.request('venture.order.create', params)).not.toHaveProperty('intake');
 expect(work.request('venture.order.create', { ...params, intake: {} })).toHaveProperty('intake.fields', {});
});
