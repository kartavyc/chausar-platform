import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ReleaseUpdater, canonicalReleaseManifest } from '../runtime/updater.ts';
import { ChannelGuard, canonicalChannelDocument, type ChannelDocument } from '../runtime/native/update-channel.ts';
import { DataGuard } from '../runtime/native/update-data-guard.ts';
import { HOUR, code, entry, hash, keys, releaseManifest, signText, temporary, world } from './fixtures/release-attack-world.ts';

// Downgrade, freeze and rollback attacks. Every test is one attack; passing means it is refused (or, where the
// test name says "documented limit", that the limit is exactly as narrow as docs/releases.md states).
const NOW = Date.parse('2026-10-14T12:00:00.000Z'), DAY = 24 * HOUR;
const feedAt = (issued:number, over:Partial<ChannelDocument> = {}) => {
  const document:ChannelDocument = { format: 'chausar.channel.v1', channel: 'stable', issuedAt: new Date(issued).toISOString(), expiresAt: new Date(issued + 7 * DAY).toISOString(), releases: [entry('1.1.0', 'a'.repeat(64))], ...over };
  const text = canonicalChannelDocument(document); return { text, signature: signText(text) };
};
const guard = (stateDirectory:string, now = NOW) => new ChannelGuard({ publicKey: keys.publicKey, channel: 'stable', stateDirectory, now: () => now });
async function migrate(w:{ appDataDirectory:string }, schema:number, by:string) { await new DataGuard({ appDataDirectory: w.appDataDirectory }).recordSchema(schema, by); }

test('attack: replaying an older signed feed is refused while the saved anchor exists', async t => {
  const state = await temporary(t), older = feedAt(NOW - 3 * DAY), newer = feedAt(NOW - DAY);
  await guard(state).accept(newer.text, newer.signature);
  await assert.rejects(guard(state).accept(older.text, older.signature), code('UPDATE_FEED_ROLLBACK'));
});

test('documented limit: deleting channel-state.json re-admits an older unexpired feed, but it still cannot downgrade the app', async t => {
  const state = await temporary(t), older = feedAt(NOW - 3 * DAY, { releases: [entry('0.9.0', 'a'.repeat(64))] }), newer = feedAt(NOW - DAY);
  await guard(state).accept(newer.text, newer.signature);
  await rm(join(state, 'channel-state.json'));
  // The anchor is a local file: without it a feed up to 30 days old is accepted again (freeze window, not downgrade).
  const replayed = await guard(state).accept(older.text, older.signature);
  assert.equal(replayed.releases[0].version, '0.9.0');
  const artifact = Buffer.from('inert'), old = releaseManifest('0.9.0', artifact), text = canonicalReleaseManifest(old);
  const updater = new ReleaseUpdater({ publicKey: keys.publicKey, version: '1.0.0', stageDirectory: join(state, 'stage') });
  assert.throws(() => updater.verify(text, signText(text)), code('RELEASE_DOWNGRADE_REFUSED'));
});

test('attack: a frozen feed stops working at expiry, and a feed cannot claim more than thirty days', async t => {
  const state = await temporary(t), stale = feedAt(NOW - 8 * DAY);
  await assert.rejects(guard(state).accept(stale.text, stale.signature), code('UPDATE_FEED_EXPIRED'));
  const forever = feedAt(NOW - HOUR, { expiresAt: new Date(NOW + 400 * DAY).toISOString() });
  await assert.rejects(guard(state).accept(forever.text, forever.signature), code('UPDATE_FEED_LIFETIME_TOO_LONG'));
  const future = feedAt(NOW + DAY);
  await assert.rejects(guard(state).accept(future.text, future.signature), code('UPDATE_FEED_FROM_FUTURE'));
});

test('attack: two different feeds signed with the same issue time are refused (same-version-different-content)', async t => {
  const state = await temporary(t), first = feedAt(NOW - HOUR), second = feedAt(NOW - HOUR, { releases: [entry('1.1.0', 'b'.repeat(64))] });
  await guard(state).accept(first.text, first.signature);
  await assert.rejects(guard(state).accept(second.text, second.signature), code('UPDATE_FEED_CONFLICT'));
  const w = await world(t), service = w.make('1.0.0');
  await service.check(); await service.stage();
  // The publisher re-signs 1.1.0 with different contents and a new feed names it: the staged 1.1.0 is not replaced silently.
  const changed = { ...w.manifest, publishedAt: '2026-09-02T00:00:00.000Z' }, text = canonicalReleaseManifest(changed);
  const updater = new ReleaseUpdater({ publicKey: keys.publicKey, version: '1.0.0', stageDirectory: join(w.installRoot, 'staging'), http: async (r:any) => ({ status: 200, url: r.url, body: w.artifact }) });
  await assert.rejects(updater.stage(text, signText(text)), code('RELEASE_VERSION_CONFLICT'));
});

test('attack: without the release key, nobody can raise the kill switch, and the kill switch never rolls back by itself', async t => {
  const w = await world(t), mallory = generateKeyPairSync('ed25519');
  const withdrawn = canonicalChannelDocument({ format: 'chausar.channel.v1', channel: 'stable', issuedAt: new Date(Date.now()).toISOString(), expiresAt: new Date(Date.now() + DAY).toISOString(), releases: [entry('0.9.0', 'a'.repeat(64)), entry('1.0.0', 'a'.repeat(64), { withdrawn: true })] });
  w.files['https://updates.example.com/stable.json'] = withdrawn; w.files['https://updates.example.com/stable.json.sig'] = signText(withdrawn, mallory.privateKey);
  await assert.rejects(w.make('1.0.0').check(), code('UPDATE_FEED_SIGNATURE_INVALID'));
  w.files['https://updates.example.com/stable.json.sig'] = '';
  await assert.rejects(w.make('1.0.0').check(), (error:any) => ['UPDATE_FEED_UNSIGNED', 'UPDATE_FEED_UNAVAILABLE'].includes(error.code));
  // Signed by the publisher: only advice; the pointer is unchanged until a person confirms release.rollback.
  w.publish([entry('0.9.0', 'a'.repeat(64)), entry('1.0.0', 'a'.repeat(64), { withdrawn: true })]);
  const advice = await w.make('1.0.0').check();
  assert.equal(advice.action, 'rollback-advised');
  assert.equal(JSON.parse(await readFile(join(w.installRoot, 'current.json'), 'utf8')).version, '1.0.0');
});

test('attack: a release withdrawn after it was staged is not applied', async t => {
  const w = await world(t), service = w.make('1.0.0');
  await service.check(); await service.stage();
  w.publish([entry('1.1.0', hash(w.manifestText), { withdrawn: true })]);
  await service.check();
  await assert.rejects(service.apply({ confirmed: true, backup: w.backup }), code('UPDATE_WITHDRAWN'));
  assert.equal(JSON.parse(await readFile(join(w.installRoot, 'current.json'), 'utf8')).version, '1.0.0');
});

test('attack: a tampered saved feed fails closed instead of hiding a withdrawal', async t => {
  const w = await world(t), service = w.make('1.0.0');
  await service.check(); await service.stage();
  const path = join(w.appDataDirectory, 'release', 'channel-document.json'), saved = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(path, JSON.stringify({ ...saved, signature: signText(saved.text, generateKeyPairSync('ed25519').privateKey) }));
  await assert.rejects(service.apply({ confirmed: true, backup: w.backup }), code('UPDATE_FEED_STATE_INVALID'));
});

test('attack: release.rollback to a withdrawn previous version is refused', async t => {
  const w = await world(t), service = w.make('1.0.0');
  await service.check(); await service.stage(); await service.apply({ confirmed: true, backup: w.backup });
  const next = w.make('1.1.0', 2);
  await next.confirmHealthy();
  w.publish([entry('1.0.0', 'a'.repeat(64), { withdrawn: true }), entry('1.1.0', hash(w.manifestText))]);
  await next.check();
  await assert.rejects(next.rollback({ confirmed: true }), code('ROLLBACK_TARGET_WITHDRAWN'));
  assert.equal(JSON.parse(await readFile(join(w.installRoot, 'current.json'), 'utf8')).version, '1.1.0');
});

test('attack: release.rollback past a raised data-schema marker is refused with VAULT_NEWER_THAN_APP', async t => {
  const w = await world(t), service = w.make('1.0.0');
  await service.check(); await service.stage(); await service.apply({ confirmed: true, backup: w.backup });
  const next = w.make('1.1.0', 2);
  await next.confirmHealthy();
  // Before migration a rollback is still allowed (proved by the existing service test); after it, 1.0.0 (schema 1) cannot open the vault.
  await migrate(w, 2, '1.1.0');
  await assert.rejects(next.rollback({ confirmed: true }), code('VAULT_NEWER_THAN_APP'));
  assert.equal(JSON.parse(await readFile(join(w.installRoot, 'current.json'), 'utf8')).version, '1.1.0');
  // A previous version whose schema was never recorded is treated as unable to open a migrated vault.
  await writeFile(join(w.appDataDirectory, 'release', 'version-schemas.json'), JSON.stringify({ versions: { '1.1.0': 2 } }));
  await assert.rejects(next.rollback({ confirmed: true }), code('VAULT_NEWER_THAN_APP'));
});

test('attack: the launcher does not roll a trial back past a migration (the vault would be stranded)', async t => {
  const w = await world(t), service = w.make('1.0.0');
  await service.check(); await service.stage(); await service.apply({ confirmed: true, backup: w.backup });
  const next = w.make('1.1.0', 2);
  await migrate(w, 2, '1.1.0');
  for (let launch = 1; launch <= 4; launch++) {
    const decision = await next.resolveLaunch();
    assert.equal(decision?.version, '1.1.0'); assert.equal(decision?.rolledBack, false);
    if (launch > 2) assert.equal(decision?.rollbackUnavailable, true);
  }
  assert.equal(JSON.parse(await readFile(join(w.installRoot, 'current.json'), 'utf8')).state, 'trial');
});

test('control: without a migration the launcher still rolls an unconfirmed trial back automatically', async t => {
  const w = await world(t), service = w.make('1.0.0');
  await service.check(); await service.stage(); await service.apply({ confirmed: true, backup: w.backup });
  const next = w.make('1.1.0', 2);
  await next.resolveLaunch(); await next.resolveLaunch();
  const third = await next.resolveLaunch();
  assert.equal(third?.version, '1.0.0'); assert.equal(third?.rolledBack, true);
});

test('documented limit: a malformed install pointer is refused; a well-formed edit by local malware is out of scope', async t => {
  const w = await world(t), service = w.make('1.0.0');
  for (const pointer of ['{"version":"1.0.0"}', '{"version":"../../x","previous":null,"state":"committed","attempts":0,"swappedAt":"2026-10-14T00:00:00.000Z"}', '{"version":"1.0.0","previous":"1.0.0","state":"committed","attempts":0,"swappedAt":"2026-10-14T00:00:00.000Z"}', 'not json']) {
    await writeFile(join(w.installRoot, 'current.json'), pointer);
    await assert.rejects(service.resolveLaunch(), code('INSTALL_POINTER_INVALID'));
  }
});
