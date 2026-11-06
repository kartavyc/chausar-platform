// Public fake-desk refusal and privacy behavior, paired with the engine source-desk tests.
import { describe, expect, it } from 'vitest';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { LEADGEN_OFFERS, LEADGEN_INTAKE_FIELDS } from '../../src/engine/fake-lead-generation';
const base = { playbook: 'lead-generation' as const, kind: 'source' };
describe('lead generation fake source desk', () => {
  it('keeps engine offer and intake metadata and exact refusal checks', async () => {
    const client = createFakeClient(new FakeEngine({ now: () => '2026-10-27T12:00:00.000Z' }));
    expect(LEADGEN_OFFERS.map(o => o.id)).toEqual(['researched-pipeline', 'cold-email-month', 'linkedin-desk', 'community-report']);
    expect(LEADGEN_INTAKE_FIELDS.map(f => f.id)).toContain('postalAddress');
    await expect(client.request('venture.desk.act', { ...base, id: 'new', action: 'quote', payload: { query: 123 } })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
    const quote = await client.request('venture.desk.act', { ...base, id: 'new', action: 'quote', payload: { query: 'Bakery owners' } });
    expect(quote.result).toMatchObject({ query: 'Bakery owners', credits: '2', checkedOn: '2026-10-27' });
    await expect(client.request('venture.desk.list', { ...base, filter: { bad: true } })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
  });
  it('adds an owner-entered referral to the existing network and removes its row on Forget', async () => {
    const client = createFakeClient(new FakeEngine({ now: () => '2026-10-27T12:00:00.000Z' }));
    const response = await client.request('venture.desk.act', { ...base, id: 'new', action: 'manual', payload: { name: 'Priya Bakery', email: 'priya@bakery.example', company: 'Bakery', source: 'referral' } });
    const id = (response.result as { personId: string }).personId;
    expect((await client.request('venture.desk.list', base)).rows).toContainEqual(expect.objectContaining({ id, name: 'Priya Bakery', sourceUrl: null }));
    await client.request('venture.network.forget', { id });
    expect((await client.request('venture.desk.list', base)).rows).not.toContainEqual(expect.objectContaining({ id }));
  });
});


it('deduplicates repeated owner referrals and uses India day for each separately approved paid account', async () => {
  const client = createFakeClient(new FakeEngine({ now: () => '2026-10-26T20:00:00.000Z' }));
  const payload = { name: 'Priya Bakery', email: 'priya@bakery.example', source: 'referral' };
  await client.request('venture.desk.act', { ...base, id: 'new', action: 'manual', payload });
  await client.request('venture.desk.act', { ...base, id: 'new', action: 'manual', payload: { ...payload, company: 'Bakery company' } });
  expect((await client.request('venture.desk.list', base)).rows.filter((row: any) => row.name === payload.name)).toHaveLength(1);
});
it('uses India day for a dated paid quote', async () => {
  const client = createFakeClient(new FakeEngine({ now: () => '2026-10-26T20:00:00.000Z' }));
  const quote = (await client.request('venture.desk.act', { ...base, id: 'new', action: 'quote', payload: { query: 'Bakery owners' } })).result as any;
  expect(quote.checkedOn).toBe('2026-10-27');
});
it('allows each separately approved paid account without replaying the same account', async () => {
  const client = createFakeClient(new FakeEngine({ now: () => '2026-10-27T12:00:00.000Z' }));
  const quote = (await client.request('venture.desk.act', { ...base, id: 'new', action: 'quote', payload: { query: 'Bakery owners' } })).result as any;
  for (const key of ['first-owner-key', 'second-owner-key']) {
    const result = await client.request('venture.desk.act', { ...base, id: 'new', action: 'search', digest: quote.digest, payload: { query: quote.query, key, approvedDigest: quote.digest } });
    expect(result.result).toMatchObject({ state: 'applied' });
  }
});

it('erases saved community evidence when its named network person is forgotten', async () => {
  const client = createFakeClient(new FakeEngine({ now: () => '2026-10-27T12:00:00.000Z' }));
  const person = (await client.request('venture.desk.act', { ...base, id: 'new', action: 'manual', payload: { name: 'Priya Bakery', email: 'priya@bakery.example', source: 'referral' } })).result as any;
  const payload = { product: 'We help shops. Owners approve answers.', confirmed: true, problem: 'missed questions', categories: ['bakery'], painWords: [], days: 7, posts: [{ id: 'p1', url: 'https://community.example/p1', community: 'bakers', rulesUrl: 'https://community.example/rules', rulesCheckedOn: '2026-10-27', readingAllowed: true, on: '2026-10-26', removed: false, text: 'Priya Bakery needs help answering shop questions.', votes: [{ dimension: 'pain', score: 4, quote: 'needs help' }, { dimension: 'fit', score: 5, quote: 'shop questions' }, { dimension: 'intent', score: 2, quote: 'answering' }] }] };
  const report = (await client.request('venture.desk.act', { ...base, id: 'new', action: 'community', payload })).result as any;
  expect((await client.request('venture.desk.get', { ...base, id: report.sourceId })).item).toMatchObject({ sourceId: report.sourceId });
  await client.request('venture.network.forget', { id: person.personId });
  await expect(client.request('venture.desk.get', { ...base, id: report.sourceId })).rejects.toMatchObject({ code: 'LEADS_NOT_FOUND' });
});

it('forgets earlier community evidence when the matching person was imported later', async () => {
  const client = createFakeClient(new FakeEngine({ now: () => '2026-10-27T12:00:00.000Z' }));
  const report = (await client.request('venture.desk.act', { ...base, id: 'new', action: 'community', payload: { product: 'We help Priya Bakery. Owners approve answers.', confirmed: true, problem: 'missed questions', categories: ['bakery'], painWords: [], days: 7, posts: [] } })).result as any;
  const person = (await client.request('venture.desk.act', { ...base, id: 'new', action: 'manual', payload: { name: 'Priya Bakery', email: 'priya@bakery.example', source: 'referral' } })).result as any;
  expect((await client.request('venture.desk.list', base)).rows.map((row: any) => row.id)).toEqual([report.sourceId, person.personId]);
  await client.request('venture.network.forget', { id: person.personId });
  await expect(client.request('venture.desk.act', { ...base, id: report.sourceId, action: 'forget-community', payload: {} })).rejects.toMatchObject({ code: 'COMMUNITY_OWNER_SOURCE_REQUIRED' });
  await expect(client.request('venture.desk.get', { ...base, id: report.sourceId })).rejects.toMatchObject({ code: 'LEADS_NOT_FOUND' });
});
