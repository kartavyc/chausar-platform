/**
 * Recovery through a contact (FR-13): the desktop module against the real composed hosted app on a disposable
 * PostgreSQL, joined by an in-process fetch. Only the outside providers (SMS, payment partner, WhatsApp, Postmark) are fakes.
 */
import test, { after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import type { Context } from '../runtime/contracts.ts';
import type { FetchReply } from '../runtime/hosted-link/client.ts';
import { buildHosted } from '../../hosted/app.ts';
import type { Fetch } from '../../hosted/shared/module.ts';
import { FakeOtpProvider } from '../../hosted/accounts/otp.ts';
import { FakePaymentPartner } from '../../hosted/billing/partner.ts';
import { mailChannel, whatsappChannel } from '../../hosted/relay/channels.ts';
import { RECOVERY_TEXT, hasDigit } from '../../hosted/shared/templates.ts';
import * as desktopTemplates from '../runtime/hosted-link/templates.ts';
import { installSyntheticProductionStorage } from './fixtures/synthetic-production-engine.ts';
import { postgresAvailable, freshDatabase, closeDatabases } from './hosted-link-pg.ts';

after(closeDatabases);
const pgSkip = postgresAvailable();
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const API = 'https://api.chausar.app', LINK = 'https://link.chausar.app', PHONE = '+919876543210';
const passphrase = 'Synthetic recovery test passphrase', newPassphrase = 'A new synthetic passphrase for recovery';
const CONTACT = { name: 'Asha Synthetic', reach: 'asha.contact@example.com' };

type Sent = { url: string; body: any };
async function setup(t: TestContext) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'chausar-hosted-recovery-')));
  const sql = await freshDatabase();
  let time = Date.parse('2026-10-14T06:00:00.000Z');
  const outbound: Sent[] = [];
  const providers: Fetch = async (url, init = {}) => {
    const body = JSON.parse(String(init.body)); outbound.push({ url, body });
    const text = url.startsWith('https://api.postmarkapp.com/') ? JSON.stringify({ ErrorCode: 0, MessageID: `pm-${'b'.repeat(outbound.length)}` })
      : JSON.stringify({ messaging_product: 'whatsapp', messages: [{ id: `wamid.HBgM${'A'.repeat(outbound.length)}` }] });
    return { status: 200, ok: true, headers: { get: () => null }, text: async () => text, arrayBuffer: async () => new ArrayBuffer(0) };
  };
  const otp = new FakeOtpProvider(), partner = new FakePaymentPartner();
  const app = buildHosted({ HOSTED_PEPPER: 'recovery-pepper-long-enough-for-the-server', LINK_ORIGIN: LINK, BILLING_PAID_PRICE_PAISE: '49900' },
    sql, providers, { clock: () => new Date(time), otp, partner, blobStore: null,
      relay: { whatsapp: whatsappChannel({ phoneNumberId: '106540352242922', accessToken: 'EAAGrecoverysyntheticaccesstoken' }), telegram: null,
        mail: mailChannel({ serverToken: 'synthetic-postmark-server-token', from: 'relay@chausar.app' }), prices: null, whatsappAppSecret: 'recovery-meta-app-secret', whatsappVerifyToken: 'verify' } });
  const requests: { method: string; path: string; body: string }[] = [];
  const bridge = async (url: string, init: { method: string; headers: Record<string, string>; body?: string | Uint8Array }): Promise<FetchReply> => {
    const target = new URL(url); assert.equal(target.origin, API);
    requests.push({ method: init.method, path: target.pathname, body: init.body === undefined ? '' : Buffer.from(init.body).toString('utf8') });
    const response = await app.router.handle({ method: init.method, url: target.pathname + target.search, headers: init.headers, body: init.body === undefined ? undefined : Buffer.from(init.body) });
    const raw = Buffer.from(typeof response.body === 'string' ? response.body : response.body === undefined ? '' : JSON.stringify(response.body));
    return { status: response.status, ok: response.status >= 200 && response.status < 300, headers: { get: name => name.toLowerCase() === 'content-length' ? String(raw.length) : null },
      text: async () => raw.toString('utf8'), arrayBuffer: async () => raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length) as ArrayBuffer };
  };
  const engine = new Engine({ directory, ...installSyntheticProductionStorage(directory, ['main', 'restored'], t.mock),
    modules: { 'hosted-link': { origin: API, linkOrigin: LINK, fetch: bridge, clock: () => new Date(time) } } });
  t.after(async () => { try { await engine.shutdown(); } finally { await rm(directory, { recursive: true, force: true }); } });
  const created = await engine.requestAs(owner, 'workspace.create', { name: 'Synthetic Recovery Shop', passphrase, pack: 'services' });
  const rpc = (method: string, payload: Record<string, unknown> = {}) => engine.requestAs(owner, method, payload);
  const page = (method: 'GET' | 'POST', token: string, choice?: string) => app.router.handle({ method, url: `/r/${token}`,
    headers: choice ? { 'content-type': 'application/x-www-form-urlencoded' } : {}, body: choice ? Buffer.from(`choice=${choice}`) : undefined });
  const credentialCall = (method: string, path: string, credential: string, body?: unknown) => app.router.handle({ method, url: path,
    headers: { authorization: `Bearer ${credential}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : Buffer.from(JSON.stringify(body)) });
  /** Every row of every table, as text: what the relay holds. */
  const dump = async () => {
    const { rows } = await sql.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`);
    let all = '';
    for (const { table_name: name } of rows) all += JSON.stringify((await sql.query(`SELECT row_to_json(t) AS r FROM "${name}" t`)).rows);
    return all;
  };
  const pairAndPay = async () => {
    const started = await rpc('hosted.pair.start', { phone: PHONE });
    await rpc('hosted.pair.finish', { challengeId: started.challengeId, code: otp.last(), deviceName: 'Shop computer' });
    const session = (engine.vault!.read().extensions!['hosted-link'] as any).pairing.sessionToken;
    const pay = await app.router.handle({ method: 'POST', url: '/v1/billing/checkout', headers: { 'content-type': 'application/json', authorization: `Bearer ${session}` }, body: Buffer.from(JSON.stringify({ plan: 'paid', idempotencyKey: 'recovery-checkout' })) });
    const event = partner.webhook({ eventId: 'evt_recovery', type: 'activated', checkoutId: (pay.body as any).checkoutId, subscriptionRef: 'sub_recovery', currentPeriodEnd: '2026-11-14T06:00:00.000Z' });
    assert.equal((await app.router.handle({ method: 'POST', url: '/v1/billing/webhooks/fake', headers: event.headers, body: event.body })).status, 200);
    await rpc('hosted.account.refresh');
  };
  const file = join(directory, 'recovery-contact', 'main.json');
  const lastMail = () => outbound.filter(c => c.url.startsWith('https://api.postmarkapp.com/')).at(-1)!.body;
  const tokenOf = (mail: any) => /\/r\/([A-Za-z]{48})$/m.exec(mail.TextBody)![1];
  const settle = async (requestId: string) => {
    for (let i = 0; i < 200; i++) {
      // While the vault transition runs, every request (this check too) is refused VAULT_BUSY: the caller keeps polling.
      const state = await rpc('hosted.recovery.check', { requestId }).catch(error => { if (error.code === 'VAULT_BUSY') return { status: 'recovering' }; throw error; });
      if (state.status !== 'recovering') return state;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error('recovery did not settle');
  };
  return { engine, app, sql, outbound, requests, rpc, page, credentialCall, dump, pairAndPay, file, lastMail, tokenOf, settle, directory,
    recoveryCode: created.recoveryCode as string, advance: (ms: number) => { time += ms; } };
}

test('a contact confirms and the locked vault opens with a new passphrase; K leaves the relay once', { skip: pgSkip }, async t => {
  const f = await setup(t);
  await f.pairAndPay();
  await f.rpc('phone.channels.set', { channel: 'whatsapp', enabled: true, optIn: true });
  const workspaceId = f.engine.vault!.read().workspace.id;

  const enrolled = await f.rpc('hosted.recovery.enrol', { recoveryCode: f.recoveryCode, contact: CONTACT });
  assert.deepEqual({ ...enrolled, enrolledAt: 'x' }, { enrolled: true, folder: 'main', contactChannel: 'mail', contactMasked: 'a•••@example.com', enrolledAt: 'x' });
  const status = await f.rpc('hosted.recovery.status');
  assert.equal(status.enrolled, true); assert.equal(status.local, true); assert.equal(status.relay.contactChannel, 'mail');

  // The two halves: the relay got K and never the code or the name; the file holds the code sealed, never K.
  const put = f.requests.find(r => r.method === 'PUT' && r.path === '/v1/recovery/enrolment')!;
  const sent = JSON.parse(put.body), key = Buffer.from(sent.key, 'base64');
  assert.equal(key.length, 32);
  assert.deepEqual(Object.keys(sent).sort(), ['contact', 'credentialSha256', 'key']);
  assert.deepEqual(sent.contact, { reach: CONTACT.reach });
  assert.equal(put.body.includes(f.recoveryCode), false); assert.equal(put.body.includes('Asha'), false);
  const text = await readFile(f.file, 'utf8'), local = JSON.parse(text);
  assert.equal((await stat(f.file)).mode & 0o777, 0o600);
  for (const form of [key.toString('base64'), key.toString('base64url'), key.toString('hex')]) assert.equal(text.includes(form), false, 'the file never holds K');
  assert.equal(text.includes(f.recoveryCode), false); assert.equal(text.includes('Asha'), false); assert.equal(text.includes(CONTACT.reach), false);
  assert.equal(local.workspaceId, workspaceId);
  let held = await f.dump();
  assert.equal(held.includes(f.recoveryCode), false, 'the relay never holds the recovery code');
  assert.equal(held.includes(f.recoveryCode.slice(4)), false);
  assert.equal(held.includes(sent.key), false, 'K is sealed at rest'); assert.equal(held.includes(CONTACT.reach), false, 'the contact is sealed at rest');
  assert.equal(held.includes(local.credential), false, 'only a keyed hash of the credential is kept');
  assert.equal(held.includes('Asha'), false);
  assert.equal(JSON.stringify(f.engine.vault!.read()).includes(f.recoveryCode), false, 'the vault keeps no copy');

  // Locked: the request goes out with the local credential, not a session.
  await f.rpc('workspace.lock');
  await assert.rejects(f.rpc('hosted.status'), { code: 'VAULT_LOCKED' });
  const asked = await f.rpc('hosted.recovery.request');
  assert.equal(asked.status, 'waiting'); assert.equal(asked.contactChannel, 'mail');
  assert.equal(f.requests.at(-1)!.body, '{}');
  await f.app.worker.runOnce(); await f.app.worker.runOnce(); await f.app.worker.runOnce();
  const mail = f.lastMail();
  assert.equal(mail.To, CONTACT.reach); assert.equal(mail.Subject, RECOVERY_TEXT.contactSubject);
  assert.equal(hasDigit(mail.Subject) || hasDigit(mail.TextBody) || hasDigit(mail.From), false, 'no digit in the contact\'s mail');
  assert.equal(/Asha|Synthetic|Shop/.test(JSON.stringify(mail)), false, 'no name in the contact\'s mail');
  assert.ok(mail.TextBody.startsWith(RECOVERY_TEXT.contactLine));
  const owners = f.outbound.filter(c => c.body.type === 'template' && c.body.template.name === 'chausar_recovery_requested');
  assert.equal(owners.length, 1, 'the owner\'s WhatsApp gets the fixed notice'); assert.equal(owners[0].body.to, PHONE.slice(1));
  assert.deepEqual(owners[0].body.template.components, []);
  assert.equal((await f.sql.query('SELECT sent FROM relay_months')).rows.reduce((n: number, r: any) => n + r.sent, 0), 0, 'recovery messages do not count against the thirty');

  assert.equal((await f.rpc('hosted.recovery.check', { requestId: asked.requestId })).status, 'waiting');
  await assert.rejects(f.rpc('hosted.recovery.complete', { requestId: asked.requestId, newPassphrase }), { code: 'RECOVERY_NOT_CONFIRMED' });

  // The contact's page: no data, Confirm and I did not ask; a decision counts once.
  const token = f.tokenOf(mail);
  const shown = await f.page('GET', token);
  assert.equal(shown.status, 200);
  assert.match(String(shown.body), /I did not ask/); assert.equal(/Asha|Synthetic|example/.test(String(shown.body)), false);
  assert.equal(hasDigit(String(shown.body).replace(/<style>.*<\/style>/, '').replace(/<meta[^>]*>/g, '')), false);
  assert.equal((await f.page('POST', token, 'maybe')).status, 410);
  assert.equal((await f.page('POST', token, 'confirm')).status, 200);
  assert.equal((await f.page('POST', token, 'decline')).status, 410, 'a used link no longer works');
  assert.equal((await f.page('GET', token)).status, 410);
  assert.equal((await f.rpc('hosted.recovery.check', { requestId: asked.requestId })).status, 'confirmed');

  // A weak passphrase is refused before K is fetched; then K comes once and the vault opens.
  await assert.rejects(f.rpc('hosted.recovery.complete', { requestId: asked.requestId, newPassphrase: 'short' }), { code: 'WEAK_PASSPHRASE' });
  const credential = local.credential;
  const started = await f.rpc('hosted.recovery.complete', { requestId: asked.requestId, newPassphrase });
  assert.deepEqual(started, { requestId: asked.requestId, status: 'recovering' });
  assert.equal((await f.settle(asked.requestId)).status, 'recovered');
  assert.equal((await f.engine.request('workspace.status')).open, true);
  assert.equal(f.engine.vault!.read().workspace.id, workspaceId);
  await assert.rejects(stat(f.file), { code: 'ENOENT' });
  for (const r of f.requests) assert.equal(r.body.includes(f.recoveryCode), false, 'the code never leaves this computer');

  const again = await f.credentialCall('POST', `/v1/recovery/requests/${asked.requestId}/release`, credential, {});
  assert.equal(again.status, 410); assert.equal((again.body as any).error.code, 'RECOVERY_KEY_RELEASED');
  held = await f.dump();
  assert.equal(held.includes(sent.key), false); assert.equal(held.includes(f.recoveryCode), false);
  assert.equal((await f.sql.query(`SELECT count(*)::int AS n FROM recovery_enrolments WHERE key_sealed IS NOT NULL OR contact_sealed IS NOT NULL`)).rows[0].n, 0, 'K and the address are deleted on release');

  await f.rpc('workspace.lock');
  await assert.rejects(f.engine.requestAs(owner, 'workspace.open', { folder: 'main', passphrase }), { code: 'UNLOCK_FAILED' });
  const opened = await f.engine.requestAs(owner, 'workspace.open', { folder: 'main', passphrase: newPassphrase });
  assert.equal(opened.workspace.id, workspaceId);
  assert.equal((await f.rpc('hosted.recovery.status')).enrolled, false, 'the enrolment is used up and must be redone');
});

test('a declined, replaced or expired request cannot complete; a wrong credential and too many requests are refused', { skip: pgSkip }, async t => {
  const f = await setup(t);
  await f.pairAndPay();
  await assert.rejects(f.rpc('hosted.recovery.enrol', { recoveryCode: 'CHR-short', contact: CONTACT }), { code: 'RECOVERY_CODE_INVALID' });
  await assert.rejects(f.rpc('hosted.recovery.enrol', { recoveryCode: f.recoveryCode, contact: { name: 'Asha', reach: '+15555550100' } }), { code: 'RECOVERY_CONTACT_INVALID' });
  await assert.rejects(f.rpc('hosted.recovery.enrol', { recoveryCode: f.recoveryCode, contact: CONTACT, folder: 'elsewhere' }), { code: 'RECOVERY_FOLDER_UNKNOWN' });
  await assert.rejects(f.rpc('hosted.recovery.request'), { code: 'RECOVERY_NOT_ENROLLED' });
  await f.rpc('hosted.recovery.enrol', { recoveryCode: f.recoveryCode, contact: CONTACT });
  const firstCredential = JSON.parse(await readFile(f.file, 'utf8')).credential;
  // Enrolling again replaces both halves: the first credential no longer works.
  await f.rpc('hosted.recovery.enrol', { recoveryCode: f.recoveryCode, contact: CONTACT });
  assert.notEqual(JSON.parse(await readFile(f.file, 'utf8')).credential, firstCredential);
  const refused = await f.credentialCall('POST', '/v1/recovery/requests', firstCredential, {});
  assert.equal(refused.status, 404); assert.equal((refused.body as any).error.code, 'RECOVERY_NOT_ENROLLED');
  const wrong = await f.credentialCall('POST', '/v1/recovery/requests', 'Q'.repeat(43), {});
  assert.equal(wrong.status, 401); assert.equal((wrong.body as any).error.code, 'RECOVERY_CREDENTIAL_INVALID');
  const session = (f.engine.vault!.read().extensions!['hosted-link'] as any).pairing.sessionToken;
  const bySession = await f.credentialCall('POST', '/v1/recovery/requests', session, {});
  assert.equal(bySession.status, 401, 'a session is not a request credential');
  await assert.rejects(f.rpc('hosted.recovery.complete', { requestId: 'rcr_00000000-0000-4000-8000-000000000000', newPassphrase }), { code: 'VAULT_OPEN' });
  await f.rpc('workspace.lock');

  // Declined.
  const one = await f.rpc('hosted.recovery.request');
  await f.app.worker.runOnce();
  assert.equal((await f.page('POST', f.tokenOf(f.lastMail()), 'decline')).status, 200);
  assert.equal((await f.rpc('hosted.recovery.check', { requestId: one.requestId })).status, 'declined');
  await assert.rejects(f.rpc('hosted.recovery.complete', { requestId: one.requestId, newPassphrase }), { code: 'RECOVERY_DECLINED' });

  // A newer request voids the older link.
  const two = await f.rpc('hosted.recovery.request');
  await f.app.worker.runOnce();
  const twoToken = f.tokenOf(f.lastMail());
  const three = await f.rpc('hosted.recovery.request');
  await f.app.worker.runOnce();
  assert.equal((await f.page('GET', twoToken)).status, 410);
  assert.equal((await f.page('POST', twoToken, 'confirm')).status, 410);
  assert.equal((await f.rpc('hosted.recovery.check', { requestId: two.requestId })).status, 'expired');
  await assert.rejects(f.rpc('hosted.recovery.request'), { code: 'RECOVERY_REQUEST_LIMITED' });

  // After a day the link and the request have expired.
  const threeToken = f.tokenOf(f.lastMail());
  f.advance(24 * 3600000 + 60000);
  assert.equal((await f.page('POST', threeToken, 'confirm')).status, 410);
  assert.equal((await f.rpc('hosted.recovery.check', { requestId: three.requestId })).status, 'expired');
  await assert.rejects(f.rpc('hosted.recovery.complete', { requestId: three.requestId, newPassphrase }), { code: 'RECOVERY_EXPIRED' });

  // The limit resets after a day; a tampered local credential is refused.
  const local = JSON.parse(await readFile(f.file, 'utf8'));
  await writeFile(f.file, JSON.stringify({ ...local, credential: 'Z'.repeat(43) }), { mode: 0o600 });
  await assert.rejects(f.rpc('hosted.recovery.request'), { code: 'RECOVERY_CREDENTIAL_INVALID' });
  await writeFile(f.file, JSON.stringify(local), { mode: 0o600 });
  const four = await f.rpc('hosted.recovery.request');
  assert.equal(four.status, 'waiting');
  // A revoked device's credential stops working.
  await f.sql.query('UPDATE devices SET revoked_at = now()');
  await assert.rejects(f.rpc('hosted.recovery.check', { requestId: four.requestId }), { code: 'RECOVERY_CREDENTIAL_INVALID' });
  assert.equal((await f.dump()).includes(f.recoveryCode), false);
});

test('a WhatsApp contact gets the fixed template with a letters-only link; removing revokes both halves', { skip: pgSkip }, async t => {
  const f = await setup(t);
  await f.pairAndPay();
  const enrolled = await f.rpc('hosted.recovery.enrol', { recoveryCode: f.recoveryCode, contact: { name: 'Ravi Synthetic', reach: '+919811122233' } });
  assert.equal(enrolled.contactChannel, 'whatsapp'); assert.equal(enrolled.contactMasked.includes('11122'), false);
  await f.rpc('workspace.lock');
  await f.rpc('hosted.recovery.request');
  await f.app.worker.runOnce();
  const sent = f.outbound.find(c => c.body.type === 'template' && c.body.template.name === 'chausar_recovery_confirm')!;
  assert.equal(sent.body.to, '919811122233');
  const parameter = sent.body.template.components[0].parameters[0].text;
  assert.match(parameter, /^[A-Za-z]{48}$/); assert.equal(hasDigit(parameter), false);
  assert.equal((await f.page('GET', parameter)).status, 200);
  const opened = await f.engine.requestAs(owner, 'workspace.open', { folder: 'main', passphrase });
  assert.ok(opened.workspace.id);
  assert.deepEqual(await f.rpc('hosted.recovery.remove'), { removed: true });
  await assert.rejects(stat(f.file), { code: 'ENOENT' });
  assert.equal((await f.page('GET', parameter)).status, 410, 'removing voids the open link');
  assert.equal((await f.rpc('hosted.recovery.status')).relay, null);
  assert.equal((await f.sql.query(`SELECT count(*)::int AS n FROM recovery_enrolments WHERE status = 'active'`)).rows[0].n, 0);
});

test('the recovery texts hold no digit and both catalogue copies agree', () => {
  for (const text of Object.values(RECOVERY_TEXT)) assert.equal(hasDigit(text), false, text);
  assert.deepEqual(desktopTemplates.RECOVERY_TEXT, RECOVERY_TEXT);
  assert.deepEqual(desktopTemplates.WHATSAPP_RECOVERY_TEMPLATE, { contact: 'chausar_recovery_confirm', owner: 'chausar_recovery_requested' });
});
