import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { PostgresSnapshotAdapter, type PostgresOptions } from '../runtime/postgres.ts';
import { openEnterpriseStorePool } from '../../enterprise/server/state-store.ts';
import { enterpriseDatabase } from '../../enterprise/server/main.ts';
import { parseEnterpriseConfig } from '../../enterprise/server/config.ts';
import { realPostgresUnavailable, startTlsPostgres } from '../../enterprise/server/testing/real-postgres.ts';

const remoteUrl = 'postgresql://synthetic:public-synthetic-password@192.0.2.10:5432/synthetic';
const fakeCa = '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n';
const passphrase = 'synthetic remote database passphrase';
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, String(error?.message)); return true; };
async function scratch(t: any) { const directory = await mkdtemp(join(tmpdir(), 'chausar-pg-tls-')); t.after(() => rm(directory, { recursive: true, force: true })); return directory; }
const loopbackOptions = (host: string): PostgresOptions => ({ host: host as '127.0.0.1', port: 5432, user: 'u', database: 'd', password: 'p', vaultSlot: 'slot' });

test('desktop storage still refuses any non-loopback database host, with or without TLS options', async t => {
  const directory = await scratch(t);
  for (const host of ['192.0.2.10', 'db.example.com', 'localhost']) await assert.rejects(PostgresSnapshotAdapter.connect(loopbackOptions(host)), code('INVALID_POSTGRES_CONFIG'), host);
  const desktop = new Engine({ directory, storage: 'postgres', postgresUrl: remoteUrl });
  await assert.rejects(desktop.request('workspace.create', { name: 'Remote', passphrase }), code('INVALID_POSTGRES_CONFIG'));
  // TLS settings alone do not open the remote path: the trusted host must also select the enterprise storage mode.
  const tlsOnly = new Engine({ directory, storage: 'postgres', postgresUrl: remoteUrl, postgresTls: { ca: fakeCa } });
  await assert.rejects(tlsOnly.request('workspace.create', { name: 'Remote', passphrase }), code('INVALID_POSTGRES_CONFIG'));
});

test('enterprise storage mode without verified TLS refuses a remote database', async t => {
  const directory = await scratch(t);
  const noTls = new Engine({ directory, storage: 'postgres', postgresUrl: remoteUrl, storageMode: 'enterprise-server' });
  await assert.rejects(noTls.request('workspace.create', { name: 'Remote', passphrase }), code('INVALID_POSTGRES_CONFIG'));
  const remote = { host: '192.0.2.10', port: 5432, user: 'u', database: 'd', password: 'p', vaultSlot: 'slot' };
  for (const remoteTls of [{ ca: '' }, { ca: 'not a certificate' }, { ca: fakeCa, servername: 'bad name!' }, undefined as any])
    await assert.rejects(PostgresSnapshotAdapter.connect({ ...remote, remoteTls }), code('POSTGRES_TLS_REQUIRED'));
  await assert.rejects(openEnterpriseStorePool({ url: remoteUrl }), code('POSTGRES_TLS_REQUIRED'));
  const config = parseEnterpriseConfig({
    listen: { host: '127.0.0.1', port: 8443 }, tls: { certFile: '/x/cert.pem', keyFile: '/x/key.pem' }, publicOrigin: 'https://localhost:8443',
    oidc: { issuer: 'https://login.example.com', clientId: 'c', clientSecretFile: '/x/secret', redirectPath: '/auth/callback', scopes: ['openid'] },
    roles: [{ claim: 'groups', equals: 'admins', role: 'owner', branches: ['*'] }], sessionTtlMinutes: 30, dataDirectory: '/x/server',
    workspace: { directory: '/x/vaults', folder: 'main', unlock: 'keychain' },
  });
  await assert.rejects(enterpriseDatabase(config, { CHAUSAR_POSTGRES_URL: remoteUrl }), code('POSTGRES_TLS_REQUIRED'));
  assert.deepEqual(await enterpriseDatabase(config, { CHAUSAR_POSTGRES_URL: 'postgresql://u:p@127.0.0.1:5432/d' }), { url: 'postgresql://u:p@127.0.0.1:5432/d' }, 'Loopback without TLS keeps working.');
  assert.throws(() => parseEnterpriseConfig({ ...config, database: { caFile: 'relative.pem' } }), code('ENTERPRISE_CONFIG_INVALID'));
  assert.throws(() => parseEnterpriseConfig({ ...config, database: { caFile: '/x/ca.pem', sslmode: 'prefer' } }), code('ENTERPRISE_CONFIG_INVALID'));
});

const unavailable = realPostgresUnavailable();
test('enterprise storage mode reaches a real TLS-only PostgreSQL on a non-loopback address, verifying its certificate', { skip: unavailable ?? false, timeout: 180_000 }, async t => {
  const pg = await startTlsPostgres(); t.after(() => pg.stop());
  const directory = await scratch(t);
  const remote = { host: pg.host, port: pg.port, user: pg.user, database: pg.database, password: pg.password, vaultSlot: 'tls-probe' };

  await t.test('the plaintext desktop path is refused by the TLS-only server', async () => {
    await assert.rejects(PostgresSnapshotAdapter.connect({ ...remote, host: '127.0.0.1' }), (error: any) => /no pg_hba\.conf entry|SSL off/i.test(String(error?.message)));
  });
  await t.test('a CA that did not sign the server certificate, or the wrong server name, is refused', async () => {
    await assert.rejects(PostgresSnapshotAdapter.connect({ ...remote, remoteTls: { ca: pg.otherCa } }), (error: any) => /certificate/i.test(String(error?.message)));
    await assert.rejects(PostgresSnapshotAdapter.connect({ ...remote, remoteTls: { ca: pg.ca, servername: 'wrong.example.com' } }), (error: any) => /altnames|Hostname|certificate/i.test(String(error?.message)));
  });
  await t.test('the pinned CA connects; the session is encrypted', async () => {
    const adapter = await PostgresSnapshotAdapter.connect({ ...remote, remoteTls: { ca: pg.ca } });
    try {
      const encrypted = await adapter.withLease(lease => lease.query('SELECT ssl, version FROM pg_stat_ssl WHERE pid = pg_backend_pid()'));
      assert.equal(encrypted.rows[0].ssl, true); assert.match(encrypted.rows[0].version, /^TLSv1\.[23]$/);
      assert.equal(await adapter.load(), null);
    } finally { await adapter.close(); }
    const named = await PostgresSnapshotAdapter.connect({ ...remote, host: '127.0.0.1', remoteTls: { ca: pg.ca, servername: 'chausar-db.test' } });
    await named.close();
  });
  await t.test('an enterprise engine creates, reopens and reads a workspace over TLS', async () => {
    const options = { directory, storage: 'postgres' as const, postgresUrl: pg.url(), storageMode: 'enterprise-server' as const, postgresTls: { ca: pg.ca } };
    const engine = new Engine(options);
    const created = await engine.request('workspace.create', { name: 'Remote TLS workspace', passphrase });
    assert.equal(typeof created.recoveryCode, 'string');
    assert.equal((await engine.request('workspace.status')).open, true);
    await engine.shutdown(10_000);
    const again = new Engine(options);
    await again.request('workspace.open', { passphrase });
    assert.equal((await again.request('workspace.status')).open, true);
    await again.shutdown(10_000);
    const pool = await openEnterpriseStorePool({ url: pg.url(), tls: { ca: pg.ca } });
    try { assert.equal((await pool.query('SELECT count(*)::int AS n FROM public.chausar_vault_authority')).rows[0].n, 1, 'Only ciphertext authority rows are stored.'); }
    finally { await pool.end(); }
  });
  await writeFile(join(directory, 'done'), 'ok');
});
