// H11 and H12 (Ink v2 wave 1): Chausar judges effects, not the tool, and the always-ask floor grows.
// What an action can touch comes from Chausar's own tool declarations, the connector catalogue and the action itself
// (its name, its arguments, its web method), never from the label a tool or a model claims. An unclassified action
// counts as destructive, and a gate that throws denies. The floor now also covers recurring jobs, rules, payment and
// payout details and issuing for real; deleting a scheduled job stays off it. Pure functions; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TOOL_NAMES } from '../runtime/venture/contracts.ts';
import { classifyEffects, DESTRUCTIVE_WORDS, EFFECT_KINDS, MUTATING_HTTP, toolDeclaration } from '../runtime/venture/policy/effects.ts';
import { FLOOR_KINDS, FLOOR_WORDS, floorOf, type PolicyAction } from '../runtime/venture/policy/floor.ts';
import { ladderPolicy, type PolicyContext } from '../runtime/venture/policy/ladder.ts';
import { POSTURES } from '../runtime/venture/policy/posture.ts';
import { evaluate, evaluateSync, type Verdict } from '../runtime/venture/policy/verdict.ts';

const pick = (verdict: Verdict) => ({ verdict: verdict.verdict, code: verdict.code });
const kinds = (facts: Parameters<typeof classifyEffects>[0]) => classifyEffects(facts).effects;
const ALL_BUT_READ = ['private-read', 'write', 'send', 'egress', 'money'];

// ---------------------------------------------------------------------------
// 1. Effects come from Chausar and the action, never the claimed label
// ---------------------------------------------------------------------------

test('effects: a fixed list, and every Chausar tool declares its effects from it', () => {
  assert.deepEqual([...EFFECT_KINDS], ['read', 'private-read', 'write', 'send', 'egress', 'money']);
  for (const name of TOOL_NAMES) {
    const declared = toolDeclaration(name);
    assert.ok(declared, `${name} declares its effects`);
    assert.ok(declared.effects.length > 0, `${name} declares at least one effect`);
    for (const kind of declared.effects) assert.ok((EFFECT_KINDS as readonly string[]).includes(kind), `${name}: ${kind}`);
  }
  assert.equal(toolDeclaration('mystery.tool'), null);
});

test('effects: Chausar tools are classified from their declaration and their input, never from the label they carry', () => {
  assert.deepEqual(classifyEffects({ name: 'files.read', effect: 'read' }), { effects: ['read'], destructive: false, unclassified: false });
  assert.deepEqual(kinds({ name: 'calc.sum', effect: 'compute' }), ['read']);
  assert.deepEqual(kinds({ name: 'outbox.propose', effect: 'outside-write', input: { connector: 'mail-app', summary: 'x' } }), ['send']);
  assert.deepEqual(kinds({ name: 'outbox.propose', effect: 'outside-write', input: { connector: 'payment-link', summary: 'x' } }), ['send', 'money']);
  // A label that says less than the declaration changes nothing.
  assert.deepEqual(kinds({ name: 'agent.delegate', effect: 'read' }), ['write', 'egress']);
  assert.deepEqual(kinds({ name: 'outbox.propose', effect: 'read', claimed: ['read'] }), ['send']);
  // A tool that claims to only read is still judged by what it does.
  const refund = classifyEffects({ name: 'orders.refund', effect: 'read', claimed: ['read'] });
  assert.ok(refund.effects.includes('money'));
  assert.equal(refund.destructive, true);
});

test('effects: the connector catalogue decides what a connector action can touch', () => {
  assert.deepEqual(kinds({ name: 'razorpay.refund.create', connector: 'razorpay' }), ['write', 'egress', 'money']);
  assert.deepEqual(kinds({ name: 'whatsapp.message.create', connector: 'whatsapp' }), ['write', 'send', 'egress']);
  assert.deepEqual(kinds({ name: 'notion.page.create', connector: 'notion' }), ['write', 'egress']);
  // Reading a connected account is a private read that leaves this computer; it changes nothing.
  assert.deepEqual(classifyEffects({ name: 'hubspot.contacts.list', connector: 'hubspot' }), { effects: ['private-read', 'egress'], destructive: false, unclassified: false });
  // A connector action with no verb is judged by everything its category can do.
  assert.deepEqual(kinds({ name: 'stripe.thing', connector: 'stripe' }), ['write', 'egress', 'money']);
  // A connector the catalogue does not know adds nothing: the action is unclassified, so destructive.
  assert.equal(classifyEffects({ name: 'acme.thing', connector: 'acme' }).unclassified, true);
});

test('effects: an unclassified action counts as destructive', () => {
  for (const name of ['mystery.tool', 'do.it', 'x']) {
    assert.deepEqual(classifyEffects({ name }), { effects: ALL_BUT_READ, destructive: true, unclassified: true }, name);
  }
  // A coarse effect from Chausar's own code is a declaration, so the action is classified.
  assert.deepEqual(kinds({ name: 'mystery.tool', effect: 'outside-write' }), ['write', 'send']);
});

test('effects: names with delete, archive, send, publish, pay or refund are destructive', () => {
  for (const verb of ['delete', 'archive', 'send', 'publish', 'pay', 'refund', 'remove', 'transfer', 'post']) {
    const found = classifyEffects({ name: `crm.record.${verb}` });
    assert.equal(found.destructive, true, verb);
    assert.equal(found.unclassified, false, verb);
  }
  assert.deepEqual(classifyEffects({ name: 'report.view' }), { effects: ['read'], destructive: false, unclassified: false });
  assert.deepEqual(kinds({ name: 'crm.contact.archive' }), ['write']);
  assert.deepEqual(kinds({ name: 'invoice.pay' }), ['money']);
  assert.ok(kinds({ name: 'site.publish' }).includes('send'));
  assert.ok(kinds({ name: 'vault.secrets.read' }).includes('private-read'));
  assert.ok(kinds({ name: 'page.fetch' }).includes('egress'));
});

test('effects: notifyCustomer, archive and mutating web methods can never be read (CI rule)', () => {
  assert.ok(kinds({ name: 'orders.view', input: { notifyCustomer: true } }).includes('send'));
  assert.ok(kinds({ name: 'orders.view', input: { options: { notify_customer: true } } }).includes('send'), 'nested arguments count');
  assert.ok(kinds({ name: 'orders.view', input: { archive: true } }).includes('write'));
  assert.deepEqual(kinds({ name: 'orders.view', input: { notifyCustomer: false } }), ['read']);
  assert.deepEqual([...MUTATING_HTTP], ['POST', 'PUT', 'PATCH', 'DELETE']);
  // Every mutating verb, with any name and any claimed label, is a write and never read alone.
  for (const verb of [...MUTATING_HTTP, 'post', 'Patch', ' delete ']) {
    for (const name of ['orders.view', 'files.read', 'report.get', 'mystery.tool', 'dictionary.browse']) {
      const found = classifyEffects({ name, http: verb, effect: 'read', claimed: ['read'] });
      assert.ok(found.effects.includes('write'), `${verb} ${name}`);
      assert.equal(found.destructive, true, `${verb} ${name}`);
    }
  }
  for (const verb of ['GET', 'HEAD', 'OPTIONS']) assert.deepEqual(kinds({ name: 'orders.view', http: verb }), ['read'], verb);
});

test('effects: a gate that throws denies, never allows', async () => {
  const input = Object.defineProperty({}, 'notifyCustomer', { enumerable: true, get() { throw new Error('a broken argument'); } });
  const context: PolicyContext = { posture: 'auto-spot-check', approval: { kind: 'owner-turn' }, gates: { work: 'auto' }, stepsByTool: { 'files.read': ['work'] } };
  const call: PolicyAction = { phase: 'tool-call', name: 'files.read', effect: 'read', inputDigest: 'd1', input };
  assert.deepEqual(pick(evaluateSync([ladderPolicy], call, context)), { verdict: 'deny', code: 'policy_error' });
  assert.deepEqual(pick(await evaluate([ladderPolicy], call, context)), { verdict: 'deny', code: 'policy_error' });
  const outside: PolicyAction = { phase: 'outside-effect', name: 'orders.update', digest: 'a'.repeat(64), input };
  assert.deepEqual(pick(evaluateSync([ladderPolicy], outside, { ...context, approval: { kind: 'owner-action', digest: 'a'.repeat(64), memberId: 'owner' } })), { verdict: 'deny', code: 'policy_error' });
});

// ---------------------------------------------------------------------------
// 2. The floor additions
// ---------------------------------------------------------------------------

const effect = (name: string, extra: Partial<PolicyAction> = {}) => floorOf({ phase: 'outside-effect', name, ...extra });

test('floor: four new kinds, each in plain words', () => {
  assert.deepEqual([...FLOOR_KINDS], ['money-out', 'send', 'delete', 'price-change', 'government-portal', 'credential', 'recurring-job', 'rule-change', 'payment-details', 'issue']);
  for (const kind of FLOOR_KINDS) assert.match(FLOOR_WORDS[kind], /always asks you first\.$/);
  assert.equal(FLOOR_WORDS['recurring-job'], 'Creating or changing a recurring job always asks you first.');
  assert.equal(FLOOR_WORDS['rule-change'], 'Adding or loosening a rule always asks you first.');
  assert.equal(FLOOR_WORDS['payment-details'], 'Changing payment or payout details always asks you first.');
  assert.equal(FLOOR_WORDS.issue, 'Issuing for real, not as a draft, always asks you first.');
});

test('floor: recurring jobs, rules, payment and payout details and issuing for real always ask; deleting a scheduled job does not', () => {
  assert.deepEqual(effect('schedule.create'), ['recurring-job']);
  assert.deepEqual(effect('cron.job.update'), ['recurring-job']);
  assert.deepEqual(effect('recurring.reminder.create'), ['recurring-job']);
  assert.deepEqual(effect('rule.add'), ['rule-change']);
  assert.deepEqual(effect('mail.filter.create'), ['send', 'rule-change']);
  assert.deepEqual(effect('spend.policy.loosen'), ['rule-change']);
  assert.deepEqual(effect('payment.details.change'), ['payment-details']);
  assert.deepEqual(effect('vendor.bank.account.set'), ['payment-details']);
  assert.deepEqual(effect('beneficiary.add'), ['payment-details']);
  assert.deepEqual(effect('payout.account.update'), ['money-out', 'payment-details']);
  assert.deepEqual(effect('payment.link.create'), ['money-out'], 'a payment link is not a change of payment details');
  assert.deepEqual(effect('invoice.issue'), ['send', 'issue']);
  assert.deepEqual(effect('document.finalize'), ['issue']);
  assert.deepEqual(effect('invoice.draft'), [], 'drafting is not issuing');
  // Deleting a scheduled job takes autonomy away, so it stays free.
  for (const name of ['schedule.delete', 'cron.job.remove', 'recurring.reminder.cancel', 'job.unschedule']) assert.deepEqual(effect(name), [], name);
  assert.deepEqual(floorOf({ phase: 'tool-call', name: 'schedule.delete', effect: 'outside-write' }), []);
  // Other words in the same name still count.
  assert.deepEqual(effect('scheduled.post.delete'), ['send']);
});

test('floor: the new kinds ask at every posture; a turn approval or practice consent never covers them', () => {
  const context = (over: Partial<PolicyContext> = {}): PolicyContext => ({ posture: 'auto-spot-check', approval: { kind: 'none' }, gates: { work: 'auto' }, stepsByTool: {}, ...over });
  for (const posture of POSTURES) {
    for (const approval of [{ kind: 'none' }, { kind: 'practice' }, { kind: 'owner-turn' }] as const) {
      for (const name of ['schedule.create', 'rule.add', 'payment.details.change', 'document.finalize']) {
        const asked = evaluateSync([ladderPolicy], { phase: 'outside-effect', name, digest: 'a'.repeat(64) }, context({ posture, approval }));
        assert.deepEqual(pick(asked), { verdict: 'ask', code: 'floor' }, `${name} at ${posture} with ${approval.kind}`);
        const call = evaluateSync([ladderPolicy], { phase: 'tool-call', name, effect: 'outside-write', inputDigest: 'd1' }, context({ posture, approval, stepsByTool: { [name]: ['work'] } }));
        assert.deepEqual(pick(call), { verdict: 'ask', code: 'floor' }, `tool call ${name} at ${posture} with ${approval.kind}`);
      }
    }
  }
  const unschedule = evaluateSync([ladderPolicy], { phase: 'tool-call', name: 'schedule.delete', effect: 'outside-write', inputDigest: 'd1' }, context({ stepsByTool: { 'schedule.delete': ['work'] } }));
  assert.deepEqual(pick(unschedule), { verdict: 'allow', code: 'auto' }, 'deleting a scheduled job runs alone on an auto step');
});

test('floor: argument values put an action on the floor, never take it off; a read label is still read word by word', () => {
  assert.deepEqual(effect('orders.update', { input: { notifyCustomer: true } }), ['send']);
  assert.deepEqual(effect('orders.update', { input: { archive: true } }), ['delete']);
  assert.deepEqual(effect('orders.update', { http: 'DELETE' }), ['delete']);
  assert.deepEqual(effect('invoice.update', { input: { finalize: true } }), ['issue']);
  assert.deepEqual(effect('payment.send', { input: { notifyCustomer: false } }), ['money-out']);
  assert.deepEqual(effect('payment.send', { input: { notifyCustomer: true } }), ['money-out', 'send']);
  assert.deepEqual(floorOf({ phase: 'tool-call', name: 'orders.refund', effect: 'read' }), ['money-out']);
  assert.deepEqual(floorOf({ phase: 'tool-call', name: 'files.read', effect: 'read', input: { target: 'f1', part: 'rows' } }), []);
});

test('floor: a draft that carries a flag to issue it for real fails loudly', () => {
  const context: PolicyContext = { posture: 'auto-spot-check', approval: { kind: 'owner-turn' }, gates: { work: 'auto' }, stepsByTool: { 'invoice.draft': ['work'] } };
  for (const input of [{ finalize: true }, { issue: true }, { status: 'issued' }, { options: { issueForReal: true } }]) {
    const denied = evaluateSync([ladderPolicy], { phase: 'tool-call', name: 'invoice.draft', effect: 'compute', inputDigest: 'd1', input }, context);
    assert.deepEqual(pick(denied), { verdict: 'deny', code: 'draft_issue_flag' }, JSON.stringify(input));
    assert.equal(denied.reason, 'This draft carries a flag to issue it for real. Drafting never issues; issuing is its own step and asks you first.');
  }
  const owner = { kind: 'owner-action' as const, digest: 'a'.repeat(64), memberId: 'owner' };
  assert.deepEqual(pick(evaluateSync([ladderPolicy], { phase: 'outside-effect', name: 'invoice.draft.save', digest: 'a'.repeat(64), input: { final: true } }, { ...context, approval: owner })), { verdict: 'deny', code: 'draft_issue_flag' });
  assert.deepEqual(pick(evaluateSync([ladderPolicy], { phase: 'tool-call', name: 'invoice.draft', effect: 'compute', inputDigest: 'd1', input: { issue: false } }, context)), { verdict: 'allow', code: 'auto' });
});

// ---------------------------------------------------------------------------
// 3. Review follow-ups: one word list, notify arguments, more floor words, the issue line
// ---------------------------------------------------------------------------

test('floor: send, money going out and deleting come from the one word list in effects.ts', () => {
  assert.ok(DESTRUCTIVE_WORDS.send.length > 0 && DESTRUCTIVE_WORDS.moneyOut.length > 0 && DESTRUCTIVE_WORDS.delete.length > 0);
  for (const word of DESTRUCTIVE_WORDS.send) assert.ok(effect(`crm.record.${word}`).includes('send'), word);
  for (const word of DESTRUCTIVE_WORDS.moneyOut) assert.ok(effect(`crm.record.${word}`).includes('money-out'), word);
  for (const word of DESTRUCTIVE_WORDS.delete) assert.ok(effect(`crm.record.${word}`).includes('delete'), word);
  for (const word of ['notify', 'invite', 'sms', 'whatsapp', 'forward', 'comment', 'broadcast']) assert.ok(DESTRUCTIVE_WORDS.send.includes(word), word);
  for (const word of ['charge', 'capture', 'checkout', 'remit', 'disburse']) assert.ok(DESTRUCTIVE_WORDS.moneyOut.includes(word), word);
  // A word in the list classifies the same way in effects.
  assert.ok(classifyEffects({ name: 'crm.record.invite' }).effects.includes('send'));
  assert.ok(classifyEffects({ name: 'card.capture' }).effects.includes('money'));
  // An invoice asks for money; it does not move it, so it is not on the money floor by its name alone.
  assert.deepEqual(effect('invoice.update'), []);
});

test('floor: what a connector can do comes from the catalogue, for actions Chausar does not declare', () => {
  assert.deepEqual(effect('whatsapp.thing', { connector: 'whatsapp' }), ['send']);
  assert.deepEqual(effect('razorpay.thing', { connector: 'razorpay' }), ['money-out']);
  assert.deepEqual(effect('notion.page.create', { connector: 'notion' }), []);
  assert.deepEqual(floorOf({ phase: 'tool-call', name: 'files.read', effect: 'read', connector: 'whatsapp' }), [], 'a Chausar tool keeps its own declaration');
});

test('effects and floor: notify arguments in any shape count as sending', () => {
  const sends = [
    { notify: { customer: true } }, { notify: { customer: false, email: 'true' } }, { send_receipt: true }, { notify_user: true },
    { NotifyCustomer: 'TRUE' }, { sendReceipt: 'true' }, { options: { notifyUsers: true } },
  ];
  for (const input of sends) {
    assert.ok(classifyEffects({ name: 'orders.view', input }).effects.includes('send'), JSON.stringify(input));
    assert.ok(effect('orders.view', { input }).includes('send'), JSON.stringify(input));
  }
  for (const input of [{ notify: { customer: false } }, { notifyCustomer: 'false' }, { notify: false }, { note: 'notify the customer later' }]) {
    assert.ok(!classifyEffects({ name: 'orders.view', input }).effects.includes('send'), JSON.stringify(input));
  }
});

test('floor: fund accounts, account numbers, automations, triggers, workflows and repeat rules always ask', () => {
  assert.deepEqual(effect('fund_account.create'), ['payment-details']);
  assert.deepEqual(effect('vendor.account_number.update'), ['payment-details']);
  assert.deepEqual(effect('vendor.update', { input: { account_number: '50100123456788' } }), ['payment-details']);
  assert.deepEqual(effect('vendor.update', { input: { ifsc: 'HDFC0001234' } }), ['payment-details']);
  assert.deepEqual(effect('vendor.update', { input: { beneficiary: { name: 'X' } } }), ['payment-details']);
  assert.deepEqual(effect('automation.create'), ['recurring-job']);
  assert.deepEqual(effect('zap.trigger.add'), ['recurring-job']);
  assert.deepEqual(effect('workflow.update'), ['recurring-job']);
  assert.deepEqual(effect('reminder.create', { input: { rrule: 'FREQ=WEEKLY;BYDAY=MO' } }), ['recurring-job']);
  assert.deepEqual(effect('reminder.create', { input: { recurrence: { every: 'week' } } }), ['recurring-job']);
  assert.deepEqual(effect('calendar.event.create', { input: { notes: 'RRULE:FREQ=DAILY' } }), ['recurring-job']);
  assert.deepEqual(effect('reminder.create', { input: { when: 'tomorrow' } }), []);
  // Stopping a scheduled job is free, but a name that stops one and makes another is not.
  assert.deepEqual(effect('schedule.delete_and_create'), ['delete', 'recurring-job']);
  assert.deepEqual(effect('automation.disable'), []);
});

test('ladder: issuing an invoice says it is issuing for real, beside the send line', () => {
  const asked = evaluateSync([ladderPolicy], { phase: 'outside-effect', name: 'invoice.issue', digest: 'a'.repeat(64) }, { posture: 'approve-each', approval: { kind: 'none' }, gates: {}, stepsByTool: {} });
  assert.deepEqual(pick(asked), { verdict: 'ask', code: 'floor' });
  assert.equal(asked.reason, `${FLOOR_WORDS.send} ${FLOOR_WORDS.issue}`);
  assert.equal(evaluateSync([ladderPolicy], { phase: 'outside-effect', name: 'payment.send', digest: 'a'.repeat(64) }, { posture: 'approve-each', approval: { kind: 'none' }, gates: {}, stepsByTool: {} }).reason, FLOOR_WORDS['money-out']);
});
