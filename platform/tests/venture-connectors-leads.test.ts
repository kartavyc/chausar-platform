// P2-connectors: the customer engine's lead rules. A lead needs the page it was seen on; an email counts as verified
// only after an MX lookup finds a mail server (a fake resolver here, never the network); the blocklist is checked before
// any draft; agents only draft, and the owner records each real send. The footer rule (Ink v2 wave 4, 4E2): a cold
// email carries an unsubscribe line and the business postal address, and none is made without the address; a warm note
// to a tie of Know or better carries no footer, nor does a LinkedIn or WhatsApp note. The lead list drafts cold email.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { Context } from '../runtime/contracts.ts';
import { VENTURE_ERRORS } from '../runtime/venture/contracts.ts';
import { houseStyleFindings } from '../runtime/venture/records.ts';
import {
  DEFAULT_UNSUBSCRIBE_LINE, addToBlocklist, checkEmail, coldOutreach, createLead, draftOutreach, isBlocked, optOut, outreachFooter, parseBlocklist, recordSend,
  verifyLeadEmail, withFooter, type MxResolver,
} from '../runtime/venture/customers/leads.ts';

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const agentCtx: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'mcp' };
const code = (expected: string) => (error: any) => { assert.equal(error.code, expected, error.message); return true; };
const at = '2026-10-21T10:00:00.000Z';
const BUSINESS = { name: 'Lumen Studio', postalAddress: '12 Lake Road, Pune 411001, India' };

const resolver = (answers: Record<string, { exchange: string; priority: number }[] | 'error' | 'hang'>): MxResolver & { asked: string[] } => {
  const asked: string[] = [];
  const fn = (async (domain: string) => {
    asked.push(domain);
    const answer = answers[domain];
    if (answer === 'hang') return new Promise(() => {});
    if (answer === 'error' || answer === undefined) throw Object.assign(new Error('queryMx ENOTFOUND'), { code: 'ENOTFOUND' });
    return answer;
  }) as MxResolver & { asked: string[] };
  fn.asked = asked;
  return fn;
};

const lead = (overrides: Record<string, unknown> = {}) => createLead({
  name: 'Asha Rao', company: 'Blue Cafe', email: 'Asha@BlueCafe.example', sourceUrl: 'https://bluecafe.example/contact', ...overrides,
}, { by: 'agent:prospector', at });

test('a lead needs the page it was seen on', () => {
  assert.throws(() => lead({ sourceUrl: undefined }), code('LEADS_SOURCE_REQUIRED'));
  assert.throws(() => lead({ sourceUrl: '' }), code('LEADS_SOURCE_REQUIRED'));
  assert.throws(() => lead({ sourceUrl: 'not a url' }), code('LEADS_SOURCE_REQUIRED'));
  assert.throws(() => lead({ sourceUrl: 'file:///C:/leads.txt' }), code('LEADS_SOURCE_REQUIRED'));
  assert.throws(() => lead({ email: 'not-an-email' }), code('INVALID_VENTURE_REQUEST'));
  const made = lead();
  assert.equal(made.email, 'asha@bluecafe.example');
  assert.equal(made.emailDomain, 'bluecafe.example');
  assert.equal(made.emailCheck.status, 'unverified');
  assert.equal(made.status, 'new');
});

test('a lead\'s source page is stored without user info or secret-looking query values (W1 H17)', () => {
  const stored = lead({ sourceUrl: 'https://scout:hunter2@bluecafe.example/contact?ref=maps&token=abcdef123456&page=2' }).sourceUrl;
  assert.ok(!stored.includes('scout') && !stored.includes('hunter2') && !stored.includes('abcdef123456'), stored);
  assert.equal(stored, 'https://bluecafe.example/contact?ref=maps&token=%5Bredacted%20secret%5D&page=2');
  assert.equal(lead().sourceUrl, 'https://bluecafe.example/contact', 'an ordinary page is kept as it is');
  // The address still names the page, so the blocklist check and the draft work on it as before.
  assert.equal(new URL(stored).hostname, 'bluecafe.example');
});

test('an email is verified only when the MX lookup finds a mail server; a failure, a null MX or a timeout never counts', async () => {
  const dns = resolver({
    'bluecafe.example': [{ exchange: 'mx1.bluecafe.example', priority: 10 }],
    'nomail.example': [{ exchange: '.', priority: 0 }],
    'empty.example': [],
    'slow.example': 'hang',
  });
  const ok = await verifyLeadEmail(lead(), { resolver: dns, now: at });
  assert.equal(ok.emailCheck.status, 'verified');
  assert.deepEqual(dns.asked, ['bluecafe.example']);
  for (const email of ['a@nomail.example', 'a@empty.example', 'a@missing.example', 'a@slow.example']) {
    const checked = await verifyLeadEmail(lead({ email }), { resolver: dns, now: at, timeoutMs: 20 });
    assert.equal(checked.emailCheck.status, 'failed', email);
  }
  const timedOut = await verifyLeadEmail(lead({ email: 'a@slow.example' }), { resolver: dns, now: at, timeoutMs: 20 });
  assert.match(timedOut.emailCheck.line, /timed out/);
  const noEmail = await verifyLeadEmail(lead({ email: undefined }), { resolver: dns, now: at });
  assert.equal(noEmail.emailCheck.status, 'failed');
});

test('the blocklist is checked before drafting, ahead of every other rule', async () => {
  const blocklist = parseBlocklist('# opt-outs\nbluecafe.example\nsomeone@else.example  # asked to stop\n\n');
  assert.ok(isBlocked(blocklist, 'ASHA@bluecafe.example'));
  assert.ok(isBlocked(blocklist, 'someone@else.example'));
  assert.ok(!isBlocked(blocklist, 'other@else.example'));
  const unverified = lead();
  // Blocked comes first: even an unverified lead with no address is refused as blocked.
  assert.throws(() => draftOutreach(unverified, { subject: 'Hello', body: 'Hi Asha', by: 'agent', business: { name: 'Lumen Studio', postalAddress: '' }, blocklist, at }), code('LEADS_BLOCKED'));
});

test('drafts need a verified email and the postal address, and always carry the unsubscribe line and the address', async () => {
  const blocklist = parseBlocklist('');
  const dns = resolver({ 'bluecafe.example': [{ exchange: 'mx1.bluecafe.example', priority: 10 }] });
  assert.throws(() => draftOutreach(lead(), { subject: 'Hello', body: 'Hi Asha', by: 'agent', business: BUSINESS, blocklist, at }), code('LEADS_EMAIL_UNVERIFIED'));
  const verified = await verifyLeadEmail(lead(), { resolver: dns, now: at });
  for (const postalAddress of ['', '   ', undefined]) {
    assert.throws(() => draftOutreach(verified, { subject: 'Hello', body: 'Hi Asha', by: 'agent', business: { name: 'Lumen Studio', postalAddress } as any, blocklist, at }), code('LEADS_ADDRESS_MISSING'));
  }
  const { lead: drafted, draft } = draftOutreach(verified, { subject: 'Bookkeeping for Blue Cafe', body: 'Hi Asha,\nWe keep the books for cafes in Pune.', by: 'agent', business: BUSINESS, blocklist, at });
  assert.equal(draft.to, 'asha@bluecafe.example');
  assert.equal(draft.by, 'agent');
  assert.ok(draft.text.startsWith('Hi Asha,\nWe keep the books for cafes in Pune.'));
  assert.ok(draft.text.includes(BUSINESS.postalAddress));
  assert.ok(draft.text.includes(DEFAULT_UNSUBSCRIBE_LINE));
  assert.equal(draft.sourceUrl, 'https://bluecafe.example/contact');
  assert.equal(drafted.status, 'drafted');
  assert.equal(drafted.sends.length, 0, 'a draft is not a send');
  const custom = draftOutreach(verified, { subject: 'Hi', body: 'Hi', by: 'owner', business: { ...BUSINESS, unsubscribeLine: 'Reply STOP and we will not write again.' }, blocklist, at });
  assert.ok(custom.draft.text.includes('Reply STOP and we will not write again.'));
});

test('the footer rule (C20): cold email gets the unsubscribe line and the postal address; a warm note to Know or better, and LinkedIn or WhatsApp, get none', async () => {
  for (const band of [null, 'cold', 'met-once'] as const) assert.equal(coldOutreach({ kind: 'follow-up', channel: 'email', band }), true, String(band));
  for (const band of ['know', 'know-well', 'close'] as const) {
    assert.equal(coldOutreach({ kind: 'follow-up', channel: 'email', band }), false, band);
    assert.equal(coldOutreach({ kind: 'cold-email', channel: 'email', band }), true, `a cold email is cold even to someone you know (${band})`);
  }
  for (const channel of ['linkedin', 'whatsapp'] as const) assert.equal(coldOutreach({ kind: 'connection-note', channel, band: null }), false, channel);
  // A warm note needs no address; a cold one is refused without it.
  assert.equal(outreachFooter({ kind: 'intro-request', channel: 'email', band: 'know-well', business: { name: 'Lumen Studio', postalAddress: '' } }), null);
  assert.throws(() => outreachFooter({ kind: 'follow-up', channel: 'email', band: 'met-once', business: { name: 'Lumen Studio', postalAddress: ' ' } }), code('LEADS_ADDRESS_MISSING'));
  const footer = outreachFooter({ kind: 'cold-email', channel: 'email', band: 'know', business: BUSINESS })!;
  assert.deepEqual(footer, { businessName: 'Lumen Studio', postalAddress: BUSINESS.postalAddress, unsubscribe: DEFAULT_UNSUBSCRIBE_LINE });
  assert.equal(withFooter('Hi Asha.\n', footer), `Hi Asha.\n\n--\nLumen Studio\n${BUSINESS.postalAddress}\n${DEFAULT_UNSUBSCRIBE_LINE}`);
  assert.equal(withFooter(' Hi Asha. ', null), 'Hi Asha.');
  // The mail server check of one address, as a lead's is (a person's cold email uses it).
  const dns = resolver({ 'bluecafe.example': [{ exchange: 'mx1.bluecafe.example', priority: 10 }] });
  assert.equal((await checkEmail('asha@bluecafe.example', { resolver: dns, now: at })).status, 'verified');
  assert.equal((await checkEmail('asha@missing.example', { resolver: dns, now: at })).status, 'failed');
  assert.equal((await checkEmail(null, { resolver: dns, now: at })).line, 'No email to check.');
});

test('agents only draft: only the owner, inside the app, records a real send; an opt-out blocks the lead for good', async () => {
  const dns = resolver({ 'bluecafe.example': [{ exchange: 'mx1.bluecafe.example', priority: 10 }] });
  let blocklist = parseBlocklist('');
  const verified = await verifyLeadEmail(lead(), { resolver: dns, now: at });
  const { lead: drafted, draft } = draftOutreach(verified, { subject: 'Hello', body: 'Hi Asha', by: 'agent', business: BUSINESS, blocklist, at });
  assert.throws(() => recordSend(drafted, { draftId: draft.id, sentAt: at }, agentCtx, at), code('APP_APPROVAL_REQUIRED'));
  assert.throws(() => recordSend(drafted, { draftId: draft.id, sentAt: at }, { ...owner, role: 'accountant' }, at), code('APP_APPROVAL_REQUIRED'));
  assert.throws(() => recordSend(drafted, { draftId: 'draft_missing', sentAt: at }, owner, at), code('INVALID_VENTURE_REQUEST'));
  assert.throws(() => recordSend(drafted, { draftId: draft.id, sentAt: '2026-10-22T10:00:00.000Z' }, owner, at), code('INVALID_VENTURE_REQUEST'));
  const sent = recordSend(drafted, { draftId: draft.id, sentAt: at }, owner, at);
  assert.equal(sent.status, 'contacted');
  assert.deepEqual(sent.sends.map(s => [s.draftId, s.recordedBy]), [[draft.id, 'owner']]);

  const out = optOut(sent, blocklist, { by: 'owner', at });
  blocklist = out.blocklist;
  assert.equal(out.lead.status, 'blocked');
  assert.ok(isBlocked(blocklist, 'asha@bluecafe.example'));
  assert.throws(() => draftOutreach(out.lead, { subject: 'Again', body: 'Hi', by: 'agent', business: BUSINESS, blocklist, at }), code('LEADS_BLOCKED'));
  assert.throws(() => recordSend(out.lead, { draftId: draft.id, sentAt: at }, owner, at), code('LEADS_BLOCKED'));
  assert.ok(isBlocked(addToBlocklist(blocklist, 'Other.Example'), 'x@other.example'));
});

test('static: leads.ts sends nothing, throws only declared codes and keeps the house style', async () => {
  const source = await readFile(new URL('../runtime/venture/customers/leads.ts', import.meta.url), 'utf8');
  for (const match of source.matchAll(/'([A-Z]+(?:_[A-Z]+)+)'/g)) assert.ok((VENTURE_ERRORS as readonly string[]).includes(match[1]), match[1]);
  assert.doesNotMatch(source, /fetch\(|node:net|node:tls|node:http|smtp|nodemailer|sendMail/i);
  assert.ok(!source.includes('\u2014'));
  assert.deepEqual(houseStyleFindings(source), []);
});
