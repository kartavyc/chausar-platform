/**
 * Plain database connector contracts. A table mapping is data: catalogue identifiers chosen from the
 * database's own catalogue, never SQL text. Reading never grants writing: every engine reads inside one
 * read-only snapshot, and the database's own aggregate over the same snapshot is the source total.
 */
import type { SourceRecipe } from '../recipe.ts';
import type { Duplex } from 'node:stream';

export type PlainDbEngine = 'postgres' | 'mysql' | 'sqlite';
export type PlainDbDateFormat = 'ISO' | 'ISO-DATETIME' | 'YMD8' | 'EPOCH-S-IST';
export type PlainDbRole = 'id' | 'date' | 'amount' | 'quantity' | 'currency' | 'kind' | 'customerId' | 'invoiceId' | 'status' | 'description';
export type PlainDbColumns = {
  id: string; date: string; amount?: string; quantity?: string; currency?: string; kind?: string;
  customerId?: string; invoiceId?: string; status?: string; description?: string;
};
/** One table read as one record kind (or several, through kindValues). Every name is a catalogue identifier. */
export type PlainDbMapping = {
  engine: PlainDbEngine;
  /** Postgres: schema defaults to public. MySQL: the connection's database. SQLite: main. */
  table: { schema?: string; name: string };
  columns: PlainDbColumns;
  /** Exactly one of constantKind or columns.kind + kindValues. */
  constantKind?: string;
  kindValues?: Record<string, string>;
  /** Source status word to dictionary status; required when columns.status is mapped. */
  statusValues?: Record<string, string>;
  /** A constant ISO currency, when there is no currency column. Exactly one of the two for money. */
  currency?: string;
  measure: 'money' | 'count';
  moneyUnit: 'major' | 'minor';
  /** Unit word for count measures; defaults to item. */
  countUnit?: string;
  dateFormat: PlainDbDateFormat;
  /** Inclusive business-date period, ISO dates. Filters on the date column in the database. */
  period?: { from: string; to: string };
};

export type PostgresConnectionConfig = {
  engine: 'postgres'; host: string; port: number; database: string; user: string;
  /** disable is allowed only for loopback hosts. */
  ssl: 'require' | 'disable';
  /** Reference resolved by the credential callback. The password itself never travels in settings. */
  passwordRef: string;
};
export type MysqlConnectionConfig = Omit<PostgresConnectionConfig, 'engine'> & { engine: 'mysql' };
/** An absolute path to an existing regular file (not a symlink), opened read-only. */
export type SqliteConnectionConfig = { engine: 'sqlite'; path: string };
export type PlainDbConnection = PostgresConnectionConfig | MysqlConnectionConfig | SqliteConnectionConfig;

export type CredentialResolver = (ref: string) => Promise<string>;

/** The pg Client surface this connector uses. Tests inject a fake. */
export type PgLikeClient = {
  connect(): Promise<unknown>;
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<unknown>;
};
export type PgClientConfig = {
  host: string; port: number; database: string; user: string; password: string;
  ssl: false | { rejectUnauthorized: true; servername?: string };
  connectionTimeoutMillis: number; query_timeout: number; statement_timeout: number;
  application_name: string; options: string;
};
export type PgClientFactory = (config: PgClientConfig) => PgLikeClient;
export type MysqlSocketFactory = (target: { host: string; port: number }) => Duplex;

export type PlainDbOptions = {
  credentials?: CredentialResolver;
  /** Hard row limit, 1..50000 (default 50000). More rows in the database than this is refused, never truncated. */
  rowLimit?: number;
  /** Per-statement and connection timeout, 1000..300000 ms (default 30000). */
  timeoutMs?: number;
  createPostgresClient?: PgClientFactory;
  createMysqlSocket?: MysqlSocketFactory;
};

export type CatalogueColumn = { name: string; type: string; nullable: boolean };
export type PlainDbTable = { schema: string | null; name: string; columns: CatalogueColumn[] };

/** A bound query: SQL built only by this connector from catalogue-checked identifiers, and its parameters. */
export type BoundQuery = { text: string; params: (string | number)[] };
export type PlainDbRow = Record<string, string | null>;

/** What one engine offers inside its read-only snapshot. */
export type SnapshotSession = {
  /** Columns of one table (when given) or of every visible table, from the database's own catalogue. */
  catalogue(table?: { schema: string | null; name: string }): Promise<{ schema: string | null; table: string; column: CatalogueColumn }[]>;
  select(query: BoundQuery): Promise<PlainDbRow[]>;
};

export type PlainDbRead = {
  records: PlainDbRow[];
  meta: { declaredRowCount: string; declaredAmount?: string; declaredAmountUnit: 'major' | 'minor'; declaredReference: 'database-aggregate' };
  recipe: SourceRecipe;
};
