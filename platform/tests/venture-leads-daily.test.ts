// Daily lead research and handoff, original tests; revenue-squad MIT, 10xconnect ideas only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDailyRun, draftLeadNote } from '../runtime/venture/playbooks/lead-generation/daily-run.ts';
const prospect = (i: number) => ({ osmId: `node/${i}`, name: `Shop ${i}`, address: `Road ${i}`, website: `https://shop${i}.example`, sourceUrl: `https://www.openstreetmap.org/node/${i}`, licence: '© OpenStreetMap contributors, ODbL' });
test('daily research defaults to ten new prospects, enriches, drafts and reports follow-ups without outside writes', async () => {
  let asked = 0;
  const report = await buildDailyRun({ city: 'Mumbai', vertical: 'shop=bakery', ownOffer: 'shop websites', postalAddress: '12 Lake Road, Mumbai', existing: [prospect(1)], followups: [{ id: 'due_1', name: 'Priya', due: '2026-10-27' }] }, {
    source: async n => { asked = n; return Array.from({ length: 15 }, (_, i) => prospect(i + 1)); },
    enrich: async url => ({ emails: [`hello@${new URL(url).hostname}`], pages: [url] }),
    allowed: async () => true,
    verify: async () => true,
  });
  assert.equal(asked, 10);
  assert.equal(report.prospects.length, 10);
  assert.equal(report.prospects[0].osmId, 'node/2');
  assert.equal(report.foundRate, 'emails found for 10 of 10');
  assert.equal(report.drafts.length, 10);
  assert.match(report.drafts[0].text, /unsubscribe/);
  assert.match(report.drafts[0].text, /12 Lake Road/);
  assert.deepEqual(report.followups.map(row => row.id), ['due_1']);
  assert.deepEqual(report.outsideWrites, []);
});
test('outreach honours opt-out, cold footers, warm notes, WhatsApp consent and never cold SMS or calls', () => {
  const base = { name: 'Lotus', body: 'Would a shop website help?', channel: 'email' as const, warm: false, blocked: false, business: 'Studio', postalAddress: '12 Lake Road', optIn: null };
  assert.equal(draftLeadNote({ ...base, warm: true }).text.includes('unsubscribe'), false);
  assert.throws(() => draftLeadNote({ ...base, blocked: true }), { code: 'OUTREACH_BLOCKED' });
  assert.throws(() => draftLeadNote({ ...base, channel: 'whatsapp' }), { code: 'WHATSAPP_CONSENT_REQUIRED' });
  assert.equal(draftLeadNote({ ...base, channel: 'whatsapp', optIn: { kind: 'they-wrote-first', at: '2026-10-27T00:00:00Z', source: 'mail_1' } }).mode, 'handoff');
  assert.throws(() => draftLeadNote({ ...base, channel: 'sms' }), { code: 'COLD_CHANNEL_REFUSED' });
  assert.throws(() => draftLeadNote({ ...base, channel: 'phone' }), { code: 'COLD_CHANNEL_REFUSED' });
  assert.equal(draftLeadNote({ ...base, channel: 'linkedin' }).mode, 'copy-and-open');
});
import { coldEmailMonthPlan } from '../runtime/venture/playbooks/lead-generation/daily-run.ts';
test('cold email month uses fifty prospects and the existing copied first-email sequence', () => {
  const plan = coldEmailMonthPlan({ weekdays: [1, 3, 5], sendTime: '10:30' }, '2026-10-27T10:00:00Z');
  assert.equal(plan.prospectLimit, 50);
  assert.deepEqual(plan.sequence.steps, [{ afterDays: 5, channel: 'email' }, { afterDays: 7, channel: 'email' }]);
  assert.deepEqual(plan.sequence.weekdays, [1, 3, 5]);
  assert.equal(plan.sequence.sendTime, '10:30');
});
