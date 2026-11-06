// C7 task 23: scripts/guide-index.mjs splits docs/beta-guide.md by its ## and ### headings into
// platform/shared/venture/core/guide-data.json (each section's anchor, title and words, images left out), so in-app help
// can quote the guide. `--check` fails when the data is out of date with the guide.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { guideSections, slugOf } from '../../scripts/guide-index.mjs';
import { guideSections as runtimeGuideSections, guideSection } from '../runtime/venture/core/guide.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SCRIPT = join(ROOT, 'scripts', 'guide-index.mjs'), GUIDE = join(ROOT, 'docs', 'beta-guide.md'), DATA = join(ROOT, 'platform', 'shared', 'venture', 'core', 'guide-data.json');
const run = (args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8', windowsHide: true });

async function folder(t: TestContext): Promise<string> {
  const path = await mkdtemp(join(await realpath(tmpdir()), 'chausar-guide-index-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

test('every ## and ### heading in the guide has an entry with the same words, and the kept data is current', async () => {
  const guide = (await readFile(GUIDE, 'utf8')).replace(/\r\n/g, '\n'), data = JSON.parse(await readFile(DATA, 'utf8'));
  const headings = [...guide.matchAll(/^(#{2,3}) (.+)$/gm)].map(match => match[2].trim());
  assert.ok(headings.length > 20);
  assert.deepEqual(data.sections.map((section: any) => section.title), headings);
  assert.equal(data.format, 'chausar.guide.v1');
  assert.equal(data.sections.find((section: any) => section.title === '2. Connect your AI').anchor, '2-connect-your-ai');
  const codex = data.sections.find((section: any) => section.title === 'ChatGPT plan (Codex)');
  assert.equal(codex.anchor, 'chatgpt-plan-codex'); assert.equal(codex.level, 3); assert.equal(codex.part, '2-connect-your-ai');
  assert.ok(codex.text.length > 40 && guide.includes(codex.text.split('\n')[0]));
  const check = run(['--check']);
  assert.equal(check.status, 0, check.stdout + check.stderr);
});

test('--check fails after a one-word change to the guide', async t => {
  const dir = await folder(t), guide = join(dir, 'guide.md'), data = join(dir, 'guide-data.json');
  await copyFile(GUIDE, guide);
  assert.equal(run(['--guide', guide, '--out', data]).status, 0);
  assert.equal(run(['--check', '--guide', guide, '--out', data]).status, 0);
  await writeFile(guide, (await readFile(guide, 'utf8')).replace('Chausar is free.', 'Chausar is open.'));
  const stale = run(['--check', '--guide', guide, '--out', data]);
  assert.equal(stale.status, 1); assert.match(stale.stderr, /out of date/);
  assert.equal(run(['--bogus']).status, 2);
});

test('no image path is in the data, and anchors follow the guide\'s own links', async () => {
  const text = await readFile(DATA, 'utf8');
  assert.doesNotMatch(text, /\.png|!\[|<img|beta-guide\//);
  assert.equal(slugOf('10. Where to get help'), '10-where-to-get-help');
  assert.equal(slugOf('About you (step 2 of 3)'), 'about-you-step-2-of-3');
  const sections = guideSections('# Title\n\n## One\nwords ![a picture](x.png) here\n<img src="y.png">\n\n### Same\na\n### Same\nb\n');
  assert.deepEqual(sections.map(section => [section.anchor, section.level, section.part, section.text]), [
    ['one', 2, 'one', 'words here'], ['same', 3, 'one', 'a'], ['same-1', 3, 'one', 'b'],
  ]);
  const guide = await readFile(GUIDE, 'utf8');
  for (const [, anchor] of guide.matchAll(/\]\(#([^)]+)\)/g)) assert.ok(JSON.parse(text).sections.some((section: any) => section.anchor === anchor), anchor);
});

test('the runtime guide reads the canonical shared data from source', async () => {
  const expected = JSON.parse(await readFile(DATA, 'utf8')).sections.filter((section: { anchor: string }) => section.anchor !== 'contents');
  const actual = runtimeGuideSections();
  assert.deepEqual(actual, expected);
  assert.ok(Object.isFrozen(actual) && actual.every(section => Object.isFrozen(section)));
  assert.deepEqual(guideSection('chatgpt-plan-codex'), expected.find((section: { anchor: string }) => section.anchor === 'chatgpt-plan-codex'));
  assert.equal(guideSection('not-a-guide-section'), null);
});
