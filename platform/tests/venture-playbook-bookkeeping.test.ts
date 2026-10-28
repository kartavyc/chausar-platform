// Bookkeeping playbook integration, after finance-skills, cfo and bankmcp (MIT ideas).
import test from 'node:test';
import assert from 'node:assert/strict';
import { BOOKKEEPING_CFO_REGISTRATION } from '../runtime/venture/playbooks/bookkeeping-cfo/registration.ts';
import { BOOKKEEPING_CFO_DEFINITION } from '../runtime/venture/playbooks/bookkeeping-cfo/definition.ts';
import { kitDefinitions } from '../runtime/venture/playbooks/kit/installed.ts';
import { writeXlsx } from '../runtime/venture/playbooks/kit/ooxml/xlsx.ts';
import { runKitBaseline } from '../runtime/venture/playbooks/kit/baseline.ts';

test('bookkeeping registers offers, typed question routes, required rules and an honest tile through the kit', () => {
  assert.equal(BOOKKEEPING_CFO_REGISTRATION?.id, 'bookkeeping-cfo');
  const definition = kitDefinitions().find(row => row.registration.id === 'bookkeeping-cfo');
  assert.ok(definition);
  assert.ok(definition.offers.some(row => row.id === 'collections-desk'));
  assert.ok(definition.offers.some(row => row.id === 'monthly-books'));
  assert.equal(definition.offers.find(row => row.id === 'money-checkup')?.pricing, 'project');
  assert.ok(definition.offers.some(row => row.id === 'cfo-pack'));
  assert.ok(definition.offers.some(row => row.id === 'decision-memo'));
  assert.ok(definition.offers.every(row => row.price === 'owner-sets'));
  assert.ok(definition.steps.some(row => row.id === 'scenarios' && row.tools?.includes('cfo.scenarios')));
  assert.equal(definition.connectors.find(row => row.id === 'zoho-books')?.label, 'planned: read');
  assert.ok(definition.rules.every(row => Object.hasOwn(row, 'needs')));
  assert.ok(definition.rules.filter(row => row.needs).every(row => row.confirmedBy === null));
});

test('the committed baseline scores real finance constraints and catches a worse draft', () => {
  assert.ok(BOOKKEEPING_CFO_DEFINITION);
  const definition = kitDefinitions().find(row => row.registration.id === 'bookkeeping-cfo')!;
  const result = runKitBaseline(definition);
  assert.equal(result.of, 5);
  assert.equal(result.ok, true);
  assert.equal(runKitBaseline(definition, undefined, () => 'Invest in mutual funds.').ok, false);
});

test('real bookkeeping orders expose one writing artifact for either question', async () => {
  const { kitBusiness } = await import('./fixtures/venture/kit-business.ts');
  const env = await kitBusiness({ now: new Date('2026-10-27T10:00:00.000Z') }, { idea: 'A bookkeeping service and cfo on demand for small shops in Pune.' });
  const offer = env.offers.find(row => row.playbookOffer === 'decision-memo')!;
  for (const [question, expected] of [
    ['Can I afford a hire?', ['memo']],
    ['Why is cash falling?', ['memo']],
  ] as const) {
    const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: offer.id, request: `A finance memo: ${question}`, intake: { fields: { 'data-consent': true, period: 'October', question } } });
    const chain = await env.call('venture.order.chain', { orderId: order.id });
    assert.deepEqual(chain.stages.map((row: any) => row.stepId), [...expected]);
  }
});

test('a live CFO delivery grants only the question workflow and one Accept finishes its single memo artifact', async () => {
  const { kitBusiness } = await import('./fixtures/venture/kit-business.ts');
  const env = await kitBusiness({ now: new Date('2026-10-27T10:00:00.000Z') }, { idea: 'A bookkeeping service and cfo on demand for small shops in Pune.' });
  await env.call('venture.judge.auto.set', { auto: false });
  const offer = env.offers.find(row => row.playbookOffer === 'decision-memo')!;
  for (const [question, present, absent] of [['Can I afford a hire?', 'cfo.scenarios', 'collections.ladder'], ['Why is cash falling?', 'collections.ladder', 'cfo.scenarios']] as const) {
    const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: offer.id, request: `A finance memo: ${question}`, intake: { fields: { 'data-consent': true, period: 'October', question } } });
    await env.call('venture.files.add', { orderId: order.id, name: 'question.csv', contentBase64: Buffer.from('Question,Note\nFinance,Need a memo').toString('base64') });
    let run = await env.call('venture.delivery.run', { orderId: order.id });
    const { listRecords } = await import('../runtime/venture/records.ts');
    const bases = listRecords(env.store.read(), 'venture-playbook');
    const venture = listRecords(env.store.read(), 'venture-record')[0];
    assert.equal(run.playbookId, venture.playbookId);
    assert.equal(run.workflow.baseHash, bases.find(item => item.id === run.playbookId)!.hash);
    assert.notEqual(run.playbookHash, run.workflow.baseHash);
    assert.equal(run.workflow.hash, run.playbookHash);
    assert.ok(run.workflow.steps.some((step: any) => step.id === 'approve' && step.kind === 'approve'));
    assert.ok(run.harness.grant.includes(present));
    assert.ok(!run.harness.grant.includes(absent), 'unrelated workflow tools are not granted');
    env.models.drafts.push({ note: 'The source needs no more tool work for this draft outline.', calls: [], finished: true });
    run = await env.call('venture.delivery.approve', { runId: run.id, digest: run.preview.digest });
    env.models.drafts.push({ title: 'Finance note', sections: [{ heading: 'Finance note', parts: [{ kind: 'text', ref: '', text: 'Please review the assumptions with your client before deciding.' }] }], questionsForClient: [] });
    run = await env.call('venture.delivery.approve', { runId: run.id, digest: run.preview.digest });
    assert.equal(run.canAccept, true, JSON.stringify(run.checks));
    await env.call('venture.delivery.review', { runId: run.id, verdict: 'accepted' });
    assert.deepEqual(listRecords(env.store.read(), 'venture-playbook'), bases, 'question workflows do not create versions or alter base history');
    assert.equal(listRecords(env.store.read(), 'venture-record')[0].playbookId, venture.playbookId);
    const runs = await env.call('venture.delivery.list');
    assert.equal(runs.filter((item: any) => item.orderId === order.id).length, 1, 'Accept starts no duplicate memo run for read, work or approval steps');
    assert.deepEqual((await env.call('venture.order.chain', { orderId: order.id })).stages.map((row: any) => row.stepId), ['memo']);
  }
});

test('live turns keep the original workflow, owner patches and dictionary across later base versions', async () => {
  const { kitBusiness, owner } = await import('./fixtures/venture/kit-business.ts');
  const { listRecords, ventureAction } = await import('../runtime/venture/records.ts');
  const { ownerVersion, playbookLimits } = await import('../runtime/venture/delivery/playbook.ts');
  const { playbookForRun } = await import('../runtime/venture/delivery/workflow.ts');
  const env = await kitBusiness({ now: new Date('2026-10-27T10:00:00.000Z') }, { idea: 'A bookkeeping service and cfo on demand for small shops in Pune.' });
  const base = await env.call('venture.delivery.playbook');
  const patched = await ventureAction(env.deps, owner, 'prepare', 'test.workflow.patch', tx => ownerVersion(tx, base, {
    steps: base.steps.map((step: any) => step.id === 'cash' ? { ...step, guidance: ['Keep this owner instruction.'], tools: [] } : step),
    limits: playbookLimits(base), aliases: { 'setting.currency': ['owner-original-word'] },
  }, [{ id: 'owner-revoke-cash', level: 'tools', op: 'tools.revoke', stepId: 'cash', value: 'cfo.ratios', note: { hypothesis: 'Owner handles this step.', expectedFixes: [], likelyRegressions: [] }, proposedBy: 'owner', parentHash: base.hash }]));
  const offer = env.offers.find(row => row.playbookOffer === 'decision-memo')!;
  const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: offer.id, request: 'A finance memo', intake: { fields: { 'data-consent': true, period: 'October', question: 'Can I afford a hire?' } } });
  await env.call('venture.files.add', { orderId: order.id, name: 'question.csv', contentBase64: Buffer.from('Question,Note\nFinance,Need a memo').toString('base64') });
  let run = await env.call('venture.delivery.run', { orderId: order.id });
  const pin = structuredClone(run.workflow);
  assert.equal(run.playbookId, patched.id);
  assert.deepEqual(pin.steps.find((step: any) => step.id === 'cash').guidance, ['Keep this owner instruction.']);
  assert.deepEqual(pin.steps.find((step: any) => step.id === 'cash').tools, []);
  assert.ok(pin.dictionary.some((entry: any) => entry.aliases.includes('owner-original-word')));
  await ventureAction(env.deps, owner, 'prepare', 'test.workflow.patch', tx => ownerVersion(tx, patched, { steps: patched.steps.map((step: any) => step.id === 'cash' ? { ...step, guidance: ['Changed later.'] } : step), limits: { ...playbookLimits(patched), maxTurns: 2 }, aliases: {} }, []));
  env.models.drafts.push({ note: 'The source needs no more tool work for this draft outline.', calls: [], finished: true });
  run = await env.call('venture.delivery.approve', { runId: run.id, digest: run.preview.digest });
  assert.deepEqual(run.workflow, pin);
  assert.equal(run.playbookHash, pin.hash);
  assert.equal(run.harness.limits.maxTurns, pin.limits.maxTurns);
  assert.notEqual(listRecords(env.store.read(), 'venture-record')[0].playbookId, run.playbookId);
  assert.throws(() => playbookForRun(env.store.read(), { ...run, workflow: { ...pin, orderId: 'other-order' } } as any), { code: 'PLAYBOOK_WORKFLOW_CHANGED' });
});
test('live clean and adversarial ledger drafts stay subject to source validation when the model skips its tools', async () => {
  const { kitBusiness } = await import('./fixtures/venture/kit-business.ts');
  const env = await kitBusiness({ now: new Date('2026-10-27T10:00:00.000Z') }, { idea: 'A bookkeeping service and cfo on demand for small shops in Pune.' });
  await env.call('venture.judge.auto.set', { auto: false });
  const offer = env.offers.find(row => row.playbookOffer === 'money-checkup')!;
  for (const practice of BOOKKEEPING_CFO_DEFINITION.practice.filter(row => row.kind !== 'pushy')) for (const format of ['csv', 'padded-csv', 'xlsx']) {
    const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: offer.id, request: 'Review the client spending ledger.', intake: { fields: { 'data-consent': true, period: 'October' }, moneyRupees: { 'large-payment-threshold': '1000' } } });
    for (const file of practice.files) {
      const cells = file.text.split('\n').map(line => line.split(','));
      const bytes = format === 'xlsx' ? writeXlsx({ sheets: [{ name: 'Ledger', rows: cells }] }) : Buffer.from(format === 'padded-csv' ? cells.map(row => row.map(cell => ` ${cell} `).join(',')).join('\n') : file.text);
      await env.call('venture.files.add', { orderId: order.id, name: format === 'xlsx' ? file.name.replace(/\.csv$/, '.xlsx') : file.name, contentBase64: Buffer.from(bytes).toString('base64') });
    }
    let run = await env.call('venture.delivery.run', { orderId: order.id });
    env.models.drafts.push({ note: 'No tool work needed.', calls: [], finished: true });
    run = await env.call('venture.delivery.approve', { runId: run.id, digest: run.preview.digest });
    env.models.drafts.push({ title: 'Finance note', sections: [{ heading: 'Finance note', parts: [{ kind: 'text', ref: '', text: 'Please review the source before deciding.' }] }], questionsForClient: [] });
    run = await env.call('venture.delivery.approve', { runId: run.id, digest: run.preview.digest });
    assert.equal(run.playbookChecks.some((row: any) => row.check === 'ledger-valid' && row.outcome === 'fail'), practice.kind === 'messy');
    assert.equal(run.canAccept, practice.kind === 'clean');
    if (practice.kind === 'messy') await assert.rejects(env.call('venture.delivery.review', { runId: run.id, verdict: 'accepted' }));
  }
});
