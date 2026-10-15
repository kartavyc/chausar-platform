import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolverPath } from '../runtime/native/update-launch.ts';

/**
 * The Windows launcher stub, scripts/release/launcher/chausar-launcher.cmd. It has NOT run on Windows.
 * Here: a static reading of its structure and quoting (always), `update-launch.ts adopt` placing it (POSIX
 * hosts with tar), and, only when CHAUSAR_TEST_WINE_NODE names a Windows node.exe and `wine` is installed,
 * a run under Wine's cmd with node.exe standing in for Chausar.exe over a real install root whose path holds
 * spaces, "&" and "!". Wine's cmd is not Windows' cmd; a pass there is evidence, not proof.
 */
const repo = fileURLToPath(new URL('../..', import.meta.url));
const stubPath = join(repo, 'scripts', 'release', 'launcher', 'chausar-launcher.cmd');
const resolverModule = join(repo, 'platform', 'runtime', 'native', 'update-launch.ts');
const raw = await readFile(stubPath);
const text = raw.toString('latin1');
const lines = text.split('\r\n');
const final = JSON.parse(await readFile(join(repo, 'app', 'desktop', 'builder.json'), 'utf8'));
const preview = JSON.parse(await readFile(join(repo, 'app', 'desktop', 'builder.preview.json'), 'utf8'));
const index = (pattern: RegExp) => lines.findIndex(line => pattern.test(line));

test('cmd launcher: CRLF ASCII batch with extensions on and delayed expansion off before any work', () => {
  assert.ok(raw.every(byte => byte === 0x0d || byte === 0x0a || byte >= 0x20 && byte < 0x7f), 'plain ASCII');
  assert.ok(!/[^\r]\n/.test(text) && text.endsWith('\r\n'), 'every line ends in CRLF');
  assert.equal(lines[0], '@echo off');
  const setlocal = index(/^setlocal EnableExtensions DisableDelayedExpansion$/);
  assert.ok(setlocal > 0 && lines.slice(1, setlocal).every(line => line.startsWith('rem') || line === ''), 'setlocal comes first');
  // No CALL (it expands "%" a second time) and no pipes into a second cmd that could re-parse a value.
  for (const line of lines) assert.doesNotMatch(line, /^\s*call\b|\bcall :/i, line);
  // Delayed expansion ("!") is used only inside its two short scopes (name check, pointer rewrite), each closed by endlocal
  // before any path is touched again.
  const scopes: [number, number][] = [];
  lines.forEach((line, at) => { if (line === 'setlocal EnableDelayedExpansion') scopes.push([at, lines.findIndex((next, after) => after > at && /^\s*endlocal\b/.test(next))]); });
  assert.equal(scopes.length, 2);
  for (const [open, close] of scopes) {
    assert.ok(open > setlocal && close > open);
    for (const line of lines.slice(open, close + 1)) for (const path of ['%root%', '%pointer%', '%app%', '%host%', '%target%']) assert.ok(!line.includes(path), line);
  }
  lines.forEach((line, at) => { if (!line.startsWith('rem') && line.includes('!') && !scopes.some(([open, close]) => at > open && at <= close)) assert.fail(`"!" outside a delayed scope: ${line}`); });
  // Every goto has its label, and every label is reached.
  const labels = new Set(lines.filter(line => /^:[a-z_]+$/.test(line)).map(line => line.slice(1)));
  const gotos = [...text.matchAll(/goto ([a-z_]+)/g)].map(match => match[1]);
  for (const label of gotos) assert.ok(labels.has(label), label);
  for (const label of labels) assert.ok(gotos.includes(label), label);
});

test('cmd launcher: every path is used only inside double quotes', () => {
  const paths = ['%root%', '%app%', '%hostDir%', '%host%', '%resolver%', '%target%', '%decisionFile%', '%pointer%', '%%D', '%%V', '%version%', '%previous%', '%current%', '%name%', '%line%'];
  for (const line of lines) {
    if (line.startsWith('rem')) continue;
    for (const token of paths) {
      for (let at = line.indexOf(token); at !== -1; at = line.indexOf(token, at + 1)) {
        if (line.slice(0, at).endsWith('for /d ')) continue;
        // An escaped ^" (in the FOR /F options) is a literal character, not a quote.
        const quotes = (line.slice(0, at).match(/(?<!\^)"/g) ?? []).length;
        assert.equal(quotes % 2, 1, `${token} outside quotes in: ${line}`);
      }
    }
  }
});

test('cmd launcher: same design as the sh stub (never edits current.json, Node-mode resolver, previous first on trial, codes)', async () => {
  const sh = await readFile(join(repo, 'scripts', 'release', 'launcher', 'chausar-launcher.sh'), 'utf8');
  // Exit codes match the POSIX stub: usage 64, not installed 66, unresolved/missing 70.
  for (const [code, word] of [[64, 'LAUNCH_EXECUTABLE_INVALID'], [66, 'LAUNCH_NOT_INSTALLED'], [70, 'LAUNCH_UNRESOLVED'], [70, 'LAUNCH_EXECUTABLE_MISSING']] as const) {
    assert.match(sh, new RegExp(`${word}[^\\n]*exit ${code}`));
    const at = index(new RegExp(`${word}:`));
    assert.ok(at > 0 && lines[at + 1] === `exit /b ${code}`, word);
  }
  // The pointer is only read: no redirect into it, no delete, move, copy or rename of it.
  for (const line of lines.filter(line => !line.startsWith('rem') && (line.includes('%pointer%') || /current\.json/.test(line)))) {
    assert.doesNotMatch(line, />\s*"?%pointer%|\b(del|erase|move|copy|ren|rename|type)\b/i, line);
  }
  assert.equal(lines.filter(line => line === 'set "pointer=%root%\\current.json"').length, 1);
  // Node mode is set right before the resolver, which is the packaged update-launch.ts, and cleared right after.
  const call = index(/^"%host%" "%resolver%" resolve --install-root "%root%" --executable-name "%name%" >"%decisionFile%"$/);
  assert.ok(call > 0);
  assert.equal(lines[call - 1], 'set "ELECTRON_RUN_AS_NODE=1"');
  assert.equal(lines[call + 1], 'set "resolved=%errorlevel%"');
  assert.equal(lines[call + 2], 'set "ELECTRON_RUN_AS_NODE="');
  const packaged = relativeResolver();
  assert.ok(lines.filter(line => line.includes(packaged)).length >= 3, packaged);
  // While a version is on trial the previous one resolves first.
  const order = index(/^set "first=%current%"$/);
  assert.deepEqual(lines.slice(order, order + 4), ['set "first=%current%"', 'set "second=%previous%"',
    'if "%state%"=="trial" if defined previous set "first=%previous%"', 'if "%state%"=="trial" if defined previous set "second=%current%"']);
  // The chosen app starts with CHAUSAR_INSTALL_ROOT set and Node mode cleared; its exit code is returned.
  const start = index(/^"%target%" %\*$/);
  assert.deepEqual(lines.slice(start - 2, start + 2), ['set "ELECTRON_RUN_AS_NODE="', 'set "CHAUSAR_INSTALL_ROOT=%root%"', '"%target%" %*', 'exit /b %errorlevel%']);
  // One adopt marker for the default executable name, matching the builders' Windows executable.
  assert.equal(lines.filter(line => line === 'set "name=Chausar.exe"').length, 1);
});

function relativeResolver(): string {
  const absolute = resolverPath(join(sep, 'app'));
  return absolute.slice(join(sep, 'app').length + 1).split(sep).join('\\');
}

test('builder configs package the cmd stub next to the sh stub and name the Windows executable Chausar.exe', () => {
  for (const config of [final, preview]) {
    for (const key of ['files', 'asarUnpack']) assert.ok(config[key].includes('scripts/release/launcher/**/*'), key);
    assert.equal(config.win.executableName, 'Chausar');
  }
});

const posix = process.platform !== 'win32' && spawnSync('tar', ['--version']).status === 0;

test('adopt places chausar-launcher.cmd with the build executable name', { skip: !posix }, async t => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'chausar-launcher-cmd-')); t.after(() => rm(root, { recursive: true, force: true }));
  const top = join(root, 'src', 'Chausar-1.0.0-win-x64'), native = join(top, 'resources', 'app.asar.unpacked', 'platform', 'runtime', 'native');
  await mkdir(native, { recursive: true });
  await writeFile(join(native, 'update-launch.ts'), '// placeholder\n');
  for (const name of ['Chausar.exe', 'Chausar-Preview.exe']) { await writeFile(join(top, name), 'synthetic'); await chmod(join(top, name), 0o755); }
  const archive = join(root, 'Chausar-1.0.0-win-x64.tar.gz');
  assert.equal(spawnSync('tar', ['-czf', archive, '-C', join(root, 'src'), 'Chausar-1.0.0-win-x64']).status, 0);
  const adopt = (installRoot: string, extra: string[] = []) => spawnSync(process.execPath,
    [resolverModule, 'adopt', '--install-root', installRoot, '--archive', archive, '--version', '1.0.0', '--launcher', stubPath, ...extra], { encoding: 'utf8' });
  let run = adopt(join(root, 'install'));
  assert.equal(run.status, 0, run.stderr);
  const placed = await readFile(join(root, 'install', 'chausar-launcher.cmd'), 'latin1');
  assert.equal(placed, text);
  run = adopt(join(root, 'install-preview'), ['--executable-name', 'Chausar-Preview.exe']);
  assert.equal(run.status, 0, run.stderr);
  const renamed = await readFile(join(root, 'install-preview', 'chausar-launcher.cmd'), 'latin1');
  assert.equal(renamed, text.replace('set "name=Chausar.exe"', 'set "name=Chausar-Preview.exe"'));
  // A stub that is not the expected CRLF batch file is refused.
  const lf = join(root, 'lf-launcher.cmd'); await writeFile(lf, text.replace(/\r\n/g, '\n'));
  run = spawnSync(process.execPath, [resolverModule, 'adopt', '--install-root', join(root, 'install-lf'), '--archive', archive, '--version', '1.0.0', '--launcher', lf], { encoding: 'utf8' });
  assert.equal(run.status, 70); assert.match(run.stderr, /LAUNCH_STUB_INVALID/);
});

const wineNode = process.env.CHAUSAR_TEST_WINE_NODE?.trim() || '';
const wine = wineNode !== '' && process.platform === 'linux' && spawnSync('wine', ['--version'], { encoding: 'utf8' }).status === 0;
const windowsPath = (path: string) => `Z:${path.replace(/\//g, '\\')}`;

test('cmd launcher under Wine: trial launches, automatic rollback, exit codes and hostile names', {
  skip: !wine ? 'set CHAUSAR_TEST_WINE_NODE to a Windows node.exe (with wine installed) to run the stub under Wine' : false, timeout: 600_000,
}, async t => {
  assert.ok(isAbsolute(wineNode));
  const base = await mkdtemp(join(await realpath(tmpdir()), 'chausar-launcher-wine-')); t.after(() => rm(base, { recursive: true, force: true }));
  const prefix = process.env.CHAUSAR_TEST_WINE_PREFIX?.trim() || join(base, 'prefix');
  // No "%" or parentheses in this path: Wine 9's cmd drops "%" from %~dp0 and ends a parenthesized block at a
  // quoted ")" (Windows does neither); the static test above covers their quoting.
  const installRoot = join(base, 'Chausar & Co! x'), appData = join(base, 'app data'), log = join(base, 'launches.log');
  await mkdir(join(installRoot, 'versions'), { recursive: true }); await mkdir(appData); await writeFile(log, '');
  const fakeApp = join(base, 'fake-app.mjs');
  await writeFile(fakeApp, [
    `import { appendFileSync } from 'node:fs';`,
    `appendFileSync(process.env.FAKE_LAUNCH_LOG, JSON.stringify({ exe: process.execPath, root: process.env.CHAUSAR_INSTALL_ROOT ?? null,`,
    `  nodeMode: process.env.ELECTRON_RUN_AS_NODE ?? null, args: process.argv.slice(2) }) + '\\n');`,
    `process.exitCode = 7;`, ''].join('\n'));
  const version = async (name: string, resolver: 'real' | 'broken') => {
    const top = join(installRoot, 'versions', name, `Chausar-${name}-win-x64`), native = join(top, 'resources', 'app.asar.unpacked', 'platform', 'runtime', 'native');
    await mkdir(native, { recursive: true });
    await writeFile(join(top, 'resources', 'app.asar.unpacked', 'package.json'), '{"type":"module"}\n');
    await writeFile(join(native, 'update-launch.ts'), resolver === 'real'
      ? `import { main } from ${JSON.stringify(`file:///Z:${encodeURI(resolverModule)}`)};\nprocess.exitCode = await main(process.argv.slice(2));\n`
      : `process.stderr.write('broken resolver\\n'); process.exitCode = 9;\n`);
    await copyFile(wineNode, join(top, 'Chausar.exe'));
  };
  await version('1.0.0', 'real'); await version('2.0.0', 'broken');
  await writeFile(join(installRoot, 'app-data.json'), JSON.stringify({ appDataDirectory: windowsPath(appData) }));
  const pointer = (value: Record<string, unknown>) => writeFile(join(installRoot, 'current.json'), JSON.stringify(value));
  await pointer({ version: '2.0.0', previous: '1.0.0', state: 'trial', attempts: 0, swappedAt: new Date().toISOString() });
  await copyFile(stubPath, join(installRoot, 'chausar-launcher.cmd'));
  const launch = (env: Record<string, string> = {}) => {
    const result = spawnSync('wine', [windowsPath(join(installRoot, 'chausar-launcher.cmd')), windowsPath(fakeApp), '--synthetic-flag'],
      { encoding: 'utf8', timeout: 180_000, env: { ...process.env, WINEPREFIX: prefix, WINEDEBUG: '-all', FAKE_LAUNCH_LOG: windowsPath(log), ...env } });
    return { status: result.status, stderr: result.stderr };
  };
  const launches = async () => (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const current = async () => JSON.parse(await readFile(join(installRoot, 'current.json'), 'utf8'));

  // On trial: the previous version's copy resolves (the new build's resolver is broken), the new version starts.
  let run = launch();
  assert.equal(run.status, 7, run.stderr);
  let last = (await launches()).at(-1);
  assert.match(last.exe, /\\versions\\2\.0\.0\\Chausar-2\.0\.0-win-x64\\Chausar\.exe$/i);
  assert.equal(last.root, windowsPath(installRoot));
  assert.equal(last.nodeMode, null);
  assert.deepEqual(last.args, ['--synthetic-flag']);
  assert.equal((await current()).attempts, 1);
  run = launch(); assert.equal(run.status, 7, run.stderr);
  assert.equal((await current()).attempts, 2);
  // Third unconfirmed launch: the resolver returns to 1.0.0 and the stub says so.
  run = launch(); assert.equal(run.status, 7, run.stderr);
  assert.match(run.stderr, /version 2\.0\.0 did not confirm a clean start twice; returned to 1\.0\.0\./);
  last = (await launches()).at(-1);
  assert.match(last.exe, /\\versions\\1\.0\.0\\/i);
  assert.deepEqual({ version: (await current()).version, state: (await current()).state }, { version: '1.0.0', state: 'committed' });
  const count = (await launches()).length;
  // Hostile executable names never run anything and refuse with 64.
  for (const name of ['..\\evil.exe', 'x" & echo INJECTED & "', 'a&b.exe', '%PATH%', 'bang!.exe', '.hidden.exe']) {
    run = launch({ CHAUSAR_EXECUTABLE_NAME: name });
    assert.equal(run.status, 64, `${name}: ${run.stderr}`);
    assert.match(run.stderr, /LAUNCH_EXECUTABLE_INVALID/);
    assert.doesNotMatch(run.stderr, /INJECTED/);
  }
  assert.equal((await launches()).length, count);
  // No copy can resolve: 70. No install: 66.
  await pointer({ version: '2.0.0', previous: null, state: 'committed', attempts: 0, swappedAt: new Date().toISOString() });
  run = launch(); assert.equal(run.status, 70); assert.match(run.stderr, /LAUNCH_UNRESOLVED/);
  await rm(join(installRoot, 'current.json'));
  run = launch(); assert.equal(run.status, 66); assert.match(run.stderr, /LAUNCH_NOT_INSTALLED/);
  assert.equal((await launches()).length, count);
});
