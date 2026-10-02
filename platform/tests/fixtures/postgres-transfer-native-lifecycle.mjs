import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {closeSync, openSync} from 'node:fs';
import {lstat, mkdir, readFile, realpath, unlink, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createServer} from 'node:net';
import {dirname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {createOwnedScratchCensus} from './postgres-transfer-native-census.mjs';

// No top-level filesystem/native action. start() is invoked only by the pinned,
// explicitly executed supervisor AFTER actual constructor preflight succeeds.
const BIN = 'D:/Chausar/build-tools/qualification/postgresql-18.6-4/pgsql/bin';
const hashes = {
  'postgres.exe': '14817df435104dcfe05ad8343fda200930abf778553ab60154bd285aea6833e1',
  'initdb.exe': 'e2b30e9d223f05ca0dc1219798d805bbdb8ab4bd29ab59c70956bf7f41219e57',
  'pg_ctl.exe': '3cdb444b7067d824d8c6b2626aaf8688163ef0b001734c1a8a6502cdccde23bb',
  'psql.exe': 'b22d9ac21c30ea131e91c0dcb1e3850383adf1422848ed4233ee07addca50132'
};
const fail = code => {throw Object.assign(new Error(code), {code});};
const inside = (root, path) => {const rel = relative(root, path); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep);};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const nativeLifecycleContract = 'chausar.postgres-transfer-native-lifecycle.v1';

export function createNativeEnvironment({ownedRunRoot, sourcePin}) {
  const runRoot = resolve(ownedRunRoot);
  const permittedRuns = join(dirname(resolve(sourcePin.sourceRoot)), 'postgres-transfer-acceptance-prep', 'runs');
  if (!isAbsolute(ownedRunRoot) || relative(permittedRuns, runRoot) === '' || !inside(permittedRuns, runRoot) || !/^C:[\\/]/i.test(runRoot)) fail('OWNED_C_NATIVE_RUN_REQUIRED');
  const suffix = randomBytes(6).toString('hex'), user = 'chausar_fixture';
  const password = 'Synthetic native ' + randomBytes(24).toString('hex');
  const data = join(runRoot, 'pg-data'), app = join(runRoot, 'app'), temp = join(runRoot, 'temp');
  const passwordFile = join(runRoot, 'synthetic-initdb-password.txt'), lifecycleFile = join(runRoot, 'native-lifecycle.json');
  const connection = {host: '127.0.0.1', port: 0, user, password, ssl: false};
  const fixtures = Object.fromEntries(['primary', 'prepared'].map(phase => [phase, {
    applicationDirectory: join(app, phase),
    databases: Object.fromEntries(['source','journal','target'].map(role => [role, `chausar_${suffix}_${phase}_${role}`]))
  }]));
  const descriptor = {format: 'chausar.postgres-transfer-native-environment.v1', backend: 'native-postgresql',
    synthetic: true, permanentService: false, existingDependenciesOnly: true,
    dataDirectory: data, applicationDirectory: app, connection, fixtures};
  const state = {format: nativeLifecycleContract, sourceCommit: sourcePin.commit, sourceTree: sourcePin.tree,
    runRoot, binaryHashes: hashes, serverStartAttempted: false, serverStarted: false, stopped: false,
    nativeExecution: 'local-synthetic-only', maxScratchBytes: 536870912, errors: [], censusDiagnostics: [], droppedCensusDiagnostics: 0,
    finalScratchChecked: false, finalScratchBeforeSaveChecked: false, finalScratchAfterSaveChecked: false};
  let started = false, startSettled = false, startup, startAbort, closing, monitor, monitorTask, resourceFailure, passwordOwned = false;
  const helpers = new Map();
  let saving = Promise.resolve(), savedLifecycleBytes = 0;
  const save = () => {
    const text = JSON.stringify(state, null, 2) + '\n';
    const next = saving.then(async () => {await writeFile(lifecycleFile, text); savedLifecycleBytes = Buffer.byteLength(text);});
    saving = next.catch(() => {}); return next;
  };
  const remember = failure => {
    const code = failure?.code ?? 'OWNED_NATIVE_CLEANUP_FAILED';
    if (!state.errors.includes(code)) state.errors.push(code);
  };
  async function bounded(work, milliseconds, code) {
    let timer;
    try {return await Promise.race([work(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(code), {code})), milliseconds);
    })]);} finally {clearTimeout(timer);}
  }
  const assertStarting = signal => {if (signal.aborted || closing) fail('NATIVE_START_ABORTED');};
  const processEnvironment = {...process.env, TEMP: temp, TMP: temp};
  delete processEnvironment.NODE_OPTIONS; delete processEnvironment.NODE_PATH; delete processEnvironment.NODE_COMPILE_CACHE;

  async function command(file, args, milliseconds, {signal, fileOutput = false} = {}) {
    if (!Object.hasOwn(hashes, file)) fail('UNREVIEWED_NATIVE_EXECUTABLE');
    if (signal?.aborted) fail('NATIVE_START_ABORTED');
    let stdoutFd, stderrFd, stdoutPath, stderrPath;
    let child;
    try {
      if (fileOutput) {
        const tag = randomBytes(4).toString('hex');
        stdoutPath = join(runRoot, `helper-${tag}.stdout.log`); stderrPath = join(runRoot, `helper-${tag}.stderr.log`);
        stdoutFd = openSync(stdoutPath, 'wx'); stderrFd = openSync(stderrPath, 'wx');
      }
      child = spawn(join(BIN, file), args, {cwd: runRoot, env: processEnvironment, windowsHide: true, shell: false,
        stdio: fileOutput ? ['ignore', stdoutFd, stderrFd] : ['ignore','pipe','pipe']});
    }
    finally {if (stdoutFd !== undefined) closeSync(stdoutFd); if (stderrFd !== undefined) closeSync(stderrFd);}
    let resolveClosure;
    const record = {child, closed: false, closure: new Promise(resolve => {resolveClosure = resolve;}), terminate: undefined};
    helpers.set(child, record);
    return new Promise((fulfill, reject) => {
      let output = '', error = '', ended = false, refused, killerTimer;
      const finish = (failure, result) => {
        if (ended) return; ended = true; clearTimeout(timer); clearTimeout(killerTimer);
        signal?.removeEventListener('abort', abort);
        failure ? reject(failure) : fulfill(result);
      };
      const terminate = code => {
        if (refused) return; refused = code; child.kill();
        killerTimer = setTimeout(() => {
          const failure = Object.assign(new Error('OWNED_NATIVE_HELPER_CLOSURE_UNVERIFIED'), {code: 'OWNED_NATIVE_HELPER_CLOSURE_UNVERIFIED'});
          remember(failure); child.stdout?.destroy(); child.stderr?.destroy(); child.unref();
          // Keep the handle and closure promise until the actual close event.
          // Unref only bounds this failed driver; it is never closure evidence.
          finish(failure);
        }, 5000);
      };
      record.terminate = terminate;
      const abort = () => terminate('NATIVE_START_ABORTED');
      const timer = setTimeout(() => terminate('OWNED_NATIVE_HELPER_TIMEOUT'), milliseconds);
      signal?.addEventListener('abort', abort, {once: true});
      const capture = (stderr, bytes) => {
        if (stderr) error += bytes; else output += bytes;
        if (Buffer.byteLength(output) + Buffer.byteLength(error) > 1048576) terminate('OWNED_NATIVE_HELPER_OUTPUT_LIMIT');
      };
      child.stdout?.on('data', bytes => capture(false, bytes)); child.stderr?.on('data', bytes => capture(true, bytes));
      child.once('error', () => terminate('OWNED_NATIVE_HELPER_START_FAILED'));
      child.once('close', async code => {
        record.closed = true; helpers.delete(child); resolveClosure();
        try {
          if (fileOutput) {
            assert.ok((await lstat(stdoutPath)).size + (await lstat(stderrPath)).size <= 1048576);
            output = await readFile(stdoutPath, 'utf8'); error = await readFile(stderrPath, 'utf8');
          }
          if (refused) fail(refused);
          finish(undefined, {code, output, error});
        } catch (failure) {finish(failure);}
      });
    });
  }
  async function checked(file, args, ceiling, options) {
    const result = await command(file, args, ceiling, options); if (result.code !== 0) fail('OWNED_NATIVE_HELPER_FAILED'); return result;
  }
  const scratchBytes = createOwnedScratchCensus({runRoot, permittedRuns, maxBytes: state.maxScratchBytes,
    onDiagnostic: event => {if (state.censusDiagnostics.length < 32) state.censusDiagnostics.push(event); else state.droppedCensusDiagnostics++;}});
  async function startOwned(signal) {
    assertStarting(signal);
    if (process.platform !== 'win32' || process.version !== 'v24.13.1') fail('QUALIFIED_NATIVE_NODE_PROFILE_REQUIRED');
    const canonicalRuns = await realpath(permittedRuns), canonicalRoot = await realpath(runRoot);
    if (relative(permittedRuns, canonicalRuns) !== '' || relative(runRoot, canonicalRoot) !== ''
      || !/^C:[\\/]/i.test(canonicalRoot) || !inside(canonicalRuns, canonicalRoot)) fail('OWNED_C_NATIVE_CANONICAL_RUN_REQUIRED');
    for (const path of [permittedRuns, runRoot]) {const stat = await lstat(path); if (!stat.isDirectory() || stat.isSymbolicLink()) fail('OWNED_C_NATIVE_RUN_LINK_REFUSED');}
    await scratchBytes.pin();
    assertStarting(signal);
    for (const [file, expected] of Object.entries(hashes)) {
      const path = join(BIN, file), stat = await lstat(path); assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size < 67108864);
      if (sha(await readFile(path)) !== expected) fail('EXISTING_NATIVE_BINARY_HASH_CHANGED');
      assertStarting(signal);
    }
    await mkdir(temp); assertStarting(signal); await mkdir(app); assertStarting(signal);
    for (const fixture of Object.values(fixtures)) {await mkdir(fixture.applicationDirectory); assertStarting(signal);}
    await writeFile(passwordFile, password + '\n', {flag: 'wx'}); passwordOwned = true;
    assertStarting(signal); await save(); assertStarting(signal);
    const version = await checked('postgres.exe', ['--version'], 5000, {signal}); assert.match(version.output, /PostgreSQL\) 18\.6\b/);
    await checked('initdb.exe', ['-D', data, '--username=' + user, '--pwfile=' + passwordFile,
      '--auth=scram-sha-256', '--encoding=UTF8', '--no-locale'], 30000, {signal});
    await unlink(passwordFile); passwordOwned = false;
    assertStarting(signal);
    connection.port = await new Promise((fulfill, reject) => {
      const probe = createServer(); probe.once('error', reject);
      probe.listen(0, '127.0.0.1', () => {const port = probe.address().port; probe.close(failure => failure ? reject(failure) : fulfill(port));});
    });
    assertStarting(signal); state.serverStartAttempted = true; state.port = connection.port; await save(); assertStarting(signal);
    const options = `-h 127.0.0.1 -p ${connection.port} -c max_connections=20 -c shared_buffers=16MB -c work_mem=1MB -c maintenance_work_mem=16MB -c max_wal_size=64MB -c min_wal_size=32MB -c logging_collector=off -c statement_timeout=10000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=60000`;
    await checked('pg_ctl.exe', ['-D', data, '-l', join(runRoot, 'postgres.log'), '-w', '-t', '20', '-o', options, 'start'], 25000, {signal, fileOutput: true});
    state.serverStarted = true; assertStarting(signal); await save(); assertStarting(signal);
    const {Pool} = createRequire(join(sourcePin.sourceRoot, 'package.json'))('pg');
    const pool = new Pool({...connection, database: 'postgres', max: 1, connectionTimeoutMillis: 5000, query_timeout: 10000});
    try {
      const identity = (await pool.query("SELECT version() AS version,current_setting('listen_addresses') AS host,current_setting('port') AS port")).rows[0];
      assertStarting(signal);
      assert.match(identity.version, /^PostgreSQL 18\.6(?:[,\s(]|$)/); assert.equal(identity.host, '127.0.0.1'); assert.equal(Number(identity.port), connection.port);
      for (const fixture of Object.values(fixtures)) for (const name of Object.values(fixture.databases)) {
        assertStarting(signal);
        assert.match(name, /^chausar_[a-f0-9]{12}_(primary|prepared)_(source|journal|target)$/);
        await pool.query(`CREATE DATABASE "${name}"`);
      }
    } finally {await pool.end();}
    assertStarting(signal);
    state.scratchBytes = await scratchBytes('startup'); assertStarting(signal); await save(); assertStarting(signal);
    monitor = setInterval(() => {
      if (monitorTask || closing) return;
      monitorTask = (async () => {
        try {state.scratchBytes = await scratchBytes('live');}
        catch (failure) {resourceFailure = failure; remember(failure); void close().catch(() => {});}
        finally {monitorTask = undefined;}
      })();
    }, 5000); monitor.unref();
  }
  function start(signal) {
    if (started || closing) fail('NATIVE_LIFECYCLE_SINGLE_USE'); started = true;
    startAbort = new AbortController();
    const abort = () => startAbort.abort();
    signal?.addEventListener('abort', abort, {once: true}); if (signal?.aborted) abort();
    startup = startOwned(startAbort.signal).finally(() => {startSettled = true; signal?.removeEventListener('abort', abort);});
    return startup;
  }
  async function close() {
    if (closing) return closing;
    closing = (async () => {
      clearInterval(monitor);
      startAbort?.abort();
      let cleanupFailure;
      const failed = failure => {cleanupFailure ??= failure; remember(failure);};
      if (startup) {
        try {await bounded(() => startup.then(() => undefined, () => undefined), 20000, 'OWNED_NATIVE_START_SETTLEMENT_UNVERIFIED');}
        catch (failure) {failed(failure);}
      }
      const retained = [...helpers.values()];
      for (const record of retained) if (!record.closed) record.terminate('NATIVE_START_ABORTED');
      try {await bounded(() => Promise.all(retained.map(record => record.closure)), 5000, 'OWNED_NATIVE_HELPER_CLOSURE_UNVERIFIED');}
      catch (failure) {failed(failure);}
      if (monitorTask) {
        try {await bounded(() => monitorTask, 5000, 'OWNED_NATIVE_SCRATCH_INSPECTION_UNSETTLED');}
        catch (failure) {failed(failure);}
      }
      let serverStopped = !state.serverStartAttempted;
      if (state.serverStartAttempted) {
        try {
          const status = await command('pg_ctl.exe', ['-D', data, 'status'], 5000);
          if (status.code === 0) {
            await checked('pg_ctl.exe', ['-D', data, '-m', 'fast', '-w', '-t', '20', 'stop'], 25000, {fileOutput: true});
            serverStopped = (await command('pg_ctl.exe', ['-D', data, 'status'], 5000)).code === 3;
          } else if (status.code === 3) serverStopped = true;
          else fail('OWNED_NATIVE_STOP_STATUS_UNVERIFIED');
        } catch (failure) {failed(failure);}
      }
      if (passwordOwned) {
        try {await unlink(passwordFile); passwordOwned = false;}
        catch (failure) {failed(failure);}
      }
      state.stopped = serverStopped && (!started || startSettled) && helpers.size === 0;
      try {state.scratchBytes = await bounded(() => scratchBytes('final-stopped'), 10000, 'OWNED_NATIVE_FINAL_CENSUS_TIMEOUT'); state.finalScratchBeforeSaveChecked = true;}
      catch (failure) {resourceFailure ??= failure; state.finalScratchChecked = false; failed(failure);}
      try {await bounded(() => save(), 5000, 'OWNED_NATIVE_LIFECYCLE_SAVE_TIMEOUT');}
      catch (failure) {failed(failure);}
      // Include the finalized lifecycle evidence itself in the final cap check.
      const cappedLifecycleBytes = savedLifecycleBytes;
      try {
        await bounded(() => scratchBytes('post-save-stopped'), 10000, 'OWNED_NATIVE_FINAL_CENSUS_TIMEOUT');
        state.finalScratchAfterSaveChecked = true; state.finalScratchChecked = state.finalScratchBeforeSaveChecked;
        if (state.finalScratchChecked && Buffer.byteLength(JSON.stringify(state, null, 2) + '\n') > cappedLifecycleBytes)
          fail('OWNED_NATIVE_FINAL_EVIDENCE_GREW');
      } catch (failure) {resourceFailure ??= failure; state.finalScratchChecked = false; failed(failure);}
      // Persist final success/refusal honestly. If the final evidence save
      // itself fails, stop remains separate evidence and cleanup still refuses.
      try {await bounded(() => save(), 5000, 'OWNED_NATIVE_LIFECYCLE_SAVE_TIMEOUT');}
      catch (failure) {failed(failure);}
      if (!state.stopped) fail('OWNED_NATIVE_STOP_UNVERIFIED');
      if (cleanupFailure) throw cleanupFailure;
      if (resourceFailure) throw resourceFailure;
    })(); return closing;
  }
  async function inspectStopped() {
    if (helpers.size || started && !startSettled) return {stopped: false};
    if (!state.serverStartAttempted) return {stopped: true, serverStarted: false};
    const status = await command('pg_ctl.exe', ['-D', data, 'status'], 5000);
    return {stopped: status.code === 3 && helpers.size === 0 && (!started || startSettled), statusCode: status.code};
  }
  return {descriptor, start, close, inspectStopped};
}
