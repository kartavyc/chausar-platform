// D2 task 1: engine test files run side by side (bench.mjs --workers), so no two of them may share a fixed name in the
// OS temp folder or a fixed port. A folder a test creates comes from mkdtemp (a unique name per run); a fixed path that
// is only handed to a stand-in locator and never touches the disk is allowed when it is on the reviewed list below.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const TESTS = fileURLToPath(new URL('.', import.meta.url));

/** Fixed temp paths that never reach the disk, by file and name, each with the reason it was allowed. */
const REVIEWED: readonly { file: string; name: string; reason: string }[] = [
  { file: 'codex-bundle-w6.test.ts', name: 'chausar-no-such-codex-bundle', reason: 'a folder that must not exist; the check refuses it before reading' },
  { file: 'codex-trust.test.ts', name: 'no-review-held', reason: 'a path recorded as a string in a trust record; never opened' },
  { file: 'decision-journal-worker.test.ts', name: 'chausar-journal-worker-', reason: 'a prefix compared with the mkdtemp result' },
  { file: 'ui-ink-hosting.test.ts', name: 'resources', reason: 'a packaged-app path shape handed to the path resolver; never created' },
  { file: 'venture-cli-status.test.ts', name: 'chausar-cli-status-bin', reason: 'the folder a stand-in locator reports for the tools; the tools are faked, nothing is written there' },
  { file: 'venture-model-records.test.ts', name: 'codex.exe', reason: 'a program path handed to a stand-in transport; never started' },
  { file: 'venture-models.test.ts', name: 'chausar-models-test-bin', reason: 'the folder a stand-in locator reports for the tools; nothing is written there' },
  { file: 'venture-models.test.ts', name: 'codex.exe', reason: 'a program path handed to a stand-in transport; never started' },
  { file: 'venture-models.test.ts', name: 'codex', reason: 'a program path handed to a stand-in transport or replay; never started' },
  { file: 'venture-youtube-b2-tools.test.ts', name: 'chausar-youtube-source.mp4', reason: 'a footage path saved on an order; the board tools only read it, nothing writes it' },
  { file: 'venture-youtube-board.test.ts', name: 'chausar-youtube-source.mp4', reason: 'a footage path saved on an order; the board tools only read it, nothing writes it' },
  { file: 'venture-youtube-services.test.ts', name: 'chausar-youtube-lesson.mp4', reason: 'a file name saved on an order intake as text; never read or written' },
  { file: 'venture-youtube-transcribe.test.ts', name: 'no-such-folder', reason: 'a locator answer for a missing program; never created' },
  { file: 'venture-youtube-transcribe.test.ts', name: 'x.wav', reason: 'a file that must not exist; transcription refuses before reading' },
];

const CREATES = String.raw`(?:mkdir|writeFile|appendFile|cp|copyFile|rm|rename|symlink|link|open|createWriteStream)(?:Sync)?`;
const TEMP_JOIN = /(?:join|resolve)\(\s*(?:os\.)?tmpdir\(\)\s*,\s*(['`])((?:(?!\1).)*)\1/g;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

type Finding = { file: string; line: number; name: string; problem: 'creates' | 'unreviewed' | 'port' };

/** The scan over one file's text. Exported to the self-test below through the same function. */
function scan(file: string, text: string, reviewed = REVIEWED): Finding[] {
  const findings: Finding[] = [];
  const lineOf = (index: number) => text.slice(0, index).split('\n').length;
  for (const match of text.matchAll(TEMP_JOIN)) {
    const name = match[2];
    // A per-process or random part makes the name unique to this run.
    if (/\$\{\s*(?:process\.pid|randomUUID\(\)|crypto\.randomUUID\(\))/.test(name)) continue;
    const before = text.slice(Math.max(0, match.index - 16), match.index);
    if (/mkdtemp(?:Sync)?\(\s*$/.test(before)) continue;
    const line = lineOf(match.index);
    const assigned = /(?:const|let|var)\s+(\w+)\s*=\s*$/.exec(text.slice(Math.max(0, match.index - 60), match.index))?.[1];
    // The names that carry this path: the variable it is assigned to, and one level of join(variable, ...) below it.
    const carriers = assigned ? [assigned, ...[...text.matchAll(new RegExp(String.raw`(?:const|let|var)\s+(\w+)\s*=\s*join\(\s*${escape(assigned)}\b`, 'g'))].map(found => found[1])] : [];
    const usedAsPrefix = assigned && new RegExp(String.raw`mkdtemp(?:Sync)?\(\s*${escape(assigned)}\s*\)`).test(text);
    if (usedAsPrefix) continue;
    const inlineCreate = new RegExp(String.raw`\b${CREATES}\(\s*(?:join\(\s*)?$`).test(before);
    const carrierCreates = carriers.some(name => new RegExp(String.raw`\b${CREATES}\(\s*(?:join\(\s*)?${escape(name)}\b|\bcwd:\s*${escape(name)}\b`).test(text));
    if (inlineCreate || carrierCreates) { findings.push({ file, line, name, problem: 'creates' }); continue; }
    if (!reviewed.some(entry => entry.file === file && entry.name === name)) findings.push({ file, line, name, problem: 'unreviewed' });
  }
  for (const match of text.matchAll(/\.listen\(\s*(?:\{\s*port:\s*)?(\d+)/g)) {
    if (Number(match[1]) !== 0) findings.push({ file, line: lineOf(match.index), name: match[1], problem: 'port' });
  }
  return findings;
}

async function sources(folder: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) found.push(...await sources(path));
    else if (entry.name.endsWith('.ts')) found.push(path);
  }
  return found;
}

test('no engine test file creates a fixed name in the temp folder or listens on a fixed port', async () => {
  const findings: Finding[] = [];
  for (const path of await sources(TESTS)) {
    const file = relative(TESTS, path).replaceAll('\\', '/');
    if (file === 'test-isolation-d2.test.ts') continue; // its self-test holds the shapes it must catch
    findings.push(...scan(file, (await readFile(path, 'utf8')).replace(/\r\n/g, '\n')));
  }
  assert.deepEqual(findings.map(found => `${found.file}:${found.line} ${found.problem} ${found.name}`), []);
});

test('every reviewed entry still names a fixed temp path in its file, so the list only shrinks', async () => {
  for (const entry of REVIEWED) {
    const text = await readFile(join(TESTS, entry.file), 'utf8');
    assert.ok([...text.matchAll(TEMP_JOIN)].some(match => match[2] === entry.name), `${entry.file} ${entry.name}`);
    assert.ok(entry.reason.length > 10);
  }
});

test('the scan itself: created fixed names fail even when reviewed, unique and mkdtemp names pass, fixed ports fail', () => {
  const reviewed = [{ file: 'a.test.ts', name: 'chausar-bin', reason: 'reviewed for the self-test' }];
  const check = (text: string) => scan('a.test.ts', text, reviewed).map(found => found.problem);
  assert.deepEqual(check(`const BIN = join(tmpdir(), 'chausar-bin');\nawait mkdir(BIN, { recursive: true });`), ['creates']);
  assert.deepEqual(check(`const BIN = join(tmpdir(), 'chausar-bin');\nconst EXE = join(BIN, 'x.exe');\nwriteFileSync(EXE, '');`), ['creates']);
  assert.deepEqual(check(`await writeFile(join(tmpdir(), 'chausar-x.txt'), '');`), ['creates']);
  assert.deepEqual(check(`spawn('x', [], { cwd: DIR });\nconst DIR = join(tmpdir(), 'chausar-run');`), ['creates']);
  assert.deepEqual(check(`const BIN = join(tmpdir(), 'chausar-bin');\nlocate(BIN);`), []);
  assert.deepEqual(check(`const OTHER = join(tmpdir(), 'chausar-other');\nlocate(OTHER);`), ['unreviewed']);
  assert.deepEqual(check(`const dir = await mkdtemp(join(tmpdir(), 'chausar-a-'));\nconst p = join(tmpdir(), \`chausar-\${process.pid}\`);\nawait mkdir(p);`), []);
  assert.deepEqual(check(`const prefix = join(tmpdir(), 'chausar-p-'); const dir = await mkdtemp(prefix);`), []);
  assert.deepEqual(check(`server.listen(0, '127.0.0.1');\nserver.listen(8123);\nserver.listen({ port: 9000 });`), ['port', 'port']);
});
