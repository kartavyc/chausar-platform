// D7: DuckDB's own process. analytics.ts starts this file (runtimeEntry('analytics-worker')) for each private calculation;
// it reads one projection on stdin and answers one result. It no longer starts analytics.ts itself, so the bundle can
// carry it as an entry.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { workerMain } from './analytics.ts';

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await workerMain();
