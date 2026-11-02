// 6J3 (D46): the repository is ready to be published under the AGPL. The licence is the official text, the package
// files say so, NOTICE names every third-party package the desktop app ships, and CONTRIBUTING keeps house style.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { houseStyleFindings } from '../runtime/venture/records.ts';
import { collectShippedPackages, licenceVerdict, renderNotice } from '../../scripts/third-party-notices.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lf = (text: string) => text.replace(/\r\n/g, '\n');
const read = async (path: string) => lf(await readFile(join(root, path), 'utf8'));

// SHA-256 of https://www.gnu.org/licenses/agpl-3.0.txt as fetched on 1 November 2026 (661 lines, ASCII, LF).
const OFFICIAL_AGPL_SHA256 = '0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0';

test('LICENSE is the official GNU AGPL version 3 text, unchanged', async () => {
  const text = await read('LICENSE');
  assert.match(text, /^ {20}GNU AFFERO GENERAL PUBLIC LICENSE\n {23}Version 3, 19 November 2007\n/);
  assert.equal(createHash('sha256').update(text, 'utf8').digest('hex'), OFFICIAL_AGPL_SHA256);
});

test('the shipped package files declare AGPL-3.0-only', async () => {
  for (const path of ['package.json', 'app/companion/native/package.json', 'platform/semantic-qualification/package.json']) {
    assert.equal(JSON.parse(await read(path)).license, 'AGPL-3.0-only', path);
  }
});

test('licence verdicts: permissive and weak copyleft pass, proprietary and unknown are flagged', () => {
  for (const id of ['MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'MPL-2.0', 'BlueOak-1.0.0', 'Python-2.0', 'CC0-1.0',
    '(MIT OR Apache-2.0)', 'MIT OR GPL-2.0-only', '(MIT AND Zlib)', 'AGPL-3.0-only', 'LGPL-3.0-or-later']) {
    assert.equal(licenceVerdict(id).verdict, 'compatible', id);
  }
  for (const id of ['UNLICENSED', 'GPL-2.0-only', 'SSPL-1.0', 'BUSL-1.1', '(MIT AND GPL-2.0-only)']) {
    assert.equal(licenceVerdict(id).verdict, 'incompatible', id);
  }
  for (const id of ['SEE LICENSE IN README.md', '', undefined, 'Custom', 'WTFPL-ish']) {
    assert.equal(licenceVerdict(id).verdict, 'unknown', String(id));
  }
});

test('the collector follows production dependencies only, nested installs, installed peers and present optionals', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chausar-6j3-'));
  try {
    const pkg = async (path: string, body: Record<string, unknown>) => {
      await mkdir(join(dir, path), { recursive: true });
      await writeFile(join(dir, path, 'package.json'), JSON.stringify(body));
    };
    await pkg('.', { name: 'app', dependencies: { a: '1.0.0' }, optionalDependencies: { gone: '1.0.0' }, devDependencies: { tool: '1.0.0' } });
    await pkg('node_modules/a', { name: 'a', version: '1.0.0', license: 'MIT', dependencies: { b: '^2.0.0' }, peerDependencies: { p: '*' } });
    await pkg('node_modules/a/node_modules/b', { name: 'b', version: '2.1.0', licenses: [{ type: 'Apache-2.0' }] });
    await pkg('node_modules/b', { name: 'b', version: '1.0.0', license: 'ISC' });
    await pkg('node_modules/p', { name: 'p', version: '3.0.0', license: 'SEE LICENSE IN LICENSE.md' });
    await pkg('node_modules/tool', { name: 'tool', version: '9.9.9', license: 'MIT' });
    const found = collectShippedPackages(dir);
    assert.deepEqual(found.map((item: { name: string; version: string; license: string }) => `${item.name}@${item.version} ${item.license}`),
      ['a@1.0.0 MIT', 'b@2.1.0 Apache-2.0', 'p@3.0.0 SEE LICENSE IN LICENSE.md']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('NOTICE lists every direct production dependency at its pinned version and the libraries built into the screens', async () => {
  const notice = await read('NOTICE');
  const manifest = JSON.parse(await read('package.json'));
  const shipped = collectShippedPackages(root);
  for (const [name, version] of Object.entries(manifest.dependencies as Record<string, string>)) {
    const installed = shipped.find((item: { name: string }) => item.name === name);
    assert.ok(installed, `${name} is installed`);
    assert.ok(notice.includes(`${name} ${version} `), `NOTICE lists ${name} ${version}`);
  }
  for (const name of ['react', 'react-dom', 'scheduler', 'lucide-react', 'electron']) assert.match(notice, new RegExp(`^${name} \\S+ `, 'm'), name);
  assert.match(notice, /Codex/);
  // The founder's section 7 permission (2 November 2026) covers the Agent SDK, so it is listed but no longer flagged.
  assert.match(notice, /^@anthropic-ai\/claude-agent-sdk 0\.3\.286 .*covered by the section 7 permission above/m);
  assert.doesNotMatch(notice, /^@anthropic-ai\/claude-agent-sdk\S* \S+ .*FLAG/m);
  // Platform-specific builds and later transitive versions may differ on another machine, but no package may be missing.
  for (const item of shipped.filter((entry: { platformSpecific: boolean }) => !entry.platformSpecific)) {
    assert.match(notice, new RegExp(`^${item.name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')} \\S+ `, 'm'), `NOTICE lists ${item.name}`);
  }
});

test('a licence given as a list, or only in a reviewed licence file, is read rather than flagged', async () => {
  const notice = await read('NOTICE');
  // pause-stream declares ["MIT", "Apache2"]; map-stream declares nothing, and its LICENCE file is the MIT text.
  assert.match(notice, /^pause-stream \S+ MIT OR Apache2$/m);
  assert.match(notice, /^map-stream 0\.1\.0 MIT \(from its licence file\)$/m);
  assert.match(notice, /^Flagged packages: 0$/m);
});

test('NOTICE renders deterministically from what is installed here', () => {
  const shipped = collectShippedPackages(root);
  assert.equal(renderNotice(shipped, root), renderNotice(shipped, root));
});

test('NOTICE names the copyright holder and carries the section 7 permission for the Agent SDK', async () => {
  const notice = await read('NOTICE');
  assert.match(notice, /^Copyright \(C\) 2026 Kartavy Chauhan$/m);
  assert.doesNotMatch(notice, /The Chausar authors/);
  assert.match(notice, /Additional permission under GNU AGPL version 3 section 7/);
  assert.match(notice, /@anthropic-ai\/claude-agent-sdk/);
  assert.match(notice, /Corresponding\s+Source[\s\S]*shall not include the source code for the parts of the Claude\s+Agent SDK/);
});

test('CONTRIBUTING and CLA: contributions come under the founder contributor licence agreement', async () => {
  for (const path of ['CONTRIBUTING.md', 'NOTICE', 'CLA.md']) assert.deepEqual(houseStyleFindings(await read(path)), [], path);
  const contributing = await read('CONTRIBUTING.md');
  assert.match(contributing, /test first/i);
  assert.match(contributing, /em dash/i);
  assert.match(contributing, /AGPL/);
  assert.match(contributing, /CLA\.md/);
  assert.doesNotMatch(contributing, /not decided yet/);
  const cla = await read('CLA.md');
  assert.match(cla, /Kartavy Chauhan/);
  assert.match(cla, /copyright licen[cs]e/i);
  assert.match(cla, /patent licen[cs]e/i);
  assert.match(cla, /I have read the CLA and I agree to it\./);
});
