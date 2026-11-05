// D1: the install words match the committed lock (npm ci), and AGENTS.md no longer describes the old check.mjs trap.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('README and CONTRIBUTING install with npm ci, never npm install', async () => {
  for (const path of ['README.md', 'CONTRIBUTING.md']) {
    const text = await read(path);
    assert.doesNotMatch(text, /^npm install\b/m, `${path}: a code block line`);
    assert.doesNotMatch(text, /`npm install`/, `${path}: a step`);
    assert.match(text, /npm ci/, path);
  }
});

test('AGENTS.md says check.mjs checks the tree in one process and no longer describes the first-statement trap', async () => {
  const agents = await read('AGENTS.md');
  assert.doesNotMatch(agents, /only strips TypeScript from a file whose first statement is an import or export/);
  assert.match(agents, /`check\.mjs` checks the whole tree in one process; a `\.ts` file must still be erasable syntax \(`erasableSyntaxOnly`\), as the worker runs it by type stripping\./);
});

test('.gitignore says its *.lock line does not cover the committed package-lock.json', async () => {
  const ignore = await read('.gitignore');
  assert.match(ignore, /^# .*package-lock\.json.*\r?\n\*\.lock\r?$/m);
});

test('the release docs and the preview workflow no longer say the lock is missing', async () => {
  assert.doesNotMatch(await read('docs/desktop-releases.md'), /has no genuine npm lockfile/);
  assert.doesNotMatch(await read('.github/workflows/desktop-preview.yml'), /after a genuine lockfile is\s*\n?#?\s*committed/);
});
