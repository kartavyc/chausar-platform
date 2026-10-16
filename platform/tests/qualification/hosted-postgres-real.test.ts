// Qualification run: the hosted tier on a real PostgreSQL server. The open suite checks the same statements against a
// stand-in (hosted-postgres-standin.ts) and never dials a database, so CI does not qualify PostgreSQL. This file does,
// and it lives in a subfolder so the open benchmark (platform/tests/*.test.ts) never picks it up. It qualifies:
//   - the sealed account directory: two pools changing one directory row at once, with every change landing;
//   - a business vault in its own row: made on one server, opened from another data folder, gone after delete;
//   - the six runtime conformance checks (hosted-runtime-conformance.ts) on the local runtime with every business
//     vault in the real database.
// Point it at a disposable database on this computer's loopback; it writes rows and deletes only the rows it made.
// It needs the pg package, so run `npm install` first. Then:
//   CHAUSAR_TEST_POSTGRES_URL=postgres://user:password@127.0.0.1:5432/db node --test platform/tests/qualification/hosted-postgres-real.test.ts
// Without that variable (or with one that is not a loopback PostgreSQL URL) it fails with one test that says so. It
// never skips, so a qualification run can't pass by accident.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLoopbackPool, loopbackPostgresUrl, type PostgresPool } from '../../runtime/postgres.ts';
import { HostedCustody, newBusinessId, newTenantId } from '../../runtime/hosted/custody.ts';
import { PostgresDirectory, prepareHostedTables, type DirectoryState, type HostedUser } from '../../runtime/hosted/directory.ts';
import { BusinessEngine, hostedVaultSlot } from '../../runtime/hosted/runtime/business.ts';
import type { ActorKey } from '../../runtime/hosted/runtime/contract.ts';
import { noNetwork, runtimeConformance } from '../hosted-runtime-conformance.ts';

const IDEA = 'Monthly bookkeeping for cafes and small shops in Pune, done by AI helpers with me checking every report.';
const custodyKey = () => randomBytes(32).toString('base64url');
const engineOptions = () => ({ demo: true, storage: 'postgres' as const, venture: { host: 'hosted-web' as const, modelTransport: noNetwork } });
const user = (id: string): HostedUser => ({ id, tenantId: newTenantId(), email: `${id}@example.com`, userHandle: id, createdAt: 'x', verifiedAt: 'x', status: 'active', passkeys: [], businesses: [] });
const ids = (state: DirectoryState) => state.users.map(item => item.id);

async function folder(t: any, label: string) {
  const path = await mkdtemp(join(tmpdir(), `chausar-hosted-pg-${label}-`));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

const POSTGRES_URL = process.env.CHAUSAR_TEST_POSTGRES_URL;
let refusal: string | null = null;
if (!POSTGRES_URL) refusal = 'CHAUSAR_TEST_POSTGRES_URL is not set.';
else {
  try { loopbackPostgresUrl(POSTGRES_URL); } catch (error: any) { refusal = `CHAUSAR_TEST_POSTGRES_URL was refused: ${error?.message}`; }
}

/** A pool on the real server. Cleanups run in the order they were added, so a test adds its row deletions with
 * cleanup() and they run before the pools close. */
async function realPools(t: any, count: number): Promise<{ pools: PostgresPool[]; cleanup(work: () => Promise<unknown>): void }> {
  const pools: PostgresPool[] = [];
  for (let i = 0; i < count; i++) pools.push(await openLoopbackPool(loopbackPostgresUrl(POSTGRES_URL!), 'chausar-test'));
  const cleanups: (() => Promise<unknown>)[] = [];
  t.after(async () => {
    try { for (const work of cleanups) await work(); }
    finally { await Promise.all(pools.map(pool => pool.end())); }
  });
  return { pools, cleanup: work => { cleanups.push(work); } };
}

if (refusal !== null) {
  const reason = refusal;
  test('CHAUSAR_TEST_POSTGRES_URL must point at a disposable loopback database', () => {
    assert.fail(`${reason} This qualification run needs a disposable PostgreSQL database on this computer's loopback, for example `
      + 'CHAUSAR_TEST_POSTGRES_URL=postgres://user:password@127.0.0.1:5432/db node --test platform/tests/qualification/hosted-postgres-real.test.ts '
      + '(after npm install, for the pg package). Nothing was checked against PostgreSQL.');
  });
} else {
  test('real PostgreSQL: two pools change one directory row at once and every change lands', async t => {
    const { pools: [poolA, poolB], cleanup } = await realPools(t, 2);
    const custody = HostedCustody.fromKey(custodyKey()), slot = `test.${randomBytes(8).toString('hex')}`;
    cleanup(() => poolA.query('DELETE FROM public.chausar_hosted_directory WHERE slot = $1', [slot]));
    const a = await PostgresDirectory.open(poolA, custody, { slot }), b = await PostgresDirectory.open(poolB, custody, { slot });
    await Promise.all(Array.from({ length: 10 }, (_, i) => [
      a.update(state => { state.users.push(user(`huser_a${i}`)); }),
      b.update(state => { state.users.push(user(`huser_b${i}`)); }),
    ]).flat());
    await a.refresh(); await b.refresh();
    assert.equal(a.read().users.length, 20);
    assert.equal(a.read().revision, 20);
    assert.deepEqual(ids(b.read()).sort(), ids(a.read()).sort());
    const row = await poolA.query('SELECT revision FROM public.chausar_hosted_directory WHERE slot = $1', [slot]);
    assert.equal(String(row.rows[0].revision), '20');
    await a.close(); await b.close();
  });

  test('real PostgreSQL: a business vault lives in its own row, opens elsewhere, and is gone after delete', async t => {
    const { pools: [pool], cleanup } = await realPools(t, 1), custody = HostedCustody.fromKey(custodyKey());
    await prepareHostedTables(pool);
    const key: ActorKey = [newTenantId(), newBusinessId()], slot = hostedVaultSlot(key), passphrase = custody.newVaultPassphrase();
    cleanup(() => pool.query('DELETE FROM public.chausar_vault_authority WHERE slot = $1', [slot]));
    const rootA = await folder(t, 'real-a'), rootB = await folder(t, 'real-b');
    const { business: a } = await BusinessEngine.create({ root: rootA, engineOptions, postgres: pool }, key, { name: 'Real Row Books', passphrase });
    await a.request('venture.create', { idea: IDEA, countryCode: 'IN' });
    await a.close();
    assert.equal((await pool.query('SELECT slot FROM public.chausar_vault_authority WHERE slot = $1', [slot])).rows.length, 1);
    const b = await BusinessEngine.open({ root: rootB, engineOptions, postgres: pool }, key, passphrase);
    assert.equal((await b.request('workspace.status', {}) as any).workspace.name, 'Real Row Books');
    assert.ok((await b.request('venture.get', {}) as any).venture.id);
    await b.delete(rootB, 'Real Row Books');
    assert.equal((await pool.query('SELECT slot FROM public.chausar_vault_authority WHERE slot = $1', [slot])).rows.length, 0);
  });

  runtimeConformance(['local-real-postgres']);
}
