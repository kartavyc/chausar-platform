/**
 * Run the intake service against PostgreSQL. Not deployed: this is for local runs.
 *
 *   DATABASE_URL=postgres://... INTAKE_OPEN=true PORT=8787 node src/main.ts
 */
import pg from 'pg';
import { startIntakeServer } from './server.ts';
import { PostgresIntakeStore } from './store.ts';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) { process.stderr.write('Set DATABASE_URL to a PostgreSQL database that has schema.sql applied.\n'); process.exit(1); }
const pool = new pg.Pool({ connectionString, max: 10 });
const service = await startIntakeServer({
  store: new PostgresIntakeStore(pool), open: process.env.INTAKE_OPEN === 'true',
  port: Number(process.env.PORT ?? 8787), host: process.env.HOST ?? '127.0.0.1',
});
process.stdout.write(`Learning intake listening on ${service.url}\n`);
const stop = async () => { await service.close(); await pool.end(); process.exit(0); };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
