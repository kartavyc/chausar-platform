// Ink v2 wave 5, package 5A2: the sales proposal (catalogue P3 from revenue-squad's proposal skill, P2's pilot, P4's
// honest exit; ideas only). venture.salesProposal.draft {clientId | personId, offerId, pilot?} drafts a proposal with
// exactly five sections: What we heard, Roadmap, Investment, Next step, Open questions. Every amount under Investment is a
// price receipt from the owner's own list (a typed amount fails figures-resolve); a fact the records lack is a bracketed
// placeholder, and placeholders-listed fails unless each is repeated under Open questions; an unpriced offer refuses
// OFFER_UNPRICED. The owner approves it on Today after reading it; sending is the owner's own (mail, WhatsApp, LinkedIn
// copy): Chausar never sends it. The Producer is the owner's AI under the chat consent, or Chausar's own template.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { ClientRecord, InboundRecord, ModelPort, ModelTask, PriceReceiptRecord, QueueDecision, QueueItemView, QueueList, QueueRow } from '../runtime/venture/contracts.ts';
import type { SalesProposalView } from '../runtime/venture/playbooks/kit/records-sales.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers as playbooks } from '../runtime/venture/playbooks/index.ts';
import { handlers as money } from '../runtime/venture/money/index.ts';
import { handlers as agentHandlers } from '../runtime/venture/agents/index.ts';
import { chatConsentState } from '../runtime/venture/agents/consent.ts';
import { draftSalesProposal, proposalChecks, PROPOSAL_TITLES } from '../runtime/venture/playbooks/kit/proposal.ts';
import { FIXTURE } from './venture-kit-sales-fixture.ts';
import { CONTACTS, net, personNamed, withNetworkKey } from './venture-network-env.ts';
import { add, cardById, withPeople } from './venture-pipeline-env.ts';
import { ORDER_REQUEST, call, code, owner, phone, seedBlueprint, seedOrder, setup, type Env } from './venture-views-env.ts';

type Handler = (deps: Env['deps'], ctx: typeof owner, payload: unknown) => Promise<any>;
const draft = (env: Env, payload: Record<string, unknown>, ctx = owner) => (playbooks as Record<string, Handler>)['venture.salesProposal.draft'](env.deps, ctx, payload) as Promise<SalesProposalView>;
const get = (env: Env, payload: Record<string, unknown>) => (playbooks as Record<string, Handler>)['venture.salesProposal.get'](env.deps, owner, payload) as Promise<SalesProposalView>;
const receipt = (env: Env, id: string) => (money as Record<string, Handler>)['venture.receipt.get'](env.deps, owner, { id }) as Promise<PriceReceiptRecord>;
const queue = (env: Env) => call<QueueList>(env, 'venture.queue.list', {});
const decide = (env: Env, row: QueueRow, action: string, extra: Record<string, unknown> = {}) =>
  call<QueueDecision>(env, 'venture.queue.decide', { id: row.id, digest: row.digest, action, ...extra });
const proposals = (env: Env) => listRecords(env.store.read(), 'venture-sales-proposal');
const text = (view: SalesProposalView) => view.sections.map(section => section.lines.join('\n')).join('\n');

async function business(env: Env) {
  const blueprint = await seedBlueprint(env, { status: 'accepted' });
  const { client, order } = await seedOrder(env, blueprint);
  return { blueprint, client, order };
}

test('a proposal has exactly five sections; Investment is a price receipt from the owner\'s own list; a missing fact is a placeholder', async () => {
  const env = await setup();
  const { client } = await business(env);
  const made = await draft(env, { clientId: client.id, offerId: 'offer_1' });
  assert.ok(made.id);
  assert.equal(made.status, 'waiting');
  assert.equal(made.to, 'Cafe Aroma Demo');
  assert.equal(made.author, 'template');
  assert.equal(made.line, 'Drafted by Chausar from your records. Read it on Today and approve it; then you send it yourself. Chausar never sends it.');
  assert.deepEqual(made.sections.map(section => [section.id, section.title]), [
    ['heard', 'What we heard'], ['roadmap', 'Roadmap'], ['investment', 'Investment'], ['next', 'Next step'], ['questions', 'Open questions'],
  ]);
  assert.deepEqual(PROPOSAL_TITLES, ['What we heard', 'Roadmap', 'Investment', 'Next step', 'Open questions']);
  // What we heard: the client's own words from their newest order.
  assert.deepEqual(made.sections[0].lines, [`You asked: "${ORDER_REQUEST}"`]);
  // Roadmap: the plan's own steps for this offer.
  assert.deepEqual(made.sections[1].lines, ['Monthly books: Bank matching and a short monthly report.', 'Collect bills and bank statements', 'Sort and match every entry', 'Draft the monthly report for review', 'Send the report to the client']);

  // Investment: one price receipt the calculator made from the owner's own price, which venture.receipt.get serves.
  const [investment] = made.investment;
  assert.equal(investment.kind, 'price');
  if (investment.kind !== 'price') return;
  const proof = await receipt(env, investment.receiptId);
  assert.deepEqual(proof.subject, { type: 'offer', offerId: 'offer_1' });
  assert.equal(proof.inputs.unitPriceMinor, '249900');
  assert.equal(investment.totalMinor, proof.totalMinor);
  assert.equal(investment.display, proof.figures.find(figure => figure.key === 'total')!.display);
  assert.deepEqual(made.sections[2].lines, [`Monthly books: ${investment.display} per month`, proof.explanation]);

  // A fact the records lack is a placeholder, repeated under Open questions; every check passed.
  assert.deepEqual(made.placeholders, ['[the day you would like to start]']);
  assert.deepEqual(made.sections[3].lines, ['Reply to say yes, and we start on [the day you would like to start].']);
  assert.deepEqual(made.sections[4].lines, ['Please tell us [the day you would like to start].']);
  assert.deepEqual(made.checks.map(check => [check.id, check.passed]), [['required-sections', true], ['figures-resolve', true], ['placeholders-listed', true]]);
  assert.equal(made.exit, null);
  assert.equal(made.handoffs, null, 'nothing to send before the owner approves');
  assert.equal(proposals(env).length, 1);
  assert.equal((await get(env, { id: made.id! })).digest, made.digest);
  assert.equal((await get(env, { clientId: client.id })).id, made.id);
});

test('an unpriced offer refuses OFFER_UNPRICED, and a pilot of one PILOT_UNPRICED: a pilot is never free; nothing is stored', async () => {
  const env = await setup();
  const { client } = await business(env);
  await assert.rejects(draft(env, { clientId: client.id, offerId: 'offer_2' }), (error: any) => {
    assert.equal(error.code, 'OFFER_UNPRICED');
    assert.equal(error.message, 'Set your price for Catch up clean up before you draft a proposal for it.');
    return true;
  });
  await assert.rejects(draft(env, { clientId: client.id, offerId: 'offer_2', pilot: true }), (error: any) => {
    assert.equal(error.code, 'PILOT_UNPRICED');
    assert.equal(error.message, 'A pilot is never free. Set a price for it.');
    return true;
  });
  await assert.rejects(draft(env, { offerId: 'offer_1' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(draft(env, { clientId: client.id, personId: 'person_x', offerId: 'offer_1' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(draft(env, { clientId: 'client_missing', offerId: 'offer_1' }), code('CLIENT_NOT_FOUND'));
  await assert.rejects(draft(env, { clientId: client.id, offerId: 'offer_9' }), code('OFFER_NOT_FOUND'));
  await assert.rejects(get(env, { personId: 'person_none' }), code('PROPOSAL_NOT_FOUND'));
  assert.equal(proposals(env).length, 0);
});

test('a pilot proposal: the one-page pilot in the Roadmap, its after-pilot asks in the Next step, every gap an open question', async () => {
  const env = await setup();
  await business(env);
  const { asha } = await withPeople(env);
  const made = await draft(env, { personId: asha.id, offerId: 'offer_1', pilot: true });
  assert.equal(made.pilot, true);
  assert.equal(made.to, 'Asha Rao');
  assert.deepEqual(made.sections[0].lines, ['[what they told you they need]']);
  assert.deepEqual(made.sections[1].lines, [
    'Monthly books: Bank matching and a short monthly report.',
    'A paid pilot of Monthly books for [2 to 6 weeks], from [the day it starts].',
    'What we test: [the one thing we expect to change].',
    'Success: [what we measure], [the number you agree on], by [the date, inside the pilot].',
    'Time needed: [hours a week from you] from you, [hours a week from us] from us.',
    'May we mention you as a client? [may we mention you as a client: yes or no]',
  ]);
  assert.match(made.sections[2].lines[0], /^Pilot of Monthly books: INR [\d,]+\.\d\d per month$/);
  assert.deepEqual(made.sections[3].lines, [
    'Reply to say yes to the pilot, and we start on [the day it starts].',
    'After the pilot: A short case study, if the pilot meets its measure.',
    'After the pilot: An introduction to one business like yours.',
  ]);
  assert.equal(made.placeholders.length, 10);
  for (const placeholder of made.placeholders) assert.ok(made.sections[4].lines.includes(`Please tell us ${placeholder}.`), placeholder);
  assert.ok(made.checks.every(check => check.passed));
});

test('the checks: a typed amount fails figures-resolve, an unlisted placeholder fails placeholders-listed, a missing section fails', () => {
  const sections = (heard: string[], questions: string[]) => [
    { id: 'heard' as const, title: 'What we heard', lines: heard }, { id: 'roadmap' as const, title: 'Roadmap', lines: ['Bank matching'] },
    { id: 'investment' as const, title: 'Investment', lines: ['Monthly books: INR 2,948.82 per month'] },
    { id: 'next' as const, title: 'Next step', lines: ['Reply to say yes.'] }, { id: 'questions' as const, title: 'Open questions', lines: questions },
  ];
  const allowed = ['INR 2,948.82', 'INR 2,499.00'];
  const ok = proposalChecks(sections(['You want monthly books.'], []), allowed);
  assert.ok(ok.every(check => check.passed));
  for (const typed of ['It will save you INR 5,000.00 a month.', 'Only Rs 4999 for you.', 'We charge 3,000 rupees.', 'A ₹2,000 discount.']) {
    const checks = proposalChecks(sections([typed], []), allowed);
    const figures = checks.find(check => check.id === 'figures-resolve')!;
    assert.equal(figures.passed, false, typed);
    assert.match(figures.detail, /is not a price from your list/);
  }
  // The receipt's own figure may be repeated anywhere.
  assert.ok(proposalChecks(sections(['You saw INR 2,948.82 on the quote.'], []), allowed).every(check => check.passed));
  const unlisted = proposalChecks(sections(['You want [your current monthly enquiries] handled.'], []), allowed).find(check => check.id === 'placeholders-listed')!;
  assert.deepEqual([unlisted.passed, unlisted.detail], [false, 'Open questions must repeat [your current monthly enquiries].']);
  assert.ok(proposalChecks(sections(['You want [your current monthly enquiries] handled.'], ['Please tell us [your current monthly enquiries].']), allowed).every(check => check.passed));
  const missing = proposalChecks(sections(['x'], []).filter(section => section.id !== 'next'), allowed).find(check => check.id === 'required-sections')!;
  assert.deepEqual([missing.passed, missing.detail], [false, 'A proposal has exactly five sections: What we heard, Roadmap, Investment, Next step, Open questions.']);
});

test('Today: the owner reads it, then approves; only then does it hand off to mail, WhatsApp and LinkedIn, and Chausar sends nothing', async () => {
  const env = await setup();
  await business(env);
  await withPeople(env);
  await net(env, 'venture.network.import', { kind: 'contacts-csv', name: 'contacts.csv', text: CONTACTS });
  const asha = personNamed(env, 'Asha Rao');
  const made = await draft(env, { personId: asha.id, offerId: 'offer_1' });
  const row = (await queue(env)).rows.find(item => item.kind === 'proposal')!;
  assert.ok(row, 'the proposal waits on Today');
  assert.equal(row.title, 'Proposal for Asha Rao is ready');
  assert.equal(row.line, 'Monthly books. Read it, then approve it. You send it yourself; Chausar never sends it.');
  assert.deepEqual(row.viewRef, { kind: 'file', id: made.id });
  assert.deepEqual(row.actions.map(action => [action.id, action.primary, action.requiresView ?? false]), [['read', false, false], ['approve', true, true]]);
  const shown = await call<QueueItemView>(env, 'venture.queue.view', { id: row.id, opened: true });
  assert.deepEqual(shown.sections.map(section => section.heading), ['What we heard', 'Roadmap', 'Investment', 'Next step', 'Open questions']);

  // Not read in this version: refused. On the phone: refused (approvals are inside the app).
  await assert.rejects(call(env, 'venture.queue.decide', { id: row.id, digest: row.digest, action: 'approve', viewed: true }, phone), code('APP_APPROVAL_REQUIRED'));
  const done = await decide(env, row, 'approve', { viewed: true });
  assert.equal(done.outcome, 'done');
  assert.equal(done.line, 'Approved. Open it in Clients to send it yourself; Chausar never sends it.');
  assert.equal((await queue(env)).rows.filter(item => item.kind === 'proposal').length, 0);

  const approved = await get(env, { personId: asha.id });
  assert.equal(approved.status, 'approved');
  const actions = approved.handoffs!.map(handoff => handoff.action);
  assert.deepEqual(actions, ['mailto', 'whatsapp', 'linkedin']);
  const mail = approved.handoffs![0];
  assert.ok(mail.action === 'mailto' && mail.url.startsWith('mailto:asha@dewdrop.example?subject=') && mail.url.includes(encodeURIComponent('What we heard')));
  // Nothing went out: no outreach draft, no journal of a send.
  assert.equal(listRecords(env.store.read(), 'venture-outreach').length, 0);
});

test('the honest exit: an ask wholly outside drafts nothing and parks the person; one partly outside covers the in-scope part only', async () => {
  const env = await setup();
  await ventureAction(env.deps, owner, 'admin', 'test.idea', tx => { tx.touch({ idea: 'A fixture bookkeeping desk for small shops in Pune.' }); });
  await seedBlueprint(env, { status: 'accepted' });
  const { asha, rahul } = await withPeople(env);
  const card = (await add(env, asha)).card;
  const asked = (who: { id: string }, subject: string, from: string) => ventureAction(env.deps, owner, 'prepare', 'test.inbound', tx => tx.put<InboundRecord>({
    ...tx.base('venture-inbound'), messageId: `<${who.id}@mail>`, from, to: ['owner@ledger.example'], date: tx.now, subject, references: [], matched: null,
    triage: 'talking', line: subject, processed: true, screen: null, personId: who.id,
  } as InboundRecord));
  await asked(asha, 'Can you build a new website for my shop?', 'asha@dewdrop.example');

  const outside = await draftSalesProposal(env.deps, owner, { personId: asha.id, offerId: 'offer_1' }, { definitions: [FIXTURE] });
  assert.equal(outside.id, null);
  assert.equal(outside.status, 'outside');
  assert.deepEqual(outside.exit, {
    verdict: 'outside', rest: ['website'],
    reply: 'This is outside what we do. We can help with bookkeeping, bank reconciliation and gst returns. For website, a web designer or a lawyer near you can help.',
  });
  assert.equal(outside.line, 'This is outside what your business does, so nothing was drafted and Chausar will not follow up with them. Copy the reply if you want to answer.');
  assert.equal(proposals(env).length, 0);
  const parked = cardById(env, card.id);
  assert.deepEqual([parked.stage, parked.askAgainFrom], ['not-now', null]);

  await asked(rahul, 'Need monthly bookkeeping, and legal advice on our lease', 'rahul@ubtan.example');
  const partly = await draftSalesProposal(env.deps, owner, { personId: rahul.id, offerId: 'offer_1' }, { definitions: [FIXTURE] });
  assert.ok(partly.id);
  assert.equal(partly.status, 'waiting');
  assert.deepEqual(partly.exit, { verdict: 'partly', rest: ['legal advice'], reply: 'This is outside what we do. We can help with bookkeeping. For legal advice, a web designer or a lawyer near you can help.' });
  assert.deepEqual(partly.sections[0].lines, [
    'You asked: "Need monthly bookkeeping, and legal advice on our lease"',
    'This is outside what we do. We can help with bookkeeping. For legal advice, a web designer or a lawyer near you can help.',
  ]);
});

/** The owner's AI connected for chats, with its preview and answer scripted (as venture-outreach.test.ts does). */
function scriptAi(env: Env, respond: () => unknown): ModelTask<any>[] {
  const seen: ModelTask<any>[] = [];
  env.models.connected = true;
  const port = env.models as unknown as ModelPort;
  port.preview = async (_ctx, task) => {
    seen.push(task);
    return {
      callId: `call_${seen.length}`, payloadText: JSON.stringify(task.input), digest: 'a'.repeat(64), presetId: 'anthropic-sonnet-5-5', model: 'anthropic-sonnet-5-5',
      endpoint: 'test', estimatedMaxCostMicros: '0', estimatedMaxCostDisplay: 'USD 0.0000', expiresAt: env.now(),
    };
  };
  port.runPreview = async (_ctx, callId, _digest, validate) => ({
    value: validate(respond()), by: 'model', callId, presetId: 'anthropic-sonnet-5-5', model: 'anthropic-sonnet-5-5', costMicros: '0', priceConfirmed: true,
  });
  return seen;
}

test('the Producer: with the chat consent the owner\'s AI words What we heard and the Roadmap; words that fail a check fall back to Chausar\'s', async () => {
  const env = await setup();
  const { client } = await business(env);
  let answer: unknown = { heard: ['You want your September books closed from the bank statement and bills in the shared folder.'], roadmap: ['We collect your bills and statement.', 'We match every entry.', 'You get a short report to check.'] };
  const seen = scriptAi(env, () => answer);
  // Without the chat consent the AI is not asked: Chausar drafts it and says why.
  const unasked = await draft(env, { clientId: client.id, offerId: 'offer_1' });
  assert.equal(unasked.author, 'template');
  assert.equal(unasked.line, 'Drafted by Chausar from your records, because you have not agreed to what your AI is sent in Chats. Read it on Today and approve it; then you send it yourself. Chausar never sends it.');
  assert.equal(seen.length, 0);
  const { view } = chatConsentState(env.deps, owner, env.store.read(), env.venture);
  await (agentHandlers as Record<string, Handler>)['venture.chats.consent'](env.deps, owner, { digest: view.digest });

  const made = await draft(env, { clientId: client.id, offerId: 'offer_1' });
  assert.equal(made.author, 'model');
  assert.equal(made.line, 'Drafted by your AI and checked by Chausar. Read it on Today and approve it; then you send it yourself. Chausar never sends it.');
  assert.deepEqual(made.sections[0].lines, ['You want your September books closed from the bank statement and bills in the shared folder.']);
  assert.deepEqual(made.sections[1].lines, ['We collect your bills and statement.', 'We match every entry.', 'You get a short report to check.']);
  assert.equal(proposals(env).find(item => item.id === made.id)!.callId, 'call_1');
  assert.equal(seen[0].purpose, 'outreach-draft');
  assert.equal(seen[0].containsClientData, true);
  assert.ok(!JSON.stringify(seen[0].input).includes('249900') && !/2,948/.test(JSON.stringify(seen[0].input)), 'the AI never sees a price');
  // Investment stays the receipt's, whoever wrote the rest.
  assert.equal(made.investment[0].kind, 'price');

  // A typed amount in the AI's words is never kept: Chausar's own draft, and it says why.
  answer = { heard: ['You will save INR 5,000.00 a month with us.'], roadmap: ['We match every entry.', 'You get a short report to check.'] };
  const fallback = await draft(env, { clientId: client.id, offerId: 'offer_1' });
  assert.equal(fallback.author, 'template');
  assert.match(fallback.line, /^Your AI's words did not pass Chausar's checks: INR 5,000\.00 is not a price from your list\. This is Chausar's own draft\./);
  assert.ok(!text(fallback).includes('5,000.00'));
  // Any other number the records do not back, or words in the wrong shape, fall back the same way.
  answer = { heard: ['You run 12 cafes.'], roadmap: ['We match every entry.', 'You get a short report to check.'] };
  assert.match((await draft(env, { clientId: client.id, offerId: 'offer_1' })).line, /did not pass Chausar's checks: they held a number your records do not back\./);
  answer = { heard: 'one line', roadmap: [] };
  assert.match((await draft(env, { clientId: client.id, offerId: 'offer_1' })).line, /did not pass Chausar's checks: they came back in a shape Chausar refuses\./);
  // A price in words, in other digits, or tucked inside a placeholder, never stands in the AI's lines (English and Hindi).
  const priced: [string, RegExp][] = [
    ['Your budget is fifty thousand rupees.', /a number or a price in words/],
    ['Your budget is ₹५०,०००.', /a number your records do not back/],
    ['We start at [50000 per month].', /a number your records do not back/],
    ['आपका बजट पचास हज़ार है।', /a number or a price in words/],
    ['आपका बजट दो लाख है।', /a number or a price in words/],
    ['Sales could grow by two lakh.', /a number or a price in words/],
    ['We take a tenth, about ten percent, of what we save.', /a number or a price in words/],
    ['We keep a small percent of the refund.', /a number or a price in words/],
    ['Your budget is in the crores.', /a number or a price in words/],
  ];
  for (const [line, why] of priced) {
    answer = { heard: [line], roadmap: ['We match every entry.', 'You get a short report to check.'] };
    const kept = await draft(env, { clientId: client.id, offerId: 'offer_1' });
    assert.equal(kept.author, 'template', line);
    assert.match(kept.line, why, line);
  }
});

test('the client\'s own words may quote an amount: their quote is not checked as a price, so the proposal reaches Today', async () => {
  const env = await setup();
  await seedBlueprint(env, { status: 'accepted' });
  const client = await ventureAction(env.deps, owner, 'prepare', 'test.client', tx => tx.put<ClientRecord>({
    ...tx.base('venture-client'), name: 'Budget Cafe', email: 'owner@budget.example', countryCode: 'IN', taxId: null, stateCode: '27', note: 'Budget ₹20,000 for the October books.',
  }));
  const made = await draft(env, { clientId: client.id, offerId: 'offer_1' });
  assert.deepEqual(made.sections[0].lines, ['You asked: "Budget ₹20,000 for the October books."']);
  assert.ok(made.checks.every(check => check.passed), JSON.stringify(made.checks));
  assert.ok((await queue(env)).rows.some(row => row.kind === 'proposal' && row.title === 'Proposal for Budget Cafe is ready'));
  // Only the quoted words are let through: the same amount anywhere else is still a typed price.
  const sections = made.sections.map(section => section.id === 'roadmap' ? { ...section, lines: [...section.lines, 'Budget ₹20,000 for the October books.'] } : section);
  const priced = made.investment[0]!;
  const allowed = priced.kind === 'price' ? (await receipt(env, priced.receiptId)).figures.map(figure => figure.display) : [];
  assert.equal(proposalChecks(sections, allowed, made.sections[0].lines).find(check => check.id === 'figures-resolve')!.passed, false);
  assert.equal(proposalChecks(made.sections, allowed, made.sections[0].lines).find(check => check.id === 'figures-resolve')!.passed, true);
});

test('a pilot\'s agreed terms are recorded on the page: the window is 2 to 6 weeks and the success date falls inside it', async () => {
  const env = await setup();
  const { client } = await business(env);
  await assert.rejects(draft(env, { clientId: client.id, offerId: 'offer_1', pilot: { weeks: 8 } }), code('PILOT_WINDOW'));
  await assert.rejects(draft(env, { clientId: client.id, offerId: 'offer_1', pilot: { measure: { by: '2026-11-27' } } }), code('PILOT_WINDOW'));
  await assert.rejects(draft(env, { clientId: client.id, offerId: 'offer_1', pilot: { startsOn: '2026-11-02', weeks: 4, measure: { by: '2026-12-15' } } }), code('PILOT_WINDOW'));
  await assert.rejects(draft(env, { clientId: client.id, offerId: 'offer_1', pilot: { price: '1' } }), code('INVALID_VENTURE_REQUEST'));
  const made = await draft(env, { clientId: client.id, offerId: 'offer_1', pilot: {
    startsOn: '2026-11-02', weeks: 4, hypothesis: 'Matching the bank each week cuts month-end work', reference: true, ownerHours: 1, clientHours: 2,
    measure: { what: 'Hours you spend on month-end', target: 'under two hours', by: '2026-11-27' },
  } });
  assert.equal(made.pilot, true);
  assert.deepEqual(made.sections[1].lines.slice(1), [
    'A paid pilot of Monthly books for 4 weeks, from 2026-11-02 to 2026-11-30.',
    'What we test: Matching the bank each week cuts month-end work.',
    'Success: Hours you spend on month-end, under two hours, by 2026-11-27.',
    'Time needed: 2 hours a week from you, 1 hour a week from us.',
    'You agreed we may mention you as a client.',
  ]);
  assert.equal(made.sections[3].lines[0], 'Reply to say yes to the pilot, and we start on 2026-11-02.');
  assert.deepEqual(made.placeholders, []);
  assert.ok(made.checks.every(check => check.passed));
});

test('an offer priced as a share: Investment says the share in words, with no amount until the client confirms the base', async () => {
  const env = await setup();
  const { client } = await business(env);
  await ventureAction(env.deps, owner, 'admin', 'test.share', tx => {
    const plan = tx.list('venture-blueprint').find(item => item.status === 'accepted')!;
    tx.replace({ ...plan, offers: plan.offers.map(item => item.id === 'offer_2' ? { ...item, pricing: { ...item.pricing, share: { kind: 'share' as const, bps: '833', baseMinor: null, baseEvidenceFileId: null, words: '8.33% of the amount your client confirms' } } } : item) });
  });
  const made = await draft(env, { clientId: client.id, offerId: 'offer_2' });
  assert.deepEqual(made.investment, [{ kind: 'share', offerId: 'offer_2', offerName: 'Catch up clean up', bps: '833', words: '8.33% of the amount your client confirms' }]);
  assert.deepEqual(made.sections[2].lines, ['Catch up clean up: 8.33% of the amount your client confirms', 'Chausar\'s calculator works the amount out once you confirm it, with the file that shows it.']);
  assert.ok(made.checks.every(check => check.passed));
  assert.equal(listRecords(env.store.read(), 'venture-price-receipt').filter(item => item.subject.type === 'offer').length, 0, 'a share makes no price receipt until there is an amount');
});

test('Forget really deletes: proposals for them, for their client, and any that names them; others stay', async () => {
  const env = await setup();
  env.deps.secrets = withNetworkKey(env.deps.secrets);
  await business(env);
  const { asha, rahul } = await withPeople(env);
  const addClient = (name: string, note: string | null) => ventureAction(env.deps, owner, 'prepare', 'test.client', tx => tx.put<ClientRecord>({
    ...tx.base('venture-client'), name, email: null, countryCode: 'IN', taxId: null, stateCode: '27', note,
  }));
  const theirs = await addClient('Dewdrop Naturals', 'Monthly books from November.');
  await ventureAction(env.deps, owner, 'admin', 'test.link', tx => { tx.replace({ ...tx.find('venture-person', asha.id)!, clientId: theirs.id }); });
  const naming = await addClient('Ubtan Lab', 'Asha Rao told us they need monthly books.');
  await draft(env, { personId: asha.id, offerId: 'offer_1' });
  await draft(env, { clientId: theirs.id, offerId: 'offer_1' });
  await draft(env, { clientId: naming.id, offerId: 'offer_1' });
  const kept = await draft(env, { personId: rahul.id, offerId: 'offer_1' });
  assert.equal(proposals(env).length, 4);
  await net(env, 'venture.network.forget', { id: asha.id });
  assert.deepEqual(proposals(env).map(item => item.id), [kept.id]);
});

test('undoing an import deletes the proposals drafted for the people it brought, as their drafts go', async () => {
  const env = await setup();
  await business(env);
  const imported = await net<{ import: { id: string } }>(env, 'venture.network.import', { kind: 'contacts-csv', name: 'contacts.csv', text: CONTACTS });
  const asha = personNamed(env, 'Asha Rao');
  await draft(env, { personId: asha.id, offerId: 'offer_1' });
  assert.equal(proposals(env).length, 1);
  await net(env, 'venture.network.importUndo', { importId: imported.import.id });
  assert.equal(proposals(env).length, 0);
});

test('each client gets their own newest proposal, from their own words: an order request, else the note you keep on them', async () => {
  const env = await setup();
  const { client } = await business(env);
  const other = await ventureAction(env.deps, owner, 'prepare', 'test.client', tx => tx.put<ClientRecord>({
    ...tx.base('venture-client'), name: 'Second Cafe', email: null, countryCode: 'IN', taxId: null, stateCode: '27', note: 'Wants monthly books from next month.',
  }));
  const first = await draft(env, { clientId: client.id, offerId: 'offer_1' });
  const second = await draft(env, { clientId: other.id, offerId: 'offer_1' });
  assert.deepEqual(second.sections[0].lines, ['You asked: "Wants monthly books from next month."']);
  assert.equal(second.handoffs, null);
  assert.equal((await get(env, { clientId: client.id })).id, first.id);
  assert.equal((await get(env, { clientId: other.id })).id, second.id);
  await assert.rejects(get(env, { id: 'salesprop_missing' }), code('PROPOSAL_NOT_FOUND'));
});
