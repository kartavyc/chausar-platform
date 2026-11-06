// Execution places (Ink v2 wave 4, package 4J11, catalogue H31): where code that is not Chausar's own runs. A delegated
// run (the owner's Claude Code or Codex) starts with no *_KEY, *_TOKEN or *_SECRET name in its environment; one
// delegated script runs per device at a time (DELEGATE_BUSY); a request that carries a sign-in never follows a
// redirect; a project .env in the work folder loads only allowlisted names and refuses the whole file on anything odd;
// and delegated work carries a backstop that refuses destructive database commands and force-push, which bypass
// tricks (quoting, ;, &&, environment expansion, paths, escapes, look-alike letters) do not get past. No network, no
// real tool: the process port is a stub that records what it was asked to start.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DelegatePorts, DelegateProcessRequest, DelegationRequest } from '../runtime/venture/contracts.ts';
import {
  BACKSTOP_RULE, briefWords, briefWordsOf, DELEGATE_BUSY_LINE, DELEGATE_DEFAULT_LIMITS, delegateBrief, delegateBusy, delegateEnv, destructiveCommand, folderNames,
  isCredentialName, prepareDelegation, runDelegation, takeDelegateSlot,
} from '../runtime/venture/delivery/harness/delegate.ts';
import { DOTENV_ALLOWLIST, projectEnv } from '../runtime/venture/delivery/harness/delegate-process.ts';
import { cliEnv } from '../runtime/venture/models/cli.ts';
import { guardedFetch, signedIn, type PinnedAnswer, type PinnedTarget } from '../runtime/venture/core/net-guard.ts';
import type { FileLike } from '../runtime/venture/delivery/harness/files.ts';

const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
// Credential-shaped values are built at runtime, so no fixture looks like a real key.
const fakeKey = (prefix: string) => [prefix, 'Zq8x2Lr7Vb9Nc4Kd1Pw6Ty3Hs5'].join('');
const SECRET_ENV: Record<string, string> = {
  OPENAI_API_KEY: fakeKey('sk-'), ANTHROPIC_API_KEY: fakeKey('sk-ant-'), GITHUB_TOKEN: fakeKey('ghp_'), AWS_SECRET_ACCESS_KEY: fakeKey('aws'),
  STRIPE_SECRET: fakeKey('sk_'), npm_config__authToken: fakeKey('npm_'), DB_PASSWORD: fakeKey('pw'), CHAUSAR_VAULT_KEY: fakeKey('vault'),
};
const CREDENTIAL = /(?:_KEY|_TOKEN|_SECRET)$/i;
const file = (name: string, content: string): FileLike => {
  const contentBase64 = Buffer.from(content, 'utf8').toString('base64');
  return { id: `upload_${name}`, name, format: 'csv', bytes: Buffer.byteLength(content), digest: `d-${name}`, contentBase64, clientData: true };
};
const ENV = { currency: 'INR', dateOrder: 'day-month-year' as const, runRef: { kind: 'delivery' as const, runId: 'run_places' } };

function request(cli: 'claude-code' | 'codex' = 'claude-code', briefText = delegateBrief('Read the bank statement and list the payments.', ['bank.csv'], cli, DELEGATE_DEFAULT_LIMITS)): DelegationRequest {
  return {
    toolCallId: 't1.1', turn: 1, cli, executable: '/opt/fake/claude', version: '2.1.0', briefText, uploadIds: ['upload_bank.csv'],
    limits: DELEGATE_DEFAULT_LIMITS, digest: 'digest', status: 'running', startedAt: '2026-10-26T10:00:00.000Z', delegateRunId: null,
  } as DelegationRequest;
}

/** A process port that records each request and answers when the test lets it. */
function stubPorts(): DelegatePorts & { seen: DelegateProcessRequest[]; release(): void } {
  const seen: DelegateProcessRequest[] = [];
  let open: () => void = () => undefined;
  const gate = new Promise<void>(resolve => { open = resolve; });
  return {
    seen, release: () => open(),
    async locate() { return '/opt/fake/claude'; },
    async process(input) { seen.push(input); await gate; return { exitCode: 0, stdout: '{}', stderr: '', timedOut: false, truncated: false }; },
  };
}

// ---------------------------------------------------------------------------
// 1. No credentials in a delegated run's environment
// ---------------------------------------------------------------------------

test('environment: a delegated run gets no *_KEY, *_TOKEN or *_SECRET name, whatever the engine\'s own environment holds', () => {
  const source = { PATH: '/usr/bin', HOME: '/home/owner', LANG: 'en_IN.UTF-8', CODEX_HOME: '/home/owner/.codex', ...SECRET_ENV };
  for (const cli of ['claude-code', 'codex'] as const) {
    const env = delegateEnv(cli, '/tmp/work/tmp', source);
    assert.deepEqual(Object.keys(env).filter(name => CREDENTIAL.test(name) || isCredentialName(name)), [], cli);
    for (const value of Object.values(SECRET_ENV)) assert.ok(!Object.values(env).includes(value), `${cli} carries no secret value`);
    assert.equal(env.PATH, '/usr/bin');
    assert.equal(env.TEMP, '/tmp/work/tmp');
  }
  // A name that slips onto the base list later is still dropped: the check is on the name, not the list.
  for (const name of Object.keys(SECRET_ENV)) assert.ok(isCredentialName(name), name);
  for (const name of ['PATH', 'HOME', 'LANG', 'TEMP', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'CLAUDE_CODE_MAX_OUTPUT_TOKENS', 'OTEL_SDK_DISABLED']) assert.ok(!isCredentialName(name), name);
  // A project .env can add only allowlisted names, never a credential, and never one of the base names.
  const env = delegateEnv('codex', '/tmp/work/tmp', source, { TZ: 'Asia/Kolkata', OPENAI_API_KEY: 'x', PATH: '/evil' });
  assert.equal(env.TZ, 'Asia/Kolkata');
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.PATH, '/usr/bin');
});

test('environment: the owner\'s CLI for text-only calls (models/cli.ts) gets no credential name either', () => {
  const saved = { ...process.env };
  try {
    Object.assign(process.env, SECRET_ENV);
    for (const kind of ['claude-cli', 'codex-cli'] as const) {
      const env = cliEnv(kind, 4096);
      assert.deepEqual(Object.keys(env).filter(name => CREDENTIAL.test(name)), [], kind);
    }
  } finally {
    for (const name of Object.keys(SECRET_ENV)) if (!(name in saved)) delete process.env[name];
  }
});

test('a delegated run as started: its environment holds no credential, and the brief carries the backstop', async () => {
  const saved = { ...process.env };
  const ports = stubPorts();
  ports.release();
  try {
    Object.assign(process.env, SECRET_ENV);
    const result = await runDelegation(ports, request(), [file('bank.csv', 'Date,Narration,Amount\n2026-09-01,Milk,"4,500.00"')], ENV);
    assert.equal(result.started, true);
    const [started] = ports.seen;
    assert.deepEqual(Object.keys(started.env).filter(name => CREDENTIAL.test(name)), []);
    assert.ok(started.stdin.includes(BACKSTOP_RULE));
  } finally {
    for (const name of Object.keys(SECRET_ENV)) if (!(name in saved)) delete process.env[name];
  }
});

// ---------------------------------------------------------------------------
// 2. One delegated script per device at a time
// ---------------------------------------------------------------------------

test('one at a time: a second delegated run while one is running does not start, and says why', async () => {
  const ports = stubPorts();
  const files = [file('bank.csv', 'Date,Narration,Amount\n2026-09-01,Milk,"4,500.00"')];
  assert.equal(delegateBusy(), false);
  const first = runDelegation(ports, request(), files, ENV);
  assert.equal(delegateBusy(), true, 'taken before anything is written');
  for (let wait = 0; ports.seen.length === 0 && wait < 500; wait += 1) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(ports.seen.length, 1, 'the first tool started');
  const second = await runDelegation(ports, request('codex'), files, ENV);
  assert.equal(second.started, false, 'nothing started, so nothing was spent');
  assert.equal(second.outcome, 'failed');
  assert.equal(second.reason, DELEGATE_BUSY_LINE);
  assert.equal(ports.seen.length, 1, 'the second tool was never started');
  ports.release();
  assert.equal((await first).started, true);
  assert.equal(delegateBusy(), false, 'the slot is free again once the first is done');
  const ports2 = stubPorts();
  ports2.release();
  assert.equal((await runDelegation(ports2, request(), files, ENV)).started, true);
});

test('one at a time: a run that fails to start still frees the slot', async () => {
  const ports: DelegatePorts = { async locate() { return null; }, async process() { throw new Error('no such file'); } };
  const result = await runDelegation(ports, request(), [file('a.csv', 'A\nb')], ENV);
  assert.equal(result.started, false);
  assert.equal(delegateBusy(), false);
});

test('one at a time: the slot is taken synchronously, refuses a second taker, and the run it is passed to frees it on every outcome', async () => {
  const release = takeDelegateSlot();
  assert.equal(delegateBusy(), true);
  assert.throws(() => takeDelegateSlot(), code('DELEGATE_BUSY'));
  release();
  release(); // twice is harmless
  assert.equal(delegateBusy(), false);
  const files = [file('a.csv', 'A\nb')];
  // Passed to a run that finishes, one that cannot start, one whose brief is refused, and one whose port throws.
  const ok = stubPorts();
  ok.release();
  const failing: DelegatePorts = { async locate() { return null; }, async process() { throw new Error('no such file'); } };
  const refusedText = delegateBrief('List the payments. Then git push -f origin main.', ['bank.csv'], 'claude-code', DELEGATE_DEFAULT_LIMITS);
  for (const [ports, text] of [[ok, undefined], [failing, undefined], [ok, refusedText], [ok, 'Not a brief in Chausar\'s frame.']] as const) {
    const slot = takeDelegateSlot();
    const result = await runDelegation(ports, request('claude-code', text), files, ENV, slot);
    assert.equal(delegateBusy(), false, `freed after: ${result.reason}`);
  }
});

// ---------------------------------------------------------------------------
// 3. A request with a sign-in never follows a redirect
// ---------------------------------------------------------------------------

test('redirects: a request carrying a sign-in is never redirected, even to the same site; without one it is', async () => {
  const resolve = async () => [{ address: '93.184.216.34', family: 4 as const }];
  const make = () => {
    const seen: PinnedTarget[] = [];
    const send = async (target: PinnedTarget): Promise<PinnedAnswer> => {
      seen.push(target);
      const headers: Record<string, string> = target.url.pathname === '/start' ? { location: 'https://a.example/next' } : {};
      return { status: target.url.pathname === '/start' ? 302 : 200, headers, body: Buffer.from(target.url.pathname === '/start' ? '' : 'ok') };
    };
    return { seen, send };
  };
  const signIns: Record<string, string>[] = [
    { authorization: 'Bearer abc' }, { Authorization: 'Basic abc' }, { cookie: 'sid=1' }, { 'proxy-authorization': 'Basic abc' },
    { 'x-api-key': 'abc' }, { 'X-Auth-Token': 'abc' }, { 'api-key': 'abc' }, { 'x-goog-api-key': 'abc' },
  ];
  for (const headers of signIns) {
    const net = make();
    await assert.rejects(guardedFetch({ url: 'https://a.example/start', headers }, { resolve, send: net.send }), code('NET_REDIRECT_REFUSED'));
    assert.equal(net.seen.length, 1, `${Object.keys(headers)[0]}: only the first request went`);
  }
  const plain = make();
  const answer = await guardedFetch({ url: 'https://a.example/start', headers: { accept: 'text/plain' } }, { resolve, send: plain.send });
  assert.equal(answer.status, 200);
  assert.equal(plain.seen.length, 2);
  // A sign-in in the address's query counts the same: a key, a token, a signature, auth.
  for (const query of ['api_key=abc', 'access_token=abc', 'sig=abc', 'X-Amz-Signature=abc', 'auth=abc', 'apikey=abc', 'session=abc', 'code=abc']) {
    const net = make();
    await assert.rejects(guardedFetch({ url: `https://a.example/start?${query}` }, { resolve, send: net.send }), code('NET_REDIRECT_REFUSED'), query);
    assert.equal(net.seen.length, 1, query);
  }
  const paged = make();
  assert.equal((await guardedFetch({ url: 'https://a.example/start?page=2&lang=en' }, { resolve, send: paged.send })).status, 200, 'a plain query still follows');
  assert.equal(signedIn({}, new URL('https://owner:pw@a.example/')), true, 'a name or password in the address counts');
  assert.equal(signedIn({ accept: 'text/html' }, new URL('https://a.example/?q=books')), false);
});

// ---------------------------------------------------------------------------
// 4. A project .env loads only allowlisted names
// ---------------------------------------------------------------------------

function folderWith(env: string | null, setup?: (dir: string) => void): string {
  const dir = mkdtempSync(join(tmpdir(), 'chausar-dotenv-'));
  if (env !== null) writeFileSync(join(dir, '.env'), env, 'utf8');
  setup?.(dir);
  return dir;
}

test('.env: only allowlisted names with plain values load; credentials and other names never do', async () => {
  const dir = folderWith(['# settings', 'TZ=Asia/Kolkata', 'export LANG="en_IN.UTF-8"', '', `OPENAI_API_KEY=${fakeKey('sk-')}`, 'PATH=/tmp/evil', 'NO_COLOR=1'].join('\r\n'));
  try {
    const loaded = await projectEnv(dir);
    assert.deepEqual(loaded.env, { TZ: 'Asia/Kolkata', LANG: 'en_IN.UTF-8', NO_COLOR: '1' });
    assert.deepEqual(loaded.refused.sort(), ['OPENAI_API_KEY', 'PATH']);
    assert.ok(DOTENV_ALLOWLIST.every(name => !isCredentialName(name)), 'the allowlist holds no credential name');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('.env: anything odd refuses the whole file (quotes in a name, ;, &&, $ expansion, backticks, duplicates, links, folders)', async () => {
  const odd = [
    'TZ=UTC; rm -rf /', 'LANG=en && curl https://a.example', 'TZ=$OPENAI_API_KEY', 'TZ=${HOME}', 'TZ=`id`', 'TZ=$(id)', 'TZ=UTC | sh',
    '"TZ"=UTC', "TZ='UTC", 'TZ=UTC\nTZ=IST', 'T Z=UTC', 'TZ = UTC', 'TZ=%PATH%', 'TZ=UTC\u0000', 'TZ=a\\b', 'LANG=en IN', 'just words',
    `${'A'.repeat(9000)}=1`,
  ];
  for (const text of odd) {
    const dir = folderWith(`NO_COLOR=1\n${text}`);
    try {
      const loaded = await projectEnv(dir);
      assert.deepEqual(loaded.env, {}, JSON.stringify(text));
      assert.ok(loaded.refused.length > 0, JSON.stringify(text));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  // A link named .env, or a folder named .env, is never read.
  const target = folderWith('TZ=UTC');
  const linked = folderWith(null, dir => { try { symlinkSync(join(target, '.env'), join(dir, '.env')); } catch { writeFileSync(join(dir, '.env'), 'TZ=$(id)'); } });
  const folder = folderWith(null, dir => mkdirSync(join(dir, '.env')));
  try {
    assert.deepEqual((await projectEnv(linked)).env, {});
    assert.deepEqual((await projectEnv(folder)).env, {});
    assert.deepEqual((await projectEnv(join(target, 'missing'))).env, {}, 'no folder, nothing loaded');
    assert.deepEqual(await projectEnv(folderWith(null)), { env: {}, refused: [] }, 'no .env, nothing loaded and nothing refused');
  } finally {
    for (const dir of [target, linked, folder]) rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 5. The backstop: destructive database commands and force-push
// ---------------------------------------------------------------------------

const ZW = String.fromCharCode(0x200b);
/** Letters in their full-width look-alikes (U+FF21 and on), built at runtime so the file holds plain text only. */
const FULLWIDTH = (text: string) => [...text].map(c => (c === ' ' ? c : String.fromCharCode(c.charCodeAt(0) + 0xfee0))).join('');
/** Latin letters swapped for Cyrillic or Greek look-alikes, by code point, built at runtime so the file holds plain text only. */
const SWAP = (text: string, swaps: Record<string, number>) => [...text].map(c => (swaps[c] ? String.fromCharCode(swaps[c]) : c)).join('');
const CYRILLIC = { O: 0x041e, P: 0x0420, A: 0x0410, E: 0x0415, C: 0x0421, T: 0x0422, o: 0x043e, a: 0x0430, e: 0x0435, p: 0x0440, c: 0x0441, i: 0x0456 };
const GREEK = { i: 0x03b9, o: 0x03bf, t: 0x03c4, O: 0x039f, P: 0x03a1, T: 0x03a4, A: 0x0391, E: 0x0395 };
const DESTRUCTIVE: string[] = [
  'DROP TABLE clients;', 'drop database ledger', 'Drop Schema public cascade', 'TRUNCATE invoices', 'truncate table payments', 'DELETE FROM payments',
  'delete from clients where 1=1', 'dropdb prod', 'db.dropDatabase()', 'db.clients.drop()', 'redis-cli FLUSHALL', 'FLUSHDB', 'rails db:drop', 'rake db:reset',
  'npx prisma migrate reset --force', 'ALTER TABLE clients DROP COLUMN name', 'psql -c "DROP SCHEMA public CASCADE"', "sqlite3 books.db 'drop table t'",
  'mysqladmin drop books', 'git push --force', 'git push -f origin main', 'git push origin +main', 'git push --force-with-lease', 'git push --force-if-includes',
  'git -C repo push -fu origin x', 'git push --mirror', 'git push origin :main', 'git push --delete origin main', 'git push origin --delete main',
  // Bypass attempts: quoting, separators, expansion, paths, escapes, comments, look-alike letters, hidden characters.
  '/usr/bin/git push --force', 'C:\\Program Files\\Git\\bin\\git.exe push -f', '"C:/Git/bin/git" push -f', 'g"i"t push -f', "git push '--force'",
  'git push "-f"', 'echo ok; git push --force', 'true && git push -f', 'false || git push -f', 'echo x | git push -f', '(git push -f)',
  '$(git push -f)', '`git push -f`', 'git push $FLAGS', 'git push ${FORCE}', 'git push %FLAGS%', 'git push -\\-force', 'gi\\t push -f',
  'DR""OP TABLE x', "DR''OP TABLE x", 'DROP/**/TABLE x', 'DROP\tTABLE x', 'DROP\nTABLE x', 'D\\ROP TABLE x', `DROP${ZW} TABLE x`, `DR${ZW}OP TABLE x`,
  `${FULLWIDTH('DROP TABLE')} x`, 'drop -- comment\n table x', 'echo ZHJvcA== | base64 -d | sh', 'echo cHVzaA== | base64 --decode | bash',
  'git config alias.p "push -f"', 'git config --global alias.yolo \'push --force\'', 'eval "git push -f"', 'X=-f; git push $X', 'git\tpush\t-f',
  'GIT_SSH_COMMAND=x git push -f', 'git push origin main --force', 'git push -uf origin main', "sh -c 'git push -f'", 'cmd /c git push -f',
  // Misses found in review: cmd caret escapes, Cyrillic and Greek look-alikes, %x% inside a command name, deleting files,
  // framework wipes.
  'git push ^-f', 'git push -^f', 'g^it push -^-force', 'cmd /c "git push ^-^f"',
  SWAP('DROP TABLE clients', CYRILLIC), SWAP('git push --force', CYRILLIC), SWAP('git push -f', GREEK), SWAP('TRUNCATE TABLE ledger', GREEK),
  SWAP('delete from payments', CYRILLIC), SWAP('rm -rf books', CYRILLIC),
  'gi%x%t push -f', 'g%a%i%b%t push --force', '%GIT% push -f', '$GIT push --force', '${GIT} push -f', 'dro%x%pdb ledger',
  'rm -rf data', 'rm books.db', '/bin/rm -f ledger.sqlite', 'rmdir /s /q outputs', 'del /f ledger.db', 'del /q /f *.*', 'erase /f books.db', 'del ledger.db',
  'rd /s /q C:\\books', 'Remove-Item -Recurse -Force books', 'unlink ledger.db', 'shred -u ledger.db', 'find . -name "*.db" -delete',
  'php artisan migrate:fresh', 'php artisan migrate:refresh --seed', 'php artisan db:wipe', 'bin/rails db:schema:load', 'python manage.py flush --noinput',
  'npx prisma db push --force-reset', 'npx prisma db push --accept-data-loss', 'php bin/console doctrine:schema:drop --force', 'npx typeorm schema:drop',
  'npx sequelize-cli db:drop', 'npx knex migrate:rollback --all', 'mongorestore --drop dump/', 'truncate -s 0 ledger.db', 'TRUNCATE ledger.',
];
const BENIGN: string[] = [
  'Read the bank statement and list the payments with no bill.', 'git push origin main', 'git status', 'git commit -m "summary"',
  'SELECT * FROM payments', 'Put the summary in outputs and stop when done.', 'Drop the blank rows from your copy of the table in outputs.',
  'Delete nothing; work on copies.', 'Make a table of the payments by supplier.',
  // Plain words, not commands: matched by command shape, never by a lone word.
  'Truncate long descriptions to one line.', 'Delete from the summary any line that repeats.', 'Drop column B from your copy.', 'Drop column B',
  'Remove the duplicate rows from your copy.', 'Push the summary into outputs.', 'Use the form to delete blanks, then stop.', 'Truncate long descriptions',
  'Delete from the summary', 'Fresh pastries at the cafe.', 'Read the del notes and the rm notes in the folder.',
];

test('backstop: destructive database commands and force-push are caught, whatever the spelling', () => {
  for (const text of DESTRUCTIVE) assert.ok(destructiveCommand(text), `not caught: ${JSON.stringify(text)}`);
  for (const text of BENIGN) assert.equal(destructiveCommand(text), null, `wrongly caught: ${JSON.stringify(text)}`);
});

test('backstop: the brief says it, and a brief that asks for one is refused before the owner sees it', () => {
  const brief = delegateBrief('Read the files.', ['a.csv'], 'codex', DELEGATE_DEFAULT_LIMITS);
  assert.ok(brief.includes(BACKSTOP_RULE));
  assert.match(BACKSTOP_RULE, /database/);
  assert.match(BACKSTOP_RULE, /force-push/);
  const offer = { cli: 'codex' as const, state: 'unverified' as const, reason: '', executable: '/opt/fake/codex', version: '0.9.0' };
  for (const task of ['Fix the repo, then run git push --force to publish it.', 'Clean the database with DROP TABLE clients and start again.', 'Clear the store: TRUNCATE ledger.']) {
    assert.throws(() => prepareDelegation({ offer, task, files: [file('a.csv', 'A\nb')], minutes: 10, allowed: [] }), code('TOOL_INPUT_INVALID'), task);
  }
  assert.doesNotThrow(() => prepareDelegation({ offer, task: 'Read the files and list what is missing.', files: [file('a.csv', 'A\nb')], minutes: 10, allowed: [] }));
});

test('backstop: prepare and run check the same words (the job and the file names, not the fixed frame), so an approved brief is never refused later', async () => {
  const offer = { cli: 'claude-code' as const, state: 'unverified' as const, reason: '', executable: '/opt/fake/claude', version: '2.1.0' };
  const tasks = [...BENIGN.filter(text => !/\d/.test(text)), 'Read the files.', 'Fix the repo, then run git push --force to publish it.', 'Truncate long descriptions in your copy.'];
  const names = [['bank.csv'], ['drop table clients.csv'], ['notes.txt', 'rm -rf.csv']];
  for (const task of tasks) {
    for (const list of names) {
      const files = list.map(name => file(name, 'A\nb'));
      let draft;
      try { draft = prepareDelegation({ offer, task, files, minutes: 10, allowed: [] }); } catch { continue; }
      assert.equal(briefWordsOf(draft.briefText), briefWords(task, folderNames(files)), 'the run reads back exactly the words prepare checked');
      const ports = stubPorts();
      ports.release();
      const result = await runDelegation(ports, request('claude-code', draft.briefText), files, ENV);
      assert.equal(result.started, true, `approved, then refused: ${task} ${list}`);
    }
  }
  // The fixed frame's own words (rule 7 names databases and force-push) are never what refuses a brief.
  assert.equal(destructiveCommand(briefWordsOf(delegateBrief('Read the files.', ['a.csv'], 'codex', DELEGATE_DEFAULT_LIMITS))!), null);
  // File names are checked with the job, as the tool sees them: a client file named like a command reaches the brief
  // only as a safe folder name, which is no command, so it neither runs nor refuses the brief.
  const named = prepareDelegation({ offer, task: 'Read the files.', files: [file('x.csv; rm -rf outputs', 'A\nb')], minutes: 10, allowed: [] });
  assert.equal(briefWordsOf(named.briefText), briefWords('Read the files.', ['x.csv--rm--rf-outputs']));
  assert.equal(destructiveCommand(briefWords('Read the files.', ['rm -rf outputs'])), 'a command that deletes files', 'an unsanitised name would be caught');
});

test('backstop: a stored brief that names one is never started, and nothing is spent', async () => {
  const ports = stubPorts();
  ports.release();
  const text = delegateBrief('List the payments. Then git push -f origin main.', ['bank.csv'], 'claude-code', DELEGATE_DEFAULT_LIMITS);
  const result = await runDelegation(ports, request('claude-code', text), [file('bank.csv', 'A\nb')], ENV);
  assert.equal(result.started, false);
  assert.equal(ports.seen.length, 0);
  assert.match(result.reason, /database|force-push/);
});
