import { check, type State } from './contracts.ts';
import { digest } from './actions.ts';
import { invoiceOperationalTombstone } from './invoice-follow-up-lineage.ts';
import type { VaultRestoreDescriptor } from './vault.ts';

const operationKind = 'invoice-operation-no-resend-v1';
const deliveryKind = 'invoice-delivery-no-resend-v1';
const mandateKind = 'invoice-mandate-accounting-v1';
const liveMandateDomain = 'invoice-live-mandate-accounting-v1';
const format = 'chausar.invoice-vault-custody.v1';
const maxMarkers = 16_384, maxBytes = 4 * 1024 * 1024;
type Marker = Record<string, any>;
type LiveMandateAccounting = { identity: string; budgetMinor: string; spentMinor: string; reservedMinor: string; status: string };
/** An in-memory trusted host capability captured from authenticated current
 * authority. It is not an archive proof of later history or a portable sidecar. */
export type InvoiceCustodyArtifact = {
  format: typeof format; vaultId: string; workspaceId: string; revision: number;
  markers: Marker[]; erasedOperationIdentities: string[]; erasedDeliveryIdentities: string[];
  liveMandateAccounting: LiveMandateAccounting[];
};
const identity = (kind: string, key: string) => digest({ kind, key });
const hex = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const minor = (value: unknown) => typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value);
const whole = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
const instant = (value: unknown) => typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value));
const mandateStatus = (value: unknown) => ['scheduled', 'running', 'paused', 'revoked', 'approval-blocked', 'budget-blocked',
  'runner-blocked', 'network-wait', 'outcome-unknown', 'cancelled', 'stopped', 'awaiting-acceptance', 'accepted'].includes(value as string);
function exact(value: any, keys: string[]) {
  check(value && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value))
    && Reflect.ownKeys(value).length === keys.length
    && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0')
    && Object.values(Object.getOwnPropertyDescriptors(value)).every(p => p.enumerable && 'value' in p),
  'INVOICE_CUSTODY_INVALID', 'Invoice custody must contain only reviewed opaque fields.');
}
function validateMarker(value: Marker) {
  const base = ['kind', 'identity', 'at'];
  if (value?.kind === operationKind) {
    exact(value, [...base, 'requestDigest', 'outcome', 'spentMinor', 'modelUnits', 'durationMs', 'actionExposureMinor']);
    check(hex(value.requestDigest) && value.outcome === 'committed' && minor(value.spentMinor)
      && whole(value.modelUnits) && whole(value.durationMs) && minor(value.actionExposureMinor),
    'INVOICE_CUSTODY_INVALID', 'Invoice operation custody must preserve exact established settlement.');
  } else if (value?.kind === deliveryKind) {
    exact(value, [...base, 'payloadDigest', 'outcome', 'costMinor']);
    check(hex(value.payloadDigest) && ['reserved', 'sent', 'not-sent'].includes(value.outcome) && minor(value.costMinor),
      'INVOICE_CUSTODY_INVALID', 'Invoice delivery custody must preserve exact established cost and outcome.');
  } else {
    check(value?.kind === mandateKind, 'INVOICE_CUSTODY_INVALID', 'Unrecognized invoice custody kind.');
    exact(value, [...base, 'budgetMinor', 'spentMinor', 'reservedMinor', 'status']);
    check(minor(value.budgetMinor) && minor(value.spentMinor) && minor(value.reservedMinor)
      && mandateStatus(value.status),
    'INVOICE_CUSTODY_INVALID', 'Invoice mandate custody must preserve exact established accounting.');
  }
  check(hex(value.identity) && instant(value.at), 'INVOICE_CUSTODY_INVALID', 'Invoice custody identity or instant is invalid.');
}
function markerMap(markers: Marker[]) {
  check(Array.isArray(markers) && markers.length <= maxMarkers, 'INVOICE_CUSTODY_LIMIT', 'Invoice custody exceeds its bounded marker count.');
  const map = new Map<string, Marker>();
  for (const marker of markers) {
    validateMarker(marker);
    check(!map.has(marker.identity), 'INVOICE_CUSTODY_CONFLICT', 'Invoice custody contains duplicate identities.');
    map.set(marker.identity, marker);
  }
  return map;
}
function validateArtifact(artifact: InvoiceCustodyArtifact) {
  exact(artifact, ['format', 'vaultId', 'workspaceId', 'revision', 'markers', 'erasedOperationIdentities', 'erasedDeliveryIdentities', 'liveMandateAccounting']);
  check(artifact.format === format && typeof artifact.vaultId === 'string' && artifact.vaultId.length > 0
    && typeof artifact.workspaceId === 'string' && artifact.workspaceId.length > 0 && whole(artifact.revision),
  'INVOICE_CUSTODY_INVALID', 'Invoice custody identity or revision is invalid.');
  const markers = markerMap(artifact.markers);
  for (const [values, kind] of [[artifact.erasedOperationIdentities, operationKind], [artifact.erasedDeliveryIdentities, deliveryKind]] as const) {
    check(Array.isArray(values) && values.length <= maxMarkers && new Set(values).size === values.length
      && values.every(id => hex(id) && markers.get(id)?.kind === kind),
    'INVOICE_CUSTODY_INVALID', 'Erased payload identities require matching opaque custody.');
  }
  check(Array.isArray(artifact.liveMandateAccounting) && artifact.liveMandateAccounting.length <= maxMarkers,
    'INVOICE_CUSTODY_LIMIT', 'Live invoice accounting exceeds its bounded entry count.');
  const liveIdentities = new Set<string>();
  for (const accounting of artifact.liveMandateAccounting) {
    exact(accounting, ['identity', 'budgetMinor', 'spentMinor', 'reservedMinor', 'status']);
    check(hex(accounting.identity) && minor(accounting.budgetMinor) && minor(accounting.spentMinor)
      && minor(accounting.reservedMinor) && mandateStatus(accounting.status),
    'INVOICE_CUSTODY_INVALID', 'Live invoice custody must preserve exact established accounting.');
    check(!liveIdentities.has(accounting.identity), 'INVOICE_CUSTODY_CONFLICT', 'Live invoice custody contains duplicate identities.');
    liveIdentities.add(accounting.identity);
  }
  check(Buffer.byteLength(JSON.stringify(artifact)) <= maxBytes, 'INVOICE_CUSTODY_LIMIT', 'Invoice custody exceeds its bounded byte size.');
  return markers;
}
export function invoiceRestoreNeedsCustody(state: State) {
  return state.jobs.some(j => j.type === 'invoice-follow-up')
    || state.actions.some(a => a.connector === 'simulated-invoice-reminder')
    || state.answers.some(a => typeof a.kind === 'string' && a.kind.startsWith('invoice-'))
    || state.tombstones.some(t => t && invoiceOperationalTombstone(t));
}
export function captureInvoiceCustody(state: State, vaultId: string): InvoiceCustodyArtifact {
  const markers = structuredClone(state.tombstones.filter(t => t && invoiceOperationalTombstone(t)));
  const erasedMandates = new Set(markers.filter(m => m.kind === mandateKind).map(m => m.identity));
  const liveJobs = state.jobs.filter(j => j.type === 'invoice-follow-up');
  check(liveJobs.length <= maxMarkers, 'INVOICE_CUSTODY_LIMIT', 'Live invoice accounting exceeds its bounded entry count.');
  const operations = new Set(state.answers.filter(a => a.kind === 'invoice-job-operation-v1').map(a => identity(operationKind, a.key)));
  const deliveries = new Set(state.answers.filter(a => a.kind === 'invoice-simulated-delivery-v1').map(a => identity(deliveryKind, a.key)));
  const artifact: InvoiceCustodyArtifact = { format, vaultId, workspaceId: state.workspace.id, revision: state.revision, markers,
    erasedOperationIdentities: markers.filter(m => m.kind === operationKind && !operations.has(m.identity)).map(m => m.identity),
    erasedDeliveryIdentities: markers.filter(m => m.kind === deliveryKind && !deliveries.has(m.identity)).map(m => m.identity),
    liveMandateAccounting: liveJobs.map(j => {
      check(!erasedMandates.has(identity(mandateKind, j.id)),
        'INVOICE_CUSTODY_CONFLICT', 'An erased invoice mandate cannot also be live custody.');
      return { identity: identity(liveMandateDomain, j.id), budgetMinor: j.budgetMinor,
        spentMinor: j.spentMinor, reservedMinor: j.reservedMinor, status: j.status };
    }) };
  validateArtifact(artifact);
  return artifact;
}
function mergeMarker(old: Marker, latest: Marker): Marker {
  check(old.kind === latest.kind, 'INVOICE_CUSTODY_CONFLICT', 'Invoice custody kind changed.');
  const fields = old.kind === deliveryKind ? ['payloadDigest', 'costMinor', 'at']
    : old.kind === operationKind ? ['requestDigest', 'spentMinor', 'modelUnits', 'durationMs', 'actionExposureMinor', 'at']
      : ['budgetMinor', 'spentMinor', 'reservedMinor', 'status', 'at'];
  check(fields.every(field => old[field] === latest[field]), 'INVOICE_CUSTODY_CONFLICT', 'Established invoice identity or accounting changed.');
  if (old.kind === deliveryKind) {
    check(old.outcome === latest.outcome || old.outcome === 'reserved',
      'INVOICE_CUSTODY_CONFLICT', 'Trusted current custody cannot downgrade or replace a terminal delivery.');
  }
  return structuredClone(latest);
}
/** Mutates only the authenticated detached restore draft, before publication.
 * Root remains responsible for current source/fact deletion policy. Missing
 * current custody refuses invoice restore, including a fresh-process restore. */
export function prepareInvoiceRestoredState(state: State, artifact: InvoiceCustodyArtifact | undefined,
  descriptor: Readonly<VaultRestoreDescriptor>) {
  if (!artifact) {
    check(!invoiceRestoreNeedsCustody(state), 'INVOICE_RESTORE_CUSTODY_REQUIRED', 'Invoice restore requires trusted current workspace and vault custody.');
    return;
  }
  const latest = validateArtifact(artifact);
  check(artifact.vaultId === descriptor.vaultId && artifact.workspaceId === descriptor.workspaceId
    && state.workspace.id === descriptor.workspaceId && artifact.revision >= descriptor.backupRevision,
  'INVOICE_RESTORE_CUSTODY_MISMATCH', 'Trusted invoice custody must cover this exact workspace, vault and backup revision.');
  const old = markerMap(state.tombstones.filter(t => t && invoiceOperationalTombstone(t)));
  for (const [id, marker] of old) {
    check(latest.has(id), 'INVOICE_CUSTODY_CONFLICT', 'Current custody is missing an established invoice marker.');
    mergeMarker(marker, latest.get(id)!);
  }
  const merged = new Map(latest);
  for (const [id, marker] of old) merged.set(id, mergeMarker(marker, latest.get(id)!));
  const erasedJobs = new Set(state.jobs.filter(j => j.type === 'invoice-follow-up'
    && merged.get(identity(mandateKind, j.id))?.kind === mandateKind).map(j => j.id));
  const live = new Map(artifact.liveMandateAccounting.map(a => [a.identity, a]));
  for (const job of state.jobs.filter(j => j.type === 'invoice-follow-up' && !erasedJobs.has(j.id))) {
    check(!(artifact.revision > descriptor.backupRevision && (job.status === 'running' || job.reservedMinor !== '0')),
      'INVOICE_RESTORE_ACCOUNTING_CHANGED', 'An older running invoice mandate or held reservation cannot prove unchanged dispatch history.');
    const accounting = live.get(identity(liveMandateDomain, job.id));
    check(accounting && ['budgetMinor', 'spentMinor', 'reservedMinor', 'status'].every(field => job[field] === accounting[field as keyof LiveMandateAccounting]),
      'INVOICE_RESTORE_ACCOUNTING_CHANGED', 'Restored invoice mandate accounting or status differs from trusted current custody, or its later history is unavailable.');
  }
  state.tombstones = [...state.tombstones.filter(t => !t || !invoiceOperationalTombstone(t)), ...merged.values()].map(t => structuredClone(t));
  const proofs = new Map(state.answers.filter(a => a.kind === 'invoice-balance-proof-v1').map(a => [a.id, a]));
  const actions = new Map(state.actions.filter(a => a.connector === 'simulated-invoice-reminder').map(a => [a.id, a]));
  const erasedOperations = new Set(artifact.erasedOperationIdentities), erasedDeliveries = new Set(artifact.erasedDeliveryIdentities);
  const erasedAnswers = new Set<any>(), erasedActions = new Set<string>();
  const jobOf = (a: any) => a.jobId ?? proofs.get(a.proofId ?? a.settlement?.result?.value?.proofId
    ?? actions.get(a.actionId)?.payload?.proofId)?.jobId
    ?? actions.get(a.actionId ?? a.settlement?.result?.value?.actionId)?.payload?.jobId;
  const owned = new Set(['invoice-balance-proof-v1', 'invoice-job-operation-v1', 'invoice-reminder-approval-v1',
    'invoice-simulated-delivery-v1', 'invoice-paid-v1']);
  for (const record of state.answers) {
    if (owned.has(record.kind) && erasedJobs.has(jobOf(record))) erasedAnswers.add(record);
    if (record.kind === 'invoice-job-operation-v1') {
      const marker = merged.get(identity(operationKind, record.key));
      if (marker) check(marker.requestDigest === record.requestDigest && marker.spentMinor === record.settlement?.spentMinor
        && marker.modelUnits === record.settlement?.modelUnits && marker.durationMs === record.settlement?.durationMs
        && marker.actionExposureMinor === record.settlement?.actionExposureMinor,
      'INVOICE_CUSTODY_CONFLICT', 'Restored invoice operation differs from its established settlement.');
      if (erasedOperations.has(identity(operationKind, record.key))) erasedAnswers.add(record);
    }
    if (record.kind === 'invoice-simulated-delivery-v1') {
      const marker = merged.get(identity(deliveryKind, record.key));
      if (marker) check(marker.payloadDigest === record.payloadDigest && marker.costMinor === record.costMinor && marker.at === record.at,
        'INVOICE_CUSTODY_CONFLICT', 'Restored invoice delivery differs from its established cost or payload.');
      if (marker) check(record.status === marker.outcome || record.status === 'reserved',
        'INVOICE_CUSTODY_CONFLICT', 'Restored terminal delivery conflicts with current custody.');
      if (erasedDeliveries.has(identity(deliveryKind, record.key)) || (marker && record.status === 'reserved' && marker.outcome !== 'reserved')) {
        erasedAnswers.add(record); erasedActions.add(record.actionId);
      }
    }
  }
  for (const action of actions.values()) if (erasedJobs.has(action.payload?.jobId)) erasedActions.add(action.id);
  state.answers = state.answers.filter(a => !erasedAnswers.has(a)
    && !(a.kind === 'invoice-reminder-approval-v1' && erasedActions.has(a.actionId)));
  state.actions = state.actions.filter(a => a.connector !== 'simulated-invoice-reminder' || !erasedActions.has(a.id));
  state.jobs = state.jobs.filter(j => j.type !== 'invoice-follow-up' || !erasedJobs.has(j.id));
}
