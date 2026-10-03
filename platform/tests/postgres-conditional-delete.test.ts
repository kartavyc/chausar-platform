import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rename, rm, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, parse, resolve } from 'node:path';
import { PostgresSnapshotAdapter, normalizePostgresEnvelope, postgresEnvelopeDigest,
  type PostgresPool, type PostgresQueryResult } from '../runtime/postgres.ts';
import { WorkspacePostgresCustody, type PostgresPublicationProof } from '../runtime/workspace-postgres-custody.ts';
import { Vault, type VaultEnvelope } from '../runtime/vault.ts';
import { hash, initialState } from '../runtime/contracts.ts';

// This fixture models the SQL protocol, including a shared advisory lock, durable
// COMMIT and a lost acknowledgement. It is not native PostgreSQL qualification.
type Row = Record<string, any>;
type Store = { authority: Map<string, Row>; custody: Map<string, Row> };
type Event = { client: number | 'pool'; sql: string; values: unknown[] };
type Transaction = { active: boolean; store?: Store; dirty: boolean; lock?: string };
const clone = <T>(value: T): T => structuredClone(value);
function jsonbOrder(value: any): any {
  if (Array.isArray(value)) return value.map(jsonbOrder);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .sort(([a], [b]) => a.length - b.length || a.localeCompare(b))
    .map(([key, child]) => [key, jsonbOrder(child)]));
  return value;
}
function canonical(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function decoded(column: string, value: unknown): unknown {
  return ['envelope', 'target_identity'].includes(column) && typeof value === 'string' ? JSON.parse(value) : value;
}
function expression(column: string, sql: string, values: unknown[]): unknown {
  const parameter = /^\$(\d+)/.exec(sql.trim());
  if (parameter) return decoded(column, values[Number(parameter[1]) - 1]);
  const literal = /^'([^']*)'/.exec(sql.trim());
  if (literal) return literal[1];
  if (/^NULL\b/i.test(sql.trim())) return null;
  if (/^CURRENT_TIMESTAMP\b/i.test(sql.trim())) return 'protocol-timestamp';
  throw new Error(`Protocol fixture cannot evaluate ${column} = ${sql}`);
}
function matchesWhere(row: Row, sql: string, values: unknown[]): boolean {
  const where = (sql.split(/\bWHERE\b/i)[1] ?? '').split(/\bAND\s+(?:NOT\s+)?EXISTS\b/i)[0];
  for (const match of where.matchAll(/\b(\w+)\s*=\s*(\$\d+(?:::\w+)?|'[^']*')/g)) {
    const actual = row[match[1]], expected = expression(match[1], match[2], values);
    if (['envelope', 'target_identity'].includes(match[1]) ? canonical(actual) !== canonical(expected) : String(actual) !== String(expected)) return false;
  }
  const vaultId = /envelope\s*->>\s*'id'\s*=\s*\$(\d+)/.exec(where);
  if (vaultId && row.envelope.id !== values[Number(vaultId[1]) - 1]) return false;
  const phases = /phase\s+IN\s*\(([^)]*)\)/i.exec(where);
  if (phases && ![...phases[1].matchAll(/'([^']*)'/g)].some(match => match[1] === row.phase)) return false;
  return true;
}
function protocolFixture() {
  let store: Store = { authority: new Map(), custody: new Map() };
  let nextClient = 0, connects = 0, releases = 0, lostCommitAck = false;
  const events: Event[] = [], locks = new Map<string, number>();
  const waiters = new Map<string, { client: number; grant: () => void }[]>();
  const blockedObservers: (() => void)[] = [];
  let blockedCount = 0;
  const database = { storage_id: 'storage-generation-one', database: 'synthetic_custody', database_oid: '17001',
    server_address: '127.0.0.1', server_port: 15432 };
  let beforeExactDelete: ((slot: string, transaction: Store) => void) | undefined;
  let beforePreparedCleanup: ((slot: string, transaction: Store) => void) | undefined;
  let failQuery: { pattern: RegExp; error: Error } | undefined;
  let mutationReply: { pattern: RegExp; rowCount: number | null | undefined } | undefined;
  function mutationResult(sql: string, rows: any[], rowCount: number): PostgresQueryResult {
    if (!mutationReply?.pattern.test(sql)) return { rows, rowCount };
    const override = mutationReply.rowCount; mutationReply = undefined;
    return override === undefined ? { rows } : { rows, rowCount: override };
  }
  function releaseLock(client: number, tx: Transaction) {
    if (!tx.lock || locks.get(tx.lock) !== client) return;
    const key = tx.lock, queued = waiters.get(key)?.shift();
    tx.lock = undefined;
    if (queued) { locks.set(key, queued.client); queued.grant(); }
    else locks.delete(key);
  }
  async function query(client: number | 'pool', tx: Transaction | undefined, rawSql: string, values: unknown[] = []): Promise<PostgresQueryResult> {
    const sql = rawSql.replace(/\s+/g, ' ').trim();
    events.push({ client, sql, values: clone(values) });
    if (failQuery?.pattern.test(sql)) { const failure = failQuery.error; failQuery = undefined; throw failure; }
    if (/to_regclass/.test(sql)) return { rows: [{ authority_table: true, storage_table: true, custody_table: true, creation_column: true }] };
    if (/^(CREATE TABLE|ALTER TABLE)\b/i.test(sql) || /^INSERT INTO public\.chausar_workspace_postgres_storage\b/i.test(sql)) return { rows: [], rowCount: 0 };
    assert.notEqual(client, 'pool', 'Runtime authority/custody SQL must use the leased client.');
    assert.ok(tx);
    if (sql === 'BEGIN') { assert.equal(tx.active, false); tx.active = true; return { rows: [] }; }
    if (/^SELECT pg_advisory_xact_lock/.test(sql)) {
      assert.equal(tx.active, true);
      const key = String(values[0]);
      if (locks.has(key) && locks.get(key) !== client) {
        blockedCount++;
        for (const notify of blockedObservers.splice(0)) notify();
        await new Promise<void>(grant => {
          const queued = waiters.get(key) ?? []; queued.push({ client: client as number, grant }); waiters.set(key, queued);
        });
      } else locks.set(key, client as number);
      tx.lock = key; tx.store = clone(store);
      return { rows: [] };
    }
    if (sql === 'COMMIT') {
      assert.equal(tx.active, true);
      if (tx.dirty) store = clone(tx.store!);
      tx.active = false; releaseLock(client as number, tx);
      if (lostCommitAck) { lostCommitAck = false; throw new Error('Injected lost COMMIT acknowledgement'); }
      return { rows: [] };
    }
    if (sql === 'ROLLBACK') { tx.active = false; releaseLock(client as number, tx); return { rows: [] }; }
    assert.equal(tx.active, true, 'SQL must remain inside the awaited transaction.');
    assert.ok(tx.lock && tx.store, 'SQL must follow advisory lock acquisition.');
    if (/^SELECT .*FROM public\.chausar_workspace_postgres_storage/.test(sql)) return { rows: [clone(database)] };
    const table = /public\.(chausar_vault_authority|chausar_workspace_postgres_custody)\b/.exec(sql)?.[1];
    assert.ok(table, `Unhandled protocol SQL: ${sql}`);
    const rows = table === 'chausar_vault_authority' ? tx.store.authority : tx.store.custody;
    const slot = String(values[0]);
    if (/^SELECT\b/.test(sql)) {
      const row = rows.get(slot);
      return { rows: row ? [{ ...jsonbOrder(clone(row)), revision: row.revision === null ? null : String(row.revision) }] : [] };
    }
    if (/^INSERT INTO\b/.test(sql)) {
      const insert = /\(([^()]*)\) VALUES \(([^()]*)\)/.exec(sql);
      assert.ok(insert, `Unhandled protocol INSERT: ${sql}`);
      const columns = insert[1].split(',').map(part => part.trim()), expressions = insert[2].split(',').map(part => part.trim());
      const row: Row = table === 'chausar_vault_authority' ? { creation_id: randomUUID() }
        : { vault_id: null, revision: null, envelope_digest: null, envelope: null };
      columns.forEach((column, index) => { row[column] = expression(column, expressions[index], values); });
      assert.equal(rows.has(row.slot), false, 'INSERT may never overwrite an existing slot.');
      if (table === 'chausar_workspace_postgres_custody') {
        assert.equal([...rows.values()].some(prior => prior.operation_id === row.operation_id || prior.creation_id === row.creation_id), false,
          'Operation and creation ownership must remain unique.');
      }
      rows.set(row.slot, row); tx.dirty = true;
      return { rows: /\bRETURNING\b/.test(sql) ? [jsonbOrder(clone(row))] : [], rowCount: 1 };
    }
    if (/^UPDATE\b/.test(sql)) {
      if (table === 'chausar_workspace_postgres_custody' && /phase\s*=\s*'rolled-back'/.test(sql) && beforePreparedCleanup) {
        const inject = beforePreparedCleanup; beforePreparedCleanup = undefined; inject(slot, tx.store);
      }
      const row = rows.get(slot);
      if (/NOT EXISTS.*public\.chausar_vault_authority/.test(sql) && tx.store.authority.has(slot)) return { rows: [], rowCount: 0 };
      if (!row || !matchesWhere(row, sql, values)) return { rows: [], rowCount: 0 };
      const set = sql.split(/\bSET\b/)[1].split(/\bWHERE\b/)[0];
      for (const assignment of set.split(',')) {
        const match = /^\s*(\w+)\s*=\s*(.+)\s*$/.exec(assignment); assert.ok(match);
        row[match[1]] = expression(match[1], match[2], values);
      }
      tx.dirty = true; return mutationResult(sql, [], 1);
    }
    if (/^DELETE FROM\b/.test(sql)) {
      if (/AND envelope = \$\d+::jsonb/.test(sql) && beforeExactDelete) {
        const inject = beforeExactDelete; beforeExactDelete = undefined; inject(slot, tx.store);
      }
      if (/AND NOT EXISTS \(SELECT 1 FROM public\.chausar_workspace_postgres_custody/.test(sql) && tx.store.custody.has(slot)) return { rows: [], rowCount: 0 };
      const custodyPredicate = /AND EXISTS \(SELECT 1 FROM public\.chausar_workspace_postgres_custody (WHERE .*)\)$/.exec(sql);
      if (custodyPredicate) {
        const binding = tx.store.custody.get(slot);
        if (!binding || !matchesWhere(binding, custodyPredicate[1], values)) return { rows: [], rowCount: 0 };
      }
      const row = rows.get(slot);
      if (!row || !matchesWhere(row, sql, values)) return { rows: [], rowCount: 0 };
      rows.delete(slot); tx.dirty = true; return mutationResult(sql, [], 1);
    }
    throw new Error(`Unhandled protocol SQL: ${sql}`);
  }
  const pool: PostgresPool = {
    query: (sql, values) => query('pool', undefined, sql, values),
    async connect() {
      const client = ++nextClient; connects++;
      const tx: Transaction = { active: false, dirty: false };
      return { query: (sql, values) => query(client, tx, sql, values), release() { releases++; events.push({ client, sql: 'RELEASE', values: [] }); } };
    },
    async end() {}
  };
  return {
    pool, events, database,
    get connects() { return connects; }, get releases() { return releases; },
    seed(slot: string, envelope: VaultEnvelope, creationId = 'source-incarnation-one') {
      store.authority.set(slot, { slot, revision: envelope.revision, envelope: clone(envelope), creation_id: creationId });
    },
    authority(slot: string): any { return clone(store.authority.get(slot)); },
    custody(slot: string): any { return clone(store.custody.get(slot)); },
    forgetCustody(slot: string) { store.custody.delete(slot); },
    mutateCustody(slot: string, change: (row: Row) => void) { const row = store.custody.get(slot); assert.ok(row); change(row); },
    clearEvents() { events.length = 0; },
    loseNextCommitAcknowledgement() { lostCommitAck = true; },
    failNextQuery(pattern: RegExp, error: Error) { failQuery = { pattern, error }; },
    overrideNextMutationRowCount(pattern: RegExp, rowCount: number | null | undefined) { mutationReply = { pattern, rowCount }; },
    async waitForBlockedWriter() {
      if (blockedCount) return;
      await new Promise<void>(notify => blockedObservers.push(notify));
    },
    replaceBeforeExactDelete(envelope: VaultEnvelope, creationId: string) {
      beforeExactDelete = (slot, transaction) => {
        const replacement = { slot, revision: envelope.revision, envelope: clone(envelope), creation_id: creationId };
        store.authority.set(slot, clone(replacement)); transaction.authority.set(slot, replacement);
      };
    },
    replaceCustodyBeforeCleanup(change: (row: Row) => void) {
      beforePreparedCleanup = (slot, transaction) => {
        const current = store.custody.get(slot); assert.ok(current); const replacement = clone(current); change(replacement);
        store.custody.set(slot, clone(replacement)); transaction.custody.set(slot, replacement);
      };
    },
    replaceCustodyBeforeAuthorityDelete(change: (row: Row) => void) {
      beforeExactDelete = (slot, transaction) => {
        const current = store.custody.get(slot); assert.ok(current); const replacement = clone(current); change(replacement);
        store.custody.set(slot, clone(replacement)); transaction.custody.set(slot, replacement);
      };
    },
    occupyBeforePreparedCleanup(envelope: VaultEnvelope, creationId: string) {
      beforePreparedCleanup = (slot, transaction) => {
        const replacement = { slot, revision: envelope.revision, envelope: clone(envelope), creation_id: creationId };
        store.authority.set(slot, clone(replacement)); transaction.authority.set(slot, replacement);
      };
    }
  };
}
function envelope(revision = 0, id = 'synthetic-vault', marker = 'snapshot'): VaultEnvelope {
  const ciphertext = (value: string) => ({ nonce: Buffer.alloc(12, 1).toString('base64url'), tag: Buffer.alloc(16, 2).toString('base64url'), data: Buffer.from(value).toString('base64url') });
  return { format: 'chausar.vault.v1', id, revision,
    passphrase: { salt: Buffer.alloc(16, 3).toString('base64url'), kdf: 'scrypt-32768-8-1', ciphertext: ciphertext('passphrase-wrapper') },
    recovery: { salt: Buffer.alloc(16, 4).toString('base64url'), kdf: 'scrypt-32768-8-1', ciphertext: ciphertext('recovery-wrapper') }, snapshot: ciphertext(marker) };
}
async function directoryFor(t: TestContext) {
  const root = resolve(tmpdir());
  if (process.platform === 'win32') assert.equal(parse(root).root.toLowerCase(), 'c:\\', 'Mutable fixture directories must stay on C.');
  const directory = await mkdtemp(join(root, 'chausar-postgres-custody-test-'));
  t.after(() => rm(directory, { recursive: true, force: true })); return directory;
}
async function targetFor(t: TestContext, slot = 'target-slot') {
  const fixture = protocolFixture(), directory = await directoryFor(t);
  const adapter = await PostgresSnapshotAdapter.fromPool(fixture.pool, slot);
  const custody = new WorkspacePostgresCustody({ adapter, targetDirectory: directory });
  return { fixture, directory, adapter, custody, slot };
}
async function preparedFor(t: TestContext, slot?: string) {
  const target = await targetFor(t, slot), value = envelope();
  const reservation = await target.custody.reserve({ operationId: 'operation-one', creationId: 'target-incarnation-one' });
  const proof = await target.custody.prepare({ reservation, envelope: jsonbOrder(value) });
  return { ...target, value, reservation, proof };
}

async function ordinaryFor(slot = 'ordinary-slot') {
  const fixture = protocolFixture(), adapter = await PostgresSnapshotAdapter.fromPool(fixture.pool, slot);
  return { fixture, adapter, slot };
}
async function stagedFor(t: TestContext) {
  const target = await targetFor(t), value = envelope();
  const reservation = await target.custody.reserve({ operationId: 'operation-one', creationId: 'target-incarnation-one' });
  const staging = target.custody.createPreparedAdapter(reservation); await staging.commit(value, null);
  const inspection = await target.custody.inspect(reservation); assert.ok(inspection.proof);
  return { ...target, value, reservation, staging, proof: inspection.proof };
}
function bootstrapOptions(directory: string, storage: Parameters<typeof Vault.createBootstrap>[0]['storage'],
  keychain: NonNullable<Parameters<typeof Vault.createBootstrap>[0]['keychain']>) {
  const state = initialState('Synthetic atomic cleanup bootstrap', true);
  state.members[0].id = 'fresh-owner'; state.policy.allowedSources = ['synthetic-source'];
  return { directory, storage, passphrase: 'Public synthetic bootstrap credential', state, expectedStateDigest: hash(state),
    expectedWorkspaceId: state.workspace.id, expectedOwnerId: 'fresh-owner',
    budgets: { maxStateBytes: 100_000, maxJsonDepth: 32, maxJsonNodes: 10_000, maxRecords: 100 }, keychain };
}
const authorityDeletes = (events: Event[]) => events.filter(event => event.sql.startsWith('DELETE FROM public.chausar_vault_authority'));
const custodyTombstones = (events: Event[]) => events.filter(event => event.sql.startsWith('UPDATE public.chausar_workspace_postgres_custody') && /phase = 'rolled-back'/.test(event.sql));
function assertConditionalDelete(event: Event) {
  assert.match(event.sql, /\bcreation_id\s*=\s*\$\d+/); assert.match(event.sql, /\brevision\s*=\s*\$\d+/);
  assert.match(event.sql, /\benvelope\s*=\s*\$\d+::jsonb/);
}

test('ordinary cleanup atomically deletes exact observed incarnation and complete encrypted envelope then reports actual absence', async () => {
  const target = await ordinaryFor(), value = envelope(); await target.adapter.commit(jsonbOrder(value), null);
  const original = target.fixture.authority(target.slot); assert.ok(original.creation_id);
  target.fixture.clearEvents(); assert.equal(await target.adapter.deleteIfCurrent(jsonbOrder(value)), 'deleted');
  assert.equal(target.fixture.authority(target.slot), undefined); assert.equal(await target.adapter.load(), null);
  const deletion = authorityDeletes(target.fixture.events); assert.equal(deletion.length, 1); assertConditionalDelete(deletion[0]);
  assert.equal(await target.adapter.deleteIfCurrent(value), 'absent');
  assert.equal(authorityDeletes(target.fixture.events).length, 1, 'Absence must not replay DELETE.');
});

test('ordinary cleanup returns absent for an actually absent slot without mutating SQL', async () => {
  const target = await ordinaryFor(); target.fixture.clearEvents();
  assert.equal(await target.adapter.deleteIfCurrent(envelope()), 'absent');
  assert.equal(target.fixture.authority(target.slot), undefined);
  assert.equal(target.fixture.events.some(event => /^(INSERT|UPDATE|DELETE)\b/.test(event.sql)), false);
});

test('unobserved ordinary adapter cannot delete an occupied slot using a copied exact envelope', async () => {
  const target = await ordinaryFor(), value = envelope(); target.fixture.seed(target.slot, value, 'unobserved-incarnation');
  target.fixture.clearEvents(); assert.equal(await target.adapter.deleteIfCurrent(value), 'mismatch');
  assert.deepEqual(target.fixture.authority(target.slot).envelope, value);
  assert.equal(authorityDeletes(target.fixture.events).length, 0);
});

test('ordinary cleanup refuses changed caller ciphertext, Vault identity and revision without deleting exact retained authority', async () => {
  const target = await ordinaryFor(), value = envelope(); await target.adapter.commit(value, null); target.fixture.clearEvents();
  for (const expected of [envelope(0, value.id, 'different-ciphertext'), envelope(0, 'different-vault'), envelope(1)])
    assert.equal(await target.adapter.deleteIfCurrent(expected), 'mismatch');
  assert.deepEqual(target.fixture.authority(target.slot).envelope, value); assert.equal(authorityDeletes(target.fixture.events).length, 0);
});

test('ordinary cleanup refuses changed current ciphertext, Vault identity and revision while retaining the occupant', async () => {
  for (const changed of [envelope(0, 'synthetic-vault', 'changed-ciphertext'), envelope(0, 'changed-vault'), envelope(1)]) {
    const target = await ordinaryFor(), value = envelope(); await target.adapter.commit(value, null);
    const creationId = target.fixture.authority(target.slot).creation_id; target.fixture.seed(target.slot, changed, creationId);
    target.fixture.clearEvents(); assert.equal(await target.adapter.deleteIfCurrent(value), 'mismatch');
    assert.deepEqual(target.fixture.authority(target.slot).envelope, changed); assert.equal(authorityDeletes(target.fixture.events).length, 0);
  }
});

test('ordinary exact-envelope ABA replacement is mismatch and stale origin cannot reload or commit into new incarnation', async () => {
  const target = await ordinaryFor(), value = envelope(); await target.adapter.commit(value, null);
  target.fixture.seed(target.slot, value, 'replacement-incarnation'); target.fixture.clearEvents();
  assert.equal(await target.adapter.deleteIfCurrent(value), 'mismatch');
  await assert.rejects(target.adapter.load(), { code: 'POSTGRES_AUTHORITY_CHANGED' });
  await assert.rejects(target.adapter.commit(envelope(1), 0), { code: 'REVISION_CONFLICT' });
  assert.equal(target.fixture.authority(target.slot).creation_id, 'replacement-incarnation');
  assert.deepEqual(target.fixture.authority(target.slot).envelope, value); assert.equal(authorityDeletes(target.fixture.events).length, 0);
  assert.equal(target.fixture.events.some(event => /^UPDATE public\.chausar_vault_authority/.test(event.sql)), false);
});

test('ordinary conditional DELETE predicate refuses ciphertext or incarnation injected after ownership precheck', async () => {
  for (const changeCreation of [false, true]) {
    const target = await ordinaryFor(), value = envelope(); await target.adapter.commit(value, null);
    const creationId = target.fixture.authority(target.slot).creation_id;
    const changed = changeCreation ? value : envelope(0, value.id, 'changed-after-precheck');
    const replacementCreation = changeCreation ? 'replacement-after-precheck' : creationId;
    target.fixture.replaceBeforeExactDelete(changed, replacementCreation); target.fixture.clearEvents();
    assert.equal(await target.adapter.deleteIfCurrent(value), 'mismatch');
    assert.deepEqual(target.fixture.authority(target.slot).envelope, changed);
    assert.equal(target.fixture.authority(target.slot).creation_id, replacementCreation);
    const deletion = authorityDeletes(target.fixture.events); assert.equal(deletion.length, 1); assertConditionalDelete(deletion[0]);
  }
});

test('ordinary cleanup lost COMMIT acknowledgement throws once and explicit fresh inspection observes actual SQL absence', async () => {
  const target = await ordinaryFor(), value = envelope(); await target.adapter.commit(value, null);
  target.fixture.clearEvents(); target.fixture.loseNextCommitAcknowledgement();
  await assert.rejects(target.adapter.deleteIfCurrent(value), /Injected lost COMMIT acknowledgement/);
  assert.equal(target.fixture.authority(target.slot), undefined);
  const fresh = await PostgresSnapshotAdapter.fromPool(target.fixture.pool, target.slot); assert.equal(await fresh.load(), null);
  const deletion = authorityDeletes(target.fixture.events); assert.equal(deletion.length, 1); assertConditionalDelete(deletion[0]);
});

test('ordinary cleanup missing or inconsistent affected-row acknowledgement aborts applied DELETE rather than claiming a cleanup outcome', async () => {
  for (const rowCount of [undefined, null, 2]) {
    const target = await ordinaryFor(), value = envelope(); await target.adapter.commit(value, null); target.fixture.clearEvents();
    target.fixture.overrideNextMutationRowCount(/^DELETE FROM public\.chausar_vault_authority/, rowCount);
    await assert.rejects(target.adapter.deleteIfCurrent(value), { code: 'POSTGRES_AUTHORITY_CHANGED' });
    assert.deepEqual(target.fixture.authority(target.slot).envelope, value); assert.equal(authorityDeletes(target.fixture.events).length, 1);
    assert.equal(target.fixture.events.some(event => event.sql === 'COMMIT'), false);
    assert.deepEqual(target.fixture.events.slice(-2).map(event => event.sql), ['ROLLBACK', 'RELEASE']);
  }
});

test('ordinary committed-target cleanup compares retained publication binding and atomically retains encrypted tombstone', async t => {
  const target = await stagedFor(t); await target.custody.publish(target.proof); assert.deepEqual(await target.adapter.load(), target.value);
  target.fixture.clearEvents(); assert.equal(await target.adapter.deleteIfCurrent(target.value), 'deleted');
  assert.equal(target.fixture.authority(target.slot), undefined); assert.equal(target.fixture.custody(target.slot).phase, 'rolled-back');
  assert.equal(await target.adapter.deleteIfCurrent(target.value), 'absent');
  assert.deepEqual((await target.custody.inspect(target.proof)).envelope, target.value);
  const deletion = authorityDeletes(target.fixture.events); assert.equal(deletion.length, 1); assertConditionalDelete(deletion[0]);
  assert.match(deletion[0].sql, /AND EXISTS \(SELECT 1 FROM public\.chausar_workspace_postgres_custody/);
  assert.equal(custodyTombstones(target.fixture.events).length, 1);
});

test('ordinary committed-target DELETE predicate cannot remove authority after operation binding replacement', async t => {
  const target = await stagedFor(t); await target.custody.publish(target.proof); await target.adapter.load();
  target.fixture.replaceCustodyBeforeAuthorityDelete(row => { row.operation_id = 'replacement-operation'; }); target.fixture.clearEvents();
  assert.equal(await target.adapter.deleteIfCurrent(target.value), 'mismatch');
  assert.deepEqual(target.fixture.authority(target.slot).envelope, target.value);
  assert.equal(target.fixture.custody(target.slot).operation_id, 'replacement-operation'); assert.equal(target.fixture.custody(target.slot).phase, 'committed');
  assert.equal(authorityDeletes(target.fixture.events).length, 1); assert.equal(custodyTombstones(target.fixture.events).length, 0);
});

test('same-adapter outer lease cannot claim ordinary cleanup acknowledgement across outer rollback or lost COMMIT ack', async () => {
  for (const boundary of ['rollback', 'lost-ack']) {
    const target = await ordinaryFor(), value = envelope(); await target.adapter.commit(value, null); target.fixture.clearEvents();
    const failure = new Error('Synthetic outer callback rollback');
    if (boundary === 'lost-ack') target.fixture.loseNextCommitAcknowledgement();
    const outer = target.adapter.withLease(async lease => {
      await assert.rejects(target.adapter.deleteIfCurrent(value), { code: 'POSTGRES_LEASE_ACTIVE' });
      assert.deepEqual(await lease.load(), value);
      if (boundary === 'rollback') throw failure;
    });
    await assert.rejects(outer, error => boundary === 'rollback' ? error === failure : /Injected lost COMMIT acknowledgement/.test(String(error)));
    assert.deepEqual(target.fixture.authority(target.slot).envelope, value); assert.equal(authorityDeletes(target.fixture.events).length, 0);
  }
});

test('reserved staging cleanup reports authority absence without tombstoning reservation or adopting caller ciphertext', async t => {
  const target = await targetFor(t);
  const reservation = await target.custody.reserve({ operationId: 'operation-one', creationId: 'target-incarnation-one' });
  const staging = target.custody.createPreparedAdapter(reservation); target.fixture.clearEvents();
  assert.equal(await staging.deleteIfCurrent!(envelope()), 'absent'); assert.equal(await staging.load(), null);
  assert.equal(target.fixture.custody(target.slot).phase, 'reserved'); assert.equal(target.fixture.authority(target.slot), undefined);
  assert.equal(custodyTombstones(target.fixture.events).length, 0); assert.equal(authorityDeletes(target.fixture.events).length, 0);
});

test('prepared exact cleanup conditionally tombstones exact encrypted evidence and acknowledged local load returns null', async t => {
  const target = await stagedFor(t); target.fixture.clearEvents();
  assert.equal(await target.staging.deleteIfCurrent!(jsonbOrder(target.value)), 'deleted');
  assert.equal(target.fixture.custody(target.slot).phase, 'rolled-back'); assert.equal(await target.staging.load(), null);
  assert.equal(await target.staging.deleteIfCurrent!(target.value), 'absent');
  assert.equal(target.fixture.authority(target.slot), undefined); assert.equal(authorityDeletes(target.fixture.events).length, 0);
  const tombstones = custodyTombstones(target.fixture.events); assert.equal(tombstones.length, 1);
  for (const field of ['operation_id', 'creation_id', 'vault_id', 'revision', 'envelope_digest', 'envelope'])
    assert.match(tombstones[0].sql.split(/\bWHERE\b/)[1], new RegExp(`\\b${field}\\s*=\\s*\\$\\d+`));
  assert.deepEqual((await target.custody.inspect(target.proof)).envelope, target.value);
  await assert.rejects(target.adapter.load(), { code: 'POSTGRES_TARGET_NOT_COMMITTED' });
});

test('prepared cleanup refuses mismatched caller envelope and altered retained proof operation/creation without tombstoning', async t => {
  const target = await stagedFor(t); target.fixture.clearEvents();
  assert.equal(await target.staging.deleteIfCurrent!(envelope(0, target.value.id, 'different-expected')), 'mismatch');
  for (const proof of [{ ...target.proof, operationId: 'other-operation' }, { ...target.proof, creationId: 'other-incarnation' },
    { ...target.proof, envelopeDigest: '0'.repeat(64) }]) {
    const other = target.custody.createPreparedAdapter(proof); assert.equal(await other.deleteIfCurrent!(target.value), 'mismatch');
  }
  assert.equal(target.fixture.custody(target.slot).phase, 'prepared'); assert.deepEqual(target.fixture.custody(target.slot).envelope, target.value);
  assert.equal(custodyTombstones(target.fixture.events).length, 0); assert.equal(authorityDeletes(target.fixture.events).length, 0);
});

test('prepared cleanup refuses coherent replacement ciphertext and changed retained operation or creation', async t => {
  for (const mutation of ['ciphertext', 'operation', 'creation']) {
    const target = await stagedFor(t), changed = envelope(0, target.value.id, 'coherent-replacement');
    target.fixture.mutateCustody(target.slot, row => {
      if (mutation === 'ciphertext') { row.envelope = changed; row.envelope_digest = postgresEnvelopeDigest(changed); }
      if (mutation === 'operation') row.operation_id = 'replacement-operation';
      if (mutation === 'creation') row.creation_id = 'replacement-incarnation';
    });
    const retained = target.fixture.custody(target.slot); target.fixture.clearEvents();
    assert.equal(await target.staging.deleteIfCurrent!(target.value), 'mismatch');
    assert.deepEqual(target.fixture.custody(target.slot), retained); assert.equal(custodyTombstones(target.fixture.events).length, 0);
  }
});

test('prepared cleanup refuses committed publication and any occupied authority without deleting it', async t => {
  const committed = await stagedFor(t); await committed.custody.publish(committed.proof); committed.fixture.clearEvents();
  assert.equal(await committed.staging.deleteIfCurrent!(committed.value), 'mismatch');
  assert.equal(committed.fixture.custody(committed.slot).phase, 'committed'); assert.deepEqual(committed.fixture.authority(committed.slot).envelope, committed.value);
  assert.equal(authorityDeletes(committed.fixture.events).length, 0); assert.equal(custodyTombstones(committed.fixture.events).length, 0);
  const occupied = await stagedFor(t), occupant = envelope(0, 'occupant-vault'); occupied.fixture.seed(occupied.slot, occupant, 'occupant-incarnation'); occupied.fixture.clearEvents();
  assert.equal(await occupied.staging.deleteIfCurrent!(occupied.value), 'mismatch');
  assert.deepEqual(occupied.fixture.authority(occupied.slot).envelope, occupant); assert.equal(occupied.fixture.custody(occupied.slot).phase, 'prepared');
  assert.equal(authorityDeletes(occupied.fixture.events).length, 0); assert.equal(custodyTombstones(occupied.fixture.events).length, 0);
});

test('prepared conditional cleanup predicate cannot tombstone encrypted evidence replaced after precheck', async t => {
  const target = await stagedFor(t), changed = envelope(0, target.value.id, 'changed-after-precheck');
  // Keep the old digest deliberately: the SQL JSONB equality predicate itself
  // must protect against changed ciphertext between read and conditional UPDATE.
  target.fixture.replaceCustodyBeforeCleanup(row => { row.envelope = changed; }); target.fixture.clearEvents();
  assert.equal(await target.staging.deleteIfCurrent!(target.value), 'mismatch');
  assert.equal(target.fixture.custody(target.slot).phase, 'prepared'); assert.deepEqual(target.fixture.custody(target.slot).envelope, changed);
  const tombstones = custodyTombstones(target.fixture.events); assert.equal(tombstones.length, 1);
  assert.match(tombstones[0].sql, /\benvelope\s*=\s*\$\d+::jsonb/);
});

test('prepared conditional cleanup requires authority absence in the same SQL mutation predicate', async t => {
  const target = await stagedFor(t), occupant = envelope(0, 'new-authority-occupant');
  target.fixture.occupyBeforePreparedCleanup(occupant, 'new-authority-incarnation'); target.fixture.clearEvents();
  assert.equal(await target.staging.deleteIfCurrent!(target.value), 'mismatch');
  assert.equal(target.fixture.custody(target.slot).phase, 'prepared'); assert.deepEqual(target.fixture.custody(target.slot).envelope, target.value);
  assert.deepEqual(target.fixture.authority(target.slot).envelope, occupant);
  const tombstones = custodyTombstones(target.fixture.events); assert.equal(tombstones.length, 1);
  assert.match(tombstones[0].sql, /AND NOT EXISTS \(SELECT 1 FROM public\.chausar_vault_authority/);
  assert.equal(authorityDeletes(target.fixture.events).length, 0);
});

test('prepared cleanup missing or inconsistent affected-row acknowledgement aborts applied tombstone and retains local preparation', async t => {
  for (const rowCount of [undefined, null, 2]) {
    const target = await stagedFor(t); target.fixture.clearEvents();
    target.fixture.overrideNextMutationRowCount(/^UPDATE public\.chausar_workspace_postgres_custody .*phase = 'rolled-back'/, rowCount);
    await assert.rejects(target.staging.deleteIfCurrent!(target.value), { code: 'POSTGRES_TARGET_CHANGED' });
    assert.equal(target.fixture.custody(target.slot).phase, 'prepared'); assert.deepEqual(await target.staging.load(), target.value);
    assert.equal(custodyTombstones(target.fixture.events).length, 1); assert.equal(target.fixture.authority(target.slot), undefined);
    assert.equal(target.fixture.events.filter(event => event.sql === 'ROLLBACK').length, 1);
  }
});

test('prepared cleanup lost COMMIT acknowledgement propagates and never marks local acknowledged absence or adopts tombstone', async t => {
  const target = await stagedFor(t); target.fixture.clearEvents(); target.fixture.loseNextCommitAcknowledgement();
  await assert.rejects(target.staging.deleteIfCurrent!(target.value), /Injected lost COMMIT acknowledgement/);
  assert.equal(target.fixture.custody(target.slot).phase, 'rolled-back'); assert.equal(target.fixture.authority(target.slot), undefined);
  assert.equal((await target.custody.inspect(target.proof)).status, 'rolled-back');
  await assert.rejects(target.staging.load(), { code: 'POSTGRES_TARGET_NOT_COMMITTED' });
  assert.equal(custodyTombstones(target.fixture.events).length, 1); assert.equal(authorityDeletes(target.fixture.events).length, 0);
});

test('same-target-adapter outer lease cannot claim staged cleanup across outer rollback or lost COMMIT ack', async t => {
  for (const boundary of ['rollback', 'lost-ack']) {
    const target = await stagedFor(t); target.fixture.clearEvents(); const failure = new Error('Synthetic outer staged callback rollback');
    if (boundary === 'lost-ack') target.fixture.loseNextCommitAcknowledgement();
    const outer = target.adapter.withLease(async () => {
      await assert.rejects(target.staging.deleteIfCurrent!(target.value), { code: 'POSTGRES_LEASE_ACTIVE' });
      if (boundary === 'rollback') throw failure;
    });
    await assert.rejects(outer, error => boundary === 'rollback' ? error === failure : /Injected lost COMMIT acknowledgement/.test(String(error)));
    assert.equal(target.fixture.custody(target.slot).phase, 'prepared'); assert.deepEqual(await target.staging.load(), target.value);
    assert.equal(custodyTombstones(target.fixture.events).length, 0); assert.equal(authorityDeletes(target.fixture.events).length, 0);
  }
});

test('actual ordinary Vault bootstrap keychain failure cleans exact encrypted incarnation and preserves original failure', async t => {
  const target = await ordinaryFor(), directory = await directoryFor(t), failure = new Error('Synthetic ordinary keychain failure'); let removed = false;
  target.fixture.clearEvents();
  await assert.rejects(Vault.createBootstrap(bootstrapOptions(directory, target.adapter,
    { async store() { throw failure; }, async remove() { removed = true; } })), error => error === failure);
  assert.equal(removed, true); assert.equal(target.fixture.authority(target.slot), undefined); assert.deepEqual(await readdir(directory), []);
  const deletion = authorityDeletes(target.fixture.events); assert.equal(deletion.length, 1); assertConditionalDelete(deletion[0]);
});

test('actual prepared Vault bootstrap keychain failure tombstones exact staged ciphertext and preserves original failure', async t => {
  const target = await targetFor(t), directory = await directoryFor(t), failure = new Error('Synthetic prepared keychain failure');
  const reservation = await target.custody.reserve({ operationId: 'bootstrap-operation', creationId: 'bootstrap-incarnation' });
  const staging = target.custody.createPreparedAdapter(reservation); target.fixture.clearEvents();
  await assert.rejects(Vault.createBootstrap(bootstrapOptions(directory, staging, { async store() { throw failure; }, async remove() {} })), error => error === failure);
  assert.equal(target.fixture.authority(target.slot), undefined); assert.equal(target.fixture.custody(target.slot).phase, 'rolled-back');
  assert.equal(await staging.load(), null); assert.deepEqual(await readdir(directory), []); assert.deepEqual(await readdir(target.directory), []);
  assert.equal(custodyTombstones(target.fixture.events).length, 1); assert.equal(authorityDeletes(target.fixture.events).length, 0);
});

test('actual ordinary Vault bootstrap refuses ABA replacement cleanup with BOOTSTRAP_CLEANUP_REQUIRED and retains occupant', async t => {
  const target = await ordinaryFor(), directory = await directoryFor(t), failure = new Error('Synthetic keychain failure after ABA'); let retained!: VaultEnvelope;
  target.fixture.clearEvents();
  await assert.rejects(Vault.createBootstrap(bootstrapOptions(directory, target.adapter,
    { async store() { retained = target.fixture.authority(target.slot).envelope; target.fixture.seed(target.slot, retained, 'replacement-bootstrap-incarnation'); throw failure; }, async remove() {} })),
  { code: 'BOOTSTRAP_CLEANUP_REQUIRED' });
  assert.deepEqual(target.fixture.authority(target.slot).envelope, retained); assert.equal(target.fixture.authority(target.slot).creation_id, 'replacement-bootstrap-incarnation');
  assert.equal(authorityDeletes(target.fixture.events).length, 0); assert.deepEqual(await readdir(directory), []);
});

test('actual prepared Vault bootstrap refuses coherent replacement cleanup with BOOTSTRAP_CLEANUP_REQUIRED and retains ciphertext', async t => {
  const target = await targetFor(t), directory = await directoryFor(t), failure = new Error('Synthetic keychain failure after replacement'); let retained!: VaultEnvelope;
  const reservation = await target.custody.reserve({ operationId: 'bootstrap-operation', creationId: 'bootstrap-incarnation' });
  const staging = target.custody.createPreparedAdapter(reservation); target.fixture.clearEvents();
  await assert.rejects(Vault.createBootstrap(bootstrapOptions(directory, staging,
    { async store() { target.fixture.mutateCustody(target.slot, row => { retained = clone(row.envelope); retained.snapshot.data = Buffer.from('replacement encrypted evidence').toString('base64url');
      row.envelope = retained; row.envelope_digest = postgresEnvelopeDigest(retained); }); throw failure; }, async remove() {} })),
  { code: 'BOOTSTRAP_CLEANUP_REQUIRED' });
  assert.deepEqual(target.fixture.custody(target.slot).envelope, retained); assert.equal(target.fixture.custody(target.slot).phase, 'prepared');
  assert.equal(custodyTombstones(target.fixture.events).length, 0); assert.equal(authorityDeletes(target.fixture.events).length, 0);
  assert.deepEqual(await readdir(directory), []);
});

test('actual ordinary Vault bootstrap cleanup lost acknowledgement requires explicit inspection without automatic retry', async t => {
  const target = await ordinaryFor(), directory = await directoryFor(t), failure = new Error('Synthetic keychain failure before lost cleanup acknowledgement');
  target.fixture.clearEvents();
  await assert.rejects(Vault.createBootstrap(bootstrapOptions(directory, target.adapter,
    { async store() { target.fixture.loseNextCommitAcknowledgement(); throw failure; }, async remove() {} })), { code: 'BOOTSTRAP_CLEANUP_REQUIRED' });
  assert.equal(target.fixture.authority(target.slot), undefined); assert.deepEqual(await readdir(directory), []);
  const deletion = authorityDeletes(target.fixture.events); assert.equal(deletion.length, 1); assertConditionalDelete(deletion[0]);
  assert.equal(await (await PostgresSnapshotAdapter.fromPool(target.fixture.pool, target.slot)).load(), null);
});

test('actual prepared Vault bootstrap cleanup lost acknowledgement requires explicit tombstone inspection and preserves unacknowledged local state', async t => {
  const target = await targetFor(t), directory = await directoryFor(t), failure = new Error('Synthetic keychain failure before lost cleanup acknowledgement');
  const reservation = await target.custody.reserve({ operationId: 'bootstrap-operation', creationId: 'bootstrap-incarnation' });
  const staging = target.custody.createPreparedAdapter(reservation); target.fixture.clearEvents();
  await assert.rejects(Vault.createBootstrap(bootstrapOptions(directory, staging,
    { async store() { target.fixture.loseNextCommitAcknowledgement(); throw failure; }, async remove() {} })), { code: 'BOOTSTRAP_CLEANUP_REQUIRED' });
  assert.equal(target.fixture.custody(target.slot).phase, 'rolled-back'); assert.equal(target.fixture.authority(target.slot), undefined);
  assert.equal((await target.custody.inspectOperation({ operationId: reservation.operationId, creationId: reservation.creationId })).status, 'rolled-back');
  await assert.rejects(staging.load(), { code: 'POSTGRES_TARGET_NOT_COMMITTED' }); assert.deepEqual(await readdir(directory), []);
  assert.equal(custodyTombstones(target.fixture.events).length, 1); assert.equal(authorityDeletes(target.fixture.events).length, 0);
});
