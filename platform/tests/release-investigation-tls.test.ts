import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hash } from '../runtime/contracts.ts';
import { Engine } from '../runtime/engine.ts';
import { INVESTIGATION_SEARCH_METHOD, PostgresInvestigationSearch, type InvestigationSearchRequest } from '../runtime/investigation-search.ts';
import { realPostgresUnavailable, startTlsPostgres } from '../../enterprise/server/testing/real-postgres.ts';

const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, String(error?.message)); return true; };
const fakeCa = '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n';
const remote = { host: '192.0.2.10', port: 5432, user: 'synthetic', password: 'public-synthetic-password', database: 'synthetic' };
const request = (query: string): InvestigationSearchRequest => ({ method: INVESTIGATION_SEARCH_METHOD, query, bounds: { maxDocuments: 100, maxTextBytes: 100_000, maxMatches: 100 } });
const passphrase = 'synthetic remote search passphrase';
const plan = () => ({ objective: 'August empty-source investigation', branch: 'main', asOf: new Date().toISOString(), sourceIds: [],
  steps: [{ id: 'august', label: 'August empty collection scope', request: { operation: 'received', period: { from: '2026-08-01', to: '2026-08-31' } } }],
  hypotheses: [], budget: { maxSteps: 2, maxReceiptRows: 10, maxContextBytes: 16384 } });
type Hooks = { after(work: () => unknown): void };
async function scratch(t: Hooks) { const directory = await mkdtemp(join(tmpdir(), 'chausar-search-tls-')); await chmod(directory, 0o700); t.after(() => rm(directory, { recursive: true, force: true })); return directory; }

test('the search adapter keeps loopback-only without remoteTls and refuses a malformed pin before connecting', async () => {
  for (const host of ['192.0.2.10', 'db.example.com', 'localhost']) await assert.rejects(PostgresInvestigationSearch.connect({ ...remote, host } as any), code('INVALID_POSTGRES_CONFIG'), host);
  for (const remoteTls of [undefined, null, {}, { ca: '' }, { ca: 'not a certificate' }, { ca: fakeCa, servername: 'bad name!' }, { ca: fakeCa, rejectUnauthorized: false }])
    await assert.rejects(PostgresInvestigationSearch.connect({ ...remote, remoteTls } as any), code('POSTGRES_TLS_REQUIRED'), JSON.stringify(remoteTls));
  await assert.rejects(PostgresInvestigationSearch.connect({ ...remote, host: 'bad host!', remoteTls: { ca: fakeCa } }), code('INVALID_POSTGRES_CONFIG'));
  await assert.rejects(PostgresInvestigationSearch.connect({ ...remote, remoteTls: { ca: fakeCa }, ssl: false } as any), code('SEARCH_CONFIGURATION_INVALID'), 'Driver controls stay refused.');
});

/** A workspace in a demo file engine, then pointed at a PostgreSQL URL: only the search adapter reads that URL. */
async function searchingEngine(t: Hooks, options: Partial<ConstructorParameters<typeof Engine>[0]>, url: string) {
  const engine = new Engine({ directory: await scratch(t), demo: true, storage: 'experimental-file', ...options });
  await engine.request('workspace.create', { name: 'Synthetic search mode', passphrase, demo: true });
  t.after(() => engine.shutdown(10_000).catch(() => {}));
  engine.options.storage = 'postgres'; engine.options.postgresUrl = url; return engine;
}

test('the desktop engine refuses a remote search database, with or without TLS settings, and enterprise mode needs TLS', async t => {
  const url = 'postgresql://synthetic:public-synthetic-password@192.0.2.10:5432/synthetic';
  for (const options of [{}, { postgresTls: { ca: fakeCa } }, { storageMode: 'enterprise-server' as const }]) {
    const engine = await searchingEngine(t, options, url);
    await assert.rejects(engine.request('research.search', request('August')), code('INVALID_POSTGRES_CONFIG'), JSON.stringify(options));
  }
  // Enterprise mode with TLS settings takes the remote path, which checks the pin before connecting.
  const pinned = await searchingEngine(t, { storageMode: 'enterprise-server', postgresTls: { ca: 'not a certificate' } }, url);
  await assert.rejects(pinned.request('research.search', request('August')), code('POSTGRES_TLS_REQUIRED'));
});

const unavailable = realPostgresUnavailable();
test('enterprise search reaches a real TLS-only PostgreSQL on a non-loopback address with the pinned CA', { skip: unavailable ?? false, timeout: 180_000 }, async t => {
  // Cleanup runs in reverse, so engines and their search pools close before the cluster stops.
  const cleanup: (() => unknown)[] = []; const hooks: Hooks = { after: work => { cleanup.push(work); } };
  t.after(async () => { for (const work of cleanup.reverse()) await Promise.resolve().then(work).catch(() => {}); });
  const pg = await startTlsPostgres(); hooks.after(() => pg.stop());
  const base = { host: pg.host, port: pg.port, user: pg.user, password: pg.password, database: pg.database };
  const documents = [
    { id: 'investigation-august', kind: 'investigation' as const, revision: 2, digest: hash('august'), text: 'August collections fell; payment timing is an owner guess.' },
    { id: 'journal-july', kind: 'journal' as const, revision: 1, digest: hash('july'), text: 'July review stays a private draft.' },
  ];
  const projection = { complete: true as const, expectedDocuments: documents.length, documents };

  await t.test('desktop options refuse the non-loopback host; the TLS-only server refuses plaintext loopback', async () => {
    await assert.rejects(PostgresInvestigationSearch.connect(base as any), code('INVALID_POSTGRES_CONFIG'));
    await assert.rejects(PostgresInvestigationSearch.connect({ ...base, host: '127.0.0.1' }), code('SEARCH_SQL_FAILED'));
  });
  await t.test('an unrelated CA or a wrong server name is refused', async () => {
    await assert.rejects(PostgresInvestigationSearch.connect({ ...base, remoteTls: { ca: pg.otherCa } }), code('SEARCH_SQL_FAILED'));
    await assert.rejects(PostgresInvestigationSearch.connect({ ...base, remoteTls: { ca: pg.ca, servername: 'wrong.example.com' } }), code('SEARCH_SQL_FAILED'));
  });
  await t.test('the pinned CA indexes and searches the projection over TLS', async () => {
    const search = await PostgresInvestigationSearch.connect({ ...base, remoteTls: { ca: pg.ca } });
    try {
      const result = await search.search(projection, request('August payment'));
      assert.equal(result.engine, 'postgres'); assert.deepEqual(result.matches.map(match => match.id), ['investigation-august']);
      assert.equal(result.serverIdentity?.address, pg.host); assert.equal(result.serverIdentity?.port, pg.port); assert.match(String(result.serverIdentity?.version), /^PostgreSQL 16\./);
      assert.deepEqual((await search.search(projection, request('private draft'))).matches.map(match => match.id), ['journal-july']);
      assert.deepEqual((await search.search(projection, request('September'))).matches, []);
    } finally { await search.close(); }
    const named = await PostgresInvestigationSearch.connect({ ...base, host: '127.0.0.1', remoteTls: { ca: pg.ca, servername: 'chausar-db.test' } });
    try { assert.equal((await named.search(projection, request('July'))).matches.length, 1); } finally { await named.close(); }
  });
  await t.test('an enterprise engine runs research.search over TLS; the same URL in desktop mode is refused', async () => {
    const options = { directory: await scratch(hooks), storage: 'postgres' as const, postgresUrl: pg.url(), storageMode: 'enterprise-server' as const, postgresTls: { ca: pg.ca } };
    const engine = new Engine(options); hooks.after(() => engine.shutdown(10_000));
    await engine.request('workspace.create', { name: 'Synthetic remote search', passphrase });
    const investigation = await engine.request('investigations.create', plan());
    const result = await engine.request('research.search', request('August'));
    assert.equal(result.engine, 'postgres'); assert.equal(result.serverIdentity.address, pg.host);
    assert.deepEqual(result.matches.map((match: any) => match.id), [investigation.id]);
    assert.deepEqual((await engine.request('research.search', request('September'))).matches, []);
    const desktop = await searchingEngine(hooks, {}, pg.url());
    await assert.rejects(desktop.request('research.search', request('August')), code('INVALID_POSTGRES_CONFIG'));
  });
});
