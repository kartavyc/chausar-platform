/**
 * Read models for the write connections place (WK-06) and the caps screen (WK-12). They return
 * only what a person may see: no secret, no credential, and linked read connections only inside
 * the caller's branches and sources.
 */
import { authorize } from '../contracts.ts';
import type { Context, State } from '../contracts.ts';
import { peekModuleState } from '../modules/types.ts';
import { CATALOGUE } from './catalogue.ts';
import { dayKey, FOLLOW_UP } from './follow-up.ts';
import { LINKABLE, ownCredential, readState, type WritebackService } from './service.ts';
import type { SystemId } from './types.ts';

export type AccountField = { name: string; required: boolean; secret: false; example: string };
/** The account identifiers each system needs. Never a secret: keys and passwords go to the credential store. */
export const ACCOUNT_FIELDS: Readonly<Record<SystemId, readonly AccountField[]>> = Object.freeze({
  tally: [{ name: 'host', required: true, secret: false, example: '127.0.0.1' }, { name: 'port', required: true, secret: false, example: '9000' }, { name: 'company', required: true, secret: false, example: 'Demo Traders' }],
  'zoho-books': [{ name: 'organizationId', required: true, secret: false, example: '60012345678' }, { name: 'dataCenter', required: true, secret: false, example: 'in' }],
  razorpay: [],
  shopify: [{ name: 'shop', required: true, secret: false, example: 'my-store' }],
  'google-workspace': [],
  whatsapp: [{ name: 'phoneNumberId', required: true, secret: false, example: '100000000000101' }, { name: 'wabaId', required: true, secret: false, example: '200000000000201' }],
  mail: [{ name: 'smtpHost', required: true, secret: false, example: 'smtp.example.com' }, { name: 'smtpPort', required: true, secret: false, example: '587' }, { name: 'smtpSecurity', required: true, secret: false, example: 'starttls' },
    { name: 'from', required: true, secret: false, example: 'accounts@example.com' }, { name: 'fromName', required: false, secret: false, example: 'Accounts' },
    { name: 'imapHost', required: false, secret: false, example: 'imap.example.com' }, { name: 'imapPort', required: false, secret: false, example: '993' }, { name: 'sentFolder', required: false, secret: false, example: 'Sent' }],
  'gst-portal': [{ name: 'gstin', required: true, secret: false, example: '27ABCDE1234F1Z5' }],
});
/** How each system's own credential is entered: a token, or an id and a secret written id:secret. */
export const CREDENTIAL_SHAPE: Readonly<Record<SystemId, 'none' | 'token' | 'pair'>> = Object.freeze({
  tally: 'none', 'zoho-books': 'token', razorpay: 'pair', shopify: 'token', 'google-workspace': 'token', whatsapp: 'token', mail: 'pair', 'gst-portal': 'none',
});

type Visible = (branch: string, sourceId: string) => boolean;
function visibility(state: State, context: Context): Visible {
  const member = state.members.find(m => m.id === context.memberId);
  const allowed = state.policy.allowedSources;
  return (branch, sourceId) => Boolean(member && (member.branches.includes('*') || member.branches.includes(branch)) && (allowed.includes('*') || allowed.includes(sourceId)));
}

export function overview(service: WritebackService, context: Context, credentialPresent: (sourceId: string) => boolean | 'unreadable') {
  authorize(service.store, context);
  const state = service.store.read(), wb = readState(state), visible = visibility(state, context);
  const reads = (peekModuleState<{ connections?: { id: string; group: string; sourceId: string; branch: string; status: string; label?: string }[] }>(state, 'connectors-ext')?.connections ?? []);
  const rows = CATALOGUE.map(row => service.row(state, row));
  const connections = wb.connections.filter(c => !c.revokedAt && (!c.link || visible(c.link.branch, c.link.sourceId))).map(c => {
    const read = c.link ? reads.find(r => r.id === c.link!.connectionId) : undefined;
    const credential = c.environment === 'practice' ? 'practice' as const : CREDENTIAL_SHAPE[c.system] === 'none' ? 'not-needed' as const
      : c.link ? (read?.status === 'active' ? 'linked' as const : 'link-paused' as const)
      : (() => { const present = credentialPresent(ownCredential(c)); return present === 'unreadable' ? 'unreadable' as const : present ? 'stored' as const : 'missing' as const; })();
    const sandbox = wb.qualifications.filter(q => q.connectionId === c.id && q.level === 'sandbox-verified');
    return {
      id: c.id, system: c.system, label: c.label, environment: c.environment, account: { ...c.account }, read: c.read, createdAt: c.createdAt,
      link: c.link ? { connectionId: c.link.connectionId, group: c.link.group, label: read?.label ?? null, active: read?.status === 'active' } : null,
      credential, credentialShape: CREDENTIAL_SHAPE[c.system],
      actions: rows.filter(r => r.system === c.system).map(r => ({ action: r.action, title: r.title, kind: r.kind, tier: r.tier, alwaysWaits: r.alwaysWaits, undoable: r.undoable,
        status: r.status, qualification: r.qualification, writeScore: r.writeScore, granted: c.write.includes(r.action), grantable: r.tier !== 'prepare-only' && r.installed,
        sandboxVerified: sandbox.some(q => q.action === r.action) })),
      sandboxRuns: sandbox.map(q => ({ action: q.action, score: q.score, at: q.at })),
    };
  });
  const linkable = reads.filter(r => r.status === 'active' && visible(r.branch, r.sourceId))
    .flatMap(r => (Object.entries(LINKABLE) as [SystemId, string[]][]).filter(([, groups]) => groups.includes(r.group)).map(([system]) => ({ id: r.id, system, group: r.group, label: r.label ?? r.group, branch: r.branch })));
  const systems = (Object.keys(ACCOUNT_FIELDS) as SystemId[]).map(system => ({ system, fields: ACCOUNT_FIELDS[system], credential: CREDENTIAL_SHAPE[system], linkable: LINKABLE[system] ?? [],
    actions: rows.filter(r => r.system === system).length }));
  return { demo: service.ports.demo, connections, linkable, systems };
}

/** The caps and approval lifetimes, with today's counts in the write-back day (its time zone). */
export function capsView(service: WritebackService, context: Context, timeZone: string) {
  authorize(service.store, context);
  const state = service.store.read(), wb = readState(state), now = service.now(), today = dayKey(now, timeZone);
  const reminders = (state.actions as any[]).filter(a => typeof a.connector === 'string' && a.connector.startsWith('wb-') && a.payload?.evidence?.kind === FOLLOW_UP && a.payload.evidence.detail?.day === today && !['cancelled', 'rejected'].includes(a.status));
  const sent = wb.journal.filter(j => j.kind === 'sent' && j.on === today);
  return { settings: structuredClone(wb.settings), timeZone, today, now,
    counts: { preparedToday: reminders.length, sentToday: sent.length, customersToday: new Set([...reminders.map(a => a.payload.evidence.detail.customerId), ...sent.map(j => j.customerId)]).size } };
}
