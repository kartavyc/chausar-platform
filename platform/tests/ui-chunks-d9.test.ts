import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const script = resolve('scripts/ui-chunks.mjs');
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'chausar-chunks-'));
  const dist = join(root, 'dist');
  await mkdir(join(dist, 'assets'), { recursive: true });
  await writeFile(join(dist, 'index.html'), `<link rel="modulepreload" href="./assets/vendor-A.js"><link href="./assets/main-C.css" rel="stylesheet"><script crossorigin type="module" src="./assets/start-B.js"></script>`);
  await Promise.all([['start-B.js', 20], ['main-C.css', 10], ['vendor-A.js', 40], ['font.woff2', 100]].map(([name, bytes]) => writeFile(join(dist, 'assets', String(name)), 'x'.repeat(Number(bytes)))));
  const baseline = join(root, 'budget.json');
  await writeFile(baseline, JSON.stringify({ entryJs: 25, entryCss: 15, largestChunk: 45 }));
  return { root, dist, baseline };
}
function run(dist: string, baseline: string, ...flags: string[]) {
  return spawnSync(process.execPath, [script, '--dist', dist, '--baseline', baseline, ...flags], { encoding: 'utf8' });
}
test('chunk report resolves entry assets from HTML, distinguishes scripts from fonts, and accepts smaller sizes', async () => {
  const f = await fixture();
  try {
    const result = run(f.dist, f.baseline, '--json', '--check');
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.deepEqual(report.entryJs, { path: 'assets/start-B.js', bytes: 20 });
    assert.deepEqual(report.entryCss, { paths: ['assets/main-C.css'], bytes: 10 });
    assert.deepEqual(report.largestChunk, { path: 'assets/vendor-A.js', bytes: 40 });
    assert.equal(report.assets.length, 4);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test('each budget refuses an oversized asset by name', async () => {
  const f = await fixture();
  try {
    for (const name of ['entryJs', 'entryCss', 'largestChunk']) {
      await writeFile(f.baseline, JSON.stringify({ entryJs: 25, entryCss: 15, largestChunk: 45, [name]: 1 }));
      const result = run(f.dist, f.baseline, '--check');
      assert.equal(result.status, 1);
      assert.match(result.stderr, new RegExp(name + '.*exceeds'));
    }
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test('a missing entry is a failed report, not a zero byte pass', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.dist, 'index.html'), '<html></html>');
    const result = run(f.dist, f.baseline, '--check');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /entry script/i);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('a required vendor chunk cannot silently disappear from a passing budget', async () => {
  const f = await fixture();
  try {
    await writeFile(f.baseline, JSON.stringify({ entryJs: 25, entryCss: 15, largestChunk: 45, requiredChunks: ['react-vendor'] }));
    const missing = run(f.dist, f.baseline, '--check');
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /Missing required chunk: react-vendor/);
    await writeFile(join(f.dist, 'assets/react-vendor-Ab_12.js'), 'small vendor');
    const present = run(f.dist, f.baseline, '--check');
    assert.equal(present.status, 0, present.stderr);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('every initial stylesheet contributes to the CSS budget after splitting', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.dist, 'assets/shared-Z.css'), 'x'.repeat(20));
    await writeFile(join(f.dist, 'index.html'), `<link rel="stylesheet" href="./assets/shared-Z.css"><link rel="stylesheet" href="./assets/main-C.css"><script type="module" src="./assets/start-B.js"></script>`);
    const result = run(f.dist, f.baseline, '--json', '--check');
    const report = JSON.parse(result.stdout);
    assert.equal(report.entryCss.bytes, 30);
    assert.deepEqual(report.entryCss.paths, ['assets/shared-Z.css', 'assets/main-C.css']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /entryCss.*30 exceeds 15/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
