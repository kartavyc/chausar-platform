/**
 * `todayx.review` (TD-01, TD-03, PH-05): the review items Today joins beside the core `today.*`
 * rows. Read from the work-books lane's `approvals.list`, jobs-ext's `jobsx.proposals` (who owns a
 * proposed card) and hosted-link's `phone.documents.list`, each called as the same caller. Nothing
 * here approves, previews or imports anything.
 *
 * - The count is the things this seat may act on now, one per item: a waiting (`prepared`) item for
 *   a seat that approves (owner or cofounder). An item waiting for another person is not counted:
 *   every item for a seat that only prepares (the owner approves), and a proposed job card another
 *   member owns. Those are counted once in `waiting`.
 * - Items the core `today.review` already lists (actions, job mandates, job results, lessons) carry
 *   `core: true`; the host keeps the `today.*` row and drops the duplicate.
 * - Small tier-1 items of one sort are a summary row ("3 payment reminders") that counts its items
 *   and opens them one after another. Nothing on the always-waits list is ever grouped.
 * - A document sent from the phone is a row to confirm (admin seats). Its content is never read here.
 */
import type { Context } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';
import { moduleMethods } from '../modules/registry.ts';

type Rec = Record<string, any>;
export const CORE_SOURCES = ['action', 'job', 'acceptance', 'lesson'] as const;
const SOURCES = ['action', 'job', 'release', 'lesson', 'acceptance', 'writeback', 'bill', 'proposal'] as const;
const KINDS = ['message', 'record-change', 'money', 'prepare-only', 'job', 'group'] as const;
const TIERS = ['tier-2', 'tier-1', 'prepare-only'] as const;
const WHAT = ['start-job', 'change-job', 'accept-result', 'publish-meaning', 'review-lesson', 'bill-zoho', 'bill-tally'] as const;
/** At most this many items in one summary row: the size of one grouped approval. */
export const GROUP_MAX = 10;

export type ReviewItem = {
  id: string; source: typeof SOURCES[number]; kind: typeof KINDS[number]; tier: typeof TIERS[number];
  title: string; touches: string | null; amountPaise: string | null; since: string;
  what?: { kind: typeof WHAT[number]; name: string | null }; core: boolean;
};
export type ReviewGroup = { id: string; ids: string[]; source: ReviewItem['source']; kind: ReviewItem['kind']; what?: ReviewItem['what']; count: string; since: string };
export type PhoneDocumentRow = { documentId: string; channel: 'whatsapp' | 'telegram'; mediaType: string; receivedAt: string };
export type ReviewReply = {
  approvals: 'ready' | 'not-built';
  items: ReviewItem[];
  groups: ReviewGroup[];
  documents: 'ready' | 'not-built';
  phoneDocuments: PhoneDocumentRow[];
  /** Items this seat may act on now, outside the core `today.*` set: items not marked core, group items and documents. */
  count: string;
  /** Items waiting for another person: never in `count`. */
  waiting: string;
};

const text = (value: unknown, max = 400): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const instant = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value));
const oneOf = <T extends string>(list: readonly T[], value: unknown): value is T => typeof value === 'string' && (list as readonly string[]).includes(value);
const installed = (method: string) => moduleMethods.has(method);
async function quiet<T>(work: () => Promise<T>): Promise<T | null> { try { return await work(); } catch { return null; } }

/** One checked `approvals.list` row, or null when it is not one. */
function itemOf(row: unknown): (ReviewItem & { state: string }) | null {
  if (row === null || typeof row !== 'object') return null;
  const r = row as Rec;
  if (!text(r.id, 300) || !oneOf(SOURCES, r.source) || !oneOf(KINDS, r.kind) || !oneOf(TIERS, r.tier) || !text(r.title) || !instant(r.createdAt) || typeof r.state !== 'string') return null;
  const minor = r.amount && typeof r.amount === 'object' && typeof r.amount.minor === 'string' && /^-?(0|[1-9][0-9]{0,30})$/.test(r.amount.minor) ? r.amount.minor : null;
  const what = r.what && typeof r.what === 'object' && oneOf(WHAT, r.what.kind) && (r.what.name === null || text(r.what.name)) ? { kind: r.what.kind, name: r.what.name } : undefined;
  return { id: r.id, source: r.source, kind: r.kind, tier: r.tier, title: r.title, touches: text(r.touches) ? r.touches : null, amountPaise: minor,
    since: r.createdAt, ...(what ? { what } : {}), core: (CORE_SOURCES as readonly string[]).includes(r.source), state: r.state };
}

/** The sort of a groupable item: same source, kind and named sort. Null when it is never grouped. */
function groupKey(item: ReviewItem): string | null {
  if (item.tier !== 'tier-1' || item.core || item.source === 'proposal' || item.kind === 'money' || item.kind === 'job') return null;
  return `${item.source}|${item.kind}|${item.what?.kind ?? ''}`;
}

export async function todayReview(ctx: Context, host: ModuleHost): Promise<ReviewReply> {
  const approver = ctx.role === 'owner' || ctx.role === 'cofounder';
  let waiting = 0;
  let approvals: ReviewReply['approvals'] = 'not-built';
  const actionable: ReviewItem[] = [];
  if (installed('approvals.list')) {
    const listed: any = await quiet(() => host.call('approvals.list', {}) as Promise<any>);
    if (listed && Array.isArray(listed.items)) {
      approvals = 'ready';
      // A proposed card is approved only by its owner: jobs-ext names the owner of each one this seat sees.
      const proposals: any = listed.items.some((row: Rec) => row?.source === 'proposal') && installed('jobsx.proposals')
        ? await quiet(() => host.call('jobsx.proposals', {}) as Promise<any>) : null;
      const owned = new Set((Array.isArray(proposals) ? proposals : []).filter((p: Rec) => p?.card?.ownerId === ctx.memberId && typeof p.id === 'string').map((p: Rec) => `proposal:${p.id}`));
      for (const row of listed.items) {
        const item = itemOf(row);
        if (item === null || item.state !== 'prepared') continue;
        const mine = approver && (item.source !== 'proposal' || owned.has(item.id));
        if (!mine) { waiting++; continue; }
        const { state: _state, ...kept } = item;
        actionable.push(kept);
      }
    }
  }
  // Summary rows: two or more groupable items of one sort, at most ten to a row, oldest first inside.
  const buckets = new Map<string, ReviewItem[]>();
  for (const item of actionable) { const key = groupKey(item); if (key !== null) buckets.set(key, [...(buckets.get(key) ?? []), item]); }
  const groups: ReviewGroup[] = [];
  const grouped = new Set<string>();
  for (const members of buckets.values()) {
    if (members.length < 2) continue;
    const sorted = [...members].sort((a, b) => a.since.localeCompare(b.since) || a.id.localeCompare(b.id));
    for (let start = 0; start < sorted.length; start += GROUP_MAX) {
      const part = sorted.slice(start, start + GROUP_MAX);
      if (part.length < 2) continue;
      const first = part[0]!;
      groups.push({ id: `group:${first.id}`, ids: part.map(item => item.id), source: first.source, kind: first.kind, ...(first.what ? { what: { kind: first.what.kind, name: null } } : {}),
        count: String(part.length), since: part.at(-1)!.since });
      for (const item of part) grouped.add(item.id);
    }
  }
  const items = actionable.filter(item => !grouped.has(item.id));

  let documents: ReviewReply['documents'] = 'not-built';
  const phoneDocuments: PhoneDocumentRow[] = [];
  if (installed('phone.documents.list')) {
    const listed: any = await quiet(() => host.call('phone.documents.list', {}) as Promise<any>);
    if (listed && Array.isArray(listed.documents)) {
      documents = 'ready';
      for (const doc of listed.documents) {
        if (!doc || !text(doc.documentId, 200) || !/^[A-Za-z0-9_-]{1,200}$/.test(doc.documentId) || !oneOf(['whatsapp', 'telegram'] as const, doc.channel)
          || !text(doc.mediaType, 100) || !instant(doc.receivedAt) || doc.status !== 'awaiting-review') continue;
        // Previewing and confirming need an owner or cofounder; for any other seat it waits for them.
        if (!approver) { waiting++; continue; }
        phoneDocuments.push({ documentId: doc.documentId, channel: doc.channel, mediaType: doc.mediaType, receivedAt: doc.receivedAt });
      }
    }
  }
  const count = items.filter(item => !item.core).length + groups.reduce((sum, group) => sum + group.ids.length, 0) + phoneDocuments.length;
  return { approvals, items, groups, documents, phoneDocuments, count: String(count), waiting: String(waiting) };
}
