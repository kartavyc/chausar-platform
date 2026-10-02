import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Installed vendor programs are read-only. This runner never installs packages,
// writes their directory, registers a service or changes host configuration.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACE = resolve('C:/Users/karta/Documents/Codex/2026-10-01/task-4');
const OWNED = resolve(process.env.CHAUSAR_NATIVE_C_STAGING ?? join(WORKSPACE, 'qualification-joined-20261002'));
const BIN = resolve(process.env.CHAUSAR_NATIVE_POSTGRES_BIN ?? 'D:/Chausar/build-tools/qualification/postgresql-18.6-4/pgsql/bin');
assert.equal(process.platform, 'win32');
const ownSuffix = relative(WORKSPACE, OWNED);
assert(ownSuffix && !isAbsolute(ownSuffix) && ownSuffix !== '..' && !ownSuffix.startsWith('..' + sep));
assert.equal(realpathSync(WORKSPACE).toLowerCase(), WORKSPACE.toLowerCase());
assert(!lstatSync(WORKSPACE).isSymbolicLink());
// Validate each existing parent before creating its next child. Recursive
// mkdir followed by validation could already have written through a junction.
let parent = WORKSPACE;
for (const segment of ownSuffix.split(sep)) {
  const next = join(parent, segment);
  if (!existsSync(next)) mkdirSync(next);
  assert(lstatSync(next).isDirectory() && !lstatSync(next).isSymbolicLink());
  assert.equal(realpathSync(next).toLowerCase(), next.toLowerCase());
  parent = next;
}
const gateScripts = (process.env.CHAUSAR_NATIVE_GATES ?? 'verify-database-differential.mjs').split(',');
const allowedScripts = new Set(['verify-database-differential.mjs', 'verify-compiled-measures-c-native.mjs', 'verify-investigations-c-native.mjs', 'verify-workflows-native.mjs', 'verify-answer-recovery-native.mjs', 'verify-pglite-c-native.mjs']);
assert(gateScripts.length > 0 && new Set(gateScripts).size === gateScripts.length && gateScripts.every(name => allowedScripts.has(name)));
const archiveHash = '1df55002afe95b945d934c078b13e82c1603fa546731e511d068aa983b4ead28';
const expectedBinaryHashes = {
  'postgres.exe': '14817df435104dcfe05ad8343fda200930abf778553ab60154bd285aea6833e1',
  'initdb.exe': 'e2b30e9d223f05ca0dc1219798d805bbdb8ab4bd29ab59c70956bf7f41219e57',
  'pg_ctl.exe': '3cdb444b7067d824d8c6b2626aaf8688163ef0b001734c1a8a6502cdccde23bb',
  'psql.exe': 'b22d9ac21c30ea131e91c0dcb1e3850383adf1422848ed4233ee07addca50132',
};
const verifyReadOnlyBinaries = () => {
  for (const [file, digest] of Object.entries(expectedBinaryHashes)) {
    assert.equal(createHash('sha256').update(readFileSync(join(BIN, file))).digest('hex'), digest, file);
  }
};
verifyReadOnlyBinaries();
const runRoot = join(OWNED, `synthetic-${Date.now()}-${process.pid}`);
mkdirSync(runRoot); // Refuse any existing run path before the first file write.
assert.equal(realpathSync(runRoot).toLowerCase(), resolve(runRoot).toLowerCase());
assert(lstatSync(runRoot).isDirectory() && !lstatSync(runRoot).isSymbolicLink());
const data = join(runRoot, 'data');
const serverLog = join(runRoot, 'postgres.log');
const baseline = '1dc19b856380951aea49b7143ed4b5617130c06b';
// Git ownership remains enforced. This manifest was captured with read-only Git
// under the checkout owner, before crossing the process-approval boundary.
const sourceManifestBytes = readFileSync(join(ROOT, 'scripts/native-source-1dc19b8.json'));
const sourceManifest = JSON.parse(sourceManifestBytes);
assert.equal(sourceManifest.commit, baseline);
assert.equal(sourceManifest.tree, '68b396560c2b7950ccaf9d8c38ee52d87bd60d65');
const verifySources = () => {
  for (const entry of sourceManifest.files) {
    assert(typeof entry.path === 'string' && /^(?:platform\/|scripts\/verify-database-differential\.mjs$)/.test(entry.path) && !entry.path.split('/').includes('..'));
    assert.equal(createHash('sha256').update(readFileSync(join(ROOT, entry.path))).digest('hex'), entry.sha256, entry.path);
  }
};
assert.equal(sourceManifest.files.length, 438);
verifySources();
const lifecycle = { scope: 'C-only synthetic loopback portable PostgreSQL; D runtimes read-only; no service', sourceCommit: baseline, sourceTree: sourceManifest.tree, sourceVerification: 'Read-only Git capture under checkout owner; all captured baseline platform files checked before/after execution. Added runners are hashed separately.', sourceManifestSha256: createHash('sha256').update(sourceManifestBytes).digest('hex'), sourceFilesChecked: sourceManifest.files.length, archiveSha256: archiveHash, archiveVerification: 'Retained prior authorized official-download verification; archive is not reread in this run.', binaryHashes: expectedBinaryHashes, runRoot, serverStarted: false, serverStopped: false, defaultEngineSelected: false, gates: [] };
const lifecycleFile = join(runRoot, 'lifecycle.json');
const save = () => writeFileSync(lifecycleFile, JSON.stringify(lifecycle, null, 2) + '\n');
save();
const fixtureUser = 'chausar_fixture';
const fixturePassword = 'Public-synthetic-fixture-only-2026';
const passwordFile = join(runRoot, 'synthetic-password.txt');
writeFileSync(passwordFile, fixturePassword + '\n');
const tmp = join(runRoot, 'temp'); mkdirSync(tmp);
const processEnvironment = { ...process.env, TEMP: tmp, TMP: tmp };
delete processEnvironment.NODE_COMPILE_CACHE;
delete processEnvironment.NODE_OPTIONS;
delete processEnvironment.NODE_PATH;
assert.equal(typeof process.env.SystemRoot, 'string');
const TREE_KILLER = join(process.env.SystemRoot, 'System32/taskkill.exe');
const run = (program, args, ceilingMs, env = processEnvironment, fileOutput = false) => new Promise((fulfill, reject) => {
  let stdoutFile, stderrFile, stdoutFd, stderrFd;
  if (fileOutput) {
    stdoutFile = join(runRoot, 'pg_ctl-start.stdout.log'); stderrFile = join(runRoot, 'pg_ctl-start.stderr.log');
    stdoutFd = openSync(stdoutFile, 'wx'); stderrFd = openSync(stderrFile, 'wx');
  }
  let child;
  try { child = spawn(program, args, { cwd: runRoot, env, windowsHide: true, shell: false, stdio: fileOutput ? ['ignore', stdoutFd, stderrFd] : ['ignore', 'pipe', 'pipe'] }); }
  finally { if (stdoutFd !== undefined) closeSync(stdoutFd); if (stderrFd !== undefined) closeSync(stderrFd); }
  let output = '', error = '', timedOut = false, outputExceeded = false, settled = false, termination;
  let terminationTimer, killer, killerTimer, killerCompletion;
  const finish = (cause, result) => {
    if (settled) return; settled = true; clearTimeout(timer); clearTimeout(terminationTimer);
    const publish = () => {
      if (result && termination?.attempted) { result.termination = { ...termination }; result.treeTerminationConfirmed = termination.code === 0 && !termination.timedOut && !termination.error; }
      cause ? reject(cause) : fulfill(result);
    };
    // Killer completion has its own deadline even after the main child closes.
    if (killerCompletion) killerCompletion.then(publish); else publish();
  };
  const terminateOwnedTree = () => {
    if (!terminationTimer) terminationTimer = setTimeout(() => {
      child.stdout?.destroy(); child.stderr?.destroy(); child.unref();
      if (killer) { killer.stdout.destroy(); killer.stderr.destroy(); killer.unref(); }
      finish(undefined, { code: null, signal: null, timedOut, outputExceeded, output, error, termination, closeNotObserved: true, treeTerminationConfirmed: false });
    }, 10000);
    if (termination) return;
    if (child.exitCode !== null || child.signalCode !== null) { termination = { attempted: false, immediateChildExited: true, descendantCleanupUnconfirmed: true }; return; }
    // Only this directly spawned child's tree is targeted; no global process scan.
    killer = spawn(TREE_KILLER, ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    termination = { attempted: true }; let detail = '';
    let completeKiller;
    killerCompletion = new Promise(done => { completeKiller = done; });
    killerTimer = setTimeout(() => {
      termination.timedOut = true;
      killer.kill(); killer.stdout.destroy(); killer.stderr.destroy(); killer.unref();
      completeKiller();
    }, 10000);
    killer.stdout.on('data', bytes => { detail = (detail + bytes).slice(0, 2000); });
    killer.stderr.on('data', bytes => { detail = (detail + bytes).slice(0, 2000); });
    killer.on('error', cause => { termination.error = String(cause.message); clearTimeout(killerTimer); completeKiller(); });
    killer.on('close', code => { termination.code = code; termination.detail = detail; clearTimeout(killerTimer); completeKiller(); });
  };
  const timer = setTimeout(() => { timedOut = true; terminateOwnedTree(); }, ceilingMs);
  const capture = (isError, bytes) => {
    if (isError) error += bytes; else output += bytes;
    if (output.length > 2_000_000 || error.length > 2_000_000) {
      output = output.slice(0, 2_000_000); error = error.slice(0, 2_000_000); outputExceeded = true;
      terminateOwnedTree();
    }
  };
  child.stdout?.on('data', bytes => capture(false, bytes));
  child.stderr?.on('data', bytes => capture(true, bytes));
  child.on('error', cause => finish(cause));
  child.on('close', (code, signal) => {
    if (fileOutput) {
      try {
        for (const path of [stdoutFile, stderrFile]) assert(statSync(path).size < 2_000_000, 'Startup log exceeded output bound.');
        output = readFileSync(stdoutFile, 'utf8'); error = readFileSync(stderrFile, 'utf8');
      } catch (cause) { finish(cause); return; }
    }
    finish(undefined, { code, signal, timedOut, outputExceeded, output, error, termination });
  });
});
const checked = async (program, args, ceilingMs, fileOutput = false) => {
  const result = await run(program, args, ceilingMs, processEnvironment, fileOutput);
  assert.equal(result.timedOut, false, 'Fixture tool exceeded its process ceiling.');
  assert.equal(result.outputExceeded, false, 'Fixture tool exceeded its output bound.');
  assert.notEqual(result.closeNotObserved, true, 'Fixture tool closure was not confirmed.');
  assert.equal(result.code, 0, result.error || result.output);
  return result;
};
const port = await new Promise((fulfill, reject) => {
  const probe = createServer(); probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => { const selected = probe.address().port; probe.close(error => error ? reject(error) : fulfill(selected)); });
});
assert(port >= 1024 && port <= 65535);
lifecycle.loopback = '127.0.0.1'; lifecycle.port = port; save();
let pool;
try {
  const version = await checked(join(BIN, 'postgres.exe'), ['--version'], 10000);
  assert.match(version.output, /PostgreSQL\) 18\.6\b/);
  lifecycle.binaryVersion = version.output.trim(); save();
  const initialized = await checked(join(BIN, 'initdb.exe'), ['-D', data, '--username=' + fixtureUser, '--pwfile=' + passwordFile, '--auth=scram-sha-256', '--encoding=UTF8', '--no-locale'], 30000);
  writeFileSync(join(runRoot, 'initdb.log'), initialized.output + initialized.error);
  const options = `-h 127.0.0.1 -p ${port} -c max_connections=10 -c shared_buffers=16MB -c logging_collector=off -c statement_timeout=15000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=15000`;
  lifecycle.serverStartAttempted = true; save();
  // File handles avoid descendant-held pipe handles delaying close on Windows.
  const started = await checked(join(BIN, 'pg_ctl.exe'), ['-D', data, '-l', serverLog, '-w', '-t', '20', '-o', options, 'start'], 25000, true);
  lifecycle.serverStarted = true; save();
  writeFileSync(join(runRoot, 'start.log'), started.output + started.error);
  const require = createRequire(join(ROOT, 'package.json'));
  const { Pool } = require('pg');
  pool = new Pool({ host: '127.0.0.1', port, user: fixtureUser, password: fixturePassword, database: 'postgres', ssl: false, max: 1, connectionTimeoutMillis: 3000, query_timeout: 17000, options: '-c statement_timeout=15000 -c lock_timeout=5000' });
  const identity = await pool.query("SELECT version() AS version, current_setting('listen_addresses') AS listen_addresses, current_setting('port') AS port");
  assert.equal(identity.rows[0].listen_addresses, '127.0.0.1'); assert.equal(Number(identity.rows[0].port), port);
  lifecycle.serverIdentity = identity.rows[0]; save();
  const environment = { ...processEnvironment, CHAUSAR_SOURCE_COMMIT: lifecycle.sourceCommit, CHAUSAR_QUALIFICATION_RUN_ROOT: runRoot, CHAUSAR_TEST_DATABASE_DISPOSABLE: '1', CHAUSAR_TEST_DATABASE_URL: `postgresql://${fixtureUser}:${encodeURIComponent(fixturePassword)}@127.0.0.1:${port}/chausar_test` };
  for (const script of gateScripts) {
    // Only this supervisor's private server and dedicated synthetic DB are used.
    await pool.query('DROP DATABASE IF EXISTS chausar_test WITH (FORCE)');
    await pool.query('CREATE DATABASE chausar_test');
    const source = join(ROOT, 'scripts', script);
    const scriptSha256 = createHash('sha256').update(readFileSync(source)).digest('hex');
    const startedAtUtc = new Date().toISOString();
    const gate = await run(process.execPath, [source], 240000, environment);
    const label = script.replace(/\.mjs$/, '');
    writeFileSync(join(runRoot, label + '.stderr.log'), gate.error);
    writeFileSync(join(runRoot, label + '.stdout.json'), gate.output);
    const result = { script, scriptSha256, startedAtUtc, completedAtUtc: new Date().toISOString(), scriptSha256After: createHash('sha256').update(readFileSync(source)).digest('hex'), exitCode: gate.code, timedOut: gate.timedOut, outputExceeded: gate.outputExceeded, signal: gate.signal, termination: gate.termination, closeNotObserved: gate.closeNotObserved };
    lifecycle.gates.push(result); save();
    assert.equal(gate.timedOut, false, 'Native functional gate exceeded its 240-second external ceiling.');
    assert.equal(gate.outputExceeded, false, 'Native functional gate exceeded its output bound.');
    assert.equal(result.scriptSha256After, scriptSha256, 'The executing fixture script changed during the gate.');
    assert.notEqual(gate.closeNotObserved, true, 'Native functional gate closure was not confirmed.');
    const report = JSON.parse(gate.output);
    writeFileSync(join(runRoot, label + '.report.json'), JSON.stringify(report, null, 2) + '\n');
    result.qualification = { passed: report.passed, checks: report.checks.length, failedChecks: report.checks.filter(check => !check.passed), engines: report.engines, blockers: report.blockers };
    assert.equal(gate.code, report.passed ? 0 : 1); save();
    if (!report.passed) process.exitCode = 1;
  }
} catch (error) {
  lifecycle.failure = { name: error.name, code: error.code ?? 'PORTABLE_QUALIFICATION_FAILED', message: String(error.message).slice(0, 1800) };
  process.exitCode = 1;
} finally {
  try { await pool?.end(); } catch (error) { lifecycle.poolCloseError = String(error.message); process.exitCode = 1; }
  if (lifecycle.serverStartAttempted) {
    try {
      const stopped = await run(join(BIN, 'pg_ctl.exe'), ['-D', data, '-w', '-t', '20', '-m', 'fast', 'stop'], 25000);
      writeFileSync(join(runRoot, 'stop.log'), stopped.output + stopped.error);
      lifecycle.stop = { code: stopped.code, timedOut: stopped.timedOut, outputExceeded: stopped.outputExceeded, closeNotObserved: stopped.closeNotObserved, termination: stopped.termination };
      lifecycle.serverStopped = stopped.code === 0 && !stopped.timedOut;
      if (!lifecycle.serverStopped || stopped.outputExceeded || stopped.closeNotObserved) process.exitCode = 1;
    } catch (error) { lifecycle.stopError = String(error.message); process.exitCode = 1; }
  }
  const totalBytes = path => readdirSync(path, { withFileTypes: true }).reduce((total, entry) => {
    assert(!entry.isSymbolicLink(), 'Staging measurement refuses reparse/symbolic paths.');
    const target = join(path, entry.name); assert(resolve(target).startsWith(resolve(OWNED)));
    return total + (entry.isDirectory() ? totalBytes(target) : statSync(target).size);
  }, 0);
  try { lifecycle.ownedCFixtureBytes = totalBytes(runRoot); assert(lifecycle.ownedCFixtureBytes < 1_000_000_000); verifyReadOnlyBinaries(); lifecycle.binaryHashesAfterMatch = true; verifySources(); lifecycle.sourceHashesAfterMatch = true; }
  catch (error) { lifecycle.measurementError = String(error.message); process.exitCode = 1; }
  lifecycle.completedAtUtc = new Date().toISOString(); save();
  console.log(JSON.stringify(lifecycle, null, 2));
}
