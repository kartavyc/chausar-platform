// D10: the repo diet guard. One subtest per rule, so each D10 task turns one green. A subtest marked todo names the task
// that turns it green; lane two built tasks 1 to 4, the rest wait for the rebased tip (see the D10 notes).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
const tracked = git('ls-files', '-z').split('\0').filter(Boolean);
const trackedSet = new Set(tracked);
const trackedDirs = new Set<string>();
for (const file of tracked) for (let dir = dirname(file); dir !== '.' && !trackedDirs.has(dir); dir = dirname(dir)) trackedDirs.add(dir);
const read = (file: string) => readFileSync(`${root}/${file}`, 'utf8');

/** Everything D10 tasks 2 to 4 moved to the private repo (chausar-private). A path ending in / is a whole folder. */
const MOVED = [
  // Task 2: the screenshots (chausar-private/docs/venture-screens/).
  'docs/venture/screens/',
  // Task 3: build logs and evidence (chausar-private/docs/build-logs/).
  'docs/accounting-engine-join.md',
  'docs/alert-brief-independent-public-acceptance.md',
  'docs/alert-brief-integration.md',
  'docs/bilingual-benchmark-integration.md',
  'docs/business-journal-accounting-milestone.md',
  'docs/calendar-phone-milestone.md',
  'docs/compiled-measures-milestone.md',
  'docs/connected-sync-forecast-alert-milestone.md',
  'docs/connected-workflow-source-checkpoint.md',
  'docs/conversation-calculation-gateway-join.md',
  'docs/conversation-calculation-parameters-lane.md',
  'docs/conversation-synthesis-handoff.md',
  'docs/conversation-turn-repair-contract.md',
  'docs/daily-brief-clock-milestone.md',
  'docs/desktop-json-milestone.md',
  'docs/engine-semantic-integration.md',
  'docs/github-handoff.md',
  'docs/integrated-engine-milestone.md',
  'docs/local-codex-cli-milestone.md',
  'docs/native-cli-host-milestone.md',
  'docs/native-database-qualification.md',
  'docs/phone-apps-handoff.md',
  'docs/phone-engine-public-join.md',
  'docs/postgresql-native-qualification.md',
  'docs/private-research-integration.md',
  'docs/private-research-milestone.md',
  'docs/private-trials-integration.md',
  'docs/qualification/',
  'docs/verification/',
  'docs/evidence/factory-bench.json',
  // Task 4: one-off scripts that named the founder's home folder (chausar-private/scripts-archive/).
  'scripts/qualify-portable-databases-c.mjs',
  'scripts/verify-answer-recovery-native.mjs',
  'scripts/verify-compiled-measures-c-native.mjs',
  'scripts/verify-compiled-measures.mjs',
  'scripts/verify-investigations-c-native.mjs',
  'scripts/verify-investigations-native.mjs',
  'scripts/verify-pglite-c-native.mjs',
  'scripts/verify-workflows-native.mjs',
  'scripts/qualify-forms-browser.mjs',
  'scripts/capture-native-source-1dc19b8.mjs',
];

/** PNGs that stay under docs/, each with its reason. */
const PNG_KEPT = new Map([
  ['docs/beta-guide/', 'the beta guide pictures; docs/beta-guide.md embeds them and the in-app help quotes that guide'],
]);

/** `git grep` over tracked text files (-I skips binary ones); no match is an empty list, not an error. */
const grep = (...args: string[]) => {
  try {
    return git('grep', '-I', ...args).split(/\r?\n/).filter(Boolean);
  } catch (error) {
    if ((error as { status?: number }).status === 1) return [];
    throw error;
  }
};

test('task 2: no tracked .png under docs/ (the screenshots live in the private repo)', { todo: 'D10 task 2' }, () => {
  const found = tracked.filter(file => file.startsWith('docs/') && /\.png$/i.test(file) && ![...PNG_KEPT.keys()].some(prefix => file.startsWith(prefix)));
  assert.deepEqual(found.slice(0, 10), [], `${found.length} tracked PNGs under docs/`);
});

test('task 3: no tracked .tap test output', { todo: 'D10 task 3' }, () => {
  assert.deepEqual(tracked.filter(file => file.endsWith('.tap')), []);
});

test('tasks 2 to 4: nothing in the moved list is tracked', { todo: 'D10 tasks 2 to 4' }, () => {
  const found = tracked.filter(file => MOVED.some(path => (path.endsWith('/') ? file.startsWith(path) : file === path)));
  assert.deepEqual(found.slice(0, 10), [], `${found.length} moved paths still tracked`);
});

test("task 4: no tracked text file holds the founder's Windows home folder", { todo: 'D10 task 4' }, () => {
  // Built from parts at run time so this file never holds the literal. Placeholder users (owner, someone) stay allowed.
  const user = ['kar', 'ta'].join('');
  const home = new RegExp(`Users[\\\\/]+${user}(?![A-Za-z0-9])`, 'i');
  const found = grep('-l', '-i', '-E', `Users[\\/]+${user}`).filter(file => home.test(read(file)));
  assert.deepEqual(found, []);
});

test('task 5: no pointer into docs/superpowers, docs/specs, docs/lanes or docs/requirements unless it names the private checkout', { todo: 'D10 task 5, re-grepped on the rebased tip' }, () => {
  const found: string[] = [];
  for (const hit of grep('-n', '-E', 'docs/(superpowers|specs|lanes|requirements)')) {
    const [file, line] = hit.split(':', 2);
    if (file.startsWith('scripts/ui-shots/')) continue; // they read the private checkout on purpose
    if (file === 'platform/tests/repo-diet-d10.test.ts') continue;
    const text = hit.slice(file.length + line.length + 2);
    for (const match of text.matchAll(/((?:[\w.~-]+\/)*)docs\/(?:superpowers|specs|lanes|requirements)\b/g)) if (!match[1].includes('chausar-private/')) found.push(`${file}:${line}`);
  }
  assert.deepEqual(found, []);
});

/** Relative Markdown links in a file, outside code fences and inline code. */
const markdownLinks = (text: string) => {
  const links: string[] = [];
  let fenced = false;
  for (const raw of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(raw)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const line = raw.replace(/`[^`]*`/g, '');
    for (const match of line.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) links.push(match[1]);
  }
  return links.filter(link => !/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(link));
};

test('task 3: every relative Markdown link in docs/ and the root *.md resolves', { todo: 'D10 task 3' }, () => {
  const files = tracked.filter(file => file.endsWith('.md') && (file.startsWith('docs/') || !file.includes('/')));
  const broken: string[] = [];
  for (const file of files) {
    for (const link of markdownLinks(read(file))) {
      const target = posix.normalize(posix.join(posix.dirname(file), decodeURI(link.replace(/[#?].*$/, ''))).replace(/\/$/, ''));
      if (target && !trackedSet.has(target) && !trackedDirs.has(target)) broken.push(`${file} -> ${link}`);
    }
  }
  assert.deepEqual(broken, []);
});

test('task 9: .gitignore ignores the local leftovers the audit found (green since D3 added the lines)', () => {
  const samples = ['.b2c-work/demo/x.json', '.w3check/a.txt', 'app/ui/.vitest/results.json', 'docs/x.tap', 'keys/test.key', 'tenants/one/state.json'];
  // check-ignore exits 1 when nothing is ignored; --no-index tests the patterns, not whether the path is tracked.
  let out = '';
  try {
    out = git('check-ignore', '--no-index', ...samples);
  } catch (error) {
    out = String((error as { stdout?: string }).stdout ?? '');
  }
  const ignored = out.split(/\r?\n/).filter(Boolean);
  assert.deepEqual(samples.filter(sample => !ignored.includes(sample)), []);
});
