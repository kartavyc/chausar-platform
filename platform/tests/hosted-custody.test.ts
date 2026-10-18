// Hosted tier: server custody of vault keys. Sealed passphrases open only for their own tenant and business, under
// the same master key, and nothing about the key itself is ever written.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { HostedCustody, isBusinessId, isTenantId, newBusinessId, newTenantId, parseMasterKey } from '../runtime/hosted/custody.ts';

const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
const masterKey = () => randomBytes(32).toString('base64url');

test('the master key is exactly 32 bytes of base64url; anything else is refused, not stretched', () => {
  assert.equal(parseMasterKey(masterKey()).length, 32);
  for (const bad of ['', 'short', 'x'.repeat(44), randomBytes(31).toString('base64url'), randomBytes(32).toString('base64'), 42, undefined]) {
    assert.throws(() => parseMasterKey(bad), code('CUSTODY_KEY_INVALID'), String(bad));
  }
});

test('ids are server-made and shaped so they can never be a path', () => {
  const tenant = newTenantId(), business = newBusinessId();
  assert.ok(isTenantId(tenant) && isBusinessId(business));
  for (const bad of ['../t_0', 't_', 't_' + 'g'.repeat(24), business, 'T_' + 'a'.repeat(24)]) assert.equal(isTenantId(bad), false, bad);
  for (const bad of ['b_../x', tenant, 'b_' + 'a'.repeat(25)]) assert.equal(isBusinessId(bad), false, bad);
});

test('a sealed vault passphrase opens only for its own tenant and business', () => {
  const custody = HostedCustody.fromKey(masterKey());
  const tenantA = newTenantId(), tenantB = newTenantId(), business = newBusinessId(), other = newBusinessId();
  const passphrase = custody.newVaultPassphrase();
  assert.equal(passphrase.length, 43);
  const sealed = custody.wrapPassphrase(tenantA, business, passphrase);
  assert.equal(JSON.stringify(sealed).includes(passphrase), false);
  assert.equal(custody.unwrapPassphrase(tenantA, business, sealed), passphrase);
  assert.throws(() => custody.unwrapPassphrase(tenantB, business, sealed), code('CUSTODY_INVALID'));
  assert.throws(() => custody.unwrapPassphrase(tenantA, other, sealed), code('CUSTODY_INVALID'));
  assert.throws(() => custody.unwrapPassphrase(tenantA, business, { ...sealed, data: Buffer.from('tampered').toString('base64url') }), code('CUSTODY_INVALID'));
  assert.throws(() => custody.unwrapPassphrase('../etc', business, sealed), code('CUSTODY_INVALID'));
});

test('a different master key says so plainly instead of failing as tampering', () => {
  const one = HostedCustody.fromKey(masterKey()), two = HostedCustody.fromKey(masterKey());
  const tenant = newTenantId(), business = newBusinessId();
  const sealed = one.wrapPassphrase(tenant, business, one.newVaultPassphrase());
  assert.notEqual(one.keyId, two.keyId);
  assert.throws(() => two.unwrapPassphrase(tenant, business, sealed), code('CUSTODY_KEY_MISMATCH'));
  const directory = one.sealDirectory(Buffer.from('{"users":[]}'));
  assert.equal(one.openDirectory(directory).toString(), '{"users":[]}');
  assert.throws(() => two.openDirectory(directory), code('CUSTODY_KEY_MISMATCH'));
});

test('the renderer key is an HMAC of the session id: stable, unforgeable without the master key, and checked in constant time', () => {
  const custody = HostedCustody.fromKey(masterKey());
  const key = custody.rendererKey('hsession_1');
  assert.match(key, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(custody.rendererKey('hsession_1'), key);
  assert.notEqual(custody.rendererKey('hsession_2'), key);
  assert.equal(custody.sameRendererKey('hsession_1', key), true);
  assert.equal(custody.sameRendererKey('hsession_2', key), false);
  assert.equal(custody.sameRendererKey('hsession_1', key.slice(0, 42)), false);
  assert.equal(custody.sameRendererKey('hsession_1', 42), false);
  assert.equal(HostedCustody.fromKey(masterKey()).sameRendererKey('hsession_1', key), false);
});

test('an ephemeral development key says it is ephemeral', () => {
  assert.equal(HostedCustody.ephemeral().ephemeral, true);
  assert.equal(HostedCustody.fromKey(masterKey()).ephemeral, false);
});
