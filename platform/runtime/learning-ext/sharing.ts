/**
 * Sharing with Chausar, if you share (TR-11, FR-10; plan day 4 blocks 12 and 13).
 *
 * The preview builds the exact bytes a batch would hold from the decision log. Consent binds
 * that byte digest, inside the app, with the sharing switch on. Submission sends those bytes
 * once to the configured intake (or, in a demo workspace, to a local test inbox) and records the
 * outcome; a lost connection is `unknown` and is settled only by re-sending the same bytes under
 * the same idempotency key. Two boxes stay closed until the founder's switch and a lawyer's
 * reading of the consent text. The sample cleaner works on this computer and never uploads.
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { audit, check, newId, now, type Context, type State } from '../contracts.ts';
import { canonical, current, digest } from '../actions.ts';
import { guardOutbound } from '../plugins.ts'; // core-gateway-auth: canary
import { parseCsv } from '../ingest.ts';
import type { MethodSpec, ModuleHost } from '../modules/types.ts';
import { area, peekArea } from './state.ts';
import { logAuthor, visibleDecisions, type LogView } from './log.ts';
import { batchBytes, scanText, VALUE_PATTERNS } from './structure.ts';
import { BOXES, LEARNING_SCHEMA, OPEN_BOXES, type Box, type StructuralBatch } from './vocabulary.ts';

export type IntakeRequest = { method: 'GET' | 'POST' | 'DELETE'; path: string; headers: Record<string, string>; body?: string };
export type IntakeTransport = (request: IntakeRequest) => Promise<{ status: number; body: string }>;
/** Trusted host option `modules['learning-ext'].intake`; never an RPC payload. */
export type IntakeOptions = { url: string; transport?: IntakeTransport; timeoutMs?: number };

type Preview = { id: string; at: string; memberId: string; epoch: number; boxes: Box[]; decisionIds: string[]; sourceIds: string[]; digest: string; size: number; count: number; blocked: { line: number; code: string }[] };
type Consent = { id: string; at: string; previewId: string; digest: string; publicName: string | null; memberId: string; role: Context['role']; epoch: number; withdrawnAt?: string; integrity: string };
type Batch = {
  id: string; at: string; consentId: string; previewId: string; mode: 'intake' | 'test-inbox'; boxes: Box[]; decisionIds: string[];
  bytes: string; digest: string; size: number; count: number; deletionToken: string;
  status: 'pending' | 'sent' | 'unknown' | 'refused' | 'deleted'; reference?: string; refusal?: string; credits?: number; settledAt?: string; deletedAt?: string;
};
type Sample = { id: string; at: string; memberId: string; label: string; status: 'clean' | 'blocked'; cleaned: string; hits: { line: number; column: string; code: string }[]; replaced: Record<string, number> };
type Sharing = { previews: Preview[]; consents: Consent[]; batches: Batch[]; testInbox: { batchId: string; bytes: string }[]; outbox: Sample[]; contributor: { token: string | null; publicName: string | null }; salt: string };

const sharing = (state: State) => area<Sharing>(state, 'sharing', () => ({ previews: [], consents: [], batches: [], testInbox: [], outbox: [], contributor: { token: null, publicName: null }, salt: randomBytes(32).toString('hex') }));
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const token = () => randomBytes(32).toString('base64url');
const appOnly = (ctx: Context) => check(!ctx.sourceTainted && ctx.channel !== 'phone' && ctx.channel !== 'mcp', 'APP_CONSENT_REQUIRED', 'Sharing is decided inside the app.');
const OUTBOX_LIMIT = 20, PREVIEW_LIMIT = 50;
const PUBLIC_NAME = /^[A-Za-z][A-Za-z .'-]{0,38}[A-Za-z.]$/;

/** Which boxes a decision belongs in. Calculations are question shapes, a closed box. */
function boxOf(item: LogView): Box {
  if (item.event.kind === 'calculation') return 'question-shapes';
  return item.event.choice === 'rejected' || item.event.choice === 'corrected' ? 'corrections' : 'setup-shapes';
}
function boxesOf(value: unknown): Box[] {
  check(Array.isArray(value) && value.length > 0 && value.length <= BOXES.length && value.every(box => (BOXES as readonly unknown[]).includes(box)), 'INVALID_REQUEST', 'Choose one or more sharing boxes.');
  const boxes = [...new Set(value as Box[])].sort();
  check(boxes.every(box => (OPEN_BOXES as readonly string[]).includes(box)), 'BOX_NOT_OPEN', 'This box waits for the founder switch and a reviewed consent text. Nothing is sent.');
  return boxes;
}
function shared(state: State): Set<string> {
  return new Set(sharing(state).batches.filter(batch => batch.status === 'sent' || batch.status === 'pending' || batch.status === 'unknown').flatMap(batch => batch.decisionIds));
}
/** The batch the given boxes would send now, from decisions not already sent. */
function compose(state: State, ctx: Context, boxes: Box[], only?: string[]) {
  const done = shared(state);
  // Events go out in canonical order, never recorded order, so the sequence of decisions cannot carry a message.
  const decisions = visibleDecisions(state, ctx).filter(item => boxes.includes(boxOf(item)) && (only ? only.includes(item.id) : !done.has(item.id)))
    .map(item => ({ item, key: canonical(item.event) })).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : a.item.id < b.item.id ? -1 : 1).map(entry => entry.item);
  const batch: StructuralBatch = { schema: LEARNING_SCHEMA, boxes, events: decisions.map(item => item.event) };
  const bytes = batchBytes(batch), lines = bytes.split('\n');
  // The first and last lines are fixed text; every event line is scanned, digits included.
  const blocked = scanText(lines.slice(1, -1).join('\n')).map(hit => ({ line: hit.line + 1, code: hit.code }));
  return { decisions, bytes, digest: sha256(bytes), size: Buffer.byteLength(bytes, 'utf8'), blocked };
}
function previewFor(state: State, ctx: Context, previewId: unknown): Preview {
  const preview = sharing(state).previews.find(item => item.id === previewId);
  check(preview, 'NOT_FOUND', 'That sharing preview does not exist.');
  check(preview.memberId === ctx.memberId && preview.epoch === ctx.epoch, 'PREVIEW_CHANGED', 'The preview belongs to another person or an older sign-in.');
  return preview;
}
/** Rebuild the previewed bytes from the current log; any change voids the consent. */
function reproduce(state: State, ctx: Context, preview: Preview) {
  const built = compose(state, ctx, preview.boxes, preview.decisionIds);
  check(built.decisions.length === preview.decisionIds.length && built.digest === preview.digest, 'PREVIEW_CHANGED', 'The decisions behind this preview changed. Open a new preview.');
  check(built.blocked.length === 0, 'SHARING_BLOCKED', 'Something that looks like a value was found. Nothing is sent.');
  return built;
}
function consentIntact(consent: Consent): boolean { const { integrity, withdrawnAt: _withdrawn, ...record } = consent; return integrity === digest(record); }

function intakeOf(host: ModuleHost): IntakeOptions | null {
  const value = host.options.intake as IntakeOptions | undefined;
  if (!value) return null;
  check(typeof value.url === 'string' && (/^https:\/\/[^\s/?#]+(?:\/[^\s?#]*)?$/.test(value.url) || /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:\/[^\s?#]*)?$/.test(value.url)), 'INTAKE_MISCONFIGURED', 'The intake address must be an HTTPS address or this computer.');
  return value;
}
function transportOf(options: IntakeOptions): IntakeTransport {
  if (options.transport) return options.transport;
  const base = options.url.replace(/\/$/, '');
  return async request => {
    const response = await fetch(`${base}${request.path}`, { method: request.method, headers: request.headers, body: request.body, redirect: 'error', signal: AbortSignal.timeout(options.timeoutMs ?? 15_000) });
    return { status: response.status, body: (await response.text()).slice(0, 65_536) };
  };
}
function refusalCode(body: string): string {
  try { const code = JSON.parse(body)?.error?.code; return typeof code === 'string' && /^[A-Z_]{2,40}$/.test(code) ? code : 'INTAKE_REFUSED'; } catch { return 'INTAKE_REFUSED'; }
}

export function intakeStatus(state: State, host: ModuleHost) {
  const demo = state.workspace.demo, configured = !demo && intakeOf(host) !== null;
  const mode = demo ? 'test-inbox' : configured ? 'intake' : 'closed';
  return {
    open: mode !== 'closed', mode, sharingSwitch: state.policy.sharing,
    label: mode === 'test-inbox' ? 'Demo test: sends to a test inbox only.' : mode === 'closed' ? 'Sharing is not open yet. Nothing is sent.' : 'Sharing sends structure only.',
    boxes: BOXES.map(box => ({ box, open: (OPEN_BOXES as readonly string[]).includes(box), ...((OPEN_BOXES as readonly string[]).includes(box) ? {} : { reason: 'Waits for the founder switch and a reviewed consent text.', shown: host.options.founderSwitch === true }) })),
  };
}

async function send(host: ModuleHost, batch: Batch, publicName: string | null, contributor: string, ctx: Context) {
  const options = intakeOf(host);
  check(options, 'INTAKE_NOT_OPEN', 'Sharing is not open yet. Nothing is sent.');
  const body = `{"batch":${batch.bytes.replace(/\n/g, '')},"contributor":${JSON.stringify({ publicName })}}`;
  // core-gateway-auth: canary. The exact body is checked before it leaves; a protected value throws CANARY_BLOCKED and nothing is sent.
  await guardOutbound(host.store, ctx, { channel: 'learning', receiptId: batch.id, endpoint: '/v1/batches', payload: body });
  const response = await transportOf(options)({ method: 'POST', path: '/v1/batches', headers: { 'content-type': 'application/json', 'idempotency-key': batch.id, authorization: `Bearer ${contributor}`, 'x-deletion-token': batch.deletionToken }, body });
  if (response.status === 200 || response.status === 201) {
    const reply = JSON.parse(response.body);
    check(typeof reply?.reference === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(reply.reference), 'INTAKE_REPLY_INVALID', 'The intake reply was not understood.');
    return { status: 'sent' as const, reference: reply.reference as string, credits: Number.isSafeInteger(reply.credits) ? reply.credits as number : undefined };
  }
  if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) return { status: 'refused' as const, refusal: refusalCode(response.body) };
  return { status: 'unknown' as const };
}

/** Reserve, send once, settle. Shared by first submission and settling an unknown outcome. */
async function deliver(ctx: Context, host: ModuleHost, batchId: string) {
  const reserved = await host.store.update(state => {
    current(state, ctx, 'admin'); appOnly(ctx);
    check(state.policy.sharing, 'SHARING_DISABLED', 'Turn on structure-only sharing first.');
    const area = sharing(state), batch = area.batches.find(item => item.id === batchId);
    check(batch, 'NOT_FOUND', 'That batch does not exist.');
    const consent = area.consents.find(item => item.id === batch.consentId);
    check(consent && consentIntact(consent) && !consent.withdrawnAt, 'CONSENT_REQUIRED', 'Sharing was withdrawn or the consent changed.');
    area.contributor.token ??= token();
    return { batch: structuredClone(batch), publicName: consent.publicName ?? null, contributor: area.contributor.token };
  });
  let outcome: { status: 'sent' | 'refused' | 'unknown'; reference?: string; credits?: number; refusal?: string };
  if (reserved.batch.mode === 'test-inbox') outcome = { status: 'sent', reference: `test-inbox:${reserved.batch.id}` };
  // core-gateway-auth: canary. A blocked batch never left, so it is settled as refused with CANARY_BLOCKED (not unknown) and is never sent again.
  else { try { outcome = await send(host, reserved.batch, reserved.publicName, reserved.contributor, ctx); } catch (error) { if ((error as any)?.code === 'INTAKE_NOT_OPEN') throw error; outcome = (error as any)?.code === 'CANARY_BLOCKED' ? { status: 'refused', refusal: 'CANARY_BLOCKED' } : { status: 'unknown' }; } }
  return host.store.update(state => {
    const area = sharing(state), batch = area.batches.find(item => item.id === batchId)!;
    batch.status = outcome.status; batch.settledAt = now();
    if (outcome.reference) batch.reference = outcome.reference;
    if (outcome.refusal) batch.refusal = outcome.refusal;
    if (outcome.credits !== undefined) batch.credits = outcome.credits;
    if (outcome.status === 'sent' && batch.mode === 'test-inbox') area.testInbox.push({ batchId, bytes: batch.bytes });
    audit(state, 'learningx.batch-settled', { batchId, status: batch.status });
    return batchView(batch);
  });
}
const batchView = (batch: Batch) => { const { deletionToken: _secret, ...view } = structuredClone(batch); return view; };

// --- The local sample cleaner (day 4, block 13) ---------------------------------------------------
const nameHeader = /(?:^|[^a-z])(?:name|party|customer|client|supplier|vendor|contact|buyer|seller|payee|naam)(?:$|[^a-z])/i;
const idHeaders: [RegExp, string][] = [[/gstin|gst.?no|gst.?number/i, 'GSTIN'], [/\bpan\b|pan.?no/i, 'PAN'], [/phone|mobile|contact.?no|whatsapp/i, 'PHONE'], [/e-?mail/i, 'MAIL'], [/ifsc/i, 'IFSC'], [/upi|vpa/i, 'UPI']];
function fake(code: string, seed: Buffer): string {
  const letters = (offset: number, length: number) => [...seed.subarray(offset, offset + length)].map(byte => String.fromCharCode(65 + byte % 26)).join('');
  const digits = (offset: number, length: number) => [...seed.subarray(offset, offset + length)].map(byte => String(byte % 10)).join('');
  if (code === 'GSTIN') return `99${letters(0, 5)}${digits(5, 4)}${letters(9, 1)}1Z${letters(10, 1)}`;
  if (code === 'PAN') return `${letters(0, 5)}${digits(5, 4)}${letters(9, 1)}`;
  if (code === 'PHONE') return `90000${digits(0, 5)}`;
  if (code === 'MAIL') return `person.${letters(0, 6).toLowerCase()}@example.invalid`;
  if (code === 'IFSC') return `TEST0${letters(0, 6)}`;
  return `person${letters(0, 4).toLowerCase()}@upi`;
}
const label = (index: number) => { let text = ''; for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) text = String.fromCharCode(65 + (n - 1) % 26) + text; return `Name ${text}`; };
const csvCell = (value: string) => /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

export function cleanSample(content: string, salt: string) {
  const rows = parseCsv(content);
  check(rows.length > 0, 'EMPTY_FILE', 'The sample needs at least one row under its header.');
  const headers = Object.keys(rows[0]);
  const names = new Map<string, Map<string, string>>(), replaced: Record<string, number> = {};
  const roles = new Map<string, string>();
  for (const header of headers) { const id = idHeaders.find(([pattern]) => pattern.test(header)); if (id) roles.set(header, id[1]); else if (nameHeader.test(header)) roles.set(header, 'NAME'); }
  const cleanedRows = rows.map(row => Object.fromEntries(headers.map(header => {
    const value = row[header] ?? '', role = roles.get(header);
    if (!role || value.trim() === '') return [header, value];
    replaced[header] = (replaced[header] ?? 0) + 1;
    if (role === 'NAME') { const map = names.get(header) ?? new Map(); names.set(header, map); if (!map.has(value)) map.set(value, label(map.size)); return [header, map.get(value)!]; }
    return [header, fake(role, createHmac('sha256', salt).update(`${role}:${value}`).digest())];
  })));
  // Free-text columns are not rewritten: anything still looking like an identifier blocks the file.
  const patterns = VALUE_PATTERNS.filter(pattern => pattern.code !== 'DIGITS');
  const hits: Sample['hits'] = [];
  cleanedRows.forEach((row, index) => { for (const header of headers) if (!roles.has(header)) for (const { code, pattern } of patterns) if (pattern.test(row[header] ?? '')) hits.push({ line: index + 2, column: header, code }); });
  const cleaned = [headers.map(csvCell).join(','), ...cleanedRows.map(row => headers.map(header => csvCell(row[header] ?? '')).join(','))].join('\n');
  return { cleaned, hits, replaced, status: hits.length ? 'blocked' as const : 'clean' as const };
}

export const sharingMethods: Record<string, MethodSpec> = {
  'learningx.intakeStatus': { permission: 'read', handler: (_ctx, _payload, host) => intakeStatus(host.store.read(), host) },
  'learningx.preview': { permission: 'admin', handler: (ctx, payload, host) => host.store.update(state => {
    current(state, ctx, 'admin');
    const boxes = boxesOf(payload.boxes ?? OPEN_BOXES), built = compose(state, ctx, boxes);
    check(built.decisions.length > 0, 'NOTHING_TO_SHARE', 'No new decisions are waiting in the chosen boxes.');
    const preview: Preview = { id: newId('sharepreview'), at: now(), memberId: ctx.memberId, epoch: ctx.epoch, boxes, decisionIds: built.decisions.map(item => item.id),
      sourceIds: [...new Set(built.decisions.flatMap(item => item.sourceIds))].sort(), digest: built.digest, size: built.size, count: built.decisions.length, blocked: built.blocked };
    const previews = sharing(state).previews; previews.push(preview); if (previews.length > PREVIEW_LIMIT) previews.splice(0, previews.length - PREVIEW_LIMIT); audit(state, 'learningx.previewed', { previewId: preview.id, digest: preview.digest });
    const authors = Object.entries(built.decisions.reduce<Record<string, number>>((counts, item) => { const author = logAuthor(state, item.id); counts[author] = (counts[author] ?? 0) + 1; return counts; }, {})).map(([memberId, count]) => ({ memberId, count }));
    return { ...structuredClone(preview), bytes: built.bytes, names: 0, amounts: 0, publicName: sharing(state).contributor.publicName, authors, status: intakeStatus(state, host) };
  }) },
  'learningx.consent': { permission: 'admin', handler: (ctx, payload, host) => host.store.update(state => {
    current(state, ctx, 'admin'); appOnly(ctx);
    check(state.policy.sharing, 'SHARING_DISABLED', 'Turn on structure-only sharing before giving consent.');
    const preview = previewFor(state, ctx, payload.previewId);
    check(payload.digest === preview.digest, 'PREVIEW_CHANGED', 'Consent must name the exact previewed bytes.');
    reproduce(state, ctx, preview);
    // The public name the credits go under is part of what is agreed: a later change does not alter this batch.
    const record = { id: newId('shareconsent'), at: now(), previewId: preview.id, digest: preview.digest, publicName: sharing(state).contributor.publicName, memberId: ctx.memberId, role: ctx.role, epoch: ctx.epoch };
    const consent: Consent = { ...record, integrity: digest(record) };
    const area = sharing(state), used = new Set(area.batches.map(batch => batch.consentId));
    area.consents.push(consent);
    // Consents behind a batch are kept as its record; unused ones beyond the bound are dropped oldest first.
    while (area.consents.filter(item => !used.has(item.id)).length > PREVIEW_LIMIT) area.consents.splice(area.consents.findIndex(item => !used.has(item.id)), 1);
    audit(state, 'learningx.consented', { consentId: consent.id, digest: consent.digest });
    return structuredClone(consent);
  }) },
  'learningx.submit': { permission: 'admin', handler: async (ctx, payload, host) => {
    const batchId = await host.store.update(state => {
      current(state, ctx, 'admin'); appOnly(ctx);
      check(state.policy.sharing, 'SHARING_DISABLED', 'Turn on structure-only sharing first.');
      const area = sharing(state), consent = area.consents.find(item => item.id === payload.consentId);
      check(consent, 'CONSENT_REQUIRED', 'Give consent to the exact preview first.');
      check(consentIntact(consent) && !consent.withdrawnAt, 'CONSENT_REQUIRED', 'Sharing was withdrawn or the consent changed.');
      check(consent.memberId === ctx.memberId && consent.epoch === ctx.epoch, 'CONSENT_REQUIRED', 'Consent belongs to another person or an older sign-in.');
      check(!area.batches.some(batch => batch.consentId === consent.id), 'BATCH_ALREADY_ATTEMPTED', 'This consent was already used. An uncertain upload is settled, never sent again on its own.');
      const status = intakeStatus(state, host);
      check(status.open, 'INTAKE_NOT_OPEN', 'Sharing is not open yet. Nothing is sent.');
      const preview = previewFor(state, ctx, consent.previewId), built = reproduce(state, ctx, preview), done = shared(state);
      check(preview.decisionIds.every(id => !done.has(id)), 'PREVIEW_CHANGED', 'Some of these decisions were already sent in another batch. Open a new preview.');
      check(built.digest === consent.digest, 'PREVIEW_CHANGED', 'The consented bytes changed.');
      const batch: Batch = { id: newId('sharebatch'), at: now(), consentId: consent.id, previewId: preview.id, mode: status.mode as Batch['mode'], boxes: preview.boxes, decisionIds: preview.decisionIds,
        bytes: built.bytes, digest: built.digest, size: built.size, count: preview.count, deletionToken: token(), status: 'pending' };
      area.batches.push(batch); audit(state, 'learningx.batch-reserved', { batchId: batch.id, digest: batch.digest });
      return batch.id;
    });
    return deliver(ctx, host, batchId);
  } },
  'learningx.settle': { permission: 'admin', handler: async (ctx, payload, host) => {
    const batch = sharing(host.store.read()).batches.find(item => item.id === payload.batchId);
    check(batch, 'NOT_FOUND', 'That batch does not exist.');
    check(batch.status === 'unknown', 'BATCH_SETTLED', 'Only an uncertain upload is settled again.');
    // The intake is idempotent on the batch identifier: the same bytes under the same key cannot store twice.
    return deliver(ctx, host, batch.id);
  } },
  'learningx.batches': { permission: 'admin', handler: (ctx, _payload, host) => {
    const state = host.store.read(); current(state, ctx, 'admin');
    const area = peekArea<Sharing>(state, 'sharing'), batches = area?.batches ?? [];
    const live = batches.filter(batch => batch.status === 'sent');
    const scan = live.flatMap(batch => scanText(batch.bytes.split('\n').slice(1, -1).join('\n')));
    return { items: batches.map(batchView).reverse(), shared: { events: live.reduce((sum, batch) => sum + batch.count, 0), names: scan.filter(hit => hit.code !== 'DIGITS').length, amounts: scan.filter(hit => hit.code === 'DIGITS').length },
      credits: { publicName: area?.contributor.publicName ?? null, latest: live.map(batch => batch.credits).filter(value => value !== undefined).at(-1) ?? null } };
  } },
  'learningx.batch': { permission: 'admin', handler: (ctx, payload, host) => {
    const state = host.store.read(); current(state, ctx, 'admin');
    const batch = peekArea<Sharing>(state, 'sharing')?.batches.find(item => item.id === payload.batchId);
    check(batch, 'NOT_FOUND', 'That batch does not exist.');
    return batchView(batch);
  } },
  'learningx.deleteBatch': { permission: 'admin', handler: async (ctx, payload, host) => {
    const state = host.store.read(); current(state, ctx, 'admin'); appOnly(ctx);
    const batch = peekArea<Sharing>(state, 'sharing')?.batches.find(item => item.id === payload.batchId);
    check(batch, 'NOT_FOUND', 'That batch does not exist.');
    check(batch.status === 'sent' || batch.status === 'unknown', 'BATCH_NOT_SENT', 'Only a sent or uncertain batch is deleted from the server.');
    if (batch.mode === 'intake') {
      const options = intakeOf(host); check(options, 'INTAKE_NOT_OPEN', 'The intake is not configured on this computer.');
      check(batch.reference, 'DELETE_UNKNOWN', 'Settle the uncertain upload before deleting it.');
      let status = 0;
      try { status = (await transportOf(options)({ method: 'DELETE', path: `/v1/batches/${encodeURIComponent(batch.reference)}`, headers: { 'x-deletion-token': batch.deletionToken } })).status; } catch { status = 0; }
      check(status === 200 || status === 404, 'DELETE_UNKNOWN', 'The server did not confirm the deletion. Try again.');
    }
    return host.store.update(state => {
      const area = sharing(state), stored = area.batches.find(item => item.id === batch.id)!;
      stored.status = 'deleted'; stored.deletedAt = now(); stored.bytes = '';
      area.testInbox = area.testInbox.filter(item => item.batchId !== batch.id);
      audit(state, 'learningx.batch-deleted', { batchId: batch.id });
      return batchView(stored);
    });
  } },
  'learningx.withdraw': { permission: 'admin', handler: async (ctx, _payload, host) => {
    appOnly(ctx);
    await host.call('learning.sharing', { enabled: false });
    return host.store.update(state => {
      current(state, ctx, 'admin');
      const area = sharing(state); let withdrawn = 0;
      for (const consent of area.consents) if (!consent.withdrawnAt && !area.batches.some(batch => batch.consentId === consent.id)) { consent.withdrawnAt = now(); withdrawn++; }
      audit(state, 'learningx.withdrawn', { withdrawn });
      return { sharing: false, withdrawnConsents: withdrawn, sentBatches: area.batches.filter(batch => batch.status === 'sent').map(batch => batch.id) };
    });
  } },
  'learningx.creditName': { permission: 'admin', handler: (ctx, payload, host) => host.store.update(state => {
    current(state, ctx, 'admin'); appOnly(ctx);
    check(payload.publicName === null || typeof payload.publicName === 'string' && PUBLIC_NAME.test(payload.publicName), 'INVALID_PUBLIC_NAME', 'A public name uses 2 to 40 letters, spaces and simple punctuation, or none.');
    sharing(state).contributor.publicName = payload.publicName;
    return { publicName: payload.publicName };
  }) },
  'learningx.cleanSample': { permission: 'prepare', handler: (ctx, payload, host) => host.store.update(state => {
    current(state, ctx, 'prepare');
    check(typeof payload.content === 'string' && payload.content.length > 0 && payload.content.length <= 5_000_000, 'INVALID_REQUEST', 'Give a CSV sample smaller than five megabytes.');
    check(payload.label === undefined || typeof payload.label === 'string' && payload.label.length <= 120, 'INVALID_REQUEST', 'A sample label is short text.');
    const area = sharing(state), result = cleanSample(payload.content, area.salt);
    const sample: Sample = { id: newId('sample'), at: now(), memberId: ctx.memberId, label: (payload.label as string | undefined) ?? 'Sample', ...result };
    area.outbox.push(sample); if (area.outbox.length > OUTBOX_LIMIT) area.outbox.splice(0, area.outbox.length - OUTBOX_LIMIT); audit(state, 'learningx.sample-cleaned', { sampleId: sample.id, status: sample.status });
    return { ...structuredClone(sample), upload: 'Uploading samples waits until the receiving service has been reviewed. Nothing is uploaded.' };
  }) },
  'learningx.outbox': { permission: 'read', handler: (ctx, _payload, host) => {
    const state = host.store.read(); current(state, ctx);
    return { items: (peekArea<Sharing>(state, 'sharing')?.outbox ?? []).filter(item => item.memberId === ctx.memberId || ctx.role === 'owner').map(item => structuredClone(item)).reverse() };
  } },
  'learningx.outboxDelete': { permission: 'prepare', handler: (ctx, payload, host) => host.store.update(state => {
    current(state, ctx, 'prepare');
    const area = sharing(state), index = area.outbox.findIndex(item => item.id === payload.id && (item.memberId === ctx.memberId || ctx.role === 'owner'));
    check(index >= 0, 'NOT_FOUND', 'That sample is not in the outbox.');
    area.outbox.splice(index, 1); return { deleted: true };
  }) },
};

/** Previews over removed sources are void; sent batches are structure only and stay listed. */
export function purgeSharing(state: State, reason: { sourceIds: readonly string[]; removedIds: ReadonlySet<string>; cutoff?: number }): number {
  const area = peekArea<Sharing>(state, 'sharing');
  if (!area) return 0;
  const old = (at: string) => reason.cutoff !== undefined && !(Date.parse(at) >= reason.cutoff);
  const before = area.previews.length + area.outbox.length;
  area.previews = area.previews.filter(preview => !old(preview.at) && !preview.sourceIds.some(id => reason.sourceIds.includes(id) || reason.removedIds.has(id)));
  // Cleaned samples still hold the business's own rows: they age out with retention.
  area.outbox = area.outbox.filter(sample => !old(sample.at));
  return before - area.previews.length - area.outbox.length;
}
