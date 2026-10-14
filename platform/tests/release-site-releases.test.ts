import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { applySums, buildReleasesPage, parseSums, renderReleasesPage, validateFeed } from '../../scripts/release/releases-page.ts';

const cli = fileURLToPath(new URL('../../scripts/release/releases-page.ts', import.meta.url));
const exampleFeed = fileURLToPath(new URL('../../scripts/release/releases.json', import.meta.url));
const digest = 'ab'.repeat(32);

async function scratch(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-release-page-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function feed(overrides: Record<string, unknown> = {}, artifacts?: unknown[]) {
  return {
    schemaVersion: 1,
    product: 'Chausar',
    releases: [{
      version: '0.1.0-preview.1', channel: 'preview', date: '2026-10-14', expires: '2027-01-14', signed: false, signedBy: null, checksumsUrl: null,
      notes: ['First preview.'],
      artifacts: artifacts ?? [
        { os: 'Windows', arch: 'x64', kind: 'NSIS installer', file: 'Chausar-Setup.exe', url: 'https://downloads.example.com/Chausar-Setup.exe', sha256: digest },
        { os: 'Linux', arch: 'x64', kind: 'AppImage', file: 'Chausar.AppImage', url: 'https://downloads.example.com/Chausar.AppImage', sha256: null },
      ],
      ...overrides,
    }],
  };
}

const bodyOf = (html: string) => html.slice(html.indexOf('<body>'));

test('the example releases file matches the package version and validates', async () => {
  const pkg = JSON.parse(await readFile(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'));
  const valid = validateFeed(JSON.parse(await readFile(exampleFeed, 'utf8')));
  assert.equal(valid.releases[0].version, pkg.version);
  assert.equal(valid.releases[0].signed, false);
  assert.ok(valid.releases[0].artifacts.every((artifact) => artifact.sha256 === null));
});

test('an unsigned build says preview and not signed, and never claims to be signed', () => {
  const html = renderReleasesPage(validateFeed(feed()));
  const body = bodyOf(html);
  assert.match(body, /Preview — not signed<\/span>/);
  assert.doesNotMatch(body, /(?<!not |un)signed/i);
  assert.match(body, /Get-FileHash -Algorithm SHA256 Chausar-Setup\.exe/);
  assert.match(body, /certutil -hashfile Chausar-Setup\.exe SHA256/);
  assert.match(body, /shasum -a 256/);
  assert.match(body, /sha256sum -c SHA256SUMS/);
  assert.ok(body.includes(digest));
  // The not-signed label sits beside the download link itself.
  assert.match(body, /<a href="https:\/\/downloads\.example\.com\/Chausar-Setup\.exe"[^>]*>Download Chausar-Setup\.exe<\/a> <span class="warn">Preview — not signed<\/span>/);
});

test('a signed build names its publisher', () => {
  const html = renderReleasesPage(validateFeed(feed({ signed: true, signedBy: 'Chausar Technologies', channel: 'stable' })));
  assert.match(html, /Signed by Chausar Technologies/);
  assert.doesNotMatch(html, /not signed/);
  assert.throws(() => validateFeed(feed({ signed: true, signedBy: null })), { code: 'RELEASE_FIELD_INVALID' });
  assert.throws(() => validateFeed(feed({ channel: 'stable' })), { code: 'RELEASE_UNSIGNED_STABLE' });
});

test('an artifact without a fingerprint shows not built yet and no download link', () => {
  const html = renderReleasesPage(validateFeed(feed()));
  assert.match(html, /Not built yet/);
  assert.doesNotMatch(html, /href="https:\/\/downloads\.example\.com\/Chausar\.AppImage"/);
  assert.doesNotMatch(html, /Download Chausar\.AppImage/);
});

test('every field is escaped and the page is self-contained', () => {
  const hostile = '<script>alert("x")</script>&\'';
  const html = renderReleasesPage(validateFeed(feed({ notes: [hostile], date: '<b>today</b>' }, [
    { os: '<img src=x onerror=1>', arch: 'x64', kind: '"><i>', file: 'a&b.exe', url: 'https://downloads.example.com/a?x="><script>', sha256: digest },
  ])));
  assert.ok(!html.includes('<script'), 'no script element or injected tag');
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<b>today'));
  assert.ok(html.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;'));
  assert.ok(html.includes('a&amp;b.exe'));
  assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;sha256-/);
  assert.doesNotMatch(html, /<link|@import|url\(|src="http/);
  assert.match(html, /prefers-color-scheme:dark/);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<p class="lede" lang="hi">हर संख्या/);
  assert.match(html, /<h1>Chausar releases<\/h1>/);
});

test('plain http and other schemes are refused for every link', () => {
  for (const url of ['http://downloads.example.com/a.exe', 'javascript:alert(1)', 'ftp://example.com/a', 'https://user:pw@example.com/a', '//example.com/a']) {
    assert.throws(() => validateFeed(feed({}, [{ os: 'Windows', arch: 'x64', kind: 'k', file: 'a.exe', url, sha256: digest }])), { code: 'RELEASE_LINK_NOT_HTTPS' }, url);
  }
  assert.throws(() => validateFeed(feed({ checksumsUrl: 'http://example.com/SHA256SUMS' })), { code: 'RELEASE_LINK_NOT_HTTPS' });
  assert.throws(() => validateFeed(feed({}, [{ os: 'W', arch: 'x', kind: 'k', file: '../a.exe', url: null, sha256: null }])), { code: 'RELEASE_FIELD_INVALID' });
});

test('SHA256SUMS fills fingerprints and refuses a disagreement', () => {
  const valid = validateFeed(feed());
  applySums(valid, parseSums(`${'cd'.repeat(32)}  Chausar.AppImage\n${digest} *Chausar-Setup.exe\n`));
  assert.equal(valid.releases[0].artifacts[1].sha256, 'cd'.repeat(32));
  assert.throws(() => applySums(valid, parseSums(`${'ef'.repeat(32)}  Chausar-Setup.exe\n`)), { code: 'RELEASE_CHECKSUM_MISMATCH' });
  assert.throws(() => parseSums('not a checksum line\n'), { code: 'SHA256SUMS_INVALID' });
});

test('the CLI writes the page and the feed, and shows the lists when they exist', async (t) => {
  const directory = await scratch(t);
  const input = join(directory, 'releases.json');
  await writeFile(input, JSON.stringify(feed()));
  const sums = join(directory, 'SHA256SUMS');
  await writeFile(sums, `${'cd'.repeat(32)}  Chausar.AppImage\n`);
  await writeFile(join(directory, 'lists.json'), JSON.stringify({ supported: [{ name: 'Tally <read>', lane: 'c' }], experimental: [{ name: 'Razorpay read', lane: 'c' }], later: [{ text: 'Form 26AS', lane: 'c' }] }));
  const out = join(directory, 'releases');
  const result = spawnSync(process.execPath, [cli, '--input', input, '--sums', sums, '--out', out], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const html = await readFile(join(out, 'index.html'), 'utf8');
  assert.match(html, /Download Chausar\.AppImage/);
  assert.match(html, /<li>Tally &lt;read&gt;<\/li>/);
  assert.match(html, /<h3>Experimental<\/h3>[\s\S]*<li>Razorpay read<\/li>/);
  assert.match(html, /<li>Form 26AS<\/li>/);
  const written = JSON.parse(await readFile(join(out, 'releases.json'), 'utf8'));
  assert.equal(written.releases[0].artifacts[1].sha256, 'cd'.repeat(32));
  const { html: noLists } = await buildReleasesPage({ input, out: join(directory, 'plain'), lists: join(directory, 'missing.json') });
  assert.doesNotMatch(noLists, /What this release supports/);
});
