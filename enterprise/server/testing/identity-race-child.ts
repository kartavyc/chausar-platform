import { PostgresEnterpriseStore } from '../state-store.ts';

// TEST ONLY. One of several separate OS processes that sign in the same new identity at the same moment, for
// platform/tests/release-enterprise-identity.test.ts. Each process has its own pool to the shared PostgreSQL.
// The "member" it provisions is a synthetic id naming this process; the parent checks that exactly one process provisioned.
//   CHAUSAR_RACE = JSON { url, ca?, issuer, subject, startAt, holdMs }

const input = JSON.parse(process.env.CHAUSAR_RACE ?? '{}') as { url: string; ca?: string; issuer: string; subject: string; startAt: number; holdMs: number };
const store = await PostgresEnterpriseStore.connect({ url: input.url, ...(input.ca ? { tls: { ca: input.ca } } : {}) });
try {
  await new Promise(resolve => setTimeout(resolve, Math.max(0, input.startAt - Date.now())));
  let provisioned = false; const began = Date.now();
  const decision = await store.identities.withIdentity(input.issuer, input.subject, async previous => {
    if (previous) return { memberId: previous.memberId };
    // Hold the identity long enough that the other processes are certainly waiting on it.
    await new Promise(resolve => setTimeout(resolve, input.holdMs)); provisioned = true;
    const memberId = `member-process-${process.pid}`;
    return { memberId, save: { issuer: input.issuer, subject: input.subject, memberId, role: 'viewer', branches: ['*'], revoked: false, updatedAt: new Date().toISOString() } };
  });
  process.stdout.write(`${JSON.stringify({ pid: process.pid, provisioned, memberId: decision.memberId, waitedMs: Date.now() - began })}\n`);
} finally { await store.close(); }
