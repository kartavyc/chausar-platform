import { connect, migrate } from './sql.ts';

const url = process.env.DATABASE_URL;
if (!url) { process.stderr.write('DATABASE_URL is not set.\n'); process.exit(2); }
const sql = await connect(url, 1);
try { const applied = await migrate(sql); process.stdout.write(applied.length ? `Applied: ${applied.join(', ')}\n` : 'Nothing to apply.\n'); }
finally { await sql.end(); }
