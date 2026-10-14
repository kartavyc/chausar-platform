/**
 * Storage for the learning intake service: batches, their events, contributors and the credit
 * ledger. A contributor is known only by the SHA-256 of their bearer token, and a batch only by
 * the SHA-256 of its deletion token; neither token is ever stored.
 */
import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { StructuralEvent } from './vocabulary.ts';

export type BatchRecord = {
  reference: string; idempotencyKey: string; contributorHash: string; bodyDigest: string; boxes: string[];
  eventCount: number; receivedAt: string; deletedAt: string | null; events: StructuralEvent[];
};
export type NewBatch = {
  reference: string; idempotencyKey: string; contributorHash: string; publicName: string | null; bodyDigest: string;
  boxes: string[]; events: StructuralEvent[]; receivedAt: string; deletionTokenHash: string;
};
export type DeleteResult = 'deleted' | 'not-found' | 'forbidden';

export interface IntakeStore {
  /** Store a batch, its events and one credit per event, once per idempotency key. An existing key returns its batch unchanged. */
  putBatch(batch: NewBatch): Promise<{ created: boolean; batch: BatchRecord }>;
  getBatch(reference: string): Promise<BatchRecord | undefined>;
  /** Hard-delete the batch's events and credits when the deletion token hash matches; the batch row keeps its key, marked deleted. */
  deleteBatch(reference: string, deletionTokenHash: string, at: string): Promise<DeleteResult>;
  credits(contributorHash: string): Promise<{ credits: number; publicName: string | null }>;
  /** Named contributors with credits, most credits first, then by name. */
  publicCredits(): Promise<{ publicName: string; credits: number }[]>;
}

const sameHash = (left: string, right: string) => left.length === right.length && timingSafeEqual(Buffer.from(left), Buffer.from(right));
const sortPublic = (list: { publicName: string; credits: number }[]) =>
  list.filter(item => item.credits > 0).sort((a, b) => b.credits - a.credits || (a.publicName < b.publicName ? -1 : a.publicName > b.publicName ? 1 : 0));

type MemoryBatch = Omit<BatchRecord, 'events'> & { deletionTokenHash: string; events: StructuralEvent[] };

export class MemoryIntakeStore implements IntakeStore {
  #contributors = new Map<string, { publicName: string | null }>();
  #batches = new Map<string, MemoryBatch>();
  #keys = new Map<string, string>();
  #credits: { contributorHash: string; reference: string; amount: number }[] = [];

  async putBatch(input: NewBatch) {
    const existing = this.#keys.get(input.idempotencyKey);
    if (existing) return { created: false, batch: this.#record(this.#batches.get(existing)!) };
    this.#contributors.set(input.contributorHash, { publicName: input.publicName });
    const batch: MemoryBatch = {
      reference: input.reference, idempotencyKey: input.idempotencyKey, contributorHash: input.contributorHash, bodyDigest: input.bodyDigest,
      boxes: [...input.boxes], eventCount: input.events.length, receivedAt: input.receivedAt, deletedAt: null,
      deletionTokenHash: input.deletionTokenHash, events: structuredClone(input.events),
    };
    this.#batches.set(batch.reference, batch);
    this.#keys.set(batch.idempotencyKey, batch.reference);
    this.#credits.push({ contributorHash: input.contributorHash, reference: batch.reference, amount: batch.eventCount });
    return { created: true, batch: this.#record(batch) };
  }
  async getBatch(reference: string) { const batch = this.#batches.get(reference); return batch && this.#record(batch); }
  async deleteBatch(reference: string, deletionTokenHash: string, at: string): Promise<DeleteResult> {
    const batch = this.#batches.get(reference);
    if (!batch || batch.deletedAt) return 'not-found';
    if (!sameHash(batch.deletionTokenHash, deletionTokenHash)) return 'forbidden';
    batch.events = []; batch.deletedAt = at;
    this.#credits = this.#credits.filter(entry => entry.reference !== reference);
    return 'deleted';
  }
  async credits(contributorHash: string) {
    const credits = this.#credits.filter(entry => entry.contributorHash === contributorHash).reduce((sum, entry) => sum + entry.amount, 0);
    return { credits, publicName: this.#contributors.get(contributorHash)?.publicName ?? null };
  }
  async publicCredits() {
    const list: { publicName: string; credits: number }[] = [];
    for (const [hash, { publicName }] of this.#contributors) if (publicName !== null) list.push({ publicName, credits: (await this.credits(hash)).credits });
    return sortPublic(list);
  }
  #record(batch: MemoryBatch): BatchRecord {
    const { deletionTokenHash: _hidden, ...record } = batch;
    return structuredClone(record);
  }
}

const ALREADY = Symbol('already');

/** The part of a `pg` Pool or Client the store uses. With `connect`, transactions run on one checked-out client. */
export type Queryable = { query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
export type PoolLike = Queryable & { connect?(): Promise<Queryable & { release(): void }> };

/** PostgreSQL store for `schema.sql`. Every statement is parameterised; writes run in a transaction. */
export class PostgresIntakeStore implements IntakeStore {
  readonly #pool: PoolLike;
  constructor(pool: PoolLike) { this.#pool = pool; }

  async #transaction<T>(work: (client: Queryable) => Promise<T>): Promise<T> {
    const client = this.#pool.connect ? await this.#pool.connect() : undefined;
    const db: Queryable = client ?? this.#pool;
    try {
      await db.query('BEGIN');
      const result = await work(db);
      await db.query('COMMIT');
      return result;
    } catch (error) {
      await db.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client?.release(); }
  }

  async putBatch(input: NewBatch) {
    const created = await this.#transaction(async db => {
      const contributor = await db.query(
        'INSERT INTO contributors (id, token_hash, public_name, created_at) VALUES ($1, $2, $3, $4) ' +
        'ON CONFLICT (token_hash) DO UPDATE SET public_name = EXCLUDED.public_name RETURNING id',
        [randomUUID(), input.contributorHash, input.publicName, input.receivedAt]);
      const contributorId = contributor.rows[0].id as string;
      const inserted = await db.query(
        'INSERT INTO batches (reference, idempotency_key, contributor_id, body_digest, boxes, event_count, received_at, deleted_at, deletion_token_hash) ' +
        'VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8) ON CONFLICT (idempotency_key) DO NOTHING RETURNING reference',
        [input.reference, input.idempotencyKey, contributorId, input.bodyDigest, input.boxes, input.events.length, input.receivedAt, input.deletionTokenHash]);
      if (inserted.rows.length === 0) throw ALREADY; // the key exists: roll back the name update too
      await db.query(
        'INSERT INTO events (batch_reference, position, event) ' +
        'SELECT $1, (item.ordinality - 1)::integer, item.value FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY AS item(value, ordinality)',
        [input.reference, JSON.stringify(input.events)]);
      await db.query(
        'INSERT INTO credits (contributor_id, batch_reference, amount, created_at) VALUES ($1, $2, $3, $4)',
        [contributorId, input.reference, input.events.length, input.receivedAt]);
      return true;
    }).catch(error => { if (error === ALREADY) return false; throw error; });
    if (created) return { created: true, batch: (await this.getBatch(input.reference))! };
    const existing = await this.#pool.query('SELECT reference FROM batches WHERE idempotency_key = $1', [input.idempotencyKey]);
    return { created: false, batch: (await this.getBatch(existing.rows[0].reference as string))! };
  }

  async getBatch(reference: string): Promise<BatchRecord | undefined> {
    const found = await this.#pool.query(
      'SELECT b.reference, b.idempotency_key, c.token_hash, b.body_digest, b.boxes, b.event_count, b.received_at, b.deleted_at ' +
      'FROM batches b JOIN contributors c ON c.id = b.contributor_id WHERE b.reference = $1', [reference]);
    const row = found.rows[0];
    if (!row) return undefined;
    const events = await this.#pool.query('SELECT event FROM events WHERE batch_reference = $1 ORDER BY position', [reference]);
    return {
      reference: row.reference, idempotencyKey: row.idempotency_key, contributorHash: row.token_hash, bodyDigest: row.body_digest,
      boxes: [...row.boxes], eventCount: Number(row.event_count), receivedAt: new Date(row.received_at).toISOString(),
      deletedAt: row.deleted_at === null ? null : new Date(row.deleted_at).toISOString(),
      events: events.rows.map(item => typeof item.event === 'string' ? JSON.parse(item.event) : item.event),
    };
  }

  async deleteBatch(reference: string, deletionTokenHash: string, at: string): Promise<DeleteResult> {
    return this.#transaction(async db => {
      const found = await db.query('SELECT deletion_token_hash, deleted_at FROM batches WHERE reference = $1 FOR UPDATE', [reference]);
      const row = found.rows[0];
      if (!row || row.deleted_at !== null) return 'not-found';
      if (!sameHash(row.deletion_token_hash, deletionTokenHash)) return 'forbidden';
      await db.query('DELETE FROM events WHERE batch_reference = $1', [reference]);
      await db.query('DELETE FROM credits WHERE batch_reference = $1', [reference]);
      await db.query('UPDATE batches SET deleted_at = $2 WHERE reference = $1', [reference, at]);
      return 'deleted';
    });
  }

  async credits(contributorHash: string) {
    const found = await this.#pool.query(
      'SELECT c.public_name, COALESCE(SUM(l.amount), 0) AS credits FROM contributors c LEFT JOIN credits l ON l.contributor_id = c.id ' +
      'WHERE c.token_hash = $1 GROUP BY c.id, c.public_name', [contributorHash]);
    const row = found.rows[0];
    return row ? { credits: Number(row.credits), publicName: row.public_name ?? null } : { credits: 0, publicName: null };
  }

  async publicCredits() {
    const found = await this.#pool.query(
      'SELECT c.public_name, COALESCE(SUM(l.amount), 0) AS credits FROM contributors c JOIN credits l ON l.contributor_id = c.id ' +
      'WHERE c.public_name IS NOT NULL GROUP BY c.id, c.public_name', []);
    return sortPublic(found.rows.map(row => ({ publicName: row.public_name as string, credits: Number(row.credits) })));
  }
}
