import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { buildKeychainHelper, verifyKeychainLinux } from '../../scripts/release/verify-keychain-linux.ts';

/*
 * The Linux keychain helper against a real Secret Service. Offline and skipped by default: it runs only when
 * CHAUSAR_REAL_KEYCHAIN=1, on Linux, with dbus-daemon, gnome-keyring-daemon, gdbus and secret-tool installed. It uses
 * CHAUSAR_REAL_KEYCHAIN_HELPER (an absolute path to a compiled helper) or compiles platform/native/keychain with CMake
 * (libsecret-1 and glib-2.0 development files). A private bus and a throwaway keyring are started and stopped by the
 * script itself; nothing touches the person's own keyring.
 */

const enabled = process.env.CHAUSAR_REAL_KEYCHAIN === '1';
const helper = process.env.CHAUSAR_REAL_KEYCHAIN_HELPER?.trim() || '';
const skip = !enabled ? 'set CHAUSAR_REAL_KEYCHAIN=1 to run the helper against a real Secret Service'
  : process.platform !== 'linux' ? 'the libsecret helper runs on Linux' : false;

test('real Secret Service: manifest, store/retrieve/conflict/remove, Vault and Engine keychain unlock, and refusals', { skip, timeout: 600_000 }, async t => {
  let executable = helper;
  if (!executable) {
    const build = await mkdtemp(join(await realpath(tmpdir()), 'chausar-keychain-build-'));
    t.after(() => rm(build, { recursive: true, force: true }));
    executable = await buildKeychainHelper(build);
  }
  assert.ok(isAbsolute(executable), 'CHAUSAR_REAL_KEYCHAIN_HELPER must be an absolute path');
  const receipt = await verifyKeychainLinux({ helper: executable });
  const failed = receipt.steps.filter(step => !step.ok).map(step => `${step.name}: ${step.error}`);
  assert.deepEqual(failed, [], failed.join('\n'));
  assert.deepEqual(receipt.steps.map(step => step.name), ['secret-service-started', 'manifest-written-and-loaded-by-engine',
    'store-retrieve-conflict-remove', 'vault-created-with-custody-reopened-with-keychain', 'engine-workspace-open-unlock-keychain',
    'no-session-bus', 'bus-without-secret-service', 'locked-keyring']);
  const detail = (name: string) => receipt.steps.find(step => step.name === name)?.detail ?? {};
  assert.equal(detail('manifest-written-and-loaded-by-engine').sha256, receipt.helper.sha256);
  assert.equal(detail('store-retrieve-conflict-remove').bytesEqual, true);
  assert.equal(detail('store-retrieve-conflict-remove').conflict, 'KEYCHAIN_CONFLICT');
  assert.equal(detail('store-retrieve-conflict-remove').entriesInStore, 1);
  assert.equal(detail('store-retrieve-conflict-remove').entriesAfterRemove, 0);
  assert.equal(detail('engine-workspace-open-unlock-keychain').reopenAfterDelete, 'UNLOCK_FAILED');
  assert.deepEqual(detail('no-session-bus').missingSocket, { refusal: 'KEYCHAIN_UNAVAILABLE', helperRan: true });
  assert.equal(detail('bus-without-secret-service').retrieve, 'KEYCHAIN_UNAVAILABLE');
  for (const name of ['retrieve', 'storeNew', 'storeSame', 'remove']) assert.equal(detail('locked-keyring')[name], 'KEYCHAIN_DENIED');
  assert.equal(receipt.ok, true);
});
