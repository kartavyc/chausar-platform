// D11f task 31: scripts/release-notes.mjs writes a release's notes from the conventional commits since the last tag and
// C7's What's new entry for the version (text/en/whats-new.json, keyed by version). A missing entry fails the step.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseNotes } from '../../scripts/release-notes.mjs';

const COMMITS = [
  'feat(os): the plan meter shows what the AI plan has left (C7)',
  'fix(os): a held call counts toward its key\'s own monthly limit (D3 fix)',
  'build(os): a release smoke for an installed build (D11)',
  'fix: drafts keep their edits after a restart',
  'Merge branch \'b2c/os-lane2\'',
  'perf(os): the engine starts from one bundle (D7)',
  'docs(os): a map of platform/runtime (D11)',
];

test('commits are grouped: new, fixed, faster, then the rest; the batch marks and scopes go', () => {
  const notes = releaseNotes({ version: '0.1.1', commits: COMMITS, whatsNew: { 'whats-new.0.1.1.1': 'You can see how much of your AI plan is left.', 'whats-new.0.1.1.2': 'Drafts keep your edits.' } });
  assert.equal(notes, [
    '# Chausar 0.1.1',
    '',
    '## What\'s new',
    '',
    '- You can see how much of your AI plan is left.',
    '- Drafts keep your edits.',
    '',
    '## New',
    '',
    '- The plan meter shows what the AI plan has left',
    '',
    '## Fixed',
    '',
    '- A held call counts toward its key\'s own monthly limit',
    '- Drafts keep their edits after a restart',
    '',
    '## Faster',
    '',
    '- The engine starts from one bundle',
    '',
    '## Under the hood',
    '',
    '- A release smoke for an installed build',
    '- A map of platform/runtime',
    '',
  ].join('\n'));
});

test('an unsigned Windows build says so', () => {
  const notes = releaseNotes({ version: '0.1.1', commits: [], whatsNew: { 'whats-new.0.1.1.1': 'One change.' }, unsigned: true });
  assert.match(notes, /^The Windows installer is not signed yet: Windows will warn about an unknown publisher\.$/m);
  assert.match(notes, /## What's new/);
});

test('a missing What\'s new entry for the version is refused', () => {
  assert.throws(() => releaseNotes({ version: '0.1.2', commits: COMMITS, whatsNew: { 'whats-new.0.1.1.1': 'x' } }), /No What's new entry for 0\.1\.2/);
});

async function folder(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'chausar-release-notes-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('the command reads a commit list and a What\'s new file, and writes the notes outside the checkout', async t => {
  const dir = await folder(t);
  await writeFile(join(dir, 'commits.txt'), `${COMMITS.join('\n')}\n`);
  await writeFile(join(dir, 'whats-new.json'), JSON.stringify({ 'whats-new.0.1.1.1': 'One line.' }));
  const script = fileURLToPath(new URL('../../scripts/release-notes.mjs', import.meta.url));
  const args = ['--version', '0.1.1', '--commits', join(dir, 'commits.txt'), '--whats-new', join(dir, 'whats-new.json'), '--output', join(dir, 'notes.md')];
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  assert.match(await readFile(join(dir, 'notes.md'), 'utf8'), /^# Chausar 0\.1\.1$/m);
  const missing = spawnSync(process.execPath, [script, ...args.slice(0, 1), '9.9.9', ...args.slice(2)], { encoding: 'utf8', windowsHide: true });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /No What's new entry for 9\.9\.9/);
});


test('the shipped C7 language pack supplies release lines in numeric order for exactly this version', async () => {
  const words = JSON.parse(await readFile(new URL('../../app/ui/src/text/en/whats-new.json', import.meta.url), 'utf8'));
  const packageJson = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  const notes = releaseNotes({ version: packageJson.version, commits: [], whatsNew: words });
  assert.match(notes, /Your AI apps show how much/);
  assert.doesNotMatch(notes, /Nothing new to show/);
  const ordered = releaseNotes({ version: '1.2.3', commits: [], whatsNew: {
    'whats-new.1.2.3.10': 'Tenth.', 'whats-new.1.2.30.1': 'Another version.',
    'whats-new.1.2.3.2': 'Second.', 'whats-new.1.2.3.1': 'First.',
  } });
  assert.ok(ordered.indexOf('First.') < ordered.indexOf('Second.'));
  assert.ok(ordered.indexOf('Second.') < ordered.indexOf('Tenth.'));
  assert.doesNotMatch(ordered, /Another version/);
});
