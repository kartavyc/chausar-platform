export class QualificationError extends Error {
  code: string;
  constructor(code: string, message: string);
}
export type DisposableEnvironment = { CHAUSAR_TEST_DATABASE_DISPOSABLE?: string; CHAUSAR_TEST_DATABASE_URL?: string };
export type DisposablePostgresConfiguration = { host: '127.0.0.1' | '::1'; port: number; user: string; password: string; database: 'chausar_test' };
export function disposablePostgresConfiguration(environment: DisposableEnvironment): DisposablePostgresConfiguration;
export function assertPristinePostgres(pool: { query(sql: string): Promise<{ rows: Record<string, unknown>[] }> }): Promise<void>;
export type QualificationReport = {
  suite: string;
  passed: boolean;
  checks: { name: string; passed: boolean; evidence?: string; reason?: string; [key: string]: unknown }[];
  blockers: { engine: string; reason: string }[];
  engines: { duckdb: string; postgres: string };
  scope: string;
};
export function runDatabaseDifferential(environment?: DisposableEnvironment): Promise<QualificationReport>;
