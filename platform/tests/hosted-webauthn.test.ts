// Hosted tier: passkeys checked with Node's crypto. Real P-256, Ed25519 and RSA signatures from a software
// authenticator; every check that guards sign-in is exercised with a response that should fail it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { decodeCbor, encodeCbor } from '../runtime/hosted/cbor.ts';
import { authenticationOptions, registrationOptions, verifyAuthentication, verifyRegistration, type RelyingParty } from '../runtime/hosted/webauthn.ts';
import { SoftAuthenticator } from './hosted-authenticator.ts';

const rp: RelyingParty = { id: 'app.chausar.test', name: 'Chausar', origin: 'https://app.chausar.test' };
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
const user = { handle: Buffer.alloc(16, 7).toString('base64url'), email: 'owner@example.test' };

function register(kind: 'p256' | 'ed25519' | 'rsa', fmt: 'none' | 'packed' = 'none', startCounter = 0) {
  const authenticator = new SoftAuthenticator(kind, { startCounter });
  const options = registrationOptions(rp, user, 'reg-challenge-0000000000000000000000000', []);
  const stored = verifyRegistration(rp, authenticator.create(options, { origin: rp.origin, fmt }), { challenge: options.challenge });
  return { authenticator, stored };
}

test('the small CBOR codec reads back what it writes and refuses trailing or broken bytes', () => {
  const value = new Map<any, any>([['fmt', 'none'], [1, -7], [-2, Buffer.from([1, 2, 3])], ['list', [true, false, null, 300, 70000]]]);
  const bytes = encodeCbor(value);
  assert.deepEqual(decodeCbor(bytes), value);
  assert.throws(() => decodeCbor(Buffer.concat([bytes, Buffer.from([0])])), code('PASSKEY_INVALID'));
  assert.throws(() => decodeCbor(bytes.subarray(0, bytes.length - 2)), code('PASSKEY_INVALID'));
  assert.throws(() => decodeCbor(Buffer.from([0xa2, 0x01, 0x01, 0x01, 0x02])), code('PASSKEY_INVALID'), 'duplicate map keys');
  assert.throws(() => decodeCbor(Buffer.from([0x9f])), code('PASSKEY_INVALID'), 'indefinite length');
});

test('options ask for a discoverable passkey that checks the person, with no attestation', () => {
  const options = registrationOptions(rp, user, 'abc', ['old-id']);
  assert.deepEqual(options.authenticatorSelection, { residentKey: 'required', requireResidentKey: true, userVerification: 'required' });
  assert.equal(options.attestation, 'none');
  assert.deepEqual(options.pubKeyCredParams.map(p => p.alg), [-7, -8, -257]);
  assert.deepEqual(options.excludeCredentials, [{ type: 'public-key', id: 'old-id' }]);
  assert.deepEqual(authenticationOptions(rp, 'xyz'), { challenge: 'xyz', rpId: rp.id, userVerification: 'required', timeout: 300000, allowCredentials: [] });
});

for (const kind of ['p256', 'ed25519', 'rsa'] as const) {
  test(`${kind} passkey: registers, then signs in`, () => {
    const { authenticator, stored } = register(kind);
    assert.equal(stored.id, authenticator.id);
    assert.equal(stored.alg, authenticator.alg());
    assert.equal(stored.backupEligible, true);
    assert.deepEqual(stored.transports, ['internal', 'hybrid']);
    const options = authenticationOptions(rp, 'login-challenge-00000000000000000000000');
    const result = verifyAuthentication(rp, authenticator.get(options, { origin: rp.origin }), { challenge: options.challenge, passkey: stored, userHandle: user.handle });
    assert.equal(result.signCount, 0);
  });
}

test('packed self attestation is accepted only when its signature checks', () => {
  const { stored } = register('p256', 'packed');
  assert.equal(stored.alg, -7);
  const authenticator = new SoftAuthenticator('p256');
  const options = registrationOptions(rp, user, 'reg-challenge-1', []);
  const response = authenticator.create(options, { origin: rp.origin, fmt: 'packed' });
  const attestation = decodeCbor(Buffer.from(response.response.attestationObject, 'base64url')) as Map<any, any>;
  attestation.get('attStmt').set('sig', Buffer.alloc(70, 1));
  response.response.attestationObject = encodeCbor(attestation).toString('base64url');
  assert.throws(() => verifyRegistration(rp, response, { challenge: options.challenge }), code('PASSKEY_INVALID'));
});

test('registration refuses another site, another challenge, the wrong ceremony and a skipped user check', () => {
  const options = registrationOptions(rp, user, 'reg-challenge-2', []);
  const fresh = () => new SoftAuthenticator('p256');
  assert.throws(() => verifyRegistration(rp, fresh().create(options, { origin: 'https://evil.test' }), { challenge: options.challenge }), code('PASSKEY_ORIGIN_MISMATCH'));
  assert.throws(() => verifyRegistration(rp, fresh().create(options, { origin: rp.origin, rpId: 'evil.test' }), { challenge: options.challenge }), code('PASSKEY_ORIGIN_MISMATCH'));
  assert.throws(() => verifyRegistration(rp, fresh().create(options, { origin: rp.origin, challenge: 'other' }), { challenge: options.challenge }), code('PASSKEY_CHALLENGE_MISMATCH'));
  assert.throws(() => verifyRegistration(rp, fresh().create(options, { origin: rp.origin, type: 'webauthn.get' }), { challenge: options.challenge }), code('PASSKEY_INVALID'));
  assert.throws(() => verifyRegistration(rp, fresh().create(options, { origin: rp.origin, flags: 0x01 }), { challenge: options.challenge }), code('PASSKEY_INVALID'), 'no user verification');
  assert.throws(() => verifyRegistration(rp, fresh().create(options, { origin: rp.origin, flags: 0x04 }), { challenge: options.challenge }), code('PASSKEY_INVALID'), 'no user presence');
  const mismatched = fresh().create(options, { origin: rp.origin });
  mismatched.id = mismatched.rawId = Buffer.alloc(32, 9).toString('base64url');
  assert.throws(() => verifyRegistration(rp, mismatched, { challenge: options.challenge }), code('PASSKEY_INVALID'));
  assert.throws(() => verifyRegistration(rp, { ...fresh().create(options, { origin: rp.origin }), extra: 1 }, { challenge: options.challenge }), code('PASSKEY_INVALID'));
  assert.throws(() => verifyRegistration(rp, null, { challenge: options.challenge }), code('PASSKEY_INVALID'));
});

test('sign-in refuses a forged signature, a different key, a different user and a replayed counter', () => {
  const { authenticator, stored } = register('p256', 'none', 5);
  const options = authenticationOptions(rp, 'login-challenge-1');
  const verify = (response: any, passkey = stored) => verifyAuthentication(rp, response, { challenge: options.challenge, passkey, userHandle: user.handle });

  const first = verify(authenticator.get(options, { origin: rp.origin }));
  assert.equal(first.signCount, 6);
  const current = { ...stored, signCount: first.signCount };

  const forged = authenticator.get(options, { origin: rp.origin });
  forged.response.signature = Buffer.from(forged.response.signature, 'base64url').reverse().toString('base64url');
  assert.throws(() => verify(forged, current), code('PASSKEY_INVALID'));

  const stranger = new SoftAuthenticator('p256');
  const strangerResponse = stranger.get(options, { origin: rp.origin, userHandle: user.handle });
  strangerResponse.id = strangerResponse.rawId = stored.id;
  assert.throws(() => verify(strangerResponse, current), code('PASSKEY_INVALID'));

  assert.throws(() => verify(authenticator.get(options, { origin: rp.origin, userHandle: Buffer.alloc(16, 1).toString('base64url') }), current), code('PASSKEY_INVALID'));
  assert.throws(() => verify(authenticator.get(options, { origin: rp.origin, challenge: 'stale' }), current), code('PASSKEY_CHALLENGE_MISMATCH'));
  assert.throws(() => verify(authenticator.get(options, { origin: 'https://evil.test' }), current), code('PASSKEY_ORIGIN_MISMATCH'));

  const replay = authenticator.get(options, { origin: rp.origin, bump: false });
  assert.throws(() => verify(replay, { ...current, signCount: authenticator.counter }), code('PASSKEY_CLONED'));
});

test('the relying party id is hashed into every authenticator answer', () => {
  const { authenticator, stored } = register('ed25519');
  const options = authenticationOptions(rp, 'login-challenge-2');
  const response = authenticator.get(options, { origin: rp.origin, rpId: 'chausar.test' });
  assert.throws(() => verifyAuthentication(rp, response, { challenge: options.challenge, passkey: stored, userHandle: user.handle }), code('PASSKEY_ORIGIN_MISMATCH'));
  assert.equal(createHash('sha256').update(rp.id).digest().length, 32);
});
