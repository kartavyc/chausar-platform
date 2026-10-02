import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { ChausarError } from '../../runtime/contracts.ts';
import type { EncryptedSnapshotAdapter, VaultEnvelope } from '../../runtime/vault.ts';

// Isolated injected SQL protocol only; never native PostgreSQL evidence.
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');

type AuthorityIdentity = { creationId: string; vaultId: string; revision: number; envelopeDigest: string };
type CatalogRelation = { schema: string; name: string; kind: string; oid: string; bytes: string; columns: string; definition: string; entries: number };
type QueryResult = { rows: Record<string, unknown>[]; rowCount?: number };
type FixtureLease = {
  readonly slot: string; readonly active: boolean;
  query(sql: string, values?: unknown[]): Promise<QueryResult>;
  load(): Promise<VaultEnvelope | null>;
  commit(envelope: VaultEnvelope, expectedRevision: number | null): Promise<void>;
  authority(): Promise<AuthorityIdentity | null>;
  assertCurrent(expected: AuthorityIdentity): Promise<void>;
};

/** Ciphertext-only adapter using the frozen lease shape; all SQL results are authored. */
export class ProtocolPostgresAdapter implements EncryptedSnapshotAdapter {
  readonly kind = 'postgres' as const;
  readonly vaultSlot: string;
  readonly storage: { storageId: string; databaseOid: string; database: string; serverAddress: string; serverPort: number; slot: string };
  constructor(vaultSlot = 'fixture-source') {
    this.vaultSlot = vaultSlot;
    this.storage = { storageId: randomUUID(), databaseOid: '17000', database: 'synthetic_protocol_database',
      serverAddress: '127.0.0.1', serverPort: 55432, slot: vaultSlot };
  }
  creationId = randomUUID();
  envelope: VaultEnvelope | null = null;
  catalog: CatalogRelation[] = [
    { schema: 'public', name: 'chausar_vault_authority', kind: 'r', oid: '17001', bytes: '8192', columns: '[["slot",25,-1,true],["envelope",3802,-1,true]]', definition: '{}', entries: 1 },
    { schema: 'public', name: 'chausar_workspace_postgres_storage', kind: 'r', oid: '17002', bytes: '8192', columns: '[["storage_id",25,-1,true]]', definition: '{}', entries: 1 },
    { schema: 'public', name: 'chausar_workspace_postgres_custody', kind: 'r', oid: '17003', bytes: '0', columns: '[["slot",25,-1,true],["phase",25,-1,true]]', definition: '{}', entries: 0 },
  ];
  readonly queries: string[] = [];
  readonly rowContents = new Map<string, unknown>();
  readonly unsupportedObjects: Record<string, unknown>[] = [];
  leaseCalls = 0;
  deleteCalls = 0;
  lastLease: FixtureLease | undefined;
  readonly #scope = new AsyncLocalStorage<FixtureLease>();
  get leaseActive() { return this.#scope.getStore()?.active === true; }

  async load() { return structuredClone(this.envelope); }
  async commit(envelope: VaultEnvelope, expectedRevision: number | null) {
    if ((this.envelope?.revision ?? null) !== expectedRevision)
      throw new ChausarError('REVISION_CONFLICT', 'Synthetic adapter expected revision changed.');
    this.envelope = structuredClone(envelope);
  }
  async delete() { this.deleteCalls++; this.envelope = null; }
  async close() { /* Fixture ownership remains available for explicit Vault reopen. */ }
  async authority(): Promise<AuthorityIdentity | null> {
    return this.envelope ? { creationId: this.creationId, vaultId: this.envelope.id, revision: this.envelope.revision,
      envelopeDigest: sha(JSON.stringify(this.envelope)) } : null;
  }
  async withLease<T>(work: (lease: FixtureLease) => Promise<T>): Promise<T> {
    const nested = this.#scope.getStore();
    if (nested) { assert.equal(nested.active, true); return work(nested); }
    this.leaseCalls++; let active = true;
    const assertActive = () => {
      if (!active) throw new ChausarError('POSTGRES_LEASE_RELEASED', 'Synthetic native lease has been released.');
    };
    const lease: FixtureLease = {
      slot: this.vaultSlot, get active() { return active; },
      query: async (sql, values) => { assertActive(); return this.query(sql, values); },
      load: async () => { assertActive(); return this.load(); },
      commit: async (envelope, revision) => { assertActive(); return this.commit(envelope, revision); },
      authority: async () => { assertActive(); return this.authority(); },
      assertCurrent: async expected => {
        assertActive();
        if (JSON.stringify(await this.authority()) !== JSON.stringify(expected))
          throw new ChausarError('POSTGRES_AUTHORITY_CHANGED', 'Synthetic slot incarnation or ciphertext changed.');
      },
    };
    this.lastLease = lease;
    try { return await this.#scope.run(lease, () => work(lease)); }
    finally { active = false; }
  }
  async query(sql: string, _values?: unknown[]): Promise<QueryResult> {
    this.queries.push(sql);
    if (/^SET LOCAL (?:statement_timeout|lock_timeout|row_security)/i.test(sql.trim())) return { rows: [], rowCount: 0 };
    if (/^LOCK TABLE /i.test(sql.trim())) {
      assert.ok(this.catalog.some(relation => sql.includes(`"${relation.schema}"."${relation.name}"`)) && / IN SHARE MODE$/.test(sql),
        `Fixture refuses unexpected relation lock query: ${sql}`);
      return { rows: [], rowCount: 0 };
    }
    if (/\bcount\s*\(/i.test(sql)) {
      const relation = this.catalog.find(item => sql.includes(item.name));
      assert.ok(relation, `Fixture refuses unexpected count query: ${sql}`);
      return { rows: [{ entries: String(relation.entries) }], rowCount: 1 };
    }
    if (/string_agg/.test(sql) && /sha256/.test(sql)) {
      const relation = this.catalog.find(item => sql.includes(item.name));
      assert.ok(relation, `Fixture refuses unexpected fingerprint query: ${sql}`);
      const fixtureRows = this.rowContents.has(relation.name) ? this.rowContents.get(relation.name)
        : relation.name === 'chausar_vault_authority' ? { creationId: this.creationId, envelope: this.envelope }
        : relation.name === 'chausar_workspace_postgres_storage' ? this.storage : [];
      return { rows: [{ generation: sha(JSON.stringify(fixtureRows)) }], rowCount: 1 };
    }
    if (/pg_type/.test(sql)) return { rows: structuredClone(this.unsupportedObjects), rowCount: this.unsupportedObjects.length };
    if (/pg_class/.test(sql) && !/pg_total_relation_size/.test(sql)) {
      // Authored identity-only discovery must not smuggle pre-lock physical
      // measurements into the two-phase exclusion protocol.
      const rows = [...this.catalog].sort((a, b) => a.schema.localeCompare(b.schema) || a.name.localeCompare(b.name))
        .map(({ schema, name, kind, oid }) => ({ schema, name, kind, oid }));
      return { rows, rowCount: rows.length };
    }
    if (/pg_class/.test(sql)) return { rows: this.catalog.map(({ entries: _entries, ...entry }) => ({ ...entry })), rowCount: this.catalog.length };
    if (/pg_proc/.test(sql)) return { rows: [], rowCount: 0 };
    if (/pg_namespace/.test(sql)) {
      const rows = [...new Set(this.catalog.map(item => item.schema))].sort().map((schema, index) => ({ schema, oid: String(2200 + index), owner: '17000', acl: null }));
      return { rows, rowCount: rows.length };
    }
    throw new Error(`Fixture refuses unexpected SQL: ${sql}`);
  }
}

