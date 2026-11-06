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

// D3: where outputs and dev data live. AGENTS.md says it, and no doc points a data folder or an output into the checkout.
test('D3: AGENTS.md names the run root and the data home, and no longer says the bench writes only inside the repo', async () => {
  const agents = await read('AGENTS.md');
  assert.doesNotMatch(agents, /writes its output only inside the repo/);
  assert.match(agents, /`CHAUSAR_RUN_ROOT`/);
  assert.match(agents, /`CHAUSAR_HOME`/);
  assert.match(agents, /`npm run guard:data` checks/);
});

test('D3: no doc points a data folder or a run output into the checkout', async () => {
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const listed = spawnSync('git', ['ls-files', '*.md'], { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(listed.status, 0, listed.stderr);
  const found: string[] = [];
  for (const file of listed.stdout.split('\n').map(line => line.trim()).filter(Boolean)) {
    const text = await read(file);
    // A data or run variable set to a relative path lands in the folder the command runs in: the checkout.
    for (const match of text.matchAll(/CHAUSAR_(?:VAULT_DIRECTORY|HOSTED_DATA|HOME|RUN_ROOT)\s*=\s*['"]?(?![A-Za-z]:|[\\/$%~<])[^\s'";`]+/g)) found.push(`${file}: ${match[0]}`);
    if (/\bdata\/hosted\b/.test(text)) found.push(`${file}: data/hosted`);
    if (/app\/ui\/\.shots/.test(text)) found.push(`${file}: app/ui/.shots`);
    if (/--output results\//.test(text)) found.push(`${file}: --output results/`);
  }
  assert.deepEqual(found, []);
});
