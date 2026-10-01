import { ChausarError, check, hash } from './contracts.ts';

export const INVESTIGATION_SEARCH_METHOD = 'simple-token-conjunction-v1' as const;
export type InvestigationSearchDocument = { id: string; kind: 'investigation' | 'journal'; revision: number; digest: string; text: string };
export type AuthorizedInvestigationSearchProjection = { complete: true; expectedDocuments: number; documents: InvestigationSearchDocument[] };
export type InvestigationSearchBounds = { maxDocuments: number; maxTextBytes: number; maxMatches: number };
export type InvestigationSearchRequest = { method: typeof INVESTIGATION_SEARCH_METHOD; query: string; bounds: InvestigationSearchBounds };
export type InvestigationSearchServerIdentity = { database: string; address: string; port: number; serverVersion: string; version: string };
export type InvestigationSearchResult = {
  engine: 'postgres' | 'injected-sql'; serverIdentity: InvestigationSearchServerIdentity | null;
  method: typeof INVESTIGATION_SEARCH_METHOD; queryDigest: string; projectionDigest: string;
  matches: Omit<InvestigationSearchDocument, 'text'>[];
  completeness: { class: 'complete-authorized-projection'; documents: number; textBytes: number; matchedDocuments: number; indexReadiness: 'fresh-transactional-projection' };
  bounds: InvestigationSearchBounds;
};
type SearchClient = { query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>; release(error?: Error): void };
export type InvestigationSearchPool = { connect(): Promise<SearchClient>; end(): Promise<void> };
export type InvestigationSearchLimits = { operationTimeoutMs?: number };
export type InvestigationSearchOptions = InvestigationSearchLimits & { host: '127.0.0.1' | '::1'; port: number; user: string; password: string; database: string; maxConnections?: number };
const MAX_DOCUMENTS = 10000, MAX_TEXT_BYTES = 8 * 1024 * 1024, MAX_QUERY_BYTES = 4096;
const CREATE_DOCUMENTS = 'CREATE TEMP TABLE investigation_search_documents (id TEXT PRIMARY KEY, kind TEXT NOT NULL, revision BIGINT NOT NULL, digest TEXT NOT NULL, document TSVECTOR NOT NULL) ON COMMIT DROP';
const INSERT_DOCUMENT = "INSERT INTO investigation_search_documents VALUES ($1,$2,$3,$4,to_tsvector('simple'::regconfig,$5))";
const QUERY_TERMS = "SELECT numnode(plainto_tsquery('simple'::regconfig,$1)) AS terms";
const SEARCH_DOCUMENTS = "SELECT id,kind,revision::text AS revision,digest FROM investigation_search_documents WHERE document @@ plainto_tsquery('simple'::regconfig,$1) ORDER BY id COLLATE \"C\" LIMIT $2";

function exactObject(value: unknown, allowed: string[], required = allowed): asserts value is Record<string, unknown> {
  check(!!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)), 'SEARCH_CONFIGURATION_INVALID', 'Search configuration must use declared data properties.');
  const keys = Reflect.ownKeys(value);
  check(keys.every(key => typeof key === 'string' && allowed.includes(key)) && required.every(key => Object.hasOwn(value, key)), 'SEARCH_CONFIGURATION_INVALID', 'Unknown or missing search properties are refused.');
  check(keys.every(key => Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, 'value')), 'SEARCH_CONFIGURATION_INVALID', 'Search input must contain data values.');
}
function operationTimeout(limits: InvestigationSearchLimits) {
  exactObject(limits, ['operationTimeoutMs'], []);
  const value = limits.operationTimeoutMs ?? 15000;
  check(Number.isSafeInteger(value) && value >= 50 && value <= 30000, 'SEARCH_LIMIT_INVALID', 'Search needs a bounded operation deadline.'); return value;
}
function project(projection: AuthorizedInvestigationSearchProjection, request: InvestigationSearchRequest) {
  exactObject(request, ['method', 'query', 'bounds']);
  check(request.method === INVESTIGATION_SEARCH_METHOD, 'SEARCH_METHOD_UNSUPPORTED', 'Select the supported explicit token conjunction method.');
  check(typeof request.query === 'string' && request.query.trim().length > 0 && Buffer.byteLength(request.query) <= MAX_QUERY_BYTES && !request.query.includes('\0') && !/[\uD800-\uDFFF]/u.test(request.query), 'SEARCH_QUERY_INVALID', 'Supply bounded nonempty UTF-8 search text.');
  exactObject(request.bounds, ['maxDocuments', 'maxTextBytes', 'maxMatches']);
  for (const [key, cap] of [['maxDocuments', MAX_DOCUMENTS], ['maxTextBytes', MAX_TEXT_BYTES], ['maxMatches', MAX_DOCUMENTS]] as const) check(Number.isSafeInteger(request.bounds[key]) && request.bounds[key] >= 1 && request.bounds[key] <= cap, 'SEARCH_LIMIT_INVALID', 'Explicit search bounds must stay within supported limits.');
  exactObject(projection, ['complete', 'expectedDocuments', 'documents']);
  check(projection.complete === true && Array.isArray(projection.documents) && Number.isSafeInteger(projection.expectedDocuments) && projection.expectedDocuments >= 0 && projection.expectedDocuments === projection.documents.length, 'SEARCH_PROJECTION_INCOMPLETE', 'Search requires the complete host-authorized document projection.');
  check(projection.documents.length <= request.bounds.maxDocuments, 'SEARCH_DOCUMENT_LIMIT', 'The complete authorized projection exceeds the document bound.');
  const ids = new Set<string>(); let textBytes = 0;
  const documents = Array.from(projection.documents, document => {
    exactObject(document, ['id', 'kind', 'revision', 'digest', 'text']);
    check(typeof document.id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(document.id) && !ids.has(document.id), 'SEARCH_DOCUMENT_INVALID', 'Search documents need distinct bounded identities.'); ids.add(document.id);
    check(['investigation', 'journal'].includes(document.kind) && Number.isSafeInteger(document.revision) && document.revision >= 0 && typeof document.digest === 'string' && /^[a-f0-9]{64}$/.test(document.digest), 'SEARCH_DOCUMENT_INVALID', 'Search documents need declared kinds and pinned revisions and digests.');
    check(typeof document.text === 'string' && !document.text.includes('\0') && !/[\uD800-\uDFFF]/u.test(document.text), 'SEARCH_DOCUMENT_INVALID', 'Search document text must be UTF-8 data.');
    textBytes += Buffer.byteLength(document.text); check(textBytes <= request.bounds.maxTextBytes, 'SEARCH_TEXT_LIMIT', 'The complete authorized text exceeds the UTF-8 byte bound.');
    return { id: document.id, kind: document.kind, revision: document.revision, digest: document.digest, text: document.text };
  }).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  return { documents, textBytes, bounds: { ...request.bounds }, query: request.query, projectionDigest: hash({ complete: true, documents }) };
}

/** Host authorization precedes projection; the host must recheck access and revisions before release. */
export class PostgresInvestigationSearch {
  #pool: InvestigationSearchPool;
  #ownPool: boolean;
  #timeout: number;
  #closed = false;
  #identity: InvestigationSearchServerIdentity | null = null;
  #operations = new Set<AbortController>();
  private constructor(pool: InvestigationSearchPool, limits: InvestigationSearchLimits, ownPool: boolean) { this.#timeout = operationTimeout(limits); this.#pool = pool; this.#ownPool = ownPool; }
  static async connect(options: InvestigationSearchOptions): Promise<PostgresInvestigationSearch> {
    exactObject(options, ['host', 'port', 'user', 'password', 'database', 'maxConnections', 'operationTimeoutMs'], ['host', 'port', 'user', 'password', 'database']);
    check(['127.0.0.1', '::1'].includes(options.host) && Number.isSafeInteger(options.port) && options.port >= 1024 && options.port <= 65535, 'INVALID_POSTGRES_CONFIG', 'Use an explicit literal loopback host and unprivileged port.');
    for (const name of ['user', 'password', 'database'] as const) check(typeof options[name] === 'string' && options[name].length > 0 && options[name].length <= 1024 && !/[\0\r\n]/.test(options[name]), 'INVALID_POSTGRES_CONFIG', 'Explicit bounded database credentials and identity are required.');
    check(options.maxConnections === undefined || (Number.isSafeInteger(options.maxConnections) && options.maxConnections >= 1 && options.maxConnections <= 4), 'INVALID_POSTGRES_CONFIG', 'Use one to four private search connections.');
    const limits = options.operationTimeoutMs === undefined ? {} : { operationTimeoutMs: options.operationTimeoutMs }; operationTimeout(limits);
    let pg: any;
    try { const packageName = 'pg'; pg = await import(packageName); }
    catch { throw new ChausarError('POSTGRES_UNAVAILABLE', 'The qualified PostgreSQL driver is unavailable.'); }
    const Pool = pg.Pool ?? pg.default?.Pool;
    const pool: InvestigationSearchPool = new Pool({ host: options.host, port: options.port, user: options.user, password: options.password, database: options.database, max: options.maxConnections ?? 2, connectionTimeoutMillis: 3000, query_timeout: operationTimeout(limits), application_name: 'chausar-private-investigation-search', ssl: false });
    const search = new PostgresInvestigationSearch(pool, limits, true);
    try {
      search.#identity = await search.transaction(async query => {
        const result = await query("SELECT current_database() AS database,host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('server_version') AS server_version,version() AS version");
        check(result.rows.length === 1, 'SEARCH_SERVER_IDENTITY_INVALID', 'PostgreSQL must return one actual server identity.');
        const row = result.rows[0];
        check(row.database === options.database && row.address === options.host && row.port === options.port && typeof row.server_version === 'string' && row.server_version.length <= 200 && typeof row.version === 'string' && row.version.startsWith('PostgreSQL ') && row.version.length <= 1000, 'SEARCH_SERVER_IDENTITY_INVALID', 'The native search server did not identify the configured local database.');
        return { database: row.database, address: row.address, port: row.port, serverVersion: row.server_version, version: row.version } as InvestigationSearchServerIdentity;
      });
      return search;
    } catch (error) { await search.close(); throw error; }
  }
  static fromPool(pool: InvestigationSearchPool, limits: InvestigationSearchLimits = {}): PostgresInvestigationSearch {
    check(pool && typeof pool.connect === 'function' && typeof pool.end === 'function', 'SEARCH_CONFIGURATION_INVALID', 'Supply an explicit managed pool.');
    return new PostgresInvestigationSearch(pool, limits, false);
  }
  private async transaction<T>(work: (query: SearchClient['query']) => Promise<T>): Promise<T> {
    check(!this.#closed, 'SEARCH_CLOSED', 'The private search adapter is closed.');
    const controller = new AbortController(); this.#operations.add(controller);
    let client: SearchClient | undefined, released = false, began = false;
    const discard = () => { if (client && !released) { released = true; client.release(new Error('Private search interrupted.')); } };
    const query: SearchClient['query'] = async (sql, values = []) => {
      check(!controller.signal.aborted && !released, 'SEARCH_TIMEOUT', 'Private search exceeded its operation deadline.');
      try {
        const result = await client!.query(sql, values);
        check(!controller.signal.aborted && !released, 'SEARCH_TIMEOUT', 'Private search exceeded its operation deadline.'); return result;
      } catch (error: any) {
        if (error?.code === '57014') throw new ChausarError('SEARCH_TIMEOUT', 'PostgreSQL interrupted the bounded private search.');
        if (error instanceof ChausarError) throw error;
        throw new ChausarError('SEARCH_SQL_FAILED', 'PostgreSQL could not complete the private search statement.');
      }
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: () => void = () => {};
    const deadline = new Promise<never>((_, reject) => { onAbort = () => { discard(); reject(new ChausarError('SEARCH_TIMEOUT', 'Private search exceeded its operation deadline.')); }; controller.signal.addEventListener('abort', onAbort, { once: true }); timer = setTimeout(() => controller.abort(), this.#timeout); });
    const operation = (async () => {
      try {
        client = await this.#pool.connect();
        if (controller.signal.aborted) { discard(); throw new ChausarError('SEARCH_TIMEOUT', 'The private search connection arrived after its deadline.'); }
        await query('BEGIN'); began = true;
        await query('SET LOCAL search_path TO pg_temp');
        await query("SELECT set_config('statement_timeout',$1,true),set_config('lock_timeout',$1,true),set_config('idle_in_transaction_session_timeout',$1,true)", [String(this.#timeout)]);
        return await work(query);
      } finally {
        if (client && !released) {
          let cleanupError: Error | undefined;
          try { if (began) await query('ROLLBACK'); }
          catch (error) { cleanupError = error instanceof Error ? error : new Error('Private search rollback failed.'); throw error; }
          finally { if (!released) { released = true; client.release(cleanupError ?? (began ? undefined : new Error('Private search initialization failed.'))); } }
        }
      }
    })();
    try { return await Promise.race([operation, deadline]); }
    catch (error) { if (error instanceof ChausarError) throw error; throw new ChausarError('SEARCH_SQL_FAILED', 'PostgreSQL could not complete the private search operation.'); }
    finally { if (timer) clearTimeout(timer); controller.signal.removeEventListener('abort', onAbort); this.#operations.delete(controller); }
  }
  async search(projection: AuthorizedInvestigationSearchProjection, request: InvestigationSearchRequest): Promise<InvestigationSearchResult> {
    check(!this.#closed, 'SEARCH_CLOSED', 'The private search adapter is closed.');
    const input = project(projection, request);
    const matches = await this.transaction(async query => {
      const terms = await query(QUERY_TERMS, [input.query]);
      check(terms.rows.length === 1 && Number.isSafeInteger(terms.rows[0].terms) && Number(terms.rows[0].terms) > 0, 'SEARCH_EMPTY_TERMS', 'The simple token method needs at least one searchable term.');
      await query(CREATE_DOCUMENTS);
      for (const document of input.documents) await query(INSERT_DOCUMENT, [document.id, document.kind, document.revision, document.digest, document.text]);
      const result = await query(SEARCH_DOCUMENTS, [input.query, input.bounds.maxMatches + 1]);
      check(result.rows.length <= input.bounds.maxMatches, 'SEARCH_MATCH_LIMIT', 'The complete match set exceeds the declared result bound.');
      const documents = new Map(input.documents.map(document => [document.id, document])); const seen = new Set<string>();
      return result.rows.map(row => {
        const document = typeof row.id === 'string' ? documents.get(row.id) : undefined;
        check(document && !seen.has(document.id) && row.kind === document.kind && row.revision === String(document.revision) && row.digest === document.digest, 'SEARCH_RESULT_INVALID', 'Search results must belong to the exact authorized projection.');
        seen.add(document.id); return { id: document.id, kind: document.kind, revision: document.revision, digest: document.digest };
      });
    });
    return { engine: this.#ownPool ? 'postgres' : 'injected-sql', serverIdentity: this.#identity ? { ...this.#identity } : null, method: INVESTIGATION_SEARCH_METHOD, queryDigest: hash(input.query), projectionDigest: input.projectionDigest, matches, completeness: { class: 'complete-authorized-projection', documents: input.documents.length, textBytes: input.textBytes, matchedDocuments: matches.length, indexReadiness: 'fresh-transactional-projection' }, bounds: input.bounds };
  }
  async close(): Promise<void> {
    if (this.#closed) return; this.#closed = true; for (const controller of this.#operations) controller.abort();
    if (this.#ownPool) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([this.#pool.end(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ChausarError('SEARCH_TIMEOUT', 'The private search pool exceeded its shutdown deadline.')), this.#timeout); })]); }
      finally { if (timer) clearTimeout(timer); }
    }
  }
}
