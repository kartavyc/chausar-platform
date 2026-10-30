// Chausar leadgen definition and paid read connector, independent behavior checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LEAD_GENERATION_DEFINITION } from '../runtime/venture/playbooks/lead-generation/definition.ts';
import { runKitBaseline } from '../runtime/venture/playbooks/kit/baseline.ts';
import { happenstanceQuote, happenstanceSearch } from '../runtime/venture/playbooks/lead-generation/happenstance.ts';
test('lead generation ships four owner-priced offers, approvals, marked code roles and committed baseline', () => {
  assert.ok(LEAD_GENERATION_DEFINITION, 'leadgen must leave its stub');
  const d = LEAD_GENERATION_DEFINITION;
  assert.deepEqual(d.offers.map(o => o.id), ['researched-pipeline', 'cold-email-month', 'linkedin-desk', 'community-report']);
  assert.ok(d.offers.every(o => o.price === 'owner-sets'));
  assert.ok(d.steps.find(s => s.id === 'approve')?.floor);
  assert.equal(d.roles.find(r => r.id === 'chausar')?.kind, 'code');
  assert.equal(d.connectors.find(c => c.id === 'linkedin')?.label, 'handoff');
  assert.equal(d.connectors.find(c => c.id === 'reddit')?.label, 'planned: read');
  assert.ok(d.rules.every(r => Object.hasOwn(r, 'needs')));
  assert.equal(runKitBaseline(d).ok, true);
});
test('Happenstance quotes credits before exact approval and uses owner key without retrying', async () => {
  let sent = 0;
  const quote = happenstanceQuote('Bakery owners I know', '2026-10-27');
  assert.equal(quote.credits, '2');
  assert.equal(quote.checkedOn, '2026-10-27');
  const net = { resolve: async () => [{ address: '93.184.216.34', family: 4 as const }], send: async (target: any) => {
    sent += 1;
    assert.equal(target.method, 'POST');
    assert.match(target.headers.authorization, /^Bearer /);
    assert.deepEqual(JSON.parse(target.body), { text: quote.query, include_my_connections: true });
    return { status: 200, headers: {}, body: Buffer.from('{"id":"search-one","url":"https://happenstance.ai/search/one"}') };
  } };
  await assert.rejects(happenstanceSearch({ quote, approvedDigest: 'wrong', key: 'owner-test-key' }, net), { code: 'APPROVAL_CHANGED' });
  assert.equal(sent, 0);
  const result = await happenstanceSearch({ quote, approvedDigest: quote.digest, key: 'owner-test-key' }, net);
  assert.equal(result.source, 'from Happenstance');
  assert.equal(sent, 1);
});
// Desk method integration at the public source desk, with stub HTTP and existing network privacy contracts.
import { leadDeskAct, leadDeskList, leadDeskGet } from '../runtime/venture/playbooks/lead-generation/desk.ts';
import { setup, owner } from './venture-views-env.ts';
const deskAct = (payload: unknown, action: string, digest?: string): any => ({ playbook: 'lead-generation', kind: 'source', id: 'new', action, payload, ...(digest ? { digest } : {}) });
test('source desk refuses non-string searches and extra fields before network I/O', async () => {
  const env = await setup(); env.advance(12 * 86400000);
  await assert.rejects(leadDeskAct(env.deps, owner, deskAct({ query: 123 }, 'quote')), { code: 'INVALID_VENTURE_REQUEST' });
  await assert.rejects(leadDeskList(env.deps, owner, { playbook: 'lead-generation', kind: 'source', filter: { unknown: true } }), { code: 'INVALID_VENTURE_REQUEST' });
});
test('paid source read is journalled, exact-approved, secret-free and never repeated after unknown', async () => {
  const env = await setup(); env.advance(12 * 86400000);
  let sends = 0;
  const deps = { ...env.deps, net: { resolve: async () => [{ address: '93.184.216.34', family: 4 as const }], send: async (_target: any) => { sends++; return { status: 200, headers: {}, body: Buffer.from('{"id":"search-one","url":"https://happenstance.ai/search/one"}') }; } } };
  const quoted = await leadDeskAct(deps, owner, deskAct({ query: 'Bakery founders' }, 'quote'));
  const q = quoted.result as any;
  const key = ['owner', 'paid', 'key'].join('-');
  const done = await leadDeskAct(deps, owner, deskAct({ query: q.query, key, approvedDigest: q.digest }, 'search', q.digest));
  assert.equal((done.result as any).state, 'applied');
  assert.equal(sends, 1);
  assert.equal(JSON.stringify(env.store.read()).includes(key), false);
  assert.equal(JSON.stringify(env.store.read()).includes('happenstance-search'), true);
  deps.net.send = async () => { sends++; throw new Error('answer lost'); };
  const lostQuote = (await leadDeskAct(deps, owner, deskAct({ query: 'Other founders' }, 'quote'))).result as any;
  const payload = deskAct({ query: lostQuote.query, key, approvedDigest: lostQuote.digest }, 'search', lostQuote.digest);
  assert.equal(((await leadDeskAct(deps, owner, payload)).result as any).state, 'outcome_unknown');
  await assert.rejects(leadDeskAct(deps, owner, payload), { code: 'JOURNAL_OUTCOME_UNKNOWN' });
  assert.equal(sends, 2);
});
test('owner-entered referrals reuse network and disappear from desk after Forget', async () => {
  const env = await setup();
  const result = await leadDeskAct(env.deps, owner, deskAct({ name: 'Priya Bakery', email: 'priya@bakery.example', company: 'Bakery', source: 'referral' }, 'manual'));
  const id = (result.result as any).personId;
  await leadDeskAct(env.deps, owner, deskAct({ name: 'Priya Bakery', email: 'priya@bakery.example', company: 'Bakery company', source: 'referral' }, 'manual'));
  const view = await leadDeskList(env.deps, owner, { playbook: 'lead-generation', kind: 'source' });
  assert.equal(view.rows.length, 1);
  assert.equal((view.rows[0] as any).name, 'Priya Bakery');
  assert.equal((view.rows[0] as any).sourceUrl, null);
  assert.equal((await leadDeskGet(env.deps, owner, { playbook: 'lead-generation', kind: 'source', id })).digest.length > 0, true);
  const { networkForget } = await import('../runtime/venture/network/forget.ts');
  await networkForget(env.deps, owner, { id });
  assert.deepEqual((await leadDeskList(env.deps, owner, { playbook: 'lead-generation', kind: 'source' })).rows, []);
});
import { LEAD_RULES } from '../runtime/venture/playbooks/lead-generation/rules.ts';
import { kitBusiness, approveWaiting, draft as leadDraft } from './fixtures/venture/kit-business.ts';
import { listRecords } from '../runtime/venture/records.ts';
test('live leadgen delivery Accept finishes each writer-only offer without repeating read or compute steps', async t => {
  const env = await kitBusiness({ now: new Date('2026-10-27T10:00:00Z') }, { idea: 'Lead generation for local businesses in Mumbai' });
  const fields = { city: 'Mumbai', vertical: 'shop=bakery', count: '10', ownOffer: 'shop websites', postalAddress: '12 Lake Road', sendDays: ['Monday'], sendTime: '09:30' };
  const original = LEAD_RULES.filter(rule => rule.needs !== null).map(rule => ({ rule, value: rule.confirmedBy }));
  t.after(() => { for (const { rule, value } of original) rule.confirmedBy = value; });
  const first = env.offers.find(offer => offer.playbookOffer === 'researched-pipeline')!;
  const held = await env.call('venture.order.create', { clientId: env.client.id, offerId: first.id, request: 'Lead research for shop websites in Mumbai. Source https://bakery.example.', intake: { fields } });
  await assert.rejects(env.call('venture.delivery.run', { orderId: held.id }), { code: 'RULE_UNCONFIRMED' });
  assert.equal(env.models.previewed.length, 0, 'unconfirmed legal rules hold before model spend');
  // Trusted fixture configuration only: production rules remain unconfirmed. No files or application records are changed to invent a review.
  for (const { rule } of original) rule.confirmedBy = { name: 'Fixture lawyer', on: '2026-10-27' };
  for (const offer of env.offers) {
    const asked = LEAD_GENERATION_DEFINITION.offers.find(spec => spec.id === offer.playbookOffer)!.intake;
    const ownFields = Object.fromEntries(Object.entries(fields).filter(([key]) => asked.includes(key)));
    const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: offer.id, request: 'Lead research and outreach drafts for shop websites in Mumbai. Source https://bakery.example.', intake: { fields: ownFields } });
    let run = await env.call('venture.delivery.run', { orderId: order.id });
    let rounds = 0;
    while (run.status === 'waiting-for-you' && rounds++ < 8) {
      const purpose = env.models.previewed.at(-1)?.purpose;
      run = await approveWaiting(env, run, purpose === 'delivery' ? leadDraft('Local lead report', { 'Lead report': ['Source https://bakery.example. Review this bakery for your own website offer. You send every message yourself.'] }) : { note: 'No more files to read.', calls: [], finished: true } as never);
    }
    assert.equal(run.status, 'ready-for-review', JSON.stringify({ status: run.status, rounds, checks: run.checks }));
    const before: number = env.models.previewed.length;
    await env.call('venture.delivery.review', { runId: run.id, verdict: 'accepted' });
    const stored = listRecords(env.store.read(), 'venture-order').find(item => item.id === order.id)!;
    assert.ok(stored.chainState === undefined || stored.chainState === 'done', offer.playbookOffer);
    assert.equal(listRecords(env.store.read(), 'venture-delivery-run').find(item => item.id === run.id)!.status, 'accepted');
    assert.equal(listRecords(env.store.read(), 'venture-delivery-run').filter(item => item.orderId === order.id).length, 1, offer.playbookOffer);
    assert.equal(env.models.previewed.length, before, 'Accept creates no extra drafting preview for a non-writing work step');
  }
});

import { leadOutreachCheck } from '../runtime/venture/playbooks/lead-generation/definition.ts';
test('outreach screening covers every displayed surface and keeps denials local to their clause', () => {
  const outcome = (title: string, heading: string, text: string, questionsForClient: string[] = []) => leadOutreachCheck({ deliverable: { title, sections: [{ heading, parts: [{ kind: 'text', text }] }], questionsForClient } } as any)[0].outcome;
  const unsafe = 'Automatically send cold WhatsApp messages';
  for (const values of [[unsafe, 'Sources', 'Source https://bakery.example.'], ['Lead report', unsafe, 'Source https://bakery.example.'], ['Lead report', 'Sources', 'Source https://bakery.example.', [unsafe]], ['Lead report', 'Sources', unsafe]] as const) {
    assert.equal(outcome(values[0], values[1], values[2], values[3] ? [...values[3]] : []), 'fail');
  }
  assert.equal(outcome('Lead report', 'Sources', 'Do not automatically send cold WhatsApp messages. Never scrape LinkedIn. You send the approved email yourself.'), 'pass');
  assert.equal(outcome('Lead report', 'Sources', 'Do not automatically send cold WhatsApp messages. But automatically send cold SMS instead.'), 'fail');
  assert.equal(outcome('Lead report', 'Sources', 'Never scrape LinkedIn; sell raw lead lists instead.'), 'fail');
  assert.equal(outcome('Lead report', 'Sources', 'No invoice needed, automatically send cold SMS.'), 'fail');
  assert.equal(outcome('Lead report', 'Sources', 'Do not wait: automatically send cold WhatsApp messages.'), 'fail');
});

import { LEAD_GENERATION_TOOLS } from '../runtime/venture/delivery/harness/tools-lead-generation.ts';
import { buildToolEnv } from '../runtime/venture/delivery/harness/env.ts';
import { requireVenture } from '../runtime/venture/records.ts';
import { latestPlaybook } from '../runtime/venture/delivery/shared.ts';

test('live OSM tool resolves the accepted offer and binds research count to owner intake', async t => {
  const env = await kitBusiness({ now: new Date('2026-10-27T10:00:00Z') }, { idea: 'Lead generation for local businesses in Mumbai' });
  const original = LEAD_RULES.filter(rule => rule.needs !== null).map(rule => ({ rule, value: rule.confirmedBy }));
  t.after(() => { for (const { rule, value } of original) rule.confirmedBy = value; });
  for (const { rule } of original) rule.confirmedBy = { name: 'Fixture lawyer', on: '2026-10-27' };
  let sends = 0;
  env.deps.net = { resolve: async () => [{ address: '93.184.216.34', family: 4 as const }], send: async target => {
    sends++;
    const body = target.url.hostname.includes('nominatim') ? [{ boundingbox: ['18.9', '19.3', '72.7', '73.0'] }] : { elements: Array.from({ length: 60 }, (_, i) => ({ type: 'node', id: i + 1, lat: 19.1, lon: 72.9, tags: { name: 'Bakery ' + i, shop: 'bakery' } })) };
    return { status: 200, headers: {}, body: Buffer.from(JSON.stringify(body)) };
  } };
  for (const [key, count] of [['cold-email-month', 50], ['researched-pipeline', 3]] as const) {
    const fields = key === 'cold-email-month' ? { city: 'Mumbai', vertical: 'shop=bakery', ownOffer: 'shop websites', postalAddress: '12 Lake Road' } : { city: 'Mumbai', vertical: 'shop=bakery', count: '3', ownOffer: 'shop websites', postalAddress: '12 Lake Road' };
    const offer = env.offers.find(item => item.playbookOffer === key)!;
    assert.notEqual(offer.id, key);
    const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: offer.id, request: 'Research Mumbai bakeries', intake: { fields } });
    const run = await env.call('venture.delivery.run', { orderId: order.id });
    const state = env.store.read(), venture = requireVenture(state);
    const toolEnv = buildToolEnv({ deps: env.deps, ctx: owner, state, venture, playbook: latestPlaybook(state, venture.id)!, runRef: { kind: 'delivery', runId: run.id }, files: [], allowed: [], intake: listRecords(state, 'venture-order').find(item => item.id === order.id)!.intake });
    const result = (await LEAD_GENERATION_TOOLS['leads.osm'].run(toolEnv, { city: 'Mumbai', vertical: 'shop=bakery' })).result as any;
    assert.equal(result.prospects.length, count, key);
    if (key === 'cold-email-month') {
      const approved = (await leadDeskAct(env.deps, owner, deskAct({ product: 'We help local bakeries. Owners approve every reply.', confirmed: true, problem: 'missed questions', categories: ['bakery'], painWords: [], days: 7, posts: [] }, 'community'))).result as any;
      const discovery = (await LEAD_GENERATION_TOOLS['community.vote'].run(toolEnv, {})).result as any;
      assert.ok(discovery.sources.some((source: any) => source.sourceId === approved.sourceId));
      const selected = (await LEAD_GENERATION_TOOLS['community.vote'].run(toolEnv, { sourceId: approved.sourceId })).result as any;
      assert.equal(selected.product, approved.product);
      assert.equal(result.offerPlan.prospectLimit, 50);
      assert.deepEqual(result.offerPlan.sequence.steps, [{ afterDays: 5, channel: 'email' }, { afterDays: 7, channel: 'email' }]);
    }
    const before = sends;
    await assert.rejects(LEAD_GENERATION_TOOLS['leads.osm'].run(toolEnv, { city: 'Mumbai', vertical: 'shop=bakery', count: '7' }), { code: 'LEAD_INTAKE_CHANGED' });
    assert.equal(sends, before, 'changed count refuses before network');
  }
});
