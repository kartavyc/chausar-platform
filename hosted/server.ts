/** Entry point: `node server.ts api` or `node server.ts worker`. Configuration is in DEPLOY.md. Not deployed by the build. */
import { connect } from './db/sql.ts';
import { serve } from './shared/http.ts';
import { HostedError } from './shared/errors.ts';
import type { Fetch } from './shared/module.ts';
import { buildHosted } from './app.ts';
import { runWorkerProcess } from './worker/index.ts';

const role = process.argv[2];
if (role !== 'api' && role !== 'worker') { process.stderr.write('Use: node server.ts api|worker\n'); process.exit(2); }
const url = process.env.DATABASE_URL;
if (!url) { process.stderr.write('DATABASE_URL is not set.\n'); process.exit(2); }
const sql = await connect(url);
let app;
// Logs carry codes only: never a phone number, an address, a token, a prompt or an answer.
try { app = buildHosted(process.env, sql, globalThis.fetch as unknown as Fetch); }
catch (error) { process.stderr.write(`${error instanceof HostedError ? error.code : 'SERVER_MISCONFIGURED'}\n`); await sql.end(); process.exit(1); }
const stop = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => stop.abort());
if (role === 'api') {
  const server = await serve(app.router, { port: Number(process.env.PORT ?? 8080) });
  process.stdout.write('api ready\n');
  stop.signal.addEventListener('abort', () => server.close(() => { void sql.end(); }), { once: true });
} else {
  process.stdout.write('worker ready\n');
  await runWorkerProcess({ worker: app.worker, modules: app.modules, signal: stop.signal, onError: (module, code) => process.stderr.write(`sweep ${module} ${code}\n`) });
  await sql.end();
}
