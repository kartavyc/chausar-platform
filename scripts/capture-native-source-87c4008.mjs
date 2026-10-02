import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Run as the checkout owner. Do not change safe.directory, ownership or Git
// configuration to make this capture run under a different process identity.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
assert.equal(realpathSync(root).toLowerCase(), root.toLowerCase());
const commit = '87c400870563b92803841d3a198cee801f7740df';
const options = { cwd: root, windowsHide: true, encoding: 'utf8', timeout: 15000, maxBuffer: 2_000_000 };
const git = args => execFileSync('git', args, options);
const tree = git(['rev-parse', commit + '^{tree}']).trim();
assert.equal(tree, '84658363a35be7f31a148d676fdea18ec3669e68');
git(['diff', '--quiet', commit, '--', 'platform', 'scripts/verify-database-differential.mjs']);
const entries = git(['ls-tree', '-r', '-z', '--full-tree', commit, '--', 'platform', 'scripts/verify-database-differential.mjs']).split('\0').filter(Boolean);
const files = entries.map(entry => {
  const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(entry); assert(match, entry);
  const [, mode, gitBlob, path] = match;
  assert(!path.split('/').includes('..'));
  return { path, mode, gitBlob, sha256: createHash('sha256').update(readFileSync(join(root, path))).digest('hex') };
});
assert.equal(files.length, 470);
const manifest = { commit, tree, capture: 'Read-only Git tree/diff under checkout owner, then SHA256 of actual Windows working-file representation. No Git safety exception.', files };
const bytes = JSON.stringify(manifest, null, 2) + '\n';
const destination = join(root, 'scripts/native-source-87c4008.json');
writeFileSync(destination, bytes);
process.stdout.write(JSON.stringify({ commit, tree, files: files.length, destination, sha256: createHash('sha256').update(bytes).digest('hex') }) + '\n');
