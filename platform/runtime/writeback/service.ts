/**
 * The writeback service: every catalogue action goes prepare → approve (exactly this change, for a
 * limited time) → do once → read back → settle, through the existing ActionService journal.
 *
 * - The action payload is a sealed envelope: the exact business payload, the target connection,
 *   the adapter's preparation (before-state, command, postconditions, preview) and any evidence
 *   the action depends on. The ActionService digest covers all of it.
 * - Before dispatch the service looks again. A changed target is prepared again (the yes is gone);
 *   an effect already present is read back instead of sent; an effect key already in the send
 *   journal (a restored vault) is read back instead of sent.
 * - A lost reply leaves `unknown`. Only reading the system, or a person's word when the system
 *   offers no way to look, settles it.
 */
import { ActionService, canonical, current, digest } from '../actions.ts';
import type { Connector, Operation, PreparedAction, Readback } from '../actions.ts';
import { audit, authorize, check, ChausarError, newId } from '../contracts.ts';
import type { Context, State, StateStore } from '../contracts.ts';
import { catalogueReadback } from '../connector-framework/write.ts';
import { moduleState, peekModuleState } from '../modules/types.ts';
import { CATALOGUE, catalogueDigest, effectiveStatus, entry } from './catalogue.ts';
import type { CatalogueEntry, Kind } from './catalogue.ts';
import { SendJournal } from './journal.ts';
import type { ActionAdapter, AdapterContext, Connection, Dialer, Environment, Preparation, Secret, SystemAdapters, SystemId, Transport, WireObject, WriteCredentials } from './types.ts';
import { SYSTEMS } from './types.ts';
import { oneOf, record, text } from './validate.ts';

export const MODULE_ID = 'writeback';
export const PROTOCOL = 'chausar-writeback-v1';
export const connectorId = (system: SystemId) => `wb-${system}`;

export type Settings = {
  approvalHours: Record<Kind, number>;
  reminderCapPerCustomer: number; reminderCapPerDay: number;
  stopWords: string[];
};
export type Qualification = { system: SystemId; action: string; level: 'synthetic-tested' | 'sandbox-verified'; connectionId: string | null; checks: { name: string; passed: boolean }[]; score: string; at: string; evidence: string };
export type Consent = { id: string; requestId: string; customerId: string; channel: 'email' | 'whatsapp'; destination: string; answer: 'yes' | 'no' | 'not-asked' | 'stopped'; observedOn: string; sourceId: string | null; recordedBy: string; at: string };
export type JournalEntry = { id: string; kind: 'sent' | 'paid'; invoiceId: string; customerId: string; actionId: string | null; on: string; at: string; sourceIds: string[]; evidence: string };
export type PracticeSummary = { id: string; at: string; by: string; steps: { system: string; action: string; outcome: string }[]; actionId: string | null };
export type WritebackState = {
  connections: Connection[];
  wanted: { id: string; system: string; action: string; count: number; firstAt: string; lastAt: string }[];
  settings: Settings;
  preparedAt: Record<string, string>;
  /** Approval times by the service clock (the labelled test clock in drills). */
  approvedAt: Record<string, string>;
  attestations: { actionId: string; memberId: string; said: 'sent' | 'not-sent'; at: string }[];
  notices: { id: string; actionId: string; kind: 'expired' | 'prepared-again' | 'already-done' | 'looked-first' | 'cancelled-evidence'; at: string }[];
  practiceRuns: PracticeSummary[];
  qualifications: Qualification[];
  consents: Consent[];
  journal: JournalEntry[];
};
export const defaultSettings = (): Settings => ({
  approvalHours: { 'inside-undoable': 24 * 7, 'seen-outside': 24, money: 24, 'cannot-undo': 24 },
  reminderCapPerCustomer: 1, reminderCapPerDay: 20, stopWords: ['STOP', 'UNSUBSCRIBE', 'BAND KARO', 'RUKO', 'बंद करो', 'रुको'],
});
export const initState = (): WritebackState => ({ connections: [], wanted: [], settings: defaultSettings(), preparedAt: {}, approvedAt: {}, attestations: [], notices: [], practiceRuns: [], qualifications: [], consents: [], journal: [] });
export const readState = (state: State): WritebackState => ({ ...initState(), ...(peekModuleState<WritebackState>(state, MODULE_ID) ?? {}) });

export type Envelope = {
  protocol: typeof PROTOCOL; system: SystemId; action: string; connectionId: string; environment: Environment; accountDigest: string;
  intentId: string; payload: WireObject; preparation: Preparation; catalogueDigest: string;
  evidence: { kind: string; digest: string; detail: WireObject } | null;
};
/** Ports into the outside world. Practice connections are served by the injected practice world. */
export type WritebackPorts = {
  http: Transport; dial: Dialer; credentials?: WriteCredentials; clock: () => string; directory: string; demo: boolean;
  adapters: Partial<Record<SystemId, SystemAdapters>>;
  practice?: (workspaceId: string, connection: Connection) => { http: Transport; dial: Dialer; secret: Secret };
  /** Re-derives an action's evidence at dispatch; a changed digest cancels the action. */
  evidence?: Record<string, (context: Context, envelope: Envelope) => Promise<string>>;
  /** Called once an action settles as applied. */
  settled?: (context: Context, action: PreparedAction, envelope: Envelope) => Promise<void>;
};

const impactOf = (kind: Kind): Operation['impact'] => kind === 'inside-undoable' ? 'reversible' : kind === 'seen-outside' ? 'message' : kind === 'money' ? 'money' : 'destructive';
const hoursMs = (hours: number) => hours * 3600 * 1000;

export class WritebackService {
  readonly store: StateStore; readonly ports: WritebackPorts; readonly actions: ActionService;
  /** Per-dispatch decisions taken by the look-first step, consumed by the connector's execute. */
  #skip = new Map<string, 'already-applied' | 'journal'>();
  constructor(store: StateStore, ports: WritebackPorts) {
    this.store = store; this.ports = ports;
    this.actions = new ActionService(store, SYSTEMS.filter(system => ports.adapters[system]).map(system => this.#connector(system)));
  }
  now() { return this.ports.clock(); }
  journal() { return new SendJournal(this.ports.directory, this.store.read().workspace.id); }

  // ── Catalogue ────────────────────────────────────────────────────────────────────────────────
  qualification(state: State, row: CatalogueEntry) {
    const found = readState(state).qualifications.filter(q => q.system === row.system && q.action === row.action && q.checks.every(c => c.passed));
    return found.some(q => q.level === 'sandbox-verified') ? 'sandbox-verified' as const : found.some(q => q.level === 'synthetic-tested') ? 'synthetic-tested' as const : 'unqualified' as const;
  }
  row(state: State, row: CatalogueEntry) {
    const wb = readState(state), qualified = this.qualification(state, row);
    const latest = wb.qualifications.filter(q => q.system === row.system && q.action === row.action).at(-1);
    const hours = wb.settings.approvalHours[row.kind];
    return { ...structuredClone(row), status: effectiveStatus(row, qualified), qualification: qualified, installed: Boolean(this.ports.adapters[row.system]?.[row.action]),
      approvalLifetimeHours: Math.min(row.approvalLifetimeHours, hours), writeScore: latest ? latest.score : null,
      connections: wb.connections.filter(c => c.system === row.system && !c.revokedAt).map(c => ({ id: c.id, label: c.label, environment: c.environment, read: c.read, write: c.write.includes(row.action) })) };
  }
  catalogue(context: Context) { authorize(this.store, context); const state = this.store.read(); return CATALOGUE.map(row => this.row(state, row)); }
  catalogueEntry(context: Context, system: unknown, action: unknown) {
    authorize(this.store, context); const row = entry(String(system), String(action));
    check(row, 'NOT_IN_CATALOGUE', 'Not in the list yet. It is on the wanted list.'); return this.row(this.store.read(), row);
  }
  wanted(context: Context) { authorize(this.store, context); return structuredClone(readState(this.store.read()).wanted); }
  /** A request outside the list is recorded on the wanted list and refused. */
  async refuseUnlisted(context: Context, system: unknown, action: unknown): Promise<never> {
    const s = typeof system === 'string' ? system.slice(0, 40) : 'unknown', a = typeof action === 'string' ? action.slice(0, 60) : 'unknown';
    await this.store.update(state => {
      current(state, context, 'prepare'); const wb = moduleState(state, MODULE_ID, initState);
      const found = wb.wanted.find(w => w.system === s && w.action === a);
      if (found) { found.count += 1; found.lastAt = this.now(); } else wb.wanted.push({ id: newId('wanted'), system: s, action: a, count: 1, firstAt: this.now(), lastAt: this.now() });
      audit(state, 'writeback.wanted', { system: s, action: a });
    });
    throw new ChausarError('NOT_IN_CATALOGUE', 'Not in the list yet. It is on the wanted list.');
  }

  // ── Connections and grants ───────────────────────────────────────────────────────────────────
  connections(context: Context) { authorize(this.store, context); return structuredClone(readState(this.store.read()).connections); }
  async connect(context: Context, input: Record<string, unknown>) {
    const p = record(input, ['system', 'label', 'environment', 'account']);
    const system = oneOf(p.system, SYSTEMS), environment = oneOf(p.environment, ['live', 'sandbox', 'practice'] as const);
    check(environment === 'practice' || !this.ports.demo, 'DEMO_EXTERNAL_DISABLED', 'Synthetic demo mode keeps external systems disabled. Use a practice connection.');
    const accountFields = record(p.account, [], ['organizationId', 'dataCenter', 'host', 'port', 'company', 'shop', 'phoneNumberId', 'wabaId', 'smtpHost', 'smtpPort', 'smtpSecurity', 'from', 'fromName', 'imapHost', 'imapPort', 'sentFolder', 'spreadsheetId', 'calendarId', 'gstin']);
    const account: Record<string, string> = {}; for (const [field, value] of Object.entries(accountFields)) account[field] = text(value, 300);
    return this.store.update(state => {
      const member = current(state, context, 'admin'); check(!context.sourceTainted, 'TAINTED_APPROVAL', 'Imported text cannot add a connection.');
      const wb = moduleState(state, MODULE_ID, initState);
      const connection: Connection = { id: newId('connection'), system, label: text(p.label, 100), environment, account, read: true, write: [], createdAt: this.now(), createdBy: member.id, revokedAt: null };
      wb.connections.push(connection); audit(state, 'writeback.connected', { connectionId: connection.id, system, environment });
      return structuredClone(connection);
    });
  }
  /** Write is granted per catalogue action and never follows from read. */
  async grant(context: Context, input: Record<string, unknown>) {
    const p = record(input, ['connectionId'], ['read', 'write']);
    return this.store.update(state => {
      current(state, context, 'admin'); check(!context.sourceTainted, 'TAINTED_APPROVAL', 'Imported text cannot change a grant.');
      const connection = this.#connection(state, p.connectionId);
      if (p.read !== undefined) { check(typeof p.read === 'boolean', 'INVALID_REQUEST', 'Read is on or off.'); connection.read = p.read; }
      if (p.write !== undefined) {
        check(Array.isArray(p.write) && p.write.length <= 50, 'INVALID_REQUEST', 'Write grants are a list of catalogue actions.');
        const actions = p.write.map(a => { const row = entry(connection.system, String(a)); check(row && row.tier !== 'prepare-only', 'NOT_IN_CATALOGUE', 'Not in the list yet. It is on the wanted list.'); return row.action; });
        connection.write = [...new Set(actions)].sort();
      }
      audit(state, 'writeback.grant', { connectionId: connection.id, read: connection.read, write: connection.write });
      return structuredClone(connection);
    });
  }
  async disconnect(context: Context, connectionId: unknown) {
    return this.store.update(state => {
      current(state, context, 'admin'); const connection = this.#connection(state, connectionId);
      connection.revokedAt = this.now(); connection.write = []; connection.read = false; audit(state, 'writeback.disconnected', { connectionId: connection.id });
      return structuredClone(connection);
    });
  }
  #connection(state: State, id: unknown, live = true): Connection {
    const connection = moduleState(state, MODULE_ID, initState).connections.find(c => c.id === id);
    check(connection, 'WRITE_CONNECTION_NOT_FOUND', 'That connection does not exist.');
    if (live) check(!connection.revokedAt, 'WRITE_CONNECTION_REVOKED', 'That connection was removed.');
    return connection;
  }
  adapterContext(context: Context, connection: Connection): AdapterContext {
    const workspaceId = this.store.read().workspace.id;
    if (connection.environment === 'practice') {
      check(this.ports.practice, 'PRACTICE_UNAVAILABLE', 'Practice systems are not installed in this app.');
      const world = this.ports.practice(workspaceId, connection);
      return { connection: structuredClone(connection), http: world.http, dial: world.dial, credentials: async () => world.secret, clock: this.ports.clock };
    }
    check(!this.ports.demo, 'DEMO_EXTERNAL_DISABLED', 'Synthetic demo mode keeps external systems disabled. Use a practice connection.');
    const credentials = this.ports.credentials;
    return { connection: structuredClone(connection), http: this.ports.http, dial: this.ports.dial, clock: this.ports.clock,
      credentials: async () => {
        check(credentials, 'WRITE_CREDENTIALS_UNAVAILABLE', 'No credential store is installed for writing to outside systems.');
        return credentials(structuredClone(context), { system: connection.system, connectionId: connection.id, account: { ...connection.account }, environment: connection.environment });
      } };
  }
  adapter(system: SystemId, action: string): ActionAdapter<any> {
    const adapter = this.ports.adapters[system]?.[action]; check(adapter, 'WRITE_ADAPTER_NOT_INSTALLED', 'This action is listed but its adapter is not installed.'); return adapter;
  }

  // ── The ActionService connector for one system ───────────────────────────────────────────────
  envelope(value: unknown): Envelope {
    const e = record(value, ['protocol', 'system', 'action', 'connectionId', 'environment', 'accountDigest', 'intentId', 'payload', 'preparation', 'catalogueDigest', 'evidence']) as unknown as Envelope;
    check(e.protocol === PROTOCOL && SYSTEMS.includes(e.system) && typeof e.intentId === 'string' && e.intentId.length > 0 && e.intentId.length <= 200, 'WRITE_BINDING_CHANGED', 'This preparation is not a catalogue write.');
    const row = entry(e.system, e.action); check(row && e.catalogueDigest === catalogueDigest(row), 'CATALOGUE_CHANGED', 'The catalogue row changed after preparation. Prepare it again.');
    const valid = this.adapter(e.system, e.action).validate(structuredClone(e.payload));
    check(canonical(valid) === canonical(e.payload), 'INVALID_WRITE_PAYLOAD', 'The approved payload must be exactly the validated one.');
    const p = record(e.preparation, ['before', 'command', 'postconditions', 'preview', 'target', 'sourceVersion', 'alreadyApplied']);
    check(p.command !== null && typeof p.command === 'object' && p.postconditions !== null && typeof p.postconditions === 'object', 'INVALID_WRITE_PREPARATION', 'A preparation needs its command and postconditions.');
    return e;
  }
  #connector(system: SystemId): Connector {
    const adapters = this.ports.adapters[system]!;
    const operations: Record<string, Operation> = {};
    for (const [action, adapter] of Object.entries(adapters)) {
      const row = entry(system, action); check(row, 'INVALID_CATALOGUE', 'Every installed adapter must have a catalogue row.');
      operations[action] = {
        title: row.title, description: row.readBack, impact: impactOf(row.kind), idempotency: row.idempotency, readback: row.readBack,
        validate: payload => { const e = this.envelope(payload); check(e.system === system && e.action === action, 'WRITE_BINDING_CHANGED', 'The preparation belongs to another action.'); return e as unknown as Record<string, unknown>; },
        execute: async (payload, key, context) => {
          const e = this.envelope(payload); const state = this.store.read(); const connection = this.#connection(state, e.connectionId);
          check(connection.write.includes(action), 'WRITE_PERMISSION_REVOKED', 'Writing this action to the system is not allowed.');
          const skip = this.#skip.get(key); this.#skip.delete(key);
          if (skip) return { ...(e.preparation.alreadyApplied?.externalId ? { externalId: e.preparation.alreadyApplied.externalId } : {}), data: { skipped: skip } };
          if (connection.environment !== 'practice') this.journal().record(key, this.now());
          const receipt = await adapter.do(this.adapterContext(context, connection), structuredClone(e.payload), structuredClone(e.preparation), key);
          check(['accepted', 'provider-claims-applied', 'rejected'].includes(receipt.outcome), 'INVALID_WRITE_RECEIPT', 'The adapter must report a known outcome.');
          return { ...(receipt.externalId ? { externalId: receipt.externalId } : {}), data: { receipt } };
        },
        reconcile: async (payload, key, result, context) => {
          const e = this.envelope(payload); const state = this.store.read(); const connection = this.#connection(state, e.connectionId, false);
          const action0 = state.actions.find(a => a.connector === connectorId(system) && a.idempotencyKey === key) as PreparedAction | undefined;
          const word = action0 && readState(state).attestations.filter(a => a.actionId === action0.id).at(-1);
          // The system is always read first when it can be; a person's word settles only what the system cannot show.
          let observation: unknown = null, back: Readback | null = null;
          if (connection.read && !connection.revokedAt) {
            const receipt = (result?.data as any)?.receipt ?? null;
            observation = await adapter.readBack(this.adapterContext(context, connection), structuredClone(e.payload), structuredClone(e.preparation), key, receipt);
            back = catalogueReadback(observation, e.preparation.postconditions as any);
            if (back.verified || back.absent) return back;
          }
          if (word && (observation === null || (observation as any).outcome === 'inconclusive')) return word.said === 'sent'
            ? { verified: true, businessSuccess: false, data: { outcome: 'settled-by-person', memberId: word.memberId, at: word.at } }
            : { verified: false, businessSuccess: false, absent: true, data: { outcome: 'settled-by-person', memberId: word.memberId, at: word.at } };
          check(back, 'WRITE_READBACK_REVOKED', 'Reading this system back is no longer allowed. A person can settle it.');
          return back;
        },
      };
    }
    return { id: connectorId(system), title: system, operations };
  }

  // ── Five steps ───────────────────────────────────────────────────────────────────────────────
  key(system: SystemId, action: string, connectionId: string, intentId: string) { return `wb-${digest({ system, action, connectionId, intentId })}`; }
  find(state: State, id: unknown): PreparedAction {
    const action = state.actions.find(a => a.id === id && typeof a.connector === 'string' && a.connector.startsWith('wb-')) as PreparedAction | undefined;
    check(action, 'NOT_FOUND', 'That action is not in the record.'); return action;
  }
  visible(context: Context, action: PreparedAction) { const state = this.store.read(); this.actions.access(state, context, action); }
  /** The stored action must still be exactly what was prepared and, when approved, what was approved. */
  intact(action: PreparedAction) {
    check(action.digest === this.actions.identity(action) && (!action.approval || action.approval.digest === action.digest), 'PREVIEW_CHANGED', 'The stored action no longer matches what was prepared. Nothing was sent.');
  }
  async prepare(context: Context, input: { connectionId: unknown; action: unknown; payload: unknown; intentId: unknown; sourceIds?: unknown; evidence?: Envelope['evidence'] }) {
    const state0 = this.store.read(); current(state0, context, 'prepare');
    const connection = this.#connection(state0, input.connectionId);
    const row = entry(connection.system, String(input.action));
    if (!row) return this.refuseUnlisted(context, connection.system, input.action);
    check(connection.read, 'WRITE_READ_REVOKED', 'Reading this system is not allowed, so Chausar cannot prepare a write.');
    check(row.tier === 'prepare-only' || connection.write.includes(row.action), 'WRITE_NOT_GRANTED', 'Being allowed to read this system does not allow writing to it. The owner grants each action.');
    const intentId = text(input.intentId, 200);
    const sourceIds = input.sourceIds === undefined ? [] : (check(Array.isArray(input.sourceIds) && input.sourceIds.length <= 50, 'INVALID_SOURCES', 'Source IDs are a list.'), input.sourceIds.map(s => text(s, 100)));
    const adapter = this.adapter(connection.system, row.action);
    const payload = adapter.validate(JSON.parse(canonical(input.payload)));
    const key = this.key(connection.system, row.action, connection.id, intentId);
    const existing = state0.actions.find(a => a.connector === connectorId(connection.system) && a.operation === row.action && a.idempotencyKey === key) as PreparedAction | undefined;
    if (existing) {
      this.visible(context, existing);
      check(canonical((existing.payload as any).payload) === canonical(payload), 'IDEMPOTENCY_CONFLICT', 'This intent already holds a different exact change. Change it, or prepare a new intent.');
      return this.view(this.store.read(), existing);
    }
    const preparation = await adapter.prepare(this.adapterContext(context, connection), structuredClone(payload), key);
    const envelope: Envelope = { protocol: PROTOCOL, system: connection.system, action: row.action, connectionId: connection.id, environment: connection.environment, accountDigest: digest(connection.account),
      intentId, payload, preparation: JSON.parse(canonical(preparation)), catalogueDigest: catalogueDigest(row), evidence: input.evidence ?? null };
    if (preparation.alreadyApplied) return { status: 'already-done', externalId: preparation.alreadyApplied.externalId, preview: preparation.preview, target: preparation.target, message: 'This is already in the system. Nothing will be sent.' };
    const action = await this.actions.prepare(context, { connector: connectorId(connection.system), operation: row.action, payload: envelope, idempotencyKey: key, sourceIds });
    await this.store.update(state => { current(state, context, 'prepare'); moduleState(state, MODULE_ID, initState).preparedAt[action.id] = this.now(); audit(state, 'writeback.prepared', { actionId: action.id, system: connection.system, action: row.action, environment: connection.environment }); });
    return this.view(this.store.read(), this.find(this.store.read(), action.id));
  }
  /** A changed payload is a new exact change: the yes is gone and the preview is built again. */
  async change(context: Context, id: unknown, payload: unknown) {
    check(!context.sourceTainted, 'TAINTED_APPROVAL', 'Imported text cannot change an action.');
    const action = this.find(this.store.read(), id); this.visible(context, action);
    const e = this.envelope(action.payload);
    check(!e.evidence, 'WRITE_PREPARE_AGAIN', 'This action was built from evidence. Prepare it again instead of changing it.'); const connection = this.#connection(this.store.read(), e.connectionId);
    const adapter = this.adapter(e.system, e.action); const valid = adapter.validate(JSON.parse(canonical(payload)));
    const preparation = await adapter.prepare(this.adapterContext(context, connection), structuredClone(valid), action.idempotencyKey);
    check(!preparation.alreadyApplied, 'WRITE_ALREADY_APPLIED', 'This change is already in the system.');
    await this.actions.revise(context, action.id, { ...e, payload: valid, preparation: JSON.parse(canonical(preparation)) });
    await this.#note(context, action.id, 'prepared-again');
    return this.view(this.store.read(), this.find(this.store.read(), action.id));
  }
  async approve(context: Context, id: unknown, expectedDigest: unknown) {
    const action = this.find(this.store.read(), id); this.visible(context, action);
    const e = this.envelope(action.payload); const row = entry(e.system, e.action)!;
    check(row.tier !== 'prepare-only', 'PREPARE_ONLY', 'This is prepared only. Download the file and the checklist; you or your accountant completes it.');
    check(context.channel !== 'phone', 'OPEN_DESKTOP', 'Approve outside changes in the desktop app.'); this.intact(action);
    const expired = await this.#expire(context, action);
    if (expired) return expired;
    await this.actions.approve(context, action.id, String(expectedDigest));
    await this.store.update(state => { moduleState(state, MODULE_ID, initState).approvedAt[action.id] = this.now(); });
    return this.view(this.store.read(), this.find(this.store.read(), action.id));
  }
  async drop(context: Context, id: unknown) {
    check(!context.sourceTainted, 'TAINTED_APPROVAL', 'Imported text cannot drop an action.');
    const action = this.find(this.store.read(), id); this.visible(context, action);
    await this.actions.cancel(context, action.id);
    return this.view(this.store.read(), this.find(this.store.read(), action.id));
  }
  expiresAt(state: State, action: PreparedAction): string | null {
    if (!['prepared', 'approved'].includes(action.status)) return null;
    const e = action.payload as unknown as Envelope; const row = entry(e.system, e.action); if (!row) return null;
    const wb = readState(state); const hours = Math.min(row.approvalLifetimeHours, wb.settings.approvalHours[row.kind]);
    const from = action.approval ? wb.approvedAt[action.id] ?? action.approval.at : wb.preparedAt[action.id] ?? action.createdAt;
    return new Date(Date.parse(from) + hoursMs(hours)).toISOString();
  }
  /** An expired yes is dropped and the person is told; an expired preparation leaves the queue. Nothing is sent. */
  async #expire(context: Context, action: PreparedAction) {
    const at = this.expiresAt(this.store.read(), action);
    if (!at || Date.parse(this.now()) < Date.parse(at)) return null;
    if (action.status === 'approved') await this.actions.revise(context, action.id, structuredClone(action.payload));
    else await this.actions.cancel(context, action.id);
    await this.store.update(state => { if (action.status === 'approved') moduleState(state, MODULE_ID, initState).preparedAt[action.id] = this.now(); });
    await this.#note(context, action.id, 'expired');
    return { ...this.view(this.store.read(), this.find(this.store.read(), action.id)), notice: { kind: 'expired', expiredAt: at, message: 'This expired. Nothing was sent.' } };
  }
  async #note(context: Context, actionId: string, kind: WritebackState['notices'][number]['kind']) {
    await this.store.update(state => { current(state, context); const wb = moduleState(state, MODULE_ID, initState); wb.notices.push({ id: newId('notice'), actionId, kind, at: this.now() }); if (wb.notices.length > 500) wb.notices.splice(0, wb.notices.length - 500); audit(state, `writeback.${kind}`, { actionId }); });
  }
  async execute(context: Context, id: unknown) {
    check(!context.sourceTainted, 'TAINTED_EXECUTION', 'Imported text cannot execute an action.');
    const action = this.find(this.store.read(), id); this.visible(context, action);
    const e = this.envelope(action.payload); const row = entry(e.system, e.action)!;
    check(row.tier !== 'prepare-only', 'PREPARE_ONLY', 'This is prepared only. You or your accountant completes it.');
    this.intact(action);
    check(action.status === 'approved' && action.attempts.length === 0, action.attempts.length ? 'ACTION_ALREADY_ATTEMPTED' : 'APPROVAL_REQUIRED', action.attempts.length ? 'Actions run once. Read it back instead.' : 'Approve the exact change first.');
    const expired = await this.#expire(context, action); if (expired) return expired;
    const connection = this.#connection(this.store.read(), e.connectionId);
    check(connection.write.includes(e.action), 'WRITE_PERMISSION_REVOKED', 'Writing this action to the system is no longer allowed.');
    check(e.accountDigest === digest(connection.account) && e.environment === connection.environment, 'WRITE_BINDING_CHANGED', 'The connection changed after preparation. Prepare it again.');
    if (e.evidence) {
      const derive = this.ports.evidence?.[e.evidence.kind]; check(derive, 'WRITE_EVIDENCE_UNAVAILABLE', 'The evidence this action depends on cannot be checked.');
      let fresh: string | null = null; try { fresh = await derive(context, e); } catch { fresh = null; }
      if (fresh !== e.evidence.digest) {
        await this.actions.cancel(context, action.id); await this.#note(context, action.id, 'cancelled-evidence');
        return { ...this.view(this.store.read(), this.find(this.store.read(), action.id)), notice: { kind: 'cancelled-evidence', message: 'What this action was based on changed. Nothing was sent. Prepare it again.' } };
      }
    }
    // Look first: the system is read again before anything is sent. The approved command is what is sent;
    // a fresh command may differ only in its own time stamps (a mail Date header), never in what it changes.
    const adapter = this.adapter(e.system, e.action), ctx = this.adapterContext(context, connection);
    const fresh = JSON.parse(canonical(await adapter.prepare(ctx, structuredClone(e.payload), action.idempotencyKey))) as Preparation;
    const journalled = connection.environment !== 'practice' && this.journal().has(action.idempotencyKey);
    if (fresh.alreadyApplied) this.#skip.set(action.idempotencyKey, 'already-applied');
    else if (journalled) this.#skip.set(action.idempotencyKey, 'journal');
    else if (canonical(fresh.before) !== canonical(e.preparation.before) || canonical(fresh.target) !== canonical(e.preparation.target) || canonical(fresh.postconditions) !== canonical(e.preparation.postconditions) || fresh.sourceVersion !== e.preparation.sourceVersion) {
      await this.actions.revise(context, action.id, { ...e, preparation: fresh });
      await this.store.update(state => { moduleState(state, MODULE_ID, initState).preparedAt[action.id] = this.now(); });
      await this.#note(context, action.id, 'prepared-again');
      return { ...this.view(this.store.read(), this.find(this.store.read(), action.id)), notice: { kind: 'prepared-again', message: 'The target changed after you approved. It was prepared again; nothing was sent.' } };
    }
    if (this.#skip.has(action.idempotencyKey)) await this.#note(context, action.id, this.#skip.get(action.idempotencyKey) === 'journal' ? 'looked-first' : 'already-done');
    let settled: PreparedAction;
    try { settled = await this.actions.execute(context, action.id); } finally { this.#skip.delete(action.idempotencyKey); }
    if (settled.status === 'unknown' && settled.readback?.absent) settled = await this.actions.reconcile(context, action.id);
    if (settled.status === 'verified') await this.ports.settled?.(context, settled, e);
    return this.view(this.store.read(), this.find(this.store.read(), action.id));
  }
  /** Read the system for an action whose result is not known. Never sends. */
  async readBack(context: Context, id: unknown) {
    const action = this.find(this.store.read(), id); this.visible(context, action);
    let settled = await this.actions.reconcile(context, action.id);
    if (settled.status === 'verified') await this.ports.settled?.(context, settled, this.envelope(settled.payload));
    settled = this.find(this.store.read(), action.id);
    return this.view(this.store.read(), settled);
  }
  /** A person settles an unknown result when the system offers no way to look ("It was sent" / "It was not sent"). */
  async settle(context: Context, id: unknown, said: unknown) {
    const word = oneOf(said, ['sent', 'not-sent'] as const);
    const action = this.find(this.store.read(), id); this.visible(context, action);
    check(action.status === 'unknown', 'INVALID_ACTION_STATE', 'Only a result that is not known can be settled by a person.');
    await this.store.update(state => {
      current(state, context, 'approve'); check(!context.sourceTainted, 'TAINTED_APPROVAL', 'Imported text cannot settle an action.');
      moduleState(state, MODULE_ID, initState).attestations.push({ actionId: action.id, memberId: context.memberId, said: word, at: this.now() });
      audit(state, 'writeback.settled-by-person', { actionId: action.id, said: word });
    });
    return this.readBack(context, action.id);
  }
  /** Run each unknown action's read-back; list approved actions whose key was already dispatched (a restored vault). */
  async reconcileAll(context: Context) {
    authorize(this.store, context, 'admin');
    const results: { id: string; status: string; error?: string }[] = [];
    for (const action of this.store.read().actions as PreparedAction[]) {
      if (!action.connector?.startsWith('wb-') || action.status !== 'unknown') continue;
      try { results.push({ id: action.id, status: (await this.readBack(context, action.id) as any).status }); }
      catch (error) { results.push({ id: action.id, status: 'unknown', error: error instanceof ChausarError ? error.code : 'READBACK_FAILED' }); }
    }
    return { reconciled: results, afterRestore: this.afterRestore(context) };
  }
  /** Actions that may have gone out after the vault's backup was made: approved here, but already dispatched. */
  afterRestore(context: Context) {
    authorize(this.store, context);
    const state = this.store.read(); const journal = this.journal();
    return (state.actions as PreparedAction[]).filter(a => a.connector?.startsWith('wb-') && ['approved', 'prepared', 'executing'].includes(a.status) && a.attempts.length === 0 && journal.has(a.idempotencyKey))
      .filter(a => { try { this.actions.access(state, context, a); return true; } catch { return false; } })
      .map(a => ({ id: a.id, system: (a.payload as any).system, action: (a.payload as any).action, message: 'This may already have gone out. Chausar will look before doing anything.' }));
  }
  /** Drop expired yeses and expired preparations. Runs from tick and before listing. */
  async expireAll(context: Context) {
    const expired: string[] = [];
    for (const action of this.store.read().actions as PreparedAction[]) {
      if (!action.connector?.startsWith('wb-') || !['prepared', 'approved'].includes(action.status)) continue;
      try { this.actions.access(this.store.read(), context, action); if (await this.#expire(context, action)) expired.push(action.id); } catch { /* not visible to this caller */ }
    }
    return expired;
  }

  // ── Views ────────────────────────────────────────────────────────────────────────────────────
  ledger(context: Context, input: { limit?: unknown } = {}) {
    authorize(this.store, context); const state = this.store.read();
    const limit = input.limit === undefined ? 200 : (check(Number.isSafeInteger(input.limit) && (input.limit as number) > 0 && (input.limit as number) <= 1000, 'INVALID_REQUEST', 'Use a limit from 1 to 1000.'), input.limit as number);
    return (state.actions as PreparedAction[]).filter(a => a.connector?.startsWith('wb-')).filter(a => { try { this.actions.access(state, context, a); return true; } catch { return false; } })
      .slice(-limit).reverse().map(a => this.view(state, a));
  }
  get(context: Context, id: unknown) { const action = this.find(this.store.read(), id); this.visible(context, action); return this.view(this.store.read(), action); }
  view(state: State, action: PreparedAction) {
    const e = action.payload as unknown as Envelope; const row = entry(e.system, e.action)!; const wb = readState(state);
    const connection = wb.connections.find(c => c.id === e.connectionId);
    const attempt = action.attempts[0]; const back = action.readback as (Readback & { data?: any }) | undefined;
    const settledByPerson = back?.data?.outcome === 'settled-by-person';
    const word = action.status === 'prepared' ? (row.tier === 'prepare-only' ? 'prepare-only' : 'waiting-for-you') : action.status === 'approved' ? 'approved' : action.status === 'executing' ? 'doing' : action.status === 'verified' ? 'done' : action.status === 'unknown' ? 'not-sure' : action.status === 'rejected' ? 'not-done' : action.status === 'cancelled' ? 'dropped' : action.status;
    const step = (name: 'prepared' | 'approved' | 'done' | 'read-back' | 'recorded', state0: 'done' | 'current' | 'waiting' | 'unknown' | 'skipped', turn: 'person' | 'chausar', at?: string) => ({ name, state: state0, turn, ...(at ? { at } : {}) });
    const settled = ['verified', 'rejected'].includes(action.status);
    const steps = [
      step('prepared', 'done', 'chausar', action.createdAt),
      step('approved', action.approval ? 'done' : action.status === 'prepared' ? 'current' : action.status === 'cancelled' ? 'skipped' : 'waiting', 'person', action.approval?.at),
      step('done', attempt?.finishedAt || attempt?.result ? 'done' : action.status === 'executing' ? 'current' : action.status === 'unknown' ? 'unknown' : 'waiting', 'chausar', attempt?.startedAt),
      step('read-back', back?.verified || back?.absent ? 'done' : action.status === 'unknown' ? 'unknown' : 'waiting', settledByPerson ? 'person' : 'chausar', attempt?.finishedAt),
      step('recorded', settled ? 'done' : 'waiting', 'chausar', settled ? attempt?.finishedAt : undefined),
    ];
    const observed = back?.data?.observed as Record<string, unknown> | undefined;
    const comparison = observed ? Object.entries(e.preparation.postconditions).map(([name, expected]) => ({ name, expected, observed: observed[name] ?? null, match: canonical(observed[name] ?? null) === canonical(expected) })) : null;
    const expiresAt = this.expiresAt(state, action);
    const notices = wb.notices.filter(n => n.actionId === action.id).map(n => ({ kind: n.kind, at: n.at }));
    return {
      id: action.id, system: e.system, action: e.action, title: row.title, digest: action.digest, revision: action.revision, status: action.status, word,
      connection: connection ? { id: connection.id, label: connection.label, environment: connection.environment, removed: Boolean(connection.revokedAt) } : null,
      practice: e.environment === 'practice', kind: row.kind, tier: row.tier, alwaysWaits: row.alwaysWaits, preview: e.preparation.preview, target: e.preparation.target,
      steps, expiresAt, readBack: back ? { outcome: back.data?.outcome ?? null, reason: back.data?.reason ?? null, comparison, settledBy: settledByPerson ? 'person' : back.verified || back.absent ? 'system' : null } : null,
      businessSuccess: action.businessSuccess ?? null, externalId: action.result?.externalId ?? back?.externalId ?? null, notices,
      approval: {
        approvalId: action.id, kind: row.tier === 'prepare-only' ? 'prepare-only' : row.kind === 'seen-outside' ? 'message' : row.kind === 'money' ? 'money' : 'record-change',
        practice: e.environment === 'practice', what: `writeback.${e.system}.${e.action}`, target: { label: e.preparation.target.label, ...(e.preparation.target.ref ? { ref: e.preparation.target.ref } : {}) },
        waitsBecause: { ruleId: row.alwaysWaits ? 'always-waits' : 'every-change-waits', text: row.waitsBecause },
        change: 'asWritten' in e.preparation.preview ? { asWritten: e.preparation.preview.asWritten } : { fields: e.preparation.preview.fields },
        steps: steps.map(s => ({ name: s.name, state: s.state, turn: s.turn, ...(s.at ? { at: s.at } : {}) })), tier: row.tier,
        cancels: ['writeback.cancels.changed', 'writeback.cancels.expiry', ...(e.evidence ? ['writeback.cancels.evidence'] : [])],
        expiresAt, preparedBy: { kind: e.evidence?.kind === 'invoice-follow-up' ? 'job' : 'person', name: action.createdBy },
        needsSecondAsk: row.kind === 'money' || row.kind === 'cannot-undo',
        can: action.status === 'prepared' && row.tier !== 'prepare-only' ? ['approve', 'notNow', 'change', 'drop'] : action.status === 'prepared' ? ['notNow', 'drop'] : action.status === 'approved' ? ['change', 'drop'] : [],
      },
    };
  }
}
