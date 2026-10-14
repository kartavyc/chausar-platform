import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildPublicCopy, DRAFT_LICENCE, globToRegExp, scanText, validateAllowlist, type Allowlist } from '../../scripts/release/public-copy.ts';

const cli = fileURLToPath(new URL('../../scripts/release/public-copy.ts', import.meta.url));
const realAllowlistPath = fileURLToPath(new URL('../../scripts/release/public-allowlist.json', import.meta.url));
const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

// Every secret below is assembled at run time so this file holds no literal key pattern.
const join2 = (...parts: string[]) => parts.join('');
const secrets = {
  privateKey: join2('-----BEGIN ', 'RSA ', 'PRIVATE KEY-----'),
  aws: join2('AK', 'IA', 'ABCDEFGHIJKLMNOP'),
  github: join2('gh', 'p_', 'a'.repeat(36)),
  githubPat: join2('github', '_pat_', 'B'.repeat(30)),
  slack: join2('xo', 'xb-', '1234567890-abcdef'),
  openai: join2('s', 'k-', 'proj-', 'c'.repeat(40)),
  anthropic: join2('s', 'k-', 'ant-', 'd'.repeat(40)),
  google: join2('AI', 'za', 'e'.repeat(35)),
  jwt: join2('ey', 'J', 'f'.repeat(16), '.', 'ey', 'J', 'g'.repeat(16), '.', 'h'.repeat(16)),
  email: join2('ravi.kumar', '@', 'gmail', '.com'),
  session: join2('https://claude', '.ai/code/', 'session_', '0123456789abcdef'),
  internal: join2('https://build01.', 'corp.', 'internal/x'),
  rfc1918: join2('192', '.168.', '1.20', ':5432'),
  fleet: join2('Claude', '-Session', ': x'),
};

async function scratch(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-public-copy-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function repo(directory: string, files: Record<string, string>) {
  const root = join(directory, 'repo');
  for (const [name, contents] of Object.entries(files)) {
    await mkdir(dirname(join(root, name)), { recursive: true });
    await writeFile(join(root, name), contents);
  }
  return root;
}

const allowlist = (overrides: Partial<Allowlist> = {}): Allowlist => validateAllowlist({ ...JSON.parse(readFileSync(realAllowlistPath, 'utf8')), ...overrides });

const cleanFiles = {
  'app/main.ts': '// SPDX-License-Identifier: AGPL-3.0-only\nexport const x = 1;\n',
  'platform/runtime/engine.ts': 'export const y = 2; // mail noreply@example.com, demo@shop.example.org, http://localhost:5173\n',
  'platform/tests/open.test.ts': 'import test from "node:test";\n',
  'scripts/release/a.mjs': 'console.log(1);\n',
  'scripts/cloud-setup.sh': 'echo internal\n',
  'fixtures/demo/shop.csv': 'item,amount\ntea,100\n',
  'README.md': '# Chausar\n',
  'docs/releases.md': '# Releases\n',
  'docs/specs/plan.md': '# fleet records\n',
  'docs/other.md': '# not chosen\n',
  'enterprise/server/main.ts': 'export const z = 3;\n',
  'app/.env.local': 'KEY=1\n',
  'app/certs/server.pem': 'x\n',
  'app/data/workspace.db': 'x\n',
  'app/ui/tests/evidence/review.md': 'x\n',
  'app/logo.png': '\u0000PNGDATA\n',
};

test('globs anchor and treat ** as any depth', () => {
  assert.ok(globToRegExp('app/**').test('app'));
  assert.ok(globToRegExp('app/**').test('app/a/b.ts'));
  assert.ok(!globToRegExp('app/**').test('apps/a.ts'));
  assert.ok(globToRegExp('**/node_modules/**').test('node_modules'));
  assert.ok(globToRegExp('**/node_modules/**').test('a/node_modules/b'));
  assert.ok(globToRegExp('**/*.pem').test('x.pem'));
  assert.ok(globToRegExp('scripts/native-source-*.json').test('scripts/native-source-1.json'));
  assert.ok(!globToRegExp('scripts/*.json').test('scripts/a/b.json'));
});

test('copies only allowlisted files and keeps out enterprise, specs and private files', async (t) => {
  const directory = await scratch(t);
  const root = await repo(directory, cleanFiles);
  const out = join(directory, 'public');
  const report = await buildPublicCopy({ root, out, allowlist: allowlist() });
  for (const kept of ['app/main.ts', 'platform/runtime/engine.ts', 'platform/tests/open.test.ts', 'scripts/release/a.mjs', 'fixtures/demo/shop.csv', 'README.md', 'docs/releases.md', 'app/logo.png', 'LICENSE-DRAFT.md']) assert.ok(existsSync(join(out, kept)), kept);
  for (const left of ['scripts/cloud-setup.sh', 'docs/specs/plan.md', 'docs/other.md', 'enterprise', 'app/.env.local', 'app/certs/server.pem', 'app/data', 'app/ui/tests/evidence']) assert.ok(!existsSync(join(out, left)), left);
  assert.deepEqual(report.findings, []);
  assert.deepEqual(Object.values(report.counts), [0, 0, 0, 0, 0, 0]);
  assert.equal(report.binary, 1);
  assert.equal(report.mode, 'dry-run');
  const draft = await readFile(join(out, 'LICENSE-DRAFT.md'), 'utf8');
  assert.match(draft, /pending the founder's decision/);
  assert.match(draft, /Nothing in this copy is licensed until/);
  assert.match(draft, /AGPL-3\.0/);
  assert.match(draft, /Apache-2\.0 for everything/);
  assert.match(draft, new RegExp(DRAFT_LICENCE));
  const written = JSON.parse(await readFile(join(directory, 'public-copy-report.json'), 'utf8'));
  assert.equal(written.copied, report.copied);
});

test('catches each secret kind and reports a redacted fingerprint, never the value', async (t) => {
  const directory = await scratch(t);
  const lines = Object.values(secrets).map((secret) => `const v = "${secret}";`).join('\n');
  const root = await repo(directory, { 'app/leaky.ts': `// SPDX-License-Identifier: AGPL-3.0-only\n${lines}\n` });
  const out = join(directory, 'public');
  const reportPath = join(directory, 'report.json');
  const result = spawnSync(process.execPath, [cli, '--root', root, '--out', out, '--allowlist', realAllowlistPath, '--report', reportPath], { encoding: 'utf8' });
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  const details = report.findings.map((finding: { detail: string }) => finding.detail).sort();
  assert.deepEqual(details, ['aws-access-key', 'claude-session-link', 'email-address', 'github-token', 'github-token', 'google-api-key', 'jwt', 'model-provider-key', 'model-provider-key', 'pem-private-key', 'private-host', 'private-ip-with-port', 'session-trailer', 'slack-token'].sort());
  assert.deepEqual(report.counts, { 'private-key': 1, token: 8, email: 1, 'private-link': 3, 'fleet-marker': 1, licence: 0 });
  const lineOf = Object.keys(secrets).indexOf('aws') + 2;
  assert.ok(report.findings.some((finding: { file: string; line: number; detail: string }) => finding.file === 'app/leaky.ts' && finding.line === lineOf && finding.detail === 'aws-access-key'));
  const printed = `${await readFile(reportPath, 'utf8')}${result.stdout}${result.stderr}`;
  for (const secret of Object.values(secrets)) assert.ok(!printed.includes(secret), 'the report never holds a secret');
  assert.ok(!printed.includes('ravi.kumar'));
  assert.match(printed, /sha256:[0-9a-f]{12} len=\d+/);
});

test('allowed addresses, localhost and an allow file pass the email and link checks', async (t) => {
  const directory = await scratch(t);
  const person = join2('owner', '@', 'shop', '.in');
  const root = await repo(directory, {
    'README.md': `Write to noreply@example.com or ${person}. Open http://localhost:4173 or 127.0.0.1:8080.\n`,
    'allowed-emails.txt': `# allowed\n${person}\n`,
  });
  const report = await buildPublicCopy({ root, out: join(directory, 'public'), allowlist: allowlist({ allowedEmailsFile: 'allowed-emails.txt' }), report: null });
  assert.deepEqual(report.findings, []);
  const flagged = scanText('x.md', `mail ${person}`, allowlist());
  assert.equal(flagged[0].kind, 'email');
});

test('fleet markers come from the allowlist file', () => {
  const list = allowlist({ fleetMarkers: [{ name: 'codename', pattern: 'project-zebra', flags: 'i' }] });
  assert.deepEqual(scanText('a.md', 'Built by Project-Zebra.', list).map((finding) => [finding.kind, finding.detail]), [['fleet-marker', 'codename']]);
  assert.throws(() => allowlist({ fleetMarkers: [{ name: 'bad', pattern: '(' }] }), { code: 'ALLOWLIST_INVALID' });
});

test('every source file needs an SPDX tag or a licence map entry', async (t) => {
  const directory = await scratch(t);
  const root = await repo(directory, { 'app/tagged.ts': '/* SPDX-License-Identifier: Apache-2.0 */\n', 'app/untagged.css': 'a{}\n', 'app/notes.md': 'x\n' });
  const list = allowlist({ licenceMap: [] });
  const report = await buildPublicCopy({ root, out: join(directory, 'public'), allowlist: list, report: null });
  assert.deepEqual(report.findings.map((finding) => [finding.file, finding.kind]), [['app/untagged.css', 'licence']]);
  assert.equal(report.licenceDraft, false);
  assert.ok(!existsSync(join(directory, 'public', 'LICENSE-DRAFT.md')));
  const mapped = await buildPublicCopy({ root, out: join(directory, 'mapped'), allowlist: allowlist(), report: null });
  assert.equal(mapped.counts.licence, 0);
});

test('publishing is refused while the licence map holds the draft', async (t) => {
  const directory = await scratch(t);
  const root = await repo(directory, cleanFiles);
  const out = join(directory, 'public');
  await assert.rejects(buildPublicCopy({ root, out, allowlist: allowlist(), publish: true }), { code: 'LICENCE_UNDECIDED' });
  assert.ok(!existsSync(out), 'nothing is copied');
  const result = spawnSync(process.execPath, [cli, '--root', root, '--out', out, '--publish'], { encoding: 'utf8', cwd: repositoryRoot });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /LICENCE_UNDECIDED/);
  const decided = allowlist({ licenceMap: [{ glob: '**', licence: 'AGPL-3.0-only' }] });
  const report = await buildPublicCopy({ root, out, allowlist: decided, publish: true, report: null });
  assert.equal(report.mode, 'publish');
  assert.equal(report.findings.length, 0);
});

test('symbolic links on allowed paths are refused', async (t) => {
  const directory = await scratch(t);
  const root = await repo(directory, { 'README.md': '# x\n', 'outside.txt': 'secret\n' });
  await mkdir(join(root, 'app'));
  await symlink(join(root, 'outside.txt'), join(root, 'app', 'linked.ts'));
  await assert.rejects(buildPublicCopy({ root, out: join(directory, 'public'), allowlist: allowlist(), report: null }), { code: 'PUBLIC_COPY_SYMLINK' });
  const folderRoot = await repo(join(directory, 'b'), { 'README.md': '# x\n', 'elsewhere/a.ts': 'x\n' });
  await symlink(join(folderRoot, 'elsewhere'), join(folderRoot, 'scripts'));
  await assert.rejects(buildPublicCopy({ root: folderRoot, out: join(directory, 'public-b'), allowlist: allowlist(), report: null }), { code: 'PUBLIC_COPY_SYMLINK' });
  // A link in a denied folder is skipped, not followed.
  const deniedRoot = await repo(join(directory, 'c'), { 'README.md': '# x\n' });
  await symlink(join(deniedRoot, 'README.md'), join(deniedRoot, 'node_modules'));
  const report = await buildPublicCopy({ root: deniedRoot, out: join(directory, 'public-c'), allowlist: allowlist(), report: null });
  assert.equal(report.copied, 1);
});

test('the copy cannot be written inside the source repository except under release', async (t) => {
  const directory = await scratch(t);
  const root = await repo(directory, cleanFiles);
  await assert.rejects(buildPublicCopy({ root, out: join(root, 'public'), allowlist: allowlist(), report: null }), { code: 'PUBLIC_COPY_OUT_INSIDE_SOURCE' });
  await assert.rejects(buildPublicCopy({ root, out: root, allowlist: allowlist(), report: null }), { code: 'PUBLIC_COPY_OUT_CONTAINS_SOURCE' });
  await assert.rejects(buildPublicCopy({ root, out: directory, allowlist: allowlist(), report: null }), { code: 'PUBLIC_COPY_OUT_CONTAINS_SOURCE' });
  const report = await buildPublicCopy({ root, out: join(root, 'release', 'public'), allowlist: allowlist() });
  assert.ok(report.copied > 0);
  assert.ok(!existsSync(join(root, 'release', 'public', 'release')), 'the release folder is never copied into itself');
  await assert.rejects(buildPublicCopy({ root, out: join(root, 'release', 'public'), allowlist: allowlist(), report: null }), { code: 'PUBLIC_COPY_OUT_NOT_EMPTY' });
});

test('--init-git creates a fresh history with one commit and a neutral author', async (t) => {
  const directory = await scratch(t);
  const root = await repo(directory, { ...cleanFiles, '.gitignore': 'release/\n' });
  const out = join(directory, 'public');
  const result = spawnSync(process.execPath, [cli, '--root', root, '--out', out, '--init-git', '--dry-run'], { encoding: 'utf8', cwd: repositoryRoot, env: { ...process.env, CHAUSAR_RELEASE_AUTHOR_NAME: '', CHAUSAR_RELEASE_AUTHOR_EMAIL: '' } });
  assert.equal(result.status, 0, result.stderr);
  const log = spawnSync('git', ['log', '--format=%an <%ae>|%s'], { cwd: out, encoding: 'utf8' });
  assert.equal(log.stdout.trim(), 'Chausar Release <noreply@example.com>|Public copy of Chausar');
  const tracked = spawnSync('git', ['ls-files'], { cwd: out, encoding: 'utf8' }).stdout.trim().split('\n');
  assert.ok(tracked.includes('LICENSE-DRAFT.md'));
  assert.ok(tracked.includes('scripts/release/a.mjs'), 'a copied .gitignore does not drop curated files');
  assert.ok(!tracked.some((file) => file.startsWith('enterprise/') || file.startsWith('docs/specs/')));
});
