import { DatabaseCalculator, type DatabaseCalculatorOptions, type DatabaseVerification, type SQLConnection } from './analytics.ts';
import type { CalculationReceipt } from './calculator.ts';
import { ChausarError, check } from './contracts.ts';
import type { PostgresOptions } from './postgres.ts';

type QueryResult = { rows: Record<string, unknown>[] };
type ProjectionClient = { query(sql: string, values?: unknown[]): Promise<QueryResult>; release(error?: Error): void };
export type PostgresAnalyticalPool = { connect(): Promise<ProjectionClient>; end(): Promise<void> };
export type PostgresAnalyticalLimits = Pick<DatabaseCalculatorOptions, 'operationTimeoutMs' | 'maxRows'>;
export type PostgresAnalyticalOptions = Omit<PostgresOptions, 'vaultSlot'> & PostgresAnalyticalLimits;

/** Independent exact SQL verification in private transactional temp tables.
 * No persistent business table, snapshot, schema or default engine is changed.
 */
export class PostgresDatabaseCalculator {
  #pool: PostgresAnalyticalPool;
  #ownPool: boolean;
  #closed = false;
  #calculator: DatabaseCalculator;
  private constructor(pool: PostgresAnalyticalPool, limits: PostgresAnalyticalLimits, ownPool: boolean) {
    this.#pool = pool; this.#ownPool = ownPool;
    this.#calculator = new DatabaseCalculator({ ...limits, sqlDialect: 'postgres', connectionFactory: signal => this.connection(signal) });
  }
  static async connect(options: PostgresAnalyticalOptions): Promise<PostgresDatabaseCalculator> {
    check(['127.0.0.1', '::1'].includes(options.host) && Number.isInteger(options.port) && options.port >= 1024 && options.port <= 65535 && options.user && options.database && options.password, 'INVALID_POSTGRES_CONFIG', 'Provide explicit loopback analytical database configuration and credentials.');
    check(options.maxConnections === undefined || (Number.isInteger(options.maxConnections) && options.maxConnections >= 1 && options.maxConnections <= 8), 'INVALID_POSTGRES_CONFIG', 'Use one to eight analytical connections.');
    let pg: any;
    try { const moduleName = 'pg'; pg = await import(moduleName); }
    catch { throw new ChausarError('POSTGRES_UNAVAILABLE', 'Install and qualify the pinned PostgreSQL driver before verifying calculations.'); }
    const Pool = pg.Pool ?? pg.default?.Pool;
    const pool: PostgresAnalyticalPool = new Pool({ host: options.host, port: options.port, user: options.user, database: options.database, password: options.password, max: options.maxConnections ?? 2, connectionTimeoutMillis: 5000, application_name: 'chausar-receipt-verification', ssl: false });
    try { return new PostgresDatabaseCalculator(pool, options, true); }
    catch (error) { await pool.end(); throw error; }
  }
  /** Test/managed-pool injection is always labelled injected-sql, never postgres. */
  static fromPool(pool: PostgresAnalyticalPool, limits: PostgresAnalyticalLimits = {}): PostgresDatabaseCalculator {
    return new PostgresDatabaseCalculator(pool, limits, false);
  }
  private async connection(signal: AbortSignal): Promise<SQLConnection> {
    check(!this.#closed, 'POSTGRES_CLOSED', 'The analytical database adapter is closed.');
    let client: ProjectionClient | undefined; let released = false;
    const discard = () => { if (client && !released) { released = true; client.release(new Error('Analytical query interrupted.')); } };
    let onAbort: () => void;
    const aborted = new Promise<never>((_,reject) => { onAbort = () => { discard(); reject(new ChausarError('SQL_TIMEOUT', 'The PostgreSQL connection exceeded its execution budget.')); }; signal.addEventListener('abort', onAbort, { once: true }); if (signal.aborted) onAbort(); });
    const query = async (sql: string, parameters: unknown[] = []) => {
      check(!signal.aborted && !released, 'SQL_TIMEOUT', 'The PostgreSQL operation exceeded its execution budget.');
      const result = await client!.query(sql, parameters);
      check(!signal.aborted && !released, 'SQL_TIMEOUT', 'The PostgreSQL operation exceeded its execution budget.');
      return result;
    };
    try {
      await Promise.race([(async () => {
        client = await this.#pool.connect();
        if (signal.aborted) { discard(); throw new ChausarError('SQL_TIMEOUT', 'The PostgreSQL client arrived after its execution deadline.'); }
        await query('BEGIN');
        await query('SET LOCAL search_path TO pg_temp');
        await query("SELECT set_config('statement_timeout', $1, true)", [String(this.#calculator.options.operationTimeoutMs)]);
      })(), aborted]);
      return {
        execute: async (sql, parameters = []) => {
          try { return (await query(sql, parameters)).rows; }
          catch (error: any) { if (error?.code === '57014') throw new ChausarError('SQL_TIMEOUT', 'The PostgreSQL calculation exceeded its statement budget.'); throw error; }
        },
        // Discard the client immediately on a parent deadline. A timeout must
        // not return a connection with a still-running query to the pool.
        interrupt: discard,
        close: async () => {
          if (released) { signal.removeEventListener('abort', onAbort!); return; }
          let failure: Error | undefined;
          try { await query('ROLLBACK'); } catch (error) { failure = error instanceof Error ? error : new Error('Projection rollback failed.'); }
          finally { signal.removeEventListener('abort', onAbort!); if (!released) { released = true; client!.release(failure); } }
          if (failure) throw failure;
        },
      };
    } catch (error) { signal.removeEventListener('abort', onAbort!); discard(); throw error; }
  }
  async verify(receipt: CalculationReceipt): Promise<DatabaseVerification> {
    const result = await this.#calculator.verify(receipt);
    return { ...result, engine: this.#ownPool ? 'postgres' : 'injected-sql' };
  }
  async close(): Promise<void> { if (this.#closed) return; this.#closed = true; if (this.#ownPool) await this.#pool.end(); }
}
