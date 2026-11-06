// Fix round 1 (review MEDIUM-2): a test that forgets its stand-in network goes red instead of dialling out. noNet(t)
// makes any real fetch throw NETWORK_NOT_ALLOWED for that one test; every engine test file that builds a ReleaseUpdater
// (whose app default is a real streamed fetch) calls it for each test. The relay takes no default network at all
// (venture-event-relay-c7 holds that).
import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readdir, readFile, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { noNet, NETWORK_NOT_ALLOWED } from './helpers/no-net.ts';
import { ReleaseUpdater, canonicalReleaseManifest, type ReleaseManifest } from '../runtime/updater.ts';

const TESTS = fileURLToPath(new URL('.', import.meta.url));
test.beforeEach(t => noNet(t));

test('under noNet a real fetch throws NETWORK_NOT_ALLOWED, and an updater with no download seam never dials out', async t => {
  await assert.rejects(fetch('https://downloads.example.com/x'), (error: any) => error.code === NETWORK_NOT_ALLOWED);
  const stageDirectory = await mkdtemp(join(await realpath(tmpdir()), 'chausar-no-net-'));
  t.after(() => rm(stageDirectory, { recursive: true, force: true }));
  const keys = generateKeyPairSync('ed25519'), body = Buffer.from('never fetched');
  const manifest: ReleaseManifest = { schemaVersion: 1, version: '1.1.0', publishedAt: '2026-09-01T00:00:00.000Z', platform: process.platform as any, architecture: process.arch as any, url: 'https://downloads.example.com/chausar.pkg', sha256: createHash('sha256').update(body).digest('hex'), size: body.length, minEngineVersion: '1.0.0', dataSchemaVersion: 1, rollback: { supported: true, requiresBackup: true } };
  const forgetful = new ReleaseUpdater({ publicKey: keys.publicKey, version: '1.0.0', stageDirectory });
  await assert.rejects(forgetful.stage(manifest, sign(null, Buffer.from(canonicalReleaseManifest(manifest)), keys.privateKey).toString('base64url')), (error: any) => error.code === NETWORK_NOT_ALLOWED);
});

function needsGuard(text: string) {
  const source = ts.createSourceFile('guard.ts', text, ts.ScriptTarget.Latest, true);
  let updater = false, guarded = false;
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && ['ReleaseUpdater', 'updatePublicKey'].includes(node.text)) updater = true;
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'test.beforeEach') {
      const callback = node.arguments[0];
      if (callback && ts.isArrowFunction(callback) && ts.isCallExpression(callback.body)
        && callback.body.expression.getText(source) === 'noNet'
        && callback.parameters.length === 1 && callback.body.arguments.length === 1
        && callback.parameters[0]!.name.getText(source) === callback.body.arguments[0]!.getText(source)) guarded = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return updater && !guarded;
}

test('every engine test file that builds a ReleaseUpdater calls noNet for each test', async () => {
  const missing: string[] = [];
  for (const name of (await readdir(TESTS)).filter(file => file.endsWith('.test.ts')).sort()) {
    const text = await readFile(join(TESTS, name), 'utf8');
    if (needsGuard(text)) missing.push(name);
  }
  assert.deepEqual(missing, []);
});


test('cleanup: updater network guards ignore comments and cover namespace constructors and engine options', () => {
  assert.equal(needsGuard('new U.ReleaseUpdater ({})'), true);
  assert.equal(needsGuard('new Engine({ updatePublicKey: key })'), true);
  assert.equal(needsGuard('new ReleaseUpdater({}); // test.beforeEach(t => noNet(t))'), true);
  assert.equal(needsGuard('new ReleaseUpdater({}); test.beforeEach(t => noNet(t));'), false);
  assert.equal(needsGuard('// new ReleaseUpdater({})'), false);
});
