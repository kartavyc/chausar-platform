// Ink v2 wave 4, package 4G3 (O13, spec 5.7 and 8): web push with a count only. The encryption follows RFC 8291 (its
// Appendix A vector gives the same message); a push for a business with 3 unnotified items decrypts to exactly
// {"count":3}, with a TTL of one hour and nothing else; only https endpoints on the known push services are accepted.
// Each try is its own action journal entry under the owner's standing setting, holding the count, the push service's
// host and the outcome, never the address or keys, and never an unknown to resolve; phone alerts stay out of Money >
// Journal. 404 and 410 remove a subscription, as do 401 and 403 unless every browser said so (then the fault is the
// server's), a redirect is final, any other failure is tried once more as a new entry and the third failing delivery in
// a row removes it. A subscription belongs to the hosted session that made it and ends only when that session signs
// out or is revoked. Delivery starts after the centre's commit, never holds it, runs as the owner in the app whoever
// asked, leaves the items waiting when nothing could go out, and a closing business waits for it, for a bounded time. A browser that refused push leaves the bell working and the settings saying push is off; the service worker
// shows the count and opens the approval page on a tap, and keeps nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv, createECDH, createHash, generateKeyPairSync, hkdfSync, sign as signData, verify } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import type { Context } from '../runtime/contracts.ts';
import type { PinnedTarget } from '../runtime/venture/core/net-guard.ts';
import type {
  JournalActionId, NotifyListView, NotifySettingsView, PushKeyView, PushStateView, VentureDeps, WebPushPort,
} from '../runtime/venture/contracts.ts';
import { deliveriesSettled, endPushSessions, handlers, notifyRefresh, outsidePending, settleOutside } from '../runtime/venture/notify/index.ts';
import { handlers as views } from '../runtime/venture/views/index.ts';
import { journalled, sweepJournal } from '../runtime/venture/journal/journal.ts';
import { encryptPush, pushPayload, pushServiceOf, PUSH_SERVICE_HOSTS, PUSH_TTL_SECONDS, vapidAuthorization } from '../runtime/venture/notify/webpush.ts';
import { code, owner, phone, seedBlueprint, setup, type Env } from './venture-views-env.ts';

const b64 = (text: string) => Buffer.from(text, 'base64url');
const web: Context = { ...owner, channel: 'web' };
/** Hashes of hosted session ids, as hosted/notify.ts makes them. */
const SESSION = createHash('sha256').update('session one').digest('hex');
const OTHER_SESSION = createHash('sha256').update('session two').digest('hex');

// RFC 8291, Appendix A: the keys, the salt and the message of the worked example.
const RFC = {
  plaintext: 'V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  message: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

const hkdf = (salt: Buffer, ikm: Buffer, info: Buffer, length: number) => Buffer.from(hkdfSync('sha256', ikm, salt, info, length));

/** RFC 8291 decryption, written apart from the engine's encryption: what a browser does with the message. */
function decryptPush(body: Buffer, uaPrivate: Buffer, auth: Buffer): string {
  const salt = body.subarray(0, 16), recordSize = body.readUInt32BE(16), idLength = body[20];
  const asPublic = body.subarray(21, 21 + idLength), ciphertext = body.subarray(21 + idLength);
  assert.equal(recordSize, 4096);
  assert.equal(idLength, 65);
  assert.ok(ciphertext.length <= recordSize, 'one record');
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(uaPrivate);
  const uaPublic = ecdh.getPublicKey();
  const ikm = hkdf(auth, ecdh.computeSecret(asPublic), Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(-16));
  const padded = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0) end -= 1;
  assert.equal(padded[end], 2, 'the last record ends with the 0x02 delimiter');
  return padded.subarray(0, end).toString('utf8');
}

/** A browser's push subscription: its own key pair and auth secret, on the given endpoint. */
function browserSubscription(endpoint = 'https://fcm.googleapis.com/fcm/send/abc123') {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = Buffer.from('0123456789abcdef');
  return {
    private: ecdh.getPrivateKey(), auth,
    input: { endpoint, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') }, expirationTime: null },
  };
}

/** The hosted app's push key port, as hosted/notify.ts builds it: the private half stays in here. */
function pushPort(subject: string | null = 'mailto:owner@example.com'): WebPushPort & { publicKeyObject: ReturnType<typeof generateKeyPairSync>['publicKey'] } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const raw = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  const point = Buffer.concat([Buffer.from([4]), b64(raw.x), b64(raw.y)]);
  return { publicKey: point.toString('base64url'), subject, sign: data => signData('sha256', data, { key: privateKey, dsaEncoding: 'ieee-p1363' }), publicKeyObject: publicKey };
}

type Sent = PinnedTarget & { bodyBytes: Buffer };
/**
 * The network guard's lookup and sender, answered here: every request is kept, nothing leaves this computer. An answer
 * of 0 never comes back (the request failed on the way). before runs as each request arrives, before it is answered.
 */
function network(answers: number[] = [], before?: () => Promise<void>) {
  const sent: Sent[] = [];
  const looked: string[] = [];
  return {
    sent, looked,
    net: {
      resolve: async (hostname: string) => { looked.push(hostname); return [{ address: '142.250.0.10', family: 4 as const }]; },
      send: async (target: PinnedTarget) => {
        sent.push({ ...target, bodyBytes: Buffer.from(target.body ?? '') });
        if (before) await before();
        const status = answers.length ? answers.shift()! : 201;
        if (status === 0) throw Object.assign(new Error('Chausar could not reach the site. Nothing was retried.'), { code: 'NET_FAILED' });
        return { status, headers: {}, body: Buffer.alloc(0) };
      },
    },
  };
}

/** The hosted app's deps: its push key, the network stand-ins, and the owner's own context in the app, as the engine gives it. */
function hostedDeps(env: Env, port: WebPushPort | null, net: ReturnType<typeof network>['net']): VentureDeps {
  return { ...env.deps, host: 'hosted-web', ...(port ? { push: port } : {}), net, ownerContext: () => web };
}
const call = <T>(deps: VentureDeps, method: string, payload: unknown = {}, ctx: Context = web): Promise<T> =>
  (handlers as Record<string, (deps: unknown, ctx: Context, payload: unknown) => Promise<unknown>>)[method](deps, ctx, payload) as Promise<T>;
/** Subscribes as the hosted app sends it: the browser's subscription and the hash of the session asking. */
const subscribe = (deps: VentureDeps, input: unknown, session: string = SESSION, ctx: Context = web) =>
  call<PushStateView>(deps, 'venture.notify.push.subscribe', { subscription: input, session }, ctx);
const subscriptions = (env: Env) => listRecords(env.store.read(), 'venture-push-subscription', env.venture.id);
/** One look by the centre, then whatever it started outside the app, to the end. */
async function look(deps: VentureDeps, ctx: Context = web) {
  const result = await notifyRefresh(deps, ctx);
  await deliveriesSettled();
  return result;
}
const entries = (env: Env, action: JournalActionId = 'notify.push') =>
  listRecords(env.store.read(), 'venture-journal-entry', env.venture.id).filter(entry => entry.action === action);

test('the encryption follows RFC 8291: the Appendix A keys and salt give the same message', () => {
  const message = encryptPush(b64(RFC.plaintext), { p256dh: RFC.uaPublic, auth: RFC.auth }, { asPrivate: b64(RFC.asPrivate), salt: b64(RFC.salt), padTo: 0 });
  assert.equal(message.toString('base64url'), RFC.message);
  assert.equal(message.subarray(21, 86).toString('base64url'), RFC.asPublic, 'the key id is the server key of that message');
  assert.equal(decryptPush(message, b64(RFC.uaPrivate), b64(RFC.auth)), 'When I grow up, I want to be a watermelon');
});

test('a count payload is {"count":N} and nothing else, padded so its size says nothing about the number', () => {
  assert.equal(pushPayload(3), '{"count":3}');
  assert.throws(() => pushPayload(-1), code('INVALID_VENTURE_REQUEST'));
  assert.throws(() => pushPayload(1.5), code('INVALID_VENTURE_REQUEST'));
  const browser = browserSubscription();
  const one = encryptPush(Buffer.from(pushPayload(1)), browser.input.keys);
  const many = encryptPush(Buffer.from(pushPayload(12345)), browser.input.keys);
  assert.equal(one.length, many.length);
  assert.equal(decryptPush(one, browser.private, browser.auth), '{"count":1}');
  assert.equal(decryptPush(many, browser.private, browser.auth), '{"count":12345}');
  // A fresh salt and server key each time: two pushes of the same count never look alike.
  assert.notEqual(encryptPush(Buffer.from(pushPayload(1)), browser.input.keys).toString('hex'), one.toString('hex'));
});

test('VAPID: an ES256 token for the push service origin, at most a day long, signed by the key the browser was given', () => {
  const port = pushPort();
  const now = Date.parse('2026-10-15T10:00:00.000Z');
  const header = vapidAuthorization(port, 'https://fcm.googleapis.com', now);
  const match = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header);
  assert.ok(match, header);
  assert.equal(match[4], port.publicKey);
  assert.deepEqual(JSON.parse(b64(match[1]).toString('utf8')), { typ: 'JWT', alg: 'ES256' });
  const claims = JSON.parse(b64(match[2]).toString('utf8'));
  assert.deepEqual(Object.keys(claims).sort(), ['aud', 'exp', 'sub']);
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.equal(claims.sub, 'mailto:owner@example.com');
  assert.ok(claims.exp > now / 1000 && claims.exp <= now / 1000 + 24 * 3600, 'at most 24 hours ahead');
  assert.ok(verify('sha256', Buffer.from(`${match[1]}.${match[2]}`), { key: port.publicKeyObject, dsaEncoding: 'ieee-p1363' }, b64(match[3])));
  // No contact set: no sub claim rather than an invented one.
  const bare = vapidAuthorization(pushPort(null), 'https://web.push.apple.com', now);
  assert.deepEqual(Object.keys(JSON.parse(b64(bare.split('.')[1]).toString('utf8'))).sort(), ['aud', 'exp']);
});

test('only https endpoints on the known push services (Google, Mozilla, Microsoft, Apple) are accepted', () => {
  for (const endpoint of [
    'https://fcm.googleapis.com/fcm/send/abc', 'https://android.googleapis.com/gcm/send/abc', 'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://wns2-par02p.notify.windows.com/w/?token=abc', 'https://web.push.apple.com/QGxyz',
  ]) assert.equal(pushServiceOf(endpoint).url.href, endpoint);
  for (const endpoint of [
    'http://fcm.googleapis.com/fcm/send/abc', 'https://fcm.googleapis.com.example.com/x', 'https://example.com/fcm.googleapis.com', 'https://evilnotify.windows.com/x',
    'https://notify.windows.com/x', 'https://user:pass@fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'https://127.0.0.1/x', 'not a url', '',
    'https://fcm.googleapis.com/x#frag', `https://fcm.googleapis.com/${'a'.repeat(2100)}`,
  ]) assert.throws(() => pushServiceOf(endpoint), code('PUSH_ENDPOINT_REFUSED'), endpoint);
  assert.ok(PUSH_SERVICE_HOSTS.exact.length >= 4 && PUSH_SERVICE_HOSTS.suffix.includes('.notify.windows.com'));
});


test('venture.notify.push.key: the public key on the hosted app; on the desktop, phone alerts are honestly not available', async () => {
  const env = await setup();
  const port = pushPort();
  const { net } = network();
  assert.deepEqual(await call<PushKeyView>(hostedDeps(env, port, net), 'venture.notify.push.key'), { publicKey: port.publicKey });
  await assert.rejects(call(env.deps, 'venture.notify.push.key', {}, owner), (error: any) => {
    assert.equal(error.code, 'TIER_UNAVAILABLE');
    assert.equal(error.message, 'Phone alerts need the hosted app. On this computer the tray shows the count.');
    return true;
  });
  await assert.rejects(call(hostedDeps(env, null, net), 'venture.notify.push.key'), (error: any) => error.code === 'TIER_UNAVAILABLE' && /not set up on this server/.test(error.message));
  await assert.rejects(call(hostedDeps(env, port, net), 'venture.notify.push.key', { extra: 1 }), code('INVALID_VENTURE_REQUEST'));
});

test('venture.notify.push.subscribe is app only, checks the endpoint, the keys and the session, keeps one record per browser and turns push on', async () => {
  const env = await setup();
  const { net } = network();
  const deps = hostedDeps(env, pushPort(), net);
  const browser = browserSubscription();
  await assert.rejects(subscribe(deps, browser.input, SESSION, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(subscribe(deps, { ...browser.input, endpoint: 'https://push.example.com/x' }), code('PUSH_ENDPOINT_REFUSED'));
  await assert.rejects(subscribe(deps, { ...browser.input, keys: { p256dh: 'AAAA', auth: browser.input.keys.auth } }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(subscribe(deps, { ...browser.input, keys: { ...browser.input.keys, auth: 'AAAA' } }), code('INVALID_VENTURE_REQUEST'));
  // A point that is not on the curve is refused: it could never be encrypted to.
  const offCurve = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString('base64url');
  await assert.rejects(subscribe(deps, { ...browser.input, keys: { ...browser.input.keys, p256dh: offCurve } }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(call(deps, 'venture.notify.push.subscribe', { subscription: browser.input, session: SESSION, extra: true }), code('INVALID_VENTURE_REQUEST'));
  // The hosted app always says which session asks; without it, or with anything but a hash, nothing is kept.
  await assert.rejects(call(deps, 'venture.notify.push.subscribe', { subscription: browser.input }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(subscribe(deps, browser.input, 'not-a-hash'), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(call(env.deps, 'venture.notify.push.subscribe', { subscription: browser.input }, owner), code('TIER_UNAVAILABLE'));
  assert.equal(subscriptions(env).length, 0);

  const state = await subscribe(deps, browser.input);
  assert.equal(state.subscribed, true);
  assert.match(state.line, /count only/);
  assert.equal(subscriptions(env).length, 1);
  const record = subscriptions(env)[0];
  assert.deepEqual([record.endpoint, record.host, record.sessionHash, record.failures], [browser.input.endpoint, 'fcm.googleapis.com', SESSION, 0]);
  assert.equal(Object.hasOwn(record, 'removedAt'), false, 'a removed browser is deleted, not marked');
  const settings = await call<NotifySettingsView>(deps, 'venture.notify.settings', {});
  assert.equal(settings.push, true);
  // The same browser again: the record is kept and its keys follow; no second record.
  const again = browserSubscription(browser.input.endpoint);
  await subscribe(deps, again.input, OTHER_SESSION);
  assert.equal(subscriptions(env).length, 1);
  assert.equal(subscriptions(env)[0].keys.p256dh, again.input.keys.p256dh);
  assert.equal(subscriptions(env)[0].sessionHash, OTHER_SESSION, 'it now belongs to the session that subscribed it last');
});

test('a push for a business with 3 unnotified items decrypts to exactly {"count":3}, TTL one hour, through the network guard, journalled', async () => {
  const env = await setup();
  const { net, sent, looked } = network();
  const port = pushPort();
  const deps = hostedDeps(env, port, net);
  const browser = browserSubscription();
  await subscribe(deps, browser.input);
  await seedBlueprint(env, { status: 'draft' });
  const result = await look(deps);
  assert.deepEqual(result.alert, { count: 3 });
  assert.equal(sent.length, 1, 'one push to the one browser');
  const push = sent[0];
  assert.equal(push.method, 'POST');
  assert.equal(push.url.href, browser.input.endpoint);
  assert.deepEqual(looked, ['fcm.googleapis.com'], 'the push service name was looked up and checked by the guard');
  assert.equal(push.headers.ttl, String(PUSH_TTL_SECONDS));
  assert.equal(PUSH_TTL_SECONDS, 3600);
  assert.equal(push.headers['content-encoding'], 'aes128gcm');
  assert.match(push.headers.authorization, new RegExp(`^vapid t=.+, k=${port.publicKey}$`));
  assert.equal(push.headers['content-length'], String(push.bodyBytes.length));
  const plain = decryptPush(push.bodyBytes, browser.private, browser.auth);
  assert.equal(plain, '{"count":3}');
  assert.deepEqual(Object.keys(JSON.parse(plain)), ['count']);
  // Nothing about the business rides in the clear either: the address is the browser's own, the headers fixed.
  assert.deepEqual(Object.keys(push.headers).sort(), ['authorization', 'content-encoding', 'content-length', 'content-type', 'topic', 'ttl', 'urgency']);
  assert.deepEqual([push.headers.topic, push.headers.urgency, push.headers['content-type']], ['chausar-count', 'normal', 'application/octet-stream']);
  assert.equal(subscriptions(env)[0].failures, 0);
  // The try is one journal entry: the count, the host and the outcome, never the address, the keys or the topic.
  const [entry] = entries(env);
  assert.equal(entries(env).length, 1);
  assert.deepEqual([entry.state, entry.target], ['applied', 'fcm.googleapis.com']);
  assert.match(entry.describe, /\(3\)/);
  const kept = JSON.stringify(entry);
  for (const secret of ['/fcm/send/abc123', browser.input.keys.p256dh, browser.input.keys.auth, 'chausar-count', 'vapid', port.publicKey]) assert.equal(kept.includes(secret), false, secret);

  // The same items again: no second push.
  assert.equal((await look(deps)).alert, null);
  assert.equal(sent.length, 1);
});

/** One more alert: every episode ends, so the same subjects come back as news (4G1), an hour and a minute later. */
async function newItem(env: Env, deps: VentureDeps, name: string) {
  env.advance(60 * 60_000);
  await ventureAction(env.deps, owner, 'admin', 'test.end', tx => {
    for (const record of tx.list('venture-notification')) tx.replace({ ...record, endedAt: tx.now, readAt: tx.now });
  });
  env.advance(60_000);
  const result = await look(deps);
  assert.ok(result.alert, `${name}: an alert went out`);
}

test('any other failure is a not-sent entry and one more try as a new entry; three failing deliveries in a row remove the browser', async () => {
  const env = await setup();
  const port = pushPort();
  const first = network([500, 503]);
  const browser = browserSubscription();
  await subscribe(hostedDeps(env, port, first.net), browser.input);
  await seedBlueprint(env, { status: 'draft' });
  await look(hostedDeps(env, port, first.net));
  assert.equal(first.sent.length, 2, 'tried once more, then left');
  assert.deepEqual(entries(env).map(entry => entry.state), ['rejected', 'rejected'], 'each try is its own entry, settled as not sent');
  assert.equal(subscriptions(env).length, 1, 'a failure keeps the subscription');
  assert.equal(subscriptions(env)[0].failures, 1);
  assert.equal(subscriptions(env)[0].lastFailure?.status, 503);

  // No answer at all: the entry settles as not sent with what happens next, never as an unknown to resolve.
  const second = network([0, 201]);
  await newItem(env, hostedDeps(env, port, second.net), 'Second');
  assert.equal(second.sent.length, 2);
  const [lost, landed] = entries(env).slice(2);
  assert.deepEqual([lost.state, landed.state], ['rejected', 'applied']);
  assert.match(lost.journal.at(-1)!.line, /may not have arrived\. The next alert carries the current count\./);
  assert.equal(entries(env).some(entry => entry.state === 'outcome_unknown'), false);
  assert.equal(subscriptions(env)[0].failures, 0, 'a success clears the count');
  assert.equal(subscriptions(env)[0].lastFailure, null);

  for (const [index, answers] of [[500, 500], [502, 500], [503, 503]].entries()) {
    const failing = network([...answers]);
    await newItem(env, hostedDeps(env, port, failing.net), `Failing ${index + 1}`);
    assert.equal(failing.sent.length, 2);
  }
  assert.equal(subscriptions(env).length, 0, 'the third failing delivery in a row removes it');
  const settings = await call<NotifySettingsView>(hostedDeps(env, port, network().net), 'venture.notify.settings', {});
  assert.equal(settings.push, false);
  assert.match(settings.line, /Phone alerts are off/);
});

/** A push service per host: each host answers its own list, in order (201 when it runs out). */
function networkByHost(answers: Record<string, number[]>) {
  const sent: string[] = [];
  return {
    sent,
    net: {
      resolve: async () => [{ address: '142.250.0.10', family: 4 as const }],
      send: async (target: PinnedTarget) => {
        sent.push(target.url.hostname);
        const list = answers[target.url.hostname] ?? [];
        return { status: list.length ? list.shift()! : 201, headers: {}, body: Buffer.alloc(0) };
      },
    },
  };
}

test('404 and 410 remove a browser at once, as do 401 and 403 when other browsers take the alert; a redirect is final', async () => {
  for (const status of [404, 410]) {
    const env = await setup();
    const answers = network([status]);
    const deps = hostedDeps(env, pushPort(), answers.net);
    await subscribe(deps, browserSubscription().input);
    await seedBlueprint(env, { status: 'draft' });
    await look(deps);
    assert.equal(answers.sent.length, 1, `${status} is not tried again`);
    assert.equal(subscriptions(env).length, 0, `${status} removes the browser`);
    assert.deepEqual(entries(env).map(entry => entry.state), ['rejected']);
    assert.equal((await call<NotifySettingsView>(deps, 'venture.notify.settings', {})).push, false, 'with no browser left, push is off');
  }
  for (const status of [401, 403]) {
    const env = await setup();
    const both = networkByHost({ 'fcm.googleapis.com': [status] });
    const deps = hostedDeps(env, pushPort(), both.net);
    await subscribe(deps, browserSubscription('https://fcm.googleapis.com/fcm/send/refused').input);
    await subscribe(deps, browserSubscription('https://updates.push.services.mozilla.com/wpush/v2/fine').input);
    await seedBlueprint(env, { status: 'draft' });
    await look(deps);
    assert.deepEqual(subscriptions(env).map(record => record.host), ['updates.push.services.mozilla.com'], `${status} from one browser while another took it removes that one`);
  }

  const redirected = await setup();
  const away = network([302]);
  const awayDeps = hostedDeps(redirected, pushPort(), away.net);
  await subscribe(awayDeps, browserSubscription().input);
  await seedBlueprint(redirected, { status: 'draft' });
  await look(awayDeps);
  assert.equal(away.sent.length, 1, 'a redirect is not followed and not tried again');
  assert.equal(subscriptions(redirected)[0].failures, 1);
  assert.deepEqual(entries(redirected).map(entry => entry.state), ['rejected']);
});

test('when every browser answers 401 or 403 in one delivery, the fault is the server\'s (its clock or its key): counted, never all deleted', async () => {
  const env = await setup();
  const port = pushPort();
  const refused = networkByHost({ 'fcm.googleapis.com': [401], 'updates.push.services.mozilla.com': [403] });
  const deps = hostedDeps(env, port, refused.net);
  await subscribe(deps, browserSubscription('https://fcm.googleapis.com/fcm/send/one').input);
  await subscribe(deps, browserSubscription('https://updates.push.services.mozilla.com/wpush/v2/two').input);
  await seedBlueprint(env, { status: 'draft' });
  await look(deps);
  assert.equal(subscriptions(env).length, 2, 'both kept');
  assert.deepEqual(subscriptions(env).map(record => record.failures), [1, 1]);
  assert.match((await call<NotifySettingsView>(deps, 'venture.notify.settings', {})).line, /Not reaching 2 browsers\./);
});

test('a browser subscribed again while its old subscription\'s push was on the way is kept, whatever that push answered', async () => {
  const env = await setup();
  const old = browserSubscription();
  const fresh = browserSubscription(old.input.endpoint);
  let deps: VentureDeps;
  const racing = network([410], async () => { await subscribe(deps, fresh.input); });
  deps = hostedDeps(env, pushPort(), racing.net);
  await subscribe(deps, old.input);
  await seedBlueprint(env, { status: 'draft' });
  await look(deps);
  assert.equal(racing.sent.length, 1);
  assert.equal(subscriptions(env).length, 1, 'the new subscription is not the one that was gone');
  assert.equal(subscriptions(env)[0].keys.p256dh, fresh.input.keys.p256dh);
});

test('a subscription ends only when its session signs out or is revoked; an idle or expired session keeps its browser', async () => {
  const env = await setup();
  const port = pushPort();
  const both = network();
  const deps = hostedDeps(env, port, both.net);
  const mine = browserSubscription('https://fcm.googleapis.com/fcm/send/mine');
  const theirs = browserSubscription('https://updates.push.services.mozilla.com/wpush/v2/theirs');
  await subscribe(deps, mine.input, SESSION);
  await subscribe(deps, theirs.input, OTHER_SESSION);
  // Days pass with no sign-in at all: nothing ends, and both browsers get the alert.
  env.advance(20 * 24 * 3600_000);
  await seedBlueprint(env, { status: 'draft' });
  await look(deps);
  assert.deepEqual(both.sent.map(item => item.url.hostname).sort(), ['fcm.googleapis.com', 'updates.push.services.mozilla.com']);
  // The second session signs out: its browser is deleted; the first keeps getting alerts.
  assert.equal(await endPushSessions(deps, web, [OTHER_SESSION]), 1);
  assert.deepEqual(subscriptions(env).map(record => record.sessionHash), [SESSION]);
  assert.equal((await call<NotifySettingsView>(deps, 'venture.notify.settings', {})).push, true);
  assert.equal(await endPushSessions(deps, web, [OTHER_SESSION]), 0, 'ending it again changes nothing');
  assert.equal(await endPushSessions(deps, web, [SESSION]), 1);
  assert.equal((await call<NotifySettingsView>(deps, 'venture.notify.settings', {})).push, false, 'the last browser gone turns push off');
  await assert.rejects(endPushSessions(deps, web, ['not-a-hash']), code('INVALID_VENTURE_REQUEST'));
});

test('a look under a context that cannot approve (the phone) still delivers, under the owner\'s standing setting in the app', async () => {
  const env = await setup();
  const { net, sent } = network();
  const deps = hostedDeps(env, pushPort(), net);
  await subscribe(deps, browserSubscription().input);
  await seedBlueprint(env, { status: 'draft' });
  assert.deepEqual((await look(deps, phone)).alert, { count: 3 });
  assert.equal(sent.length, 1, 'the push went out');
  const [entry] = entries(env);
  assert.equal(entry.state, 'applied');
  assert.equal(entry.decidedBy, null, 'no person approved this one push');
  assert.match(entry.journal.find(step => step.state === 'approved')!.line, /phone alerts are on/i);
});

test('a delivery the journal halts before anything goes out leaves the items waiting, and the next look sends them', async () => {
  const env = await setup();
  const { net, sent } = network();
  const port = pushPort();
  await subscribe(hostedDeps(env, port, net), browserSubscription().input);
  // The owner's context the host gives is not one that may act in the app: the journal refuses, nothing goes out.
  const halted: VentureDeps = { ...hostedDeps(env, port, net), ownerContext: () => phone };
  await seedBlueprint(env, { status: 'draft' });
  assert.deepEqual((await look(halted)).alert, { count: 3 });
  assert.equal(sent.length, 0);
  const marks = listRecords(env.store.read(), 'venture-notification', env.venture.id).map(record => record.alert ?? null);
  assert.deepEqual(marks, [null, null, null], 'not marked sent: they wait again');
  // The failed try still counts in the pacing: a minute later nothing is tried, after the 10 minute wait it is.
  env.advance(60_000);
  assert.equal((await look(hostedDeps(env, port, net))).alert, null);
  env.advance(10 * 60_000);
  assert.deepEqual((await look(hostedDeps(env, port, net))).alert, { count: 3 });
  assert.equal(sent.length, 1);
});

test('phone alerts stay out of Money > Journal: the journal keeps them, the list shows the business\'s own effects', async () => {
  const env = await setup();
  const { net } = network();
  const deps = hostedDeps(env, pushPort(), net);
  await subscribe(deps, browserSubscription().input);
  await seedBlueprint(env, { status: 'draft' });
  await look(deps);
  assert.equal(entries(env).length, 1);
  const list = await (views['venture.journal.list'] as (d: unknown, c: Context, p: unknown) => Promise<{ entries: { action: string }[] }>)(deps, web, {});
  assert.equal(list.entries.some(entry => /phone alert|relay alert/i.test(entry.action)), false);
});

test('closing the business waits for a delivery under way, for a bounded time', async () => {
  const env = await setup();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const hanging = network([], () => held);
  const deps = hostedDeps(env, pushPort(), hanging.net);
  await subscribe(deps, browserSubscription().input);
  await seedBlueprint(env, { status: 'draft' });
  await notifyRefresh(deps, web);
  assert.ok(outsidePending(env.store), 'a delivery is under way for this business');
  assert.equal(outsidePending({}), null, 'and none for another');
  const started = Date.now();
  await settleOutside(env.store, 150);
  assert.ok(Date.now() - started >= 140 && Date.now() - started < 2_000, 'a delivery that hangs is waited for at most the bound');
  release();
  await settleOutside(env.store, 5_000);
  assert.equal(outsidePending(env.store), null);
  assert.deepEqual(entries(env).map(entry => entry.state), ['applied']);
});

test('a phone alert caught under way when Chausar stopped is swept as not sent, never as an unknown to resolve', async t => {
  const env = await setup();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  t.after(() => release());
  const hanging = network([], () => held);
  const deps = hostedDeps(env, pushPort(), hanging.net);
  await subscribe(deps, browserSubscription().input);
  await seedBlueprint(env, { status: 'draft' });
  await notifyRefresh(deps, web);
  for (let i = 0; i < 200 && hanging.sent.length === 0; i++) await new Promise(resolve => setTimeout(resolve, 5));
  env.advance(60_000);
  const swept = await sweepJournal(deps, web, { claimLimitMs: 1_000 });
  assert.deepEqual(swept.map(record => record.state), ['rejected']);
  assert.match(swept[0].journal.at(-1)!.line, /The next alert carries the current count\./);
  release();
  await deliveriesSettled();
  assert.deepEqual(entries(env).map(entry => entry.state), ['rejected'], 'the late answer does not reopen it');
});

test('a browser whose session the account lists as ended gets nothing at send time, even before its record is deleted', async () => {
  const env = await setup();
  const { net, sent } = network();
  const ended: string[] = [];
  const deps: VentureDeps = { ...hostedDeps(env, pushPort(), net), endedSessions: () => ended };
  await subscribe(deps, browserSubscription('https://fcm.googleapis.com/fcm/send/mine').input, SESSION);
  await subscribe(deps, browserSubscription('https://updates.push.services.mozilla.com/wpush/v2/signed-out').input, OTHER_SESSION);
  // The other session signed out, and its business has not woken to delete the record yet.
  ended.push(OTHER_SESSION);
  await seedBlueprint(env, { status: 'draft' });
  await look(deps);
  assert.deepEqual(sent.map(item => item.url.hostname), ['fcm.googleapis.com']);
  assert.equal(entries(env).length, 1);
  // With every browser's session ended, push reads as off and nothing goes out.
  ended.push(SESSION);
  assert.equal((await call<NotifySettingsView>(deps, 'venture.notify.settings', {})).push, false);
});

test('a standing approval for a phone alert needs a phone alert subject: anything else still needs a person', async () => {
  const env = await setup();
  let ran = 0;
  for (const [action, subject] of [['notify.push', 'invoice:inv_1:1'], ['notify.relay', 'notify-push:x:1'], ['notify.push', 'notify-relay:x:1']] as const) {
    await assert.rejects(journalled(env.deps, web, { action, subject, target: 'fcm.googleapis.com', actionDigest: 'abc123', line: 'Send a phone alert.' },
      async () => { ran += 1; return { outcome: 'applied', line: 'Sent.', value: null }; }, { standing: { line: 'Phone alerts are on.' } }), code('INVALID_VENTURE_REQUEST'), subject);
  }
  assert.equal(ran, 0, 'nothing ran');
});

test('settings on the hosted app: push turns on only with a live browser, says when Chausar sends, and says when browsers are not reached', async () => {
  const env = await setup();
  const failing = network([500, 500]);
  const deps = hostedDeps(env, pushPort(), failing.net);
  await assert.rejects(call(deps, 'venture.notify.settings', { push: true }), (error: any) => {
    assert.equal(error.code, 'PUSH_NOT_SUBSCRIBED');
    assert.match(error.message, /Allow phone alerts in this browser first/);
    return true;
  });
  assert.equal(listRecords(env.store.read(), 'venture-notify-settings', env.venture.id).length, 0);
  await subscribe(deps, browserSubscription().input);
  const on = await call<NotifySettingsView>(deps, 'venture.notify.settings', { push: true });
  assert.equal(on.push, true);
  assert.match(on.line, /Phone alerts are on, with a count only, and come while Chausar is awake for this business\./);
  await seedBlueprint(env, { status: 'draft' });
  await look(deps);
  assert.match((await call<NotifySettingsView>(deps, 'venture.notify.settings', {})).line, /Not reaching 1 browser\./);
  // Off is always allowed; on the desktop, push stays the switch 4G1 made.
  assert.equal((await call<NotifySettingsView>(deps, 'venture.notify.settings', { push: false })).push, false);
  assert.equal((await call<NotifySettingsView>(env.deps, 'venture.notify.settings', { push: true }, owner)).push, true);
});

test('a push service that never answers holds nothing: the look returns while the push waits, and the push still lands later', async () => {
  const env = await setup();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const hanging = network([], () => held);
  const deps = hostedDeps(env, pushPort(), hanging.net);
  await subscribe(deps, browserSubscription().input);
  await seedBlueprint(env, { status: 'draft' });
  const answered = await Promise.race([
    notifyRefresh(deps, web).then(result => result.alert),
    new Promise(resolve => { setTimeout(() => resolve('held'), 2_000).unref(); }),
  ]);
  assert.deepEqual(answered, { count: 3 }, 'the look answered while the push service was silent');
  for (let i = 0; i < 100 && hanging.sent.length === 0; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(hanging.sent.length, 1, 'the push was on its way');
  release();
  await deliveriesSettled();
  assert.deepEqual(entries(env).map(entry => entry.state), ['applied']);
});

test('the rules of 4G1 hold for push: nothing in quiet hours, one count when they end, nothing while the owner watches', async () => {
  const env = await setup();
  const { net, sent } = network();
  const deps = hostedDeps(env, pushPort(), net);
  const browser = browserSubscription();
  await subscribe(deps, browser.input);
  // 22:30 in Pune: quiet hours (22:00 to 07:00 by default).
  env.advance(7 * 3600_000);
  await seedBlueprint(env, { status: 'draft' });
  assert.equal((await look(deps)).alert, null);
  assert.equal(sent.length, 0, 'held in quiet hours');
  // 07:30 the next morning: one count for what waited.
  env.advance(9 * 3600_000);
  assert.deepEqual((await look(deps)).alert, { count: 3 });
  assert.equal(sent.length, 1);
  assert.equal(decryptPush(sent[0].bodyBytes, browser.private, browser.auth), '{"count":3}');

  // The owner has the app open (an event stream now): what comes is on screen, so no push.
  const watched = await setup();
  const second = network();
  const watching = { ...hostedDeps(watched, pushPort(), second.net), watching: () => new Date(watched.now()).toISOString() };
  await subscribe(watching, browserSubscription().input);
  await seedBlueprint(watched, { status: 'draft' });
  assert.equal((await look(watching)).alert, null);
  assert.equal(second.sent.length, 0);
});

test('push permission denied (no subscription): the bell still lists everything and the settings say push is off (spec 8)', async () => {
  const env = await setup();
  const { net, sent } = network();
  const deps = hostedDeps(env, pushPort(), net);
  await seedBlueprint(env, { status: 'draft' });
  const result = await look(deps);
  assert.equal(result.alert, null, 'no channel outside the app is on');
  assert.equal(sent.length, 0);
  const news = env.published.flat().filter(event => event.name === 'notify.new');
  assert.ok(news.length > 0 && news.every(event => !Object.hasOwn(event.data as object, 'count')), 'no count rides on the hosted stream either');
  const list = await call<NotifyListView>(deps, 'venture.notify.list');
  assert.equal(list.items.length, 3);
  const settings = await call<NotifySettingsView>(deps, 'venture.notify.settings', {});
  assert.equal(settings.push, false);
  assert.match(settings.line, /Phone alerts are off\. The bell still lists everything\./);
});

test('venture.notify.push.unsubscribe removes the record for that browser only, and says what is left', async () => {
  const env = await setup();
  const { net } = network();
  const deps = hostedDeps(env, pushPort(), net);
  const one = browserSubscription('https://fcm.googleapis.com/fcm/send/one');
  const two = browserSubscription('https://updates.push.services.mozilla.com/wpush/v2/two');
  await subscribe(deps, one.input);
  await subscribe(deps, two.input);
  await assert.rejects(call(deps, 'venture.notify.push.unsubscribe', { endpoint: one.input.endpoint }, phone), code('APP_APPROVAL_REQUIRED'));
  const left = await call<PushStateView>(deps, 'venture.notify.push.unsubscribe', { endpoint: one.input.endpoint });
  assert.equal(left.subscribed, false);
  assert.match(left.line, /1 other browser still gets them/);
  assert.deepEqual(subscriptions(env).map(record => record.endpoint), [two.input.endpoint]);
  assert.equal(JSON.stringify(env.store.read()).includes(one.input.keys.p256dh), false, 'nothing of that browser is kept');
  assert.equal((await call<NotifySettingsView>(deps, 'venture.notify.settings', {})).push, true);
  // Removing one already gone is fine; removing the last turns push off.
  assert.equal((await call<PushStateView>(deps, 'venture.notify.push.unsubscribe', { endpoint: one.input.endpoint })).subscribed, false);
  const none = await call<PushStateView>(deps, 'venture.notify.push.unsubscribe', { endpoint: two.input.endpoint });
  assert.match(none.line, /Phone alerts are off/);
  assert.equal((await call<NotifySettingsView>(deps, 'venture.notify.settings', {})).push, false);
  await assert.rejects(call(deps, 'venture.notify.push.unsubscribe', { endpoint: 42 }), code('INVALID_VENTURE_REQUEST'));
});

test('the push key never reaches a record, an event or an answer: only the public half is ever written', async () => {
  const env = await setup();
  const { net } = network();
  const port = pushPort();
  const deps = hostedDeps(env, port, net);
  await subscribe(deps, browserSubscription().input);
  await seedBlueprint(env, { status: 'draft' });
  await look(deps);
  const stored = JSON.stringify(env.store.read());
  assert.equal(stored.includes(port.publicKey), false, 'not even the public key is stored: the host holds it');
  assert.equal(/vapid|BEGIN|PRIVATE/i.test(stored), false);
  assert.equal(subscriptions(env).length, 1);
});

// ---------------------------------------------------------------------------
// The service worker (app/ui/public/sw.js)
// ---------------------------------------------------------------------------

async function serviceWorker(options: { clients?: any[] } = {}) {
  const source = await readFile(new URL('../../app/ui/public/sw.js', import.meta.url), 'utf8');
  const listeners = new Map<string, (event: any) => void>();
  const shown: { title: string; options: any }[] = [];
  const opened: string[] = [];
  const windows = options.clients ?? [];
  const self: any = {
    addEventListener: (name: string, listener: (event: any) => void) => { listeners.set(name, listener); },
    registration: { scope: 'https://app.example.com/app/', showNotification: async (title: string, opts: any) => { shown.push({ title, options: opts }); } },
    clients: { matchAll: async () => windows, openWindow: async (url: string) => { opened.push(url); return null; }, claim: async () => {} },
    skipWaiting: async () => {},
    location: new URL('https://app.example.com/app/sw.js'),
  };
  vm.runInNewContext(source, { self, URL, console: { error() {} } });
  const fire = async (name: string, event: any) => {
    const waits: Promise<unknown>[] = [];
    listeners.get(name)!({ ...event, waitUntil: (promise: Promise<unknown>) => { waits.push(promise); } });
    await Promise.all(waits);
  };
  return { source, listeners, shown, opened, fire };
}

test('the service worker shows one notification "Chausar" with the count, tag chausar-count, and nothing from the business', async () => {
  const sw = await serviceWorker();
  await sw.fire('push', { data: { json: () => ({ count: 3 }), text: () => '{"count":3}' } });
  assert.equal(sw.shown.length, 1);
  assert.equal(sw.shown[0].title, 'Chausar');
  assert.equal(sw.shown[0].options.body, '3 need you');
  assert.equal(sw.shown[0].options.tag, 'chausar-count');
  await sw.fire('push', { data: { json: () => ({ count: 1 }), text: () => '{"count":1}' } });
  assert.equal(sw.shown[1].options.body, '1 needs you');
  // Anything else in a payload is never shown; a payload that is not a count still shows (browsers require one) without a number.
  await sw.fire('push', { data: { json: () => ({ count: 2, title: 'Asha owes 18,880' }), text: () => '' } });
  assert.equal(sw.shown[2].options.body, '2 need you');
  assert.equal(JSON.stringify(sw.shown[2]).includes('Asha'), false);
  await sw.fire('push', { data: { json: () => { throw new Error('not json'); }, text: () => 'x' } });
  assert.equal(sw.shown[3].options.body, 'Something needs you in Chausar.');
  await sw.fire('push', { data: null });
  assert.equal(sw.shown[4].options.body, 'Something needs you in Chausar.');
  for (const item of sw.shown) assert.deepEqual(item.options.actions ?? [], [], 'no buttons: a notification never acts on its own');
});

test('a tap on the notification opens the approval page, focusing an open Chausar window when there is one; it decides nothing', async () => {
  const sw = await serviceWorker();
  let closed = 0;
  await sw.fire('notificationclick', { notification: { close: () => { closed += 1; }, tag: 'chausar-count' } });
  assert.equal(closed, 1);
  assert.deepEqual(sw.opened, ['https://app.example.com/app/#/approve/next']);

  const navigated: string[] = [];
  let focused = 0;
  const client = { url: 'https://app.example.com/app/#/today', focus: async () => { focused += 1; return client; }, navigate: async (url: string) => { navigated.push(url); return client; } };
  const open = await serviceWorker({ clients: [client] });
  await open.fire('notificationclick', { notification: { close() {}, tag: 'chausar-count' } });
  assert.equal(focused, 1);
  assert.deepEqual(navigated, ['https://app.example.com/app/#/approve/next']);
  assert.deepEqual(open.opened, []);
});

test('the service worker keeps nothing in browser storage and fetches nothing', async () => {
  const sw = await serviceWorker();
  for (const word of ['caches', 'indexedDB', 'localStorage', 'sessionStorage', 'cookieStore', 'fetch(', 'importScripts', 'XMLHttpRequest']) {
    assert.equal(sw.source.includes(word), false, word);
  }
  assert.equal(sw.listeners.has('fetch'), false, 'no fetch handler: pages load as they always do');
  assert.ok(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u200B-\u200F\u2028\u2029\uFEFF]/.test(sw.source) === false, 'no invisible characters');
});
