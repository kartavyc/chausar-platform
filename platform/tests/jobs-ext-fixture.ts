// Shared synthetic fixture for jobs-ext tests: a labelled test clock and made-up invoices. No network.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import type { Context } from '../runtime/contracts.ts';

export const DAY = 86_400_000;
export const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
export const start = Date.parse('2026-10-05T03:00:00.000Z');
export const date = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export type Row = { id: string; kind: string; date: string; amount: string; customer: string; invoice: string; due?: string };
export function csv(rows: Row[], sourceId = 'synthetic-receivables') {
  const header = 'id,kind,date,amount,currency,customerId,invoiceId,dueDate,status,branch';
  return { sourceId, format: 'csv',
    content: `${header}\n${rows.map(r => `${r.id},${r.kind},${r.date},${r.amount},INR,${r.customer},${r.invoice},${r.due ?? ''},${r.kind === 'invoice' ? 'unpaid' : 'settled'},main`).join('\n')}\n`,
    expectedTotals: { rowCount: rows.length, amountMinor: String(rows.reduce((s, r) => s + BigInt(r.amount.replace('.', '')), 0n)) },
    recipe: { version: 1, id: `synthetic-${sourceId}-v1`, system: 'synthetic-csv', edition: '1', scope: { company: 'Synthetic receivables shop', branches: ['main'] },
      bindings: [
        { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' }, { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
        { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' }, { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
        { target: 'currency', source: 'currency', type: 'string', nulls: 'reject' },
        ...['customerId', 'invoiceId', 'status', 'branch'].map(name => ({ target: name, source: name, type: 'string', nulls: 'omit' })),
        { target: 'dueDate', source: 'dueDate', type: 'date', dateFormat: 'ISO', nulls: 'omit' },
      ], allowedKinds: ['invoice', 'payment'], allowedStatuses: ['unpaid', 'settled'], onUnmapped: 'reject' } };
}

export const defaultRows = (): Row[] => [
  { id: 'inv-a', kind: 'invoice', date: date(start - 20 * DAY), amount: '1000.00', customer: 'cust-a', invoice: 'INV-A', due: date(start - 5 * DAY) },
  { id: 'inv-b', kind: 'invoice', date: date(start - 90 * DAY), amount: '2500.00', customer: 'cust-b', invoice: 'INV-B', due: date(start - 75 * DAY) },
];

export async function fixture(t: any, options: { modules?: Record<string, unknown>; maxActiveJobs?: number; rows?: Row[] } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-jobsx-'));
  const clock = { now: start };
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file',
    durableJobs: { workerId: 'synthetic-jobsx', maxActiveJobs: options.maxActiveJobs ?? 20, leaseMs: 1000, networkAvailable: () => true, clock: () => clock.now },
    modules: { 'jobs-ext': { agentMaxUnits: 200, ...(options.modules ?? {}) } } });
  t.after(async () => { await engine.shutdown(); await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Synthetic receivables shop', passphrase: 'Synthetic-jobsx-passphrase', demo: false });
  await engine.request('sources.import', csv(options.rows ?? defaultRows()));
  const ui = (method: string, payload: any = {}) => engine.request(method, payload);
  engine.updateJobLifecycle({ awake: true, windowOpen: true, backgroundEnabled: false });
  return { engine, clock, ui, store: (engine as any).store() };
}

export async function startReceivables(ui: (m: string, p?: any) => Promise<any>, overrides: any = {}) {
  const proposal = await ui('jobsx.propose', { template: 'receivables-week', overrides });
  return ui('jobsx.approveProposal', { id: proposal.id, digest: proposal.digest });
}
