import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { openOwnedPGliteDirectory, type PGliteQueries } from '../runtime/pglite-directory-owner.ts';

// Admission/lifecycle unit tests only. The database client below is explicitly
// injected: no PGlite import, WASM, PostgreSQL, native SQL, server or subprocess.
// The filesystem is real and C-owned. Keep all fixture directories for review;
// only production ownership release removes its own successfully closed marker.
const QUERY = 'SELECT 1 AS explicitly_injected_fixture';
const EXEC = 'SELECT 2 AS explicitly_injected_fixture';
const options = { skip: process.platform !== 'win32', timeout: 10000 };
const code = (suffix: string) => ({ code: 'PGLITE_DIRECTORY_' + suffix });

function deferred<T = void>() {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  let rejectPromise!: (reason: unknown) => void;
  const promise = new Promise<T>((resolveValue, rejectValue) => {
    resolvePromise = resolveValue; rejectPromise = rejectValue;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'The bounded injected lifecycle checkpoint was not reached.');
    await delay(2);
  }
}
async function exists(path: string) {
  try { await stat(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
async function fixture() {
  const base = await realpath(tmpdir()); assert.match(base, /^C:[\\/]/i);
  const ownedRoot = await realpath(await mkdtemp(join(base, 'chausar-injected-pglite-owner-test-')));
  const directory = join(ownedRoot, 'data'); await mkdir(directory);
  return { ownedRoot, directory, lock: directory + '.chausar-pglite-owner',
    ownerFile: directory + '.chausar-pglite-owner/owner.json' };
}

type QueryResult = { rows: { explicitlyInjected: true }[] };
class InjectedLifecycleClient {
  waitReady: Promise<void> = Promise.resolve();
  closed = false;
  calls = { query: 0, exec: 0, transaction: 0, transactionAccepted: 0, transactionRejected: 0, close: 0 };
  observed: { method: 'query' | 'exec'; sql: string; params?: unknown[] }[] = [];
  queryGate?: Promise<QueryResult>;
  execGate?: Promise<void>;
  closeGate?: Promise<void>;
  closeFailure?: Error;
  closeRejectsUndefined = false;
  queryFailure?: Error;
  queryRejectsUndefined = false;
  execFailure?: Error;
  confirmsClose = true;
  async query(sql: string, params?: unknown[]): Promise<QueryResult> {
    this.calls.query++; this.observed.push({ method: 'query', sql, params });
    if (this.queryRejectsUndefined) throw undefined;
    if (this.queryFailure) throw this.queryFailure;
    return this.queryGate ? await this.queryGate : { rows: [{ explicitlyInjected: true }] };
  }
  async exec(sql: string): Promise<void> {
    this.calls.exec++; this.observed.push({ method: 'exec', sql });
    if (this.execFailure) throw this.execFailure;
    if (this.execGate) await this.execGate;
  }
  async transaction<T>(callback: (tx: PGliteQueries) => Promise<T>): Promise<T> {
    this.calls.transaction++;
    // Deliberately pass a raw client with close/waitReady available internally:
    // the production facade must withhold them from its caller's transaction.
    try {
      const result = await callback(this); this.calls.transactionAccepted++; return result;
    } catch (error) { this.calls.transactionRejected++; throw error; }
  }
  async close(): Promise<void> {
    this.calls.close++;
    if (this.closeGate) await this.closeGate;
    if (this.closeRejectsUndefined) throw undefined;
    if (this.closeFailure) throw this.closeFailure;
    if (this.confirmsClose) this.closed = true;
  }
}
function factory(client = new InjectedLifecycleClient()) {
  const directories: string[] = [];
  return { client, directories, construct: (directory: string) => {
    directories.push(directory); return client;
  } };
}
async function busy(f: Awaited<ReturnType<typeof fixture>>) {
  const contender = factory();
  await assert.rejects(openOwnedPGliteDirectory({ ...f, construct: contender.construct }), code('BUSY'));
  assert.deepEqual(contender.directories, [], 'Refusal must precede the injected constructor.');
}

test('injected independent constructors cannot share a directory while first readiness is pending', options, async () => {
  const f = await fixture(), ready = deferred(), first = factory();
  first.client.waitReady = ready.promise;
  const opening = openOwnedPGliteDirectory({ ...f, construct: first.construct });
  await until(() => first.directories.length === 1);
  assert.equal(await exists(f.ownerFile), true);
  await busy(f);
  ready.resolve(undefined);
  const owner = await opening;
  assert.equal(owner.state, 'open'); assert.equal(owner.directory, await realpath(f.directory));
  await busy(f);
  await owner.close(); assert.equal(owner.state, 'closed'); assert.equal(first.client.calls.close, 1);
});

test('literal lexical and Windows case aliases preserve one canonical directory owner', options, async () => {
  const f = await fixture(), first = factory();
  const owner = await openOwnedPGliteDirectory({ ownedRoot: f.ownedRoot.toUpperCase(),
    directory: f.directory.toUpperCase(), construct: first.construct });
  assert.equal(owner.directory, await realpath(f.directory));
  assert.deepEqual(first.directories, [owner.directory]);
  const contender = factory();
  await assert.rejects(openOwnedPGliteDirectory({ ownedRoot: f.ownedRoot,
    directory: resolve(f.directory, '..', 'data', '.'), construct: contender.construct }), code('BUSY'));
  assert.deepEqual(contender.directories, []);
  await owner.close();
});

test('separate real directories admit independent injected clients and exact method arguments', options, async () => {
  const f = await fixture(), otherDirectory = join(f.ownedRoot, 'other-data'); await mkdir(otherDirectory);
  const first = factory(), second = factory();
  const [one, two] = await Promise.all([
    openOwnedPGliteDirectory({ ...f, construct: first.construct }),
    openOwnedPGliteDirectory({ ownedRoot: f.ownedRoot, directory: otherDirectory, construct: second.construct }),
  ]);
  assert.deepEqual(await one.query(QUERY, ['public-synthetic-parameter']), { rows: [{ explicitlyInjected: true }] });
  await two.exec(EXEC);
  assert.deepEqual(first.client.observed, [{ method: 'query', sql: QUERY, params: ['public-synthetic-parameter'] }]);
  assert.deepEqual(second.client.observed, [{ method: 'exec', sql: EXEC }]);
  await Promise.all([one.close(), two.close()]);
  assert.equal(await exists(f.lock), false); assert.equal(await exists(otherDirectory + '.chausar-pglite-owner'), false);
});

test('pre-aborted startup creates no ownership marker and invokes no injected constructor', options, async () => {
  const f = await fixture(), controller = new AbortController(), injected = factory(); controller.abort();
  await assert.rejects(openOwnedPGliteDirectory({ ...f, construct: injected.construct, signal: controller.signal }), code('ABORTED'));
  assert.deepEqual(injected.directories, []); assert.equal(await exists(f.lock), false);
});

test('invalid bounded deadline arguments refuse before constructor or ownership writes', options, async () => {
  const f = await fixture(), injected = factory();
  for (const limits of [{ startupTimeoutMs: 0 }, { closeTimeoutMs: 0 }, { startupTimeoutMs: Infinity }, { closeTimeoutMs: NaN }]) {
    await assert.rejects(openOwnedPGliteDirectory({ ...f, construct: injected.construct, ...limits }), code('ARGUMENT_INVALID'));
    assert.deepEqual(injected.directories, []); assert.equal(await exists(f.lock), false);
  }
});

test('root itself and a directory outside the declared root refuse before injected construction', options, async () => {
  const f = await fixture(), outside = await fixture(), injected = factory();
  for (const directory of [f.ownedRoot, outside.directory]) {
    await assert.rejects(openOwnedPGliteDirectory({ ownedRoot: f.ownedRoot, directory, construct: injected.construct }), code('PATH_REFUSED'));
  }
  assert.deepEqual(injected.directories, []); assert.equal(await exists(f.lock), false);
});

test('a throwing injected constructor keeps its claimed directory fenced', options, async () => {
  const f = await fixture(); let constructors = 0;
  await assert.rejects(openOwnedPGliteDirectory({ ...f, construct: () => {
    constructors++; throw Error('Explicit injected construction failure.');
  } }), code('INIT_FAILED'));
  assert.equal(constructors, 1); assert.equal(await exists(f.ownerFile), true); await busy(f);
});

test('rejected injected readiness retains ownership rather than implying database disposal', options, async () => {
  const f = await fixture(), ready = deferred(), injected = factory(); injected.client.waitReady = ready.promise;
  const opening = openOwnedPGliteDirectory({ ...f, construct: injected.construct });
  const refused = assert.rejects(opening, code('INIT_FAILED'));
  await until(() => injected.directories.length === 1);
  ready.reject(Error('Explicit injected readiness failure.'));
  await refused; assert.equal(await exists(f.ownerFile), true); await busy(f);
});

test('readiness rejection with undefined is initialization failure and retains its claim', options, async () => {
  const f = await fixture(), ready = deferred(), injected = factory(); injected.client.waitReady = ready.promise;
  const opening = openOwnedPGliteDirectory({ ...f, construct: injected.construct });
  const refused = assert.rejects(opening, code('INIT_FAILED'));
  await until(() => injected.directories.length === 1); ready.reject(undefined);
  await refused; assert.equal(await exists(f.ownerFile), true); await busy(f);
});

test('abort after claim fences the directory before and after late injected readiness', options, async () => {
  const f = await fixture(), ready = deferred(), controller = new AbortController(), injected = factory();
  injected.client.waitReady = ready.promise;
  const opening = openOwnedPGliteDirectory({ ...f, construct: injected.construct, signal: controller.signal });
  const refused = assert.rejects(opening, code('ABORTED'));
  await until(() => injected.directories.length === 1); controller.abort();
  await refused; const bytes = await readFile(f.ownerFile, 'utf8'); await busy(f);
  ready.resolve(undefined); await delay(15);
  assert.equal(await readFile(f.ownerFile, 'utf8'), bytes); await busy(f);
});

test('readiness deadline retains its marker and late readiness never grants a new owner', options, async () => {
  const f = await fixture(), ready = deferred(), injected = factory(); injected.client.waitReady = ready.promise;
  await assert.rejects(openOwnedPGliteDirectory({ ...f, construct: injected.construct, startupTimeoutMs: 30 }), code('INIT_TIMEOUT'));
  assert.equal(injected.directories.length, 1);
  const bytes = await readFile(f.ownerFile, 'utf8'); await busy(f);
  ready.resolve(undefined); await delay(15);
  assert.equal(await readFile(f.ownerFile, 'utf8'), bytes); await busy(f);
});

test('close drains admitted injected query and exec before one awaited client close', options, async () => {
  const f = await fixture(), query = deferred<QueryResult>(), exec = deferred(), closing = deferred(), injected = factory();
  injected.client.queryGate = query.promise; injected.client.execGate = exec.promise; injected.client.closeGate = closing.promise;
  const owner = await openOwnedPGliteDirectory({ ...f, construct: injected.construct });
  const acceptedQuery = owner.query(QUERY), acceptedExec = owner.exec(EXEC);
  await until(() => injected.client.calls.query === 1 && injected.client.calls.exec === 1);
  const closed = owner.close(); assert.equal(owner.close(), closed); assert.equal(owner.state, 'closing');
  await assert.rejects(owner.query(QUERY), code('NOT_OPEN'));
  await assert.rejects(owner.exec(EXEC), code('NOT_OPEN'));
  await assert.rejects(owner.transaction(async () => undefined), code('NOT_OPEN'));
  assert.equal(injected.client.calls.close, 0); await busy(f);
  query.resolve({ rows: [{ explicitlyInjected: true }] }); exec.resolve(undefined);
  await Promise.all([acceptedQuery, acceptedExec]); await until(() => injected.client.calls.close === 1);
  assert.equal(owner.state, 'closing'); assert.equal(await exists(f.ownerFile), true); await busy(f);
  closing.resolve(undefined); await closed;
  assert.equal(owner.state, 'closed'); assert.equal(injected.client.closed, true); assert.equal(injected.client.calls.close, 1);
  assert.equal(await exists(f.lock), false);
});

test('successful cached close and independent reopen preserve data and never release the successor', options, async () => {
  const f = await fixture(), first = factory(), sentinel = join(f.directory, 'public-synthetic-data-sentinel.txt');
  await writeFile(sentinel, 'Public synthetic persistence sentinel; not database SQL.\n', { flag: 'wx' });
  const originalBytes = await readFile(sentinel);
  const owner = await openOwnedPGliteDirectory({ ...f, construct: first.construct });
  const closing = owner.close(); assert.equal(owner.close(), closing); await closing;
  assert.equal(await exists(f.lock), false); assert.deepEqual(await readFile(sentinel), originalBytes);
  const second = factory(), successor = await openOwnedPGliteDirectory({ ...f, construct: second.construct });
  const successorProof = await readFile(f.ownerFile, 'utf8');
  assert.equal(owner.close(), closing); await owner.close();
  assert.equal(await readFile(f.ownerFile, 'utf8'), successorProof); assert.equal(successor.state, 'open');
  assert.equal(first.client.calls.close, 1); assert.deepEqual(await readFile(sentinel), originalBytes);
  await successor.close(); assert.equal(second.client.calls.close, 1); assert.equal(await exists(f.lock), false);
});

test('close timeout is permanently quarantined even after late injected close confirmation', options, async () => {
  const f = await fixture(), closing = deferred(), injected = factory(); injected.client.closeGate = closing.promise;
  const owner = await openOwnedPGliteDirectory({ ...f, construct: injected.construct, closeTimeoutMs: 30 });
  const closed = owner.close(), refused = assert.rejects(closed, code('CLOSE_TIMEOUT'));
  assert.equal(owner.close(), closed); await refused;
  assert.equal(owner.state, 'quarantined'); assert.equal(injected.client.calls.close, 1);
  const bytes = await readFile(f.ownerFile, 'utf8'); await busy(f);
  closing.resolve(undefined); await until(() => injected.client.closed);
  assert.equal(owner.state, 'quarantined'); assert.equal(await readFile(f.ownerFile, 'utf8'), bytes);
  assert.equal(owner.close(), closed); await assert.rejects(owner.close(), code('CLOSE_TIMEOUT')); await busy(f);
  await assert.rejects(owner.query(QUERY), code('NOT_OPEN'));
});

test('drain timeout keeps ownership fenced after an admitted injected query settles late', options, async () => {
  const f = await fixture(), query = deferred<QueryResult>(), injected = factory(); injected.client.queryGate = query.promise;
  const owner = await openOwnedPGliteDirectory({ ...f, construct: injected.construct, closeTimeoutMs: 30 });
  const accepted = owner.query(QUERY); await until(() => injected.client.calls.query === 1);
  await assert.rejects(owner.close(), code('CLOSE_TIMEOUT')); assert.equal(owner.state, 'quarantined');
  const bytes = await readFile(f.ownerFile, 'utf8'); assert.equal(injected.client.calls.close, 0); await busy(f);
  query.resolve({ rows: [{ explicitlyInjected: true }] }); await accepted; await delay(15);
  assert.equal(owner.state, 'quarantined'); assert.equal(await readFile(f.ownerFile, 'utf8'), bytes); await busy(f);
});

test('rejected client close is quarantined and its cached failure cannot release ownership', options, async () => {
  const f = await fixture(), injected = factory(); injected.client.closeFailure = Error('Explicit injected close failure.');
  const owner = await openOwnedPGliteDirectory({ ...f, construct: injected.construct });
  const closed = owner.close(); await assert.rejects(closed, code('CLOSE_FAILED'));
  assert.equal(owner.state, 'quarantined'); assert.equal(owner.close(), closed); assert.equal(injected.client.calls.close, 1);
  assert.equal(await exists(f.ownerFile), true); await busy(f);
});

test('client close rejection with undefined is close failure and never releases its claim', options, async () => {
  const f = await fixture(), injected = factory(); injected.client.closeRejectsUndefined = true;
  const owner = await openOwnedPGliteDirectory({ ...f, construct: injected.construct });
  const closed = owner.close(); await assert.rejects(closed, code('CLOSE_FAILED'));
  assert.equal(owner.state, 'quarantined'); assert.equal(owner.close(), closed);
  assert.equal(injected.client.closed, false); assert.equal(injected.client.calls.close, 1);
  assert.equal(await exists(f.ownerFile), true); await busy(f);
});

test('resolved but unconfirmed injected close refuses release', options, async () => {
  const f = await fixture(), injected = factory(); injected.client.confirmsClose = false;
  const owner = await openOwnedPGliteDirectory({ ...f, construct: injected.construct });
  await assert.rejects(owner.close(), code('CLOSE_UNCONFIRMED'));
  assert.equal(owner.state, 'quarantined'); assert.equal(injected.client.closed, false); assert.equal(injected.client.calls.close, 1);
  assert.equal(await exists(f.ownerFile), true); await busy(f);
});

test('semantically extended ownership JSON refuses exact-proof release after confirmed close', options, async () => {
  const f = await fixture(), injected = factory(), owner = await openOwnedPGliteDirectory({ ...f, construct: injected.construct });
  const original = JSON.parse(await readFile(f.ownerFile, 'utf8'));
  await writeFile(f.ownerFile, JSON.stringify({ ...original, explicitlyInjectedReplacement: true }));
  const replacement = await readFile(f.ownerFile, 'utf8');
  await assert.rejects(owner.close(), code('OWNER_CHANGED'));
  assert.equal(owner.state, 'quarantined'); assert.equal(injected.client.closed, true);
  assert.equal(injected.client.calls.close, 1);
  assert.equal(await readFile(f.ownerFile, 'utf8'), replacement); await busy(f);
});

test('old owner close cannot remove a replacement marker inode even with identical bytes', options, async () => {
  const f = await fixture(), injected = factory(), owner = await openOwnedPGliteDirectory({ ...f, construct: injected.construct });
  const replacement = await readFile(f.ownerFile, 'utf8');
  await rename(f.ownerFile, join(f.ownedRoot, 'retained-original-owner.json'));
  await writeFile(f.ownerFile, replacement, { flag: 'wx' });
  await assert.rejects(owner.close(), code('OWNER_CHANGED'));
  assert.equal(owner.state, 'quarantined'); assert.equal(injected.client.calls.close, 1);
  assert.equal(await readFile(f.ownerFile, 'utf8'), replacement); await busy(f);
});

test('extra ownership-directory contents refuse nonrecursive release and remain untouched', options, async () => {
  const f = await fixture(), injected = factory(), owner = await openOwnedPGliteDirectory({ ...f, construct: injected.construct });
  const unexpected = join(f.lock, 'public-synthetic-unexpected-entry.txt');
  await writeFile(unexpected, 'Do not recursively remove this injected ownership conflict.\n', { flag: 'wx' });
  const proof = await readFile(f.ownerFile, 'utf8');
  await assert.rejects(owner.close(), code('OWNER_CHANGED'));
  assert.equal(owner.state, 'quarantined'); assert.equal(await readFile(f.ownerFile, 'utf8'), proof);
  assert.equal(await readFile(unexpected, 'utf8'), 'Do not recursively remove this injected ownership conflict.\n'); await busy(f);
});

test('abandoned malformed marker is refused without age or PID takeover and without construction', options, async () => {
  const f = await fixture(); await mkdir(f.lock);
  const abandoned = '{"pid":-1,"createdAt":"1900-01-01T00:00:00.000Z","malformed":true}\n';
  await writeFile(f.ownerFile, abandoned, { flag: 'wx' }); await busy(f);
  assert.equal(await readFile(f.ownerFile, 'utf8'), abandoned);
});

test('admitted transaction drains through closing with no raw client or escaped authority', options, async () => {
  const f = await fixture(), entered = deferred(), finish = deferred(), injected = factory();
  const owner = await openOwnedPGliteDirectory({ ...f, construct: injected.construct });
  let escaped: { query(sql: string, params?: unknown[]): Promise<unknown>; exec(sql: string): Promise<unknown> } | undefined;
  const accepted = owner.transaction(async tx => {
    assert.equal('close' in tx, false); assert.equal('closed' in tx, false); assert.equal('waitReady' in tx, false);
    escaped = tx; entered.resolve(undefined); await finish.promise;
    await tx.query(QUERY, ['admitted-before-close']); await tx.exec(EXEC);
    return 'explicitly-injected-transaction-result';
  });
  await entered.promise;
  const closed = owner.close(); assert.equal(owner.state, 'closing'); assert.equal(injected.client.calls.close, 0);
  await assert.rejects(owner.transaction(async () => undefined), code('NOT_OPEN'));
  await busy(f); finish.resolve(undefined);
  assert.equal(await accepted, 'explicitly-injected-transaction-result'); await closed;
  assert.equal(injected.client.calls.close, 1); assert.equal(owner.state, 'closed');
  assert.ok(escaped); await assert.rejects(escaped.query(QUERY), code('NOT_OPEN'));
  assert.equal(injected.client.calls.query, 1); assert.equal(injected.client.calls.exec, 1);
});

test('detached fast child-query rejection including undefined cannot acknowledge an injected transaction', options, async () => {
  const f = await fixture(), injected = factory(); injected.client.queryRejectsUndefined = true;
  const owner = await openOwnedPGliteDirectory({ ...f, construct: injected.construct });
  const outcome = await owner.transaction(async tx => {
    void tx.query(QUERY); // Explicitly detached: production must retain the rejected child result.
    await delay(5); return 'must-never-be-acknowledged';
  }).then(value => ({ status: 'fulfilled' as const, value }), reason => ({ status: 'rejected' as const, reason }));
  assert.equal(outcome.status, 'rejected');
  if (outcome.status === 'rejected') assert.equal(outcome.reason, undefined);
  assert.equal(injected.client.calls.transactionAccepted, 0); assert.equal(injected.client.calls.transactionRejected, 1);
  assert.equal(owner.state, 'open'); await owner.close();
});

test('caught child query or exec failures still reject the injected driver callback without savepoint support', options, async () => {
  for (const method of ['query', 'exec'] as const) {
    const f = await fixture(), injected = factory(), failure = Error('Explicit injected child ' + method + ' failure.');
    if (method === 'query') injected.client.queryFailure = failure; else injected.client.execFailure = failure;
    const owner = await openOwnedPGliteDirectory({ ...f, construct: injected.construct });
    const outcome = await owner.transaction(async tx => {
      try { if (method === 'query') await tx.query(QUERY); else await tx.exec(EXEC); }
      catch { /* A caught error cannot grant the unsupported savepoint/recovery profile. */ }
      return 'must-never-be-acknowledged';
    }).then(value => ({ status: 'fulfilled' as const, value }), reason => ({ status: 'rejected' as const, reason }));
    assert.equal(outcome.status, 'rejected');
    if (outcome.status === 'rejected') assert.equal(outcome.reason, failure);
    assert.equal(injected.client.calls.transactionAccepted, 0); assert.equal(injected.client.calls.transactionRejected, 1);
    assert.equal(owner.state, 'open'); await owner.close();
  }
});
