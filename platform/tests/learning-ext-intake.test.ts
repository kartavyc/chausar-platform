import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { randomBytes } from 'node:crypto';
import * as desktopVocabulary from '../runtime/learning-ext/vocabulary.ts';
import { batchBytes, structuralEvent } from '../runtime/learning-ext/structure.ts';
import type { StructuralBatch as DesktopBatch } from '../runtime/learning-ext/vocabulary.ts';
import * as intakeVocabulary from '../../hosted/learning-intake/src/vocabulary.ts';
import { startIntakeServer, type IntakeOptions } from '../../hosted/learning-intake/src/server.ts';
import { MemoryIntakeStore, PostgresIntakeStore, type IntakeStore, type PoolLike, type Queryable } from '../../hosted/learning-intake/src/store.ts';
import { scanEvents } from '../../hosted/learning-intake/src/validate.ts';

type Reply = { status: number; text: string; json: any };
const token = () => randomBytes(32).toString('base64url');

async function call(base: string, method: string, path: string, headers: Record<string, string> = {}, body?: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(`${base}${path}`, { method, headers: body === undefined ? headers : { 'content-length': String(Buffer.byteLength(body)), ...headers } }, res => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); resolve({ status: res.statusCode ?? 0, text, json: text ? JSON.parse(text) : undefined }); });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const desktopBatch = (boxes: DesktopBatch['boxes'] = ['setup-shapes', 'corrections']): DesktopBatch => ({
  schema: 'chausar.learning.v1', boxes,
  events: [
    structuralEvent({ kind: 'mapping', choice: 'accepted', reason: 'type-match', system: 'tally', shape: 'ledger',
      fields: [{ name: 'invoiceId', type: 'string' }, { name: 'amount_minor', type: 'money' }, ['date', 'date'], ['due date', 'date'], ['private_column', 'string']] }),
    structuralEvent({ kind: 'accounts-label', choice: 'corrected', accountClass: 'bank', proposedClass: 'cash', confidence: 'medium', evidence: ['parent-group', 'name-keyword'] }),
    structuralEvent({ kind: 'procedure', choice: 'proposed', steps: ['question', 'calculator'] }),
  ],
});
const wrap = (batchText: string, publicName: string | null = null) => `{"batch":${batchText},"contributor":{"publicName":${JSON.stringify(publicName)}}}`;
const header = (boxes = '["corrections"]') => `{"schema":"chausar.learning.v1","boxes":${boxes},"events":[`;
const rawBatch = (lines: string[], boxes?: string) => [header(boxes), ...lines.map((line, index) => index < lines.length - 1 ? `${line},` : line), ']}'].join('\n');
const good = '{"choice":"accepted","kind":"mapping"}';

async function service(t: TestContext, options: Partial<IntakeOptions> = {}) {
  const store = options.store ?? new MemoryIntakeStore();
  const running = await startIntakeServer({ store, open: true, rateLimit: false, ...options, port: 0, host: '127.0.0.1' });
  t.after(() => running.close());
  const bearer = token();
  const post = (body: string, extra: Record<string, string> = {}, who = bearer) => call(running.url, 'POST', '/v1/batches', {
    'content-type': 'application/json', authorization: `Bearer ${who}`, 'idempotency-key': `key-${randomBytes(6).toString('hex')}`, 'x-deletion-token': token(), ...extra,
  }, body);
  return { url: running.url, store, bearer, post };
}

test('intake vocabulary is an identical copy of the desktop vocabulary', () => {
  assert.deepEqual(Object.keys(intakeVocabulary).sort(), Object.keys(desktopVocabulary).sort());
  for (const key of Object.keys(desktopVocabulary)) assert.deepEqual((intakeVocabulary as any)[key], (desktopVocabulary as any)[key], key);
});

test('status reports the open state, schema and open boxes', async t => {
  const { url } = await service(t);
  assert.deepEqual((await call(url, 'GET', '/v1/status')).json, { open: true, schema: 'chausar.learning.v1', boxes: ['setup-shapes', 'corrections'] });
  assert.equal((await call(url, 'POST', '/v1/status')).json.error.code, 'METHOD_NOT_ALLOWED');
  assert.equal((await call(url, 'GET', '/v1/batches')).status, 405);
  assert.equal((await call(url, 'GET', '/v1/nothing')).json.error.code, 'NOT_FOUND');
});

for (const kind of ['memory', 'postgres'] as const) {
  test(`${kind}: desktop batch bytes are accepted with credits, replayed and conflicted by idempotency key`, async t => {
    const store: IntakeStore = kind === 'memory' ? new MemoryIntakeStore() : new PostgresIntakeStore(new FakePostgres());
    const { url, post, bearer } = await service(t, { store });
    const batch = desktopBatch();
    const body = wrap(batchBytes(batch), 'Asha Rao');
    const deletion = token();
    const headers = { 'idempotency-key': 'desktop:batch-one', 'x-deletion-token': deletion };
    const first = await post(body, headers);
    assert.equal(first.status, 201, first.text);
    assert.match(first.json.reference, /^lb_[A-Za-z0-9_-]{22}$/);
    assert.deepEqual(first.json, { reference: first.json.reference, accepted: 3, credits: 3, replayed: false });
    const stored = await store.getBatch(first.json.reference);
    assert.deepEqual(stored?.events, batch.events);
    assert.deepEqual(stored?.boxes, ['setup-shapes', 'corrections']);

    const replay = await post(body, { 'idempotency-key': 'desktop:batch-one', 'x-deletion-token': token() });
    assert.equal(replay.status, 200);
    assert.deepEqual(replay.json, { reference: first.json.reference, accepted: 3, credits: 3, replayed: true });
    const conflict = await post(wrap(batchBytes(desktopBatch(['corrections'])), 'Asha Rao'), headers);
    assert.equal(conflict.status, 409);
    assert.deepEqual(conflict.json, { error: { code: 'IDEMPOTENCY_CONFLICT' } });
    assert.equal((await post(body, headers, token())).json.error.code, 'IDEMPOTENCY_CONFLICT', 'another contributor cannot replay a key');

    const compact = await post(JSON.stringify({ batch, contributor: { publicName: 'Asha Rao' } }));
    assert.equal(compact.status, 201, 'compact JSON is accepted; the schema digit lies outside the events');
    assert.deepEqual((await call(url, 'GET', '/v1/credits', { authorization: `Bearer ${bearer}` })).json, { credits: 6, publicName: 'Asha Rao' });

    // Delete: the replay's deletion token was not kept, the first one was.
    assert.equal((await call(url, 'DELETE', `/v1/batches/${first.json.reference}`, { 'x-deletion-token': token() })).status, 403);
    const removed = await call(url, 'DELETE', `/v1/batches/${first.json.reference}`, { 'x-deletion-token': deletion });
    assert.deepEqual([removed.status, removed.json], [200, { deleted: true }]);
    const after = await store.getBatch(first.json.reference);
    assert.deepEqual(after?.events, []);
    assert.ok(after?.deletedAt);
    assert.deepEqual((await call(url, 'GET', '/v1/credits', { authorization: `Bearer ${bearer}` })).json, { credits: 3, publicName: 'Asha Rao' });
    assert.equal((await call(url, 'DELETE', `/v1/batches/${first.json.reference}`, { 'x-deletion-token': deletion })).json.error.code, 'NOT_FOUND');
    assert.equal((await call(url, 'DELETE', '/v1/batches/lb_unknown', { 'x-deletion-token': deletion })).status, 404);
    assert.equal((await post(body, headers)).json.error.code, 'NOT_FOUND', 'a deleted batch is not replayed');
  });

  test(`${kind}: public credits list only named contributors, sorted, and names update`, async t => {
    const store: IntakeStore = kind === 'memory' ? new MemoryIntakeStore() : new PostgresIntakeStore(new FakePostgres());
    const { url, post } = await service(t, { store });
    const [a, b, c] = [token(), token(), token()];
    const one = rawBatch([good]), two = rawBatch([good, good]);
    assert.equal((await post(wrap(one, 'Zoya'), {}, a)).status, 201);
    assert.equal((await post(wrap(two, null), {}, b)).status, 201);
    assert.equal((await post(wrap(one, "Dev O'Neil-Shah"), {}, c)).status, 201);
    assert.equal((await post(wrap(two, 'Bina'), {}, c)).status, 201);
    assert.deepEqual((await call(url, 'GET', '/v1/credits/public')).json, [{ publicName: 'Bina', credits: 3 }, { publicName: 'Zoya', credits: 1 }]);
    assert.equal((await post(wrap(one, null), {}, a)).status, 201);
    assert.deepEqual((await call(url, 'GET', '/v1/credits/public')).json, [{ publicName: 'Bina', credits: 3 }]);
    assert.deepEqual((await call(url, 'GET', '/v1/credits', { authorization: `Bearer ${a}` })).json, { credits: 2, publicName: null });
    assert.deepEqual((await call(url, 'GET', '/v1/credits', { authorization: `Bearer ${token()}` })).json, { credits: 0, publicName: null });
  });
}

test('every value pattern is refused by line, and no value is echoed', async t => {
  const { post } = await service(t);
  const samples: [string, string][] = [
    ['GSTIN', '27ABCDE1234F1Z5'], ['PAN', 'ABCDE1234F'], ['IFSC', 'HDFC0001234'], ['UPI', 'shopowner@okaxis'],
    ['MAIL', 'owner@example.com'], ['PHONE', '+91 98765 43210'], ['DIGITS', 'sku-42'],
  ];
  for (const [code, value] of samples) {
    const body = wrap(rawBatch([good, good, `{"choice":"accepted","kind":"mapping","reason":${JSON.stringify(value)}}`, good]));
    const reply = await post(body);
    assert.equal(reply.status, 422, code);
    assert.equal(reply.json.error.code, 'VALUE_FOUND');
    assert.ok(reply.json.error.hits.some((hit: any) => hit.line === 4 && hit.code === code), `${code}: ${reply.text}`);
    assert.ok(reply.json.error.hits.every((hit: any) => hit.line === 4 && Object.keys(hit).sort().join() === 'code,line'));
    assert.ok(!reply.text.includes(value) && !reply.text.includes(value.slice(0, 5)), `${code} is not echoed`);
  }
  // A value hidden in a key, or behind a unicode escape, is still found on its line.
  const keyed = await post(wrap(rawBatch([good, '{"choice":"accepted","kind":"mapping","row7":"x"}'])));
  assert.deepEqual(keyed.json, { error: { code: 'VALUE_FOUND', hits: [{ line: 3, code: 'DIGITS' }] } });
  const escaped = await post(wrap(rawBatch(['{"choice":"accepted","kind":"\\u006dapping"}'])));
  assert.equal(escaped.json.error.code, 'VALUE_FOUND');
  // Values outside the events are refused by the schema, not reported as lines.
  assert.deepEqual(scanEvents(wrap(rawBatch([good]))), []);
  assert.equal((await post(wrap(rawBatch([good]), 'owner@example.com'))).json.error.code, 'INVALID_BATCH');
  assert.equal((await post(wrap(rawBatch([good]), 'Ravi 2'))).json.error.code, 'INVALID_BATCH');
});

test('unknown keys, tokens and shapes are refused', async t => {
  const { post } = await service(t, { maxBytes: 4 * 1024 * 1024 });
  const refused = async (body: string, code = 'INVALID_BATCH') => {
    const reply = await post(body);
    assert.deepEqual(reply.json, { error: { code } }, body.slice(0, 200));
  };
  await refused(wrap(rawBatch(['{"choice":"accepted","kind":"mapping","note":"free text"}'])));
  await refused(wrap(rawBatch(['{"choice":"accepted","kind":"mapping","reason":"made-up"}'])));
  await refused(wrap(rawBatch(['{"choice":"accepted","kind":"guess"}'])));
  await refused(wrap(rawBatch(['{"kind":"mapping"}'])));
  await refused(wrap(rawBatch(['{"choice":"accepted","kind":"mapping","evidence":["owner","library"]}'])));
  await refused(wrap(rawBatch(['{"choice":"accepted","kind":"mapping","evidence":["library","library"]}'])));
  await refused(wrap(rawBatch(['{"choice":"accepted","fields":[["colour","string"]],"kind":"mapping"}'])));
  await refused(wrap(rawBatch(['{"choice":"accepted","fields":[["date","date"],["amount","decimal"]],"kind":"mapping"}'])));
  await refused(wrap(rawBatch(['{"choice":"accepted","fields":[["date","money"]],"kind":"mapping"}'])));
  await refused(wrap(rawBatch(['{"choice":"accepted","kind":"mapping","system":["tally"]}'])));
  await refused(wrap(rawBatch(['"mapping"'])));
  await refused(wrap(rawBatch([good], '["corrections","corrections"]')));
  await refused(wrap(rawBatch([good], '["everything"]')));
  await refused(wrap(rawBatch([good], '[]')));
  await refused(wrap(`{"schema":"chausar.learning.v2","boxes":["corrections"],"events":[\n${good}\n]}`));
  await refused(wrap('{"schema":"chausar.learning.v1","boxes":["corrections"],"events":[]}'));
  await refused(wrap(`{"schema":"chausar.learning.v1","boxes":["corrections"],"events":[${Array(5001).fill(good).join(',')}]}`));
  await refused(`{"batch":${rawBatch([good])},"contributor":{"publicName":null},"extra":true}`);
  await refused(`{"batch":${rawBatch([good])},"contributor":{"publicName":null,"mail":null}}`);
  await refused('{"batch":');
  await refused(wrap(rawBatch([good]), 'A'));
  await refused(wrap(rawBatch([good], '["account-words"]')), 'BOX_NOT_OPEN');
  await refused(wrap(rawBatch([good], '["corrections","question-shapes"]')), 'BOX_NOT_OPEN');
});

test('requests are refused by header, size, state and rate', async t => {
  let now = Date.parse('2026-10-14T10:00:00Z');
  const { post, url, bearer } = await service(t, { maxBytes: 512, rateLimit: { max: 2, windowMs: 60_000 }, clock: () => new Date(now) });
  const body = wrap(rawBatch([good]));
  assert.equal((await post(body, { authorization: '' })).status, 401);
  assert.equal((await post(body, { authorization: 'Bearer short' })).json.error.code, 'UNAUTHORIZED');
  assert.equal((await call(url, 'GET', '/v1/credits')).status, 401);
  const fresh = token();
  assert.equal((await post(body, { 'idempotency-key': 'bad key!' }, fresh)).json.error.code, 'INVALID_BATCH');
  assert.equal((await post(body, { 'x-deletion-token': '' }, fresh)).json.error.code, 'INVALID_BATCH');
  assert.equal((await post(body, { 'content-type': 'text/plain' }, token())).json.error.code, 'INVALID_BATCH');
  const large = await post(wrap(rawBatch(Array(40).fill(good))), {}, token());
  assert.deepEqual([large.status, large.json], [413, { error: { code: 'TOO_LARGE' } }]);
  assert.equal((await post(body)).status, 201);
  assert.equal((await post(body)).status, 201);
  const limited = await post(body);
  assert.deepEqual([limited.status, limited.json], [429, { error: { code: 'RATE_LIMITED' } }]);
  assert.equal((await call(url, 'GET', '/v1/credits', { authorization: `Bearer ${bearer}` })).status, 429);
  now += 60_000;
  assert.equal((await post(body)).status, 201);
});

test('a closed intake refuses batches with 503', async t => {
  const { post, url } = await service(t, { open: false });
  assert.equal((await call(url, 'GET', '/v1/status')).json.open, false);
  const reply = await post(wrap(rawBatch([good])));
  assert.deepEqual([reply.status, reply.json], [503, { error: { code: 'INTAKE_CLOSED' } }]);
});

test('postgres store uses parameterised SQL and a transaction for every put', async () => {
  const pool = new FakePostgres();
  const store = new PostgresIntakeStore(pool);
  const secretHash = 'a'.repeat(64), deletionHash = 'b'.repeat(64);
  const events = desktopBatch().events;
  const input = {
    reference: 'lb_one', idempotencyKey: 'key-one', contributorHash: secretHash, publicName: 'Asha', bodyDigest: 'c'.repeat(64),
    boxes: ['corrections'], events, receivedAt: '2026-10-14T10:00:00.000Z', deletionTokenHash: deletionHash,
  };
  const created = await store.putBatch(input);
  assert.equal(created.created, true);
  assert.equal(created.batch.eventCount, 3);
  const statements = pool.log.map(entry => entry.text.split(' ')[0]);
  assert.deepEqual(statements.slice(0, 6), ['BEGIN', 'INSERT', 'INSERT', 'INSERT', 'INSERT', 'COMMIT']);
  assert.ok(pool.log.slice(0, 6).every(entry => entry.client), 'the put runs on one checked-out client');
  assert.equal(pool.released, 1);

  // Replay: the contributor update is rolled back and the stored batch is returned unchanged.
  const replay = await store.putBatch({ ...input, reference: 'lb_two', publicName: 'Other' });
  assert.deepEqual([replay.created, replay.batch.reference], [false, 'lb_one']);
  assert.equal((await store.credits(secretHash)).publicName, 'Asha');
  assert.ok(pool.log.some(entry => entry.text === 'ROLLBACK'));

  // A failure mid-put rolls back everything written in the transaction.
  pool.failOn = /^INSERT INTO credits/;
  await assert.rejects(store.putBatch({ ...input, reference: 'lb_three', idempotencyKey: 'key-three', contributorHash: 'd'.repeat(64) }), /injected/);
  pool.failOn = undefined;
  assert.equal(await store.getBatch('lb_three'), undefined);
  assert.deepEqual(await store.credits('d'.repeat(64)), { credits: 0, publicName: null });
  assert.equal(pool.state.events.filter(row => row.batch_reference === 'lb_three').length, 0);

  assert.equal(await store.deleteBatch('lb_one', 'e'.repeat(64), '2026-10-14T11:00:00.000Z'), 'forbidden');
  assert.equal(await store.deleteBatch('lb_one', deletionHash, '2026-10-14T11:00:00.000Z'), 'deleted');
  assert.equal(pool.state.events.length, 0);
  assert.equal(pool.state.credits.length, 0);

  // No token hash, event text or name is ever spliced into SQL text.
  const secrets = [secretHash, deletionHash, 'Asha', 'Other', 'tally', 'lb_one', 'key-one'];
  for (const entry of pool.log) {
    for (const secret of secrets) assert.ok(!entry.text.includes(secret), `${secret} in ${entry.text}`);
    const placeholders = new Set([...entry.text.matchAll(/\$(\d+)/g)].map(match => Number(match[1])));
    assert.equal(placeholders.size, entry.params?.length ?? 0, entry.text);
  }
});

/**
 * A small in-test PostgreSQL stand-in. It understands exactly the statements the store sends,
 * records every (text, params) pair, and snapshots state on BEGIN so ROLLBACK really undoes work.
 */
type Row = Record<string, any>;
class FakePostgres implements PoolLike {
  state = { contributors: [] as Row[], batches: [] as Row[], events: [] as Row[], credits: [] as Row[] };
  log: { text: string; params?: unknown[]; client: boolean }[] = [];
  failOn: RegExp | undefined;
  released = 0;
  #snapshot: FakePostgres['state'] | undefined;
  #serial = 0;

  async connect(): Promise<Queryable & { release(): void }> {
    return { query: (text, params) => this.#run(text, params, true), release: () => { this.released += 1; } };
  }
  query(text: string, params?: unknown[]) { return this.#run(text, params, false); }

  async #run(text: string, params: unknown[] = [], client: boolean): Promise<{ rows: Row[]; rowCount: number }> {
    this.log.push({ text, params: text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK' ? undefined : params, client });
    if (this.failOn?.test(text)) throw new Error('injected failure');
    const s = this.state, p = params as any[];
    const done = (rows: Row[] = []) => ({ rows, rowCount: rows.length });
    if (text === 'BEGIN') { this.#snapshot = structuredClone(s); return done(); }
    if (text === 'COMMIT') { this.#snapshot = undefined; return done(); }
    if (text === 'ROLLBACK') { if (this.#snapshot) this.state = this.#snapshot; this.#snapshot = undefined; return done(); }
    if (text.startsWith('INSERT INTO contributors')) {
      let row = s.contributors.find(item => item.token_hash === p[1]);
      if (row) row.public_name = p[2]; else s.contributors.push(row = { id: p[0], token_hash: p[1], public_name: p[2], created_at: p[3] });
      return done([{ id: row.id }]);
    }
    if (text.startsWith('INSERT INTO batches')) {
      if (s.batches.some(item => item.idempotency_key === p[1])) return done();
      s.batches.push({ reference: p[0], idempotency_key: p[1], contributor_id: p[2], body_digest: p[3], boxes: [...p[4]], event_count: p[5], received_at: new Date(p[6]), deleted_at: null, deletion_token_hash: p[7] });
      return done([{ reference: p[0] }]);
    }
    if (text.startsWith('INSERT INTO events')) {
      (JSON.parse(p[1]) as unknown[]).forEach((event, position) => s.events.push({ batch_reference: p[0], position, event }));
      return done();
    }
    if (text.startsWith('INSERT INTO credits')) { s.credits.push({ id: ++this.#serial, contributor_id: p[0], batch_reference: p[1], amount: p[2], created_at: p[3] }); return done(); }
    if (text.startsWith('SELECT reference FROM batches')) return done(s.batches.filter(item => item.idempotency_key === p[0]).map(item => ({ reference: item.reference })));
    if (text.startsWith('SELECT b.reference')) {
      return done(s.batches.filter(item => item.reference === p[0]).map(item => ({ ...item, token_hash: s.contributors.find(c => c.id === item.contributor_id)?.token_hash })));
    }
    if (text.startsWith('SELECT event FROM events')) return done(s.events.filter(row => row.batch_reference === p[0]).sort((a, b) => a.position - b.position).map(row => ({ event: row.event })));
    if (text.startsWith('SELECT deletion_token_hash')) return done(s.batches.filter(item => item.reference === p[0]));
    if (text.startsWith('DELETE FROM events')) { s.events = s.events.filter(row => row.batch_reference !== p[0]); return done(); }
    if (text.startsWith('DELETE FROM credits')) { s.credits = s.credits.filter(row => row.batch_reference !== p[0]); return done(); }
    if (text.startsWith('UPDATE batches SET deleted_at')) { for (const item of s.batches) if (item.reference === p[0]) item.deleted_at = new Date(p[1]); return done(); }
    if (text.startsWith('SELECT c.public_name')) {
      const sum = (id: string) => s.credits.filter(row => row.contributor_id === id).reduce((total, row) => total + row.amount, 0);
      if (text.includes('c.token_hash = $1')) return done(s.contributors.filter(c => c.token_hash === p[0]).map(c => ({ public_name: c.public_name, credits: String(sum(c.id)) })));
      return done(s.contributors.filter(c => c.public_name !== null && s.credits.some(row => row.contributor_id === c.id)).map(c => ({ public_name: c.public_name, credits: String(sum(c.id)) })));
    }
    throw new Error(`Fake PostgreSQL does not understand: ${text}`);
  }
}
