/**
 * Synthetic `todayx.*` replies for the fake engine. Codes, ids, digits and ISO dates only,
 * exactly the shapes of `bridge/todayx-contract.ts`. Only `bridge/fake.ts` and tests import this.
 */
import type {
  ActivityEvent, ActivityReply, CapabilitiesReply, ChecklistReply, FaultReport, FirstRunStatusReply, HelpReply, IdentityCheckReply,
  IdentityField, IdentityProblem, PhoneMessagesReply, ShellBanner, ShellReply, StatusReply, WorthReply,
} from '../todayx-contract.ts';
import { ACTIONS, DECISION_ID, DEMO_CUSTOMERS, DEMO_ROUTE, receiptIdFor } from './shop.ts';

export type FakeScenarioName = 'populated' | 'empty' | 'first-run' | 'locked' | 'read-only';

export interface TodayxState {
  clock: { mode: 'real' } | { mode: 'demo'; date: string; set: boolean };
  jobsPaused: boolean;
}

export function shellReply(scenario: FakeScenarioName, state: TodayxState, demo: boolean, holder: string): ShellReply {
  const banners: ShellBanner[] = [];
  if (state.clock.mode === 'demo') banners.push({ kind: 'demo-clock', date: state.clock.date });
  if (scenario === 'read-only') banners.push({ kind: 'read-only', holder });
  if (state.jobsPaused && scenario === 'populated') banners.push({ kind: 'jobs-paused' });
  return {
    workspace: { demo },
    clock: state.clock.mode === 'demo' ? { mode: 'demo', date: state.clock.date } : { mode: 'real' },
    banners, autoLockMinutes: 15,
  };
}

export function statusReply(scenario: FakeScenarioName, date: string): StatusReply {
  if (scenario === 'empty' || scenario === 'first-run' || scenario === 'locked') return { sources: { state: 'none' }, model: { state: 'none' }, third: { kind: 'nothing-left' } };
  return {
    sources: { state: 'fresh', count: '2', oldestReadAt: `${date}T03:40:00.000Z`, newestReadAt: `${date}T03:45:00.000Z` },
    model: { state: 'ready', routeLabel: DEMO_ROUTE.label, sendLevel: 'shape' },
    third: scenario === 'read-only' ? { kind: 'holds-pen', holder: 'Asha Demo' } : { kind: 'left-today', calls: '3' },
  };
}

export function capabilitiesReply(): CapabilitiesReply {
  return { groups: [
    { group: 'today', state: 'live', day: null, methods: 'today.get today.review today.prepareTiles' },
    { group: 'todayx', state: 'partial', day: 2, methods: 'todayx.shell todayx.status todayx.worthALook todayx.activity' },
    { group: 'approvals', state: 'missing', day: 4, methods: 'approvals.list approvals.get' },
    { group: 'books', state: 'missing', day: 5, methods: 'books.sources books.accounts' },
    { group: 'reportsx', state: 'missing', day: 7, methods: 'reportsx.packs reportsx.weekAhead' },
  ] };
}

export function worthReply(scenario: FakeScenarioName, date: string): WorthReply {
  if (scenario === 'empty') return { rows: [], state: 'ready' };
  return { state: 'ready', rows: [
    { id: 'worth_demo_moved', kind: 'moved', subject: 'Received', at: `${date}T04:00:00.000Z`, figure: { unit: 'paise', exact: '41070000', receiptId: receiptIdFor('received_2026_09') }, finding: 'lead-not-tested', opens: '#/books/history' },
    { id: 'worth_demo_due', kind: 'due-soon', subject: 'GSTR-3B', at: '2026-10-20T00:00:00.000Z', opens: '#/reports/duedates' },
    { id: 'worth_demo_decision', kind: 'decision-due', subject: DEMO_CUSTOMERS[0]!, at: `${date}T00:00:00.000Z`, opens: `#/ask/decisions?sheet=${DECISION_ID}` },
    { id: 'worth_demo_refused', kind: 'file-refused', subject: 'bank-september.csv', at: `${date}T03:50:00.000Z`, opens: '#/books/sources' },
  ] };
}

const EVENTS = (date: string): ActivityEvent[] => [
  { id: 'act_evt_demo_1', at: `${date}T05:20:00.000Z`, type: 'decision.created', state: 'waiting-for-you', actor: { kind: 'you', name: null }, values: { decision: DECISION_ID }, costPaise: null, route: null, tainted: false, proof: { kind: 'none', id: null } },
  { id: 'act_evt_demo_2', at: `${date}T04:10:00.000Z`, type: 'action.prepared', state: 'waiting-for-you', actor: { kind: 'chausar', name: null }, values: { action: ACTIONS[0]!.id, customer: DEMO_CUSTOMERS[0]! }, costPaise: null, route: null, tainted: false, proof: { kind: 'action', id: ACTIONS[0]!.id } },
  { id: 'act_evt_demo_3', at: `${date}T04:00:00.000Z`, type: 'calculation.completed', state: 'done', actor: { kind: 'chausar', name: null }, values: { operation: 'billed' }, costPaise: null, route: null, tainted: false, proof: { kind: 'receipt', id: receiptIdFor('billed_2026_09') } },
  { id: 'act_evt_demo_4', at: `${date}T03:55:00.000Z`, type: 'model.answered', state: 'done', actor: { kind: 'chausar', name: null }, values: { route: DEMO_ROUTE.id }, costPaise: '120', route: DEMO_ROUTE.id, tainted: true, proof: { kind: 'model-request', id: 'mreq_demo_1' } },
  { id: 'act_evt_demo_5', at: `${date}T03:50:00.000Z`, type: 'source.refused', state: 'stopped-by-rule', actor: { kind: 'job', name: 'Nightly bank read' }, values: { file: 'bank-september.csv', reason: 'date_format' }, costPaise: null, route: null, tainted: true, proof: { kind: 'none', id: null } },
  { id: 'act_evt_demo_6', at: `${date}T03:45:00.000Z`, type: 'source.imported', state: 'done', actor: { kind: 'person', name: 'Asha Demo' }, values: { source: 'source_tally_demo', rows: '1284' }, costPaise: null, route: null, tainted: false, proof: { kind: 'none', id: null } },
];

/** One page of two, newest first. Filters narrow the page by state, actor kind or day. */
export function activityReply(scenario: FakeScenarioName, date: string, payload: Record<string, unknown>): ActivityReply {
  if (scenario === 'empty') return { events: [], nextCursor: null, total: '0' };
  let events = EVENTS(date);
  if (typeof payload['state'] === 'string') events = events.filter(event => event.state === payload['state']);
  if (typeof payload['actor'] === 'string') events = events.filter(event => event.actor.kind === payload['actor']);
  if (typeof payload['day'] === 'string') events = events.filter(event => event.at.startsWith(payload['day'] as string));
  const filtered = events.length !== EVENTS(date).length;
  const second = payload['cursor'] === 'activity_page_2';
  const page = second ? events.slice(4) : events.slice(0, 4);
  return { events: page, nextCursor: !second && events.length > 4 ? 'activity_page_2' : null, total: filtered ? String(events.length) : '6' };
}

export function firstRunStatusReply(scenario: FakeScenarioName, published: boolean): FirstRunStatusReply {
  if (scenario === 'locked') return { steps: { you: 'not-done', vault: 'not-done', model: 'not-done', books: 'not-done', meanings: 'not-done', answer: 'not-done' }, blocked: 'no-vault', leftThisComputer: 'nothing' };
  const sources = scenario !== 'empty' && scenario !== 'first-run';
  return {
    steps: { you: 'done', vault: 'done', model: sources ? 'done' : 'not-done', books: sources ? 'done' : 'not-done', meanings: published ? 'done' : 'not-done', answer: sources && published ? 'done' : 'not-done' },
    blocked: !sources ? 'no-source' : !published ? 'meanings-unpublished' : 'nothing',
    leftThisComputer: sources ? 'something' : 'nothing',
  };
}

const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const LENGTHS: Readonly<Record<IdentityField, number>> = { pan: 10, gstin: 15, udyam: 19, cin: 21, fssai: 14, iec: 10 };
const ALLOWED: Readonly<Record<IdentityField, RegExp>> = { pan: /^[A-Z0-9]*$/, gstin: /^[A-Z0-9]*$/, udyam: /^[A-Z0-9-]*$/, cin: /^[A-Z0-9]*$/, fssai: /^[0-9]*$/, iec: /^[A-Z0-9]*$/ };
const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** The published GSTIN check character (mod 36 over the first fourteen). */
export function gstinCheckCharacter(first14: string): string | null {
  let sum = 0;
  for (let index = 0; index < 14; index++) {
    const value = GSTIN_CHARS.indexOf(first14[index] ?? '');
    if (value < 0) return null;
    const product = value * (index % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36] ?? null;
}
/** Format checks only. Nothing is looked up online. */
export function identityCheck(fields: Record<string, unknown>): IdentityCheckReply {
  const out: Partial<Record<IdentityField, { readonly ok: true } | { readonly ok: false; readonly problem: IdentityProblem; readonly expectedLength: number | null }>> = {};
  const fail = (problem: IdentityProblem, expectedLength: number | null = null) => ({ ok: false as const, problem, expectedLength });
  for (const field of Object.keys(LENGTHS) as IdentityField[]) {
    const raw = fields[field];
    if (typeof raw !== 'string') continue;
    const value = raw.trim().toUpperCase();
    if (!ALLOWED[field].test(value)) { out[field] = fail('characters'); continue; }
    if (value.length !== LENGTHS[field]) { out[field] = fail('length', LENGTHS[field]); continue; }
    if (field === 'pan' && !PAN.test(value)) { out[field] = fail('characters'); continue; }
    if (field === 'gstin') {
      const state = Number(value.slice(0, 2));
      if (!/^\d{2}$/.test(value.slice(0, 2)) || state < 1 || state > 38) { out[field] = fail('state-code'); continue; }
      if (!PAN.test(value.slice(2, 12))) { out[field] = fail('characters'); continue; }
      if (typeof fields['pan'] === 'string' && fields['pan'].trim().toUpperCase() !== value.slice(2, 12)) { out[field] = fail('pan-mismatch'); continue; }
      if (gstinCheckCharacter(value.slice(0, 14)) !== value[14]) { out[field] = fail('checksum'); continue; }
    }
    out[field] = { ok: true };
  }
  return { fields: out };
}

export function checklistReply(scenario: FakeScenarioName): ChecklistReply {
  const done = scenario === 'populated' || scenario === 'read-only';
  return { rows: [
    { id: 'entity', ruleId: 'rule_entity_2026_04', source: 'MCA company rules, as checked', checkedOn: '2026-04-01', state: 'done' },
    { id: 'registration', ruleId: 'rule_shops_2026_04', source: 'State shops and establishments rules, as checked', checkedOn: '2026-04-01', state: done ? 'done' : 'not-done' },
    { id: 'bank', ruleId: 'rule_bank_2026_04', source: 'Current account checklist, as checked', checkedOn: '2026-04-01', state: done ? 'done' : 'not-done' },
    { id: 'gst', ruleId: 'rule_gst_2026_07', source: 'GST registration threshold rules, as checked', checkedOn: '2026-07-01', state: done ? 'done' : 'not-done' },
    { id: 'udyam', ruleId: 'rule_udyam_2026_04', source: 'Udyam registration rules, as checked', checkedOn: '2026-04-01', state: 'not-done' },
    { id: 'licences', ruleId: 'rule_licences_2026_04', source: 'Trade licence rules, as checked', checkedOn: '2026-04-01', state: 'not-applicable' },
  ] };
}

export function helpReply(): HelpReply {
  return { offline: { works: ['today', 'receipts', 'books', 'reports.exports', 'ask.saved'], waits: ['models.remote', 'phone.messages', 'connectors.read', 'updates'] } };
}

export function faultReport(date: string): FaultReport {
  return { appVersion: '0.1.0-preview.1', os: 'windows-10', eventKinds: ['source.imported', 'calculation.completed', 'action.prepared'], routeHealth: [{ kind: 'ollama', state: 'ready' }], errorCodes: ['TODAY_CAPTURE_UNAVAILABLE'], createdAt: `${date}T06:00:00.000Z` };
}

export function phoneMessagesReply(scenario: FakeScenarioName): PhoneMessagesReply {
  return {
    channels: [{ channel: 'whatsapp', state: scenario === 'populated' ? 'on' : 'off' }, { channel: 'telegram', state: 'off' }, { channel: 'mail', state: 'not-built' }],
    kinds: ['week-ahead', 'review', 'document', 'due-date'], sentThisMonth: scenario === 'populated' ? '14' : scenario === 'empty' ? '0' : null, monthlyBudget: '60',
  };
}
