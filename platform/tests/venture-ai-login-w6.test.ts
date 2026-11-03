// Wave 6, 6C1 (DECISIONS D12): Connect your AI starts each tool's OWN official login as a child process and shows the
// code and link it prints. Chausar never reads, copies or handles credentials or login files; a tool already signed in
// is never asked to sign in again. The device-auth output below is a recorded shape of Codex 0.154.0's real output,
// with a synthetic code built at run time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { LoginDesk, parseLoginOutput, type LoginLaunch } from '../runtime/venture/models/login.ts';

const CODE = ['WXYZ', '12345'].join('-');
const ESC = '\u001b';
/** Codex 0.154.0 `codex login --device-auth`, as captured in a disposable CODEX_HOME on 1 November 2026 (code replaced). */
export const DEVICE_AUTH_OUTPUT = [
  'WARNING: proceeding, even though we could not create PATH aliases: Refusing to create helper binaries under temporary dir',
  '',
  `Welcome to Codex [v${ESC}[90m0.154.0${ESC}[0m]`,
  `${ESC}[90mOpenAI's command-line coding agent${ESC}[0m`,
  '',
  'Follow these steps to sign in with ChatGPT using device code authorization:',
  '',
  '1. Open this link in your browser and sign in to your account',
  `   ${ESC}[94mhttps://auth.openai.com/codex/device${ESC}[0m`,
  '',
  `2. Enter this one-time code ${ESC}[90m(expires in 15 minutes)${ESC}[0m`,
  `   ${ESC}[94m${CODE}${ESC}[0m`,
  '',
].join('\n');

class FakeChild extends EventEmitter {
  stdout = new EventEmitter(); stderr = new EventEmitter(); stdin = { end() {} };
  killed = false; exitCode: number | null = null;
  kill() { this.killed = true; queueMicrotask(() => this.emit('exit', null, 'SIGTERM')); return true; }
  finish(code: number) { this.exitCode = code; this.emit('exit', code, null); }
}

type Answer = { code: number; text: string };
type Script = { status: Record<string, Answer> | ((key: string) => Answer | undefined) };
function rig(script: Script) {
  const launches: LoginLaunch[] = [];
  const children: FakeChild[] = [];
  const spawn = (launch: LoginLaunch) => {
    launches.push(launch);
    const child = new FakeChild();
    const key = `${launch.cli} ${launch.args.slice(-2).join(' ')}`;
    const answer = typeof script.status === 'function' ? (launch.args.includes('status') ? script.status(key) : undefined)
      : Object.entries(script.status).find(([name]) => key.endsWith(name))?.[1];
    if (answer) queueMicrotask(() => { child.stdout.emit('data', Buffer.from(answer.text)); child.finish(answer.code); });
    else children.push(child);
    return child as any;
  };
  const desk = new LoginDesk({
    spawn, platform: 'linux', claudeTerms: 'accepted', statusCacheMs: 0,
    locate: command => (command === 'codex' ? '/usr/local/bin/codex' : command === 'claude' ? '/usr/local/bin/claude' : null),
  });
  return { desk, launches, children };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 5));

test('A2: a found Codex not yet chosen is shown as a setup to review; one in use says where it came from', async () => {
  const reviewed: (string | null)[] = [];
  const review = { state: 'review' as const, origin: null, path: '/usr/local/bin/codex', version: '0.166.0', sha256: 'a'.repeat(64), line: 'Codex 0.166.0 is on this computer and has what Chausar needs. Use it?' };
  const desk = new LoginDesk({
    spawn: () => { const child = new FakeChild(); queueMicrotask(() => { child.stdout.emit('data', Buffer.from('Not logged in\n')); child.finish(1); }); return child as any; },
    platform: 'linux', claudeTerms: 'accepted', statusCacheMs: 0,
    locate: command => (command === 'codex' ? '/usr/local/bin/codex' : null),
    codex: { async review(found) { reviewed.push(found); return review; } },
  });
  const { tools } = await desk.tools();
  const codex = tools.find(tool => tool.cli === 'codex')!;
  assert.deepEqual(codex.setup, review);
  assert.deepEqual(reviewed, ['/usr/local/bin/codex'], 'the review is of the Codex the search path finds');
  assert.equal(tools.find(tool => tool.cli === 'claude-code')!.setup, undefined, 'Claude Code has no Codex setup');
});

test('the recorded device-auth output gives the OpenAI link and the one-time code', () => {
  assert.deepEqual(parseLoginOutput('codex', DEVICE_AUTH_OUTPUT), { link: 'https://auth.openai.com/codex/device', code: CODE });
  // A link to any other site is never shown, and no code without its line.
  assert.deepEqual(parseLoginOutput('codex', 'Open https://evil.example/codex/device and enter ABCD-12345'), { link: null, code: null });
  assert.deepEqual(parseLoginOutput('claude-code', 'If the browser did not open, visit: https://claude.ai/oauth/authorize?code=true&state=s1'), { link: 'https://claude.ai/oauth/authorize?code=true&state=s1', code: null });
});

test('a tool already signed in shows Signed in and no login is started', async () => {
  const { desk, launches } = rig({ status: { 'login status': { code: 0, text: 'Logged in using ChatGPT\n' } } });
  const view = await desk.start('codex');
  assert.equal(view.signedIn, 'yes');
  assert.equal(view.login.state, 'idle');
  assert.ok(launches.every(launch => !launch.args.includes('--device-auth')), 'no device login started');
});

test('a signed-out Codex starts its own device login, shows the code, and finishes when Codex exits cleanly', async () => {
  let signedIn = false;
  // Status answers depend on whether the login finished.
  const { desk, launches, children } = rig({ status: () => (signedIn ? { code: 0, text: 'Logged in using ChatGPT\n' } : { code: 1, text: 'Not logged in\n' }) });
  const started = await desk.start('codex');
  assert.equal(started.signedIn, 'no');
  assert.equal(started.login.state, 'starting');
  const login = launches.find(launch => launch.args.includes('--device-auth'))!;
  assert.deepEqual(login.args.slice(-2), ['login', '--device-auth']);
  assert.equal(login.command, '/usr/local/bin/codex');
  for (const name of Object.keys(login.env)) assert.match(name, /^(PATH|Path|SystemRoot|WINDIR|TEMP|TMP|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|CODEX_HOME|[A-Z_]*TELEMETRY[A-Z_]*|[A-Z_]*ANALYTICS[A-Z_]*|DO_NOT_TRACK|OTEL_[A-Z_]+|CODEX_[A-Z_]+|DISABLE_[A-Z_]+)$/, name);
  children[0]!.stdout.emit('data', Buffer.from(DEVICE_AUTH_OUTPUT));
  const waiting = (await desk.tools()).tools.find(tool => tool.cli === 'codex')!;
  assert.equal(waiting.login.state, 'waiting');
  assert.equal(waiting.login.code, CODE);
  assert.equal(waiting.login.link, 'https://auth.openai.com/codex/device');
  signedIn = true;
  children[0]!.finish(0);
  await tick();
  const done = (await desk.tools()).tools.find(tool => tool.cli === 'codex')!;
  assert.equal(done.login.state, 'signed-in');
  assert.equal(done.signedIn, 'yes');
  assert.equal(done.login.code, null, 'the code is dropped once used');
});

test('cancel stops the login process; clearing the desk stops every login', async () => {
  const { desk, children } = rig({ status: { 'login status': { code: 1, text: 'Not logged in\n' }, 'auth status': { code: 0, text: '{"loggedIn": false}' } } });
  await desk.start('codex');
  await desk.start('claude-code');
  assert.equal(children.length, 2);
  const cancelled = await desk.cancel('codex');
  assert.equal(cancelled.login.state, 'cancelled');
  assert.equal(children[0]!.killed, true);
  desk.clear();
  assert.equal(children[1]!.killed, true);
});

test('Claude Code starts its own auth login; a missing tool or the terms gate refuse plainly', async () => {
  const { desk, launches } = rig({ status: { 'auth status': { code: 0, text: '{"loggedIn": false}' } } });
  const view = await desk.start('claude-code');
  assert.equal(view.login.state, 'starting');
  assert.deepEqual(launches.at(-1)!.args, ['auth', 'login']);
  const none = new LoginDesk({ spawn: () => { throw new Error('nothing may start'); }, locate: () => null, platform: 'linux', claudeTerms: 'accepted', statusCacheMs: 0 });
  await assert.rejects(none.start('codex'), { code: 'CLI_UNAVAILABLE', message: /Install Codex/ });
  const gated = new LoginDesk({ spawn: () => { throw new Error('nothing may start'); }, locate: () => '/usr/local/bin/claude', platform: 'linux', claudeTerms: 'pending', statusCacheMs: 0 });
  assert.deepEqual((await gated.tools()).tools.map(tool => tool.cli), ['codex']);
  await assert.rejects(gated.start('claude-code'), { code: 'PRESET_UNAVAILABLE' });
});

test('A2: "Signed in" is earned: the tool\'s own status is not enough until one tiny test call worked', async () => {
  const signedIn = { code: 0, text: 'Logged in using ChatGPT\n' };
  const tests: string[] = [];
  let answer: { ok: true } | { ok: false; code: string; line: string } = { ok: false, code: 'AI_USAGE_LIMIT', line: 'Codex has used up your plan for now. Wait for it to reset, or choose another AI in Settings.' };
  const desk = new LoginDesk({
    spawn: () => { const child = new FakeChild(); queueMicrotask(() => { child.stdout.emit('data', Buffer.from(signedIn.text)); child.finish(signedIn.code); }); return child as any; },
    platform: 'linux', claudeTerms: 'accepted', statusCacheMs: 0, testRetryMs: 0,
    locate: command => (command === 'codex' ? '/usr/local/bin/codex' : null),
    testCall: async cli => { tests.push(cli); return answer; },
  });
  let codex = (await desk.tools()).tools.find(tool => tool.cli === 'codex')!;
  assert.deepEqual([codex.signedIn, codex.tested, codex.problem], ['unknown', 'failed', answer.line]);
  answer = { ok: true };
  codex = (await desk.tools()).tools.find(tool => tool.cli === 'codex')!;
  assert.deepEqual([codex.signedIn, codex.tested, codex.problem], ['yes', 'passed', undefined]);
  await desk.tools();
  assert.equal(tests.length, 2, 'a passed test is not run again');
});

test('A2: no test call for a Codex the owner has not chosen yet', async () => {
  const tests: string[] = [];
  const desk = new LoginDesk({
    spawn: () => { const child = new FakeChild(); queueMicrotask(() => { child.stdout.emit('data', Buffer.from('Logged in using ChatGPT\n')); child.finish(0); }); return child as any; },
    platform: 'linux', claudeTerms: 'accepted', statusCacheMs: 0,
    locate: command => (command === 'codex' ? '/usr/local/bin/codex' : null),
    codex: { async review() { return { state: 'review' as const, origin: null, path: '/usr/local/bin/codex', version: '0.166.0', sha256: 'a'.repeat(64), line: 'x' }; } },
    testCall: async cli => { tests.push(cli); return { ok: true }; },
  });
  const codex = (await desk.tools()).tools.find(tool => tool.cli === 'codex')!;
  assert.equal(codex.signedIn, 'unknown');
  assert.deepEqual(tests, []);
});
