import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Router, type HostedResponse } from '../../hosted/shared/http.ts';
import { JobQueue } from '../../hosted/db/queue.ts';
import { FREE_ENTITLEMENTS } from '../../hosted/shared/auth.ts';
import type { Fetch, HostedDeps } from '../../hosted/shared/module.ts';
import { authenticator, createAccountsModule } from '../../hosted/accounts/module.ts';
import { FakeOtpProvider, TwilioSmsOtpProvider, UnconfiguredOtpProvider, otpMessage, type OtpProvider } from '../../hosted/accounts/otp.ts';
import { accountsConfig } from '../../hosted/accounts/config.ts';
import { postgresAvailable, freshDatabase, closeDatabases } from './hosted-link-pg.ts';

after(closeDatabases);
const pgSkip = postgresAvailable();
const PEPPER = 'pepper-for-accounts-tests-only-0123456789';
const PHONE = '+919876543210';
const MINUTE = 60000, DAY = 24 * 3600000;

function recordingFetch(replies: ({ status: number; body: string } | Error)[]) {
  const calls: { url: string; init: Parameters<Fetch>[1] }[] = [];
  const fetch: Fetch = async (url, init) => {
    calls.push({ url, init });
    const reply = replies.shift();
    if (!reply) throw new Error('no recorded reply');
    if (reply instanceof Error) throw reply;
    return { status: reply.status, ok: reply.status >= 200 && reply.status < 300, headers: { get: () => null }, text: async () => reply.body, arrayBuffer: async () => new ArrayBuffer(0) };
  };
  return { fetch, calls };
}
const refusingFetch: Fetch = async () => { throw new Error('network is not allowed in tests'); };

async function setup(otp: OtpProvider = new FakeOtpProvider()) {
  const sql = await freshDatabase();
  let now = new Date('2026-10-14T10:00:00.000Z');
  const clock = () => now;
  const entitlements = async () => ({ ...FREE_ENTITLEMENTS });
  const deps: HostedDeps = { sql, clock, queue: new JobQueue(sql, clock), fetch: refusingFetch, pepper: PEPPER, linkOrigin: 'https://link.example.invalid', authenticate: authenticator(sql, PEPPER, clock), entitlements };
  const module = createAccountsModule(deps, { otp, entitlements });
  const router = new Router(); module.routes(router);
  const call = (method: string, url: string, body?: unknown, token?: string): Promise<HostedResponse & { body: any }> => router.handle({
    method, url, body: body === undefined ? undefined : Buffer.from(JSON.stringify(body)),
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
  }) as any;
  const fake = otp as FakeOtpProvider;
  const signIn = async (phone = PHONE, deviceName = 'Shop counter PC') => {
    const started = await call('POST', '/v1/accounts/otp/start', { phone });
    assert.equal(started.status, 202);
    const verified = await call('POST', '/v1/accounts/otp/verify', { challengeId: started.body.challengeId, code: fake.last(), deviceName });
    assert.equal(verified.status, 200, JSON.stringify(verified.body));
    return verified.body as { accountId: string; deviceId: string; sessionToken: string; expiresAt: string };
  };
  return { sql, module, call, signIn, fake, advance(ms: number) { now = new Date(now.getTime() + ms); }, now: () => now };
}
const code = (response: { body: any }) => response.body?.error?.code;

test('start, verify, me and revoke', { skip: pgSkip }, async () => {
  const t = await setup();
  const started = await t.call('POST', '/v1/accounts/otp/start', { phone: PHONE });
  assert.equal(started.status, 202);
  assert.match(started.body.challengeId, /^otp_[0-9a-f-]{36}$/);
  assert.equal(started.body.expiresAt, '2026-10-14T10:05:00.000Z');
  assert.deepEqual(Object.keys(started.body).sort(), ['challengeId', 'expiresAt']);
  assert.equal(t.fake.sent.length, 1); assert.equal(t.fake.sent[0].phone, PHONE); assert.match(t.fake.sent[0].code, /^[0-9]{6}$/);

  const verified = await t.call('POST', '/v1/accounts/otp/verify', { challengeId: started.body.challengeId, code: t.fake.last(), deviceName: '  Shop counter PC ' });
  assert.equal(verified.status, 200);
  const first = verified.body;
  assert.match(first.accountId, /^acct_[0-9a-f-]{36}$/); assert.match(first.deviceId, /^dev_[0-9a-f-]{36}$/);
  assert.match(first.sessionToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(first.expiresAt, '2026-11-13T10:00:00.000Z');

  // Only keyed hashes are stored.
  const { rows: [challenge] } = await t.sql.query('SELECT code_hash, used_at FROM otp_challenges');
  assert.notEqual(challenge.code_hash, t.fake.last()); assert.ok(challenge.used_at);
  const { rows: sessions } = await t.sql.query('SELECT token_hash FROM sessions');
  assert.equal(sessions.length, 1); assert.notEqual(sessions[0].token_hash, first.sessionToken);
  assert.equal(JSON.stringify(sessions).includes(first.sessionToken), false);

  t.advance(MINUTE);
  const second = await t.signIn(PHONE, 'Back office laptop');
  assert.equal(second.accountId, first.accountId, 'the same phone signs in to the same account');
  assert.notEqual(second.deviceId, first.deviceId);

  t.advance(2 * MINUTE);
  const me = await t.call('GET', '/v1/accounts/me', undefined, first.sessionToken);
  assert.equal(me.status, 200);
  assert.deepEqual(me.body, {
    accountId: first.accountId, phone: PHONE, plan: 'free', entitlements: { ...FREE_ENTITLEMENTS },
    devices: [
      { deviceId: first.deviceId, deviceName: 'Shop counter PC', createdAt: '2026-10-14T10:00:00.000Z', lastSeenAt: '2026-10-14T10:03:00.000Z', current: true },
      { deviceId: second.deviceId, deviceName: 'Back office laptop', createdAt: '2026-10-14T10:01:00.000Z', lastSeenAt: '2026-10-14T10:01:00.000Z', current: false },
    ],
  });

  const revoked = await t.call('POST', `/v1/accounts/devices/${second.deviceId}/revoke`, {}, first.sessionToken);
  assert.deepEqual(revoked, { status: 200, body: { deviceId: second.deviceId, revokedAt: '2026-10-14T10:03:00.000Z' } });
  const gone = await t.call('GET', '/v1/accounts/me', undefined, second.sessionToken);
  assert.equal(gone.status, 401); assert.equal(code(gone), 'UNAUTHENTICATED');
  t.advance(MINUTE);
  const again = await t.call('POST', `/v1/accounts/devices/${second.deviceId}/revoke`, {}, first.sessionToken);
  assert.equal(again.body.revokedAt, '2026-10-14T10:03:00.000Z', 'revoking twice keeps the first time');
  const after = await t.call('GET', '/v1/accounts/me', undefined, first.sessionToken);
  assert.deepEqual(after.body.devices.map((d: any) => d.deviceId), [first.deviceId]);

  // A device of another account, an unknown device and a malformed id all look the same.
  const other = await t.signIn('+918000000001', 'Other shop');
  for (const id of [other.deviceId, 'dev_00000000-0000-0000-0000-000000000000', 'nope'])
    assert.equal(code(await t.call('POST', `/v1/accounts/devices/${id}/revoke`, {}, first.sessionToken)), 'DEVICE_NOT_FOUND');
  assert.equal(code(await t.call('POST', `/v1/accounts/devices/${first.deviceId}/revoke`, { extra: true }, first.sessionToken)), 'INVALID_REQUEST');
  // Revoking the current device signs it out.
  assert.equal((await t.call('POST', `/v1/accounts/devices/${first.deviceId}/revoke`, {}, first.sessionToken)).status, 200);
  assert.equal(code(await t.call('GET', '/v1/accounts/me', undefined, first.sessionToken)), 'UNAUTHENTICATED');
});

test('wrong codes count and lock the challenge after five', { skip: pgSkip }, async () => {
  const t = await setup();
  const started = await t.call('POST', '/v1/accounts/otp/start', { phone: PHONE });
  const right = t.fake.last(), wrong = right === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) {
    const reply = await t.call('POST', '/v1/accounts/otp/verify', { challengeId: started.body.challengeId, code: wrong, deviceName: 'PC' });
    assert.equal(reply.status, 401); assert.equal(code(reply), 'OTP_INVALID');
  }
  const locked = await t.call('POST', '/v1/accounts/otp/verify', { challengeId: started.body.challengeId, code: right, deviceName: 'PC' });
  assert.equal(locked.status, 429); assert.equal(code(locked), 'OTP_LOCKED');
  assert.equal((await t.sql.query('SELECT count(*)::int AS n FROM accounts')).rows[0].n, 0);
  // Malformed input never reaches the database, and unknown challenges look like a wrong code.
  for (const body of [{ challengeId: started.body.challengeId, code: '12345', deviceName: 'PC' }, { challengeId: 'otp_x', code: right, deviceName: 'PC' },
    { challengeId: 'otp_00000000-0000-0000-0000-000000000000', code: right, deviceName: 'PC' }])
    assert.equal(code(await t.call('POST', '/v1/accounts/otp/verify', body)), 'OTP_INVALID');
  for (const deviceName of ['', '   ', 'x'.repeat(81), 'bad\nname'])
    assert.equal(code(await t.call('POST', '/v1/accounts/otp/verify', { challengeId: started.body.challengeId, code: right, deviceName })), 'DEVICE_NAME_INVALID');
});

test('a code expires after five minutes and works only once', { skip: pgSkip }, async () => {
  const t = await setup();
  const late = await t.call('POST', '/v1/accounts/otp/start', { phone: PHONE });
  const lateCode = t.fake.last();
  t.advance(5 * MINUTE);
  const expired = await t.call('POST', '/v1/accounts/otp/verify', { challengeId: late.body.challengeId, code: lateCode, deviceName: 'PC' });
  assert.equal(expired.status, 410); assert.equal(code(expired), 'OTP_EXPIRED');

  const fresh = await t.call('POST', '/v1/accounts/otp/start', { phone: PHONE });
  const body = { challengeId: fresh.body.challengeId, code: t.fake.last(), deviceName: 'PC' };
  t.advance(5 * MINUTE - 1);
  assert.equal((await t.call('POST', '/v1/accounts/otp/verify', body)).status, 200);
  const reused = await t.call('POST', '/v1/accounts/otp/verify', body);
  assert.equal(reused.status, 401); assert.equal(code(reused), 'OTP_INVALID');
  assert.equal((await t.sql.query('SELECT count(*)::int AS n FROM sessions')).rows[0].n, 1);
});

test('starts are limited to three per fifteen minutes and ten per hour for each phone', { skip: pgSkip }, async () => {
  const t = await setup();
  const start = (phone = PHONE) => t.call('POST', '/v1/accounts/otp/start', { phone });
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < 3; i++) assert.equal((await start()).status, 202, `round ${round} start ${i}`);
    const limited = await start();
    assert.equal(limited.status, 429); assert.equal(code(limited), 'OTP_RATE_LIMITED');
    assert.equal(JSON.stringify(limited.body).includes('9876543210'), false, 'the message never carries the phone');
    t.advance(15 * MINUTE + 1000);
  }
  assert.equal((await start()).status, 202, 'the tenth start in the hour');
  assert.equal(code(await start()), 'OTP_RATE_LIMITED', 'the hourly limit holds although the quarter hour has room');
  assert.equal((await start('+917000000000')).status, 202, 'another phone is not affected');
  assert.equal(t.fake.sent.length, 11);
  t.advance(60 * MINUTE);
  assert.equal((await start()).status, 202);

  // The sweep keeps an hour of challenges for the limits and drops the rest.
  await t.module.sweep!();
  assert.equal((await t.sql.query('SELECT count(*)::int AS n FROM otp_challenges')).rows[0].n, 1);
});

test('phone numbers are India only', { skip: pgSkip }, async () => {
  const t = await setup();
  for (const phone of ['+915876543210', '9876543210', '+91987654321', '+9198765432100', '+14155550100', ' +919876543210', 919876543210, null]) {
    const reply = await t.call('POST', '/v1/accounts/otp/start', { phone });
    assert.equal(reply.status, 400); assert.equal(code(reply), 'INVALID_PHONE', String(phone));
  }
  assert.equal(code(await t.call('POST', '/v1/accounts/otp/start', { phone: PHONE, name: 'x' })), 'INVALID_REQUEST');
  assert.equal(code(await t.call('POST', '/v1/accounts/otp/start', {})), 'INVALID_REQUEST');
  assert.equal(t.fake.sent.length, 0);
  for (const phone of ['+916000000000', '+917999999999', '+918123456789', PHONE]) assert.equal((await t.call('POST', '/v1/accounts/otp/start', { phone })).status, 202);
});

test('unknown, malformed and expired sessions refuse alike, and use slides the expiry', { skip: pgSkip }, async () => {
  const t = await setup();
  const session = await t.signIn();
  const refusals = [
    await t.call('GET', '/v1/accounts/me'),
    await t.call('GET', '/v1/accounts/me', undefined, 'short'),
    await t.call('GET', '/v1/accounts/me', undefined, 'A'.repeat(43)),
    await t.call('GET', '/v1/accounts/me', undefined, `${session.sessionToken}x`),
  ];
  for (const reply of refusals) assert.deepEqual(reply, { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'Sign in first.' } } });

  t.advance(20 * DAY);
  assert.equal((await t.call('GET', '/v1/accounts/me', undefined, session.sessionToken)).status, 200, 'use on day twenty moves expiry to day fifty');
  t.advance(20 * DAY);
  assert.equal((await t.call('GET', '/v1/accounts/me', undefined, session.sessionToken)).status, 200);
  t.advance(30 * DAY);
  const expired = await t.call('GET', '/v1/accounts/me', undefined, session.sessionToken);
  assert.equal(expired.status, 401); assert.equal(code(expired), 'UNAUTHENTICATED');
  await t.module.sweep!();
  assert.equal((await t.sql.query('SELECT count(*)::int AS n FROM sessions')).rows[0].n, 0);
});

test('without SMS credentials sign-in refuses with a typed code', { skip: pgSkip }, async () => {
  const t = await setup(new UnconfiguredOtpProvider());
  const reply = await t.call('POST', '/v1/accounts/otp/start', { phone: PHONE });
  assert.equal(reply.status, 503); assert.equal(code(reply), 'OTP_PROVIDER_NOT_CONFIGURED');
});

const SID = 'AC' + 'f'.repeat(32); // built at run time so it never looks like a real identifier in source
test('the Twilio client sends the exact request and checks the reply', async () => {
  const recorded = { status: 201, body: JSON.stringify({ sid: 'SM0123456789abcdef0123456789abcdef', status: 'queued', to: PHONE, from: '+15005550006', body: otpMessage('042917') }) };
  const { fetch, calls } = recordingFetch([recorded, { status: 400, body: '{"code":21211,"message":"Invalid To"}' }, new Error('reset'), { status: 201, body: '{"sid":"nope","status":"queued"}' }]);
  const twilio = new TwilioSmsOtpProvider(fetch, { accountSid: SID, authToken: 'tokentokentokentokentoken0123456', from: '+15005550006' });
  await twilio.send(PHONE, '042917');
  assert.equal(calls.length, 1);
  const [{ url, init }] = calls;
  assert.equal(url, `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`);
  assert.equal(init?.method, 'POST');
  assert.deepEqual(init?.headers, {
    authorization: `Basic ${Buffer.from(`${SID}:tokentokentokentokentoken0123456`).toString('base64')}`,
    'content-type': 'application/x-www-form-urlencoded', accept: 'application/json',
  });
  assert.equal(init?.body, `To=%2B919876543210&From=%2B15005550006&Body=${encodeURIComponent(otpMessage('042917')).replaceAll('%20', '+')}`);
  assert.deepEqual(Object.fromEntries(new URLSearchParams(String(init?.body))), { To: PHONE, From: '+15005550006', Body: 'Your Chausar sign-in code is 042917. It expires in five minutes. Do not share it.' });
  for (let i = 0; i < 3; i++) await assert.rejects(twilio.send(PHONE, '042917'), { code: 'OTP_SEND_FAILED', status: 502 });
  assert.throws(() => new TwilioSmsOtpProvider(fetch, { accountSid: 'AC123', authToken: 'tokentokentokentoken', from: '+15005550006' }), { code: 'SERVER_MISCONFIGURED' });
  await assert.rejects(new UnconfiguredOtpProvider().send(), { code: 'OTP_PROVIDER_NOT_CONFIGURED', status: 503 });
});

test('the accounts configuration picks the provider', () => {
  assert.equal(accountsConfig({}, refusingFetch).otpState, 'not-configured');
  assert.ok(accountsConfig({ TWILIO_ACCOUNT_SID: ' ' }, refusingFetch).otp instanceof UnconfiguredOtpProvider);
  const configured = accountsConfig({ TWILIO_ACCOUNT_SID: SID, TWILIO_AUTH_TOKEN: 'tokentokentokentokentoken0123456', TWILIO_FROM: '+15005550006' }, refusingFetch);
  assert.equal(configured.otpState, 'configured'); assert.ok(configured.otp instanceof TwilioSmsOtpProvider);
  assert.throws(() => accountsConfig({ TWILIO_ACCOUNT_SID: SID }, refusingFetch), { code: 'SERVER_MISCONFIGURED' });
});
