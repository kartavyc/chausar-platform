import { authorize, audit, check, newId, now } from './contracts.ts';
import type { Context, State, StateStore } from './contracts.ts';
import { canonical, current, digest, sourceAccess } from './actions.ts';

export const STRUCTURAL_FIELDS = ['invoice_id', 'customer_id', 'date', 'due_date', 'amount', 'tax', 'currency', 'account', 'debit', 'credit', 'sku', 'quantity', 'status', 'description', 'order_id', 'payment_id', 'bank_reference', 'branch'] as const;
export const REASON_CODES = ['manual_confirmation', 'ambiguous_field', 'type_match', 'date_format', 'currency_mismatch', 'duplicate_record', 'exact_reference', 'reconciliation', 'unsupported_shape', 'verified_readback'] as const;
export type DecisionKind = 'mapping' | 'customer-match' | 'calculation' | 'action';
export type DecisionInput = { kind: DecisionKind; choice: 'proposed' | 'accepted' | 'rejected' | 'corrected'; reasonCode?: typeof REASON_CODES[number]; fields?: { name: string; type: 'string' | 'integer' | 'decimal' | 'date' | 'boolean' }[]; reportShape?: 'ledger' | 'invoice' | 'bank-statement' | 'order' | 'receipt' | 'summary'; details?: unknown; sourceIds?: string[] };
export type StructuralPayload = { schema: 'chausar.structure.v1'; events: { kind: DecisionKind; choice: DecisionInput['choice']; reasonCode?: string; fields?: { name: string; type: string }[]; reportShape?: string }[] };
export type LearningExporter = { receiver: string; send: (payload: StructuralPayload, idempotencyKey: string) => Promise<{ reference: string }> };
export function redactStructure(input: DecisionInput): StructuralPayload['events'][number] {
  check(['mapping', 'customer-match', 'calculation', 'action'].includes(input.kind) && ['proposed', 'accepted', 'rejected', 'corrected'].includes(input.choice), 'INVALID_LEARNING_EVENT', 'Use a registered structural event and choice.');
  const event: StructuralPayload['events'][number] = { kind: input.kind, choice: input.choice };
  if (input.reasonCode && REASON_CODES.includes(input.reasonCode)) event.reasonCode = input.reasonCode;
  if (input.reportShape && ['ledger', 'invoice', 'bank-statement', 'order', 'receipt', 'summary'].includes(input.reportShape)) event.reportShape = input.reportShape;
  if (Array.isArray(input.fields)) { check(input.fields.length <= 1000, 'INVALID_LEARNING_EVENT', 'Learning structures have at most 1,000 source fields.'); event.fields = [...new Map(input.fields.filter(f => STRUCTURAL_FIELDS.includes(f.name as any) && ['string', 'integer', 'decimal', 'date', 'boolean'].includes(f.type)).map(f => [`${f.name}:${f.type}`, { name: f.name, type: f.type }])).values()].sort((a, b) => a.name.localeCompare(b.name)); }
  // No free-form reason, original name, amount, timestamp, source ID or local record ID leaves this boundary.
  return event;
}
export class LearningService {
  store: StateStore; exporter?: LearningExporter;
  constructor(store: StateStore, options: { exporter?: LearningExporter } = {}) { this.store = store; this.exporter = options.exporter; }
  async recordDecision(context: Context, input: DecisionInput) {
    redactStructure(input); const clean = JSON.parse(canonical(input));
    return this.store.update(state => { current(state, context, 'prepare'); sourceAccess(state, context, input.sourceIds ?? []); const event = { id: newId('learning'), type: 'decision', at: now(), memberId: context.memberId, input: clean, integrity: digest(clean) }; state.learning.push(event); audit(state, 'learning.logged', { eventId: event.id, kind: input.kind, choice: input.choice }); return structuredClone(event); });
  }
  list(context: Context) {
    authorize(this.store, context);
    return this.store.read().learning.filter(event => { try { sourceAccess(this.store.read(), context, event.input?.sourceIds ?? event.sourceIds ?? []); return event.type !== 'decision' || event.memberId === context.memberId || context.role === 'owner'; } catch { return false; } }).map(event => structuredClone(event));
  }
  async setSharing(context: Context, enabled: boolean) { return this.store.update(state => { current(state, context, 'admin'); check(!context.sourceTainted && context.channel !== 'phone', 'APP_CONSENT_REQUIRED', 'Sharing is controlled inside the app.'); check(typeof enabled === 'boolean', 'INVALID_SHARING', 'Set sharing on or off.'); state.policy.sharing = enabled; audit(state, 'learning.sharing', { enabled, memberId: context.memberId }); return { enabled }; }); }
  async preview(context: Context, eventIds: string[]) {
    check(Array.isArray(eventIds) && eventIds.length > 0 && eventIds.length <= 500 && eventIds.every(id => typeof id === 'string'), 'INVALID_PREVIEW', 'Select 1–500 local decision records.');
    return this.store.update(state => {
      current(state, context, 'admin'); const unique = [...new Set(eventIds)].sort();
      const events = unique.map(id => { const event = state.learning.find(e => e.id === id && e.type === 'decision'); check(event, 'NOT_FOUND', 'A selected learning decision does not exist.'); sourceAccess(state, context, event.input.sourceIds ?? []); check(digest(event.input) === event.integrity, 'LEARNING_TAMPERED', 'A local decision was changed after it was recorded.'); return event; });
      const payload: StructuralPayload = { schema: 'chausar.structure.v1', events: events.map(event => redactStructure(event.input)) };
      const preview = { id: newId('learningpreview'), type: 'preview', at: now(), memberId: context.memberId, epoch: context.epoch, eventIds: unique, sourceDigest: digest(events.map(e => ({ id: e.id, integrity: e.integrity }))), sourceIds: [...new Set<string>(events.flatMap(e => e.input.sourceIds ?? []))].sort(), payload, digest: digest(payload) };
      state.learning.push(preview); audit(state, 'learning.previewed', { previewId: preview.id, digest: preview.digest }); return structuredClone(preview);
    });
  }
  validPreview(state: State, context: Context, preview: any) {
    current(state, context, 'admin'); sourceAccess(state, context, preview.sourceIds ?? []);
    check(preview.type === 'preview' && preview.digest === digest(preview.payload), 'PREVIEW_CHANGED', 'The exact sharing preview changed.');
    const events = preview.eventIds.map((id: string) => { const event = state.learning.find(e => e.id === id && e.type === 'decision'); check(event && event.integrity === digest(event.input), 'PREVIEW_CHANGED', 'A learning decision changed or was removed.'); return event; });
    check(preview.sourceDigest === digest(events.map((e: any) => ({ id: e.id, integrity: e.integrity }))) && preview.digest === digest({ schema: 'chausar.structure.v1', events: events.map((e: any) => redactStructure(e.input)) }), 'PREVIEW_CHANGED', 'Preview no longer matches the current structure-only decisions.');
  }
  async consent(context: Context, previewId: string, expectedDigest: string) {
    return this.store.update(state => {
      check(!context.sourceTainted && context.channel !== 'phone', 'APP_CONSENT_REQUIRED', 'Explicit sharing consent must be given inside the app.');
      const preview = state.learning.find(e => e.id === previewId); check(preview, 'NOT_FOUND', 'Sharing preview not found.'); this.validPreview(state, context, preview);
      check(state.policy.sharing, 'SHARING_DISABLED', 'Turn on structure-only sharing before giving consent.'); check(expectedDigest === preview.digest, 'PREVIEW_CHANGED', 'Consent must match the exact preview digest.');
      const receipt = { id: newId('consent'), type: 'consent', at: now(), memberId: context.memberId, role: context.role, epoch: context.epoch, previewId, digest: expectedDigest, sourceIds: preview.sourceIds, immutable: true };
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
      const receipt = { id: newId('export'), type: 'export', at: now(), consentId, previewId: preview.id, sourceIds: preview.sourceIds, payload: structuredClone(preview.payload), digest: consent.digest, receiver: exporter.receiver, outcome: 'pending', immutable: true };
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
