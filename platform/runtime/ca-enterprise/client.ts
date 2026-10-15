/**
 * Client side of the CA console (`castatus.*`), in any desktop workspace. The owner links the
 * firm with the code the firm gave and agrees to share status; the workspace then issues status
 * cards. A card is worked out only from this workspace's own state and its own engine methods,
 * and holds dates, counts and states, never a figure, a customer's name or a document.
 */
import { lstatSync, readFileSync } from 'node:fs';
import { audit, check, now, type Context, type State } from '../contracts.ts';
import type { MethodSpec, ModuleHost } from '../modules/types.ts';
import { invitationOf, peekCore, seatOf } from '../trust-ext/core-state.ts';
import { peekReports } from '../reports-ext/common.ts';
import { reasons } from '../reports-ext/packs.ts';
import { laneState, peekLane } from './state.ts';
import {
  clockOf, closeMonth, DUE_CODE, fields, indiaDay, isTime, label, LINK_CODE, linkDigest, monthLastDay, sealCard, VERSION,
  type CardSeat, type CloseStep, type CloseStrip, type Handover, type Ready, type StatusCard,
} from './card.ts';

export type ClientLink = { firmName: string; code: string; linkedAt: string; linkedBy: string; consent: { version: string; at: string; by: string } | null; lastCardAt: string | null };
export type Wording = { version: string; approved: boolean; text: string | null };

/** Shown only in a synthetic demo workspace, so the flow can be tried before the founder supplies the real wording. */
const DRAFT_TEXT = 'Draft wording, not approved. I agree that this workspace may give the linked CA firm a status card: when the books were last read, '
  + 'the state of the month\'s close (bank, GST, TDS, trial balance), how many items wait for the firm, the next due date, and the seats I gave. '
  + 'The card never holds a figure, a customer\'s name or a document. I can withdraw this at any time.';
const MAX_WORDING_BYTES = 64 * 1024;

const peekLink = (state: State): ClientLink | undefined => peekLane(state)?.link as ClientLink | undefined;
const writeLink = (state: State): ClientLink | undefined => laneState(state).link as ClientLink | undefined;

function wordingFrom(value: unknown): Wording | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => key !== 'version' && key !== 'text')) return null;
  if (typeof input.version !== 'string' || !VERSION.test(input.version) || input.version === 'draft-unapproved') return null;
  if (typeof input.text !== 'string' || input.text.trim().length === 0 || input.text.length > 20_000) return null;
  return { version: input.version, approved: true, text: input.text };
}
/** The founder's consent wording from trusted host options; a missing, unreadable or malformed one counts as not supplied. */
function founderWording(host: ModuleHost): Wording | null {
  if (host.options.consentWording !== undefined) return wordingFrom(host.options.consentWording);
  const path = host.options.consentWordingFile;
  if (typeof path !== 'string' || path.length === 0) return null;
  try {
    const info = lstatSync(path); if (!info.isFile() || info.size > MAX_WORDING_BYTES) return null;
    return wordingFrom(JSON.parse(readFileSync(path, 'utf8')));
  } catch { return null; }
}
/** The wording an owner agrees to: the founder's; in a demo workspace without it, the unapproved draft; otherwise pending. */
export function currentWording(host: ModuleHost, state: State): Wording {
  return founderWording(host) ?? (state.workspace.demo ? { version: 'draft-unapproved', approved: false, text: DRAFT_TEXT } : { version: 'pending', approved: false, text: null });
}
const wordingReady = (host: ModuleHost, state: State) => founderWording(host) !== null || state.workspace.demo === true;

// ---- Seats this client gave (trust-ext core seats) ------------------------------------------------------
type GivenSeat = CardSeat & { memberId: string };
function seatEndsOn(state: State, memberId: string): string | null {
  const invite = invitationOf(state, memberId); return (invite && peekCore(state).seats[invite]?.endsOn) || null;
}
/** Every active member holding a CA or accountant seat whose end date has not passed. No names. */
export function givenSeats(state: State, day: string): GivenSeat[] {
  const out: GivenSeat[] = [];
  for (const member of state.members) {
    if (!member.active) continue;
    const seat = seatOf(state, member); if (seat !== 'ca' && seat !== 'accountant') continue;
    const endsOn = seatEndsOn(state, member.id); if (endsOn !== null && endsOn < day) continue;
    out.push({ seat, endsOn, memberId: member.id });
  }
  return out.sort((a, b) => a.seat.localeCompare(b.seat) || String(a.endsOn ?? '9999').localeCompare(String(b.endsOn ?? '9999')));
}

// ---- Reading this workspace's own engine methods --------------------------------------------------------
/** Calls a method as the same caller; null when it is absent or refuses. A changed access always stops the card. */
async function soft(host: ModuleHost, method: string, payload: Record<string, unknown>): Promise<unknown> {
  try { return await host.call(method, payload); } catch (error) {
    if ((error as { code?: string })?.code === 'ACCESS_REVOKED') throw error;
    return null;
  }
}
const rec = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const countWhere = (list: unknown, test: (item: Record<string, any>) => boolean): number | null => Array.isArray(list) ? list.filter(item => rec(item) && test(item)).length : null;

/**
 * The month's close strip, from the connector part (`connectorsx.envelopes` names which sources are a bank statement,
 * a GST return or Form 26AS; `connectorsx.freshness` gives each source's square for the close month):
 * - bank: every source in the `bank-statements` group;
 * - gst: the GSTR-1 (`gst-downloads` / `gstr1-outward-invoices`) and GSTR-3B (`gstr3b-outward-supplies`) sources; a return
 *   with no source at all while the other has one counts as a missing part;
 * - tds: the Form 26AS tax-deducted sources (`form26as-ais` / `form26as-tds-credit`);
 * - tb: the engine has no trial-balance source or schedule, so it is always `not-done`.
 * For each step: no source → `not-done`; any source whose close-month read was refused or failed → `refused`; every part
 * loaded for the month → `done`; some loaded → `in-progress`; none loaded → `not-done`. When the connector part is absent
 * or refuses, every step is `not-done` (its source is absent as far as this workspace can tell).
 */
async function closeStrip(host: ModuleHost, month: string): Promise<CloseStrip> {
  const envelopes = await soft(host, 'connectorsx.envelopes', { limit: 400 });
  const fresh = await soft(host, 'connectorsx.freshness', { asOf: monthLastDay(month) });
  const none: CloseStrip = { bank: 'not-done', gst: 'not-done', tds: 'not-done', tb: 'not-done' };
  if (!Array.isArray(envelopes) || !Array.isArray(fresh)) return none;
  const square = new Map<string, string>();
  for (const item of fresh) if (rec(item) && typeof item.sourceId === 'string' && Array.isArray(item.months)) {
    const found = item.months.find((m: any) => rec(m) && m.month === month); square.set(item.sourceId, typeof found?.status === 'string' ? found.status : 'not-loaded-yet');
  }
  const sources = (test: (e: Record<string, any>) => boolean) => [...new Set(envelopes.filter(e => rec(e) && typeof e.sourceId === 'string' && test(e)).map(e => e.sourceId as string))];
  const parts = (ids: string[]) => ids.map(id => square.get(id) ?? 'not-loaded-yet');
  const step = (list: string[]): CloseStep => {
    if (list.length === 0) return 'not-done';
    if (list.some(s => s === 'refused' || s === 'failed')) return 'refused';
    const loaded = list.filter(s => s === 'loaded').length;
    return loaded === list.length ? 'done' : loaded > 0 ? 'in-progress' : 'not-done';
  };
  const gst1 = sources(e => e.group === 'gst-downloads' && e.operation === 'gstr1-outward-invoices');
  const gst3 = sources(e => e.group === 'gst-downloads' && e.operation === 'gstr3b-outward-supplies');
  const gst = gst1.length + gst3.length === 0 ? [] : [...parts(gst1), ...parts(gst3), ...(gst1.length === 0 || gst3.length === 0 ? ['absent'] : [])];
  return {
    bank: step(parts(sources(e => e.group === 'bank-statements'))), gst: step(gst),
    tds: step(parts(sources(e => e.group === 'form26as-ais' && e.operation === 'form26as-tds-credit'))), tb: 'not-done',
  };
}

/**
 * Hand-over readiness from the CA pack (`reportsx.packs`, CA pack pages): `gstMatch` is the "Purchases against GSTR-2B"
 * page and `ageing` the "Receivables ageing" page; a page ready (tested or not) is `ready`, a page whose calculation was
 * refused is `refused`, any other not-started page is `not-ready`. The CA pack has no trial balance, bank reconciliation
 * or TDS match schedule yet, so those three are `not-ready`; so is everything when the reports part is absent or refuses.
 */
async function handover(host: ModuleHost): Promise<Handover> {
  const reply = await soft(host, 'reportsx.packs', { language: 'en' });
  const pages = rec(reply) && Array.isArray(reply.packs) ? reply.packs.find((p: any) => rec(p) && p.id === 'ca')?.pages : null;
  const ready = (id: string): Ready => {
    const page = Array.isArray(pages) ? pages.find((p: any) => rec(p) && p.id === id) : null;
    if (!rec(page)) return 'not-ready';
    if (page.state === 'ready-tested' || page.state === 'ready-untested') return 'ready';
    return page.reason === reasons.refused.en ? 'refused' : 'not-ready';
  };
  return { tb: 'not-ready', bankRec: 'not-ready', gstMatch: ready('purchases-gstr2b'), tdsMatch: 'not-ready', ageing: ready('ageing') };
}

/** The next entry of the published due-date calendar on or after today (`reportsx.due`, with the workspace's due profile). */
async function dueNext(host: ModuleHost, day: string): Promise<StatusCard['dueNext']> {
  const reply = await soft(host, 'reportsx.due', { from: day, days: 120 });
  const rows = rec(reply) && Array.isArray(reply.rows) ? reply.rows : [];
  for (const row of rows) {
    if (!rec(row) || typeof row.id !== 'string' || typeof row.dueOn !== 'string' || row.dueOn < day) continue;
    const code = row.id.split(':')[0]!;
    if (DUE_CODE.test(code) && /^\d{4}-\d{2}-\d{2}$/.test(row.dueOn)) return { code, date: row.dueOn };
  }
  return null;
}

/** The newest time any source was read: an import (`state.imports[].at`, or a connector capture's `createdAt`) or an accepted connector read. */
function booksReadAt(state: State, fresh: unknown): string | null {
  const times: string[] = [];
  for (const item of state.imports) if (rec(item)) for (const key of ['at', 'createdAt']) if (isTime(item[key])) times.push(item[key]);
  if (Array.isArray(fresh)) for (const item of fresh) if (rec(item) && isTime(item.lastRead)) times.push(item.lastRead);
  return times.sort().at(-1) ?? null;
}

/** The "ask a person" files this workspace made (`reportsx.askPerson`): how many are on record and when the oldest was made. */
function questions(state: State): StatusCard['questions'] {
  const list = peekReports(state).questions;
  if (list !== undefined && !Array.isArray(list)) return { count: null, oldestAt: null };
  const items = (list ?? []).filter((q: any) => rec(q) && q.removalFailed !== true);
  const oldestAt = items.map((q: any) => q.at).filter(isTime).sort().at(0) ?? null;
  return { count: items.length, oldestAt };
}

/** Who may issue the card: an owner or cofounder, or a member on a CA or accountant seat. */
function cardCaller(state: State, ctx: Context) {
  const member = state.members.find(m => m.id === ctx.memberId);
  check(member?.active, 'ACCESS_REVOKED', 'Your workspace access has changed. Sign in again.');
  const seat = seatOf(state, member);
  check(['owner', 'cofounder'].includes(member.role) || seat === 'ca' || seat === 'accountant', 'FORBIDDEN', 'Only an owner, a cofounder or the firm\'s seat issues a status card.');
}

async function issueCard(ctx: Context, host: ModuleHost): Promise<StatusCard> {
  const before = host.store.read(); cardCaller(before, ctx);
  const link = peekLink(before);
  check(link, 'CA_NOT_LINKED', 'Link a CA firm first.');
  const wording = currentWording(host, before);
  check(link.consent && wordingReady(host, before) && link.consent.version === wording.version, 'CA_NO_CONSENT', 'The owner has not agreed to share status with the firm.');
  const ms = clockOf(host), day = indiaDay(ms), month = closeMonth(day);
  const fresh = await soft(host, 'connectorsx.freshness', { asOf: day });
  // One call at a time: each goes through the engine's full authorization path as this caller.
  const close = await closeStrip(host, month), meanings = await soft(host, 'books.meanings', {}), recipes = await soft(host, 'books.recipes', {});
  const accounts = await soft(host, 'accounts.list', {}), ready = await handover(host), due = await dueNext(host, day);
  return host.store.update(state => {
    const current = writeLink(state);
    check(current && current.code === link.code, 'CA_NOT_LINKED', 'Link a CA firm first.');
    check(current.consent && current.consent.version === wording.version, 'CA_NO_CONSENT', 'The owner has not agreed to share status with the firm.');
    // Each card is strictly newer than the last, so the firm never takes a newer card for a stale one.
    let issued = new Date(ms).toISOString();
    if (current.lastCardAt && issued <= current.lastCardAt) issued = new Date(Date.parse(current.lastCardAt) + 1).toISOString();
    const card = sealCard(current.code, {
      v: 1, kind: 'chausar.ca-status', workspaceId: state.workspace.id, link: linkDigest(current.code), issuedAt: issued, month,
      booksReadAt: booksReadAt(state, fresh), close,
      cosign: {
        meanings: rec(meanings) ? countWhere(meanings.drafts, d => d.state === 'draft') : null,
        recipes: rec(recipes) ? countWhere(recipes.proposals, p => p.state === 'proposed') : null,
        accountClasses: rec(accounts) ? countWhere(accounts.accounts, a => a.state === 'proposed') : null,
      },
      questions: questions(state), handover: ready, dueNext: due,
      seats: givenSeats(state, day).slice(0, 20).map(({ seat, endsOn }) => ({ seat, endsOn })), consent: current.consent.version,
    });
    current.lastCardAt = card.issuedAt;
    audit(state, 'castatus.card.issued', { by: ctx.memberId });
    return card;
  });
}

function view(host: ModuleHost) {
  const state = host.store.read(), link = peekLink(state);
  return {
    link: link ? { firmName: link.firmName, linkedAt: link.linkedAt } : null,
    consent: link?.consent ? { version: link.consent.version, at: link.consent.at } : null,
    wording: currentWording(host, state), lastCardAt: link?.lastCardAt ?? null,
  };
}

export const clientMethods: Record<string, MethodSpec> = {
  'castatus.get': { permission: 'read', handler(_ctx, payload, host) { fields(payload, []); return view(host); } },
  'castatus.link': { permission: 'admin', async handler(ctx, payload, host) {
    const input = fields(payload, ['firmName', 'code']);
    const firmName = label(input.firmName, 'CA_REQUEST_INVALID', 'Give the firm\'s name in up to 120 characters.');
    check(typeof input.code === 'string' && LINK_CODE.test(input.code), 'CA_LINK_CODE_INVALID', 'Type the 16-letter link code exactly as the firm gave it.');
    return host.store.update(state => {
      const linkedAt = now();
      // A new link is a new firm or a new code: the earlier agreement does not carry over.
      laneState(state).link = { firmName, code: input.code, linkedAt, linkedBy: ctx.memberId, consent: null, lastCardAt: null } satisfies ClientLink;
      audit(state, 'castatus.linked', { by: ctx.memberId });
      return { firmName, linkedAt };
    });
  } },
  'castatus.unlink': { permission: 'admin', async handler(ctx, payload, host) {
    fields(payload, []);
    await host.store.update(state => { const lane = laneState(state); if (lane.link) { delete lane.link; audit(state, 'castatus.unlinked', { by: ctx.memberId }); } });
    return { unlinked: true };
  } },
  'castatus.consent': { permission: 'admin', async handler(ctx, payload, host) {
    const input = fields(payload, ['agree', 'version']);
    check(typeof input.agree === 'boolean' && typeof input.version === 'string' && input.version.length <= 64, 'CA_REQUEST_INVALID', 'Say whether you agree, with the wording version you read.');
    return host.store.update(state => {
      const link = writeLink(state); check(link, 'CA_NOT_LINKED', 'Link a CA firm first.');
      if (!input.agree) { link.consent = null; audit(state, 'castatus.consent.withdrawn', { by: ctx.memberId }); return { consent: null }; }
      check(wordingReady(host, state), 'CA_CONSENT_WORDING_PENDING', 'The wording you agree to is not ready yet, so status cannot be shared.');
      const wording = currentWording(host, state);
      check(input.version === wording.version, 'CA_CONSENT_VERSION_MISMATCH', 'The wording changed since you read it. Read it again.');
      link.consent = { version: wording.version, at: now(), by: ctx.memberId };
      audit(state, 'castatus.consent.given', { by: ctx.memberId, version: wording.version });
      return { consent: { version: link.consent.version, at: link.consent.at } };
    });
  } },
  'castatus.card': { permission: 'read', async handler(ctx, payload, host) { fields(payload, []); return issueCard(ctx, host); } },
  'castatus.inside': { permission: 'read', handler(ctx, payload, host) {
    fields(payload, []);
    const state = host.store.read(), member = state.members.find(m => m.id === ctx.memberId);
    if (!member) return { inside: false };
    const seat = seatOf(state, member);
    if (seat !== 'ca' && seat !== 'accountant') return { inside: false };
    return { inside: true, firmName: peekLink(state)?.firmName ?? null, workspaceName: state.workspace.name, seat, endsOn: seatEndsOn(state, member.id),
      can: seat === 'ca' ? ['read', 'export'] : ['read', 'export', 'prepare'] };
  } },
};
