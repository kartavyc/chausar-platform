import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

export class Denied extends Error {
  status: number;
  code: string;
  constructor(code: string, status = 403) { super(code); this.code = code; this.status = status; }
}
export type Identity = { tenantId: string; principalId: string };
export type Scope = {
  tenantId: string; principalId: string; grantId: string; grantRevision: number;
  policyId: string; policyRevision: number; policyEpoch: number; sourceRevision: number;
  datasetId: string; purpose: string; regions: string[]; fields: string[];
  retentionSeconds: number;
};
export const metricBindings = {
  gross_inr: { member: 'Invoices.grossInr', fields: ['amount', 'fx_to_inr'], method:'sum_amount_times_fx', unit:'INR' },
  shipment_quantity: { member: 'Shipments.quantity', fields: ['shipment_quantity'], method:'sum_shipments_at_invoice_grain', unit:'item' },
  refund_inr: { member: 'Returns.refund', fields: ['refund'], method:'sum_inr_refunds_at_invoice_grain', unit:'INR' },
} as const;
export type MetricId = keyof typeof metricBindings;
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.entries(value).sort(([a],[b])=>a.localeCompare(b))
    .map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',') + '}';
  return JSON.stringify(value);
}
export function digest(value: unknown): string { return createHash('sha256').update(canonical(value)).digest('hex'); }
export async function transaction<T>(pool: Pool, fn: (db: PoolClient)=>Promise<T>): Promise<T> {
  const db = await pool.connect();
  try { await db.query('BEGIN'); await db.query("SET LOCAL statement_timeout='45s'");
    const result = await fn(db); await db.query('COMMIT'); return result;
  } catch (error) { await db.query('ROLLBACK'); throw error; } finally { db.release(); }
}
export function subset(left: string[], right: string[]): boolean { return left.every(x=>right.includes(x)); }
