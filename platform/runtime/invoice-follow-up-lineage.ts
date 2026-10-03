import { check, type State } from './contracts.ts';
import { digest } from './actions.ts';
import type { ProviderSettlement } from './job-protocol.ts';

export type InvoiceLineage = { sourceIds: string[]; factIds: string[]; at: string };
export type InvoicePurgeSelection = { sourceId?: string; expiredFactIds?: string[]; cutoff?: string };
const operationKind = 'invoice-operation-no-resend-v1';
const deliveryKind = 'invoice-delivery-no-resend-v1';
const accountingKind = 'invoice-mandate-accounting-v1';
export const invoiceOperationalTombstone = (value: any) => [operationKind, deliveryKind, accountingKind].includes(value.kind);
const identity = (kind: string, key: string) => digest({ kind, key });
export function invoiceOperationTombstone(state: State, key: string) {
  return state.tombstones.find(t => t.kind === operationKind && t.identity === identity(operationKind, key));
}
export function invoiceDeliveryTombstone(state: State, key: string) {
  return state.tombstones.find(t => t.kind === deliveryKind && t.identity === identity(deliveryKind, key));
}
export function invoiceMandateTombstone(state: State, id: string) {
  return state.tombstones.find(t => t.kind === accountingKind && t.identity === identity(accountingKind, id));
}
export function rememberInvoiceOperation(state: State, key: string, requestDigest: string, settlement: ProviderSettlement, at: string) {
  const prior = invoiceOperationTombstone(state, key);
  check(!prior || (prior.requestDigest === requestDigest && prior.spentMinor === settlement.spentMinor
    && prior.modelUnits === settlement.modelUnits && prior.durationMs === settlement.durationMs
    && prior.actionExposureMinor === settlement.actionExposureMinor), 'JOB_OPERATION_CONFLICT', 'The invoice operation identity or established cost changed.');
  if (!prior) state.tombstones.push({ kind: operationKind, identity: identity(operationKind, key), requestDigest,
    outcome: 'committed', spentMinor: settlement.spentMinor, modelUnits: settlement.modelUnits,
    durationMs: settlement.durationMs, actionExposureMinor: settlement.actionExposureMinor, at });
}
export function rememberInvoiceDelivery(state: State, delivery: any) {
  const value = { kind: deliveryKind, identity: identity(deliveryKind, delivery.key), payloadDigest: delivery.payloadDigest,
    outcome: delivery.status, costMinor: delivery.costMinor, at: delivery.at };
  const prior = invoiceDeliveryTombstone(state, delivery.key);
  check(!prior || (prior.payloadDigest === delivery.payloadDigest && prior.costMinor === delivery.costMinor && prior.at === delivery.at),
    'INVOICE_DELIVERY_CONFLICT', 'The delivery identity or established cost changed.');
  if (prior && prior.outcome !== 'reserved') {
    check(delivery.status === 'reserved' || delivery.status === prior.outcome, 'INVOICE_DELIVERY_CONFLICT', 'A terminal delivery outcome cannot be replaced.');
    return; // An older restored reservation cannot downgrade a terminal marker.
  }
  if (prior) Object.assign(prior, value); else state.tombstones.push(value);
}
export function invoiceLineage(state: State, sourceIds: string[], at: string, factIds: string[] = []): InvoiceLineage {
  const sources = [...new Set(sourceIds)].sort();
  return { sourceIds: sources, factIds: [...new Set([...factIds, ...state.facts.filter(f => sources.includes(f.sourceId)).map(f => f.id)])].sort(), at };
}

/** Shared Trust owner must call inside the authorized purge transaction, before
 * removing facts/records. This also covers legacy records without direct lineage.
 * No proof, preview, request or settlement digest is rewritten. */
export function prepareInvoicePurge(state: State, selection: InvoicePurgeSelection, at: string) {
  check(Number.isFinite(Date.parse(at)) && (selection.sourceId !== undefined || selection.expiredFactIds !== undefined || selection.cutoff !== undefined)
    && (selection.cutoff === undefined || Number.isFinite(Date.parse(selection.cutoff))), 'INVALID_INVOICE_PURGE', 'Supply the authorized exact purge selection and instant.');
  const jobs = state.jobs.filter(j => j.type === 'invoice-follow-up');
  const proofs = state.answers.filter(a => a.kind === 'invoice-balance-proof-v1');
  const operations = state.answers.filter(a => a.kind === 'invoice-job-operation-v1');
  const actions = state.actions.filter(a => a.connector === 'simulated-invoice-reminder');
  const proofLineage = (proof: any): InvoiceLineage => {
    const job = jobs.find(j => j.id === proof.jobId), receipt = state.receipts.find(r => r.id === proof.receiptId);
    return invoiceLineage(state, [...(proof.sourceIds ?? []), ...(job?.sourceIds ?? []), ...(receipt?.requestedSourceIds ?? []), ...(receipt?.sourceIds ?? [])],
      proof.at, [...(proof.factIds ?? []), proof.invoiceFactId, ...(proof.paymentFactIds ?? []), ...(proof.bankFactIds ?? []),
        ...(receipt?.rowIds ?? []), ...(receipt?.exclusions ?? []).map((r: any) => r.rowId)].filter(Boolean));
  };
  const associatedProof = (record: any) => proofs.find(p => p.id === (record.proofId ?? record.settlement?.result?.value?.proofId
    ?? actions.find(a => a.id === record.actionId)?.payload?.proofId));
  const lineage = (record: any): InvoiceLineage => {
    const proof = record.kind === 'invoice-balance-proof-v1' ? record : associatedProof(record);
    const base = proof ? proofLineage(proof) : invoiceLineage(state, record.sourceIds ?? [], record.at ?? record.approvedAt ?? record.createdAt);
    const action = actions.find(a => a.id === record.actionId || a.id === record.settlement?.result?.value?.actionId);
    const consent = state.answers.find(a => a.kind === 'invoice-opt-in-v1' && a.id === action?.payload?.consentId);
    return invoiceLineage(state, [...base.sourceIds, ...(record.sourceIds ?? []), ...(consent ? [consent.sourceId] : [])],
      record.at ?? record.approvedAt ?? base.at, [...base.factIds, ...(record.factIds ?? [])]);
  };
  const expired = new Set(selection.expiredFactIds ?? []);
  const affected = (value: InvoiceLineage) => (selection.sourceId !== undefined && value.sourceIds.includes(selection.sourceId))
    || value.factIds.some(id => expired.has(id)) || (selection.cutoff !== undefined && Date.parse(value.at) < Date.parse(selection.cutoff));
  const owned = state.answers.filter(a => ['invoice-balance-proof-v1', 'invoice-job-operation-v1', 'invoice-reminder-approval-v1',
    'invoice-simulated-delivery-v1', 'invoice-paid-v1'].includes(a.kind));
  const erased = new Set(owned.filter(a => {
    const evidence = lineage(a);
    // Legacy orphan journals cannot prove a surviving source scope. Preserve
    // their opaque operation identity/cost, never guess a replacement lineage.
    return evidence.sourceIds.length === 0 || affected(evidence);
  }));
  const jobIds = new Set(jobs.filter(j => affected(invoiceLineage(state, j.sourceIds, j.createdAt))).map(j => j.id));
  for (const record of erased) {
    const proof = associatedProof(record);
    const jobId = record.jobId ?? proof?.jobId ?? actions.find(a => a.id === record.actionId)?.payload?.jobId;
    if (jobId) jobIds.add(jobId);
  }
  // Purging an occurrence's evidence also fences its dependent mandate and
  // approvals. Keep only opaque identity and exact established accounting.
  for (const job of jobs.filter(j => jobIds.has(j.id))) {
    const marker = { kind: accountingKind, identity: identity(accountingKind, job.id), budgetMinor: job.budgetMinor,
      spentMinor: job.spentMinor, reservedMinor: job.reservedMinor, status: job.status, at };
    const prior = state.tombstones.find(t => t.kind === accountingKind && t.identity === marker.identity);
    // A purged mandate cannot legitimately resume. An older restored snapshot
    // must not overwrite its established spend or release its held exposure.
    if (!prior) state.tombstones.push(marker);
  }
  for (const record of owned) {
    const proof = associatedProof(record), action = actions.find(a => a.id === record.actionId || a.id === record.settlement?.result?.value?.actionId);
    if (jobIds.has(record.jobId ?? proof?.jobId ?? action?.payload?.jobId)) erased.add(record);
  }
  for (const record of operations.filter(a => erased.has(a))) rememberInvoiceOperation(state, record.key, record.requestDigest, record.settlement, at);
  for (const record of owned.filter(a => erased.has(a) && a.kind === 'invoice-simulated-delivery-v1')) rememberInvoiceDelivery(state, record);
  state.answers = state.answers.filter(a => !erased.has(a));
  state.actions = state.actions.filter(a => !actions.includes(a) || !jobIds.has(a.payload?.jobId));
  state.jobs = state.jobs.filter(j => j.type !== 'invoice-follow-up' || !jobIds.has(j.id));
  return { answersRemoved: erased.size, mandatesRemoved: jobIds.size };
}
