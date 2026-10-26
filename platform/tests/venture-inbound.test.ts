// Package 4E3 (Ink v2 wave 4, catalogue C10, C11, C15): inbound mail matched, triaged in code and read back. A reply
// matches a card by code's confidence (the card's address 0.7, a sent note's subject 0.2, within 30 days of a send 0.1;
// 0.65 or more and 0.15 ahead of the next card attaches, else the owner is asked) and moves nothing on its own. Triage
// runs before any model call: an opt-out (English or Hindi) puts the From address on the blocklist for good and closes
// the card as Lost only when the receiving server proved the mail (DKIM or DMARC pass), else the owner is asked; an
// automatic reply is ignored and pushes the follow-up out; a one-word thanks needs nothing; a delivery report about an
// address Chausar wrote to in the last 30 days bounces it (5.x.x) or holds it 90 days (4.x.x), and a dead domain is
// the owner's call; price, a contract, a meeting or buying make a reply row the owner answers; "are you a bot" gets one
// fixed honest draft; anything else proposes Talking, which the owner confirms on Today. Identity goes email, then
// LinkedIn address, then name and company.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { InboundRecord, QueueDecision, QueueList, QueueRow } from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { localDayAt } from '../runtime/venture/local-day.ts';
import { cardsOf, findCard, planOf } from '../runtime/venture/network/pipeline.ts';
import { BOT_ANSWER, BOT_ANSWER_HI, domainWarning, HINDI_REVIEW, MATCH, pickMatch, triageMail } from '../runtime/venture/network/inbound.ts';
import { replyRows } from '../runtime/venture/network/inbound-rows.ts';
import { HINDI_UNSUBSCRIBE_LINE } from '../runtime/venture/network/outreach-templates.ts';
import { readHeaders, trustedAuthServ } from '../runtime/venture/network/mail-text.ts';
import { call, code, owner, phone } from './venture-views-env.ts';
import { add, recordSent } from './venture-pipeline-env.ts';
import { connect, inbound, mail, mailCall, mailEnv, passed, sentTo, sync, type MailEnv } from './venture-mailbox-env.ts';

const queue = (env: MailEnv) => call<QueueList>(env, 'venture.queue.list', {});
const replyRowsOf = async (env: MailEnv): Promise<QueueRow[]> => (await queue(env)).rows.filter(row => row.kind === 'reply');
const decide = (env: MailEnv, row: QueueRow, action: string) => call<QueueDecision>(env, 'venture.queue.decide', { id: row.id, digest: row.digest, action });
const today = (env: MailEnv) => localDayAt(env.now(), env.venture.country);
const cardOf = (env: MailEnv, id: string) => findCard(cardsOf(env.store.read(), env.venture, today(env)), id)!;
const blocked = (env: MailEnv) => {
  const settings = listRecords(env.store.read(), 'venture-lead-settings')[0];
  return [...(settings?.blockedEmails ?? []), ...(settings?.blockedDomains ?? [])];
};

/** A connected mailbox with Asha's card: a cold email "Gift boxes for Diwali" sent on 13 Oct. */
async function withAsha(unsubscribe?: string) {
  const env = await mailEnv();
  await connect(env);
  const card = await sentTo(env, env.asha, { subject: 'Gift boxes for Diwali', on: '2026-10-13', ...(unsubscribe ? { unsubscribe } : {}) });
  return { env, card };
}

/** One message from someone, delivered and synced. */
async function receive(env: MailEnv, input: { from?: string; subject?: string; body: string; date?: string; headers?: string[]; contentType?: string }) {
  const date = input.date ?? '2026-10-14T06:00:00Z';
  env.imap.deliver(mail({ from: input.from ?? 'Asha Rao <asha@dewdrop.example>', subject: input.subject ?? 'Re: Gift boxes for Diwali', date, body: input.body, headers: input.headers, contentType: input.contentType }), date);
  return sync(env);
}
const last = (env: MailEnv): InboundRecord => inbound(env).at(-1)!;

/** A delivery report (RFC 3464) about one or more addresses. */
function report(recipients: [string, string][] | string, status?: string): { from: string; subject: string; body: string; contentType: string; headers: string[] } {
  const list: [string, string][] = typeof recipients === 'string' ? [[recipients, status!]] : recipients;
  const blocks = list.flatMap(([address, code]) => ['', `Final-Recipient: rfc822; ${address}`, `Action: ${code.startsWith('4') ? 'delayed' : 'failed'}`, `Status: ${code}`]);
  return {
    from: 'Mail Delivery System <mailer-daemon@mail.example>', subject: 'Undelivered Mail Returned to Sender', headers: ['Auto-Submitted: auto-replied'],
    contentType: 'multipart/report; report-type=delivery-status; boundary="rep1"',
    body: ['--rep1', 'Content-Type: text/plain', '', 'Your message could not be delivered.', '--rep1', 'Content-Type: message/delivery-status', '',
      'Reporting-MTA: dns; mail.example', ...blocks, '--rep1--'].join('\n'),
  };
}

test('a reply matches its card by code: 0.7 for the address, 0.2 for the subject, 0.1 within 30 days; it moves nothing until the owner says so', async () => {
  const { env, card } = await withAsha();
  await receive(env, { body: 'They look lovely. Tell me more.' });
  const record = last(env);
  assert.deepEqual(record.matched, { opportunityId: card.id, confidenceBp: MATCH.address + MATCH.subject + MATCH.recent });
  assert.equal(record.triage, 'talking');
  assert.equal(record.processed, false);
  assert.equal(cardOf(env, card.id).stage, 'asked', 'nothing moves on its own');
  const [row] = await replyRowsOf(env);
  assert.equal(row.title, 'Asha wrote back. Move the card to Talking?');
  assert.deepEqual(row.actions.map(item => [item.id, item.label, item.primary]), [['approve', 'Move to Talking', true], ['deny', 'Not now', false]]);
  assert.equal(row.reply!.reason, 'talking');
  assert.equal(row.reply!.opportunityId, card.id);
  const done = await decide(env, row, 'approve');
  assert.equal(done.outcome, 'done');
  const moved = cardOf(env, card.id);
  assert.equal(moved.stage, 'talking');
  assert.equal(moved.history.at(-1)!.evidence.kind, 'reply');
  assert.equal(moved.history.at(-1)!.evidence.id, record.id);
  assert.equal(planOf(moved), null, 'a reply stops the follow-ups');
  assert.deepEqual(await replyRowsOf(env), []);
  // Another subject still attaches by address and time alone: 0.8.
  await receive(env, { subject: 'Packaging', body: 'Also, the ribbons.', date: '2026-10-15T05:00:00Z' });
  assert.equal(last(env).matched!.confidenceBp, MATCH.address + MATCH.recent);
});

test('the floor and the margin: 0.65 or more, and 0.15 ahead of the next card, or the owner is asked', () => {
  assert.equal(pickMatch([{ opportunityId: 'a', confidenceBp: 7000 }, { opportunityId: 'b', confidenceBp: 6000 }]), null, 'too close to the next');
  assert.deepEqual(pickMatch([{ opportunityId: 'a', confidenceBp: 8000 }, { opportunityId: 'b', confidenceBp: 6500 }]), { opportunityId: 'a', confidenceBp: 8000 });
  assert.equal(pickMatch([{ opportunityId: 'a', confidenceBp: 6000 }]), null, 'below the floor');
  assert.deepEqual(pickMatch([{ opportunityId: 'a', confidenceBp: 6500 }]), { opportunityId: 'a', confidenceBp: 6500 });
  assert.equal(pickMatch([]), null);
});

test('identity: email first, then a LinkedIn address in the mail, then name and company; below the floor the owner confirms on Today', async () => {
  const env = await mailEnv();
  await connect(env);
  const priya = await sentTo(env, env.priya, { subject: 'Your stall at the Pune expo', on: '2026-10-13' });
  const { card: rahulCard } = await add(env, env.rahul);
  // The address wins over the name: this is Asha's address with Priya's name on it.
  await receive(env, { from: 'Priya Nair <asha@dewdrop.example>', subject: 'Hi', body: 'Hello there, a note.' });
  assert.equal(last(env).personId, env.asha.id);
  // Priya from another address: her name and her company in the signature. Not sure enough: the owner is asked.
  await receive(env, { from: 'Priya Nair <priya.nair@gmail.example>', subject: 'Re: Your stall at the Pune expo', body: 'Yes, interested in a chat.\n\nPriya Nair\nBuyer, Acme Foods' });
  const fromPriya = last(env);
  assert.equal(fromPriya.personId, env.priya.id);
  assert.equal(fromPriya.matched, null);
  assert.deepEqual(fromPriya.candidates, [{ opportunityId: priya.id, confidenceBp: MATCH.subject + MATCH.recent }]);
  let rows = await replyRowsOf(env);
  const confirm = rows.find(row => row.reply!.inboundId === fromPriya.id)!;
  assert.equal(confirm.title, 'Is this from Priya about Acme Foods?');
  assert.deepEqual(confirm.actions.map(item => item.label), ['Yes, it is', 'No']);
  assert.equal((await decide(env, confirm, 'approve')).outcome, 'done');
  assert.deepEqual(inbound(env).find(item => item.id === fromPriya.id)!.matched, { opportunityId: priya.id, confidenceBp: MATCH.subject + MATCH.recent });
  rows = await replyRowsOf(env);
  assert.ok(rows.some(row => row.reply!.inboundId === fromPriya.id && row.reply!.reason === 'talking'), 'the move to Talking still waits for the owner');
  // Rahul has no address in the network: his LinkedIn address in the signature says who he is.
  await receive(env, { from: 'Rahul Mehta <rm@gmail.example>', subject: 'Hello', body: 'Good to meet you.\n--\nwww.linkedin.com/in/rahulmehta' });
  const fromRahul = last(env);
  assert.equal(fromRahul.personId, env.rahul.id);
  assert.deepEqual(fromRahul.candidates, [{ opportunityId: rahulCard.id, confidenceBp: 0 }]);
  // No: kept apart from every card.
  const rahulRow = (await replyRowsOf(env)).find(row => row.reply!.inboundId === fromRahul.id)!;
  assert.equal((await decide(env, rahulRow, 'deny')).line, 'Kept apart from your cards. Nothing moved.');
  assert.equal(inbound(env).find(item => item.id === fromRahul.id)!.processed, true);
});

test('venture.inbound.confirm: the owner attaches a mail to an open card, in the app; a closed card or an unknown mail is refused', async () => {
  const env = await mailEnv();
  await connect(env);
  const priya = await sentTo(env, env.priya, { subject: 'Stall', on: '2026-10-13' });
  await receive(env, { from: 'Priya Nair <priya.nair@gmail.example>', subject: 'Re: Stall', body: 'Sure, call me.\nPriya Nair, Acme Foods' });
  const record = last(env);
  await assert.rejects(mailCall(env, 'venture.inbound.confirm', { id: record.id, opportunityId: priya.id }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(mailCall(env, 'venture.inbound.confirm', { id: 'inbound_missing', opportunityId: priya.id }), code('INVALID_VENTURE_REQUEST'));
  const { item } = await mailCall<any>(env, 'venture.inbound.confirm', { id: record.id, opportunityId: priya.id });
  assert.deepEqual(item.matched, { opportunityId: priya.id, name: 'Priya Nair' });
  const { card: closed } = await mailCall<any>(env, 'venture.pipeline.move', { id: priya.id, stage: 'lost', reason: 'no-budget' });
  await assert.rejects(mailCall(env, 'venture.inbound.confirm', { id: record.id, opportunityId: closed.id }), code('PIPELINE_STAGE_CLOSED'));
  const list = await mailCall<any>(env, 'venture.inbound.list', {});
  assert.equal(list.items[0].id, record.id);
});

test('an opt-out the receiving server proved (DKIM or DMARC pass) blocks the From address and closes the card as Lost; no row, no model', async () => {
  for (const words of ['Please remove me from your list.', 'कृपया मुझे दोबारा मत भेजो।', 'STOP', 'mat bhejo please']) {
    const { env, card } = await withAsha();
    let asked = 0;
    const preview = env.deps.models.preview.bind(env.deps.models);
    env.deps.models.preview = async (ctx, task) => { asked += 1; return preview(ctx, task); };
    const result = await receive(env, { body: words, headers: [passed('dewdrop.example')] });
    assert.equal(last(env).triage, 'opt-out', words);
    assert.equal(last(env).processed, true);
    assert.deepEqual(blocked(env), ['asha@dewdrop.example'], words);
    const closed = cardOf(env, card.id);
    assert.equal(closed.stage, 'lost');
    assert.equal(closed.lostReason, 'opted-out');
    assert.equal(closed.history.at(-1)!.evidence.line, 'Lost: they asked not to be contacted.');
    assert.equal(last(env).line, 'Asha asked not to be contacted. Blocked asha@dewdrop.example and closed their card as Lost.');
    assert.match(result.line, /asked not to be contacted/);
    assert.deepEqual(await replyRowsOf(env), []);
    assert.equal(asked, 0, 'triage is code: no model was asked');
    // The opt-out list holds: the closed card takes no more sends.
    await assert.rejects(recordSent(env, card.id, { on: '2026-10-15', channel: 'own-mailbox' }), code('PIPELINE_STAGE_CLOSED'));
  }
});

test('an opt-out the server did not prove blocks the From address at once; closing the card is the owner\'s call', async () => {
  const { env, card } = await withAsha();
  await receive(env, { body: 'Unsubscribe me.', headers: ['Authentication-Results: mx.mail.example; dkim=fail header.d=dewdrop.example; dmarc=fail header.from=dewdrop.example'] });
  assert.deepEqual(blocked(env), ['asha@dewdrop.example']);
  assert.equal(cardOf(env, card.id).stage, 'asked', 'not closed on an unproved mail');
  assert.equal(cardOf(env, card.id).blocked, true, 'but blocked, so nothing more goes to them');
  assert.equal(last(env).line, 'Asha asked not to be contacted. Blocked asha@dewdrop.example. The mail could not be proved to be theirs, so closing the card waits for you.');
  const [row] = await replyRowsOf(env);
  assert.equal(row.title, 'Asha asked not to be contacted. Close the card as Lost?');
  assert.deepEqual(row.actions.map(item => [item.id, item.label, item.primary]), [['approve', 'Close as Lost', true], ['deny', 'Keep the card', false]]);
  assert.equal(row.reply!.reason, 'opt-out');
  assert.equal((await decide(env, row, 'approve')).line, 'Closed the card as Lost.');
  assert.equal(cardOf(env, card.id).lostReason, 'opted-out');
  assert.equal(last(env).processed, true);
});

test('a pass from a server that is not the mailbox provider, or a pass naming no domain, proves nothing (the forged-header probe)', async () => {
  for (const header of [
    'Authentication-Results: evil.example; dkim=pass header.d=dewdrop.example; dmarc=pass header.from=dewdrop.example',
    'Authentication-Results: mx.mail.example; dkim=pass; dmarc=pass',
    'Authentication-Results: mx.mail.example; dkim=pass header.d=other.example; dmarc=pass header.from=other.example',
  ]) {
    const { env, card } = await withAsha();
    await receive(env, { body: 'Unsubscribe me.', headers: [header] });
    assert.equal(cardOf(env, card.id).stage, 'asked', header);
    assert.deepEqual((await replyRowsOf(env)).map(row => row.reply!.reason), ['opt-out'], header);
  }
  const gmail = trustedAuthServ('imap.gmail.com');
  assert.deepEqual([gmail('mx.google.com'), gmail('evil.example'), gmail('google.com.evil.example')], [true, false, false]);
  assert.deepEqual([trustedAuthServ('imap.zoho.in')('mx.zoho.in'), trustedAuthServ('mail.acme.co.in')('mx.acme.co.in'), trustedAuthServ('mail.acme.co.in')('mx.co.in')], [true, true, false]);
});

test('an opt-out matched by name or LinkedIn blocks the address it came from, and asks before blocking the person\'s own', async () => {
  const env = await mailEnv();
  await connect(env);
  const priya = await sentTo(env, env.priya, { subject: 'Your stall', on: '2026-10-13' });
  await receive(env, { from: 'Priya Nair <priya.nair@gmail.example>', subject: 'Re: Your stall', body: 'Please unsubscribe me.\n\nPriya Nair\nBuyer, Acme Foods', headers: [passed('gmail.example')] });
  assert.deepEqual(blocked(env), ['priya.nair@gmail.example'], 'only the address it came from');
  assert.equal(last(env).line, 'Priya asked not to be contacted from priya.nair@gmail.example. Blocked priya.nair@gmail.example.');
  assert.equal(cardOf(env, priya.id).stage, 'asked');
  const [row] = await replyRowsOf(env);
  assert.equal(row.title, 'Priya asked not to be contacted. Block priya@acme.example and close the card too?');
  assert.deepEqual(row.actions.map(item => item.label), ['Block and close', 'Not now']);
  assert.equal((await decide(env, row, 'approve')).line, 'Blocked priya@acme.example and closed the card as Lost.');
  assert.deepEqual(blocked(env).sort(), ['priya.nair@gmail.example', 'priya@acme.example']);
  assert.equal(cardOf(env, priya.id).stage, 'lost');
});

test('the opt-out list is kept for good through Forget, while Forget removes their inbound mail, a delivery report about them included', async () => {
  const { env } = await withAsha();
  await receive(env, { body: 'Unsubscribe me, thanks.', headers: [passed('dewdrop.example')] });
  await receive(env, { ...report('asha@dewdrop.example', '4.4.7'), date: '2026-10-14T09:00:00Z' });
  assert.equal(inbound(env).length, 2);
  await mailCall(env, 'venture.network.forget', { id: env.asha.id });
  assert.deepEqual(inbound(env), [], 'their mail is gone');
  assert.deepEqual(blocked(env), ['asha@dewdrop.example'], 'their opt-out stays');
});

test('words that only look like an opt-out, and our own unsubscribe lines (English, Hindi, or the footer sent on the card), are not one', async () => {
  const footer = 'Reply STOP and we will not write to you again.';
  const { env } = await withAsha(footer);
  await receive(env, { body: 'Can you stop by the shop when you are in town?' });
  assert.notEqual(last(env).triage, 'opt-out');
  await receive(env, { body: 'Sounds good to me.\n\nOn Tue, 13 Oct 2026, Owner <owner@ledger.example> wrote:\n> To stop these emails, reply with the word unsubscribe and we will not write to you again.', date: '2026-10-14T07:00:00Z' });
  assert.equal(last(env).triage, 'talking');
  await receive(env, { body: `Interesting, send details.\n${footer}`, date: '2026-10-14T08:00:00Z' });
  assert.equal(last(env).triage, 'talking', 'the footer the owner sent, pasted back unquoted');
  await receive(env, { body: `विवरण भेजिए, अच्छा लगा।\n${HINDI_UNSUBSCRIBE_LINE}`, date: '2026-10-14T09:00:00Z' });
  assert.notEqual(last(env).triage, 'opt-out', 'the Hindi footer');
  assert.deepEqual(blocked(env), []);
});

test('an opt-out is read before an automatic reply\'s subject or words', async () => {
  const { env } = await withAsha();
  await receive(env, { subject: 'Automatic reply: Gift boxes for Diwali', body: 'Please unsubscribe me.', headers: [passed('dewdrop.example')] });
  assert.equal(last(env).triage, 'opt-out');
  const header = triageMail({ headers: readHeaders('Auto-Submitted: auto-replied\r\n\r\n'), subject: 'Re: hi', text: 'Thank you for your mail.', report: false });
  assert.equal(header.triage, 'auto-reply');
});

test('an automatic reply or out-of-office is ignored and pushes the next follow-up a week past it', async () => {
  const { env, card } = await withAsha();
  const before = planOf(cardOf(env, card.id));
  assert.deepEqual(before, { kind: 'nudge', step: 0, due: '2026-10-19', channel: 'email' }, 'a first email: 5 days, Sunday moves to Monday');
  await receive(env, { subject: 'Automatic reply: Gift boxes for Diwali', body: 'I am out of the office until Monday with limited access to email.', date: '2026-10-15T06:00:00Z' });
  assert.equal(last(env).triage, 'auto-reply');
  assert.equal(last(env).processed, true);
  assert.deepEqual(planOf(cardOf(env, card.id)), { kind: 'nudge', step: 0, due: '2026-10-22', channel: 'email' }, 'a week after the reply of 15 Oct');
  assert.equal(cardOf(env, card.id).stage, 'asked');
  assert.deepEqual(await replyRowsOf(env), []);
});

test('a one-word thanks needs nothing, in English or Hindi, and does not stop the follow-ups', async () => {
  for (const words of ['Thanks!', 'धन्यवाद', 'Thank you so much']) {
    const { env, card } = await withAsha();
    await receive(env, { body: words });
    assert.equal(last(env).triage, 'thanks', words);
    assert.equal(last(env).processed, true);
    assert.ok(last(env).matched, 'matched to the card');
    assert.deepEqual(await replyRowsOf(env), []);
    assert.deepEqual(planOf(cardOf(env, card.id)), { kind: 'nudge', step: 0, due: '2026-10-19', channel: 'email' }, words);
  }
});

test('delivery reports count only for an address Chausar wrote to in the last 30 days; each address in one report is handled', async () => {
  const env = await mailEnv();
  await connect(env);
  // Forged, or about mail Chausar never sent: Priya was never written to, so nothing happens.
  await receive(env, report('priya@acme.example', '5.1.1'));
  assert.deepEqual(inbound(env), []);
  assert.deepEqual(blocked(env), []);
  const asha = await sentTo(env, env.asha, { subject: 'Gift boxes', on: '2026-10-13' });
  await sentTo(env, env.priya, { subject: 'Your stall', on: '2026-10-12' });
  const before = env.published.length;
  await receive(env, { ...report([['asha@dewdrop.example', '5.1.1'], ['priya@acme.example', '4.4.7']]), date: '2026-10-14T07:00:00Z' });
  const record = last(env);
  assert.equal(record.triage, 'bounce');
  assert.deepEqual(record.bounces, [
    { address: 'asha@dewdrop.example', status: '5.1.1', scope: 'address', until: null },
    { address: 'priya@acme.example', status: '4.4.7', scope: 'suppress', until: '2027-01-12' },
  ]);
  assert.deepEqual(blocked(env), ['asha@dewdrop.example']);
  assert.equal(cardOf(env, asha.id).blocked, true);
  assert.equal(planOf(cardOf(env, asha.id)), null, 'no follow-up to a bounced address');
  assert.ok(env.published.slice(before).flat().some(event => event.name === 'pipeline.changed' && (event.data as any)?.id === asha.id), 'the board hears the card is blocked');
  // A report about a stranger is never kept.
  await receive(env, { ...report('nobody@else.example', '5.1.1'), date: '2026-10-14T08:00:00Z' });
  assert.equal(inbound(env).length, 1);
});

test('a dead domain (5.1.2 or 5.4.4) blocks the address and asks before blocking the whole domain', async () => {
  const env = await mailEnv();
  await connect(env);
  const priya = await sentTo(env, env.priya, { subject: 'Your stall', on: '2026-10-13' });
  await receive(env, report('priya@acme.example', '5.1.2'));
  assert.deepEqual(blocked(env), ['priya@acme.example'], 'never the domain on its own');
  assert.equal(last(env).processed, false);
  const [row] = await replyRowsOf(env);
  assert.equal(row.title, 'acme.example takes no mail. Block the whole domain?');
  assert.deepEqual(row.actions.map(item => item.label), ['Block the domain', 'Only the address']);
  assert.equal(row.reply!.reason, 'bounce-domain');
  assert.equal((await decide(env, row, 'approve')).line, 'Blocked acme.example.');
  assert.deepEqual(blocked(env).sort(), ['acme.example', 'priya@acme.example']);
  assert.equal(cardOf(env, priya.id).blocked, true);
  // The row says why to take care: a free mail service, or others who use the domain.
  assert.equal(domainWarning(env.store.read(), env.venture, 'gmail.com', 'x@gmail.com'), 'gmail.com is a free mail service many people use. Blocking it blocks all of them.');
  assert.equal(domainWarning(env.store.read(), env.venture, 'dewdrop.example', 'other@dewdrop.example'), '1 other person in your network uses dewdrop.example.');
});

test('price, a contract, a meeting or buying: a reply row with a code-built line, the owner replies themselves', async () => {
  const cases: [string, string][] = [
    ['What would 200 boxes cost?', 'Asha asked about pricing. Reply yourself.'],
    ['इसकी कीमत क्या होगी?', 'Asha asked about pricing. Reply yourself.'],
    ['Please send the contract over.', 'Asha asked about a contract. Reply yourself.'],
    ['Can we meet on Friday?', 'Asha asked to meet. Reply yourself.'],
    ['We want to go ahead with 50 boxes.', 'Asha wants to buy. Reply yourself.'],
  ];
  for (const [words, title] of cases) {
    const { env, card } = await withAsha();
    let asked = 0;
    const preview = env.deps.models.preview.bind(env.deps.models);
    env.deps.models.preview = async (ctx, task) => { asked += 1; return preview(ctx, task); };
    await receive(env, { body: words });
    assert.equal(last(env).triage, 'owner-reply', words);
    const [row] = await replyRowsOf(env);
    assert.equal(row.title, title, words);
    assert.deepEqual(row.actions.map(item => [item.id, item.label, item.primary]), [['open', 'Reply in Mail', true], ['approve', 'Move to Talking', false]]);
    assert.equal(row.reply!.reason, 'owner-reply');
    assert.equal(row.reply!.from, 'asha@dewdrop.example');
    assert.equal(asked, 0, 'these skip any agent');
    assert.equal(cardOf(env, card.id).stage, 'asked');
  }
  // Two topics: the first leads, the others are named.
  const { env } = await withAsha();
  await receive(env, { body: 'What is your rate, and can we schedule a call?' });
  const [row] = await replyRowsOf(env);
  assert.equal(row.title, 'Asha asked about pricing. Reply yourself.');
  assert.match(row.line!, /It also mentions a meeting\./);
  assert.deepEqual(row.reply!.topics, ['price', 'meeting']);
  assert.equal((await decide(env, row, 'open')).line, 'Reply to Asha from your own mail app. Chausar never sends mail.');
});

test('"are you a bot" gets one fixed honest draft, in Hindi for a reply in Hindi (marked for a native reviewer)', async () => {
  assert.equal(BOT_ANSWER, 'I use an AI assistant to help draft messages, and I read and send every one myself.');
  assert.equal(BOT_ANSWER_HI, 'संदेश लिखने में एक AI सहायक मेरी मदद करता है, और हर संदेश को खुद पढ़कर खुद भेजना मेरा अपना काम है।');
  assert.equal(HINDI_REVIEW, 'machine-drafted, needs a native reviewer');
  const { env } = await withAsha();
  await receive(env, { body: 'Quick question: are you a bot?' });
  const [row] = await replyRowsOf(env);
  assert.equal(row.title, 'Asha asked if you are a bot. A reply is drafted.');
  assert.equal(row.reply!.draft, BOT_ANSWER);
  assert.ok(row.line!.includes(BOT_ANSWER));
  const hindi = await withAsha();
  await receive(hindi.env, { body: 'क्या आप बॉट हैं?' });
  const [hindiRow] = await replyRowsOf(hindi.env);
  assert.equal(hindiRow.reply!.draft, BOT_ANSWER_HI);
});

test('a reply the owner set aside (Done or Not now) does not stop the follow-ups', async () => {
  const { env, card } = await withAsha();
  await receive(env, { body: 'And the price?' });
  assert.equal(planOf(cardOf(env, card.id)), null, 'their reply stops the follow-ups while it waits');
  const [row] = await replyRowsOf(env);
  await mailCall(env, 'venture.pipeline.move', { id: card.id, stage: 'talking', evidence: { kind: 'note', on: '2026-10-14' } });
  const [done] = await replyRowsOf(env);
  assert.deepEqual(done.actions.map(item => item.label), ['Reply in Mail', 'Done']);
  assert.notEqual(done.id, row.id);
  // On a card still at Asked, Not now on a talking row sets it aside and the follow-ups come back.
  const second = await withAsha();
  await receive(second.env, { body: 'Lovely, tell me more.' });
  const [talking] = await replyRowsOf(second.env);
  assert.equal((await decide(second.env, talking, 'deny')).line, 'Done. The card stays where it is.');
  assert.deepEqual(planOf(cardOf(second.env, second.card.id)), { kind: 'nudge', step: 0, due: '2026-10-19', channel: 'email' });
});

test('a reply whose row can no longer exist is marked processed, so unread means unread', async () => {
  const { env, card } = await withAsha();
  await receive(env, { body: 'Lovely, tell me more.' });
  const [row] = await replyRowsOf(env);
  await mailCall(env, 'venture.pipeline.move', { id: card.id, stage: 'talking', evidence: { kind: 'note', on: '2026-10-14' } });
  assert.deepEqual(await replyRowsOf(env), [], 'the card is at Talking already: nothing waits');
  assert.notEqual((await decide(env, row, 'approve')).outcome, 'done', 'the old row is stale');
  await sync(env);
  assert.equal(inbound(env)[0].processed, true);
});

test('a business still in its interview (no country yet) has no reply rows, and its mailbox waits for a country', async () => {
  const { env } = await withAsha();
  await receive(env, { body: 'And the price?' });
  const interview = { ...env.venture, country: null as never };
  assert.deepEqual(replyRows(env.deps, owner, env.store.read(), interview), []);
  await ventureAction(env.deps, owner, 'approve', 'test.country', tx => { tx.touch({ country: null as never }); });
  await assert.rejects(sync(env), code('INVALID_VENTURE_REQUEST'));
  assert.deepEqual((await mailCall<any>(env, 'venture.inbound.list', {})).items, []);
  assert.deepEqual(await replyRowsOf(env), []);
});
