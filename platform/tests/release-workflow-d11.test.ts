// D11f task 31: .github/workflows/release.yml, the tag-driven release. Text checks on the YAML (as ci-workflow-d1 reads
// ci.yml); the first tag pushed shows whether GitHub accepts it. The founder publishes the draft release himself.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = (await readFile(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
function job(name: string): string {
  const start = workflow.search(new RegExp(`^  ${name}:$`, 'm'));
  assert.ok(start >= 0, `the ${name} job exists`);
  const rest = workflow.slice(start + 1);
  const end = rest.search(/^ {2}[a-z][\w-]*:$|^ {2}#/m);
  return end < 0 ? workflow.slice(start) : workflow.slice(start, start + 1 + end);
}
/** Each step's run text: a one-line run, or every line of a `run: |` block. */
const runs = (text: string) => [...text.matchAll(/^( +)run: (?:\|\n((?:\1 {2}.*\n?)+)|(.+))$/gm)].map(match => (match[3] ?? match[2]).trim());

test('a v* tag is the only trigger', () => {
  const on = workflow.slice(workflow.search(/^on:$/m), workflow.search(/^permissions:$/m));
  assert.match(on, /^on:\n {2}push:\n {4}tags: \['v\*'\]\n/);
  assert.doesNotMatch(on, /branches|pull_request|workflow_dispatch|schedule/);
});

test('contents: read for the workflow, contents: write on the release job alone', () => {
  assert.match(workflow, /^permissions:\n {2}contents: read$/m);
  assert.equal([...workflow.matchAll(/contents: write/g)].length, 1);
  assert.match(job('release'), /^ {4}permissions:\n {6}contents: write$/m);
});

test('lint runs first, the tag must equal v plus package.json\'s version, and installs come from the lock', () => {
  assert.deepEqual(runs(job('lint')).filter(line => line.startsWith('node scripts/') || line.startsWith('npm ')), [
    'npm ci --ignore-scripts --no-audit --no-fund', 'node scripts/check-clean-tree.mjs --tracked', 'node scripts/check.mjs',
    'node scripts/check-boundaries.mjs --report', 'node scripts/env-docs.mjs --check', 'npm run typecheck', 'npm run typecheck:ui', 'node scripts/third-party-notices.mjs --check',
  ]);
  assert.match(job('build'), /^ {4}needs: lint$/m);
  assert.match(workflow, /\$GITHUB_REF_NAME" != "v\$version"/);
  assert.doesNotMatch(workflow, /npm install\b/, 'only npm ci (Codex is staged with npm pack, which runs nothing)');
  assert.match(workflow, /npm pack --silent @openai\/codex@0\.166\.0 "@openai\/codex@0\.166\.0-\$target"/, 'the bundled Codex version, pinned');
});

test('the build matrix is Windows x64 and Linux x64, tested, packaged as the beta and smoked on the runner', () => {
  const build = job('build');
  assert.match(build, /os: windows-latest\n\s+platform: win32\n\s+arch: x64/);
  assert.match(build, /os: ubuntu-latest\n\s+platform: linux\n\s+arch: x64/);
  const lines = runs(build).join('\n');
  for (const needle of ['node node_modules/electron/install.js', 'platform/tests/desktop-*.test.ts platform/tests/updater.test.ts platform/tests/rollback.test.ts',
    'npm run package:beta', 'node scripts/release-smoke.mjs --installer', 'xvfb-run']) assert.ok(lines.includes(needle), needle);
});

test('signing runs only when the certificate secrets exist, checked in the shell; the secrets reach steps through env only', () => {
  const build = job('build');
  assert.match(build, /if \[ -n "\$CSC_LINK" \] && \[ -n "\$CSC_KEY_PASSWORD" \]; then/);
  assert.match(build, /CSC_LINK: \$\{\{ secrets\.CSC_LINK \}\}/);
  for (const line of runs(workflow)) assert.doesNotMatch(line, /secrets\./, `a secret is never written into a run line: ${line}`);
  assert.doesNotMatch(workflow, /set -x|set -o xtrace/);
  for (const line of workflow.split('\n')) if (/\becho\b/.test(line)) assert.doesNotMatch(line, /\$(?:CSC_LINK|CSC_KEY_PASSWORD|CHAUSAR_RELEASE_KEY)\b|secrets\./, line);
});

test('checksums, an SBOM, the notices check, the signed feed and a draft release', () => {
  const release = job('release');
  const lines = runs(release).join('\n');
  for (const needle of ['sha256sum', 'SHA256SUMS', 'npm sbom --sbom-format cyclonedx --omit dev', 'node scripts/third-party-notices.mjs --check',
    'node scripts/release-feed.mjs', 'node scripts/release-notes.mjs', 'gh release create', '--draft']) assert.ok(lines.includes(needle), needle);
  assert.match(release, /umask 077/, 'the feed key file is made private before it is written');
  assert.match(release, /CHAUSAR_RELEASE_KEY: \$\{\{ secrets\.CHAUSAR_RELEASE_KEY \}\}/);
  assert.doesNotMatch(workflow, /--draft=false|gh release edit|--latest/, 'never published here');
});

test('pinned Codex archives use verified native Node extraction on both build hosts', () => {
  const build = job('build');
  assert.match(build, /dist.integrity/);
  assert.match(build, /createHash\('sha512'\)/);
  assert.match(build, /await x\(\{ file, cwd, strip: 1, strict: true \}\)/);
  assert.doesNotMatch(build, /tar -xzf/);
});
