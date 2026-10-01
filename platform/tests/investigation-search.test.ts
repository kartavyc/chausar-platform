import test from 'node:test';
import assert from 'node:assert/strict';
import { hash } from '../runtime/contracts.ts';
import { PostgresInvestigationSearch, INVESTIGATION_SEARCH_METHOD, type AuthorizedInvestigationSearchProjection, type InvestigationSearchDocument, type InvestigationSearchPool, type InvestigationSearchRequest } from '../runtime/investigation-search.ts';

const document = (id: string, text: string, kind: InvestigationSearchDocument['kind'] = 'investigation'): InvestigationSearchDocument => ({ id, kind, revision: 2, digest: hash({ id, text, kind }), text });
const documents = [document('investigation-b', 'Rare saffron question'), document('journal-a', 'Saffron decision retained', 'journal')];
const projection = (items = documents): AuthorizedInvestigationSearchProjection => ({ complete: true, expectedDocuments: items.length, documents: structuredClone(items) });
const request = (query = 'saffron'): InvestigationSearchRequest => ({ method: INVESTIGATION_SEARCH_METHOD, query, bounds: { maxDocuments: 10, maxTextBytes: 4096, maxMatches: 10 } });
const match = (item: InvestigationSearchDocument) => ({ id: item.id, kind: item.kind, revision: String(item.revision), digest: item.digest });

function injected(options: { matches?: Record<string, unknown>[]; terms?: number; hang?: 'acquire' | 'begin' | 'search' | 'rollback'; fail?: 'begin' | 'search' | 'rollback'; serverTimeout?: boolean } = {}) {
  const calls: { sql: string; values: unknown[] }[] = [], releases: (Error | undefined)[] = [];
  let connected = 0, ended = false;
  const client = {
    async query(sql: string, values: unknown[] = []) {
      calls.push({ sql, values });
      const phase = sql === 'BEGIN' ? 'begin' : sql === 'ROLLBACK' ? 'rollback' : sql.startsWith('SELECT id,') ? 'search' : '';
      if (options.hang === phase) return await new Promise<never>(() => {});
      if (options.fail === phase) throw Object.assign(new Error('Injected detail must not escape: private-text'), { code: options.serverTimeout ? '57014' : 'XX000' });
      if (sql.startsWith('SELECT numnode')) return { rows: [{ terms: options.terms ?? 1 }] };
      if (phase === 'search') return { rows: options.matches ?? documents.map(match) };
      return { rows: [] };
    },
    release(error?: Error) { releases.push(error); },
  };
  const pool: InvestigationSearchPool = { async connect() { connected++; if (options.hang === 'acquire') return await new Promise<never>(() => {}); return client; }, async end() { ended = true; } };
  return { pool, client, calls, releases, connected: () => connected, ended: () => ended };
}

test('managed-pool protocol uses complete prepared private projection and remains injected evidence', async () => {
  const fixture = injected(); const search = PostgresInvestigationSearch.fromPool(fixture.pool);
  const query = "saffron'); DROP TABLE customer; --";
  const result = await search.search(projection(), request(query));
  assert.equal(result.engine, 'injected-sql'); assert.equal(result.serverIdentity, null);
  assert.deepEqual(result.matches, documents.map(({ text, ...item }) => item));
  assert.deepEqual(result.completeness, { class: 'complete-authorized-projection', documents: 2, textBytes: Buffer.byteLength(documents[0].text) + Buffer.byteLength(documents[1].text), matchedDocuments: 2, indexReadiness: 'fresh-transactional-projection' });
  assert.equal(result.queryDigest, hash(query)); assert(!JSON.stringify(result).includes(query));
  assert(!Object.hasOwn(result.matches[0], 'text'));
  assert.equal(fixture.calls[0].sql, 'BEGIN'); assert.equal(fixture.calls[1].sql, 'SET LOCAL search_path TO pg_temp');
  assert.deepEqual(fixture.calls[2].values, ['15000']);
  assert.equal(fixture.calls.filter(call => call.sql.startsWith('CREATE TEMP TABLE')).length, 1);
  assert(fixture.calls.some(call => call.sql.includes('ON COMMIT DROP')));
  assert(fixture.calls.every(call => !call.sql.includes(query) && !call.sql.includes(documents[0].text)));
  assert(fixture.calls.filter(call => call.sql.startsWith('INSERT INTO')).every(call => call.sql.includes("to_tsvector('simple'::regconfig,$5)")));
  assert.deepEqual(fixture.calls.find(call => call.sql.startsWith('SELECT id,'))!.values, [query, 11]);
  assert(fixture.calls.find(call => call.sql.startsWith('SELECT id,'))!.sql.includes("@@ plainto_tsquery('simple'::regconfig,$1)"));
  assert.equal(fixture.calls.at(-1)!.sql, 'ROLLBACK'); assert.deepEqual(fixture.releases, [undefined]);
  await search.close(); assert.equal(fixture.ended(), false);
  await assert.rejects(search.search(projection(), request()), { code: 'SEARCH_CLOSED' });
});

test('projection proof pins text, revision, digest and the entire supplied corpus independent of input ordering', async () => {
  const first = await PostgresInvestigationSearch.fromPool(injected({ matches: [] }).pool).search(projection(), request());
  const reordered = await PostgresInvestigationSearch.fromPool(injected({ matches: [] }).pool).search(projection([...documents].reverse()), request());
  assert.equal(first.projectionDigest, reordered.projectionDigest);
  for (const change of [{ text: 'Changed private text' }, { revision: 3 }, { digest: hash('changed') }]) {
    const changed = structuredClone(documents); Object.assign(changed[0], change);
    const proof = await PostgresInvestigationSearch.fromPool(injected({ matches: [] }).pool).search(projection(changed), request());
    assert.notEqual(proof.projectionDigest, first.projectionDigest);
  }
  const empty = await PostgresInvestigationSearch.fromPool(injected({ matches: [] }).pool).search(projection([]), request());
  assert.deepEqual(empty.matches, []); assert.equal(empty.completeness.documents, 0); assert.equal(empty.completeness.matchedDocuments, 0);
});

test('incomplete, duplicate and malformed host projections refuse before SQL acquisition', async () => {
  const cases: [unknown, string][] = [
    [{ ...projection(), complete: false }, 'SEARCH_PROJECTION_INCOMPLETE'], [{ ...projection(), expectedDocuments: 3 }, 'SEARCH_PROJECTION_INCOMPLETE'],
    [projection([documents[0], documents[0]]), 'SEARCH_DOCUMENT_INVALID'], [projection([{ ...documents[0], revision: -1 }]), 'SEARCH_DOCUMENT_INVALID'],
    [projection([{ ...documents[0], digest: 'old-digest' }]), 'SEARCH_DOCUMENT_INVALID'], [projection([{ ...documents[0], kind: 'conversation' } as any]), 'SEARCH_DOCUMENT_INVALID'],
    [projection([{ ...documents[0], text: '\ud800' }]), 'SEARCH_DOCUMENT_INVALID'], [projection([{ ...documents[0], text: 'null\0text' }]), 'SEARCH_DOCUMENT_INVALID'],
    [{ ...projection(), missingDocuments: 1 }, 'SEARCH_CONFIGURATION_INVALID'],
  ];
  for (const [value, code] of cases) { const fixture = injected(); await assert.rejects(PostgresInvestigationSearch.fromPool(fixture.pool).search(value as any, request()), { code }); assert.equal(fixture.connected(), 0); }
});

test('method, explicit bounds, unknown options and query shape fail closed before acquisition', async () => {
  const cases: [unknown, string][] = [
    [{ ...request(), method: 'ranked-top-k' }, 'SEARCH_METHOD_UNSUPPORTED'], [{ query: 'saffron', bounds: request().bounds }, 'SEARCH_CONFIGURATION_INVALID'],
    [{ ...request(), bounds: { maxDocuments: 2, maxMatches: 2 } }, 'SEARCH_CONFIGURATION_INVALID'],
    [{ ...request(), bounds: { ...request().bounds, maxDocuments: 0 } }, 'SEARCH_LIMIT_INVALID'], [{ ...request(), bounds: { ...request().bounds, maxMatches: 10001 } }, 'SEARCH_LIMIT_INVALID'],
    [{ ...request(), sample: 1 }, 'SEARCH_CONFIGURATION_INVALID'], [request(' '), 'SEARCH_QUERY_INVALID'], [request('x'.repeat(4097)), 'SEARCH_QUERY_INVALID'], [request('\udc00'), 'SEARCH_QUERY_INVALID'],
  ];
  for (const [value, code] of cases) { const fixture = injected(); await assert.rejects(PostgresInvestigationSearch.fromPool(fixture.pool).search(projection(), value as any), { code }); assert.equal(fixture.connected(), 0); }
  assert.throws(() => PostgresInvestigationSearch.fromPool(injected().pool, { operationTimeoutMs: 49 }), { code: 'SEARCH_LIMIT_INVALID' });
  assert.throws(() => PostgresInvestigationSearch.fromPool(injected().pool, { timeout: 100 } as any), { code: 'SEARCH_CONFIGURATION_INVALID' });
});

test('document and UTF-8 byte bounds reject the full corpus without sampling', async () => {
  for (const [input, query, code] of [
    [projection(), { ...request(), bounds: { ...request().bounds, maxDocuments: 1 } }, 'SEARCH_DOCUMENT_LIMIT'],
    [projection([document('unicode', 'λ雪')]), { ...request(), bounds: { ...request().bounds, maxTextBytes: 4 } }, 'SEARCH_TEXT_LIMIT'],
  ] as const) { const fixture = injected(); await assert.rejects(PostgresInvestigationSearch.fromPool(fixture.pool).search(input, query), { code }); assert.equal(fixture.connected(), 0); }
});

test('empty parsed query refuses and complete match overflow never returns a truncated result', async () => {
  const noTerms = injected({ terms: 0 }); await assert.rejects(PostgresInvestigationSearch.fromPool(noTerms.pool).search(projection(), request('!!!')), { code: 'SEARCH_EMPTY_TERMS' });
  assert(!noTerms.calls.some(call => call.sql.startsWith('CREATE TEMP'))); assert.equal(noTerms.calls.at(-1)!.sql, 'ROLLBACK');
  const overflow = injected(); const query = request(); query.bounds.maxMatches = 1;
  await assert.rejects(PostgresInvestigationSearch.fromPool(overflow.pool).search(projection(), query), { code: 'SEARCH_MATCH_LIMIT' });
  assert.deepEqual(overflow.calls.find(call => call.sql.startsWith('SELECT id,'))!.values, ['saffron', 2]); assert.equal(overflow.calls.at(-1)!.sql, 'ROLLBACK');
});

test('unprojected, duplicate and stale SQL matches cannot enter released metadata', async () => {
  for (const rows of [[{ ...match(documents[0]), id: 'denied-document' }], [match(documents[0]), match(documents[0])], [{ ...match(documents[0]), revision: '1' }], [{ ...match(documents[0]), digest: hash('other') }]]) {
    const fixture = injected({ matches: rows }); await assert.rejects(PostgresInvestigationSearch.fromPool(fixture.pool).search(projection(), request()), { code: 'SEARCH_RESULT_INVALID' });
    assert.equal(fixture.calls.at(-1)!.sql, 'ROLLBACK'); assert.deepEqual(fixture.releases, [undefined]);
  }
});

test('driver errors and server interruption roll back without exposing private driver messages', async () => {
  for (const serverTimeout of [false, true]) {
    const fixture = injected({ fail: 'search', serverTimeout });
    await assert.rejects(PostgresInvestigationSearch.fromPool(fixture.pool).search(projection(), request()), error => { assert.equal((error as any).code, serverTimeout ? 'SEARCH_TIMEOUT' : 'SEARCH_SQL_FAILED'); assert(!String(error).includes('private-text')); return true; });
    assert.equal(fixture.calls.at(-1)!.sql, 'ROLLBACK'); assert.deepEqual(fixture.releases, [undefined]);
  }
  const rollback = injected({ fail: 'rollback' }); await assert.rejects(PostgresInvestigationSearch.fromPool(rollback.pool).search(projection(), request()), { code: 'SEARCH_SQL_FAILED' }); assert(rollback.releases[0] instanceof Error);
  const begin = injected({ fail: 'begin' }); await assert.rejects(PostgresInvestigationSearch.fromPool(begin.pool).search(projection(), request()), { code: 'SEARCH_SQL_FAILED' }); assert(begin.releases[0] instanceof Error); assert.equal(begin.calls.length, 1);
});

test('one deadline includes acquisition, initialization, SQL and rollback and discards late clients', { timeout: 1500 }, async () => {
  for (const hang of ['acquire', 'begin', 'search', 'rollback'] as const) {
    const fixture = injected({ hang }); await assert.rejects(PostgresInvestigationSearch.fromPool(fixture.pool, { operationTimeoutMs: 50 }).search(projection(), request()), { code: 'SEARCH_TIMEOUT' });
    assert.equal(fixture.releases.length, hang === 'acquire' ? 0 : 1); if (hang !== 'acquire') assert(fixture.releases[0] instanceof Error);
  }
  const late = injected(); let arrive!: (client: typeof late.client) => void;
  const pool: InvestigationSearchPool = { connect: () => new Promise(resolve => { arrive = resolve; }), async end() {} };
  await assert.rejects(PostgresInvestigationSearch.fromPool(pool, { operationTimeoutMs: 50 }).search(projection(), request()), { code: 'SEARCH_TIMEOUT' });
  arrive(late.client); await new Promise(resolve => setImmediate(resolve)); assert.equal(late.calls.length, 0); assert.equal(late.releases.length, 1); assert(late.releases[0] instanceof Error);
});

test('closing injected search aborts its active work and preserves caller-owned pool', async () => {
  const fixture = injected({ hang: 'search' }); const search = PostgresInvestigationSearch.fromPool(fixture.pool);
  const result = search.search(projection(), request()); await new Promise(resolve => setImmediate(resolve));
  await search.close(); await assert.rejects(result, { code: 'SEARCH_TIMEOUT' }); assert.equal(fixture.ended(), false); assert.equal(fixture.releases.length, 1);
});

test('native configuration rejects remote or unknown driver controls before opening a database', async () => {
  const valid = { host: '127.0.0.1', port: 5432, user: 'synthetic', password: 'synthetic', database: 'chausar_test' };
  for (const value of [{ ...valid, host: 'localhost' }, { ...valid, port: 1023 }, { ...valid, maxConnections: 5 }, { ...valid, user: '' }, { ...valid, password: 'private\nvalue' }, { ...valid, options: '-c search_path=public' }]) await assert.rejects(PostgresInvestigationSearch.connect(value as any), { code: Object.hasOwn(value, 'options') ? 'SEARCH_CONFIGURATION_INVALID' : 'INVALID_POSTGRES_CONFIG' });
});
