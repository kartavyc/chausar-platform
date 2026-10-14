import { createHash } from 'node:crypto';
import { check } from '../../platform/runtime/contracts.ts';
import type { Role } from '../../platform/runtime/contracts.ts';

/** A server-side session. The store key is the SHA-256 of the cookie value; the raw id is never stored. */
export type StoredSession = { memberId: string; role: Role; epoch: number; expiresAt: number };
/** One sign-in in progress. The store key is the SHA-256 of the OIDC `state`. */
export type PendingLogin = { nonce: string; verifier: string; expiresAt: number };
export type LoginStateStore = {
  /** Refuses OIDC_LOGIN_BUSY when `limit` sign-ins are already in progress. */
  putLogin(key: string, login: PendingLogin, limit: number, now: number): Promise<void>;
  /** Removes and returns the entry in one step, so a state value works once even across processes. */
  takeLogin(key: string, now: number): Promise<PendingLogin | null>;
};
/** Sessions, sign-ins in progress and sign-in rate limits, shared by every server process that uses the same store. */
export type EnterpriseStateStore = LoginStateStore & {
  readonly kind: 'memory' | 'postgres';
  /** Refuses ENTERPRISE_BUSY when `limit` live sessions exist. */
  putSession(key: string, session: StoredSession, limit: number, now: number): Promise<void>;
  getSession(key: string, now: number): Promise<StoredSession | null>;
  deleteSession(key: string): Promise<void>;
  sessionCount(now: number): Promise<number>;
  /** Counts one sign-in request for the address in a one-minute window; refuses RATE_LIMITED above `limit`. */
  hit(address: string, now: number, limit: number): Promise<void>;
  close(): Promise<void>;
};

const WINDOW_MS = 60_000;
const MAX_WINDOWS = 10_000;
const roles: readonly string[] = ['owner', 'cofounder', 'accountant', 'viewer'];
const busy = () => check(false, 'ENTERPRISE_BUSY', 'Too many sessions are open. Try again later.');
const loginBusy = () => check(false, 'OIDC_LOGIN_BUSY', 'Too many sign-ins are in progress. Try again shortly.');
const limited = () => check(false, 'RATE_LIMITED', 'Too many sign-in requests. Wait a minute.');
/** Client addresses are kept only as digests. */
const addressKey = (address: string) => createHash('sha256').update(`chausar-enterprise-rate:${address}`).digest('hex');

/** One process only. Used by tests and by a server started without a shared store. */
export class MemoryEnterpriseStore implements EnterpriseStateStore {
  readonly kind = 'memory' as const;
  #sessions = new Map<string, StoredSession>(); #logins = new Map<string, PendingLogin>(); #windows = new Map<string, { start: number; count: number }>();
  async putSession(key: string, session: StoredSession, limit: number, now: number) {
    if (this.#sessions.size >= limit) for (const [id, item] of this.#sessions) if (item.expiresAt <= now) this.#sessions.delete(id);
    if (this.#sessions.size >= limit) busy();
    this.#sessions.set(key, { ...session });
  }
  async getSession(key: string, now: number) { const item = this.#sessions.get(key); return item && item.expiresAt > now ? { ...item } : null; }
  async deleteSession(key: string) { this.#sessions.delete(key); }
  async sessionCount(now: number) { let count = 0; for (const item of this.#sessions.values()) if (item.expiresAt > now) count++; return count; }
  async putLogin(key: string, login: PendingLogin, limit: number, now: number) {
    for (const [id, item] of this.#logins) if (item.expiresAt <= now) this.#logins.delete(id);
    if (this.#logins.size >= limit) loginBusy();
    this.#logins.set(key, { ...login });
  }
  async takeLogin(key: string, now: number) { const item = this.#logins.get(key); this.#logins.delete(key); return item && item.expiresAt > now ? item : null; }
  async hit(address: string, now: number, limit: number) {
    const key = addressKey(address);
    if (this.#windows.size >= MAX_WINDOWS) for (const [id, window] of this.#windows) if (now - window.start >= WINDOW_MS) this.#windows.delete(id);
    const window = this.#windows.get(key);
    if (!window || now - window.start >= WINDOW_MS) { if (this.#windows.size >= MAX_WINDOWS && !window) limited(); this.#windows.set(key, { start: now, count: 1 }); return; }
    window.count++; if (window.count > limit) limited();
  }
  async close() { this.#sessions.clear(); this.#logins.clear(); this.#windows.clear(); }
}

type Queryable = { query(sql: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
export type EnterpriseStorePool = Queryable & { connect(): Promise<Queryable & { release(): void }>; end(): Promise<void> };
export type EnterpriseStoreConnection = { url: string; tls?: { ca: string; servername?: string } };

const loopback = (host: string) => ['127.0.0.1', '::1', 'localhost'].includes(host);
/** Opens a small pool to the same database the engine uses. A non-loopback host needs verified TLS with a pinned CA. */
export async function openEnterpriseStorePool(connection: EnterpriseStoreConnection): Promise<EnterpriseStorePool> {
  let url: URL; try { url = new URL(connection.url); } catch { check(false, 'INVALID_POSTGRES_CONFIG', 'Use a PostgreSQL connection URL.'); }
  check(url.protocol === 'postgres:' || url.protocol === 'postgresql:', 'INVALID_POSTGRES_CONFIG', 'Use a PostgreSQL connection URL.');
  const host = url.hostname.replace(/^\[|\]$/g, ''), port = Number(url.port || 5432);
  check(host.length > 0 && Number.isInteger(port) && port >= 1024 && port <= 65535 && url.username && url.password && url.pathname.length > 1, 'INVALID_POSTGRES_CONFIG', 'Provide explicit database host, port and credentials.');
  check(loopback(host) || !!connection.tls, 'POSTGRES_TLS_REQUIRED', 'A remote database needs verified TLS with a pinned certificate authority.');
  const ssl = connection.tls ? { ca: connection.tls.ca, rejectUnauthorized: true, minVersion: 'TLSv1.2', ...(connection.tls.servername ? { servername: connection.tls.servername } : {}) } : false;
  const moduleName = 'pg'; const pg = await import(moduleName), Pool = pg.Pool ?? pg.default?.Pool;
  // Fields, never the URL string: query options such as sslmode in the URL are ignored on purpose.
  return new Pool({ host, port, user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: decodeURIComponent(url.pathname.slice(1)),
    max: 4, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30_000, application_name: 'chausar-enterprise-sessions', ssl });
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS public.chausar_enterprise_sessions (
    session_digest TEXT PRIMARY KEY CHECK (session_digest ~ '^[0-9a-f]{64}$'), member_id TEXT NOT NULL, role TEXT NOT NULL,
    epoch BIGINT NOT NULL, expires_at BIGINT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  'CREATE INDEX IF NOT EXISTS chausar_enterprise_sessions_expiry ON public.chausar_enterprise_sessions (expires_at)',
  `CREATE TABLE IF NOT EXISTS public.chausar_enterprise_logins (
    state_digest TEXT PRIMARY KEY, nonce TEXT NOT NULL, verifier TEXT NOT NULL, expires_at BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS public.chausar_enterprise_rate_limits (
    address_digest TEXT PRIMARY KEY, window_start BIGINT NOT NULL, count INTEGER NOT NULL)`,
];

/** Shared store for several server processes, in the PostgreSQL database the engine uses. */
export class PostgresEnterpriseStore implements EnterpriseStateStore {
  readonly kind = 'postgres' as const;
  #pool: EnterpriseStorePool; #ownPool: boolean;
  private constructor(pool: EnterpriseStorePool, ownPool: boolean) { this.#pool = pool; this.#ownPool = ownPool; }
  static async connect(connection: EnterpriseStoreConnection): Promise<PostgresEnterpriseStore> {
    const pool = await openEnterpriseStorePool(connection);
    try { return await PostgresEnterpriseStore.fromPool(pool, true); } catch (error) { await pool.end().catch(() => {}); throw error; }
  }
  static async fromPool(pool: EnterpriseStorePool, ownPool = false): Promise<PostgresEnterpriseStore> {
    // The advisory lock keeps concurrent first starts from racing on CREATE TABLE.
    const client = await pool.connect();
    try {
      await client.query('BEGIN'); await client.query("SELECT pg_advisory_xact_lock(hashtext('chausar-enterprise-schema-v1'))");
      for (const sql of SCHEMA) await client.query(sql);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
    return new PostgresEnterpriseStore(pool, ownPool);
  }
  async putSession(key: string, session: StoredSession, limit: number, now: number) {
    await this.#pool.query('DELETE FROM public.chausar_enterprise_sessions WHERE expires_at <= $1', [now]);
    const result = await this.#pool.query(`INSERT INTO public.chausar_enterprise_sessions (session_digest, member_id, role, epoch, expires_at)
      SELECT $1, $2, $3, $4, $5 WHERE (SELECT count(*) FROM public.chausar_enterprise_sessions) < $6`, [key, session.memberId, session.role, session.epoch, session.expiresAt, limit]);
    if (result.rowCount !== 1) busy();
  }
  async getSession(key: string, now: number): Promise<StoredSession | null> {
    const result = await this.#pool.query('SELECT member_id, role, epoch, expires_at FROM public.chausar_enterprise_sessions WHERE session_digest = $1 AND expires_at > $2', [key, now]);
    const row = result.rows[0]; if (!row) return null;
    check(typeof row.member_id === 'string' && roles.includes(row.role) && Number.isSafeInteger(Number(row.epoch)) && Number.isSafeInteger(Number(row.expires_at)), 'ENTERPRISE_SESSION_STORE_INVALID', 'A stored session is not well formed.');
    return { memberId: row.member_id, role: row.role, epoch: Number(row.epoch), expiresAt: Number(row.expires_at) };
  }
  async deleteSession(key: string) { await this.#pool.query('DELETE FROM public.chausar_enterprise_sessions WHERE session_digest = $1', [key]); }
  async sessionCount(now: number) { return Number((await this.#pool.query('SELECT count(*) AS n FROM public.chausar_enterprise_sessions WHERE expires_at > $1', [now])).rows[0]?.n ?? 0); }
  async putLogin(key: string, login: PendingLogin, limit: number, now: number) {
    await this.#pool.query('DELETE FROM public.chausar_enterprise_logins WHERE expires_at <= $1', [now]);
    const result = await this.#pool.query(`INSERT INTO public.chausar_enterprise_logins (state_digest, nonce, verifier, expires_at)
      SELECT $1, $2, $3, $4 WHERE (SELECT count(*) FROM public.chausar_enterprise_logins) < $5`, [key, login.nonce, login.verifier, login.expiresAt, limit]);
    if (result.rowCount !== 1) loginBusy();
  }
  async takeLogin(key: string, now: number): Promise<PendingLogin | null> {
    const row = (await this.#pool.query('DELETE FROM public.chausar_enterprise_logins WHERE state_digest = $1 RETURNING nonce, verifier, expires_at', [key])).rows[0];
    if (!row || !(Number(row.expires_at) > now) || typeof row.nonce !== 'string' || typeof row.verifier !== 'string') return null;
    return { nonce: row.nonce, verifier: row.verifier, expiresAt: Number(row.expires_at) };
  }
  async hit(address: string, now: number, limit: number) {
    const key = addressKey(address);
    if (Math.random() < 0.01) await this.#pool.query('DELETE FROM public.chausar_enterprise_rate_limits WHERE window_start <= $1', [now - WINDOW_MS]);
    const result = await this.#pool.query(`INSERT INTO public.chausar_enterprise_rate_limits AS r (address_digest, window_start, count) VALUES ($1, $2, 1)
      ON CONFLICT (address_digest) DO UPDATE SET
        count = CASE WHEN r.window_start <= $2 - ${WINDOW_MS} THEN 1 ELSE r.count + 1 END,
        window_start = CASE WHEN r.window_start <= $2 - ${WINDOW_MS} THEN $2 ELSE r.window_start END
      RETURNING count`, [key, now]);
    if (Number(result.rows[0]?.count) > limit) limited();
  }
  /** Ends this process's connections. Sessions stay in the database, so a restart keeps people signed in. */
  async close() { if (this.#ownPool) await this.#pool.end(); }
}
