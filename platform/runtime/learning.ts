import { authorize, audit, check, guardChange, newId, now } from './contracts.ts';
import type { Context, State, StateStore } from './contracts.ts';
import { canonical, current, digest, sourceAccess } from './actions.ts';
import { assertSourceAccess } from './trust.ts';

export const STRUCTURAL_FIELDS = ['invoice_id', 'customer_id', 'date', 'due_date', 'amount', 'tax', 'currency', 'account', 'debit', 'credit', 'sku', 'quantity', 'status', 'description', 'order_id', 'payment_id', 'bank_reference', 'branch'] as const;
export const REASON_CODES = ['manual_confirmation', 'ambiguous_field', 'type_match', 'date_format', 'currency_mismatch', 'duplicate_record', 'exact_reference', 'reconciliation', 'unsupported_shape', 'verified_readback'] as const;
export type DecisionKind = 'mapping' | 'customer-match' | 'calculation' | 'action';
export type DecisionInput = { kind: DecisionKind; choice: 'proposed' | 'accepted' | 'rejected' | 'corrected'; reasonCode?: typeof REASON_CODES[number]; fields?: { name: string; type: 'string' | 'integer' | 'decimal' | 'date' | 'boolean' }[]; reportShape?: 'ledger' | 'invoice' | 'bank-statement' | 'order' | 'receipt' | 'summary'; details?: unknown; sourceIds?: string[] };
export type StructuralPayload = { schema: 'chausar.structure.v1'; events: { kind: DecisionKind; choice: DecisionInput['choice']; reasonCode?: string; fields?: { name: string; type: string }[]; reportShape?: string }[] };
export type LearningExporter = { receiver: string; send: (payload: StructuralPayload, idempotencyKey: string) => Promise<{ reference: string }> };
export type ImportDecisionIdentity = { id: string; sourceId: string; branches: string[]; format: string; contentHash: string; recipeHash: string; outcome: 'accepted' | 'rejected'; qualification: 'experimental' };
export type LearningDecision = { id: string; type: 'decision'; recordVersion: 1; at: string; memberId: string; role: Context['role']; epoch: number; sourceIds: string[]; rowIds: string[]; input: DecisionInput; integrity: string; shared: false; importIdentity?: ImportDecisionIdentity; recordIntegrity: string };
const importFormats = ['csv', 'tally-xml', 'zoho-json', 'gst-json', 'bank-csv', 'shopify-json', 'xlsx', 'unsupported'];

function decisionScope(state: State, context: Context, sourceIds: string[], identity?: ImportDecisionIdentity) {
  if (!identity) return sourceAccess(state, context, sourceIds);
  const member = current(state, context); assertSourceAccess(state, context, sourceIds);
  check(Array.isArray(identity.branches) && identity.branches.every(branch => typeof branch === 'string' && branch.length > 0) && (member.branches.includes('*') || identity.branches.length > 0 && identity.branches.every(branch => member.branches.includes(branch))), 'BRANCH_FORBIDDEN', 'The import decision includes a branch outside your permissions.');
}

/** Append to the caller's transaction draft; import and its decision commit together. */
export function appendLearningDecision(state: State, context: Context, input: DecisionInput, lineage: { rowIds?: string[]; importIdentity?: ImportDecisionIdentity } = {}): LearningDecision {
  current(state, context, 'prepare'); redactStructure(input);
  const clean: DecisionInput = JSON.parse(canonical(input));
  check(Buffer.byteLength(canonical(clean)) <= 256 * 1024, 'INVALID_LEARNING_EVENT', 'Local decisions must fit within 256 KiB.');
  check(clean.sourceIds === undefined || Array.isArray(clean.sourceIds) && clean.sourceIds.every(id => typeof id === 'string' && id.length > 0), 'INVALID_LEARNING_EVENT', 'Decision sources must be explicit source identifiers.');
  const sourceIds = [...new Set(clean.sourceIds ?? [])].sort(); clean.sourceIds = sourceIds;
  decisionScope(state, context, sourceIds, lineage.importIdentity);
  const rowIds = [...new Set(lineage.rowIds ?? [])].sort();
  check(rowIds.every(id => state.facts.some(row => row.id === id && sourceIds.includes(row.sourceId))), 'LEARNING_LINEAGE_CHANGED', 'Decision rows must belong to their named sources.');
  const record = { id: newId('learning'), type: 'decision' as const, recordVersion: 1 as const, at: now(), memberId: context.memberId, role: context.role, epoch: context.epoch, sourceIds, rowIds, input: clean, integrity: digest(clean), shared: false as const,
    ...(lineage.importIdentity ? { importIdentity: structuredClone(lineage.importIdentity) } : {}) };
  check(record.importIdentity?.outcome !== 'rejected' || Buffer.byteLength(canonical(record)) <= 256 * 1024, 'INVALID_LEARNING_EVENT', 'A local import refusal must fit within 256 KiB.');
  const event: LearningDecision = { ...record, recordIntegrity: digest(record) };
  state.learning.push(event); audit(state, 'learning.logged', { eventId: event.id, kind: clean.kind, choice: clean.choice });
  return structuredClone(event);
}

/** Historical proof validation for cleanup, without making a revoked author's content undeletable. */
export function assertLearningDecisionRecord(event: any): asserts event is LearningDecision {
  check(event?.type === 'decision' && event.recordVersion === 1 && typeof event.id === 'string' && event.id.length > 0 && typeof event.memberId === 'string' && event.memberId.length > 0 && ['owner', 'cofounder', 'accountant'].includes(event.role) && Number.isSafeInteger(event.epoch) && event.epoch > 0 && Number.isFinite(Date.parse(event.at)) && event.shared === false && Array.isArray(event.sourceIds) && event.sourceIds.every((id: unknown) => typeof id === 'string' && id.length > 0) && Array.isArray(event.rowIds) && event.rowIds.every((id: unknown) => typeof id === 'string' && id.length > 0) && event.input, 'INVALID_LEARNING_EVENT', 'This record lacks current canonical decision evidence.');
  const { recordIntegrity, ...record } = event;
  check(recordIntegrity === digest(record) && event.integrity === digest(event.input), 'LEARNING_TAMPERED', 'A local decision was changed after it was recorded.');
  check(digest(event.sourceIds) === digest(event.input.sourceIds) && event.sourceIds.every((id: unknown) => typeof id === 'string'), 'LEARNING_LINEAGE_CHANGED', 'Decision scope must match its recorded input.');
  if (event.importIdentity) {
    const identity = event.importIdentity;
    check(identity.qualification === 'experimental' && importFormats.includes(identity.format) && (identity.format !== 'unsupported' || identity.outcome === 'rejected') && /^[a-f0-9]{64}$/.test(identity.contentHash) && /^[a-f0-9]{64}$/.test(identity.recipeHash) && event.sourceIds.length === 1 && event.sourceIds[0] === identity.sourceId && Array.isArray(identity.branches) && identity.branches.every((branch: unknown) => typeof branch === 'string' && branch.length > 0) && event.input.kind === 'mapping' && event.input.choice === identity.outcome && (identity.outcome === 'accepted' ? /^import_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(identity.id) : identity.outcome === 'rejected' && /^importattempt_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(identity.id) && event.rowIds.length === 0), 'LEARNING_LINEAGE_CHANGED', 'The import decision needs its exact experimental source identity.');
  }
  redactStructure(event.input);
}
function decisionAt(state: State, context: Context, event: any): LearningDecision {
  assertLearningDecisionRecord(event);
  current(state, { memberId: event.memberId, role: event.role, epoch: event.epoch }, 'prepare');
  check(event.memberId === context.memberId || context.role === 'owner', 'LEARNING_FORBIDDEN', 'This decision belongs to another author.');
  decisionScope(state, context, event.sourceIds, event.importIdentity); decisionScope(state, { memberId: event.memberId, role: event.role, epoch: event.epoch }, event.sourceIds, event.importIdentity);
  const cutoff = Date.now() - state.policy.retentionDays * 86400000;
  check(Number.isFinite(Date.parse(event.at)) && Date.parse(event.at) >= cutoff, 'LEARNING_EXPIRED', 'This learning evidence has expired.');
  check(event.rowIds.every((id: unknown) => typeof id === 'string' && state.facts.some(row => row.id === id && !row.deletedAt && Date.parse(row.learnedAt) >= cutoff && event.sourceIds.includes(row.sourceId) && (!event.importIdentity || Boolean(row.branch) && event.importIdentity.branches.includes(row.branch!))) && !state.tombstones.some(t => (t.factId ?? t.id) === id)), 'LEARNING_LINEAGE_CHANGED', 'Decision row evidence was removed or expired.');
  if (event.importIdentity) {
    const identity = event.importIdentity;
    check(identity.qualification === 'experimental' && /^[a-f0-9]{64}$/.test(identity.contentHash) && /^[a-f0-9]{64}$/.test(identity.recipeHash) && event.sourceIds.length === 1 && event.sourceIds[0] === identity.sourceId, 'LEARNING_LINEAGE_CHANGED', 'The import decision needs its exact experimental source identity.');
    if (identity.outcome === 'accepted') {
      const imported = state.imports.find(item => item.id === identity.id);
      check(imported && imported.sourceId === identity.sourceId && imported.contentHash === identity.contentHash && imported.recipeHash === identity.recipeHash && imported.format === identity.format && digest([...new Set(imported.rowIds)].sort()) === digest(event.rowIds), 'LEARNING_LINEAGE_CHANGED', 'The accepted import evidence changed or was removed.');
    } else check(identity.outcome === 'rejected' && event.rowIds.length === 0, 'LEARNING_LINEAGE_CHANGED', 'A refusal cannot claim imported rows.');
  }
  redactStructure(event.input); return event;
}
export function redactStructure(input: DecisionInput): StructuralPayload['events'][number] {
  check(input && typeof input === 'object' && ['mapping', 'customer-match', 'calculation', 'action'].includes(input.kind) && ['proposed', 'accepted', 'rejected', 'corrected'].includes(input.choice), 'INVALID_LEARNING_EVENT', 'Use a registered structural event and choice.');
  const event: StructuralPayload['events'][number] = { kind: input.kind, choice: input.choice };
  if (input.reasonCode && REASON_CODES.includes(input.reasonCode)) event.reasonCode = input.reasonCode;
  if (input.reportShape && ['ledger', 'invoice', 'bank-statement', 'order', 'receipt', 'summary'].includes(input.reportShape)) event.reportShape = input.reportShape;
  if (Array.isArray(input.fields)) { check(input.fields.length <= 1000, 'INVALID_LEARNING_EVENT', 'Learning structures have at most 1,000 source fields.'); event.fields = [...new Map(input.fields.filter(f => f && typeof f === 'object' && STRUCTURAL_FIELDS.includes(f.name as any) && ['string', 'integer', 'decimal', 'date', 'boolean'].includes(f.type)).map(f => [`${f.name}:${f.type}`, { name: f.name, type: f.type }])).values()].sort((a, b) => a.name.localeCompare(b.name)); }
  // No free-form reason, original name, amount, timestamp, source ID or local record ID leaves this boundary.
  return event;
}
export class LearningService {
  store: StateStore; exporter?: LearningExporter;
  constructor(store: StateStore, options: { exporter?: LearningExporter } = {}) { this.store = store; this.exporter = options.exporter; }
  async recordDecision(context: Context, input: DecisionInput) {
    context = { ...context };
    const clean: DecisionInput = JSON.parse(canonical(input));
    return this.store.update(state => appendLearningDecision(state, context, clean));
  }
  list(context: Context) {
    authorize(this.store, context);
    const state = this.store.read();
    return state.learning.filter(event => { try {
      if (event.type === 'decision') decisionAt(state, context, event);
      else if (event.type === 'preview') this.validPreview(state, context, event);
      else if (event.type === 'consent' || event.type === 'export') {
        const { integrity, ...record } = event; check(integrity === digest(record), 'LEARNING_TAMPERED', 'A sharing receipt changed.');
        const preview = state.learning.find(item => item.id === event.previewId); check(preview, 'NOT_FOUND', 'Sharing preview not found.'); this.validPreview(state, context, preview);
      } else return false;
      return true;
    } catch { return false; } }).map(event => structuredClone(event));
  }
  async setSharing(context: Context, enabled: boolean) { return this.store.update(state => { current(state, context, 'admin'); check(!context.sourceTainted && context.channel !== 'phone', 'APP_CONSENT_REQUIRED', 'Sharing is controlled inside the app.'); check(typeof enabled === 'boolean', 'INVALID_SHARING', 'Set sharing on or off.'); guardChange(state, context, { kind: 'policy', patch: { sharing: enabled } }); state.policy.sharing = enabled; audit(state, 'learning.sharing', { enabled, memberId: context.memberId }); return { enabled }; }); }
  async preview(context: Context, eventIds: string[]) {
    check(Array.isArray(eventIds) && eventIds.length > 0 && eventIds.length <= 500 && eventIds.every(id => typeof id === 'string'), 'INVALID_PREVIEW', 'Select 1–500 local decision records.');
    return this.store.update(state => {
      current(state, context, 'admin'); const unique = [...new Set(eventIds)].sort();
      const events = unique.map(id => { const event = state.learning.find(e => e.id === id && e.type === 'decision'); check(event, 'NOT_FOUND', 'A selected learning decision does not exist.'); return decisionAt(state, context, event); });
      const payload: StructuralPayload = { schema: 'chausar.structure.v1', events: events.map(event => redactStructure(event.input)) };
      const preview = { id: newId('learningpreview'), type: 'preview', at: now(), memberId: context.memberId, epoch: context.epoch, eventIds: unique, sourceDigest: digest(events.map(e => ({ id: e.id, integrity: e.integrity }))), sourceIds: [...new Set(events.flatMap(e => e.sourceIds))].sort(), rowIds: [...new Set(events.flatMap(e => e.rowIds))].sort(), payload, digest: digest(payload) };
      state.learning.push(preview); audit(state, 'learning.previewed', { previewId: preview.id, digest: preview.digest }); return structuredClone(preview);
    });
  }
  validPreview(state: State, context: Context, preview: any) {
    current(state, context, 'admin'); check(Array.isArray(preview.sourceIds), 'PREVIEW_CHANGED', 'A sharing preview needs its explicit source scope.'); assertSourceAccess(state, context, preview.sourceIds);
    check(preview.type === 'preview' && preview.memberId === context.memberId && preview.epoch === context.epoch && Array.isArray(preview.eventIds) && preview.eventIds.length > 0 && preview.digest === digest(preview.payload), 'PREVIEW_CHANGED', 'The exact sharing preview changed or its author authority expired.');
    const events = preview.eventIds.map((id: string) => { const event = state.learning.find(e => e.id === id && e.type === 'decision'); check(event, 'PREVIEW_CHANGED', 'A learning decision changed or was removed.');
      try { return decisionAt(state, context, event); } catch (error) {
        if (['INVALID_LEARNING_EVENT', 'LEARNING_TAMPERED', 'LEARNING_LINEAGE_CHANGED'].includes((error as any)?.code)) check(false, 'PREVIEW_CHANGED', 'A learning decision changed or was removed.');
        throw error;
      }
    });
    check(digest(preview.sourceIds) === digest([...new Set(events.flatMap((event: LearningDecision) => event.sourceIds))].sort()) && digest(preview.rowIds) === digest([...new Set(events.flatMap((event: LearningDecision) => event.rowIds))].sort()), 'PREVIEW_CHANGED', 'The sharing preview scope changed.');
    check(preview.sourceDigest === digest(events.map((e: any) => ({ id: e.id, integrity: e.integrity }))) && preview.digest === digest({ schema: 'chausar.structure.v1', events: events.map((e: any) => redactStructure(e.input)) }), 'PREVIEW_CHANGED', 'Preview no longer matches the current structure-only decisions.');
  }
  async consent(context: Context, previewId: string, expectedDigest: string) {
    return this.store.update(state => {
      check(!context.sourceTainted && context.channel !== 'phone', 'APP_CONSENT_REQUIRED', 'Explicit sharing consent must be given inside the app.');
      const preview = state.learning.find(e => e.id === previewId); check(preview, 'NOT_FOUND', 'Sharing preview not found.'); this.validPreview(state, context, preview);
      check(state.policy.sharing, 'SHARING_DISABLED', 'Turn on structure-only sharing before giving consent.'); check(expectedDigest === preview.digest, 'PREVIEW_CHANGED', 'Consent must match the exact preview digest.');
      const receipt = { id: newId('consent'), type: 'consent', at: now(), memberId: context.memberId, role: context.role, epoch: context.epoch, previewId, digest: expectedDigest, sourceIds: preview.sourceIds, rowIds: preview.rowIds, immutable: true };
      const signed = { ...receipt, integrity: digest(receipt) }; state.learning.push(signed); audit(state, 'learning.consented', { consentId: receipt.id, previewId, digest: expectedDigest }); return structuredClone(signed);
    });
  }
  async share(context: Context, consentId: string) {
    check(this.exporter, 'EXPORT_UNAVAILABLE', 'No structure-only export receiver is configured. Nothing was sent.');
    const exporter = this.exporter;
    const reservation = await this.store.update(state => {
      current(state, context, 'admin'); check(!context.sourceTainted && context.channel !== 'phone', 'APP_CONSENT_REQUIRED', 'Only the app can submit consented structure.'); check(state.policy.sharing, 'SHARING_DISABLED', 'Sharing is switched off.');
      const consent = state.learning.find(e => e.id === consentId && e.type === 'consent'); check(consent, 'CONSENT_REQUIRED', 'An immutable consent receipt is required.');
      const { integrity, ...original } = consent; check(consent.immutable === true && integrity === digest(original), 'CONSENT_TAMPERED', 'The consent receipt changed.'); current(state, { memberId: consent.memberId, role: consent.role, epoch: consent.epoch }, 'admin');
      const preview = state.learning.find(e => e.id === consent.previewId); check(preview && preview.digest === consent.digest, 'PREVIEW_CHANGED', 'Consent no longer binds this preview.'); this.validPreview(state, context, preview);
      const existing = state.learning.find(e => e.type === 'export' && e.consentId === consentId);
      check(!existing, 'EXPORT_ALREADY_ATTEMPTED', 'This consent has already been submitted. An uncertain upload is never sent again automatically.');
      const receipt = { id: newId('export'), type: 'export', at: now(), consentId, previewId: preview.id, sourceIds: preview.sourceIds, rowIds: preview.rowIds, payload: structuredClone(preview.payload), digest: consent.digest, receiver: exporter.receiver, outcome: 'pending', immutable: true };
      state.learning.push(receipt); audit(state, 'learning.export-attempt', { exportId: receipt.id, consentId, digest: consent.digest }); return structuredClone(receipt);
    });
    let reference: string | undefined; let outcome: 'sent' | 'unknown' = 'unknown';
    try {
      // Recheck immediately before outbound I/O; payload consists only of enumerated structural tokens.
      authorize(this.store, context, 'admin'); check(this.store.read().policy.sharing, 'SHARING_DISABLED', 'Sharing was switched off.'); sourceAccess(this.store.read(), context, reservation.sourceIds);
      const response = await exporter.send(structuredClone(reservation.payload), reservation.id); reference = response.reference; outcome = 'sent';
    } catch { outcome = 'unknown'; }
    const receipt = await this.store.update(state => { const exportRecord = state.learning.find(e => e.id === reservation.id); exportRecord.outcome = outcome; exportRecord.finishedAt = now(); if (reference) exportRecord.reference = reference; exportRecord.integrity = digest(Object.fromEntries(Object.entries(exportRecord).filter(([key]) => key !== 'integrity'))); audit(state, 'learning.export-settled', { exportId: reservation.id, outcome }); return structuredClone(exportRecord); });
    authorize(this.store, context, 'admin'); sourceAccess(this.store.read(), context, reservation.sourceIds); return receipt;
  }
  receipts(context: Context) { current(this.store.read(), context, 'admin'); return this.list(context).filter(record => record.type === 'consent' || record.type === 'export').map(record => { const { integrity, ...data } = record; return { ...record, integrityValid: integrity === digest(data) }; }); }
  lookup(context: Context, fields: string[]) {
    current(this.store.read(), context); const wanted = new Set(fields.filter(f => STRUCTURAL_FIELDS.includes(f as any)));
    return this.list(context).filter(record => record.type === 'decision').map(record => ({ structure: redactStructure(record.input), score: (record.input.fields ?? []).filter((f: any) => wanted.has(f.name)).length })).filter(record => record.score > 0).sort((a, b) => b.score - a.score).slice(0, 10);
  }
}
